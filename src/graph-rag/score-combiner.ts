// Graph RAG 통합 점수 산출 및 재정렬 모듈 (ScoreCombiner)
// ============================================
// Vector_Search 점수와 그래프 거리(hop) 기반 가중치를 결합하여
// 0.0~1.0 으로 정규화된 통합 점수(combinedScore)를 산출하고,
// 시드(seed)/이웃(neighbor) 후보를 단일 결과 집합으로 병합·재정렬한다.
//
// 모든 함수는 외부 의존성이 없는 순수 함수이며(인덱스 조회 제외),
// fast-check 기반 속성 테스트가 가능하도록 분리되어 있다.
//
// 핵심 보장:
// - combinedScore ∈ [0.0, 1.0] (Req 6.1)
// - 그래프 가중치는 hop 증가마다 (0,1] 범위에서 단조 감소 (Req 6.2)
// - 정렬: combinedScore 내림차순 → vectorScore 내림차순 → path 오름차순 (Req 6.3, 6.4)
// - 동일 노트는 단일 결과로 병합하되 더 높은 통합 점수를 적용 (Req 6.8)

import type { VaultIndexEntry } from "../types";
import type { NoteVectorScore } from "./vector-search";
import type { NeighborResult } from "./graph-traversal";

/** 그래프 거리 가중치 감쇠 계수 (decay). hop 1 증가마다 가중치가 이 비율로 감소한다. */
const GRAPH_WEIGHT_DECAY = 0.5;

/** 통합 점수 산출 결과 항목. */
export interface CombinedResult {
  /** 노트의 볼트 루트 기준 경로 */
  path: string;
  /** 노트 제목 */
  title: string;
  /** 발췌(excerpt) */
  excerpt: string;
  /** 0.0~1.0 으로 정규화된 벡터 유사도 (vNorm) */
  vectorScore: number;
  /** 시드로부터의 그래프 거리. 0이면 시드(seed) */
  hop: number;
  /** 시드 여부 (hop 0) */
  isSeed: boolean;
  /** 이 결과를 도달시킨 시드 경로. 시드 자신은 null */
  seedPath: string | null;
  /** 0.0~1.0 으로 정규화된 통합 점수 */
  combinedScore: number;
}

/**
 * 그래프 거리(hop) 기반 가중치를 산출한다 (Req 6.2).
 *
 * 정의: w(hop) = decay^hop, decay ∈ (0,1] (기본 0.5)
 * - hop = 0 → 1.0 (시드는 그래프 감쇠 없음, 가중치 최대)
 * - hop 증가마다 단조 감소하며, 모든 hop 에 대해 (0.0, 1.0] 범위를 만족한다.
 *
 * 음수/비정수 hop 은 방어적으로 0 이상 정수로 보정한다(정상 입력은 0 이상 정수).
 */
export function graphWeight(hop: number): number {
  // 방어적 보정: 음수나 비정수가 들어와도 (0,1] 불변식을 깨지 않도록 0 이상 정수로 정규화한다.
  const safeHop = Math.max(0, Math.floor(Number.isFinite(hop) ? hop : 0));
  return Math.pow(GRAPH_WEIGHT_DECAY, safeHop);
}

/**
 * 벡터 유사도(-1.0~1.0)를 [0.0, 1.0] 범위로 정규화한다.
 * vNorm = (s + 1) / 2
 */
function normalizeVectorScore(score: number): number {
  const vNorm = (score + 1) / 2;
  // 부동소수 오차로 인한 경계 이탈을 방지하기 위해 [0,1] 로 클램프한다.
  if (vNorm < 0) return 0;
  if (vNorm > 1) return 1;
  return vNorm;
}

/**
 * 인덱스에서 노트 제목/발췌를 조회한다. 항목이 없으면 안전한 기본값을 사용한다.
 */
function lookupMeta(
  path: string,
  index: Map<string, VaultIndexEntry>
): { title: string; excerpt: string } {
  const entry = index.get(path);
  return {
    // 제목이 없으면 경로를 대체 제목으로 사용한다.
    title: entry?.title ?? path,
    excerpt: entry?.excerpt ?? "",
  };
}

