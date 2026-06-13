// Graph RAG GraphTraversal 속성 기반 테스트 (fast-check 기반)
// ====================================================
// 순수 함수 모듈 `graph-traversal.ts`의 설계 Correctness Properties를 검증한다.
// 이 파일은 task 5.2~5.5가 공유한다(현재 파일에는 Property 14만 포함).

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  traverseGraph,
  normalizeTraversalDepth,
  MAX_GRAPH_CANDIDATES,
  type NeighborResult,
} from "./graph-traversal";
import type { NoteVectorScore } from "./vector-search";
import type { VaultIndexEntry } from "../types";

// 시드 정보(경로 + 벡터 점수)
interface SeedInput {
  path: string;
  score: number;
}

// 노드별 링크 정보 생성 결과
interface NodeLinks {
  outlinks: string[];
  backlinks: string[];
}

/**
 * 테스트용 독립 참조 BFS.
 * traverseGraph와 동일한 규칙(아웃링크 + 백링크를 모두 이웃으로 확장, depth 이내,
 * 인덱스에 존재하는 노트만 결과 포함, 시드는 결과에서 제외)으로 시드 집합에서의
 * 최단 hop 거리를 독립적으로 계산한다.
 * 구현(traverseGraph)이 아닌, 단순하고 명확한 멀티소스 BFS로 기대값을 산출하여 교차검증한다.
 */
