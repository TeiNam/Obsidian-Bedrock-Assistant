import { App, TFile, Notice } from "obsidian";
import type { IAiClient, VaultIndexEntry, IndexResult, IndexFailure, IndexChunk, SerializedIndex } from "./types";
import { CURRENT_INDEX_SCHEMA_VERSION } from "./types";
import {
  splitIntoChunkSlices,
  normalizeChunkConfig,
  type ChunkConfig,
} from "./graph-rag/chunker";
import {
  extractMetadata,
  stripFrontmatter,
  type MetadataSource,
  type ExtractedMetadata,
} from "./graph-rag/graph-extractor";
import {
  searchWithDiagnostics,
  compareVectors,
  type NoteVectorScore,
} from "./graph-rag/vector-search";
import { traverseGraph, MAX_GRAPH_CANDIDATES, normalizeTraversalDepth } from "./graph-rag/graph-traversal";
import { combineAndRank } from "./graph-rag/score-combiner";
import { filterIndex, isFilterEmpty, type SearchFilter } from "./graph-rag/entry-filter";
import { fuseRanks, reserveSlots } from "./graph-rag/rank-fusion";

// === Graph_RAG_Search 결과 타입 (task 8.4) ===
// 기존 search()의 반환 타입 Array<{path,title,excerpt,score}>을 대체하는 신규 API 시그니처.
// 유일 호출처인 obsidian-tools.ts의 searchVault()는 task 9.1에서 함께 갱신된다.

/** Graph_RAG_Search 단일 결과 항목 (시드/이웃 구분 및 관계 정보 포함, Req 7.2~7.4). */
/**
 * 적중 청크에서 검색 결과에 실을 필드를 뽑는다.
 *
 * 본문이 빈 청크(레거시 폴백)에는 matchedText를 붙이지 않는다 — 빈 문자열을 실으면
 * 소비자의 `matchedText || excerpt` 폴백이 의도대로 동작하지만, 필드가 있는데 비어
 * 있는 상태는 "맞은 내용이 없다"와 구분되지 않아 읽는 쪽을 헷갈리게 한다.
 */
function matchedFields(
  match: { heading: string | null; text: string } | null
): { heading: string | null; matchedText?: string } {
  if (match === null) return { heading: null };
  const text = match.text.trim();
  return text === "" ? { heading: match.heading } : { heading: match.heading, matchedText: text };
}

export interface GraphRagSearchItem {
  /** 노트의 볼트 루트 기준 경로 */
  path: string;
  /** 노트 제목 */
  title: string;
  /** 발췌(excerpt) */
  excerpt: string;
  /** 0.0~1.0 으로 정규화된 통합 점수 (Req 6.1) */
  combinedScore: number;
  /** 0.0~1.0 으로 정규화된 벡터 유사도 */
  vectorScore: number;
  /**
   * 질의와 가장 잘 맞은 청크의 본문. 어휘로만 잡힌 노트와 v1 인덱스는 없다.
   *
   * `excerpt`는 본문 **맨 앞 500자로 고정**된 값이다(buildEntry). 검색은 뒤쪽 청크가
   * 맞아서 노트를 반환할 수 있는데, 그때 excerpt만 LLM에 주면 정작 맞은 내용이 전달되지
   * 않는다 — 결정 추출·모순 점검·종합이 모두 "검색은 찾았는데 근거는 못 본" 상태로
   * 답하게 된다. 맞은 청크를 함께 실어 소비자가 그것을 우선 쓰게 한다.
   */
  matchedText?: string;
  /** 시드로부터의 그래프 거리(hop). 0이면 시드 (Req 7.4) */
  hop: number;
  /** 시드 여부 (hop 0) (Req 7.3) */
  isSeed: boolean;
  /** 이 결과를 도달시킨 시드 경로. 시드 자신은 null (Req 7.4) */
  seedPath: string | null;
  /** 연결된 시드의 제목. 이웃 결과의 표현용으로 인덱스 조회로 채운다 (Req 7.4) */
  seedTitle?: string | null;
  /**
   * 질의와 가장 잘 맞은 청크가 속한 헤딩. 스키마 v1 인덱스나 도입부 청크는 null이다.
   *
   * 모델이 `[[노트#헤딩]]`으로 인용할 수 있게 하려고 싣는다. 노트 단위 인용은 긴
   * 노트에서 "어딘가에 있다"까지만 말해주므로 사용자가 근거를 다시 찾아야 한다.
   */
  heading?: string | null;
}

/** Graph_RAG_Search 반환 결과. */
export interface GraphRagResult {
  /** 통합 점수 내림차순으로 정렬된 결과 목록 (limit 적용 후) */
  items: GraphRagSearchItem[];
  /** 빈/공백 쿼리로 인해 검색을 수행하지 않은 경우 true (Req 4.7) */
  invalidQuery?: boolean;
  /** 인덱스에 임베딩이 0개여서 키워드 검색으로 폴백한 경우 true (Req 4.6) */
  usedKeywordFallback?: boolean;
  /**
   * 인덱스 임베딩이 현재 임베딩 모델과 차원이 달라(모델 변경) 벡터 검색을 신뢰할 수
   * 없는 경우 true. 호출부는 사용자에게 재인덱싱을 안내해야 한다.
   */
  staleEmbeddings?: boolean;
  /**
   * 필터가 제외한 노트 수. 필터 때문에 결과가 줄었다는 사실을 호출부가 알려면 필요하다.
   * 이 값이 크고 items가 비면 "인덱싱이 필요함"이 아니라 "조건이 좁음"이 원인이다.
   */
  filteredOutCount?: number;
  /** 어휘 검색 결과를 벡터 결과와 융합해 순위를 만든 경우 true. */
  usedHybrid?: boolean;
}

/**
 * 융합에 넣을 어휘 검색 후보의 **최소** 수. limit보다 넉넉히 뽑아야 융합에 쓸 재료가
 * 생긴다 — limit=5로 요청했을 때 어휘 후보도 5개만 뽑으면 정답이 어휘 6위인 경우를
 * 못 살린다. limit이 이 값보다 크면 limit을 쓴다(그러지 않으면 limit=100 요청에서
 * 31위 이후가 어휘 신호를 아예 받지 못한다).
 */
const LEXICAL_POOL_SIZE = 30;

/**
 * 어휘 목록에만 있는 후보에게 보장할 결과 자리 수.
 *
 * 2로 둔 이유: 정확 문자열 질의의 정답은 보통 한두 개다. 더 늘리면 어휘 상위권이 dense
 * 결과를 밀어내기 시작하고, dense가 이 플러그인의 주 신호다.
 */
