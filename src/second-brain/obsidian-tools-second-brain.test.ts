// Second Brain 도구 와이어링 단위 테스트 (ToolExecutor)
// =====================================================
// create_wiki_note / update_index 도구가 모킹된 Vault 위에서 올바르게 동작하는지
// 예시 기반으로 검증한다. 순수 함수(buildAiFirstNote/buildIndexCatalog/upsertGeneratedBlock)는
// 각 모듈 테스트에서 다루므로, 여기서는 "와이어링"(경로 결정·범위 검증·충돌·옵트인 격리·
// 사용자 메모 보존)에 집중한다.
//
// 검증 항목:
// - create_wiki_note가 올바른 위키 경로에 노트를 생성한다 (Req 6.2)
// - 경로 충돌 시 덮어쓰지 않고 충돌 메시지를 반환한다 (Req 6.6)
// - Wiki_Folder 밖 쓰기(title에 "../" 포함)는 거부된다 (Req 6.3)
// - enabled=false면 쓰기 없이 비활성 안내를 반환한다 (Req 6.4)
// - update_index가 사용자 메모(User_Region)를 보존하며 카탈로그를 갱신한다 (Req 6.5)

import { describe, it, expect, vi, beforeEach } from "vitest";

// 기본 obsidian 모킹의 normalizePath는 경로를 그대로 반환하므로 "../" 탈출을 검증할 수 없다.
// 따라서 이 테스트에서는 ".."/"."를 실제로 해석하는 POSIX 스타일 정규화로 normalizePath만
// 오버라이드한다(TFile/Notice 등 나머지 모킹은 그대로 사용).
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  return {
    ...actual,
    normalizePath: (p: string) => normalizePosix(p),
  };
});

// 함수 선언은 호이스팅되므로 위 vi.mock 팩토리에서 안전하게 참조된다.
function normalizePosix(input: string): string {
  const parts = String(input).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

import { TFile } from "obsidian";
import { ToolExecutor } from "../obsidian-tools";
import { upsertGeneratedBlock } from "./sentinel-blocks";
import type { SecondBrainSettings } from "../types";

const WIKI = "Second Brain";

/** 기본 활성 설정(테스트별로 enabled/wikiFolder를 덮어쓸 수 있다). */
function makeSettings(overrides: Partial<SecondBrainSettings> = {}): SecondBrainSettings {
  return {
    enabled: true,
    wikiFolder: WIKI,
    schedulerEnabled: false,
    schedulerIntervalHours: 24,
    lastScheduledRun: 0,
    ...overrides,
  };
}

/** 모킹 TFile 생성 — instanceof TFile 분기를 통과하고 basename을 보유한다. */
function makeFile(path: string, content = ""): any {
  const f: any = new TFile();
  f.path = path;
  const name = path.split("/").pop() ?? path;
  f.basename = name.endsWith(".md") ? name.slice(0, -3) : name;
  f.extension = "md";
  f.content = content;
  return f;
}

/** 폴더 엔트리(plain object) — TFile 인스턴스가 아니어야 한다. */
function makeFolder(path: string): any {
  const name = path.split("/").pop() ?? path;
  return { path, name, children: [] };
}

/**
 * 가짜 Vault: getAbstractFileByPath/createFolder/create/read/modify/getMarkdownFiles를 spy로 제공.
 * initialFiles는 마크다운 파일(getMarkdownFiles 반환 대상), initialFolders는 폴더 엔트리다.
 */
function makeVault(initialFiles: any[] = [], initialFolders: any[] = []) {
  const map = new Map<string, any>();
  for (const f of initialFiles) map.set(f.path, f);
  for (const d of initialFolders) map.set(d.path, d);

  return {
    getAbstractFileByPath: vi.fn((p: string) => map.get(p) ?? null),
    getMarkdownFiles: vi.fn(() => initialFiles),
    createFolder: vi.fn(async (p: string) => {
      const folder = makeFolder(p);
      map.set(p, folder);
      return folder;
    }),
    create: vi.fn(async (p: string, content: string) => {
      const f = makeFile(p, content);
      map.set(p, f);
      return f;
    }),
    read: vi.fn(async (f: any) => f.content ?? ""),
    modify: vi.fn(async (f: any, content: string) => {
      f.content = content;
    }),
    _map: map,
  };
}

/** 사용하지 않는 의존성(indexer/aiClient) 최소 스텁. */
function makeIndexer(): any {
  return { search: vi.fn().mockResolvedValue({ items: [] }) };
}
function makeAiClient(): any {
  return { converseLight: vi.fn().mockResolvedValue("") };
}

/** app + executor 셋업 헬퍼. */
function setup(settings: SecondBrainSettings, vault: ReturnType<typeof makeVault>) {
  const app: any = { vault };
  const executor = new ToolExecutor(
    app,
    makeIndexer(),
    () => "templates",
    () => settings,
    () => makeAiClient(),
  );
  return { app, executor };
}

describe("create_wiki_note — 위키 경로 생성 (Req 6.2)", () => {
  it("카테고리 노트를 Wiki_Folder 하위 카테고리 경로에 생성한다", async () => {
    const vault = makeVault();
    const { executor } = setup(makeSettings(), vault);

    const result = await executor.execute("create_wiki_note", {
      title: "Alpha",
      body: "본문 내용",
      category: "concepts",
    });

    const expectedPath = `${WIKI}/concepts/Alpha.md`;
    expect(result).toContain(expectedPath);
    expect(vault.create).toHaveBeenCalledTimes(1);
    const [createdPath, createdContent] = vault.create.mock.calls[0];
    expect(createdPath).toBe(expectedPath);
    // AI-first 규격: 프론트매터 + "## For future AI" 프리앰블을 포함한다
    expect(createdContent).toContain("title: \"Alpha\"");
    expect(createdContent).toContain("## For future AI");
    expect(createdContent).toContain("본문 내용");
  });

  it("표준 카테고리가 아니면 Wiki_Folder 루트에 생성한다", async () => {
    const vault = makeVault();
    const { executor } = setup(makeSettings(), vault);

    const result = await executor.execute("create_wiki_note", {
      title: "Beta",
      body: "내용",
      category: "nonsense",
    });

    const expectedPath = `${WIKI}/Beta.md`;
    expect(result).toContain(expectedPath);
    expect(vault.create).toHaveBeenCalledWith(expectedPath, expect.any(String));
  });
});

describe("create_wiki_note — 경로 충돌 시 덮어쓰지 않음 (Req 6.6)", () => {
  it("동일 경로 노트가 이미 있으면 충돌 메시지를 반환하고 쓰지 않는다", async () => {
    const existingPath = `${WIKI}/concepts/Alpha.md`;
    const vault = makeVault([makeFile(existingPath, "기존 내용")]);
    const { executor } = setup(makeSettings(), vault);

    const result = await executor.execute("create_wiki_note", {
      title: "Alpha",
      body: "새 내용",
      category: "concepts",
    });

    expect(result).toContain("이미 존재");
    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.modify).not.toHaveBeenCalled();
  });
});

