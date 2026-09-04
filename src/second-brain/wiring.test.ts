// Second Brain 전체 와이어링 스모크 테스트 (Task 11.3)
// =====================================================
// 두 가지를 예시(smoke) 기반으로 검증한다.
//
// 1) 설정 라운드트립 (Req 12.2)
//    - normalizeSecondBrainSettings가 직렬화(JSON)→역직렬화→정규화 라운드트립에서
//      값을 보존한다.
//    - DEFAULT_SETTINGS가 secondBrain 기본값(DEFAULT_SECOND_BRAIN_SETTINGS)을 포함한다.
//
// 2) 옵트인 격리 (Req 12.4)
//    - secondBrain.enabled=false인 동안 second-brain 능동 도구
//      (create_wiki_note / update_index / synthesize_topic / reconcile_topic /
//       architect / challenge / connect / emerge)는 볼트에 아무 쓰기도 하지 않고
//      (create/modify/createFolder/append/rename/trash 미호출) 비활성 안내만 반환한다.
//    - 기존 도구(read_note / list_files)는 enabled=false에서도 평소대로 동작한다.
//
// 순수 함수의 세부 동작은 각 모듈 테스트에서 다루므로, 여기서는 "전체 연결(wiring)"과
// 옵트인 격리 불변식만 확인한다.

import { describe, it, expect, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import { ToolExecutor } from "../obsidian-tools";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SECOND_BRAIN_SETTINGS,
  normalizeSecondBrainSettings,
  type SecondBrainSettings,
} from "../types";
import { TOOL_I18N } from "../tool-result-i18n";

// ---------------------------------------------------------------------------
// 1) 설정 저장/로드 라운드트립 (Req 12.2)
// ---------------------------------------------------------------------------

