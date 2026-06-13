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
 * 단일 노트의 벡터 점수를 산출한다.
 * - 사용 가능한 청크 임베딩(빈 배열 [] 제외)이 있으면 청크별 유사도의 최대값을 사용한다 (Req 4.2).
 * - 청크가 없거나 사용 가능한 청크 임베딩이 하나도 없고 레거시 노트 단위 임베딩이 있으면
 *   레거시 임베딩의 유사도를 사용한다 (마이그레이션/폴백).
 * - 사용 가능한 임베딩이 전혀 없으면 null을 반환한다(점수 미산출).
 */
function computeNoteScore(
  queryEmbedding: number[],
  entry: VaultIndexEntry
): number | null {
  let best: number | null = null;

  // 1) 청크 임베딩 우선 사용 — 빈 임베딩([])은 건너뛴다
  const chunks = entry.chunks;
  if (chunks && chunks.length > 0) {
    for (const chunk of chunks) {
      if (!chunk.embedding || chunk.embedding.length === 0) continue;
      const sim = cosineSimilarity(queryEmbedding, chunk.embedding);
      if (best === null || sim > best) best = sim;
    }
  }

  // 2) 사용 가능한 청크 임베딩이 없으면 레거시 노트 단위 임베딩으로 폴백
  if (best === null && entry.embedding && entry.embedding.length > 0) {
    best = cosineSimilarity(queryEmbedding, entry.embedding);
  }

  return best;
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
  const results: NoteVectorScore[] = [];

  // 노트별 최대 유사도 점수 산출 (사용 가능한 임베딩이 없는 노트는 결과에서 제외)
  for (const entry of entries) {
    const score = computeNoteScore(queryEmbedding, entry);
    if (score === null) continue;
    results.push({ path: entry.path, score });
  }

  // 정렬: 점수 내림차순 → 점수 동점 시 경로 오름차순
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  // 상위 topK개만 반환 (topK가 음수/0이면 빈 배열)
  if (topK < 0) return [];
  return results.slice(0, topK);
}
