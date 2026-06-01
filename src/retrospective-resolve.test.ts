import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import { resolveTodayTodoFile, buildTodoPath } from "./retrospective-service";
import { buildTodoDocPath } from "./planner-paths";

/**
 * resolveTodayTodoFile() 회고 To-Do 해석 예시 테스트 (mock vault)
 *
 * 새 Date_Folder 구조 우선, Legacy 평면 구조 폴백, 둘 다 없으면 null을
 * 반환하는 우선순위 동작을 mock vault로 검증한다.
 *
 * Validates: Requirements 9.1, 9.2, 9.3
 */

// 테스트 전반에서 사용할 고정 날짜 (월/일 2자리 zero-pad 동작도 함께 확인)
const FIXED_DATE = new Date(2026, 2, 5); // 2026-03-05
const PLANNER_FOLDER = "Planner";
const LEGACY_FOLDER = "ToDo";

// 새 구조 / Legacy 구조의 기대 경로 (구현과 동일한 헬퍼로 계산)
const NEW_PATH = buildTodoDocPath(PLANNER_FOLDER, FIXED_DATE);
const LEGACY_PATH = buildTodoPath(LEGACY_FOLDER, FIXED_DATE);

/**
 * 지정한 경로 집합에 대해서만 TFile 인스턴스를 반환하는 mock app을 만든다.
 * 그 외 경로는 null을 반환한다 (실제 vault.getAbstractFileByPath와 동일한 계약).
 *
 * @param existingPaths - 파일이 존재하는 것으로 취급할 경로 목록
 */
function makeApp(existingPaths: string[]): any {
  const pathSet = new Set(existingPaths);

  return {
    vault: {
      getAbstractFileByPath: vi.fn((path: string) => {
        if (pathSet.has(path)) {
          // mock의 TFile 클래스 인스턴스 → 구현부의 instanceof TFile 통과
          const file = new TFile();
          file.path = path;
          return file;
        }
        return null;
      }),
    },
  };
}

describe("resolveTodayTodoFile() 회고 To-Do 해석", () => {
  // --- Req 9.1: 새 구조 우선 ---
  it("새 구조와 Legacy가 모두 존재하면 새 구조 파일을 우선 반환한다 (9.1)", () => {
    const app = makeApp([NEW_PATH, LEGACY_PATH]);

    const result = resolveTodayTodoFile(app, PLANNER_FOLDER, LEGACY_FOLDER, FIXED_DATE);

    expect(result).toBeInstanceOf(TFile);
    expect(result?.path).toBe(NEW_PATH);
    // 우선순위 확인: 새 구조가 매칭되므로 Legacy 경로는 조회하지 않는다.
    expect(app.vault.getAbstractFileByPath).not.toHaveBeenCalledWith(LEGACY_PATH);
  });

  // --- Req 9.2: Legacy 폴백 ---
  it("새 구조가 없고 Legacy만 존재하면 Legacy 파일을 반환한다 (9.2)", () => {
    const app = makeApp([LEGACY_PATH]);

    const result = resolveTodayTodoFile(app, PLANNER_FOLDER, LEGACY_FOLDER, FIXED_DATE);

    expect(result).toBeInstanceOf(TFile);
    expect(result?.path).toBe(LEGACY_PATH);
    // 새 구조를 먼저 조회한 뒤 Legacy로 폴백했는지 확인
    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(NEW_PATH);
    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(LEGACY_PATH);
  });

  // --- Req 9.3: 둘 다 없음 → null ---
  it("새 구조와 Legacy 모두 존재하지 않으면 null을 반환한다 (9.3)", () => {
    const app = makeApp([]);

    const result = resolveTodayTodoFile(app, PLANNER_FOLDER, LEGACY_FOLDER, FIXED_DATE);

    expect(result).toBeNull();
    // 양쪽 경로를 모두 탐색했는지 확인
    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(NEW_PATH);
    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(LEGACY_PATH);
  });
});
