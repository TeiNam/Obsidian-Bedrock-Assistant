import { describe, it, expect } from "vitest";
import { getErrorMessage } from "./error-utils";

describe("getErrorMessage", () => {
  it("Error 인스턴스는 message를 반환한다", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("문자열 예외는 그대로 반환한다", () => {
    expect(getErrorMessage("실패")).toBe("실패");
  });

  it("message 필드를 가진 일반 객체도 처리한다", () => {
    // fetch·AWS SDK가 Error가 아닌 객체를 던지는 경우가 있다.
    expect(getErrorMessage({ message: "throttled" })).toBe("throttled");
  });

  it("message가 문자열이 아니면 문자열화로 폴백한다", () => {
    expect(getErrorMessage({ message: 500 })).toBe("[object Object]");
  });

  it("null·undefined도 던져질 수 있으므로 문자열화한다", () => {
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
  });
});