const LEXICAL_RESERVED_SLOTS = 2;

/**
 * 융합에서 어휘 목록에 주는 가중치. dense가 이 플러그인의 주 신호이므로 보조로 둔다.
 *
 * 1.0으로 두면 어떤 단어를 여러 번 반복한 노트가 의미적으로 더 맞는 노트를 밀어낼 수
 * 있다. 0.5면 어휘 1위가 dense 4위권 정답을 상위로 끌어올리기에는 충분하면서
 * (0.5/61 + 1/64 > 1/61), dense 1위를 뒤집지는 못한다.
 */
const LEXICAL_FUSION_WEIGHT = 0.5;

/** 발췌(excerpt) 최대 길이. 검색 결과 미리보기와 LLM 컨텍스트에 사용된다. */
const EXCERPT_MAX_CHARS = 500;

/**
 * 벡터 검색 시 확보할 최소 시드 수.
 * limit이 이보다 작아도 그래프 순회의 출발점을 충분히 확보하기 위한 하한이다.
 */
const SEED_MIN_COUNT = 10;

// 볼트 인덱싱 및 검색
export class VaultIndexer {
  private app: App;
  client: IAiClient;
  private index: Map<string, VaultIndexEntry> = new Map();
  private indexing = false;
  private useEmbeddings = true;
  // 인덱싱 중 발생한 파일 변경을 큐잉하기 위한 대기열
  private pendingFiles: Set<string> = new Set();
  // 청크 분할 설정 (기본 maxSize 2000 / overlap 200, 유효 범위로 정규화)
  // setSearchOptions에서 사용자 설정으로 갱신된다
  private chunkConfig: ChunkConfig = normalizeChunkConfig(2000, 200);
  // 그래프 순회 탐색 깊이(hop). 기본 1 (Req 5.1, 9.1). 0이면 그래프 순회 비활성(시드만 사용, Req 5.2)
  // setSearchOptions에서 normalizeTraversalDepth로 보정되어 갱신된다
  private traversalDepth = 1;
  // 옵시디언 metadataCache 어댑터 (task 11.1에서 main.ts가 실제 어댑터를 주입)
  // 미주입 시 buildEntry는 메타데이터 없이(빈 값) 본문 전체를 청킹하여 우아하게 저하한다
  private metadataSource: MetadataSource | null = null;
  // 현재 임베딩 구성 시그니처(`{provider}:{modelId}`). main.ts가 설정에서 주입한다.
  private embeddingSignature: string | null = null;
  // 로드한 인덱스의 임베딩 구성이 현재 설정과 달라 벡터를 신뢰할 수 없는 상태
  private staleIndex = false;
  // buildEntry 진행 중에 삭제·이동된 경로. 완료 시 기록을 취소해 부활을 막는다.
  private removedDuringIndexing: Set<string> = new Set();

  constructor(app: App, client: IAiClient) {
    this.app = app;
    this.client = client;
  }

  // metadataCache 어댑터 주입 (task 11.1에서 main.ts가 호출)
  // null을 전달하면 메타데이터 추출 없이 동작한다(하위 호환/테스트 편의)
  setMetadataSource(source: MetadataSource | null): void {
    this.metadataSource = source;
  }

  /**
   * Graph_RAG_Search 동작 설정을 갱신한다 (Req 9.1~9.7).
   * - depth: normalizeTraversalDepth로 0~3 정수로 보정 (비정수 반올림, Req 5.9, 9.2, 9.4, 9.5)
   * - chunkMaxSize/chunkOverlap: normalizeChunkConfig로 maxSize>=1, 0<=overlap<maxSize 보정 (Req 9.6, 9.7)
   *
   * 지정되지 않은 옵션은 기존 값을 유지한다.
   */
  setSearchOptions(opts: { depth?: number; chunkMaxSize?: number; chunkOverlap?: number }): void {
    if (opts.depth !== undefined) {
      this.traversalDepth = normalizeTraversalDepth(opts.depth);
    }
    if (opts.chunkMaxSize !== undefined || opts.chunkOverlap !== undefined) {
      const maxSize = opts.chunkMaxSize ?? this.chunkConfig.maxSize;
      const overlap = opts.chunkOverlap ?? this.chunkConfig.overlap;
      this.chunkConfig = normalizeChunkConfig(maxSize, overlap);
    }
  }

  // 전체 볼트 인덱싱
  // 인크리멘털 볼트 인덱싱 (변경/신규 파일만 처리, 삭제된 파일 정리)
    async indexVault(onProgress?: (current: number, total: number) => void): Promise<IndexResult> {
      if (this.indexing) {
        new Notice("인덱싱이 이미 진행 중입니다.");
        return { processed: 0, skipped: 0, errors: [] };
      }

      this.indexing = true;
      // 아래 본문은 try/finally로 감싸 어떤 예외에서도 indexing 플래그를 반드시 해제한다.
      // 플래그가 켜진 채로 남으면 이후 모든 증분 인덱싱(indexFile)이 대기열로만 흘러가
      // 세션 전체의 인덱스 갱신이 멈춘다.
      try {
        return await this.runIndexVault(onProgress);
      } finally {
        this.indexing = false;
      }
    }

