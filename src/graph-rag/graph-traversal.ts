// Graph RAG - 그래프 순회(Graph Traversal) 모듈
// 시드(Seed_Result) 집합에서 출발하여 아웃링크/백링크를 따라 BFS로 이웃 노트를 수집한다.
// 순수 함수 중심으로 구현하여 테스트 가능성을 높인다 (Req 5.1~5.10, 9.2, 9.4, 9.5).

import type { VaultIndexEntry } from "../types";
// NoteVectorScore는 vector-search.ts(task 4.1)에서 제공된다.
// 인터페이스 형태: { path: string; score: number; }
import type { NoteVectorScore } from "./vector-search";

/**
 * 그래프 순회로 수집한 이웃 노트 결과.
 */
export interface NeighborResult {
  /** 이웃 노트 경로 */
  path: string;
  /** 시드로부터의 최소 hop 거리 (Req 5.4, 5.6) */
  hop: number;
  /** 최소 hop을 제공한 시드의 경로 (Req 7.4) */
  seedPath: string;
}

/**
 * 그래프 이웃 후보 상한.
 * 수집한 이웃 수가 이 값을 초과하면 hop이 가까운 노트를 우선 유지한다 (Req 5.7).
 */
export const MAX_GRAPH_CANDIDATES = 50;

/**
 * BFS 큐 항목. seedScore는 후보 상한 적용 시 동점 해소(Req 5.8)에 사용하는 내부 필드이다.
 */
interface QueueItem {
  path: string;
  hop: number;
  seedPath: string;
  seedScore: number;
}

/**
 * 시드 집합에서 BFS로 그래프 이웃을 depth(hop)까지 수집한다.
 *
 * - depth === 0 (또는 1 미만)이면 빈 이웃 목록을 반환한다(순회 비활성, 시드만 사용) (Req 5.2)
 * - 각 노트의 아웃링크 + 백링크를 모두 이웃 후보로 포함한다 (Req 5.3)
 * - visited 집합으로 재방문을 막아 최소 hop이 자연히 보장된다 (Req 5.5, 5.6)
 * - 시드 자신은 이웃 결과에서 제외된다(초기 visited에 시드 경로 포함)
 * - 인덱스에 존재하지 않는 대상(Dangling_Link)은 결과에서 제외하고 순회는 계속한다 (Req 5.10)
 * - 수집한 이웃 수가 maxCandidates를 초과하면 hop 가까운 순으로 유지하고,
 *   동일 hop 동점 시 시드 벡터 점수가 높은 노트를 우선 유지한다 (Req 5.7, 5.8)
 *
 * @param seeds Vector_Search로 얻은 시드 결과 (경로 + 벡터 점수)
 * @param index 경로 → Index_Entry 맵 (그래프 인접 정보 및 dangling 판정에 사용)
 * @param depth 탐색 깊이(hop). 0이면 순회 비활성
 * @param maxCandidates 이웃 후보 상한
 */
