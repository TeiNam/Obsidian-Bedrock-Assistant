import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TFile } from "obsidian";
import { createTodoNote, archiveOldTodos } from "./todo-manager";
import { buildTodoDocPath } from "./planner-paths";

// ============================================
// createTodoNote / archiveOldTodos 예시 테스트 (mock vault)
// ============================================
// To-Do 평면 폴더 구조({todoFolder}/YYYY-MM-DD To-Do.md) 생성/아카이브 흐름을 검증한다.
// 부수효과 계층(폴더/파일 생성·열기·이동·알림)은 가짜 Vault를 직접 구성하여
// create/openFile/rename/createFolder/Notice(=t.* 알림) 호출을 spy로 검증한다.
//
// 검증 범위:
//  - 폴더 재사용/멱등
//  - 이전 후보 없음 시 정상 생성
//  - 아카이브 부수효과 (cutoff/충돌/알림)
//  - 신규 문서는 항상 평면 경로 ({todoFolder}/YYYY-MM-DD To-Do.md)

// 고정된 "오늘" — createTodoNote는 내부에서 new Date()를 사용하므로
// vi.setSystemTime으로 결정적으로 고정한다.
const TODAY = new Date(2026, 2, 15); // 2026-03-15
const TODO_FOLDER = "ToDo";

// ── 가짜 Vault 엔트리 빌더 ─────────────────────────────

/**
 * 모킹된 TFile 인스턴스를 생성한다.
 * 구현이 `child instanceof TFile`로 파일/폴더를 구분하므로 반드시 TFile 인스턴스여야 한다.
 */
function makeFile(path: string, content = ""): any {
  const f: any = new TFile();
  f.path = path;
  const name = path.split("/").pop() ?? path;
  f.name = name;
  const dot = name.lastIndexOf(".");
  f.basename = dot > 0 ? name.slice(0, dot) : name;
  f.extension = dot > 0 ? name.slice(dot + 1) : "";
  f.content = content;
  return f;
}

/**
 * 폴더 엔트리(plain object)를 생성한다.
 * 구현은 `!(child instanceof TFile)`로 폴더를 판단하므로 절대 TFile 인스턴스가 아니어야 한다.
 */
function makeFolder(path: string, children: any[] = []): any {
  const name = path.split("/").pop() ?? path;
  return { path, name, children };
}

// ── 가짜 Vault / App / Plugin / t ─────────────────────

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
    cachedRead: vi.fn(async (f: any) => f.content ?? ""),
    rename: vi.fn(async (entry: any, dest: string) => {
      map.delete(entry.path);
      entry.path = dest;
      map.set(dest, entry);
    }),
    modify: vi.fn(async (f: any, content: string) => {
      f.content = content;
    }),
    _map: map,
  };
}

function makeApp(vault: any) {
  const openFile = vi.fn(async () => {});
  const leaf = { openFile };
  return {
    vault,
    workspace: { getLeaf: vi.fn(() => leaf) },
    _openFile: openFile,
  };
}

function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      todoFolder: TODO_FOLDER,
      templateFolder: "Templates",
      todoTemplateName: "Daily To-Do",
      todoArchiveFolder: "ToDo/Archive",
      todoArchiveDays: 7,
      language: "en",
      ...overrides,
    },
    // createTodoNote는 AI를 호출하지 않으므로 최소 스텁
    aiClient: { converseLight: vi.fn() },
  } as any;
}

// Notice 본문은 t.* 함수로 생성된다(`new Notice(t.todoCreated(path))`).
// 따라서 t.* spy 호출 여부가 곧 해당 Notice 생성 여부를 의미한다.
function makeT() {
  return {
    todoCreated: vi.fn((p: string) => `created ${p}`),
    todoExists: vi.fn((p: string) => `exists ${p}`),
    todoError: vi.fn((e: string) => `error ${e}`),
    todoArchived: vi.fn((n: number) => `archived ${n}`),
  } as any;
}