    /** indexVault 본문. 플래그 관리는 호출자(indexVault)가 담당한다. */
    private async runIndexVault(
      onProgress?: (current: number, total: number) => void
    ): Promise<IndexResult> {
      const files = this.app.vault.getMarkdownFiles();

      // 삭제된 파일 인덱스에서 제거
      const currentPaths = new Set(files.map((f) => f.path));
      const removedPaths: string[] = [];
      for (const indexedPath of this.index.keys()) {
        if (!currentPaths.has(indexedPath)) {
          removedPaths.push(indexedPath);
        }
      }
      for (const p of removedPaths) {
        this.index.delete(p);
      }

      // 변경/신규 파일만 필터링
      const filesToIndex: TFile[] = [];
      const skippedUpToDate: TFile[] = [];
      for (const file of files) {
        const existing = this.index.get(file.path);
        // needsReindex 엔트리는 mtime과 무관하게 항상 갱신 대상이다(임베딩 미완료/무효).
        if (existing && !existing.needsReindex && existing.lastModified >= file.stat.mtime) {
          skippedUpToDate.push(file);
        } else {
          filesToIndex.push(file);
        }
      }

      const totalFiles = filesToIndex.length;
      let processed = 0;
      let skippedEmpty = 0;
      const failures: IndexFailure[] = [];
      // 진행률 단조 증가 보장을 위한 최대 보고값 추적
      let maxReportedProgress = 0;

      if (totalFiles === 0) {
        const msg = removedPaths.length > 0
          ? `인덱스 정리 완료: ${removedPaths.length}개 삭제됨, 변경 파일 없음`
          : "모든 파일이 최신 상태입니다.";
        new Notice(msg);
        return { processed: 0, skipped: skippedUpToDate.length, errors: [] };
      }

      new Notice(`인크리멘털 인덱싱: ${totalFiles}개 파일 (${skippedUpToDate.length}개 스킵)`);

      // 첫 파일로 임베딩 가능 여부 테스트 (인덱스가 비어있을 때만)
      if (!this.hasEmbeddings() || this.index.size === 0) {
        try {
          await this.client.getEmbedding("test");
          this.useEmbeddings = true;
        } catch (error) {
          console.error("임베딩 모델 사용 불가, 키워드 검색으로 전환:", error);
          this.useEmbeddings = false;
          new Notice("⚠️ 임베딩 모델 접근 불가 → 키워드 검색 모드로 인덱싱");
        }
      }

      for (const file of filesToIndex) {
        try {
          const content = await this.app.vault.cachedRead(file);
          if (!content.trim()) {
            // 비워진 노트의 기존 엔트리를 제거한다(이전 본문이 계속 검색되는 것을 방지).
            this.index.delete(file.path);
            skippedEmpty++;
            const currentProgress = processed + failures.length + skippedEmpty;
            maxReportedProgress = Math.max(maxReportedProgress, currentProgress);
            onProgress?.(maxReportedProgress, totalFiles);
            continue;
          }
          // indexFile 내부의 lastModified 체크를 우회하기 위해 직접 인덱싱
          await this.forceIndexFile(file);
          processed++;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          failures.push({ path: file.path, reason });
          console.error(`인덱싱 실패: ${file.path}`, error);
          // API 속도 제한 에러 시 잠시 대기 후 재시도
          if (this.useEmbeddings) {
            await sleep(1000);
            try {
              await this.forceIndexFile(file);
              failures.pop();
              processed++;
            } catch {
              // 재시도도 실패하면 넘어감
            }
          }
        }
        const currentProgress = processed + failures.length + skippedEmpty;
        maxReportedProgress = Math.max(maxReportedProgress, currentProgress);
        onProgress?.(maxReportedProgress, totalFiles);

        // 임베딩 사용 시 API 속도 제한 방지
        if (this.useEmbeddings) await sleep(200);
      }

      // 임베딩이 하나도 생성되지 않은 엔트리 수를 집계해 사용자에게 알린다.
      // buildEntry가 needsReindex를 세우므로 다음 인덱싱에서 자동 재시도되지만,
      // 조용히 넘어가면 사용자는 검색 누락을 알 수 없다.
      let incompleteCount = 0;
      for (const entry of this.index.values()) {
        if (entry.needsReindex) incompleteCount++;
      }

      // 인덱싱 완료 후에는 대기열 처리를 위해 플래그를 먼저 내려야 한다
      // (processPendingFiles가 indexFile을 호출하며, 플래그가 켜져 있으면 다시 큐잉된다).
      this.indexing = false;

      // 인덱싱 중 큐잉된 파일들을 순차 처리
      await this.processPendingFiles();

      let msg = `인덱싱 완료: ${processed}개 처리`;
      if (skippedUpToDate.length > 0) msg += `, ${skippedUpToDate.length}개 최신`;
      if (skippedEmpty > 0) msg += `, ${skippedEmpty}개 빈 파일`;
      if (removedPaths.length > 0) msg += `, ${removedPaths.length}개 삭제 정리`;
      if (failures.length > 0) msg += `, ${failures.length}개 실패`;
      if (incompleteCount > 0) msg += `, ${incompleteCount}개 임베딩 미완료(다음 인덱싱에서 재시도)`;
      new Notice(msg);

      return { processed, skipped: skippedUpToDate.length + skippedEmpty, errors: failures };
    }

    // lastModified 체크 없이 강제 인덱싱
    private async forceIndexFile(file: TFile): Promise<void> {
      // 본문을 읽기 전에 mtime을 캡처한다(임베딩 완료 후 읽으면 TOCTOU 발생).
      const readMtime = file.stat.mtime;
      const content = await this.app.vault.cachedRead(file);
      // 내용이 비워진 노트는 인덱스에서 제거한다. 그냥 반환하면 이전 본문과 임베딩이
      // 계속 검색되어, 사용자가 지운 내용이 LLM에 노출된다.
      if (!content.trim()) {
        this.index.delete(file.path);
        return;
      }
      // 청크 + 메타데이터를 포함한 Index_Entry를 생성하여 교체(재인덱싱 시 전체 교체, Req 1.4)
      const entry = await this.buildEntry(file, content, readMtime);
      // 임베딩 도중 삭제·이동됐으면 기록하지 않는다(삭제 노트 부활 방지).
      this.commitEntry(file.path, entry);
    }

