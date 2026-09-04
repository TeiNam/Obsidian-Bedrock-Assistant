import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolExecutor } from "./obsidian-tools";
import { TFile } from "obsidian";
import { isToolError } from "./tool-failure-tracker";
import { TOOL_I18N } from "./tool-result-i18n";

/**
 * editNote() replaceAll 동작 테스트
 *
 * B1 버그 수정: String.replace()가 첫 번째 매칭만 교체하던 문제를
 * split().join() 패턴으로 변경하여 모든 매칭을 교체하도록 수정.
 *
 * Validates: Requirements REQ-B1
 */

// editNote 테스트용 App 모킹
function makeApp(fileContent: string): any {
  const mockFile = new TFile();
  mockFile.path = "test/note.md";
  mockFile.basename = "note";

  return {
    vault: {
      getAbstractFileByPath: vi.fn((_path: string) => mockFile),
      read: vi.fn(async () => fileContent),
      modify: vi.fn(async () => {}),
    },
  };
}

function makeIndexer(): any {
  return { search: vi.fn().mockResolvedValue([]) };
}

describe("editNote() replaceAll 동작", () => {
  let app: any;
  let indexer: any;
  let executor: ToolExecutor;

  describe("동일 문자열 여러 번 등장 시 모두 교체", () => {
    beforeEach(() => {
      // "TODO"가 3번 등장하는 노트
      app = makeApp("- TODO 첫 번째\n- TODO 두 번째\n- TODO 세 번째");
      indexer = makeIndexer();
      executor = new ToolExecutor(app, indexer, () => "templates");
    });

    it("동일 문자열이 여러 번 등장하면 모두 교체된다", async () => {
      const result = await executor.execute("edit_note", {
        path: "test/note.md",
        find: "TODO",
        replace: "DONE",
      });

      expect(result).toContain(TOOL_I18N.en.notePatched(""));

      // modify에 전달된 내용에서 모든 TODO가 DONE으로 교체되었는지 확인
      const modifiedContent = app.vault.modify.mock.calls[0][1] as string;
      expect(modifiedContent).toBe("- DONE 첫 번째\n- DONE 두 번째\n- DONE 세 번째");
      expect(modifiedContent).not.toContain("TODO");
    });
  });

  describe("단일 매칭 시 기존 동작 보존", () => {
    beforeEach(() => {
      app = makeApp("제목: 초안\n본문 내용입니다.");
      indexer = makeIndexer();
      executor = new ToolExecutor(app, indexer, () => "templates");
    });

    it("한 번만 등장하는 문자열도 정상 교체된다", async () => {
      const result = await executor.execute("edit_note", {
        path: "test/note.md",
        find: "초안",
        replace: "최종본",
      });

      expect(result).toContain(TOOL_I18N.en.notePatched(""));
      const modifiedContent = app.vault.modify.mock.calls[0][1] as string;
      expect(modifiedContent).toBe("제목: 최종본\n본문 내용입니다.");
    });
  });

  describe("find 텍스트가 없을 때 에러 반환", () => {
    beforeEach(() => {
      app = makeApp("아무 내용");
      indexer = makeIndexer();
      executor = new ToolExecutor(app, indexer, () => "templates");
    });

    it("교체 대상이 없으면 에러 메시지를 반환한다", async () => {
      const result = await executor.execute("edit_note", {
        path: "test/note.md",
        find: "존재하지않는텍스트",
        replace: "새텍스트",
      });

      expect(result).toContain(TOOL_I18N.en.findNotFound("존재하지않는텍스트"));
      expect(isToolError(result)).toBe(true);
      expect(app.vault.modify).not.toHaveBeenCalled();
    });
  });

  describe("정규식 특수문자 포함 시 안전 교체", () => {
    beforeEach(() => {
      // 정규식 특수문자가 포함된 텍스트
      app = makeApp("가격: $10.00 할인: $10.00");
      indexer = makeIndexer();
      executor = new ToolExecutor(app, indexer, () => "templates");
    });

    it("정규식 특수문자가 포함된 문자열도 안전하게 모두 교체된다", async () => {
      const result = await executor.execute("edit_note", {
        path: "test/note.md",
        find: "$10.00",
        replace: "$5.00",
      });

      expect(result).toContain(TOOL_I18N.en.notePatched(""));
      const modifiedContent = app.vault.modify.mock.calls[0][1] as string;
      expect(modifiedContent).toBe("가격: $5.00 할인: $5.00");
    });
  });
});

describe("도구 실패 계약", () => {
  it("존재하지 않는 노트 읽기는 실패 접두사를 반환한다", async () => {
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn(() => null),
      },
    };
    const executor = new ToolExecutor(app as any, makeIndexer(), () => "templates");

    const result = await executor.execute("read_note", { path: "missing.md" });

    expect(isToolError(result)).toBe(true);
    expect(result).toContain(TOOL_I18N.en.notFound(""));
  });
});

describe("applyTemplate() 변수 치환", () => {
  it("변수명 정규식 문자와 값의 달러 기호를 그대로 치환한다", async () => {
    const template = new TFile();
    template.path = "templates/sample.md";
    template.basename = "sample";
    template.extension = "md";
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) =>
          path === template.path ? template : null
        ),
        cachedRead: vi.fn(async () => "{{a[}} / {{price.$}}"),
        createFolder: vi.fn(),
        create: vi.fn(),
      },
      workspace: {
        getLeaf: vi.fn(() => ({ openFile: vi.fn() })),
      },
    };
    const executor = new ToolExecutor(app as any, makeIndexer(), () => "templates");

    await executor.execute("apply_template", {
      template_name: "sample",
      output_path: "result.md",
      variables: { "a[": "$&", "price.$": "$1" },
    });

    expect(app.vault.create).toHaveBeenCalledWith("result.md", "$& / $1");
  });
});
