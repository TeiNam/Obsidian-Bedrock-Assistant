import { describe, it, expect } from "vitest";
import { parseJsonArray, extractJsonArray, toStringArray, toTrimmedString } from "./llm-json";

/** 문자열만 통과시키는 최소 정규화기. */
const asString = (raw: unknown): string | null =>
  typeof raw === "string" && raw !== "" ? raw : null;

describe("extractJsonArray", () => {
  it("코드펜스 내부만 취한다", () => {
    expect(extractJsonArray('설명\n```json\n["a"]\n```\n꼬리')).toBe('["a"]');
  });

  it("펜스가 없으면 첫 [부터 마지막 ]까지 본다", () => {
    expect(extractJsonArray('앞말 ["a", "b"] 뒷말')).toBe('["a", "b"]');
  });

  it("배열 구간이 없으면 null이다", () => {
    expect(extractJsonArray("배열이 없습니다")).toBeNull();
  });
});

describe("parseJsonArray — 실패와 '결과 없음'의 구분", () => {
  it("문자열이 아니거나 비었으면 해석 실패다", () => {
    // LLM은 최소 `[]`를 출력해야 한다. 빈 응답은 잘렸을 가능성이 높다.
    for (const bad of [undefined, null, 42, "", "   "]) {
      expect(parseJsonArray(bad, asString).ok).toBe(false);
    }
  });

  it("JSON이 깨졌으면 해석 실패다", () => {
    expect(parseJsonArray('["잘린', asString).ok).toBe(false);
  });

  it("배열이 아니면 해석 실패다", () => {
    expect(parseJsonArray('{"a": 1}', asString).ok).toBe(false);
  });

  it("빈 배열은 정상 응답이며 '결과 없음'이다", () => {
    const out = parseJsonArray("[]", asString);

    expect(out.ok).toBe(true);
    expect(out.items).toEqual([]);
    expect(out.dropped).toBe(0);
  });
});

// ============================================
// dropped — 전부 무효인 응답
// ============================================
/**
 * 정규화기는 지어낸 경로·실재하지 않는 폴더를 걸러낸다. 걸러낸 결과가 0건인 것과 LLM이
 * 애초에 아무것도 제안하지 않은 것은 사용자에게 전혀 다른 사실이다. 전자를 "발견된 것
 * 없음"으로 보고하면 사용자는 LLM이 전부 날조했다는 것을 알 방법이 없다.
 */
describe("parseJsonArray — dropped", () => {
  it("정규화를 통과하지 못한 원소 수를 센다", () => {
    const out = parseJsonArray('["살아남음", "", 42, null]', asString);

    expect(out.ok).toBe(true);
    expect(out.items).toEqual(["살아남음"]);
    expect(out.dropped).toBe(3);
  });

  it("전부 무효면 items는 비고 dropped가 남는다", () => {
    const out = parseJsonArray("[1, 2, 3]", asString);

    expect(out.ok).toBe(true);
    expect(out.items).toEqual([]);
    expect(out.dropped).toBe(3);
  });

  it("해석 실패 경로의 dropped는 0이다", () => {
    // 해석하지 못했으니 무엇을 버렸는지 셀 수도 없다. ok=false가 그 사실을 전한다.
    expect(parseJsonArray("잘린 응답", asString).dropped).toBe(0);
  });
});

describe("toStringArray / toTrimmedString", () => {
  it("배열에서 문자열 원소만 추린다", () => {
    expect(toStringArray(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(toStringArray("배열 아님")).toEqual([]);
  });

  it("문자열이 아니면 빈 문자열이다", () => {
    expect(toTrimmedString("  a  ")).toBe("a");
    expect(toTrimmedString(42)).toBe("");
  });
});
