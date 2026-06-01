import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Notice, TFile } from "obsidian";
import { createTimeboxNote } from "./todo-manager";
import { VIEW_I18N } from "./chat-view-i18n";
import {
  buildTodoDocPath,
  buildTimeboxDocPath,
  buildTimeboxLink,
} from "./planner-paths";

// ============================================
// createTimeboxNote 예시 테스트 (mock vault) — daily-planner 설계 2.4
// ============================================
// Create_Timebox_Action 오케스트레이션을 모킹된 Vault/플러그인으로 검증한다.
// 다루는 시나리오:
//  1. 선행조건 위반(3.2, 3.3): 같은 날짜 To-Do가 없으면 TimeBox 미생성
//  2. 이미 존재(3.4): TimeBox가 있으면 열기만 하고 덮어쓰지 않음(멱등)
//  3. 정상 AI 성공(3.5): create + openFile + 완료 알림 + To-Do 상호링크(modify)
//  4. AI 오류 폴백(3.8): converseLight 예외 → baseBody로 생성 + 폴백 알림
//  5. AI 응답 파싱 실패 폴백(3.8): 비-JSON 응답 → baseBody로 생성 + 폴백 알림
//  6. 템플릿+AI 모두 불가(3.9): 내장 기본 본문(시간 Schedule 포함, {{date}} 치환됨)으로 생성
//  7. 파일시스템 오류(3.11): create 실패 → 오류 알림 + To-Do 미변경(modify 미호출)

// Notice만 스파이로 교체하고, TFile/normalizePath 등 나머지 모킹은 그대로 유지한다.
// (createTimeboxNote가 `new Notice(...)`로 알림을 표시하므로 호출을 추적해야 함)
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  return {
    ...actual,
    Notice: vi.fn(),
  };
});

// 고정 날짜로 "오늘"을 핀하여 경로를 결정론적으로 만든다 (2025-06-15)
const FIXED_NOW = new Date(2025, 5, 15, 10, 30, 0);
const PLANNER = "Daily Planner";

/** 핀된 "오늘"(시간 성분 제거) */
function todayDate(): Date {
  return new Date(2025, 5, 15);
}

/** path로부터 name/basename/extension을 채운 TFile 인스턴스를 만든다 (instanceof TFile 통과) */
function makeTFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  const name = path.split("/").pop() || path;
  const dotIdx = name.lastIndexOf(".");
  (file as unknown as { name: string }).name = name;
  file.basename = dotIdx >= 0 ? name.slice(0, dotIdx) : name;
  (file as unknown as { extension: string }).extension =
    dotIdx >= 0 ? name.slice(dotIdx + 1) : "";
  return file;
}

// merge가 채울 수 있는 시간 Schedule을 가진 TimeBox 템플릿 본문 (선택적 사용)
const TIMEBOX_TEMPLATE = [
  "# 🗓️ TimeBox — {{date}}",
  "",
  "## 📌 Top Priorities",
  "",
  "1. ",
  "2. ",
  "3. ",
  "",
  "## 🎯 Goals of the Day",
  "",
  "- [ ] ",
  "- [ ] ",
  "",
  "## 🕐 Schedule",
  "",
  "- [ ] **09:00** — ",
  "- [ ] **10:00** — ",
  "- [ ] **14:00** — ",
  "",
  "## 📝 Notes",
  "",
].join("\n");

// 유효한 TimeboxDraft JSON (AI 성공 케이스)
const VALID_DRAFT_JSON = JSON.stringify({
  topPriorities: ["Finish report"],
  goals: ["Review PR"],
  schedule: [{ time: "09:00", task: "Write report" }],
});

interface SetupOptions {
  todoExists?: boolean;
  timeboxExists?: boolean;
  templateExists?: boolean;
  todoContent?: string;
  templateContent?: string;
}

