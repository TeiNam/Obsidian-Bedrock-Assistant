// Graph RAG 청크 분할 순수 모듈 (Chunker)
// ============================================
// 프론트매터를 제외한 노트 본문을 "고정 최대 크기 + 인접 겹침" 방식으로
// 복수의 청크(chunk)로 분할한다. 모든 함수는 부수효과가 없는 순수 함수이며,
// Obsidian 등 외부 의존성을 사용하지 않는다.
// (fast-check 기반 속성 테스트가 가능하도록 순수 계층으로 분리)
//
// 핵심 보장:
// - 무손실 커버리지: 본문의 모든 문자는 최소 하나의 청크에 포함된다 (Req 3.7)
// - 각 청크 길이 <= maxSize (Req 3.1, 3.3)
// - 인접 청크는 overlap 만큼 겹친다 (Req 3.5)
// - 본문 길이 <= maxSize 또는 0이면 청크 1개 (Req 3.3, 3.4)

/** 청크 분할 설정값. */
export interface ChunkConfig {
  /** 단일 청크 최대 크기 (기본 2000). */
  maxSize: number;
  /** 인접 청크 겹침 크기 (기본 200, 0 <= overlap < maxSize). */
  overlap: number;
}

/**
 * 본문(프론트매터 제외)을 청크로 분할한다.
 *
 * 동작 규칙:
 * - 본문 길이 0 → 빈 텍스트 청크 1개 반환 (Req 3.4)
 * - 본문 길이 <= maxSize → 본문 전체를 담은 청크 1개 반환 (Req 3.3)
 * - 그 외 → step(= maxSize - overlap) 간격으로 슬라이딩하여
 *   maxSize 이하 청크들로 분할, 인접 청크는 overlap 만큼 겹침 (Req 3.1, 3.5)
 * - 무손실: 모든 문자가 최소 하나의 청크에 포함됨 (Req 3.7)
 *
 * @param body   프론트매터가 제거된 노트 본문
 * @param config 청크 설정. 정상 입력을 가정하지만, 무한 루프를 막기 위해
 *               내부에서 maxSize/step 최소값을 방어적으로 보정한다.
 */
export function splitIntoChunks(body: string, config: ChunkConfig): string[] {
  // 빈 본문은 빈 텍스트 청크 1개로 정의한다 (순수 함수 경계 동작, Req 3.4).
  if (body.length === 0) {
    return [""];
  }

  // 무한 루프 방지를 위한 방어적 보정: maxSize는 최소 1, step은 최소 1을 보장한다.
  // (정상 호출 시 normalizeChunkConfig 로 maxSize>=1, 0<=overlap<maxSize 가 보장된다.)
  const maxSize = Math.max(1, Math.floor(config.maxSize));
  const overlap = Math.min(Math.max(0, Math.floor(config.overlap)), maxSize - 1);
  const step = Math.max(1, maxSize - overlap);

  // 본문 길이가 단일 청크 최대 크기 이하이면 청크 1개로 처리한다 (Req 3.3).
  if (body.length <= maxSize) {
    return [body];
  }

  // 슬라이딩 윈도우 분할: start 위치에서 maxSize 만큼 잘라 청크를 만들고,
  // 다음 시작 위치를 step 만큼 전진시킨다. step <= maxSize 이므로 인접 청크가
  // 연속/겹치도록 보장되어 무손실 커버리지가 성립한다 (Req 3.5, 3.7).
  const chunks: string[] = [];
  let start = 0;
  while (true) {
    chunks.push(body.slice(start, start + maxSize));
    // 현재 청크가 본문 끝까지 도달했으면 종료한다.
    if (start + maxSize >= body.length) {
      break;
    }
    start += step;
  }

  return chunks;
}

/**
 * 청크 설정값을 유효 범위로 보정한다 (Req 9.6, 9.7).
 *
 * 보정 규칙(불변식 보장):
 * - maxSize < 1 → 1 (Req 9.7)
 * - overlap < 0 → 0 (음수 겹침 방지, 설계 불변식 0 <= overlap)
 * - overlap >= maxSize → maxSize - 1 (Req 9.6)
 *
 * 결과는 항상 maxSize >= 1 이고 0 <= overlap < maxSize 를 만족한다.
 */
export function normalizeChunkConfig(maxSize: number, overlap: number): ChunkConfig {
  // maxSize 보정: 유한하지 않거나 1 미만이면 1로 보정한다 (Req 9.7).
  let normalizedMax = maxSize;
  if (!Number.isFinite(normalizedMax) || normalizedMax < 1) {
    normalizedMax = 1;
  }

  // overlap 보정: 음수는 0으로, maxSize 이상이면 maxSize-1 로 보정한다 (Req 9.6).
  let normalizedOverlap = overlap;
  if (!Number.isFinite(normalizedOverlap) || normalizedOverlap < 0) {
    normalizedOverlap = 0;
  }
  if (normalizedOverlap >= normalizedMax) {
    normalizedOverlap = normalizedMax - 1;
  }

  return { maxSize: normalizedMax, overlap: normalizedOverlap };
}