export function traverseGraph(
  seeds: NoteVectorScore[],
  index: Map<string, VaultIndexEntry>,
  depth: number,
  maxCandidates: number
): NeighborResult[] {
  // depth가 1 미만이거나 유효하지 않으면 순회를 수행하지 않는다 (Req 5.2)
  if (!Number.isFinite(depth) || depth < 1) {
    return [];
  }

  // 시드 경로 집합 — 시드는 이웃 결과에서 제외하기 위해 visited에 미리 포함한다.
  const visited = new Set<string>(seeds.map((s) => s.path));

  // 동일 hop에서 여러 시드가 같은 이웃에 도달할 때, 벡터 점수가 높은 시드가
  // 먼저 해당 이웃을 차지하도록 시드를 점수 내림차순(동점 시 경로 오름차순)으로 정렬한다 (Req 5.8).
  const sortedSeeds = [...seeds].sort(
    (a, b) => b.score - a.score || comparePath(a.path, b.path)
  );

  // BFS 큐 — 모든 시드를 hop 0으로 초기 적재(다중 출발점 BFS)
  const queue: QueueItem[] = sortedSeeds.map((s) => ({
    path: s.path,
    hop: 0,
    seedPath: s.path,
    seedScore: s.score,
  }));

  // 수집한 이웃 (seedScore 포함 — 상한 적용 후 제거)
  const collected: Array<NeighborResult & { seedScore: number }> = [];

  // 큐를 head 포인터로 순회하여 FIFO BFS를 구현(레벨 순서 → 최소 hop 보장)
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];

    // 탐색 깊이에 도달한 노드는 더 이상 확장하지 않는다 (hop <= depth 보장)
    if (current.hop >= depth) {
      continue;
    }

    const entry = index.get(current.path);
    // 인덱스에 없는 노드는 인접 정보를 얻을 수 없으므로 확장하지 않는다.
    if (!entry) {
      continue;
    }

    // 아웃링크 + 백링크를 모두 이웃 후보로 포함한다 (Req 5.3)
    const neighbors = [...(entry.outlinks ?? []), ...(entry.backlinks ?? [])];
    const nextHop = current.hop + 1;

    for (const neighborPath of neighbors) {
      // 이미 방문한 노드(시드 포함)는 재방문하지 않는다 (Req 5.5).
      // BFS 특성상 최초 방문이 곧 최소 hop이다 (Req 5.6).
      if (visited.has(neighborPath)) {
        continue;
      }
      visited.add(neighborPath);

      // Dangling_Link(인덱스에 존재하지 않는 대상)는 결과에서 제외하고 계속 진행한다 (Req 5.10).
      if (!index.has(neighborPath)) {
        continue;
      }

      // 이웃 결과 기록 — hop과 최소 hop을 제공한 시드 경로를 함께 저장한다 (Req 5.4).
      collected.push({
        path: neighborPath,
        hop: nextHop,
        seedPath: current.seedPath,
        seedScore: current.seedScore,
      });

      // 탐색 깊이 이내인 경우에만 추가 확장을 위해 큐에 적재한다.
      if (nextHop < depth) {
        queue.push({
          path: neighborPath,
          hop: nextHop,
          seedPath: current.seedPath,
          seedScore: current.seedScore,
        });
      }
    }
  }

  // 후보 상한 적용 (Req 5.7, 5.8):
  // hop 오름차순(가까운 순) → 시드 벡터 점수 내림차순 → 경로 오름차순으로 정렬한 뒤 상한까지만 유지한다.
  collected.sort(
    (a, b) =>
      a.hop - b.hop ||
      b.seedScore - a.seedScore ||
      comparePath(a.path, b.path)
  );

  const cap = Number.isFinite(maxCandidates)
    ? Math.max(0, Math.floor(maxCandidates))
    : collected.length;

  // 내부 seedScore 필드를 제거하고 NeighborResult 형태로 반환한다.
  return collected.slice(0, cap).map(({ path, hop, seedPath }) => ({
    path,
    hop,
    seedPath,
  }));
}

/**
 * 탐색 깊이를 유효 범위(0 이상 3 이하 정수)로 보정한다 (Req 5.9, 9.2, 9.4, 9.5).
 * - 0 미만 → 0
 * - 3 초과 → 3
 * - 비정수 → 가장 가까운 정수로 반올림
 * - 숫자가 아니거나 NaN/Infinity → 0
 *
 * 내부 순회와 설정 보정에서 공통으로 사용한다.
 */
export function normalizeTraversalDepth(n: number): number {
  // 유효하지 않은 숫자(NaN, Infinity 등)는 0으로 보정한다.
  if (!Number.isFinite(n)) {
    return 0;
  }
  // 반올림 후 0~3 범위로 클램프한다. Math.max로 -0을 0으로 정규화한다.
  return Math.max(0, Math.min(3, Math.round(n)));
}

/**
 * 경로 사전순 비교 헬퍼.
 */
function comparePath(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
