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
  let overlap = Math.min(Math.max(0, Math.floor(config.overlap)), maxSize - 1);

  // 서로게이트 페어(이모지 등)가 포함된 본문에서 overlap이 홀수면, 절단 지점과
  // 겹침 시작 지점 중 하나는 반드시 페어 중간에 놓인다(페어는 2 코드 유닛).
  // 그러면 청크 경계에 깨진 문자가 남으므로 overlap을 짝수로 맞춘다.
  // overlap은 실행 전체에서 고정이므로 "인접 청크는 정확히 overlap만큼 겹친다"
  // 불변식은 그대로 유지된다.
  if (overlap % 2 === 1 && overlap >= 1 && containsSurrogatePair(body)) {
    overlap -= 1;
  }

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
    let end = hardEnd >= body.length ? body.length : findBreakPoint(body, start, hardEnd, overlap);

    // 청크 경계 두 곳(이번 청크의 끝 `end`, 다음 청크의 시작 `end - overlap`)이 모두
    // 서로게이트 페어 중간에 놓이지 않아야 한다. 하나라도 페어를 쪼개면 해당 청크에
    // 단독 서로게이트(깨진 문자)가 남아 임베딩·표시가 오염된다.
    //
    // overlap이 짝수로 보정돼 있으므로 두 경계의 홀짝성은 같다 → end를 한 칸 당기면
    // 두 경계가 함께 이동해 동시에 해소된다. 시작 위치를 따로 옮기지 않으므로
    // "인접 청크는 정확히 overlap만큼 겹친다" 불변식은 유지된다.
    if (end < body.length) {
      end = alignChunkEnd(body, start, end, overlap);
    }

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
  return splitsSurrogatePair(body, index) ? index - 1 : index;
}

/**
 * 해당 인덱스가 서로게이트 페어(이모지 등 BMP 밖 문자) 중간을 가리키는지 판별한다.
 * 즉 앞 문자가 high surrogate(0xD800~0xDBFF)이고 그 뒤 문자와 한 쌍인 경우.
 */
function splitsSurrogatePair(body: string, index: number): boolean {
  if (index <= 0 || index >= body.length) return false;
  const prev = body.charCodeAt(index - 1);
  return prev >= 0xd800 && prev <= 0xdbff;
}

/**
 * 청크 끝 위치를 서로게이트 페어 경계에 맞춘다.
 *
 * 두 경계가 모두 페어를 쪼개지 않아야 한다.
 *  - 이번 청크의 끝: `end`
 *  - 다음 청크의 시작: `end - overlap`
 *
 * end를 최대 2칸까지 당겨 두 조건을 함께 만족하는 위치를 찾는다. 전진 보장
 * (청크 길이 > overlap)을 깨는 위치는 채택하지 않으며, 찾지 못하면 원래 값을 반환한다.
 *
 * ponytail: 홀수 폭 문자(한글·ASCII)가 페어 사이에 끼면 두 경계의 홀짝성이 어긋나
 * 단일 고정 overlap으로는 동시 정렬이 불가능한 조합이 남는다. 이때 청크 경계에
 * 깨진 문자 1개가 생기지만, 데이터 손실이 아니라 임베딩 입력의 미세한 품질 저하이며
 * 무손실 커버리지·길이·겹침 불변식은 모두 유지된다(수정 전에는 보호 자체가 없었다).
 * 완전 해결이 필요하면 청크별 가변 overlap을 허용해야 하는데, 그러면 "인접 청크는
 * 정확히 overlap만큼 겹친다"는 계약(Req 3.5)과 그 속성 테스트를 바꿔야 한다.
 */
function alignChunkEnd(body: string, start: number, end: number, overlap: number): number {
  for (let candidate = end; candidate >= end - 2; candidate--) {
    if (candidate - start <= overlap) break; // 전진 보장 위반
    if (candidate <= start) break;
    const splitsEnd = splitsSurrogatePair(body, candidate);
    const splitsNextStart = splitsSurrogatePair(body, candidate - overlap);
    if (!splitsEnd && !splitsNextStart) return candidate;
  }
  return end;
}

/**
 * 본문에 서로게이트 페어(BMP 밖 문자: 이모지, 일부 한자·악보 기호 등)가 있는지 확인한다.
 * 있으면 청크 경계 정렬에 추가 제약(짝수 overlap)이 필요하다.
 */
function containsSurrogatePair(body: string): boolean {
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) return true;
  }
  return false;
}

/**
 * 청크 최대 크기의 상한.
 *
 * 상한이 없으면 `maxSize`가 `Number.MAX_SAFE_INTEGER`를 넘을 수 있고, 그러면
 * `maxSize - 1 === maxSize`가 되어 "overlap < maxSize" 불변식이 깨진다(부동소수점
 * 정밀도 한계). 설정 입력이 자유 텍스트 + `parseInt`이므로 실제로 도달 가능한 경로다.
 *
 * 값 자체는 실용 상한이기도 하다. 청크 하나가 100만 자를 넘으면 어떤 임베딩 모델의
 * 입력 한도도 초과하므로, 그보다 큰 설정은 의미가 없다.
 */
export const MAX_CHUNK_SIZE = 1_000_000;

/**
 * 청크 설정값을 유효 범위로 보정한다 (Req 9.6, 9.7).
 *
 * 보정 규칙(불변식 보장):
 * - maxSize < 1 → 1 (Req 9.7)
 * - maxSize > MAX_CHUNK_SIZE → MAX_CHUNK_SIZE (정밀도 한계·실용 상한)
 * - overlap < 0 → 0 (음수 겹침 방지, 설계 불변식 0 <= overlap)
 * - overlap >= maxSize → maxSize - 1 (Req 9.6)
 *
 * 결과는 항상 정수이며 maxSize >= 1 이고 0 <= overlap < maxSize 를 만족한다.
 */
export function normalizeChunkConfig(maxSize: number, overlap: number): ChunkConfig {
  // maxSize 보정: 유한하지 않거나 1 미만이면 1, 상한 초과면 상한으로 맞춘다 (Req 9.7).
  // 소수점은 버려 정수로 만든다 — 정수가 아니면 slice 경계 계산이 어긋난다.
  let normalizedMax = maxSize;
  if (!Number.isFinite(normalizedMax) || normalizedMax < 1) {
    normalizedMax = 1;
  } else {
    normalizedMax = Math.min(Math.floor(normalizedMax), MAX_CHUNK_SIZE);
  }

  // overlap 보정: 음수는 0으로, maxSize 이상이면 maxSize-1 로 보정한다 (Req 9.6).
  let normalizedOverlap = overlap;
  if (!Number.isFinite(normalizedOverlap) || normalizedOverlap < 0) {
    normalizedOverlap = 0;
  } else {
    normalizedOverlap = Math.floor(normalizedOverlap);
  }
  if (normalizedOverlap >= normalizedMax) {
    normalizedOverlap = normalizedMax - 1;
  }

  return { maxSize: normalizedMax, overlap: normalizedOverlap };
}
