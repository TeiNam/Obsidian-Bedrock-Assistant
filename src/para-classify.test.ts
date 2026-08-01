import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class {},
  TFolder: class {},
  Notice: class {},
  normalizePath: (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, ""),
}));

import { TFolder } from "obsidian";
import {
  parseCategory,
  organizeVaultPara,
  collectProtectedFolders,
  PARA_MAX_CLASSIFICATIONS,
} from "./para-organizer";

/** cleanEmptyFolders는 `f instanceof TFolder`로 필터하므로 mock 클래스의 인스턴스여야 한다. */
function makeFolder(path: string, children: unknown[] = []): TFolder {
  return Object.assign(new (TFolder as new () => TFolder)(), { path, children }) as TFolder;
}

// ============================================
// P.A.R.A 분류 응답 파싱 회귀 테스트
// ============================================
// 배경(리뷰 확인 결함):
//  1) 분류 실패 시 무조건 "resources"로 이동해 사용자 폴더 구조를 임의 재배치했다.
//  2) 단순 includes 매칭은 실패 응답("cannot choose projects, areas, ...")도
//     첫 카테고리로 오판해 노트를 잘못 옮긴다.

describe("parseCategory: 정상 응답", () => {
  it("카테고리 단어만 있는 응답을 인식한다", () => {
    expect(parseCategory("projects")).toBe("projects");
    expect(parseCategory("areas")).toBe("areas");
    expect(parseCategory("resources")).toBe("resources");
    expect(parseCategory("archives")).toBe("archives");
  });

  it("대소문자·공백·구두점을 허용한다", () => {
    expect(parseCategory("  Projects  ")).toBe("projects");
    expect(parseCategory("ARCHIVES.")).toBe("archives");
    expect(parseCategory("**areas**")).toBe("areas");
    expect(parseCategory('"resources"')).toBe("resources");
  });

  it("마지막 줄에서 분류를 철회한 응답은 앞선 후보를 채택하지 않는다", () => {
    // 뒤로 계속 거슬러 올라가면 "projects"를 채택해 노트를 잘못 옮긴다.
    expect(parseCategory("projects\nCorrection: I cannot classify this note.")).toBeNull();
  });

  it("글자 없는 줄(구분선)은 건너뛰고 판정한다", () => {
    expect(parseCategory("archives\n---")).toBe("archives");
  });

  it("추론 서두 뒤 마지막 줄의 결론을 사용한다", () => {
    // 추론 모델은 사고 과정을 쓴 뒤 마지막에 답을 적는 경우가 있다.
    expect(parseCategory("이 노트는 진행 중인 작업으로 보입니다.\nprojects")).toBe("projects");
    expect(parseCategory("Let me think...\n\nAnswer:\narchives")).toBe("archives");
  });
});

describe("parseCategory: 실패 응답을 정상 분류로 오인하지 않는다", () => {
  it("카테고리 단어가 문장에 섞인 실패 응답은 null이다", () => {
    // 핵심 회귀 케이스 — includes 매칭이면 "projects"로 오판한다.
    expect(parseCategory("cannot choose projects, areas, resources, or archives")).toBeNull();
    expect(parseCategory("I am unable to classify this note into projects")).toBeNull();
  });

  it("빈/공백 응답은 null이다", () => {
    expect(parseCategory("")).toBeNull();
    expect(parseCategory("   \n  ")).toBeNull();
  });

  it("카테고리가 아닌 단어는 null이다", () => {
    expect(parseCategory("unknown")).toBeNull();
    expect(parseCategory("misc")).toBeNull();
  });

  it("null/undefined 입력을 안전하게 처리한다", () => {
    expect(parseCategory(undefined as unknown as string)).toBeNull();
    expect(parseCategory(null as unknown as string)).toBeNull();
  });
});

describe("PARA_MAX_CLASSIFICATIONS: 호출 상한", () => {
  it("노트당 1회 LLM 호출이므로 상한이 정의되어 있다", () => {
    // 상한이 없으면 대형 볼트에서 비용·소요 시간이 통제 불가로 커진다.
    expect(PARA_MAX_CLASSIFICATIONS).toBeGreaterThan(0);
    expect(Number.isInteger(PARA_MAX_CLASSIFICATIONS)).toBe(true);
  });
});

// ============================================
// 호출 예산 회귀 테스트 (굶주림 방지)
// ============================================
// 기존 구현은 "파일 수" 상한(slice)이었다. 앞자리 파일이 LLM 호출 없이 건너뛰어도
// 슬롯을 점거하므로, 재실행할 때마다 같은 파일들이 앞에 오고 뒤쪽 파일은 영구히
// 처리되지 않았다. 지금은 실제 LLM "호출 수"만 예산에서 차감한다.

interface FakeFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
}

function makeFile(path: string): FakeFile {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return { path, name, basename: name.replace(/\.md$/, ""), extension: "md" };
}