function referenceShortestHops(
  seeds: SeedInput[],
  index: Map<string, VaultIndexEntry>,
  depth: number
): Map<string, number> {
  const indexPaths = new Set(index.keys());
  const seedPaths = new Set(seeds.map((s) => s.path));

  const dist = new Map<string, number>();
  const queue: string[] = [];

  // 모든 시드를 hop 0으로 초기화 (멀티소스 BFS)
  for (const s of seeds) {
    if (!dist.has(s.path)) {
      dist.set(s.path, 0);
      queue.push(s.path);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(cur)!;
    // depth에 도달한 노드는 더 이상 확장하지 않는다.
    if (d >= depth) continue;

    const entry = index.get(cur);
    if (!entry) continue;

    // 아웃링크 + 백링크를 모두 이웃 후보로 본다.
    const neighbors = [...(entry.outlinks ?? []), ...(entry.backlinks ?? [])];
    for (const nb of neighbors) {
      if (dist.has(nb)) continue; // BFS 최초 방문 = 최단 hop
      if (!indexPaths.has(nb)) continue; // Dangling_Link 제외
      dist.set(nb, d + 1);
      queue.push(nb);
    }
  }

  // 시드 자신은 이웃 결과에서 제외한다.
  const result = new Map<string, number>();
  for (const [p, h] of dist) {
    if (!seedPaths.has(p)) result.set(p, h);
  }
  return result;
}

describe("GraphTraversal 속성 테스트", () => {
  // Feature: graph-rag-knowledge-base, Property 14: 그래프 순회는 최단 hop을 기록하며 depth 이내로 제한된다
  // Validates: Requirements 5.1, 5.3, 5.4, 5.6
  it("임의의 그래프(사이클 포함)와 시드/깊이에 대해, 모든 이웃의 hop은 depth 이내이며 최단 hop(독립 BFS와 일치)을 기록하고 아웃링크/백링크를 모두 후보로 포함한다", () => {
    // 그래프 + 시드 + 깊이 생성기
    // - 노드 수 n(1~8)을 정하고 경로 note0.md..note{n-1}.md 를 만든다.
    // - 각 노드의 outlinks/backlinks는 노드 집합에서 임의로 선택하며,
    //   자기참조(self)와 사이클을 허용한다. 일부 Dangling_Link(missing-*.md)도 섞는다.
    // - 시드는 노드 집합의 부분집합(경로 중복 없음)이며 임의의 벡터 점수를 가진다.
    // - depth는 1~3.
    const graphArb = fc.integer({ min: 1, max: 8 }).chain((n) => {
      const paths = Array.from({ length: n }, (_, i) => `note${i}.md`);

      // 링크 대상: 실제 노드 경로 + 일부 Dangling_Link
      const linkTargetArb = fc.constantFrom(
        ...paths,
        "missing-a.md",
        "missing-b.md"
      );
      const linkArrArb = fc.array(linkTargetArb, { maxLength: n + 2 });
      const perNodeArb = fc.record<NodeLinks>({
        outlinks: linkArrArb,
        backlinks: linkArrArb,
      });

      // 시드: 경로 중복 없는 부분집합 + 임의 점수
      const seedArb = fc.uniqueArray(
        fc.record<SeedInput>({
          path: fc.constantFrom(...paths),
          score: fc.float({ noNaN: true, min: -1, max: 1 }),
        }),
        { minLength: 1, maxLength: n, selector: (s) => s.path }
      );

      return fc.record({
        paths: fc.constant(paths),
        nodeLinks: fc.array(perNodeArb, { minLength: n, maxLength: n }),
        seeds: seedArb,
        depth: fc.integer({ min: 1, max: 3 }),
      });
    });

    fc.assert(
      fc.property(graphArb, ({ paths, nodeLinks, seeds, depth }) => {
        // 인덱스 Map 구성 (Map<string, VaultIndexEntry>)
        const index = new Map<string, VaultIndexEntry>();
        paths.forEach((p, i) => {
          index.set(p, {
            path: p,
            embedding: [],
            lastModified: 0,
            title: p,
            excerpt: "",
            outlinks: nodeLinks[i].outlinks,
            backlinks: nodeLinks[i].backlinks,
          });
        });

        const seedScores: NoteVectorScore[] = seeds.map((s) => ({
          path: s.path,
          score: s.score,
        }));

        // 후보 상한이 이 속성 검증에 간섭하지 않도록 충분히 큰 값을 사용한다.
        const largeMax = Math.max(MAX_GRAPH_CANDIDATES, 100000);

        const result: NeighborResult[] = traverseGraph(
          seedScores,
          index,
          depth,
          largeMax
        );

        // 독립 BFS로 기대 최단 hop 산출
        const expected = referenceShortestHops(seeds, index, depth);
        const seedPathSet = new Set(seeds.map((s) => s.path));

        // 결과에 동일 경로가 중복되지 않아야 한다.
        const resultPaths = result.map((r) => r.path);
        expect(new Set(resultPaths).size).toBe(resultPaths.length);

        for (const r of result) {
          // (5.1) hop은 depth 이내로 제한된다.
          expect(r.hop).toBeGreaterThanOrEqual(1);
          expect(r.hop).toBeLessThanOrEqual(depth);

          // 결과 노트는 인덱스에 존재하며(5.10 Dangling 제외), 시드가 아니어야 한다.
          expect(index.has(r.path)).toBe(true);
          expect(seedPathSet.has(r.path)).toBe(false);

          // (5.4, 5.6) 기록된 hop은 독립 BFS의 최단 hop과 정확히 일치한다.
          expect(expected.has(r.path)).toBe(true);
          expect(r.hop).toBe(expected.get(r.path));
        }

        // (5.3) 아웃링크/백링크를 모두 후보로 포함한다 → 두 경로를 모두 사용하는
        //       독립 BFS의 도달 집합과 traverseGraph 결과 집합이 정확히 일치해야 한다.
        const resultSet = new Set(resultPaths);
        expect(resultSet.size).toBe(expected.size);
        for (const p of expected.keys()) {
          expect(resultSet.has(p)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("GraphTraversal 속성 테스트 - 종료성 및 재방문 방지", () => {
  // Feature: graph-rag-knowledge-base, Property 15: 그래프 순회는 방문 노드를 재방문하지 않으며 항상 종료한다
  // Validates: Requirements 5.5, 5.10
  it("사이클(자기참조 포함)을 가진 임의의 그래프에 대해, 순회는 유한 시간 내에 종료하며 결과에 중복 경로가 없고 모든 결과 경로는 인덱스에 존재한다(Dangling 제외)", () => {
    // 그래프 + 시드 + 깊이 생성기
    // - 노드 수 n(1~10)을 정하고 경로 node0.md..node{n-1}.md 를 만든다.
    // - 각 노드의 outlinks/backlinks는 노드 집합에서 임의 선택하며 자기참조와 사이클을 적극 허용한다.
    // - 일부 Dangling_Link(dangling-*.md, 인덱스에 없는 경로)를 섞어 5.10을 검증한다.
    // - 시드는 노드 집합의 부분집합(경로 중복 없음) + 임의 벡터 점수.
    // - depth는 1~3.
    const cyclicGraphArb = fc.integer({ min: 1, max: 10 }).chain((n) => {
      const paths = Array.from({ length: n }, (_, i) => `node${i}.md`);

      // 링크 대상: 실제 노드 경로(사이클/자기참조 유발) + 인덱스에 없는 Dangling_Link
      const linkTargetArb = fc.constantFrom(
        ...paths,
        "dangling-x.md",
        "dangling-y.md",
        "dangling-z.md"
      );
      const linkArrArb = fc.array(linkTargetArb, { maxLength: n + 3 });
      const perNodeArb = fc.record<NodeLinks>({
        outlinks: linkArrArb,
        backlinks: linkArrArb,
      });

      const seedArb = fc.uniqueArray(
        fc.record<SeedInput>({
          path: fc.constantFrom(...paths),
          score: fc.float({ noNaN: true, min: -1, max: 1 }),
        }),
        { minLength: 1, maxLength: n, selector: (s) => s.path }
      );

      return fc.record({
        paths: fc.constant(paths),
        nodeLinks: fc.array(perNodeArb, { minLength: n, maxLength: n }),
        seeds: seedArb,
        depth: fc.integer({ min: 1, max: 3 }),
      });
    });

    fc.assert(
      fc.property(cyclicGraphArb, ({ paths, nodeLinks, seeds, depth }) => {
        // 인덱스 구성 — Dangling 대상(dangling-*.md)은 의도적으로 인덱스에 넣지 않는다.
        const index = new Map<string, VaultIndexEntry>();
        paths.forEach((p, i) => {
          index.set(p, {
            path: p,
            embedding: [],
            lastModified: 0,
            title: p,
            excerpt: "",
            outlinks: nodeLinks[i].outlinks,
            backlinks: nodeLinks[i].backlinks,
          });
        });

        const seedScores: NoteVectorScore[] = seeds.map((s) => ({
          path: s.path,
          score: s.score,
        }));

        // 후보 상한이 종료성/재방문 검증에 간섭하지 않도록 충분히 큰 값을 사용한다.
        const largeMax = Math.max(MAX_GRAPH_CANDIDATES, 100000);

        // 이 호출이 반환된다는 사실 자체가 "항상 종료한다"(사이클에도 무한 루프 없음)를 입증한다.
        const result: NeighborResult[] = traverseGraph(
          seedScores,
          index,
          depth,
          largeMax
        );

        const seedPathSet = new Set(seeds.map((s) => s.path));

        // (5.5) 방문 노드를 재방문하지 않으므로 결과에 동일 경로가 중복되지 않아야 한다.
        const resultPaths = result.map((r) => r.path);
        expect(new Set(resultPaths).size).toBe(resultPaths.length);

        for (const r of result) {
          // (5.10) 모든 결과 경로는 인덱스에 존재해야 한다(Dangling_Link 제외).
          expect(index.has(r.path)).toBe(true);
          // 시드 자신은 이웃 결과에 포함되지 않는다.
          expect(seedPathSet.has(r.path)).toBe(false);
        }

        // (5.10) Dangling 경로는 어떤 경우에도 결과에 포함되지 않는다.
        const resultSet = new Set(resultPaths);
        expect(resultSet.has("dangling-x.md")).toBe(false);
        expect(resultSet.has("dangling-y.md")).toBe(false);
        expect(resultSet.has("dangling-z.md")).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // depth=0 입력 시 빈 이웃 목록 반환(순회 비활성) 단위 테스트
  // Validates: Requirements 5.2
  it("depth=0이면 그래프 순회가 비활성화되어 빈 이웃 목록을 반환한다", () => {
    // 사이클과 백링크를 포함한 인덱스를 구성하지만, depth=0이므로 확장이 일어나지 않아야 한다.
    const index = new Map<string, VaultIndexEntry>([
      [
        "a.md",
        {
          path: "a.md",
          embedding: [],
          lastModified: 0,
          title: "a.md",
          excerpt: "",
          outlinks: ["b.md"],
          backlinks: ["c.md"],
        },
      ],
      [
        "b.md",
        {
          path: "b.md",
          embedding: [],
          lastModified: 0,
          title: "b.md",
          excerpt: "",
          outlinks: ["a.md"],
          backlinks: [],
        },
      ],
      [
        "c.md",
        {
          path: "c.md",
          embedding: [],
          lastModified: 0,
          title: "c.md",
          excerpt: "",
          outlinks: ["a.md"],
          backlinks: [],
        },
      ],
    ]);

    const seeds: NoteVectorScore[] = [{ path: "a.md", score: 0.9 }];

    const result = traverseGraph(seeds, index, 0, MAX_GRAPH_CANDIDATES);

    expect(result).toEqual([]);
  });
});

describe("GraphTraversal 속성 테스트 - 후보 상한 적용", () => {
  // Feature: graph-rag-knowledge-base, Property 16: 후보 상한 적용은 가까운 hop을 우선 유지한다
  // Validates: Requirements 5.7, 5.8
  it("후보 수가 상한을 초과하면, 유지된 후보의 최대 hop은 제외된 후보의 최소 hop 이하이며, 경계 hop에서 동점은 시드 벡터 점수가 높은 후보가 우선 유지된다", () => {
    // 그래프 + 시드 + 깊이 생성기
    // - 상한 초과 상황을 자주 만들기 위해 비교적 조밀한 그래프(노드 1~12, 링크 다수)를 생성한다.
    // - 각 노드의 outlinks/backlinks는 노드 집합에서 임의 선택(사이클/자기참조 허용) + 일부 Dangling.
    // - 시드는 노드 집합의 부분집합(경로 중복 없음) + 임의 벡터 점수.
    // - depth는 1~3.
    // - capRatio(0~1)로 full 결과 길이에 비례한 작은 상한(maxCandidates)을 산출하여 capping을 강제한다.
    const cappedGraphArb = fc.integer({ min: 1, max: 12 }).chain((n) => {
      const paths = Array.from({ length: n }, (_, i) => `n${i}.md`);

      // 링크 대상: 실제 노드 경로 + 일부 Dangling_Link
      const linkTargetArb = fc.constantFrom(
        ...paths,
        "missing-1.md",
        "missing-2.md"
      );
      // 이웃을 충분히 만들기 위해 링크 배열을 비교적 길게 허용한다.
      const linkArrArb = fc.array(linkTargetArb, { maxLength: n + 4 });
      const perNodeArb = fc.record<NodeLinks>({
        outlinks: linkArrArb,
        backlinks: linkArrArb,
      });

      const seedArb = fc.uniqueArray(
        fc.record<SeedInput>({
          path: fc.constantFrom(...paths),
          // 동점/비동점 케이스를 모두 만들기 위해 좁은 정수 점수 격자를 사용한다.
          score: fc.integer({ min: 0, max: 5 }).map((v) => v / 5),
        }),
        { minLength: 1, maxLength: n, selector: (s) => s.path }
      );

      return fc.record({
        paths: fc.constant(paths),
        nodeLinks: fc.array(perNodeArb, { minLength: n, maxLength: n }),
        seeds: seedArb,
        depth: fc.integer({ min: 1, max: 3 }),
        capRatio: fc.float({ noNaN: true, min: 0, max: 1 }),
      });
    });

    fc.assert(
      fc.property(
        cappedGraphArb,
        ({ paths, nodeLinks, seeds, depth, capRatio }) => {
          const index = new Map<string, VaultIndexEntry>();
          paths.forEach((p, i) => {
            index.set(p, {
              path: p,
              embedding: [],
              lastModified: 0,
              title: p,
              excerpt: "",
              outlinks: nodeLinks[i].outlinks,
              backlinks: nodeLinks[i].backlinks,
            });
          });

          const seedScores: NoteVectorScore[] = seeds.map((s) => ({
            path: s.path,
            score: s.score,
          }));

          // 시드 경로 → 벡터 점수 매핑 (NeighborResult.seedPath로부터 점수를 역추적하기 위함).
          const seedScoreByPath = new Map<string, number>(
            seeds.map((s) => [s.path, s.score])
          );

          // 상한이 간섭하지 않는 전체 이웃 집합(full)을 먼저 구한다.
          const largeMax = Math.max(MAX_GRAPH_CANDIDATES, 100000);
          const full: NeighborResult[] = traverseGraph(
            seedScores,
            index,
            depth,
            largeMax
          );

          // 전체 후보가 없으면 capping 의미가 없으므로 통과시킨다.
          if (full.length === 0) {
            return;
          }

          // full 길이에 비례한 작은 상한을 산출하여 capping을 강제한다(0 ~ full.length-1).
          const cap = Math.min(
            full.length - 1,
            Math.floor(capRatio * full.length)
          );

          const kept: NeighborResult[] = traverseGraph(
            seedScores,
            index,
            depth,
            cap
          );

          // 유지된 후보 수는 정확히 상한과 같아야 한다(전체가 상한을 초과하므로).
          expect(kept.length).toBe(cap);

          // 제외 집합 = full - kept (경로 기준).
          const keptPathSet = new Set(kept.map((k) => k.path));
          const excluded = full.filter((r) => !keptPathSet.has(r.path));

          // kept ⊂ full 이어야 한다(상한은 정렬 후 prefix만 유지).
          for (const k of kept) {
            expect(full.some((r) => r.path === k.path)).toBe(true);
          }

          if (excluded.length === 0) {
            // cap === full.length 인 경우(여기선 발생하지 않지만 방어적으로 통과).
            return;
          }

          // (5.7) 유지된 후보의 최대 hop <= 제외된 후보의 최소 hop.
          const maxKeptHop = Math.max(...kept.map((k) => k.hop));
          const minExcludedHop = Math.min(...excluded.map((e) => e.hop));
          if (kept.length > 0) {
            expect(maxKeptHop).toBeLessThanOrEqual(minExcludedHop);
          }

          // (5.8) 경계 hop(유지된 후보의 최대 hop)에서의 동점 해소 검증:
          //       해당 hop에서 유지된 후보의 시드 벡터 점수(min)는
          //       제외된 후보의 시드 벡터 점수(max) 이상이어야 한다.
          if (kept.length > 0) {
            const boundaryHop = maxKeptHop;
            const keptAtBoundary = kept
              .filter((k) => k.hop === boundaryHop)
              .map((k) => seedScoreByPath.get(k.seedPath)!);
            const excludedAtBoundary = excluded
              .filter((e) => e.hop === boundaryHop)
              .map((e) => seedScoreByPath.get(e.seedPath)!);

            if (keptAtBoundary.length > 0 && excludedAtBoundary.length > 0) {
              const minKeptScore = Math.min(...keptAtBoundary);
              const maxExcludedScore = Math.max(...excludedAtBoundary);
              expect(minKeptScore).toBeGreaterThanOrEqual(maxExcludedScore);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("GraphTraversal 속성 테스트 - 탐색 깊이 보정", () => {
  // Feature: graph-rag-knowledge-base, Property 17: 탐색 깊이는 유효 정수 범위로 보정된다
  // Validates: Requirements 5.2, 5.9, 9.2, 9.4, 9.5
  it("임의의 유한 숫자(음수/큰 값/비정수 포함) 입력에 대해, normalizeTraversalDepth 결과는 항상 [0,3] 범위의 정수이며 가장 가까운 정수로 반올림된다", () => {
    // 유한 숫자 생성기 — 음수, 0~3 경계, 3 초과, 비정수(double)를 모두 포함하도록 넓은 범위를 사용한다.
    const finiteNumberArb = fc.oneof(
      // 정수 영역(음수 ~ 큰 값)
      fc.integer({ min: -1000, max: 1000 }),
      // 비정수(double) 영역 — 반올림 동작을 검증하기 위함
      fc.double({ noNaN: true, min: -1000, max: 1000 })
    );

    fc.assert(
      fc.property(finiteNumberArb, (n) => {
        const result = normalizeTraversalDepth(n);

        // (5.9, 9.2, 9.4, 9.5) 결과는 항상 정수여야 한다.
        expect(Number.isInteger(result)).toBe(true);

        // (5.9, 9.4, 9.5) 결과는 항상 0 이상 3 이하 범위로 클램프된다.
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(3);

        // 반올림 + 클램프 기대값과 정확히 일치해야 한다(음수→0, 3 초과→3, 비정수→반올림).
        const expected = Math.max(0, Math.min(3, Math.round(n)));
        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: graph-rag-knowledge-base, Property 17: 탐색 깊이는 유효 정수 범위로 보정된다
  // Validates: Requirements 5.2, 9.2, 9.4, 9.5
  it("NaN/Infinity 등 유효하지 않은 숫자 입력은 0으로 보정된다", () => {
    const invalidNumberArb = fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY
    );

    fc.assert(
      fc.property(invalidNumberArb, (n) => {
        const result = normalizeTraversalDepth(n);
        // 유효하지 않은 숫자는 0으로 보정되며, 이는 정수이고 범위 내에 있다.
        expect(result).toBe(0);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(3);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: graph-rag-knowledge-base, Property 17: 탐색 깊이는 유효 정수 범위로 보정된다
  // Validates: Requirements 5.2, 5.9
  it("보정된 깊이가 0이면(음수/0/NaN/Infinity 입력) 그래프 순회가 비활성화되어 빈 이웃 목록을 반환한다", () => {
    // 사이클과 백링크를 포함한 비어있지 않은 인덱스 — depth=0이면 확장이 일어나지 않아야 한다.
    const index = new Map<string, VaultIndexEntry>([
      [
        "a.md",
        {
          path: "a.md",
          embedding: [],
          lastModified: 0,
          title: "a.md",
          excerpt: "",
          outlinks: ["b.md"],
          backlinks: ["c.md"],
        },
      ],
      [
        "b.md",
        {
          path: "b.md",
          embedding: [],
          lastModified: 0,
          title: "b.md",
          excerpt: "",
          outlinks: ["a.md"],
          backlinks: [],
        },
      ],
      [
        "c.md",
        {
          path: "c.md",
          embedding: [],
          lastModified: 0,
          title: "c.md",
          excerpt: "",
          outlinks: ["a.md"],
          backlinks: [],
        },
      ],
    ]);

    const seeds: NoteVectorScore[] = [{ path: "a.md", score: 0.9 }];

    // 0으로 보정되는 입력 생성기: 음수, 0, NaN/Infinity, 0에 반올림되는 작은 비정수(예: 0.4).
    const zeroDepthInputArb = fc.oneof(
      fc.integer({ min: -1000, max: 0 }),
      fc.double({ noNaN: true, min: -1000, max: -0.5 }),
      fc.double({ noNaN: true, min: -0.49, max: 0.49 }),
      fc.constantFrom(
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY
      )
    );

    fc.assert(
      fc.property(zeroDepthInputArb, (n) => {
        const depth = normalizeTraversalDepth(n);
        // 이 생성기는 항상 0으로 보정되는 입력만 만든다(전제 검증).
        fc.pre(depth === 0);

        const result = traverseGraph(seeds, index, depth, MAX_GRAPH_CANDIDATES);

        // (5.2) 보정 깊이가 0이면 순회가 비활성화되어 빈 이웃 목록을 반환한다.
        expect(result).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});
