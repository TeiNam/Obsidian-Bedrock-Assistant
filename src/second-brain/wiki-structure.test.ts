// 위키 구조/카탈로그 속성 테스트 + I/O 래퍼 모킹 테스트 (Wiki Structure)
// ====================================================================
// buildIndexCatalog의 출력 안정성을 fast-check 속성 테스트로 검증하고(Property 10),
// Vault I/O 래퍼(ensureWikiFolders/writeIndexCatalog/appendActivityLog)는 가짜 Vault를
// 주입하여 폴더 보장(없으면 생성/있으면 유지)·카탈로그 갱신 시 사용자 메모 보존·
// 로그 append(기존 로그 불변)를 검증한다(Req 4.1, 4.4, 4.5).

import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import fc from "fast-check";
import {
  buildIndexCatalog,
  ensureWikiFolders,
  writeIndexCatalog,
  appendActivityLog,
  WIKI_CATEGORIES,
  type CatalogEntry,
} from "./wiki-structure";

// WIKI_CATEGORIES에 속하는 카테고리와 그 밖의 값("기타"로 분류되어야 함)을 섞어
// 그룹핑/정렬 경로를 모두 자극하는 카테고리 제너레이터.
const categoryArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...WIKI_CATEGORIES),
  // WIKI_CATEGORIES 밖의 값들 — resolveCategory가 "기타"로 묶어야 한다 (Req 4.6)
  fc.constantFrom("기타", "unknown", "misc", "", "   ", "Entities", "PROJECTS"),
  fc.string(),
);

// 임의의 CatalogEntry (경로/제목/카테고리).
const entryArb: fc.Arbitrary<CatalogEntry> = fc.record({
  path: fc.string(),
  title: fc.string(),
  category: categoryArb,
});

// CatalogEntry 목록 제너레이터.
const entriesArb: fc.Arbitrary<CatalogEntry[]> = fc.array(entryArb, {
  maxLength: 30,
});

/**
 * 결정적 Fisher-Yates 셔플 — seed 기반 LCG로 동일 원소를 다른 순서로 재배열한다.
 * fast-check가 seed를 제공하므로 재현 가능하며, 입력 배열은 변형하지 않는다.
 */
function deterministicShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  let state = (seed >>> 0) || 1; // 0 회피
  const next = (): number => {
    // 32비트 LCG (Numerical Recipes 계수)
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

describe("buildIndexCatalog — 출력 안정성", () => {
  // Feature: second-brain-layer, Property 10: 카탈로그 빌드는 입력 순서에 무관하게 안정적이다
  // Validates: Requirements 4.2, 4.3, 4.6
  it("Property 10: 동일 원소의 순서만 다른 입력에 대해 출력이 동일하다", () => {
    fc.assert(
      fc.property(entriesArb, fc.integer(), (entries, seed) => {
        const shuffled = deterministicShuffle(entries, seed);
        expect(buildIndexCatalog(shuffled)).toBe(buildIndexCatalog(entries));
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================
// I/O 래퍼 모킹 테스트 (가짜 Vault 주입)
// ============================================
// 기존 todo-create.test.ts의 가짜 Vault 패턴을 따른다. 구현이 `instanceof TFile`로
// 파일을 식별하므로 파일 엔트리는 반드시 TFile 인스턴스로 만든다(폴더는 plain object).

/** 모킹된 TFile 인스턴스 생성 — instanceof TFile 분기를 통과해야 한다. */
function makeFile(path: string, content = ""): any {
  const f: any = new TFile();
  f.path = path;
  f.content = content;
  return f;
}

/** 폴더 엔트리(plain object) — 절대 TFile 인스턴스가 아니어야 한다. */
function makeFolder(path: string): any {
  const name = path.split("/").pop() ?? path;
  return { path, name, children: [] };
}

/** 가짜 Vault: getAbstractFileByPath/createFolder/create/read/modify/process를 spy로 제공한다. */
function makeVault(initial: any[] = []) {
  const map = new Map<string, any>();
  for (const e of initial) map.set(e.path, e);

  return {
    getAbstractFileByPath: vi.fn((p: string) => map.get(p) ?? null),
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
    // 실제 process는 원자적이지만, 단일 스레드 테스트에서는 읽기-변환-쓰기를
    // 그대로 이어붙이면 관찰 가능한 동작이 같다.
    process: vi.fn(async (f: any, fn: (data: string) => string) => {
      const next = fn(f.content ?? "");
      f.content = next;
      return next;
    }),
    _map: map,
  };
}

function makeApp(vault: any): any {
  return { vault };
}

describe("ensureWikiFolders — 폴더 보장(없으면 생성/있으면 유지) (Req 4.1)", () => {
  it("폴더가 모두 없으면 루트 + 카테고리 폴더를 생성한다", async () => {
    const vault = makeVault();
    await ensureWikiFolders(makeApp(vault), "Second Brain");

    // 루트 + 카테고리(entities/concepts/projects) = 1 + 3
    expect(vault.createFolder).toHaveBeenCalledTimes(1 + WIKI_CATEGORIES.length);
    expect(vault.createFolder).toHaveBeenCalledWith("Second Brain");
    for (const category of WIKI_CATEGORIES) {
      expect(vault.createFolder).toHaveBeenCalledWith(`Second Brain/${category}`);
    }
  });

  it("모든 폴더가 이미 존재하면 아무 폴더도 생성하지 않는다(유지)", async () => {
    const existing = [
      makeFolder("Second Brain"),
      ...WIKI_CATEGORIES.map((c) => makeFolder(`Second Brain/${c}`)),
    ];
    const vault = makeVault(existing);
    await ensureWikiFolders(makeApp(vault), "Second Brain");

    expect(vault.createFolder).not.toHaveBeenCalled();
  });

  it("일부 폴더만 없으면 누락된 폴더만 생성한다", async () => {
    // 루트와 entities만 존재 → concepts/projects만 생성되어야 한다
    const vault = makeVault([
      makeFolder("Second Brain"),
      makeFolder("Second Brain/entities"),
    ]);
    await ensureWikiFolders(makeApp(vault), "Second Brain");

    expect(vault.createFolder).toHaveBeenCalledTimes(2);
    expect(vault.createFolder).toHaveBeenCalledWith("Second Brain/concepts");
    expect(vault.createFolder).toHaveBeenCalledWith("Second Brain/projects");
    expect(vault.createFolder).not.toHaveBeenCalledWith("Second Brain");
    expect(vault.createFolder).not.toHaveBeenCalledWith("Second Brain/entities");
  });
});

describe("writeIndexCatalog — 카탈로그 갱신 시 사용자 메모 보존 (Req 4.4)", () => {
  it("index.md가 없으면 catalog 블록을 가진 파일을 새로 생성한다", async () => {
    const vault = makeVault();
    const catalog = buildIndexCatalog([
      { path: "Second Brain/concepts/A.md", title: "A", category: "concepts" },
    ]);
    await writeIndexCatalog(makeApp(vault), "Second Brain", catalog);

    expect(vault.create).toHaveBeenCalledTimes(1);
    const [createdPath, createdContent] = vault.create.mock.calls[0];
    expect(createdPath).toBe("Second Brain/index.md");
    // sentinel 블록으로 감싸여 있고 카탈로그 본문을 포함한다
    expect(createdContent).toContain("<!-- @generated:catalog -->");
    expect(createdContent).toContain("<!-- @end:catalog -->");
    expect(createdContent).toContain("[[Second Brain/concepts/A.md|A]]");
  });

  it("기존 index.md의 사용자 메모(User_Region)를 보존하고 catalog 블록만 교체한다", async () => {
    // 사용자가 직접 작성한 메모 + 이전 catalog 블록이 섞인 index.md
    const userMemo = "## 내 메모\n이건 내가 직접 쓴 노트입니다. 지우지 마세요.";
    const initialIndex =
      `${userMemo}\n\n<!-- @generated:catalog -->\n# 📚 Index\n\n_옛 카탈로그_\n<!-- @end:catalog -->\n`;
    const indexFile = makeFile("Second Brain/index.md", initialIndex);
    const vault = makeVault([indexFile]);

    const newCatalog = buildIndexCatalog([
      { path: "Second Brain/entities/X.md", title: "X", category: "entities" },
    ]);
    await writeIndexCatalog(makeApp(vault), "Second Brain", newCatalog);

    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.modify).toHaveBeenCalledTimes(1);
    const written = vault.modify.mock.calls[0][1] as string;

    // 사용자 메모는 그대로 보존된다
    expect(written).toContain(userMemo);
    // 새 카탈로그 항목이 반영되고, 옛 카탈로그 본문은 사라진다
    expect(written).toContain("[[Second Brain/entities/X.md|X]]");
    expect(written).not.toContain("_옛 카탈로그_");
  });
});

describe("appendActivityLog — 로그 append(기존 로그 불변) (Req 4.5)", () => {
  it("log.md가 없으면 새로 생성하고 첫 줄을 기록한다", async () => {
    const vault = makeVault();
    await appendActivityLog(makeApp(vault), "Second Brain", "위키 초기화");

    expect(vault.create).toHaveBeenCalledTimes(1);
    const [createdPath, createdContent] = vault.create.mock.calls[0];
    expect(createdPath).toBe("Second Brain/log.md");
    expect(createdContent).toContain("위키 초기화");
  });

  it("기존 로그 항목은 변경하지 않고 새 줄만 끝에 덧붙인다", async () => {
    const prior = "- [2026-01-01T00:00:00.000Z] 이전 동작\n";
    const logFile = makeFile("Second Brain/log.md", prior);
    const vault = makeVault([logFile]);

    await appendActivityLog(makeApp(vault), "Second Brain", "새 동작");

    expect(vault.create).not.toHaveBeenCalled();
    // read→modify 왕복이 아니라 원자적 process를 써야 한다. 겹친 append가 서로를
    // 덮어쓰는 것을 막는 유일한 장치이므로, 어느 API를 썼는지까지 못박는다.
    expect(vault.process).toHaveBeenCalledTimes(1);
    expect(vault.modify).not.toHaveBeenCalled();
    const written = logFile.content as string;

    // 기존 로그 라인은 그대로 포함되고, 새 라인이 그 뒤에 추가된다
    expect(written.startsWith(prior)).toBe(true);
    expect(written).toContain("새 동작");
    // 기존 메시지가 손상되지 않았다
    expect(written).toContain("이전 동작");
  });

  it("줄바꿈으로 끝나지 않는 기존 로그에도 줄을 분리해 덧붙인다", async () => {
    // 구분자 계산이 process 콜백 안으로 옮겨졌으므로 경계 조건을 남겨둔다.
    const logFile = makeFile("Second Brain/log.md", "- 개행 없는 마지막 줄");
    const vault = makeVault([logFile]);

    await appendActivityLog(makeApp(vault), "Second Brain", "새 동작");

    expect(logFile.content).toContain("- 개행 없는 마지막 줄\n");
    expect(logFile.content).toContain("새 동작");
  });
});