    /**
     * 단일 노트의 Index_Entry를 생성한다(청크 + 링크/태그/프론트매터 메타데이터).
     *
     * 처리 흐름:
     * 1. 제목/발췌 추출 (기존 정책 유지)
     * 2. metadataSource가 있으면 extractMetadata로 outlinks/backlinks/tags/frontmatter 추출,
     *    없으면 빈 값으로 우아하게 저하 (Req 1.x, 2.x)
     * 3. stripFrontmatter로 프론트매터 제외 본문을 만든 뒤 splitIntoChunks로 분할 (Req 3.1, 3.3, 3.7)
     * 4. 각 청크에 대해 getEmbedding 호출. 단일 청크 실패는 격리하여 embedding=[],
     *    embedFailed=true로 기록하고 텍스트는 보존한다 (Req 3.6)
     * 5. searchText는 제목 + 본문 + 태그(단일 공백 구분)를 소문자로 결합 (Req 2.3)
     *
     * 빈/공백 본문은 호출자(indexVault/indexFile/forceIndexFile)에서 이미 스킵하므로
     * 여기서는 본문이 비어 있지 않다고 가정한다(빈 본문 청킹 계약은 Chunker 순수 함수에서 보장).
     *
     * 재인덱싱 시 호출자가 결과 Entry로 기존 Entry를 통째로 교체하므로,
     * 링크/태그/청크 목록은 항상 갱신 시점 상태와 일치하며 잔존 항목이 없다 (Req 1.4).
     */
    private async buildEntry(
      file: TFile,
      content: string,
      readMtime?: number
    ): Promise<VaultIndexEntry> {
      // 1) 제목: 본문 첫 H1 헤딩, 없으면 파일명
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : file.basename;

      // 2) 메타데이터 추출 (어댑터 미주입 시 빈 값으로 저하)
      const metadata: ExtractedMetadata = this.metadataSource
        ? extractMetadata(file.path, this.metadataSource)
        : { outlinks: [], backlinks: [], tags: [], frontmatter: {} };

      // 3) 프론트매터 제외 본문 추출 (어댑터 없으면 원문 전체를 본문으로 간주)
      const body = this.metadataSource
        ? stripFrontmatter(content, this.metadataSource, file.path)
        : content;

      // 발췌: 프론트매터를 제외한 본문 앞 500자.
      // 원문에서 자르면 YAML 블록이 발췌를 채워 LLM이 본문 내용을 보지 못한다.
      const excerpt = body.slice(0, EXCERPT_MAX_CHARS).trim();

      // 본문을 청크로 분할 (무손실 커버리지 보장, Req 3.7)
      const slices = splitIntoChunkSlices(body, this.chunkConfig);

      // 4) 청크별 임베딩 생성. 단일 청크 임베딩 실패는 격리한다 (Req 3.6)
      const chunks: IndexChunk[] = [];
      for (let i = 0; i < slices.length; i++) {
        const { text, charStart, heading } = slices[i];
        let embedding: number[] = [];
        let embedFailed = false;
        if (this.useEmbeddings) {
          try {
            embedding = await this.client.getEmbedding(text);
          } catch (error) {
            // 청크 임베딩 실패: 텍스트는 보존하고 실패 상태로 기록 후 계속 진행 (Req 3.6)
            embedding = [];
            embedFailed = true;
            console.error(
              `[VaultIndexer] 청크 임베딩 실패 (path=${file.path}, chunk=${i}):`,
              error
            );
          }
        }
        const chunk: IndexChunk = { index: i, text, embedding, charStart };
        // 헤딩이 없는 청크(문서 도입부)는 필드를 생략해 직렬화 크기를 늘리지 않는다.
        if (heading !== null) chunk.heading = heading;
        if (embedFailed) chunk.embedFailed = true;
        chunks.push(chunk);
      }

      // 레거시 노트 단위 임베딩: 첫 유효 청크 임베딩을 폴백용으로 보존 (하위 호환)
      const legacyEmbedding = chunks.find((c) => c.embedding.length > 0)?.embedding ?? [];

      // 5) 키워드 검색용 텍스트: 제목 + 본문 + 태그(단일 공백 구분) (Req 2.3)
      const tagText = metadata.tags.join(" ");
      const searchText = `${title}\n${content}${tagText ? `\n${tagText}` : ""}`.toLowerCase();

      // 벡터를 하나도 확보하지 못한 엔트리는 불완전하다. 그냥 두면 mtime 기반 스킵
      // 때문에 영구히 재시도되지 않으므로 needsReindex를 세워 다음 인덱싱에서 반드시
      // 재대상이 되게 한다.
      //
      // 임베딩 호출을 아예 하지 않은 경우(useEmbeddings=false)도 포함해야 한다.
      // 임베딩 모델 접근 불가·모델 변경 직후 편집된 노트가 "벡터 없음 + 최신 mtime"으로
      // 굳으면, 접근이 복구되거나 재인덱싱을 해도 이 노트만 영구히 벡터를 못 갖는다.
      const incomplete = legacyEmbedding.length === 0;

      // lastModified는 "본문을 읽은 시점"의 mtime을 사용한다. 임베딩 호출이 끝난 뒤
      // file.stat.mtime을 읽으면, 그 사이 사용자가 편집한 내용에 최신 도장을 찍어
      // 다음 편집까지 낡은 본문이 인덱스에 남는다(TOCTOU).
      const stamp = readMtime ?? file.stat.mtime;

      return {
        path: file.path,
        embedding: legacyEmbedding,
        lastModified: stamp,
        // 임베딩을 확보하지 못했으면 재인덱싱 대상으로 표시한다. lastModified는 실제
        // 수정 시각을 유지해야 하므로(최근 노트 선별 등이 이 값을 읽는다) 별도 플래그를 쓴다.
        ...(incomplete ? { needsReindex: true } : {}),
        title,
        excerpt,
        searchText,
        chunks,
        outlinks: metadata.outlinks,
        backlinks: metadata.backlinks,
        tags: metadata.tags,
        frontmatter: metadata.frontmatter,
      };
    }

