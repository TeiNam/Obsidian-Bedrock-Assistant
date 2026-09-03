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
 * - 그 외에는 첫 '['부터 마지막 ']'까지를 배열 후보로 본다.
 * - 배열 구간을 찾지 못하면 null.
 */
export function extractJsonArray(text: string): string | null {
  let t = text;
  // 코드펜스가 있으면 내부 내용만 사용한다.
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    t = fenceMatch[1].trim();
  }
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start < 0 || end < 0 || end < start) return null;
  return t.slice(start, end + 1);
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

  const jsonText = extractJsonArray(text);
  if (jsonText === null) return { ok: false, items: [], dropped: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, items: [], dropped: 0 };
  }

  if (!Array.isArray(parsed)) return { ok: false, items: [], dropped: 0 };

  const items: T[] = [];
  let dropped = 0;
  for (const raw of parsed) {
    const item = normalize(raw);
    if (item === null) dropped++;
    else items.push(item);
  }
  return { ok: true, items, dropped };
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