/** 모킹된 app/plugin/t와 스파이를 구성한다 */
function setup(opts: SetupOptions = {}) {
  const {
    todoExists = true,
    timeboxExists = false,
    templateExists = false,
    todoContent = "# 2025-06-15 To-Do\n\n- [ ] write report\n- [ ] review PR\n",
    templateContent,
  } = opts;

  // 인메모리 path → TFile, path → 콘텐츠 맵
  const files = new Map<string, TFile>();
  const contents = new Map<string, string>();

  const day = todayDate();
  const todoPath = buildTodoDocPath(PLANNER, day);
  const timeboxPath = buildTimeboxDocPath(PLANNER, day);
  const templatePath = "Templates/TimeBox Daily.md";

  let todoFile: TFile | null = null;
  if (todoExists) {
    todoFile = makeTFile(todoPath);
    files.set(todoPath, todoFile);
    contents.set(todoPath, todoContent);
  }

  let timeboxFile: TFile | null = null;
  if (timeboxExists) {
    timeboxFile = makeTFile(timeboxPath);
    files.set(timeboxPath, timeboxFile);
    contents.set(timeboxPath, "# existing timebox\n");
  }

  if (templateExists) {
    const tf = makeTFile(templatePath);
    files.set(templatePath, tf);
    contents.set(templatePath, templateContent ?? TIMEBOX_TEMPLATE);
  }

  // Vault 스파이
  const openFile = vi.fn().mockResolvedValue(undefined);
  const getAbstractFileByPath = vi.fn((p: string) => files.get(p) ?? null);
  const createFolder = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn(async (p: string, content: string) => {
    const f = makeTFile(p);
    files.set(p, f);
    contents.set(p, content);
    return f;
  });
  const cachedRead = vi.fn(async (file: TFile) => contents.get(file.path) ?? "");
  const modify = vi.fn().mockResolvedValue(undefined);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app: any = {
    vault: { getAbstractFileByPath, createFolder, create, cachedRead, modify },
    workspace: { getLeaf: vi.fn(() => ({ openFile })) },
  };

  const converseLight = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugin: any = {
    settings: {
      plannerFolder: PLANNER,
      templateFolder: "Templates",
      todoTemplateName: "Daily To-Do",
      timeboxTemplateName: "TimeBox Daily",
      language: "en",
      maxTokens: 1000,
    },
    aiClient: { converseLight },
  };

  return {
    app,
    plugin,
    t: VIEW_I18N.en,
    converseLight,
    spies: { openFile, getAbstractFileByPath, createFolder, create, cachedRead, modify },
    paths: { todoPath, timeboxPath, templatePath },
    refs: { todoFile, timeboxFile },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  vi.mocked(Notice).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createTimeboxNote (mock vault)", () => {
  // 1. 선행조건 위반: 같은 날짜 To-Do 문서가 없음 (Req 3.2, 3.3)
  it("To-Do가 없으면 안내 알림만 표시하고 TimeBox를 생성하지 않는다", async () => {
    const { app, plugin, t, converseLight, spies } = setup({ todoExists: false });

    await createTimeboxNote(app, plugin, t);

    // 선행조건 안내 알림(문자열)이 표시되어야 한다
    expect(Notice).toHaveBeenCalledWith(t.timeboxNoTodo);
    // TimeBox 파일을 생성하지 않는다
    expect(spies.create).not.toHaveBeenCalled();
    // AI 드래프팅도 호출되지 않는다
    expect(converseLight).not.toHaveBeenCalled();
    // To-Do 문서도 변경되지 않는다
    expect(spies.modify).not.toHaveBeenCalled();
  });

  // 2. 이미 존재: TimeBox가 이미 있으면 열기만 하고 덮어쓰지 않는다 (Req 3.4)
  it("TimeBox가 이미 존재하면 열기만 하고 생성하지 않는다(멱등)", async () => {
    const { app, plugin, t, converseLight, spies, paths, refs } = setup({
      todoExists: true,
      timeboxExists: true,
    });

    await createTimeboxNote(app, plugin, t);

    // 기존 TimeBox 파일을 연다
    expect(spies.openFile).toHaveBeenCalledWith(refs.timeboxFile);
    // 이미 존재 알림
    expect(Notice).toHaveBeenCalledWith(t.timeboxExists(paths.timeboxPath));
    // 덮어쓰기(생성) 없음
    expect(spies.create).not.toHaveBeenCalled();
    // AI 호출도 없음
    expect(converseLight).not.toHaveBeenCalled();
  });

  // 3. 정상 AI 성공: create + openFile + 완료 알림 + To-Do 상호링크(modify) (Req 3.5, 2.2)
  it("AI 응답이 유효하면 TimeBox를 생성하고 To-Do에 상호링크를 추가한다", async () => {
    const { app, plugin, t, converseLight, spies, paths, refs } = setup({
      todoExists: true,
      templateExists: true,
    });
    converseLight.mockResolvedValue({ text: VALID_DRAFT_JSON });

    await createTimeboxNote(app, plugin, t);

    // converseLight는 (prompt, systemPrompt, maxTokens)로 호출된다
    expect(converseLight).toHaveBeenCalledTimes(1);
    expect(converseLight.mock.calls[0][2]).toBe(plugin.settings.maxTokens);

    // TimeBox 문서가 계산된 timeboxPath로 생성된다
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.create.mock.calls[0][0]).toBe(paths.timeboxPath);

    // 생성된 파일을 열고 완료 알림을 표시한다
    expect(spies.openFile).toHaveBeenCalledTimes(1);
    expect(Notice).toHaveBeenCalledWith(t.timeboxCreated(paths.timeboxPath));

    // To-Do 문서에 TimeBox 상호링크가 추가된다(modify 호출)
    expect(spies.modify).toHaveBeenCalledTimes(1);
    const [modifiedFile, modifiedContent] = spies.modify.mock.calls[0];
    expect(modifiedFile).toBe(refs.todoFile);
    expect(modifiedContent).toContain(buildTimeboxLink(todayDate()));
  });

  // 4. AI 오류 폴백: converseLight 예외 → baseBody로 생성 + 폴백 알림 (Req 3.8)
  it("AI 호출이 실패하면 템플릿 기반 본문으로 생성하고 폴백 알림을 표시한다", async () => {
    const { app, plugin, t, converseLight, spies, paths } = setup({
      todoExists: true,
      templateExists: true,
    });
    converseLight.mockRejectedValue(new Error("network down"));

    await createTimeboxNote(app, plugin, t);

    // 폴백 알림과 완료 알림이 모두 표시된다
    expect(Notice).toHaveBeenCalledWith(t.timeboxFallback);
    expect(Notice).toHaveBeenCalledWith(t.timeboxCreated(paths.timeboxPath));
    // 그래도 TimeBox는 생성된다(baseBody 사용)
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.create.mock.calls[0][0]).toBe(paths.timeboxPath);
  });

  // 5. AI 응답 파싱 실패 폴백: 비-JSON 응답 → baseBody로 생성 + 폴백 알림 (Req 3.8)
  it("AI 응답이 JSON이 아니면 파싱 실패로 폴백하여 생성한다", async () => {
    const { app, plugin, t, converseLight, spies, paths } = setup({
      todoExists: true,
      templateExists: true,
    });
    converseLight.mockResolvedValue({ text: "sorry, I cannot do that right now." });

    await createTimeboxNote(app, plugin, t);

    // 파싱 실패 폴백 알림 + 생성 + 완료 알림
    expect(Notice).toHaveBeenCalledWith(t.timeboxFallback);
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.create.mock.calls[0][0]).toBe(paths.timeboxPath);
    expect(Notice).toHaveBeenCalledWith(t.timeboxCreated(paths.timeboxPath));
  });

  // 6. 템플릿+AI 모두 불가: 내장 기본 본문(시간 Schedule 포함, {{date}} 치환됨) (Req 3.9)
  it("템플릿이 없고 AI도 실패하면 시간 Schedule을 포함한 내장 본문으로 생성한다", async () => {
    const { app, plugin, t, converseLight, spies, paths } = setup({
      todoExists: true,
      templateExists: false, // 템플릿 파일 없음 → 내장 기본 본문 사용
    });
    converseLight.mockRejectedValue(new Error("ai unavailable"));

    await createTimeboxNote(app, plugin, t);

    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.create.mock.calls[0][0]).toBe(paths.timeboxPath);

    const createdBody = spies.create.mock.calls[0][1] as string;
    // 내장 본문은 시간 배치 Schedule을 포함한다
    expect(createdBody).toContain("Schedule");
    // 시간 블록 라인(- [ ] **HH:00** — )이 존재해야 한다
    expect(createdBody).toMatch(/\*\*\d{2}:00\*\*/);
    // {{date}} 토큰은 모두 치환되어 남아있지 않아야 한다
    expect(createdBody).not.toContain("{{date}}");
    // 폴백 알림도 표시된다
    expect(Notice).toHaveBeenCalledWith(t.timeboxFallback);
  });

  // 7. 파일시스템 오류: create 실패 → 오류 알림 + To-Do 미변경 (Req 3.11)
  it("TimeBox 생성 중 파일시스템 오류가 나면 오류 알림 + To-Do를 변경하지 않는다", async () => {
    const { app, plugin, t, converseLight, spies } = setup({
      todoExists: true,
      templateExists: true,
    });
    converseLight.mockResolvedValue({ text: VALID_DRAFT_JSON });
    // create가 파일시스템 오류를 던지도록 설정
    spies.create.mockRejectedValueOnce(new Error("disk full"));

    await createTimeboxNote(app, plugin, t);

    // 오류 알림이 표시된다
    expect(Notice).toHaveBeenCalledWith(t.timeboxError("disk full"));
    // create가 먼저 실패했으므로 To-Do 상호링크(modify)는 수행되지 않는다(Req 3.11 순서 보장)
    expect(spies.modify).not.toHaveBeenCalled();
    // 완료 알림도 표시되지 않는다
    expect(Notice).not.toHaveBeenCalledWith(
      t.timeboxCreated(buildTimeboxDocPath(PLANNER, todayDate()))
    );
  });
});
