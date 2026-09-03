import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile } from "obsidian";
import { ToolExecutor } from "./obsidian-tools";

/**
 * createNote() 폴더 자동 생성 테스트
 *
 * Property 1: Fault Condition - 중첩 경로 노트 생성 시 폴더 자동 생성
 *   createNote("folder/sub/note.md", "...") 호출 시 부모 폴더가 자동 생성되는지 확인
 *
 * Property 2: Preservation - 루트 레벨 노트 생성 동작 보존
 *   createNote("note.md", "...") 호출 시 폴더 생성 없이 바로 노트가 생성되는지 확인
 *
 * Validates: Requirements 2.10, 3.11
 */

// 최소한의 App 모킹
function makeApp(): any {
  const existingPaths = new Set<string>();

  return {
    vault: {
      // 경로 존재 여부 확인 - 기본적으로 아무것도 존재하지 않음
      getAbstractFileByPath: vi.fn((path: string) => {
        if (existingPaths.has(path)) {
          return { path };
        }
        return null;
      }),
      // 폴더 생성 모킹
      createFolder: vi.fn(async (path: string) => {
        existingPaths.add(path);
      }),
      // 파일 생성 모킹
      create: vi.fn(async (_path: string, _content: string) => {}),
    },
    // existingPaths를 외부에서 조작할 수 있도록 노출
    _existingPaths: existingPaths,
  };
}

// 최소한의 VaultIndexer 모킹
function makeIndexer(): any {
  return {
    search: vi.fn().mockResolvedValue([]),
  };
}

describe("createNote() 폴더 자동 생성", () => {
  let app: any;
  let indexer: any;
  let executor: ToolExecutor;

  beforeEach(() => {
    app = makeApp();
    indexer = makeIndexer();
    executor = new ToolExecutor(app, indexer, () => "templates");
  });

  // --- Property 1: Fault Condition ---
  // 중첩 경로 노트 생성 시 부모 폴더가 자동 생성되어야 함

  describe("Fault Condition - 중첩 경로 폴더 자동 생성 (Property 1)", () => {
    /**
     * **Validates: Requirements 2.10**
     */
    it("중첩 경로 노트 생성 시 부모 폴더가 자동 생성된다", async () => {
      const result = await executor.execute("create_note", {
        path: "folder/sub/note.md",
        content: "테스트 내용",
      });

      // 노트가 성공적으로 생성되어야 함
      expect(result).toContain("노트가 생성되었습니다");

      // 부모 폴더 "folder/sub"에 대해 createFolder가 호출되어야 함
      expect(app.vault.createFolder).toHaveBeenCalledWith("folder/sub");
    });

    it("단일 레벨 폴더 경로에서도 폴더가 자동 생성된다", async () => {
      const result = await executor.execute("create_note", {
        path: "folder/note.md",
        content: "테스트 내용",
      });

      expect(result).toContain("노트가 생성되었습니다");
      expect(app.vault.createFolder).toHaveBeenCalledWith("folder");
    });

    it("부모 폴더가 이미 존재하면 createFolder를 호출하지 않는다", async () => {
      // 부모 폴더가 이미 존재하는 상태 설정
      app._existingPaths.add("folder/sub");

      const result = await executor.execute("create_note", {
        path: "folder/sub/note.md",
        content: "테스트 내용",
      });

      expect(result).toContain("노트가 생성되었습니다");
      // 폴더가 이미 존재하므로 createFolder가 호출되지 않아야 함
      expect(app.vault.createFolder).not.toHaveBeenCalled();
    });

    it("폴더 생성 후 파일이 정상적으로 생성된다", async () => {
      await executor.execute("create_note", {
        path: "deep/nested/path/note.md",
        content: "깊은 경로 테스트",
      });

      // createFolder가 먼저 호출되고, 그 다음 create가 호출되어야 함
      expect(app.vault.createFolder).toHaveBeenCalledWith("deep/nested/path");
      expect(app.vault.create).toHaveBeenCalledWith(
        "deep/nested/path/note.md",
        "깊은 경로 테스트"
      );
    });
  });

  // --- Property 2: Preservation ---
  // 루트 레벨 노트 생성 시 폴더 생성 없이 바로 노트가 생성되어야 함

  describe("Preservation - 루트 레벨 노트 생성 동작 보존 (Property 2)", () => {
    /**
     * **Validates: Requirements 3.11**
     */
    it("루트 레벨 노트 생성 시 createFolder가 호출되지 않는다", async () => {
      const result = await executor.execute("create_note", {
        path: "note.md",
        content: "루트 레벨 노트",
      });

      expect(result).toContain("노트가 생성되었습니다");
      // 루트 레벨이므로 폴더 생성이 필요 없음
      expect(app.vault.createFolder).not.toHaveBeenCalled();
    });

    it("루트 레벨 노트가 vault.create로 정상 생성된다", async () => {
      await executor.execute("create_note", {
        path: "simple.md",
        content: "간단한 노트",
      });

      expect(app.vault.create).toHaveBeenCalledWith("simple.md", "간단한 노트");
    });

    it("이미 존재하는 파일 경로에 대해 에러 메시지를 반환한다", async () => {
      // 파일이 이미 존재하는 상태 설정
      app._existingPaths.add("existing.md");

      const result = await executor.execute("create_note", {
        path: "existing.md",
        content: "중복 노트",
      });

      expect(result).toContain("파일이 이미 존재합니다");
      // 파일이 이미 존재하므로 create와 createFolder 모두 호출되지 않아야 함
      expect(app.vault.create).not.toHaveBeenCalled();
      expect(app.vault.createFolder).not.toHaveBeenCalled();
    });
  });

  describe("볼트 경로 안전성과 링크 보존 이동", () => {
    it("상위 디렉터리 탈출 경로는 쓰기 전에 거부한다", async () => {
      const result = await executor.execute("create_note", {
        path: "../outside.md",
        content: "쓰이면 안 됨",
      });

      expect(result).toContain("볼트를 벗어나는 경로");
      expect(app.vault.create).not.toHaveBeenCalled();
    });

    it("move_file은 링크를 갱신하는 fileManager.renameFile을 사용한다", async () => {
      const file = new TFile();
      file.path = "old.md";
      const renameFile = vi.fn(async () => {});
      const moveApp = {
        vault: {
          getAbstractFileByPath: vi.fn((path: string) => path === "old.md" ? file : null),
          createFolder: vi.fn(),
          rename: vi.fn(),
        },
        fileManager: { renameFile },
      } as any;
      const moveExecutor = new ToolExecutor(moveApp, makeIndexer(), () => "templates");

      const result = await moveExecutor.execute("move_file", {
        source_path: "old.md",
        destination_path: "Archive/old.md",
      });

      expect(result).toContain("이동했습니다");
      expect(renameFile).toHaveBeenCalledWith(file, "Archive/old.md");
      expect(moveApp.vault.rename).not.toHaveBeenCalled();
    });
  });
});