function makeParaEnv(
  fileCount: number,
  existingTargets: Set<string> = new Set(),
  extraPaths: string[] = []
) {
  const files: FakeFile[] = [
    ...Array.from({ length: fileCount }, (_, i) => makeFile(`note${i}.md`)),
    ...extraPaths.map(makeFile),
  ];
  const renamed: string[] = [];
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => files,
      cachedRead: async () => "본문",
      // P.A.R.A 폴더는 이미 존재한다고 보고, 이동 대상 충돌만 제어한다.
      getAbstractFileByPath: (p: string) =>
        p.startsWith("0") && !p.includes("/") ? {} : existingTargets.has(p) ? {} : null,
      createFolder: async () => {},
      rename: async (f: FakeFile, to: string) => {
        renamed.push(to);
      },
      getAllLoadedFiles: () => [],
      delete: async () => {},
    },
  };
  return { app, files, renamed };
}

function makePlugin(respond: () => string, settings?: Record<string, unknown>) {
  const calls = { count: 0 };
  const plugin = {
    settings,
    aiClient: {
      converseLight: async () => {
        calls.count++;
        return { text: respond() };
      },
    },
  };
  return { plugin, calls };
}

describe("organizeVaultPara: LLM 호출 예산", () => {
  it("네 폴더 모두 이름이 충돌하는 파일은 호출 없이 건너뛴다", async () => {
    // note0은 어떤 분류가 나와도 이동할 수 없다 → 호출 예산을 써서는 안 된다.
    const collide = new Set([
      "01. Projects/note0.md",
      "02. Areas/note0.md",
      "03. Resources/note0.md",
      "04. Archives/note0.md",
    ]);
    const { app } = makeParaEnv(3, collide);
    const { plugin, calls } = makePlugin(() => "resources");

    const result = await organizeVaultPara(app as never, plugin as never);

    // note1, note2만 호출한다. note0에 호출을 쓰면 매 실행마다 예산을 낭비한다.
    expect(calls.count).toBe(2);
    expect(result.skipped).toContain("note0.md");
    expect(result.moved.map((m) => m.from)).toEqual(["note1.md", "note2.md"]);
  });

  it("분류 실패는 skipped가 아니라 errors로 보고한다", async () => {
    const { app } = makeParaEnv(1);
    // 카테고리로 판별할 수 없는 응답 → 이동하지 않는다.
    const { plugin } = makePlugin(() => "I cannot decide.");

    const result = await organizeVaultPara(app as never, plugin as never);

    expect(result.moved).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.errors.some((e) => e.includes("note0.md") && e.includes("분류 실패"))).toBe(true);
  });

  it("형식 불일치가 연속돼도 중단하지 않고 뒤쪽 파일을 계속 처리한다", async () => {
    // 앞의 12개는 항상 분류 불가, 그 뒤는 정상인 볼트를 만든다.
    const { app } = makeParaEnv(15);
    let n = 0;
    const { plugin } = makePlugin(() => (n++ < 12 ? "I cannot decide." : "resources"));

    const result = await organizeVaultPara(app as never, plugin as never);

    // 핵심: 앞의 실패가 뒤쪽 정상 파일을 굶겨서는 안 된다.
    expect(result.moved.length).toBe(3);
    expect(result.errors.filter((e) => e.includes("분류 실패")).length).toBe(12);
  });

  it("호출 예외가 연속되면 중단하고 남은 파일을 보고한다", async () => {
    const { app } = makeParaEnv(30);
    const calls = { count: 0 };
    const plugin = {
      aiClient: {
        converseLight: async () => {
          calls.count++;
          throw new Error("AccessDeniedException");
        },
      },
    };

    const result = await organizeVaultPara(app as never, plugin as never);

    // 상한(200)까지 태우지 않고 연속 예외 임계에서 멈춘다.
    expect(calls.count).toBeLessThan(30);
    expect(result.errors.some((e) => e.includes("연속 실패해 중단"))).toBe(true);
    expect(result.errors.some((e) => e.includes("중단으로"))).toBe(true);
  });
});

// ============================================
// 플러그인 자기 폴더 보호 회귀 테스트
// ============================================
// 배경: organizeVaultPara는 getMarkdownFiles()로 볼트 전체를 훑고, shouldSkip은
// P.A.R.A 4폴더·configDir·.obsidian만 제외했다. 그 결과 플러그인이 스스로 만든
// ToDo/·Templates/·WebClips/·Second Brain/ 노트가 전부 분류·이동 대상이 되고,
// 이어서 cleanEmptyFolders가 비워진 원본 폴더를 삭제했다.
// 이후 To-Do 이월·회고·템플릿 로드·위키 경로가 조용히 멈춘다(사용자는 원인을 알 수 없다).

const PLUGIN_SETTINGS = {
  todoFolder: "ToDo",
  templateFolder: "Templates",
  webClipFolder: "WebClips",
  todoArchiveFolder: "ToDo/Archive",
  archiveCleanFolder: "ToDo/Archive",
  secondBrain: { wikiFolder: "Second Brain" },
};

