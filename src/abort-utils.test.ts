import { describe, it, expect } from "vitest";
import { isAbortError } from "./abort-utils";

/**
 * AbortSignal/AbortError 판별 분기 예시 테스트
 *
 * isAbortError(error, signal?)의 각 분기를 구체적 예시로 검증한다.
 *   분기 1: signal이 aborted 상태 → true (오류 종류 무관, 우선 적용)
 *   분기 2: error가 AbortError(name === "AbortError")이고 signal 없음/미중단 → true
 *   분기 3: 일반 오류 + 미중단(또는 미지정) signal → false
 *   (edge) aborted signal은 error가 일반 오류여도 우선하여 true
 *
 * Validates: Requirements 13.3
 */
describe("isAbortError 분기 검증", () => {
  // --- 분기 1: aborted 신호 → true ---
  describe("분기 1 — aborted signal", () => {
    it("aborted=true인 signal이면 error가 일반 오류여도 true를 반환한다", () => {
      // 일반 Error 객체에 명시적으로 aborted 신호를 전달
      const result = isAbortError(new Error("x"), { aborted: true } as AbortSignal);
      expect(result).toBe(true);
    });

    it("실제 AbortController에서 abort()한 signal이면 true를 반환한다", () => {
      const ac = new AbortController();
      ac.abort();
      expect(isAbortError(new Error("generic"), ac.signal)).toBe(true);
    });

    it("error가 null이어도 aborted signal이면 true를 반환한다", () => {
      const ac = new AbortController();
      ac.abort();
      expect(isAbortError(null, ac.signal)).toBe(true);
    });
  });

  // --- 분기 2: AbortError 예외 → true ---
  describe("분기 2 — AbortError 예외 (signal 없음/미지정)", () => {
    it("name이 'AbortError'인 Error는 signal 없이도 true를 반환한다", () => {
      // 취소 예외 구성: 이식성을 위해 Error+name 방식 사용
      const e = new Error("aborted");
      e.name = "AbortError";
      expect(isAbortError(e)).toBe(true);
    });

    it("AbortError + 미중단 signal 조합도 true를 반환한다", () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      const ac = new AbortController(); // abort() 호출 안 함 → aborted=false
      expect(isAbortError(e, ac.signal)).toBe(true);
    });

    // Node 18+ 환경에서 DOMException이 존재하면 DOMException(AbortError)도 검증
    if (typeof DOMException !== "undefined") {
      it("DOMException('...', 'AbortError')도 true를 반환한다", () => {
        const e = new DOMException("aborted", "AbortError");
        expect(isAbortError(e)).toBe(true);
      });
    }
  });

  // --- 분기 3: 일반 오류 + 미중단/미지정 signal → false ---
  describe("분기 3 — 일반 오류", () => {
    it("일반 Error + 미지정 signal이면 false를 반환한다", () => {
      expect(isAbortError(new Error("network failed"))).toBe(false);
    });

    it("일반 Error + 미중단 signal이면 false를 반환한다", () => {
      const ac = new AbortController(); // aborted=false
      expect(isAbortError(new Error("timeout"), ac.signal)).toBe(false);
    });

    it("name이 다른 Error(TypeError 등)는 false를 반환한다", () => {
      expect(isAbortError(new TypeError("bad type"))).toBe(false);
    });

    it("Error가 아닌 값(문자열/객체)은 false를 반환한다", () => {
      expect(isAbortError("AbortError")).toBe(false);
      expect(isAbortError({ name: "AbortError" })).toBe(false);
      expect(isAbortError(undefined)).toBe(false);
    });
  });

  // --- edge: aborted 신호 우선순위 ---
  describe("edge — aborted signal 우선순위", () => {
    it("일반 오류 + undefined signal이면 false다", () => {
      expect(isAbortError(new Error("generic"), undefined)).toBe(false);
    });

    it("일반 오류여도 aborted signal이 우선하여 true다", () => {
      const ac = new AbortController();
      ac.abort();
      // 오류는 AbortError가 아니지만 signal이 중단되었으므로 true
      expect(isAbortError(new TypeError("not abort"), ac.signal)).toBe(true);
    });
  });
});
