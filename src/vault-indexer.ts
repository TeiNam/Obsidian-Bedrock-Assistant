import { App, TFile, Notice } from "obsidian";
import type { IAiClient, VaultIndexEntry, IndexResult, IndexFailure, IndexChunk, SerializedIndex } from "./types";
import { CURRENT_INDEX_SCHEMA_VERSION } from "./types";
import { splitIntoChunks, normalizeChunkConfig, type ChunkConfig } from "./graph-rag/chunker";
import {
  extractMetadata,
  stripFrontmatter,
  type MetadataSource,
  type ExtractedMetadata,
} from "./graph-rag/graph-extractor";
import { vectorSearchByChunk, type NoteVectorScore } from "./graph-rag/vector-search";
import { traverseGraph, MAX_GRAPH_CANDIDATES, normalizeTraversalDepth } from "./graph-rag/graph-traversal";
import { combineAndRank } from "./graph-rag/score-combiner";

// === Graph_RAG_Search 결과 타입 (task 8.4) ===
// 기존 search()의 반환 타입 Array<{path,title,excerpt,score}>을 대체하는 신규 API 시그니처.
// 유일 호출처인 obsidian-tools.ts의 searchVault()는 task 9.1에서 함께 갱신된다.

/** Graph_RAG_Search 단일 결과 항목 (시드/이웃 구분 및 관계 정보 포함, Req 7.2~7.4). */
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
  /** 시드로부터의 그래프 거리(hop). 0이면 시드 (Req 7.4) */
  hop: number;
  /** 시드 여부 (hop 0) (Req 7.3) */
  isSeed: boolean;
  /** 이 결과를 도달시킨 시드 경로. 시드 자신은 null (Req 7.4) */
  seedPath: string | null;
  /** 연결된 시드의 제목. 이웃 결과의 표현용으로 인덱스 조회로 채운다 (Req 7.4) */
  seedTitle?: string | null;
}

