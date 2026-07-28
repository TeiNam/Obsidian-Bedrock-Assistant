// VectorSearch 모듈 — 청크 단위 코사인 유사도 기반 벡터 검색
// 쿼리 임베딩과 각 노트의 청크 임베딩 간 코사인 유사도를 계산하고,
// 노트별 최대 청크 점수로 병합한 뒤 정렬하여 상위 topK 노트를 반환한다.
// (Req 4.1~4.5, Properties 10, 11, 12)

import type { VaultIndexEntry } from "../types";

// 노트별 벡터 검색 점수 결과
export interface NoteVectorScore {
  /** 노트의 볼트 루트 기준 경로 */
  path: string;
  /** 노트 내 청크 유사도의 최대값 (-1.0 ~ 1.0) */
  score: number;
}

/**
 * 두 벡터 간 코사인 유사도를 계산한다 (Req 4.1, Property 10).
 * - 차원이 일치하지 않으면 0을 반환한다.
 * - 둘 중 하나라도 영벡터(크기 0)이면 0을 반환한다.
 * - 그 외에는 부동소수점 오차로 인한 범위 이탈을 막기 위해 결과를 [-1, 1]로 클램프한다.
 *
 * ⚠️ 반환값 0은 "무관함"과 "비교 불가(차원 불일치)"를 구분하지 못한다. 후자를 걸러야
 * 하는 호출부는 이 함수 대신 compareVectors를 사용한다.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  // 차원 불일치 안전 처리
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  // 영벡터(분모 0) 안전 처리
  if (denom === 0) return 0;

  const sim = dot / denom;
  // 부동소수점 오차 보정: 결과를 [-1, 1] 범위로 클램프
  if (sim > 1) return 1;
  if (sim < -1) return -1;
  return sim;
}

/**
 * 두 벡터를 비교한다. 비교 가능하면 코사인 유사도, 비교 불가하면 null을 반환한다.
 *
 * 비교 불가 = 빈 벡터(임베딩 실패/미생성) 또는 차원 불일치(임베딩 모델 변경).
 * 차원 불일치를 유사도 0으로 취급하면 정규화 단계에서 0.5점(중간 점수)으로 바뀌어
 * 무관한 노트가 "관련 있음"으로 검색되므로, 반드시 후보에서 제외해야 한다.
 */
export function compareVectors(a: number[], b: number[]): number | null {
  if (!a || !b) return null;
  if (a.length === 0 || b.length === 0) return null;
  // 차원 불일치는 "유사도 0"이 아니라 "비교 불가"다.
  if (a.length !== b.length) return null;
  return cosineSimilarity(a, b);
}

/** 노트 점수 산출 결과. 차원 불일치를 별도로 보고해 호출부가 인덱스 무효를 감지한다. */
interface NoteScoreOutcome {
  /** 산출된 최대 유사도. 사용 가능한 임베딩이 없으면 null */
  score: number | null;
  /** 쿼리와 차원이 다른 임베딩이 하나 이상 있었는지 */
  hadDimensionMismatch: boolean;
}

/**
 * 단일 노트의 벡터 점수를 산출한다.
 * - 사용 가능한 청크 임베딩(빈 배열·차원 불일치 제외)이 있으면 청크별 유사도의 최대값을 사용한다 (Req 4.2).
 * - 청크가 없거나 사용 가능한 청크 임베딩이 하나도 없고 레거시 노트 단위 임베딩이 있으면
 *   레거시 임베딩의 유사도를 사용한다 (마이그레이션/폴백).
 * - 사용 가능한 임베딩이 전혀 없으면 score=null을 반환한다(점수 미산출 → 후보 제외).
 */
function computeNoteScore(
  queryEmbedding: number[],
  entry: VaultIndexEntry
): NoteScoreOutcome {
  let best: number | null = null;
  let mismatch = false;

  /** 임베딩 하나를 비교해 best를 갱신하고, 차원 불일치를 기록한다. */
  const consider = (embedding: number[] | undefined): void => {
    if (!embedding || embedding.length === 0) return;
    if (embedding.length !== queryEmbedding.length) {
      mismatch = true;
      return;
    }
    const sim = cosineSimilarity(queryEmbedding, embedding);
    if (best === null || sim > best) best = sim;
  };

  // 1) 청크 임베딩 우선 사용 — 빈 임베딩([])과 차원 불일치는 건너뛴다
  const chunks = entry.chunks;
  if (chunks && chunks.length > 0) {
    for (const chunk of chunks) consider(chunk.embedding);
  }

  // 2) 사용 가능한 청크 임베딩이 없으면 레거시 노트 단위 임베딩으로 폴백
  if (best === null) consider(entry.embedding);

  return { score: best, hadDimensionMismatch: mismatch };
}

/**
 * 청크 단위 벡터 검색을 수행한다 (Req 4.2~4.5, Properties 11, 12).
 * - 각 노트의 점수 = 그 노트에 속한 모든 청크 유사도의 최대값 (사용 가능한 임베딩이 없으면 제외)
 * - 노트당 1건으로 병합하여 중복 제거 (Req 4.3)
 * - 점수 내림차순, 점수 동점 시 경로 오름차순(사전순) 정렬 (Req 4.4)
 * - 상위 topK개만 반환, 매칭 노트가 topK 미만이면 전부 반환 (Req 4.5)
 */
export function vectorSearchByChunk(
  queryEmbedding: number[],
  entries: VaultIndexEntry[],
  topK: number
): NoteVectorScore[] {
  return searchWithDiagnostics(queryEmbedding, entries, topK).results;
}

/** vectorSearchByChunk 결과 + 인덱스 상태 진단. */
export interface VectorSearchDiagnostics {
  /** 상위 topK 노트 점수 */
  results: NoteVectorScore[];
  /** 쿼리와 차원이 다른 임베딩을 가진 노트 수 (임베딩 모델 변경 감지용) */
  dimensionMismatchCount: number;
  /** 점수를 산출할 수 있었던(비교 가능한 임베딩 보유) 노트 수 */
  comparableCount: number;
}

/**
 * 벡터 검색을 수행하고 인덱스 상태 진단을 함께 반환한다.
 *
 * 차원 불일치 노트는 후보에서 제외하되 개수를 세어 보고한다. 호출부는 이 값으로
 * "임베딩 모델이 바뀌어 인덱스가 무효" 상황을 감지하고 재인덱싱을 안내하거나
 * 키워드 검색으로 폴백할 수 있다.
 */
export function searchWithDiagnostics(
  queryEmbedding: number[],
  entries: VaultIndexEntry[],
  topK: number
): VectorSearchDiagnostics {
  const results: NoteVectorScore[] = [];
  let dimensionMismatchCount = 0;

  // 노트별 최대 유사도 점수 산출 (비교 가능한 임베딩이 없는 노트는 결과에서 제외)
  for (const entry of entries) {
    const { score, hadDimensionMismatch } = computeNoteScore(queryEmbedding, entry);
    if (hadDimensionMismatch) dimensionMismatchCount++;
    if (score === null) continue;
    results.push({ path: entry.path, score });
  }

  const comparableCount = results.length;

  // 정렬: 점수 내림차순 → 점수 동점 시 경로 오름차순
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  // 상위 topK개만 반환 (topK가 음수/0이면 빈 배열)
  return {
    results: topK < 0 ? [] : results.slice(0, topK),
    dimensionMismatchCount,
    comparableCount,
  };
}
