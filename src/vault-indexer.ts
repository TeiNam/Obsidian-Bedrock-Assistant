import { App, TFile, Notice } from "obsidian";
import type { BedrockClient } from "./bedrock-client";
import type { VaultIndexEntry, IndexResult, IndexFailure } from "./types";

// 볼트 인덱싱 및 검색
export class VaultIndexer {
  private app: App;
  private client: BedrockClient;
  private index: Map<string, VaultIndexEntry> = new Map();
  private indexing = false;
  private useEmbeddings = true;

  constructor(app: App, client: BedrockClient) {
    this.app = app;
    this.client = client;
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
          console.warn("임베딩 모델 사용 불가, 키워드 검색으로 전환:", error);
          this.useEmbeddings = false;
          new Notice("⚠️ 임베딩 모델 접근 불가 → 키워드 검색 모드로 인덱싱");
        }
      }

      for (const file of filesToIndex) {
        try {
          const content = await this.app.vault.cachedRead(file);
          if (!content.trim()) {
            skippedEmpty++;
            onProgress?.(processed + failures.length + skippedEmpty, totalFiles);
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
        onProgress?.(processed + failures.length + skippedEmpty, totalFiles);

        // 임베딩 사용 시 API 속도 제한 방지
        if (this.useEmbeddings) await sleep(200);
      }

      this.indexing = false;
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

      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : file.basename;
      const excerpt = content.slice(0, 500);

      let embedding: number[] = [];
      if (this.useEmbeddings) {
        const embeddingText = `${title}\n${content.slice(0, 5000)}`;
        embedding = await this.client.getEmbedding(embeddingText);
      }

      this.index.set(file.path, {
        path: file.path,
        embedding,
        lastModified: file.stat.mtime,
        title,
        excerpt,
        searchText: `${title}\n${content}`.toLowerCase(),
      });
    }

  // 단일 파일 인덱싱
  async indexFile(file: TFile): Promise<void> {
    const existing = this.index.get(file.path);
    if (existing && existing.lastModified >= file.stat.mtime) {
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    if (!content.trim()) return;

    // 제목 추출
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : file.basename;
    const excerpt = content.slice(0, 500);

    let embedding: number[] = [];
    if (this.useEmbeddings) {
      const embeddingText = `${title}\n${content.slice(0, 5000)}`;
      embedding = await this.client.getEmbedding(embeddingText);
    }

    this.index.set(file.path, {
      path: file.path,
      embedding,
      lastModified: file.stat.mtime,
      title,
      excerpt,
      // 키워드 검색용 전체 텍스트 (소문자)
      searchText: `${title}\n${content}`.toLowerCase(),
    });
  }

  removeFile(path: string): void {
    this.index.delete(path);
  }

  // 검색: 임베딩 가능하면 시맨틱, 아니면 키워드
  async search(query: string, topK = 5): Promise<Array<{ path: string; title: string; excerpt: string; score: number }>> {
    if (this.index.size === 0) return [];

    if (this.useEmbeddings && this.hasEmbeddings()) {
      return this.semanticSearch(query, topK);
    }
    return this.keywordSearch(query, topK);
  }

  // 시맨틱 검색 (임베딩 기반)
  private async semanticSearch(query: string, topK: number) {
    const queryEmbedding = await this.client.getEmbedding(query);
    const results: Array<{ path: string; title: string; excerpt: string; score: number }> = [];

    for (const entry of this.index.values()) {
      if (entry.embedding.length === 0) continue;
      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      results.push({ path: entry.path, title: entry.title, excerpt: entry.excerpt, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  // 키워드 검색 (임베딩 없을 때 폴백)
  private keywordSearch(query: string, topK: number) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: Array<{ path: string; title: string; excerpt: string; score: number }> = [];

    for (const entry of this.index.values()) {
      const text = entry.searchText || `${entry.title}\n${entry.excerpt}`.toLowerCase();
      let score = 0;

      for (const term of terms) {
        // 제목 매치는 가중치 3배
        if (entry.title.toLowerCase().includes(term)) score += 3;
        // 본문 매치 횟수
        const matches = text.split(term).length - 1;
        score += Math.min(matches, 10); // 최대 10점
      }

      if (score > 0) {
        results.push({ path: entry.path, title: entry.title, excerpt: entry.excerpt, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private hasEmbeddings(): boolean {
    for (const entry of this.index.values()) {
      if (entry.embedding.length > 0) return true;
    }
    return false;
  }

  serialize(): string {
    const entries = Array.from(this.index.values());
    return JSON.stringify(entries);
  }

  deserialize(data: string): void {
    try {
      const entries: VaultIndexEntry[] = JSON.parse(data);
      this.index.clear();
      for (const entry of entries) {
        this.index.set(entry.path, entry);
      }
      // 임베딩 유무 확인
      this.useEmbeddings = this.hasEmbeddings();
    } catch {
      console.error("인덱스 로드 실패");
    }
  }

  get size(): number {
    return this.index.size;
  }

  get isIndexing(): boolean {
    return this.indexing;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
