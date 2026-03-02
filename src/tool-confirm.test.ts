import { describe, it, expect } from "vitest";
import { DESTRUCTIVE_TOOLS, needsToolConfirmation } from "./tool-confirm-utils";

/**
 * ToolConfirmModal 연동 테스트
 *
 * Property 1: Fault Condition - 파괴적 도구 실행 전 확인 모달 표시
 *   confirmToolExecution=true + 파괴적 도구 → 확인 필요
 *   모달 승인 시 도구 실행, 거부 시 실행 중단
 *
 * Property 2: Preservation - 비파괴적 도구 및 설정 비활성화 시 동작 보존
 *   confirmToolExecution=false → 모든 도구 즉시 실행
 *   비파괴적 도구 → 설정과 관계없이 즉시 실행
 *
 * Validates: Requirements 2.1, 3.1, 3.2
 */

// --- DESTRUCTIVE_TOOLS 상수 검증 ---

describe("DESTRUCTIVE_TOOLS 상수", () => {
  it("파괴적 도구 4개가 정의되어 있다", () => {
    expect(DESTRUCTIVE_TOOLS).toHaveLength(4);
  });

  it("edit_note가 포함되어 있다", () => {
    expect(DESTRUCTIVE_TOOLS).toContain("edit_note");
  });

  it("create_note가 포함되어 있다", () => {
    expect(DESTRUCTIVE_TOOLS).toContain("create_note");
  });

  it("delete_file이 포함되어 있다", () => {
    expect(DESTRUCTIVE_TOOLS).toContain("delete_file");
  });

  it("move_file이 포함되어 있다", () => {
    expect(DESTRUCTIVE_TOOLS).toContain("move_file");
  });
});

// --- Property 1: Fault Condition ---
// confirmToolExecution=true + 파괴적 도구 → 확인 필요 (true 반환)

describe("needsToolConfirmation - Fault Condition (Property 1)", () => {
  /**
   * Validates: Requirements 2.1
   */
  it("confirmToolExecution=true + edit_note → 확인 필요", () => {
    expect(needsToolConfirmation("edit_note", true)).toBe(true);
  });

  it("confirmToolExecution=true + create_note → 확인 필요", () => {
    expect(needsToolConfirmation("create_note", true)).toBe(true);
  });

  it("confirmToolExecution=true + delete_file → 확인 필요", () => {
    expect(needsToolConfirmation("delete_file", true)).toBe(true);
  });

  it("confirmToolExecution=true + move_file → 확인 필요", () => {
    expect(needsToolConfirmation("move_file", true)).toBe(true);
  });

  it("모든 파괴적 도구에 대해 confirmToolExecution=true이면 확인 필요", () => {
    for (const tool of DESTRUCTIVE_TOOLS) {
      expect(needsToolConfirmation(tool, true)).toBe(true);
    }
  });
});

// --- Property 2: Preservation ---
// confirmToolExecution=false → 모든 도구 즉시 실행 (false 반환)
// 비파괴적 도구 → 설정과 관계없이 즉시 실행 (false 반환)

describe("needsToolConfirmation - Preservation (Property 2)", () => {
  /**
   * Validates: Requirements 3.1
   */
  it("confirmToolExecution=false → 파괴적 도구도 즉시 실행", () => {
    for (const tool of DESTRUCTIVE_TOOLS) {
      expect(needsToolConfirmation(tool, false)).toBe(false);
    }
  });

  /**
   * Validates: Requirements 3.2
   */
  const NON_DESTRUCTIVE_TOOLS = ["search_vault", "read_note", "list_files"];

  it("비파괴적 도구는 confirmToolExecution=true여도 즉시 실행", () => {
    for (const tool of NON_DESTRUCTIVE_TOOLS) {
      expect(needsToolConfirmation(tool, true)).toBe(false);
    }
  });

  it("비파괴적 도구는 confirmToolExecution=false일 때도 즉시 실행", () => {
    for (const tool of NON_DESTRUCTIVE_TOOLS) {
      expect(needsToolConfirmation(tool, false)).toBe(false);
    }
  });

  it("알 수 없는 도구 이름은 확인 불필요", () => {
    expect(needsToolConfirmation("unknown_tool", true)).toBe(false);
    expect(needsToolConfirmation("unknown_tool", false)).toBe(false);
  });

  it("빈 문자열 도구 이름은 확인 불필요", () => {
    expect(needsToolConfirmation("", true)).toBe(false);
    expect(needsToolConfirmation("", false)).toBe(false);
  });
});
