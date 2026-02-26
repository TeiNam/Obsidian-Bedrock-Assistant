import { describe, it, expect } from "vitest";
import { isToolError, updateFailureCount } from "./tool-failure-tracker";

describe("isToolError", () => {
  it("영어 에러 접두사를 감지한다", () => {
    expect(isToolError("Tool execution error: something went wrong")).toBe(true);
  });

  it("한국어 에러 접두사를 감지한다", () => {
    expect(isToolError("도구 실행 오류: 알 수 없는 도구")).toBe(true);
  });

  it("정상 결과는 에러로 판별하지 않는다", () => {
    expect(isToolError("File created successfully")).toBe(false);
  });

  it("빈 문자열은 에러가 아니다", () => {
    expect(isToolError("")).toBe(false);
  });

  it("부분 일치는 에러로 판별하지 않는다", () => {
    // 접두사가 아닌 중간에 포함된 경우
    expect(isToolError("Result: Tool execution error: test")).toBe(false);
  });

  it("사용자 거부 메시지는 에러가 아니다", () => {
    expect(isToolError("Tool execution denied by user.")).toBe(false);
    expect(isToolError("사용자가 도구 실행을 거부했습니다.")).toBe(false);
  });
});

describe("updateFailureCount", () => {
  it("에러 시 카운터가 증가한다", () => {
    const result = updateFailureCount(0, "Tool execution error: not found");
    expect(result.count).toBe(1);
    expect(result.shouldStop).toBe(false);
  });

  it("성공 시 카운터가 리셋된다", () => {
    const result = updateFailureCount(2, "Success: file created");
    expect(result.count).toBe(0);
    expect(result.shouldStop).toBe(false);
  });

  it("3회 연속 실패 시 중단 신호를 반환한다", () => {
    const result = updateFailureCount(2, "도구 실행 오류: 존재하지 않는 도구");
    expect(result.count).toBe(3);
    expect(result.shouldStop).toBe(true);
  });

  it("연속 실패 시나리오: 3회 연속 실패까지 추적", () => {
    // 1회 실패
    let state = updateFailureCount(0, "Tool execution error: fail 1");
    expect(state).toEqual({ count: 1, shouldStop: false });

    // 2회 실패
    state = updateFailureCount(state.count, "도구 실행 오류: fail 2");
    expect(state).toEqual({ count: 2, shouldStop: false });

    // 3회 실패 → 중단
    state = updateFailureCount(state.count, "Tool execution error: fail 3");
    expect(state).toEqual({ count: 3, shouldStop: true });
  });

  it("중간에 성공하면 카운터가 리셋된다", () => {
    // 2회 실패 후 성공
    let state = updateFailureCount(0, "Tool execution error: fail 1");
    state = updateFailureCount(state.count, "Tool execution error: fail 2");
    expect(state.count).toBe(2);

    // 성공 → 리셋
    state = updateFailureCount(state.count, "Operation completed");
    expect(state).toEqual({ count: 0, shouldStop: false });

    // 다시 1회 실패 → 아직 중단 아님
    state = updateFailureCount(state.count, "Tool execution error: fail again");
    expect(state).toEqual({ count: 1, shouldStop: false });
  });

  it("커스텀 maxFailures 값을 지원한다", () => {
    // maxFailures = 1 → 1회 실패로 즉시 중단
    const result = updateFailureCount(0, "Tool execution error: fail", 1);
    expect(result).toEqual({ count: 1, shouldStop: true });
  });
});