  // 인덱싱 중 큐잉된 대기 파일들을 순차 처리
  private async processPendingFiles(): Promise<void> {
    if (this.pendingFiles.size === 0) return;

    const paths = Array.from(this.pendingFiles);
    this.pendingFiles.clear();

    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        try {
          await this.indexFile(file);
        } catch (error) {
          console.error(`대기열 파일 인덱싱 실패: ${path}`, error);
        }
      }
    }
  }

  // 단일 파일 인덱싱
  // 전체 인덱싱 중이면 대기열에 추가 후 즉시 리턴
  async indexFile(file: TFile): Promise<void> {
    if (this.indexing) {
      this.pendingFiles.add(file.path);
      return;
    }

    const existing = this.index.get(file.path);
    // needsReindex 엔트리는 mtime과 무관하게 항상 갱신 대상이다(임베딩 미완료/무효).
    if (existing && !existing.needsReindex && existing.lastModified >= file.stat.mtime) {
      return;
    }

    // 본문을 읽기 전에 mtime을 캡처한다(임베딩 완료 후 읽으면 TOCTOU 발생).
    const readMtime = file.stat.mtime;
    const content = await this.app.vault.cachedRead(file);
    // 내용이 비워진 노트는 인덱스에서 제거한다(이전 본문이 계속 검색되는 것을 방지).
    if (!content.trim()) {
      this.index.delete(file.path);
      return;
    }

    // 청크 + 메타데이터를 포함한 Index_Entry를 생성하여 교체(재인덱싱 시 전체 교체, Req 1.4)
    const entry = await this.buildEntry(file, content, readMtime);
    // 임베딩 도중 삭제·이동됐으면 기록하지 않는다(삭제 노트 부활 방지).
    this.commitEntry(file.path, entry);
  }

  /**
   * 파일 이름 변경/이동을 인덱스에 반영한다.
   * 구 경로 엔트리를 제거하고 새 경로를 인덱싱한다. 이 처리가 없으면 구 경로 엔트리가
   * 영구 잔존해 존재하지 않는 노트가 검색 결과에 나온다.
   */
  async renameFile(oldPath: string, file: TFile): Promise<void> {
    this.index.delete(oldPath);
    await this.indexFile(file);
  }

  removeFile(path: string): void {
    this.index.delete(path);
    // 진행 중인 인덱싱 작업이 완료 후 이 경로를 다시 써넣지 못하게 표시한다.
    // buildEntry(임베딩 호출 포함)는 수 초가 걸리므로, 그 사이 삭제·이동된 노트가
    // 완료 시점의 index.set으로 부활해 민감 내용이 검색에 남을 수 있다.
    this.removedDuringIndexing.add(path);
    // 대기열에 남은 예약도 취소한다(삭제된 파일을 다시 인덱싱할 이유가 없다).
    this.pendingFiles.delete(path);
  }

  /**
   * buildEntry 완료 후 인덱스에 기록한다. 작업 중 해당 경로가 삭제·이동됐으면
   * 기록을 취소해 삭제된 노트가 부활하지 않게 한다.
   */
  private commitEntry(path: string, entry: VaultIndexEntry): void {
    if (this.removedDuringIndexing.has(path)) {
      this.removedDuringIndexing.delete(path);
      return;
    }
    this.index.set(path, entry);
  }

  /**
   * 인덱싱된 모든 항목을 읽기 전용 스냅샷 배열로 반환한다 (Req 9.6).
   *
   * `emerge` 등 전체 인덱스 항목 열거가 필요한 능동 기능이 `search` 대신 사용한다.
   * 내부 `Map`을 직접 노출하지 않도록 `Array.from(values())`로 얕은 복사한 스냅샷을
   * 돌려주며, 기존 `search`/직렬화/인덱싱 동작에는 영향을 주지 않는다(무회귀).
   */
  getEntries(): VaultIndexEntry[] {
    return Array.from(this.index.values());
  }

  /**
   * Graph_RAG_Search 진입점 (task 8.4).
   *
   * 파이프라인:
   * 1. 입력 검증 — limit이 1~100 밖이면 오류 (Req 6.7), 빈/공백 쿼리는 빈 결과+무효 표시 (Req 4.7)
   * 2. 임베딩 0개 인덱스 → 키워드 검색 폴백 + 폴백 표시 (Req 4.6)
   * 3. Vector_Search — 쿼리 임베딩으로 시드 상위 10개 확보 (Req 4.5)
   * 4. Graph_Traversal — depth>=1이면 BFS 이웃 확장, depth=0이면 생략(시드만, Req 5.2)
   * 5. ScoreCombiner — 통합 점수 산출 및 재정렬 (Req 6.1~6.4, 6.8)
   * 6. limit 적용 — 통합 점수 상위 limit개 반환 (Req 6.5, 6.6)
   *
   * ⚠️ 반환 타입이 기존 search()에서 GraphRagResult로 변경됨(API 시그니처 변경).
   *    유일 호출처 obsidian-tools.ts는 task 9.1에서 동시 갱신된다.
   *
   * @param query 검색 쿼리
   * @param limit 결과 개수 상한 (기본 10, 1~100). 범위 밖이면 오류 throw (Req 6.7)
   */
  async search(query: string, limit = 10, filter: SearchFilter = {}): Promise<GraphRagResult> {
    // 1) limit 범위 검증 (Req 6.7) — 범위를 벗어나면 결과 없이 오류를 던진다
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new Error(`limit은 1 이상 100 이하여야 합니다 (입력값: ${limit}).`);
    }

    // 2) 빈/공백 쿼리 검증 (Req 4.7) — Vector_Search를 수행하지 않고 무효 표시와 함께 빈 결과 반환
    if (!query || query.trim() === "") {
      return { items: [], invalidQuery: true };
    }

    // 3) 인덱스가 비어 있으면 후보 0개 → 빈 결과 (Req 6.9)
    if (this.index.size === 0) {
      return { items: [] };
    }

    // 3-1) 필터 프리적용 — 시드·그래프 순회·키워드 폴백이 모두 같은 후보 집합을 쓴다.
    //      한 곳이라도 원본 인덱스를 보면 필터가 새어 조건 밖 노트가 이웃으로 들어온다.
    //      임베딩 비교 전에 줄이므로 결과 정확도와 속도를 함께 얻는다.
    const candidates = filterIndex(this.index, filter);
    const filteredOutCount = this.index.size - candidates.size;
    const filterInfo = isFilterEmpty(filter) ? {} : { filteredOutCount };

    if (candidates.size === 0) {
      return { items: [], ...filterInfo };
    }

    // 4) 임베딩이 인덱스에 하나도 없으면 키워드 검색으로 폴백 (Req 4.6)
    //    임베딩 구성 변경으로 벡터를 폐기한 경우도 이 경로를 타므로 stale 표시를 함께 전달한다.
    if (!this.useEmbeddings || !this.hasEmbeddings(candidates.values())) {
      const items = this.keywordSearch(query, limit, candidates);
      return {
        items,
        usedKeywordFallback: true,
        ...(this.staleIndex ? { staleEmbeddings: true } : {}),
        ...filterInfo,
      };
    }

    // 5) 쿼리 임베딩 생성 후 Vector_Search로 시드 확보 (Req 4.5)
    //    시드 수를 limit에 맞춰 확장한다. 과거에는 10으로 고정돼 limit 11~100이
    //    무의미했다(11위 이후는 그래프 이웃만 채울 수 있었다).
    const queryEmbedding = await this.client.getEmbedding(query);
    const entries = Array.from(candidates.values());
    const seedCount = Math.max(SEED_MIN_COUNT, Math.min(limit, entries.length));
    const diag = searchWithDiagnostics(queryEmbedding, entries, seedCount);
    const seeds: NoteVectorScore[] = diag.results;

    // 5-1) 임베딩 차원 불일치 감지 — 임베딩 모델이 바뀌면 기존 벡터는 비교 불가하다.
    //      비교 가능한 노트가 하나도 없으면 벡터 검색 결과가 무의미하므로 키워드 검색으로
    //      폴백하고, 사용자에게 재인덱싱이 필요함을 알린다.
    if (diag.comparableCount === 0 && diag.dimensionMismatchCount > 0) {
      const items = this.keywordSearch(query, limit, candidates);
      return { items, usedKeywordFallback: true, staleEmbeddings: true, ...filterInfo };
    }
    // 일부만 불일치하는 경우(재인덱싱 진행 중 등)는 비교 가능한 후보로 검색을 계속하되
    // 인덱스가 낡았음을 함께 보고한다.
    const staleEmbeddings = diag.dimensionMismatchCount > 0;

    // 시드가 없으면 후보 0개 → 빈 결과 (Req 6.9)
    if (seeds.length === 0) {
      return { items: [], ...(staleEmbeddings ? { staleEmbeddings } : {}), ...filterInfo };
    }

    // 6) Graph_Traversal — depth=0이면 순회를 생략하고 시드만 후보로 사용한다 (Req 5.1, 5.2)
    const neighbors =
      this.traversalDepth >= 1
        ? traverseGraph(seeds, candidates, this.traversalDepth, MAX_GRAPH_CANDIDATES)
        : [];

    // 6-1) 이웃 자신의 벡터 유사도를 계산해 결합 점수에 반영한다.
    //      이 값이 없으면 같은 시드에 연결된 무관한 이웃과 관련된 이웃이 동점이 된다.
    const neighborScores = new Map<string, number>();
    for (const neighbor of neighbors) {
      if (neighborScores.has(neighbor.path)) continue;
      const score = this.bestChunkSimilarity(queryEmbedding, neighbor.path);
      if (score !== null) neighborScores.set(neighbor.path, score);
    }

    // 7) ScoreCombiner — 통합 점수 산출 및 재정렬 (Req 6.1~6.4, 6.8)
    const combined = combineAndRank(seeds, neighbors, candidates, { neighborScores });

    // 7-1) 최소 관련성 임계값으로 후보가 전부 걸러진 경우 키워드 검색으로 폴백한다.
    //      인덱스는 정상인데 "검색 결과 없음"만 반환하면 사용자가 불필요한 재인덱싱을
    //      하게 되고, Second Brain 기능들(synthesize/reconcile/challenge/connect)이
    //      조용히 no-op이 된다. 임베딩 점수가 낮아도 키워드로는 찾을 수 있는 경우가 많다.
    if (combined.length === 0) {
      const items = this.keywordSearch(query, limit, candidates);
      return {
        items,
        usedKeywordFallback: true,
        ...(staleEmbeddings ? { staleEmbeddings } : {}),
        ...filterInfo,
      };
    }

    // 8) 어휘 검색과 순위 융합 (RRF).
    //
    //    dense 검색은 정확한 문자열에 약하다 — 에러 코드, 함수명, 버전 문자열, 사람
    //    이름처럼 "그 문자열이 그대로 들어 있는 노트 한 개"를 임베딩 유사도가 상위권
    //    밖으로 밀어내는 일이 흔하다. 어휘 검색은 그걸 정확히 잡는다.
    //
    //    과거에는 어휘 검색을 "임베딩이 아예 없을 때"의 폴백으로만 썼다. 즉 dense가
    //    아무것도 못 찾을 때만 쓰고, dense가 엉뚱한 것을 찾을 때는 쓰지 않았다.
    //    점수를 더하지 않고 순위만 섞는 이유는 rank-fusion.ts 주석에 있다.
    const lexical = this.keywordSearch(
      query,
      Math.max(LEXICAL_POOL_SIZE, limit),
      candidates
    );
    const fused = fuseRanks([
      { name: "dense", paths: combined.map((r) => r.path) },
      { name: "lexical", paths: lexical.map((r) => r.path), weight: LEXICAL_FUSION_WEIGHT },
    ]);

    // 8-1) 어휘 전용 상위 후보의 자리를 보장한다.
    //
    //      가중치를 곱한 어휘 1위(0.5/61)는 dense 10위(1/70)보다도 낮다. 두 목록에 다
    //      있는 노트는 합산되어 올라가지만, 어휘에만 있는 노트는 limit으로 자를 때 항상
    //      사라진다 — 하이브리드를 넣은 이유가 바로 그 경우다(자세한 산수는 reserveSlots).
    const densePaths = new Set(combined.map((r) => r.path));
    const lexicalOnly = lexical
      .filter((l) => !densePaths.has(l.path))
      .slice(0, LEXICAL_RESERVED_SLOTS)
      .map((l) => l.path);

    // 융합 순위로 항목을 재구성한다. dense 쪽 메타데이터(hop/isSeed/시드 정보)는
    // 있으면 그대로 살리고, 어휘로만 잡힌 노트는 시드로 취급한다(그래프 경로가 없다).
    const denseByPath = new Map(combined.map((r) => [r.path, r]));
    const lexicalByPath = new Map(lexical.map((r) => [r.path, r]));

    // RRF 점수는 절대값에 의미가 없으므로 최고점을 1.0으로 상대 정규화한다.
    // combinedScore는 화면과 LLM에 백분율로 표시되는 값이어서 0.016 같은 원점수를
    // 그대로 실으면 "관련도 1.6%"로 오해를 만든다. 키워드 폴백 경로도 같은 규칙이다.
    const maxFused = fused.length > 0 ? fused[0].score : 0;

    const fusedByPath = new Map(fused.map((f) => [f.path, f]));
    const finalPaths = reserveSlots(fused.map((f) => f.path), lexicalOnly, limit);

    const items: GraphRagSearchItem[] = finalPaths.map((path) => {
      const f = fusedByPath.get(path);
      const d = denseByPath.get(path);
      const l = lexicalByPath.get(path);
      const base = d ?? l;
      const score = f?.score ?? 0;
      return {
        path,
        title: base?.title ?? path,
        excerpt: base?.excerpt ?? "",
        combinedScore: maxFused > 0 ? score / maxFused : 0,
        vectorScore: d?.vectorScore ?? 0,
        hop: d?.hop ?? 0,
        isSeed: d?.isSeed ?? true,
        seedPath: d?.seedPath ?? null,
        // 이웃 결과는 연결된 시드의 제목을 인덱스에서 조회해 채운다 (Req 7.4)
        seedTitle: d?.seedPath ? candidates.get(d.seedPath)?.title ?? null : null,
        // 헤딩·적중 본문은 **임베딩으로 맞은 청크**에서 온다. dense가 못 찾아 어휘로만
        // 들어온 노트에는 붙이지 않는다 — 어휘가 맞힌 위치와 무관한 절을 "맞은 구간"이라고
        // 표시하면 인용 앵커가 엉뚱한 곳을 가리킨다.
        ...(d ? matchedFields(this.bestChunkMatch(queryEmbedding, path)) : { heading: null }),
      };
    });

    return {
      items,
      ...(staleEmbeddings ? { staleEmbeddings } : {}),
      ...filterInfo,
      ...(lexical.length > 0 ? { usedHybrid: true } : {}),
    };
  }

  /**
   * 한 노트의 청크 중 쿼리와 가장 유사한 값을 반환한다(비교 가능한 임베딩이 없으면 null).
   * 그래프 이웃의 관련성을 결합 점수에 반영하기 위해 사용한다.
   */
  private bestChunkSimilarity(queryEmbedding: number[], path: string): number | null {
    return this.bestChunkMatch(queryEmbedding, path)?.score ?? null;
  }

  /**
   * 질의와 가장 잘 맞는 청크의 유사도와 소속 헤딩을 함께 찾는다.
   *
   * 반환 대상은 limit개(최대 100)뿐이라 이 재계산은 인덱스 전체 스캔이 아니다 —
   * NoteVectorScore에 청크 인덱스를 추가해 검색 경로 전체를 바꾸는 것보다 좁은 변경이다.
   */
  private bestChunkMatch(
    queryEmbedding: number[],
    path: string
  ): { score: number; heading: string | null; text: string } | null {
    const entry = this.index.get(path);
    if (!entry) return null;

    let best: { score: number; heading: string | null; text: string } | null = null;
    for (const chunk of entry.chunks ?? []) {
      const sim = compareVectors(queryEmbedding, chunk.embedding);
      if (sim === null) continue;
      if (best === null || sim > best.score) {
        best = { score: sim, heading: chunk.heading ?? null, text: chunk.text };
      }
    }
    // 청크 임베딩이 없으면 레거시 노트 단위 임베딩으로 폴백한다(헤딩·본문 정보는 없다).
    if (best === null) {
      const legacy = compareVectors(queryEmbedding, entry.embedding);
      if (legacy !== null) best = { score: legacy, heading: null, text: "" };
    }
    return best;
  }

  // 키워드 검색 (임베딩이 0개일 때 폴백, Req 4.6)
  // 결과는 GraphRagSearchItem 형태로 반환하며, 모든 항목을 시드(hop 0)로 표시한다.
  // combinedScore는 최고 점수를 1.0으로 하는 상대 정규화 값으로 산출한다(0.0~1.0 보장, Req 7.2).
  private keywordSearch(
    query: string,
    limit: number,
    candidates: Map<string, VaultIndexEntry> = this.index
  ): GraphRagSearchItem[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored: Array<{ entry: VaultIndexEntry; score: number }> = [];

    for (const entry of candidates.values()) {
      const text = entry.searchText || `${entry.title}\n${entry.excerpt}`.toLowerCase();
      let score = 0;

      for (const term of terms) {
        // 제목 매치는 가중치 3배
        if (entry.title.toLowerCase().includes(term)) score += 3;
        // 본문 매치 횟수 (최대 10점)
        const matches = text.split(term).length - 1;
        score += Math.min(matches, 10);
      }

      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    // 점수 내림차순, 동점 시 경로 오름차순
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0;
    });

    // 0.0~1.0 정규화 기준값 (최고 점수)
    const maxScore = scored.length > 0 ? scored[0].score : 0;

    return scored.slice(0, limit).map(({ entry, score }) => ({
      path: entry.path,
      title: entry.title,
      excerpt: entry.excerpt,
      combinedScore: maxScore > 0 ? score / maxScore : 0,
      vectorScore: 0,
      hop: 0,
      isSeed: true,
      seedPath: null,
      seedTitle: null,
    }));
  }

  /**
   * 임베딩을 가진 엔트리가 하나라도 있는지.
   *
   * @param entries 검사 대상. 생략하면 인덱스 전체를 본다. 검색 경로는 **필터를 통과한
   *   후보**를 넘겨야 한다 — 인덱스 전체를 보면 "필터 결과가 전부 미색인 노트"인 경우
   *   임베딩이 있다고 판정하고 벡터 검색으로 들어가서, 비교 가능한 노트가 없어 빈 결과가
   *   나온다. 그 상황에서 필요한 건 키워드 폴백이다.
   */
  private hasEmbeddings(entries: Iterable<VaultIndexEntry> = this.index.values()): boolean {
    for (const entry of entries) {
      if (entry.embedding.length > 0) return true;
    }
    return false;
  }

  /**
   * 인덱스를 직렬화한다 (Req 8.1).
   *
   * `{ schemaVersion, entries }` 형태로 출력하며, entries의 각 항목은
   * buildEntry가 생성한 chunks/outlinks/backlinks/tags/frontmatter를 이미 포함한다.
   */
  serialize(): string {
    const payload: SerializedIndex = {
      schemaVersion: CURRENT_INDEX_SCHEMA_VERSION,
      entries: Array.from(this.index.values()),
    };
    // 임베딩 구성 시그니처와 차원을 함께 저장한다. 로드 시 현재 설정과 비교해
    // 임베딩 모델 변경(벡터 공간 변경)을 감지하기 위한 정보다.
    if (this.embeddingSignature !== null) {
      payload.embeddingSignature = this.embeddingSignature;
    }
    const dimension = this.detectIndexDimension();
    if (dimension !== null) {
      payload.embeddingDimension = dimension;
    }
    return JSON.stringify(payload);
  }

  /**
   * 현재 인덱스가 사용하는 임베딩 시그니처를 설정한다(main.ts가 설정에서 주입).
   * 저장 시 함께 기록되고, 로드 시 비교 대상이 된다.
   *
   * 런타임에 시그니처가 바뀌면(사용자가 설정에서 임베딩 모델·백엔드를 변경) 기존
   * 벡터는 즉시 무효가 된다. 차원이 같은 다른 모델이면 검색이 오류 없이 무의미한
   * 유사도를 계산하므로, 여기서 곧바로 벡터를 폐기해야 한다. 재시작을 기다리면
   * 그 사이 검색이 오염되고, 다음 저장이 새 시그니처로 기록되어 감지 기회도 사라진다.
   */
  setEmbeddingSignature(signature: string): void {
    const previous = this.embeddingSignature;
    this.embeddingSignature = signature;

    // 최초 주입(previous=null)이나 동일 값이면 아무것도 하지 않는다.
    if (previous === null || previous === signature) return;
    // 인덱스가 비어 있으면 폐기할 것이 없다.
    if (this.index.size === 0) return;

    this.invalidateEmbeddings(
      `임베딩 구성이 변경되었습니다 (이전=${previous}, 현재=${signature}). 재인덱싱이 필요합니다.`
    );
  }

  /**
   * 인덱스의 모든 임베딩 벡터를 폐기하고 재인덱싱 대상으로 표시한다.
   * 본문·메타데이터는 보존하므로 키워드 검색은 계속 동작한다.
   */
  private invalidateEmbeddings(reason: string): void {
    this.staleIndex = true;
    for (const entry of this.index.values()) {
      entry.embedding = [];
      for (const chunk of entry.chunks ?? []) {
        chunk.embedding = [];
        chunk.embedFailed = true;
      }
      // 재인덱싱 대상으로 표시한다. lastModified(실제 수정 시각)는 보존해야 하며,
      // 0으로 덮으면 최근 노트 선별(emerge) 등이 이 노트를 영구 과거로 취급한다.
      entry.needsReindex = true;
    }
    // 임베딩이 0개가 되었으므로 검색은 키워드 폴백으로 흐른다.
    this.useEmbeddings = false;
    console.error(reason);
  }

  /**
   * 로드한 인덱스의 임베딩 구성이 현재 설정과 다른지 여부.
   * true면 기존 벡터를 신뢰할 수 없어 재인덱싱이 필요하다.
   */
  get hasStaleEmbeddings(): boolean {
    return this.staleIndex;
  }

  /** 인덱스에서 관측되는 임베딩 차원(첫 유효 벡터 기준). 벡터가 없으면 null. */
  private detectIndexDimension(): number | null {
    for (const entry of this.index.values()) {
      for (const chunk of entry.chunks ?? []) {
        if (chunk.embedding && chunk.embedding.length > 0) return chunk.embedding.length;
      }
      if (entry.embedding && entry.embedding.length > 0) return entry.embedding.length;
    }
    return null;
  }

  /**
   * 로드한 인덱스의 임베딩 구성을 현재 설정과 비교해 무효 여부를 판정한다.
   *
   * 시그니처가 다르면 임베딩 모델(또는 백엔드)이 바뀐 것이므로 기존 벡터는 새 쿼리와
   * 비교할 수 없다. 이 경우 벡터를 모두 폐기해 검색이 키워드 폴백으로 흐르게 한다.
   * 벡터를 남겨 두면 차원이 같은 다른 모델일 때 무의미한 유사도가 계산된다.
   */
  private reconcileEmbeddingSignature(loaded: SerializedIndex): void {
    const current = this.embeddingSignature;
    // 현재 시그니처를 모르면(주입 전) 판정을 보류한다.
    if (current === null) return;

    const stored = loaded.embeddingSignature;
    // 구버전 인덱스는 시그니처가 없다. 차원 정보도 없으므로 판정하지 않고 그대로 쓴다
    // (검색 시점의 차원 비교가 최종 안전망이다).
    if (stored === undefined) return;

    if (stored === current) {
      this.staleIndex = false;
      return;
    }

    // 시그니처 불일치: 벡터를 폐기해 키워드 검색으로 폴백시키고 재인덱싱을 유도한다.
    this.invalidateEmbeddings(
      `인덱스 임베딩 구성이 변경되었습니다 (저장=${stored}, 현재=${current}). 재인덱싱이 필요합니다.`
    );
  }

  /**
   * 직렬화된 인덱스를 역직렬화하여 인메모리 인덱스를 갱신한다.
   *
   * 처리 규칙:
   * - 최상위가 배열(버전 없음)이면 레거시로 판단하여 마이그레이션한다.
   *   기존 필드 값은 보존하고, 누락된 chunks/outlinks/backlinks/tags는 빈 배열,
   *   frontmatter는 빈 객체로 초기화한다 (Req 8.2, 8.3, 8.4).
   * - `{ schemaVersion, entries }` 형태이면 그대로 로드하되, 누락된 optional 필드는
   *   방어적으로 빈 값으로 보정한다.
   * - JSON 파싱에 실패하면 오류를 로그에 기록만 하고, 기존 인메모리 인덱스를
   *   변경하거나 삭제하지 않는다(비파괴 보존, Req 8.5, 8.6).
   *
   * 파싱 실패 시 비파괴를 보장하기 위해 먼저 파싱을 수행하고, 파싱이 성공한 뒤에만
   * 기존 인덱스를 비우고 새 항목으로 채운다.
   */
  deserialize(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      // 파싱 실패: 오류 로그만 남기고 기존 인덱스를 그대로 보존한다 (Req 8.5, 8.6)
      console.error("인덱스 로드 실패: JSON 파싱 오류", error);
      return;
    }

    // 파싱 성공 이후에만 기존 인덱스를 교체한다 (Req 8.6)
    let entries: VaultIndexEntry[];
    if (Array.isArray(parsed)) {
      // 레거시(버전 없는 배열) 데이터 → 마이그레이션 (Req 8.2~8.4)
      entries = (parsed as VaultIndexEntry[]).map((entry) => this.migrateLegacyEntry(entry));
    } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as SerializedIndex).entries)) {
      // 버전 포함 객체 형태 → 그대로 로드 (누락 optional 필드는 방어적으로 보정)
      entries = (parsed as SerializedIndex).entries.map((entry) => this.normalizeEntry(entry));
    } else {
      // 예기치 못한 형태: 비파괴 보존 (Req 8.6)
      console.error("인덱스 로드 실패: 알 수 없는 직렬화 형식");
      return;
    }

    this.index.clear();
    for (const entry of entries) {
      this.index.set(entry.path, entry);
    }

    // 임베딩 구성 변경 감지: 시그니처가 다르면 기존 벡터를 폐기해 무의미한 유사도가
    // 계산되지 않게 하고, 재인덱싱 필요 상태를 기록한다.
    if (!Array.isArray(parsed)) {
      this.reconcileEmbeddingSignature(parsed as SerializedIndex);
    }

    this.useEmbeddings = this.hasEmbeddings();
  }

  /**
   * 레거시(버전 없는) Index_Entry를 현재 스키마로 마이그레이션한다 (Req 8.2~8.4).
   * 기존 필드 값은 보존하고, 누락된 그래프/청크 필드는 빈 값으로 초기화한다.
   */
  private migrateLegacyEntry(entry: VaultIndexEntry): VaultIndexEntry {
    return this.normalizeEntry(entry);
  }

  /**
   * Index_Entry의 누락된 optional 필드를 빈 값으로 보정한다.
   * 레거시 마이그레이션과 버전 포함 데이터 로드에서 공통으로 사용한다.
   */
  private normalizeEntry(entry: VaultIndexEntry): VaultIndexEntry {
    return {
      ...entry,
      chunks: entry.chunks ?? [],
      outlinks: entry.outlinks ?? [],
      backlinks: entry.backlinks ?? [],
      tags: entry.tags ?? [],
      frontmatter: entry.frontmatter ?? {},
    };
  }

  get size(): number {
    return this.index.size;
  }

  get isIndexing(): boolean {
    return this.indexing;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