describe("설정 라운드트립 (Req 12.2)", () => {
  it("DEFAULT_SETTINGS는 secondBrain 기본값을 포함한다", () => {
    // 플러그인 전역 기본 설정에 Second Brain 기본값이 그대로 반영되어야 한다.
    expect(DEFAULT_SETTINGS.secondBrain).toEqual(DEFAULT_SECOND_BRAIN_SETTINGS);
  });

  it("직렬화→역직렬화→정규화 라운드트립이 값을 보존한다", () => {
    // 사용자가 설정 탭에서 변경한 뒤 저장(data.json 직렬화)되는 상황을 모사한다.
    const saved: SecondBrainSettings = {
      enabled: true,
      wikiFolder: "Knowledge/Brain",
      schedulerEnabled: true,
      schedulerIntervalHours: 12,
      lastScheduledRun: 1_700_000_000_000,
      accessLog: { "note.md": 1_700_000_000_000 },
      reviewSurfaced: {},
    };

    // JSON 직렬화/역직렬화 후 normalize(로드 경로와 동일)
    const roundTripped = normalizeSecondBrainSettings(
      JSON.parse(JSON.stringify(saved)),
    );

    expect(roundTripped).toEqual(saved);
  });

  it("DEFAULT 값도 라운드트립에서 보존된다", () => {
    const roundTripped = normalizeSecondBrainSettings(
      JSON.parse(JSON.stringify(DEFAULT_SECOND_BRAIN_SETTINGS)),
    );
    expect(roundTripped).toEqual(DEFAULT_SECOND_BRAIN_SETTINGS);
  });

  it("정규화 결과는 입력과 동일 참조가 아니다(복사본)", () => {
    const input = { ...DEFAULT_SECOND_BRAIN_SETTINGS };
    const result = normalizeSecondBrainSettings(input);
    expect(result).not.toBe(input);
    expect(result).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// 2) 옵트인 격리 스모크 (Req 12.4)
// ---------------------------------------------------------------------------

const WIKI = "Second Brain";

/** enabled=false 비활성 설정. */
function disabledSettings(): SecondBrainSettings {
  return {
    enabled: false,
    wikiFolder: WIKI,
    schedulerEnabled: false,
    schedulerIntervalHours: 24,
    lastScheduledRun: 0,
  };
}

/** instanceof TFile 분기를 통과하는 모킹 TFile. */
function makeFile(path: string, content = ""): any {
  const f: any = new TFile();
  f.path = path;
  const name = path.split("/").pop() ?? path;
  f.name = name;
  f.basename = name.endsWith(".md") ? name.slice(0, -3) : name;
  f.extension = "md";
  f.content = content;
  return f;
}

/** instanceof TFolder 분기를 통과하는 모킹 TFolder(children 보유). */
function makeFolder(path: string, children: any[] = []): any {
  const fo: any = new TFolder();
  fo.path = path;
  fo.name = path.split("/").pop() ?? path;
  fo.children = children;
  return fo;
}

/**
 * 모든 쓰기 경로(create/modify/createFolder/append/rename/trash)를 spy로 제공하는 가짜 Vault.
 * 옵트인 격리 검증의 핵심은 "이 spy들이 한 번도 호출되지 않는다"는 점이다.
 */
function makeVault(files: any[] = [], folders: any[] = []) {
  const map = new Map<string, any>();
  for (const f of files) map.set(f.path, f);
  for (const d of folders) map.set(d.path, d);

  // list_files 루트로 사용할 폴더(자식: 마크다운 파일들)
  const root = makeFolder("", files);

  return {
    getRoot: vi.fn(() => root),
    getAbstractFileByPath: vi.fn((p: string) => map.get(p) ?? null),
    getMarkdownFiles: vi.fn(() => files),
    cachedRead: vi.fn(async (f: any) => f.content ?? ""),
    read: vi.fn(async (f: any) => f.content ?? ""),
    // --- 쓰기 spy (호출되면 옵트인 격리 위반) ---
    create: vi.fn(async (p: string, content: string) => makeFile(p, content)),
    modify: vi.fn(async (f: any, content: string) => {
      f.content = content;
    }),
    createFolder: vi.fn(async (p: string) => makeFolder(p)),
    append: vi.fn(async (_f: any, _c: string) => {}),
    rename: vi.fn(async (_f: any, _p: string) => {}),
    trash: vi.fn(async (_f: any, _sys: boolean) => {}),
    _map: map,
  };
}

/** indexer 스텁 — second-brain 검색 경로가 (도달한다면) 빈 결과를 반환. */
function makeIndexer(): any {
  return {
    search: vi.fn().mockResolvedValue({ items: [], invalidQuery: false }),
    getEntries: vi.fn(() => []),
  };
}

/** AI 클라이언트 스텁 — enabled=false에서는 도달하지 않아야 한다. */
function makeAiClient(): any {
  return { converseLight: vi.fn().mockResolvedValue({ text: "" }) };
}

/** 비활성 설정 + 쓰기 spy 볼트로 구성한 ToolExecutor. */
function setupDisabled(vault: ReturnType<typeof makeVault>) {
  const app: any = { vault };
  const executor = new ToolExecutor(
    app,
    makeIndexer(),
    () => "Templates",
    () => disabledSettings(),
    () => makeAiClient(),
  );
  return { app, executor };
}

/** 볼트 쓰기 spy가 하나도 호출되지 않았음을 단언한다. */
function expectNoWrites(vault: ReturnType<typeof makeVault>) {
  expect(vault.create).not.toHaveBeenCalled();
  expect(vault.modify).not.toHaveBeenCalled();
  expect(vault.createFolder).not.toHaveBeenCalled();
  expect(vault.append).not.toHaveBeenCalled();
  expect(vault.rename).not.toHaveBeenCalled();
  expect(vault.trash).not.toHaveBeenCalled();
}

describe("옵트인 격리 — enabled=false면 second-brain 도구가 쓰기를 하지 않는다 (Req 12.4)", () => {
  // 각 능동 도구의 입력 예시. enabled=false이면 모두 진입 즉시 비활성 안내를 반환해야 한다.
  const activeToolCalls: Array<[string, Record<string, unknown>]> = [
    ["create_wiki_note", { title: "Alpha", body: "본문", category: "concepts" }],
    ["update_index", {}],
    ["synthesize_topic", { topic: "주제" }],
    ["reconcile_topic", { topic: "주제" }],
    ["architect", { path: "src" }],
    ["challenge", { claim: "주장" }],
    ["connect", { topicA: "A", topicB: "B" }],
    ["emerge", { days: 7 }],
  ];

  it.each(activeToolCalls)(
    "%s는 비활성 안내를 반환하고 볼트에 쓰지 않는다",
    async (toolName, input) => {
      const vault = makeVault();
      const { executor } = setupDisabled(vault);

      const result = await executor.execute(toolName, input);

      // 비활성 안내 메시지 반환 (Req 6.4 패턴 / Req 12.4)
      expect(result).toContain(TOOL_I18N.en.sbDisabled);
      // 어떤 쓰기 경로도 호출되지 않는다
      expectNoWrites(vault);
    },
  );

  it("모든 능동 도구를 연속 호출해도 볼트 쓰기가 전혀 발생하지 않는다", async () => {
    const vault = makeVault();
    const { executor } = setupDisabled(vault);

    for (const [toolName, input] of activeToolCalls) {
      await executor.execute(toolName, input);
    }

    expectNoWrites(vault);
  });
});

describe("옵트인 격리 — enabled=false에서도 기존 도구는 정상 동작한다 (Req 12.4)", () => {
  it("read_note는 노트 내용을 그대로 반환한다", async () => {
    const notePath = "Inbox/Note.md";
    const vault = makeVault([makeFile(notePath, "기존 노트 본문")]);
    const { executor } = setupDisabled(vault);

    const result = await executor.execute("read_note", { path: notePath });

    expect(result).toContain("기존 노트 본문");
    // 읽기 도구는 쓰기를 유발하지 않는다
    expectNoWrites(vault);
  });

  it("list_files는 루트 파일 목록을 반환한다", async () => {
    const vault = makeVault([
      makeFile("A.md", ""),
      makeFile("B.md", ""),
    ]);
    const { executor } = setupDisabled(vault);

    const result = await executor.execute("list_files", { folder: "" });

    expect(result).toContain("A.md");
    expect(result).toContain("B.md");
    expectNoWrites(vault);
  });
});
