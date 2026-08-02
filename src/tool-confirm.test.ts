import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
  Notice: class {},
  TFile: class {},
  TFolder: class {},
  normalizePath: (p: string) => p,
}));

import { DESTRUCTIVE_TOOLS, needsToolConfirmation } from "./tool-confirm-utils";
import { SECOND_BRAIN_TOOLS, TOOLS } from "./obsidian-tools";

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
  it("기본 파일 도구 5개 + Second Brain 쓰기 도구 5개가 정의되어 있다", () => {
    expect(DESTRUCTIVE_TOOLS).toHaveLength(10);
  });

  it("볼트에 쓰기를 수행하는 Second Brain 도구가 모두 포함되어 있다", () => {
    // 이 도구들이 빠져 있으면 확인 설정을 켜도 LLM이 노트를 확인 없이 생성·수정한다.
    for (const tool of [
      "create_wiki_note",
      "update_index",
      "synthesize_topic",
      "architect",
      // reconcile_topic 은 "모순 점검"이라는 이름 때문에 읽기 전용으로 오해하기 쉽다.
      // 실제로는 정정안을 Sentinel_Block 으로 병합해 vault.modify 로 기존 노트를
      // 덮어쓴다(second-brain/reconcile.ts:446). 목록에서 빠지면 확인 없이 노트가 바뀐다.
      "reconcile_topic",
    ]) {
      expect(DESTRUCTIVE_TOOLS).toContain(tool);
    }
  });

  it("리포트만 반환하는 Second Brain 도구는 포함하지 않는다", () => {
    // challenge/connect/emerge 는 vault 쓰기 경로가 없다. 확인 모달을 띄우면
    // 읽기 작업마다 사용자를 막아 세워 확인 피로가 생기고, 정작 쓰기 도구의 확인이 무시된다.
    for (const tool of ["challenge", "connect", "emerge"]) {
      expect(DESTRUCTIVE_TOOLS).not.toContain(tool);
    }
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

  it("append_to_note가 포함되어 있다", () => {
    expect(DESTRUCTIVE_TOOLS).toContain("append_to_note");
  });
});

// --- 두 도구 목록의 정합성 ---
// SECOND_BRAIN_TOOLS(LLM에 보낼지 결정)와 DESTRUCTIVE_TOOLS(확인 모달을 띄울지 결정)는
// 서로 다른 목적이지만 같은 도구 집합을 다룬다. 한쪽에만 도구를 추가하면 조용히 어긋난다.

describe("SECOND_BRAIN_TOOLS ↔ DESTRUCTIVE_TOOLS 정합성", () => {
  it("SECOND_BRAIN_TOOLS의 모든 이름이 실제 TOOLS에 존재한다", () => {
    // 오타가 있으면 필터가 아무것도 걸러내지 못하고 조용히 통과한다.
    const actual = new Set(TOOLS.map((t) => t.name));
    for (const name of SECOND_BRAIN_TOOLS) {
      expect(actual, `${name} 이(가) TOOLS에 없다`).toContain(name);
    }
  });

  it("DESTRUCTIVE_TOOLS의 Second Brain 도구는 모두 SECOND_BRAIN_TOOLS에 있다", () => {
    // 파괴적으로 분류했는데 SB 목록에 없으면, SB를 껐을 때 그 도구만 남아 LLM에 전달된다.
    const sbSet = new Set(SECOND_BRAIN_TOOLS);
    const baseFileTools = new Set([
      "edit_note",
      "create_note",
      "delete_file",
      "move_file",
      "append_to_note",
    ]);
    for (const name of DESTRUCTIVE_TOOLS) {
      if (baseFileTools.has(name)) continue;
      expect(sbSet, `${name} 이(가) SECOND_BRAIN_TOOLS에 없다`).toContain(name);
    }
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

  it("confirmToolExecution=true + append_to_note → 확인 필요", () => {
    expect(needsToolConfirmation("append_to_note", true)).toBe(true);
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