describe("collectProtectedFolders", () => {
  it("설정된 플러그인 전용 폴더를 모두 수집한다", () => {
    const folders = collectProtectedFolders(PLUGIN_SETTINGS as never);
    expect(folders).toContain("ToDo");
    expect(folders).toContain("Templates");
    expect(folders).toContain("WebClips");
    expect(folders).toContain("Second Brain");
  });

  it("빈 문자열·공백 폴더는 제외한다", () => {
    // 빈 값이 목록에 들어가면 startsWith("/")로 볼트 전체가 보호되어 정리가 no-op이 된다.
    const folders = collectProtectedFolders({
      todoFolder: "",
      templateFolder: "   ",
      webClipFolder: "WebClips",
      secondBrain: { wikiFolder: "" },
    } as never);
    expect(folders).toEqual(["WebClips"]);
  });

  it("settings가 없어도 빈 배열을 반환한다", () => {
    expect(collectProtectedFolders(undefined as never)).toEqual([]);
    expect(collectProtectedFolders({} as never)).toEqual([]);
  });

  it("중복 폴더는 한 번만 담는다", () => {
    const folders = collectProtectedFolders({
      todoFolder: "ToDo",
      todoArchiveFolder: "ToDo",
      templateFolder: "ToDo",
    } as never);
    expect(folders).toEqual(["ToDo"]);
  });
});

describe("organizeVaultPara: 플러그인 전용 폴더 보호", () => {
  it("ToDo·Templates·WebClips·Second Brain 노트를 이동하지 않는다", async () => {
    const { app, renamed } = makeParaEnv(0, new Set(), [
      "ToDo/2026-08-02 To-Do.md",
      "ToDo/Archive/2026-07-01 To-Do.md",
      "Templates/Daily To-Do.md",
      "WebClips/some-article.md",
      "Second Brain/concepts/Vector Search.md",
      "Second Brain/Knowledge Gaps.md",
    ]);
    const { plugin, calls } = makePlugin(() => "resources", PLUGIN_SETTINGS);

    const result = await organizeVaultPara(app as never, plugin as never);

    // 호출 자체가 없어야 한다 — 분류 후 스킵이 아니라 후보에서 빠져야 토큰도 안 쓴다.
    expect(calls.count).toBe(0);
    expect(renamed).toEqual([]);
    expect(result.moved).toEqual([]);
  });

  it("보호 폴더 밖의 노트는 그대로 정리한다", async () => {
    const { app, renamed } = makeParaEnv(2, new Set(), ["ToDo/2026-08-02 To-Do.md"]);
    const { plugin, calls } = makePlugin(() => "resources", PLUGIN_SETTINGS);

    const result = await organizeVaultPara(app as never, plugin as never);

    expect(calls.count).toBe(2);
    expect(result.moved.map((m) => m.from)).toEqual(["note0.md", "note1.md"]);
    expect(renamed).toEqual(["03. Resources/note0.md", "03. Resources/note1.md"]);
  });

  it("폴더 이름이 접두사로 겹치는 노트는 보호하지 않는다", async () => {
    // "ToDoList/"는 "ToDo"로 시작하지만 다른 폴더다. 세그먼트 경계로 비교해야 한다.
    const { app } = makeParaEnv(0, new Set(), ["ToDoList/plan.md"]);
    const { plugin, calls } = makePlugin(() => "projects", PLUGIN_SETTINGS);

    const result = await organizeVaultPara(app as never, plugin as never);

    expect(calls.count).toBe(1);
    expect(result.moved.map((m) => m.from)).toEqual(["ToDoList/plan.md"]);
  });

  it("보호 폴더는 비어 있어도 삭제하지 않는다", async () => {
    const deleted: string[] = [];
    // 후보 파일이 0건이면 organizeVaultPara가 cleanEmptyFolders 전에 조기 반환한다.
    const { app } = makeParaEnv(1);
    // Second Brain은 첫 실행 시 비어 있는 게 정상이다. 지우면 다음 실행에서 다시 만든다.
    const folders = [
      makeFolder("ToDo"),
      makeFolder("Second Brain"),
      makeFolder("Second Brain/concepts"),
      makeFolder("Junk"),
    ];
    app.vault.getAllLoadedFiles = () => folders as never;
    app.vault.delete = async (f: { path: string }) => {
      deleted.push(f.path);
    };
    const { plugin } = makePlugin(() => "resources", PLUGIN_SETTINGS);

    await organizeVaultPara(app as never, plugin as never);

    expect(deleted).toEqual(["Junk"]);
  });

  it("settings가 없으면 기존 동작을 유지한다", async () => {
    // 보호 목록이 비어도 정리가 no-op이 되어서는 안 된다.
    const { app } = makeParaEnv(2);
    const { plugin, calls } = makePlugin(() => "resources");

    const result = await organizeVaultPara(app as never, plugin as never);

    expect(calls.count).toBe(2);
    expect(result.moved.length).toBe(2);
  });
});
