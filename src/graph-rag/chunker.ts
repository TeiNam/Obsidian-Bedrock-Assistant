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

/**
 * 경계 탐색 시 청크가 유지해야 하는 최소 점유율.
 * 예: maxSize 2000, 비율 0.5 → 1000자 이후에서 발견된 경계만 채택한다.
 * 너무 앞의 경계를 채택하면 청크 수가 불필요하게 늘고 문맥이 조각난다.
 */
const MIN_BREAK_RATIO = 0.5;

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

  // 슬라이딩 윈도우 분할: start 위치에서 최대 maxSize 만큼 잘라 청크를 만들고,
  // 다음 시작 위치를 step 만큼 전진시킨다. step <= maxSize 이므로 인접 청크가
  // 연속/겹치도록 보장되어 무손실 커버리지가 성립한다 (Req 3.5, 3.7).
  //
  // 단, 절단 위치는 findBreakPoint 로 마크다운 구조 경계(문단 → 줄 → 문장 → 공백)에
  // 맞춰 앞으로 당긴다. 문자 수로 기계적으로 자르면 코드펜스·표·문장이 중간에서
  // 끊겨 임베딩 품질이 떨어지기 때문이다. 경계를 찾지 못하면 maxSize 그대로 자른다.
  const chunks: string[] = [];
  let start = 0;
  while (true) {
    const hardEnd = Math.min(start + maxSize, body.length);
    const end = hardEnd >= body.length ? body.length : findBreakPoint(body, start, hardEnd, overlap);
    chunks.push(body.slice(start, end));

    // 본문 끝까지 도달했으면 종료한다.
    if (end >= body.length) break;

    // 다음 시작 위치: 이번 청크 끝에서 overlap 만큼 되돌린다.
    // findBreakPoint가 청크 길이 > overlap 을 보장하므로 항상 start 보다 크다(전진 보장).
    start = end - overlap;
  }

  return chunks;
}

/**
 * [start, hardEnd) 범위에서 절단하기 좋은 위치를 찾는다.
 *
 * 우선순위: 문단 경계(빈 줄) → 줄바꿈 → 문장 끝 → 공백.
 *
 * 채택 조건: 청크 길이가 (a) 최소 점유율(MIN_BREAK_RATIO) 이상이고 (b) overlap 보다
 * 커야 한다. (b)는 슬라이딩 전진을 보장하는 필수 조건이다 — 청크가 overlap 이하로
 * 짧아지면 `end - overlap`이 start 를 넘지 못해 무한 루프가 되거나 겹침 불변식이
 * 깨진다. 적절한 경계가 없으면 hardEnd 를 그대로 쓰되 서로게이트 페어만 피한다.
 */
function findBreakPoint(body: string, start: number, hardEnd: number, overlap: number): number {
  const window = body.slice(start, hardEnd);
  // 경계를 너무 앞에서 찾으면 청크가 과도하게 짧아지므로 하한을 둔다.
  // overlap 보다 반드시 길어야 하므로 두 하한 중 큰 값을 쓴다.
  const minLength = Math.max(Math.floor(window.length * MIN_BREAK_RATIO), overlap + 1);

  // 후보 패턴을 우선순위 순으로 시도한다. 각 항목은 [검색 문자열, 절단 오프셋].
  const candidates: Array<[string, number]> = [
    ["\n\n", 2], // 문단 경계: 빈 줄 뒤에서 자른다
    ["\n", 1], // 줄 경계
    [". ", 2], // 영문 문장 끝
    ["다. ", 3], // 한국어 서술문 끝
    [" ", 1], // 마지막 수단: 단어 경계
  ];

  for (const [needle, offset] of candidates) {
    const idx = window.lastIndexOf(needle);
    // idx + offset 이 청크 길이가 된다. 하한 이상일 때만 채택한다.
    if (idx >= 0 && idx + offset >= minLength && idx + offset < window.length) {
      return start + idx + offset;
    }
  }

  // 경계를 못 찾으면 hardEnd 를 쓴다. 서로게이트 페어를 피해 한 칸 당기더라도
  // 청크 길이가 overlap 이하로 줄면 전진 보장이 깨지므로 그때는 당기지 않는다.
  const safeEnd = avoidSurrogateSplit(body, hardEnd);
  return safeEnd - start > overlap ? safeEnd : hardEnd;
}

/**
 * 인덱스가 서로게이트 페어(이모지 등 BMP 밖 문자) 중간이면 한 칸 앞으로 당긴다.
 * 페어를 쪼개면 청크 경계에 깨진 문자(U+FFFD 유발)가 남아 임베딩·표시가 오염된다.
 */
function avoidSurrogateSplit(body: string, index: number): number {
  if (index <= 0 || index >= body.length) return index;
  const prev = body.charCodeAt(index - 1);
  // 앞 문자가 high surrogate(0xD800~0xDBFF)면 뒤 문자와 한 쌍이므로 경계를 당긴다.
  if (prev >= 0xd800 && prev <= 0xdbff) return index - 1;
  return index;
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
