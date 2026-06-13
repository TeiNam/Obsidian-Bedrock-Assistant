// Graph RAG ScoreCombiner 속성 기반 테스트 (fast-check 기반)
// ====================================================
// 순수 함수 모듈 `score-combiner.ts`의 설계 Correctness Properties를 검증한다.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { combineAndRank, graphWeight } from "./score-combiner";
import type { NoteVectorScore } from "./vector-search";
import type { NeighborResult } from "./graph-traversal";
import type { VaultIndexEntry } from "../types";

describe("ScoreCombiner 속성 테스트", () => {
  // Feature: graph-rag-knowledge-base, Property 18: 통합 점수는 [0.0, 1.0]으로 정규화되며 그래프 가중치는 단조 감소한다
  // Validates: Requirements 6.1, 6.2

  // --- Part 1: 임의의 시드/이웃 후보 집합에 대해 모든 combinedScore 는 [0.0, 1.0] 이다 ---
  it("임의의 시드/이웃 후보 집합에 대해 모든 combinedScore 는 [0.0, 1.0] 범위 내에 있다", () => {
    // 시드 경로는 고유해야 하므로 (combineAndRank 내부 seedNorm 맵 기준) 고유 경로 풀에서 시드를 만든다.
    const candidateArb = fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 1,
        maxLength: 8,
      })
      .chain((seedPaths) => {
        // 각 시드: 경로 + 원시 코사인 점수(-1.0 ~ 1.0)
        const seedsArb = fc.tuple(
          ...seedPaths.map((path) =>
            fc
              .float({ noNaN: true, min: -1, max: 1 })
              .map((score): NoteVectorScore => ({ path, score }))
          )
        );

        // 이웃: 경로 + hop(1~3) + 기존 시드 중 하나를 참조하는 seedPath
        const neighborArb = fc.record({
          path: fc.string({ minLength: 1, maxLength: 12 }),
          hop: fc.integer({ min: 1, max: 3 }),
          seedPath: fc.constantFrom(...seedPaths),
        });
        const neighborsArb = fc.array(neighborArb, {
          minLength: 0,
          maxLength: 12,
        });

        // 인덱스 맵: 일부 경로에 대해서만 메타데이터를 제공(누락 경로도 허용)하여 조회 폴백 경로를 함께 검증한다.
        const indexEntryArb = (path: string): fc.Arbitrary<[string, VaultIndexEntry]> =>
          fc.record({
            title: fc.string({ maxLength: 20 }),
            excerpt: fc.string({ maxLength: 40 }),
          }).map(
            (meta): [string, VaultIndexEntry] => [
              path,
              {
                path,
                embedding: [],
                lastModified: 0,
                title: meta.title,
                excerpt: meta.excerpt,
              },
            ]
          );

        return fc.tuple(seedsArb, neighborsArb).chain(([seeds, neighbors]) => {
          const allPaths = Array.from(
            new Set([...seedPaths, ...neighbors.map((n) => n.path)])
          );
          const indexEntriesArb = fc.subarray(allPaths).chain((indexedPaths) =>
            indexedPaths.length === 0
              ? fc.constant([] as Array<[string, VaultIndexEntry]>)
              : fc.tuple(...indexedPaths.map(indexEntryArb))
          );
          return fc.tuple(
            fc.constant(seeds as NoteVectorScore[]),
            fc.constant(neighbors as NeighborResult[]),
            indexEntriesArb
          );
        });
      });

    fc.assert(
      fc.property(candidateArb, ([seeds, neighbors, indexEntries]) => {
        const index = new Map<string, VaultIndexEntry>(indexEntries);
        const results = combineAndRank(seeds, neighbors, index);

        for (const r of results) {
          expect(Number.isNaN(r.combinedScore)).toBe(false);
          expect(r.combinedScore).toBeGreaterThanOrEqual(0.0);
          expect(r.combinedScore).toBeLessThanOrEqual(1.0);
        }
      }),
      { numRuns: 100 }
    );
  });

  // --- Part 2: graphWeight 는 모든 hop >= 0 에서 (0.0, 1.0] 이며 hop 증가 시 단조 감소한다 ---
  it("graphWeight 는 모든 hop>=0 에서 (0.0, 1.0] 범위이고 hop 증가 시 단조 감소한다", () => {
    fc.assert(
      // maxHop 까지 0..maxHop 의 가중치를 한 번에 검증한다.
      fc.property(fc.integer({ min: 0, max: 30 }), (maxHop) => {
        let prev = Infinity;
        for (let hop = 0; hop <= maxHop; hop++) {
          const w = graphWeight(hop);

          // (0.0, 1.0] 범위 검증
          expect(Number.isNaN(w)).toBe(false);
          expect(w).toBeGreaterThan(0.0);
          expect(w).toBeLessThanOrEqual(1.0);

          // 단조 감소 검증: graphWeight(hop) < graphWeight(hop-1)
          if (hop > 0) {
            expect(w).toBeLessThan(prev);
          }
          prev = w;
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: graph-rag-knowledge-base, Property 19: Graph_RAG_Search 결과는 통합 점수 기준으로 완전 정렬된다
  // Validates: Requirements 6.3, 6.4
  it("combineAndRank 결과는 combinedScore 내림차순 → vectorScore 내림차순 → path 오름차순으로 완전 정렬된다", () => {
    // Property 18 과 동일한 generator 스타일을 재사용하여 시드/이웃/인덱스 후보 집합을 만든다.
    const candidateArb = fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 1,
        maxLength: 8,
      })
      .chain((seedPaths) => {
        // 각 시드: 경로 + 원시 코사인 점수(-1.0 ~ 1.0)
        const seedsArb = fc.tuple(
          ...seedPaths.map((path) =>
            fc
              .float({ noNaN: true, min: -1, max: 1 })
              .map((score): NoteVectorScore => ({ path, score }))
          )
        );

        // 이웃: 경로 + hop(1~3) + 기존 시드 중 하나를 참조하는 seedPath
        const neighborArb = fc.record({
          path: fc.string({ minLength: 1, maxLength: 12 }),
          hop: fc.integer({ min: 1, max: 3 }),
          seedPath: fc.constantFrom(...seedPaths),
        });
        const neighborsArb = fc.array(neighborArb, {
          minLength: 0,
          maxLength: 12,
        });

        // 인덱스 맵: 일부 경로에 대해서만 메타데이터를 제공(누락 경로도 허용)한다.
        const indexEntryArb = (path: string): fc.Arbitrary<[string, VaultIndexEntry]> =>
          fc.record({
            title: fc.string({ maxLength: 20 }),
            excerpt: fc.string({ maxLength: 40 }),
          }).map(
            (meta): [string, VaultIndexEntry] => [
              path,
              {
                path,
                embedding: [],
                lastModified: 0,
                title: meta.title,
                excerpt: meta.excerpt,
              },
            ]
          );

        return fc.tuple(seedsArb, neighborsArb).chain(([seeds, neighbors]) => {
          const allPaths = Array.from(
            new Set([...seedPaths, ...neighbors.map((n) => n.path)])
          );
          const indexEntriesArb = fc.subarray(allPaths).chain((indexedPaths) =>
            indexedPaths.length === 0
              ? fc.constant([] as Array<[string, VaultIndexEntry]>)
              : fc.tuple(...indexedPaths.map(indexEntryArb))
          );
          return fc.tuple(
            fc.constant(seeds as NoteVectorScore[]),
            fc.constant(neighbors as NeighborResult[]),
            indexEntriesArb
          );
        });
      });

    fc.assert(
      fc.property(candidateArb, ([seeds, neighbors, indexEntries]) => {
        const index = new Map<string, VaultIndexEntry>(indexEntries);
        const results = combineAndRank(seeds, neighbors, index);

        // 인접한 모든 결과 쌍 (i, i+1) 이 정렬 규칙을 만족하는지 검증한다.
        for (let i = 0; i + 1 < results.length; i++) {
          const cur = results[i];
          const next = results[i + 1];

          // 1순위: combinedScore 내림차순
          expect(cur.combinedScore).toBeGreaterThanOrEqual(next.combinedScore);

          // combinedScore 가 동일하면 2순위: vectorScore 내림차순
          if (cur.combinedScore === next.combinedScore) {
            expect(cur.vectorScore).toBeGreaterThanOrEqual(next.vectorScore);

            // vectorScore 까지 동일하면 3순위: path 오름차순
            if (cur.vectorScore === next.vectorScore) {
              expect(cur.path <= next.path).toBe(true);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: graph-rag-knowledge-base, Property 20: 동일 노트는 단일 결과로 병합되어 더 높은 점수를 적용한다
  // Validates: Requirements 6.8
  it("동일 노트가 시드/이웃 또는 여러 경로로 중복 등장하면 단일 결과로 병합되고 후보 중 최대 combinedScore 를 적용한다", () => {
    // Property 18/19 의 generator 스타일을 재사용하되, 이웃 경로를 시드 경로 풀에서도 뽑아
    // 동일 노트가 시드/이웃 양쪽에서 후보가 되는 "중복(overlap)" 케이스가 반드시 생성되도록 한다.
    const candidateArb = fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 1,
        maxLength: 8,
      })
      .chain((seedPaths) => {
        // 각 시드: 경로 + 원시 코사인 점수(-1.0 ~ 1.0)
        const seedsArb = fc.tuple(
          ...seedPaths.map((path) =>
            fc
              .float({ noNaN: true, min: -1, max: 1 })
              .map((score): NoteVectorScore => ({ path, score }))
          )
        );

        // 이웃 경로는 (a) 기존 시드 경로 풀 또는 (b) 새 경로 중에서 뽑아 중복을 강제로 유도한다.
        const neighborArb = fc.record({
          path: fc.oneof(
            fc.constantFrom(...seedPaths),
            fc.string({ minLength: 1, maxLength: 12 })
          ),
          hop: fc.integer({ min: 1, max: 3 }),
          seedPath: fc.constantFrom(...seedPaths),
        });
        // 중복 케이스를 자주 만들기 위해 이웃을 최소 1개 이상 생성한다.
        const neighborsArb = fc.array(neighborArb, {
          minLength: 1,
          maxLength: 12,
        });

        // 인덱스 맵: 일부 경로에 대해서만 메타데이터를 제공(누락 경로도 허용)한다.
        const indexEntryArb = (path: string): fc.Arbitrary<[string, VaultIndexEntry]> =>
          fc.record({
            title: fc.string({ maxLength: 20 }),
            excerpt: fc.string({ maxLength: 40 }),
          }).map(
            (meta): [string, VaultIndexEntry] => [
              path,
              {
                path,
                embedding: [],
                lastModified: 0,
                title: meta.title,
                excerpt: meta.excerpt,
              },
            ]
          );

        return fc.tuple(seedsArb, neighborsArb).chain(([seeds, neighbors]) => {
          const allPaths = Array.from(
            new Set([...seedPaths, ...neighbors.map((n) => n.path)])
          );
          const indexEntriesArb = fc.subarray(allPaths).chain((indexedPaths) =>
            indexedPaths.length === 0
              ? fc.constant([] as Array<[string, VaultIndexEntry]>)
              : fc.tuple(...indexedPaths.map(indexEntryArb))
          );
          return fc.tuple(
            fc.constant(seeds as NoteVectorScore[]),
            fc.constant(neighbors as NeighborResult[]),
            indexEntriesArb
          );
        });
      });

    fc.assert(
      fc.property(candidateArb, ([seeds, neighbors, indexEntries]) => {
        const index = new Map<string, VaultIndexEntry>(indexEntries);
        const results = combineAndRank(seeds, neighbors, index);

        // 구현과 동일한 벡터 정규화: vNorm = clamp((s+1)/2, 0, 1)
        const vNorm = (s: number): number => {
          const v = (s + 1) / 2;
          return v < 0 ? 0 : v > 1 ? 1 : v;
        };

        // 시드 경로 → 정규화 점수 맵 (이웃 점수 참조용)
        const seedNorm = new Map<string, number>();
        for (const seed of seeds) {
          seedNorm.set(seed.path, vNorm(seed.score));
        }

        // 경로별 모든 후보 combinedScore 를 독립적으로 재계산한다.
        // - 시드 occurrence:   vNorm(seed.score) * graphWeight(0)
        // - 이웃 occurrence:   vNorm(seedScoreOf(seedPath)) * graphWeight(hop)
        const candidateScores = new Map<string, number[]>();
        const addCandidate = (path: string, score: number): void => {
          const arr = candidateScores.get(path) ?? [];
          arr.push(score);
          candidateScores.set(path, arr);
        };
        for (const seed of seeds) {
          addCandidate(seed.path, vNorm(seed.score) * graphWeight(0));
        }
        for (const neighbor of neighbors) {
          const sv = seedNorm.get(neighbor.seedPath);
          // 참조 시드가 없으면 구현도 건너뛰므로 후보에서 제외한다.
          if (sv === undefined) continue;
          addCandidate(neighbor.path, sv * graphWeight(neighbor.hop));
        }

        // 경로별 결과 등장 횟수 집계
        const occurrences = new Map<string, number>();
        for (const r of results) {
          occurrences.set(r.path, (occurrences.get(r.path) ?? 0) + 1);
        }

        for (const r of results) {
          // 1) 동일 노트는 결과에 정확히 한 번만 등장한다 (병합).
          expect(occurrences.get(r.path)).toBe(1);

          // 2) combinedScore 는 해당 경로의 모든 후보 중 최대값과 같다.
          const cands = candidateScores.get(r.path);
          expect(cands).toBeDefined();
          const maxScore = Math.max(...(cands as number[]));
          expect(r.combinedScore).toBe(maxScore);
        }
      }),
      { numRuns: 100 }
    );
  });
});