/**
 * 시드와 그래프 이웃 후보를 결합하여 통합 점수를 산출하고 재정렬한다.
 *
 * 처리 순서:
 * 1. 시드(hop 0)를 통합 결과로 변환한다. vectorScore = vNorm=(s+1)/2,
 *    combinedScore = vNorm * graphWeight(0) = vNorm (Req 6.1, 6.8 기준선)
 * 2. 이웃은 자신을 도달시킨 시드의 정규화 점수(vNormOfSeed)를 사용하며,
 *    combinedScore = vNormOfSeed * graphWeight(hop) 로 산출한다 (Req 6.1, 6.2).
 * 3. 동일 노트가 시드/이웃 양쪽에서 후보가 되면 단일 결과로 병합하고,
 *    더 높은 combinedScore 를 가진 항목을 채택한다 (Req 6.8).
 * 4. combinedScore 내림차순 → vectorScore 내림차순 → path 오름차순으로 정렬한다 (Req 6.3, 6.4).
 *
 * @param seeds     Vector_Search 로 얻은 시드 결과 (score 는 -1.0~1.0 원시 코사인 유사도)
 * @param neighbors Graph_Traversal 로 수집된 이웃 (seedPath 로 시드 점수를 참조)
 * @param index     경로 → 인덱스 항목 맵 (제목/발췌 조회용)
 */
export function combineAndRank(
  seeds: NoteVectorScore[],
  neighbors: NeighborResult[],
  index: Map<string, VaultIndexEntry>
): CombinedResult[] {
  // 시드 경로 → 정규화 벡터 점수(vNorm) 맵. 이웃의 점수 참조에 사용한다.
  const seedNorm = new Map<string, number>();
  for (const seed of seeds) {
    seedNorm.set(seed.path, normalizeVectorScore(seed.score));
  }

  // 경로 → 통합 결과 맵. 동일 노트 병합 시 더 높은 combinedScore 를 유지한다 (Req 6.8).
  const merged = new Map<string, CombinedResult>();

  // 후보를 맵에 병합한다. 기존 항목보다 combinedScore 가 클 때만 교체한다.
  const upsert = (candidate: CombinedResult): void => {
    const existing = merged.get(candidate.path);
    if (existing === undefined || candidate.combinedScore > existing.combinedScore) {
      merged.set(candidate.path, candidate);
    }
  };

  // 1) 시드 처리: hop 0, isSeed=true, seedPath=null
  for (const seed of seeds) {
    const vNorm = seedNorm.get(seed.path) ?? normalizeVectorScore(seed.score);
    const meta = lookupMeta(seed.path, index);
    upsert({
      path: seed.path,
      title: meta.title,
      excerpt: meta.excerpt,
      vectorScore: vNorm,
      hop: 0,
      isSeed: true,
      seedPath: null,
      combinedScore: vNorm * graphWeight(0),
    });
  }

  // 2) 이웃 처리: 자신을 도달시킨 시드의 정규화 점수를 사용
  for (const neighbor of neighbors) {
    const vNormOfSeed = seedNorm.get(neighbor.seedPath);
    // 참조 시드가 없으면(이론상 발생하지 않음) 해당 이웃은 건너뛴다.
    if (vNormOfSeed === undefined) {
      continue;
    }
    const meta = lookupMeta(neighbor.path, index);
    upsert({
      path: neighbor.path,
      title: meta.title,
      excerpt: meta.excerpt,
      vectorScore: vNormOfSeed,
      hop: neighbor.hop,
      isSeed: false,
      seedPath: neighbor.seedPath,
      combinedScore: vNormOfSeed * graphWeight(neighbor.hop),
    });
  }

  // 3) 정렬: combinedScore 내림차순 → vectorScore 내림차순 → path 오름차순 (Req 6.3, 6.4)
  const results = Array.from(merged.values());
  results.sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) {
      return b.combinedScore - a.combinedScore;
    }
    if (b.vectorScore !== a.vectorScore) {
      return b.vectorScore - a.vectorScore;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  return results;
}