describe("createTodoNote (mock vault) — 평면 폴더 + To-Do 생성", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 10, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Test 1: 신규 생성 (기존 To-Do 없음, 이전 후보 없음) ---
  // 빈 볼트에서: To-Do 폴더 생성, To-Do 문서는 평면 경로에 생성, openFile + 생성 알림.
  it("기존 To-Do/후보가 없으면 To-Do 폴더를 만들고 평면 경로에 생성한다", async () => {
    const vault = makeVault([]); // 빈 볼트
    const app = makeApp(vault);
    const plugin = makePlugin();
    const t = makeT();

    await createTodoNote(app, plugin, t);

    const todoPath = buildTodoDocPath(TODO_FOLDER, TODAY); // "ToDo/2026-03-15 To-Do.md"

    // To-Do 폴더가 없으므로 생성된다 (날짜 하위폴더는 만들지 않는다)
    expect(vault.createFolder).toHaveBeenCalledWith(TODO_FOLDER);
    expect(vault.createFolder).toHaveBeenCalledTimes(1);

    // 신규 문서는 평면 경로에 생성된다
    expect(vault.create).toHaveBeenCalledTimes(1);
    expect(vault.create).toHaveBeenCalledWith(todoPath, expect.any(String));

    // 생성된 문서를 활성 탭에서 연다
    expect(app._openFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: todoPath })
    );

    // 생성 완료 알림 + 오류 없음 (후보 없음 → 이월 생략, 정상 생성)
    expect(t.todoCreated).toHaveBeenCalledWith(todoPath);
    expect(t.todoError).not.toHaveBeenCalled();
    // 후보가 없으므로 이전 문서를 읽지 않는다(이월/메모 승계 생략)
    expect(vault.cachedRead).not.toHaveBeenCalled();
  });

  // --- Test 2: 멱등성 / 이미 존재 ---
  // To-Do 문서가 이미 존재하면 덮어쓰지 않고(=create 미호출) 기존 파일을 연다.
  it("To-Do 문서가 이미 존재하면 덮어쓰지 않고 기존 파일을 연다", async () => {
    const todoPath = buildTodoDocPath(TODO_FOLDER, TODAY);
    const existing = makeFile(todoPath, "# 기존 내용");

    const vault = makeVault([
      makeFolder(TODO_FOLDER, [existing]),
      existing,
    ]);
    const app = makeApp(vault);
    const plugin = makePlugin();
    const t = makeT();

    await createTodoNote(app, plugin, t);

    // 덮어쓰기 방지: create 미호출
    expect(vault.create).not.toHaveBeenCalled();
    // 기존 파일을 그대로 연다
    expect(app._openFile).toHaveBeenCalledWith(existing);
    // 이미 존재 알림 + 생성 알림 아님
    expect(t.todoExists).toHaveBeenCalledWith(todoPath);
    expect(t.todoCreated).not.toHaveBeenCalled();
    expect(t.todoError).not.toHaveBeenCalled();
    // 폴더가 존재하므로 createFolder 미호출 (재사용)
    expect(vault.createFolder).not.toHaveBeenCalled();
  });

  // --- Test 3: 폴더 재사용 ---
  // To-Do 폴더가 이미 존재하면 createFolder를 다시 호출하지 않고 재사용한다.
  it("To-Do 폴더가 이미 존재하면 createFolder를 다시 호출하지 않는다", async () => {
    const todoPath = buildTodoDocPath(TODO_FOLDER, TODAY);

    const vault = makeVault([
      makeFolder(TODO_FOLDER),
      // To-Do 문서는 없음 → 신규 생성 경로
    ]);
    const app = makeApp(vault);
    const plugin = makePlugin();
    const t = makeT();

    await createTodoNote(app, plugin, t);

    // 폴더 재사용: createFolder 미호출
    expect(vault.createFolder).not.toHaveBeenCalled();
    // 그래도 신규 문서는 정상 생성된다
    expect(vault.create).toHaveBeenCalledWith(todoPath, expect.any(String));
    expect(t.todoCreated).toHaveBeenCalledWith(todoPath);
    expect(t.todoError).not.toHaveBeenCalled();
  });
});