describe("create_wiki_note — Wiki_Folder 밖 쓰기 거부 (Req 6.3)", () => {
  it("title에 \"../\"가 포함되어 위키 폴더를 벗어나면 거부한다", async () => {
    const vault = makeVault();
    const { executor } = setup(makeSettings(), vault);

    const result = await executor.execute("create_wiki_note", {
      title: "../evil",
      body: "탈출 시도",
    });

    expect(result).toContain("허용되지 않");
    expect(vault.create).not.toHaveBeenCalled();
  });
});

describe("create_wiki_note / update_index — 옵트인 격리 (Req 6.4)", () => {
  it("enabled=false면 create_wiki_note는 쓰기 없이 비활성 안내를 반환한다", async () => {
    const vault = makeVault();
    const { executor } = setup(makeSettings({ enabled: false }), vault);

    const result = await executor.execute("create_wiki_note", {
      title: "Gamma",
      body: "내용",
      category: "concepts",
    });

    expect(result).toContain("비활성");
    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.createFolder).not.toHaveBeenCalled();
  });

  it("enabled=false면 update_index도 쓰기 없이 비활성 안내를 반환한다", async () => {
    const vault = makeVault();
    const { executor } = setup(makeSettings({ enabled: false }), vault);

    const result = await executor.execute("update_index", {});

    expect(result).toContain("비활성");
    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.modify).not.toHaveBeenCalled();
  });
});

describe("update_index — 카탈로그 갱신 + 사용자 메모 보존 (Req 6.5)", () => {
  it("기존 index.md의 User_Region을 보존하며 catalog 블록만 갱신한다", async () => {
    const userMemo = "## 내 메모\n직접 작성한 내용 — 보존되어야 함";
    const indexPath = `${WIKI}/index.md`;
    // 사용자 메모 + 옛 카탈로그 블록이 섞인 index.md
    const initialIndex =
      upsertGeneratedBlock(`${userMemo}\n`, "catalog", "# 📚 Index\n\n_옛 카탈로그_\n");
    const indexFile = makeFile(indexPath, initialIndex);
    const noteA = makeFile(`${WIKI}/concepts/Alpha.md`, "내용");

    // getMarkdownFiles는 위키 노트 + index.md를 모두 반환(index.md는 수집에서 제외되어야 함)
    const vault = makeVault([indexFile, noteA], [makeFolder(WIKI)]);
    const { executor } = setup(makeSettings(), vault);

    const result = await executor.execute("update_index", {});

    expect(result).toContain("갱신");
    // index.md는 새로 만들지 않고 기존 파일을 수정한다
    expect(vault.modify).toHaveBeenCalled();
    const modifyCall = vault.modify.mock.calls.find(
      (c: any[]) => c[0]?.path === indexPath,
    );
    expect(modifyCall).toBeDefined();
    const written = modifyCall![1] as string;

    // 사용자 메모는 그대로 보존된다
    expect(written).toContain(userMemo);
    // 새 카탈로그 항목이 반영되고 옛 카탈로그 본문은 사라진다
    expect(written).toContain(`[[${WIKI}/concepts/Alpha.md|Alpha]]`);
    expect(written).not.toContain("_옛 카탈로그_");
  });
});