/** Graph_RAG_Search 반환 결과. */
export interface GraphRagResult {
  /** 통합 점수 내림차순으로 정렬된 결과 목록 (limit 적용 후) */
  items: GraphRagSearchItem[];
  /** 빈/공백 쿼리로 인해 검색을 수행하지 않은 경우 true (Req 4.7) */
  invalidQuery?: boolean;
  /** 인덱스에 임베딩이 0개여서 키워드 검색으로 폴백한 경우 true (Req 4.6) */
  usedKeywordFallback?: boolean;
}

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
        if (existing && existing.lastModified >= file.stat.mtime) {
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
        this.indexing = false;
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

      this.indexing = false;

      // 인덱싱 중 큐잉된 파일들을 순차 처리
      await this.processPendingFiles();

      let msg = `인덱싱 완료: ${processed}개 처리`;
      if (skippedUpToDate.length > 0) msg += `, ${skippedUpToDate.length}개 최신`;
      if (skippedEmpty > 0) msg += `, ${skippedEmpty}개 빈 파일`;
      if (removedPaths.length > 0) msg += `, ${removedPaths.length}개 삭제 정리`;
      if (failures.length > 0) msg += `, ${failures.length}개 실패`;
      new Notice(msg);

      return { processed, skipped: skippedUpToDate.length + skippedEmpty, errors: failures };
    }

    // lastModified 체크 없이 강제 인덱싱
    private async forceIndexFile(file: TFile): Promise<void> {
      const content = await this.app.vault.cachedRead(file);
      if (!content.trim()) return;
      // 청크 + 메타데이터를 포함한 Index_Entry를 생성하여 교체(재인덱싱 시 전체 교체, Req 1.4)
      const entry = await this.buildEntry(file, content);
      this.index.set(file.path, entry);
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
    private async buildEntry(file: TFile, content: string): Promise<VaultIndexEntry> {
      // 1) 제목: 본문 첫 H1 헤딩, 없으면 파일명. 발췌: 앞 500자 (기존 정책 유지)
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : file.basename;
      const excerpt = content.slice(0, 500);

      // 2) 메타데이터 추출 (어댑터 미주입 시 빈 값으로 저하)
      const metadata: ExtractedMetadata = this.metadataSource
        ? extractMetadata(file.path, this.metadataSource)
        : { outlinks: [], backlinks: [], tags: [], frontmatter: {} };

      // 3) 프론트매터 제외 본문 추출 (어댑터 없으면 원문 전체를 본문으로 간주)
      const body = this.metadataSource
        ? stripFrontmatter(content, this.metadataSource, file.path)
        : content;

      // 본문을 청크로 분할 (무손실 커버리지 보장, Req 3.7)
      const chunkTexts = splitIntoChunks(body, this.chunkConfig);

      // 4) 청크별 임베딩 생성. 단일 청크 임베딩 실패는 격리한다 (Req 3.6)
      const chunks: IndexChunk[] = [];
      for (let i = 0; i < chunkTexts.length; i++) {
        const text = chunkTexts[i];
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
        const chunk: IndexChunk = { index: i, text, embedding };
        if (embedFailed) chunk.embedFailed = true;
        chunks.push(chunk);
      }

      // 레거시 노트 단위 임베딩: 첫 유효 청크 임베딩을 폴백용으로 보존 (하위 호환)
      const legacyEmbedding = chunks.find((c) => c.embedding.length > 0)?.embedding ?? [];

      // 5) 키워드 검색용 텍스트: 제목 + 본문 + 태그(단일 공백 구분) (Req 2.3)
      const tagText = metadata.tags.join(" ");
      const searchText = `${title}\n${content}${tagText ? `\n${tagText}` : ""}`.toLowerCase();

      return {
        path: file.path,
        embedding: legacyEmbedding,
        lastModified: file.stat.mtime,
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
    if (existing && existing.lastModified >= file.stat.mtime) {
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    if (!content.trim()) return;

    // 청크 + 메타데이터를 포함한 Index_Entry를 생성하여 교체(재인덱싱 시 전체 교체, Req 1.4)
    const entry = await this.buildEntry(file, content);
    this.index.set(file.path, entry);
  }

  removeFile(path: string): void {
    this.index.delete(path);
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
  async search(query: string, limit = 10): Promise<GraphRagResult> {
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

    // 4) 임베딩이 인덱스에 하나도 없으면 키워드 검색으로 폴백 (Req 4.6)
    if (!this.useEmbeddings || !this.hasEmbeddings()) {
      const items = this.keywordSearch(query, limit);
      return { items, usedKeywordFallback: true };
    }

    // 5) 쿼리 임베딩 생성 후 Vector_Search로 시드 상위 10개 확보 (Req 4.5)
    const queryEmbedding = await this.client.getEmbedding(query);
    const entries = Array.from(this.index.values());
    const seeds: NoteVectorScore[] = vectorSearchByChunk(queryEmbedding, entries, 10);

    // 시드가 없으면 후보 0개 → 빈 결과 (Req 6.9)
    if (seeds.length === 0) {
      return { items: [] };
    }

    // 6) Graph_Traversal — depth=0이면 순회를 생략하고 시드만 후보로 사용한다 (Req 5.1, 5.2)
    const neighbors =
      this.traversalDepth >= 1
        ? traverseGraph(seeds, this.index, this.traversalDepth, MAX_GRAPH_CANDIDATES)
        : [];

    // 7) ScoreCombiner — 통합 점수 산출 및 재정렬 (Req 6.1~6.4, 6.8)
    const combined = combineAndRank(seeds, neighbors, this.index);

    // 8) limit 적용 (Req 6.5) 후 GraphRagSearchItem으로 매핑
    const items: GraphRagSearchItem[] = combined.slice(0, limit).map((r) => ({
      path: r.path,
      title: r.title,
      excerpt: r.excerpt,
      combinedScore: r.combinedScore,
      vectorScore: r.vectorScore,
      hop: r.hop,
      isSeed: r.isSeed,
      seedPath: r.seedPath,
      // 이웃 결과는 연결된 시드의 제목을 인덱스에서 조회해 채운다 (Req 7.4)
      seedTitle: r.seedPath ? this.index.get(r.seedPath)?.title ?? null : null,
    }));

    return { items };
  }

  // 키워드 검색 (임베딩이 0개일 때 폴백, Req 4.6)
  // 결과는 GraphRagSearchItem 형태로 반환하며, 모든 항목을 시드(hop 0)로 표시한다.
  // combinedScore는 최고 점수를 1.0으로 하는 상대 정규화 값으로 산출한다(0.0~1.0 보장, Req 7.2).
  private keywordSearch(query: string, limit: number): GraphRagSearchItem[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored: Array<{ entry: VaultIndexEntry; score: number }> = [];

    for (const entry of this.index.values()) {
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

  private hasEmbeddings(): boolean {
    for (const entry of this.index.values()) {
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
    return JSON.stringify(payload);
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