describe("archiveOldTodos (mock vault) — 오래된 항목 아카이브 부수효과", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Test 4: 아카이브 부수효과 ---
  // now=2026-03-15, archiveDays=7 → cutoff=2026-03-08.
  // cutoff 미만 항목만 이동, 아카이브 폴더 없으면 생성,
  // 이름 충돌 항목은 건너뜀, 이동 수만 알림, 최근 항목은 미이동.
  it("cutoff 미만 항목만 아카이브하고, 폴더 생성/충돌 건너뜀/이동 수 알림을 수행한다", async () => {
    const now = new Date(2026, 2, 15); // 2026-03-15 → cutoff 2026-03-08

    // 평면 To-Do + legacy 평면 파일 후보 구성
    const flatOld1 = makeFile(`${TODO_FOLDER}/2026-03-01 To-Do.md`); // < cutoff → 이동
    const flatOld2 = makeFile(`${TODO_FOLDER}/2026-02-20 To-Do.md`); // < cutoff → 충돌로 건너뜀
    const flatRecent = makeFile(`${TODO_FOLDER}/2026-03-10 To-Do.md`); // >= cutoff → 미이동
    const legacyOld = makeFile(`${TODO_FOLDER}/2026-02-25.md`); // < cutoff → 이동

    const todoRoot = makeFolder(TODO_FOLDER, [
      flatOld1,
      flatOld2,
      flatRecent,
      legacyOld,
    ]);

    // 충돌 대상: 아카이브 폴더 안에 flatOld2와 같은 이름이 이미 존재
    const collisionDest = makeFile("ToDo/Archive/2026-02-20 To-Do.md");

    const vault = makeVault([todoRoot, collisionDest]);
    const app = makeApp(vault);
    const plugin = makePlugin();
    const t = makeT();

    await archiveOldTodos(app, plugin, t, TODO_FOLDER, now);

    // 아카이브 폴더가 없으므로 생성된다
    expect(vault.createFolder).toHaveBeenCalledWith("ToDo/Archive");

    // 오래된 항목은 "<archiveFolder>/<name>"로 이동된다
    expect(vault.rename).toHaveBeenCalledWith(flatOld1, "ToDo/Archive/2026-03-01 To-Do.md");
    expect(vault.rename).toHaveBeenCalledWith(legacyOld, "ToDo/Archive/2026-02-25.md");

    // 충돌 항목은 이동하지 않는다
    const renamedEntries = vault.rename.mock.calls.map((c) => c[0]);
    expect(renamedEntries).not.toContain(flatOld2);

    // 최근(>= cutoff) 항목은 이동하지 않는다
    expect(renamedEntries).not.toContain(flatRecent);

    // 실제 이동 수(2건)만 알림
    expect(vault.rename).toHaveBeenCalledTimes(2);
    expect(t.todoArchived).toHaveBeenCalledWith(2);
  });

  // --- Test 4b: 아카이브 대상 없음 ---
  // cutoff 미만 항목이 없으면 폴더 생성/이동/알림 모두 발생하지 않는다.
  it("아카이브 대상이 없으면 폴더 생성/이동/알림이 발생하지 않는다", async () => {
    const now = new Date(2026, 2, 15); // cutoff 2026-03-08

    const flatRecent = makeFile(`${TODO_FOLDER}/2026-03-12 To-Do.md`); // >= cutoff
    const todoRoot = makeFolder(TODO_FOLDER, [flatRecent]);

    const vault = makeVault([todoRoot]);
    const app = makeApp(vault);
    const plugin = makePlugin();
    const t = makeT();

    await archiveOldTodos(app, plugin, t, TODO_FOLDER, now);

    expect(vault.createFolder).not.toHaveBeenCalled();
    expect(vault.rename).not.toHaveBeenCalled();
    expect(t.todoArchived).not.toHaveBeenCalled();
  });
});
