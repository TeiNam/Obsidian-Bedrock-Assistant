// ============================================
// LLM JSON 응답 파싱 — 순수 함수
// ============================================
// Second Brain의 여러 기능이 LLM에게 JSON 배열을 요구한다(모순 점검, 결정 추출, Inbox
// 검토). 응답은 코드펜스로 감싸이거나 앞뒤에 설명이 섞여 오는 일이 흔하고, 토큰 제한으로
// 잘려 오기도 한다.
//
// 이 파싱을 기능마다 따로 구현하면 실패 의미론이 갈린다 — 특히 "빈 배열"과 "해석 실패"를
// 구분하지 않으면 잘린 응답을 "발견된 것 없음"으로 오보고해서 사용자가 문제를 놓친다.

/** 파싱 결과. ok=false는 "응답을 해석하지 못했다"이고, "결과가 없다"와 다르다. */
export interface JsonArrayParseResult<T> {
  /**
   * 응답을 JSON 배열로 해석했는지. false면 items는 항상 비어 있지만, 그것을
   * "발견된 것 없음"으로 보고해선 안 된다 — 잘린 응답과 구분되지 않는다.
   */
  ok: boolean;
  /** 정규화를 통과한 항목들. */
  items: T[];
  /**
   * 배열에는 있었지만 정규화를 통과하지 못해 버린 원소 수.
   *
   * `ok=true, items=[], dropped=0`만 "정말로 결과가 없음"이다. dropped>0인데 items가
   * 비었으면 LLM이 무언가 제안했지만 전부 무효였다는 뜻이다 — 지어낸 경로나 실재하지
   * 않는 폴더가 대표적이다. 이를 "발견된 것 없음"으로 보고하면 사용자가 오작동을 놓친다.
   */
  dropped: number;
}

/**
 * 텍스트에서 JSON 배열 구간을 추출한다.
 * - 코드펜스(```json ... ```)로 감싼 경우 내부만 취한다.
 * - 그 외에는 **JSON 배열로 파싱되는** 최상위 구간을 앞에서부터 찾는다.
 * - 배열 구간을 찾지 못하면 null.
 *
 * 첫 `[`부터 마지막 `]`까지 자르면 안 된다. LLM이 `Result [draft]: [{"path":"a.md"}]`처럼
 * 대괄호가 든 설명을 덧붙이면 `[draft]: [{...}]`가 되어 JSON이 깨지고, "앞뒤 설명을
 * 허용한다"는 이 파서의 계약과 달리 모든 응답이 형식 오류가 된다.
 */
export function extractJsonArray(text: string): string | null {
  let t = text;
  // 코드펜스가 있으면 내부 내용만 사용한다.
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    t = fenceMatch[1].trim();
  }

  return extractJsonArrayCandidates(t)[0] ?? null;
}

/**
 * 텍스트에서 JSON 배열로 파싱되는 모든 구간을 등장 순서대로 돌려준다.
 *
 * 후보가 여러 개인 이유: 산문에 각주 표기(`[1] 참고`)나 예시가 섞이면 그것도 유효한 JSON
 * 배열이다. 어느 것이 응답인지는 **원소를 정규화해 봐야** 알 수 있으므로(정규화기를 가진
 * parseJsonArray가 판단한다) 여기서는 고르지 않고 전부 준다.
 */
export function extractJsonArrayCandidates(text: string): string[] {
  let t = text;
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) t = fenceMatch[1].trim();

  const out: string[] = [];
  for (let start = t.indexOf("["); start >= 0; start = t.indexOf("[", start + 1)) {
    const end = findBalancedEnd(t, start);
    if (end < 0) continue;
    const candidate = t.slice(start, end + 1);
    if (isJsonArray(candidate)) {
      out.push(candidate);
      // 이 배열 안쪽의 `[`는 같은 구간을 다시 잡을 뿐이므로 건너뛴다.
      start = end;
    }
  }
  return out;
}

/** 문자열이 JSON 배열로 파싱되는지. */
function isJsonArray(text: string): boolean {
  try {
    return Array.isArray(JSON.parse(text));
  } catch {
    return false;
  }
}

/**
 * `open` 위치의 `[`와 짝이 맞는 `]`의 인덱스. 없으면 -1.
 *
 * 문자열 안의 괄호는 세지 않는다 — `[{"note":"a]b"}]`처럼 값에 `]`가 들어 있으면
 * 균형 계산이 어긋난다.
 */
function findBalancedEnd(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = open; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return ch === "]" ? i : -1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/**
 * LLM 응답에서 JSON 배열을 파싱하고 각 원소를 정규화한다.
 *
 * 예외를 던지지 않는다. 응답이 비었거나 JSON이 아니거나 배열이 아니면 ok=false다.
 * 빈 응답은 "결과 없음"이 아니라 해석 실패로 본다 — LLM은 최소 `[]`를 출력해야 한다.
 *
 * @param normalize 원소 하나를 도메인 타입으로 바꾼다. 유효하지 않으면 null을 돌려
 *   그 원소만 버린다(전체 실패로 만들지 않는다). 버린 수는 dropped로 보고한다.
 */
export function parseJsonArray<T>(
  llmText: unknown,
  normalize: (raw: unknown) => T | null
): JsonArrayParseResult<T> {
  if (typeof llmText !== "string") return { ok: false, items: [], dropped: 0 };
  const text = llmText.trim();
  if (text === "") return { ok: false, items: [], dropped: 0 };

  const candidates = extractJsonArrayCandidates(text);
  if (candidates.length === 0) return { ok: false, items: [], dropped: 0 };

  // 후보가 여러 개면 **정규화를 통과한 항목이 가장 많은** 것을 응답으로 본다.
  //
  // 산문에 각주 표기가 섞이면(`[1] 참고 [{"path":"a.md"}]`) 앞에 있는 `[1]`도 유효한 JSON
  // 배열이다. 앞에서부터 첫 후보를 집으면 실제 응답이 버려진다. 정규화기가 스키마를 알기
  // 때문에 여기서만 가릴 수 있다.
  //
  // 동수면 앞에 있는 것을 택한다 — 전부 0건인 경우(빈 배열 응답)가 여기 온다.
  let best: { items: T[]; dropped: number } | null = null;
  for (const candidate of candidates) {
    const parsed = JSON.parse(candidate) as unknown[];
    const items: T[] = [];
    let dropped = 0;
    for (const raw of parsed) {
      const item = normalize(raw);
      if (item === null) dropped++;
      else items.push(item);
    }
    if (best === null || items.length > best.items.length) best = { items, dropped };
  }

  // 후보가 하나 이상이므로 best는 반드시 채워진다. 단정 대신 기본값으로 표현한다.
  return { ok: true, items: best?.items ?? [], dropped: best?.dropped ?? 0 };
}

/** 값이 문자열 배열이면 문자열 원소만 추려 반환하고, 아니면 빈 배열을 반환한다. */
export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** 값이 문자열이면 trim해서, 아니면 빈 문자열을 반환한다. */
export function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
