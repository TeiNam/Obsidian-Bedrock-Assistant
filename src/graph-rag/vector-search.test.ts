// Graph RAG VectorSearch 속성 기반 테스트 (fast-check 기반)
// ====================================================
// 순수 함수 모듈 `vector-search.ts`의 설계 Correctness Properties를 검증한다.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { cosineSimilarity, vectorSearchByChunk } from "./vector-search";
import type { VaultIndexEntry, IndexChunk } from "../types";

describe("VectorSearch 속성 테스트", () => {
  // Feature: graph-rag-knowledge-base, Property 10: 코사인 유사도는 [-1.0, 1.0] 범위 내에 있다
  // Validates: Requirements 4.1
  it("동일 차원의 임의 두 벡터(영벡터 포함)에 대해 코사인 유사도는 [-1.0, 1.0] 범위 내에 있다", () => {
    // 유한 부동소수점 성분으로 구성된, 길이 n의 두 벡터를 생성한다.
    // n=0(빈 벡터)부터 시작하며, 모든 성분이 0인 영벡터도 입력 공간에 포함된다.
    const sameDimVectorsArb = fc
      .integer({ min: 0, max: 64 })
      .chain((n) => {
        const componentArb = fc.float({ noNaN: true, min: -1e6, max: 1e6 });
        return fc.tuple(
          fc.array(componentArb, { minLength: n, maxLength: n }),
          fc.array(componentArb, { minLength: n, maxLength: n })
        );
      });

    fc.assert(
      fc.property(sameDimVectorsArb, ([a, b]) => {
        const sim = cosineSimilarity(a, b);
        expect(Number.isNaN(sim)).toBe(false);
        expect(sim).toBeGreaterThanOrEqual(-1.0);
        expect(sim).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: graph-rag-knowledge-base, Property 11: 노트 벡터 점수는 청크 유사도의 최대값이며 노트당 단일 결과이다
  // Validates: Requirements 4.2, 4.3
  it("각 노트의 점수는 그 노트의 청크 유사도 최대값과 같고, 결과에는 중복 경로가 없다", () => {
    // 고정된 작은 차원 D (3~8) 하에서 쿼리 임베딩 1개와
    // 여러 청크 임베딩(일부는 빈 배열 [])을 가진 노트 집합을 생성한다.
    const arb = fc.integer({ min: 3, max: 8 }).chain((dim) => {
      const componentArb = fc.float({ noNaN: true, min: -1e3, max: 1e3 });
      const vectorArb = fc.array(componentArb, {
        minLength: dim,
        maxLength: dim,
      });
      // 각 청크 임베딩은 차원 D의 벡터이거나, 빈 배열([], 임베딩 미생성)일 수 있다.
      const chunkEmbeddingArb = fc.oneof(
        vectorArb,
        fc.constant<number[]>([])
      );
      // 한 노트는 여러 개(0~5)의 청크 임베딩을 가진다.
      const noteChunksArb = fc.array(chunkEmbeddingArb, {
        minLength: 0,
        maxLength: 5,
      });
      // 노트 집합 (1~6개)
      const notesArb = fc.array(noteChunksArb, { minLength: 1, maxLength: 6 });
      return fc.tuple(vectorArb, notesArb);
    });

    fc.assert(
      fc.property(arb, ([query, notes]) => {
        // 고유 경로를 부여하여 VaultIndexEntry 객체 구성.
        // 레거시 노트 단위 임베딩(embedding)은 빈 배열로 두어 청크 점수만 검증되도록 한다.
        const entries: VaultIndexEntry[] = notes.map((chunkEmbeddings, i) => {
          const chunks: IndexChunk[] = chunkEmbeddings.map((embedding, ci) => ({
            index: ci,
            text: `note-${i}-chunk-${ci}`,
            embedding,
          }));
          return {
            path: `note-${i}.md`,
            embedding: [],
            lastModified: 0,
            title: `note-${i}`,
            excerpt: "",
            chunks,
          };
        });

        // topK는 노트 수 이상으로 설정하여 매칭 노트 전체가 반환되도록 한다.
        const topK = entries.length;
        const results = vectorSearchByChunk(query, entries, topK);

        // 각 노트에 대해 사용 가능한 청크 임베딩의 최대 유사도를 독립적으로 계산한다.
        const expectedByPath = new Map<string, number | null>();
        for (const entry of entries) {
          let best: number | null = null;
          for (const chunk of entry.chunks ?? []) {
            if (!chunk.embedding || chunk.embedding.length === 0) continue;
            const sim = cosineSimilarity(query, chunk.embedding);
            if (best === null || sim > best) best = sim;
          }
          expectedByPath.set(entry.path, best);
        }

        // 결과에는 중복 경로가 없어야 한다 (노트당 단일 결과, Req 4.3).
        const seenPaths = new Set<string>();
        for (const r of results) {
          expect(seenPaths.has(r.path)).toBe(false);
          seenPaths.add(r.path);
        }

        // 결과의 각 점수는 해당 노트의 청크 유사도 최대값과 일치해야 한다 (Req 4.2).
        for (const r of results) {
          const expected = expectedByPath.get(r.path);
          expect(expected).not.toBeNull();
          expect(r.score).toBe(expected);
        }

        // 사용 가능한 임베딩이 하나라도 있는 노트는 모두 결과에 정확히 한 번 포함된다.
        const expectedScorablePaths = entries
          .filter((e) => expectedByPath.get(e.path) !== null)
          .map((e) => e.path);
        expect(seenPaths.size).toBe(expectedScorablePaths.length);
        for (const p of expectedScorablePaths) {
          expect(seenPaths.has(p)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: graph-rag-knowledge-base, Property 12: Vector_Search 결과는 정렬되고 상위 10개로 제한된다
  // Validates: Requirements 4.4, 4.5
  it("결과는 (점수 내림차순, 동점 시 경로 오름차순)으로 정렬되고 상위 10개로 제한된다", () => {
    const TOP_K = 10;

    // 고정 차원 D(3~8) 하에서, 동점 점수를 자주 유발하도록
    // 소수의 후보 임베딩 풀에서 청크 임베딩을 추출한다.
    const arb = fc.integer({ min: 3, max: 8 }).chain((dim) => {
      const componentArb = fc.float({ noNaN: true, min: -1e3, max: 1e3 });
      const vectorArb = fc.array(componentArb, {
        minLength: dim,
        maxLength: dim,
      });
      // 쿼리 벡터와, 4~6개로 구성된 임베딩 후보 풀을 생성한다.
      // 풀에서 중복 선택되면 점수 동점이 발생하여 경로 오름차순 타이브레이크를 검증할 수 있다.
      const poolArb = fc.array(vectorArb, { minLength: 4, maxLength: 6 });
      return fc.tuple(vectorArb, poolArb).chain(([query, pool]) => {
        // 청크 임베딩: 풀에서 선택하거나, 빈 배열([], 사용 불가)일 수 있다.
        const chunkEmbeddingArb = fc.oneof(
          fc.constantFrom(...pool),
          fc.constant<number[]>([])
        );
        const noteChunksArb = fc.array(chunkEmbeddingArb, {
          minLength: 0,
          maxLength: 4,
        });
        // 상위 10개 제한을 자주 초과하도록 노트 수를 5~20개로 생성한다.
        const notesArb = fc.array(noteChunksArb, {
          minLength: 5,
          maxLength: 20,
        });
        return fc.tuple(fc.constant(query), notesArb);
      });
    });

    fc.assert(
      fc.property(arb, ([query, notes]) => {
        // 경로 오름차순 타이브레이크를 제대로 검증하기 위해,
        // 생성 순서와 사전순 정렬이 일치하지 않도록 0 패딩 없는 인덱스로 경로를 부여한다.
        const entries: VaultIndexEntry[] = notes.map((chunkEmbeddings, i) => {
          const chunks: IndexChunk[] = chunkEmbeddings.map((embedding, ci) => ({
            index: ci,
            text: `note-${i}-chunk-${ci}`,
            embedding,
          }));
          return {
            path: `note-${i}.md`,
            embedding: [],
            lastModified: 0,
            title: `note-${i}`,
            excerpt: "",
            chunks,
          };
        });

        const results = vectorSearchByChunk(query, entries, TOP_K);

        // 인접 쌍 정렬 검증: 점수 내림차순, 동점 시 경로 오름차순 (Req 4.4)
        for (let i = 0; i + 1 < results.length; i++) {
          const cur = results[i];
          const next = results[i + 1];
          expect(cur.score).toBeGreaterThanOrEqual(next.score);
          if (cur.score === next.score) {
            expect(cur.path <= next.path).toBe(true);
          }
        }

        // 사용 가능한 임베딩이 하나라도 있는 노트 수 산출
        const scorableCount = entries.filter((entry) =>
          (entry.chunks ?? []).some(
            (chunk) => chunk.embedding && chunk.embedding.length > 0
          )
        ).length;

        // 결과 개수 = min(점수 산출 가능한 노트 수, 10) (Req 4.5)
        expect(results.length).toBe(Math.min(scorableCount, TOP_K));
      }),
      { numRuns: 100 }
    );
  });
});
