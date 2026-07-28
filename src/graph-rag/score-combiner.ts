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

/**
 * 이웃 점수 산출 시 "이웃 자신의 벡터 유사도"에 부여하는 비중.
 *
 * 기존 구현은 이웃 점수를 `vNormOfSeed × decay^hop`으로만 계산해 두 가지 문제가 있었다.
 *  1) 이웃 자신의 관련성이 전혀 반영되지 않아, 같은 시드에 연결된 무관한 노트와
 *     매우 관련된 노트가 동점이 된다.
 *  2) 시드 점수 하한(코사인 비음수 → 0.5)이 hop 1 이웃 상한(0.5)과 겹쳐,
 *     기본 limit에서 그래프 순회 결과가 사실상 노출되지 않는다.
 *
 * 이웃 자신의 유사도를 알 수 있으면 시드 유사도와 가중 평균하여 위 두 문제를 함께 완화한다.
 * 이웃 유사도를 알 수 없는 경우(임베딩 없음/차원 불일치)에는 기존 방식으로 저하된다.
 */
const NEIGHBOR_SELF_WEIGHT = 0.6;

/**
 * 후보로 인정하는 최소 **관련성**(hop 감쇠 적용 전) 점수.
 *
 * 정규화가 `(cos+1)/2`이므로 코사인 0(직교=무관)이 0.5로 매핑된다. 임계값이 없으면
 * 무관한 노트도 "50% 관련"으로 표시되어 LLM이 근거로 사용한다. 코사인 기준 약 0.1
 * 이상만 통과시켜(=정규화 0.55) 명백히 무관한 후보를 제외한다.
 *
 * ⚠️ 이 임계값은 **감쇠 전 관련성**에 적용한다. 감쇠 후 combinedScore에 적용하면
 * hop 1 이웃의 이론적 최대값(1.0 × 0.5 = 0.5)이 임계값보다 낮아 모든 그래프 이웃이
 * 제거되고 Graph RAG가 순수 벡터 검색으로 퇴화한다. 관련성 자체는 "이 노트가 쿼리와
 * 얼마나 가까운가"이고 감쇠는 "시드에서 얼마나 멀리 있는가"라 서로 다른 축이므로,
 * 무관함을 걸러내는 판정은 감쇠 전 값으로 해야 한다.
 */
export const MIN_COMBINED_SCORE = 0.55;

/** combineAndRank 선택 옵션. */
export interface CombineOptions {
  /**
   * 이웃 경로 → 이웃 자신의 원시 코사인 유사도(-1~1).
   * 제공하면 이웃 점수에 자신의 관련성이 반영된다. 생략하면 시드 점수만 사용한다.
   */
  neighborScores?: ReadonlyMap<string, number> | Iterable<[string, number]>;
  /** 후보 최소 통합 점수. 기본 MIN_COMBINED_SCORE. 0 이하면 필터 비활성. */
  minScore?: number;
}

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
  index: Map<string, VaultIndexEntry>,
  options: CombineOptions = {}
): CombinedResult[] {
  // 이웃 자신의 벡터 점수 조회 맵(있으면 관련성 반영에 사용).
  const neighborSelfNorm = new Map<string, number>();
  for (const [path, score] of options.neighborScores ?? []) {
    neighborSelfNorm.set(path, normalizeVectorScore(score));
  }
  const minScore = options.minScore ?? MIN_COMBINED_SCORE;

  // 시드 경로 → 정규화 벡터 점수(vNorm) 맵. 이웃의 점수 참조에 사용한다.
  const seedNorm = new Map<string, number>();
  for (const seed of seeds) {
    seedNorm.set(seed.path, normalizeVectorScore(seed.score));
  }

  // 경로 → 통합 결과 맵. 동일 노트 병합 시 더 높은 combinedScore 를 유지한다 (Req 6.8).
  const merged = new Map<string, CombinedResult>();

  /**
   * 후보를 맵에 병합한다.
   * @param relevance hop 감쇠를 적용하기 전의 관련성 점수. 최소 임계값 판정에 사용한다.
   */
  const upsert = (candidate: CombinedResult, relevance: number): void => {
    // 관련성이 임계값 미달이면 후보에서 제외한다(감쇠 후 값이 아니라 관련성으로 판정 —
    // 감쇠 후 값으로 판정하면 hop>=1 이웃이 전부 탈락한다).
    if (minScore > 0 && relevance < minScore) return;
    const existing = merged.get(candidate.path);
    if (existing === undefined || candidate.combinedScore > existing.combinedScore) {
      merged.set(candidate.path, candidate);
    }
  };

  // 1) 시드 처리: hop 0, isSeed=true, seedPath=null
  for (const seed of seeds) {
    const vNorm = seedNorm.get(seed.path) ?? normalizeVectorScore(seed.score);
    const meta = lookupMeta(seed.path, index);
    upsert(
      {
        path: seed.path,
        title: meta.title,
        excerpt: meta.excerpt,
        vectorScore: vNorm,
        hop: 0,
        isSeed: true,
        seedPath: null,
        combinedScore: vNorm * graphWeight(0),
      },
      vNorm
    );
  }

  // 2) 이웃 처리: 이웃 자신의 유사도(있으면)와 시드 유사도를 가중 결합한 뒤 hop 감쇠를 적용
  for (const neighbor of neighbors) {
    const vNormOfSeed = seedNorm.get(neighbor.seedPath);
    // 참조 시드가 없으면(이론상 발생하지 않음) 해당 이웃은 건너뛴다.
    if (vNormOfSeed === undefined) {
      continue;
    }
    const meta = lookupMeta(neighbor.path, index);
    const selfNorm = neighborSelfNorm.get(neighbor.path);

    // 이웃 자신의 유사도를 알면 가중 평균으로 관련성을 반영한다. 모르면 시드 점수만 사용한다.
    const relevance =
      selfNorm === undefined
        ? vNormOfSeed
        : NEIGHBOR_SELF_WEIGHT * selfNorm + (1 - NEIGHBOR_SELF_WEIGHT) * vNormOfSeed;

    upsert(
      {
        path: neighbor.path,
        title: meta.title,
        excerpt: meta.excerpt,
        vectorScore: selfNorm ?? vNormOfSeed,
        hop: neighbor.hop,
        isSeed: false,
        seedPath: neighbor.seedPath,
        combinedScore: relevance * graphWeight(neighbor.hop),
      },
      relevance
    );
  }

  // 3) 정렬 (임계값 판정은 upsert에서 관련성 기준으로 이미 수행됐다)
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
