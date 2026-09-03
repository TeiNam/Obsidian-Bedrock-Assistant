import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import {
  extractRetrospectiveSection,
  collectPastRetrospectives,
  buildRetrospectivePrompt,
  PAST_RETROSPECTIVE_DAYS,
  PAST_RETROSPECTIVE_MAX_CHARS,
  buildTodoPath,
  removeExistingRetrospective,
  replaceOrAppendRetrospective,
} from "./retrospective-service";
import { buildTodoDocPath } from "./planner-paths";

// ============================================
// 회고 체인 (Retrospective Chain) 테스트
// ============================================
// 배경: 기존 회고는 "당일" 입력만 받아(collectTodayFiles가 ctime으로 오늘만 수집,
// buildRetrospectivePrompt에 과거 인자 없음) 매일 리셋됐다. 어제의 개선 약속이
// 오늘 회고에서 사라져 누적 학습이 성립하지 않았다.
//
// 이 테스트는 과거 회고를 입력에 넣는 경로를 고정한다.

const LANG = "ko";
const AI_HEADING = "## 📝 오늘의 회고";
const TEMPLATE_HEADING = "## 📊 오늘의 회고";

describe("extractRetrospectiveSection: 회고 섹션만 뽑아낸다", () => {
  it("회고가 문서 끝에 있으면 본문을 반환한다", () => {
    const content = `# 2026-07-20 To-Do\n\n- [x] 작업 A\n\n${AI_HEADING}\n오늘은 A를 끝냈다.\n개선점: 회의가 길었다.\n`;
    expect(extractRetrospectiveSection(content, LANG)).toBe(
      "오늘은 A를 끝냈다.\n개선점: 회의가 길었다."
    );
  });

  it("회고 뒤에 다른 h2가 오면 그 앞까지만 자른다", () => {
    // 템플릿이 회고를 중간에 두는 경우. 뒤 섹션을 함께 넣으면 프롬프트가 오염된다.
    const content = `${AI_HEADING}\n회고 본문이다.\n\n## 📌 메모\n이건 회고가 아니다.\n`;
    expect(extractRetrospectiveSection(content, LANG)).toBe("회고 본문이다.");
  });

  it("템플릿 헤딩(📊)도 인식한다", () => {
    const content = `${TEMPLATE_HEADING}\n템플릿 쪽 회고.\n`;
    expect(extractRetrospectiveSection(content, LANG)).toBe("템플릿 쪽 회고.");
  });

  it("회고 섹션이 없으면 null을 반환한다", () => {
    expect(extractRetrospectiveSection("# To-Do\n- [ ] 할 일\n", LANG)).toBeNull();
  });

  it("헤딩만 있고 본문이 비면 null을 반환한다", () => {
    // 빈 섹션을 넣으면 프롬프트에 의미 없는 날짜 항목만 늘어난다.
    expect(extractRetrospectiveSection(`${AI_HEADING}\n\n\n`, LANG)).toBeNull();
  });

  it("긴 회고는 상한으로 잘린다", () => {
    const long = "가".repeat(PAST_RETROSPECTIVE_MAX_CHARS + 500);
    const result = extractRetrospectiveSection(`${AI_HEADING}\n${long}\n`, LANG);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(PAST_RETROSPECTIVE_MAX_CHARS);
  });

  it("다른 언어로 작성된 회고도 인식한다", () => {
    // 사용자가 언어 설정을 바꿔도 과거 회고를 잃지 않아야 한다.
    const content = "## 📝 Daily Retrospective\nWrote in English.\n";
    expect(extractRetrospectiveSection(content, LANG)).toBe("Wrote in English.");
  });
});

describe("회고 교체: 뒤쪽 섹션 보존", () => {
  const content = [
    "# To-Do",
    "",
    AI_HEADING,
    "이전 회고",
    "",
    "## 📌 메모",
    "보존할 내용",
    "",
  ].join("\n");

  it("프롬프트용 제거는 회고만 빼고 뒤쪽 섹션을 남긴다", () => {
    expect(removeExistingRetrospective(content, LANG)).toContain("## 📌 메모\n보존할 내용");
    expect(removeExistingRetrospective(content, LANG)).not.toContain("이전 회고");
  });

  it("새 회고로 교체해도 뒤쪽 섹션을 남긴다", () => {
    const out = replaceOrAppendRetrospective(
      content,
      `${AI_HEADING}\n새 회고`,
      LANG,
    );

    expect(out).toContain(`${AI_HEADING}\n새 회고`);
    expect(out).toContain("## 📌 메모\n보존할 내용");
    expect(out).not.toContain("이전 회고");
  });
});

/**
 * 지정한 경로 → 내용 맵을 가진 mock app을 만든다.
 * resolveTodayTodoFile과 동일한 계약(존재하지 않으면 null)을 따른다.
 */
function makeApp(contents: Map<string, string>): any {
  return {
    vault: {
      getAbstractFileByPath: vi.fn((path: string) => {
        if (!contents.has(path)) return null;
        const file = new TFile();
        file.path = path;
        return file;
      }),
      read: vi.fn(async (file: TFile) => contents.get(file.path) ?? ""),
    },
  };
}

const TODAY = new Date(2026, 6, 28); // 2026-07-28
const FOLDER = "Planner";
const LEGACY = "ToDo";

/** N일 전 날짜의 신규 구조 To-Do 경로 */
function pathDaysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return buildTodoDocPath(FOLDER, d);
}

describe("collectPastRetrospectives: 과거 회고를 최신순으로 모은다", () => {
  it("최근 7일 범위의 회고를 최신순으로 반환한다", async () => {
    const contents = new Map([
      [pathDaysAgo(1), `${AI_HEADING}\n어제 회고.\n`],
      [pathDaysAgo(3), `${AI_HEADING}\n3일 전 회고.\n`],
    ]);

    const result = await collectPastRetrospectives(
      makeApp(contents),
      FOLDER,
      LEGACY,
      TODAY,
      LANG
    );

    // 최신순(어제 → 3일 전). 프롬프트에서 최근 것이 먼저 읽히도록.
    expect(result.map((r) => r.text)).toEqual(["어제 회고.", "3일 전 회고."]);
    expect(result[0].date).toBe("2026-07-27");
    expect(result[1].date).toBe("2026-07-25");
  });

  it("오늘 회고는 포함하지 않는다", async () => {
    // 오늘 것을 넣으면 직전 실행 결과를 자기 입력으로 되먹여 증폭된다.
    const contents = new Map([
      [buildTodoDocPath(FOLDER, TODAY), `${AI_HEADING}\n오늘 회고.\n`],
      [pathDaysAgo(1), `${AI_HEADING}\n어제 회고.\n`],
    ]);

    const result = await collectPastRetrospectives(
      makeApp(contents),
      FOLDER,
      LEGACY,
      TODAY,
      LANG
    );

    expect(result.map((r) => r.text)).toEqual(["어제 회고."]);
  });

  it("범위를 벗어난 날짜(8일 전)는 제외한다", async () => {
    const contents = new Map([
      [pathDaysAgo(PAST_RETROSPECTIVE_DAYS + 1), `${AI_HEADING}\n너무 오래된 회고.\n`],
    ]);

    const result = await collectPastRetrospectives(
      makeApp(contents),
      FOLDER,
      LEGACY,
      TODAY,
      LANG
    );

    expect(result).toEqual([]);
  });

  it("Legacy 평면 구조 파일도 폴백으로 읽는다", async () => {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - 2);
    const contents = new Map([[buildTodoPath(LEGACY, d), `${AI_HEADING}\n레거시 회고.\n`]]);

    const result = await collectPastRetrospectives(
      makeApp(contents),
      FOLDER,
      LEGACY,
      TODAY,
      LANG
    );

    expect(result.map((r) => r.text)).toEqual(["레거시 회고."]);
  });

  it("과거 회고가 하나도 없으면 빈 배열을 반환한다(도입 초기)", async () => {
    const result = await collectPastRetrospectives(
      makeApp(new Map()),
      FOLDER,
      LEGACY,
      TODAY,
      LANG
    );
    expect(result).toEqual([]);
  });

  it("파일이 있어도 회고 섹션이 없으면 건너뛴다", async () => {
    const contents = new Map([[pathDaysAgo(1), "# 어제 To-Do\n- [x] 작업만 있음\n"]]);
    const result = await collectPastRetrospectives(
      makeApp(contents),
      FOLDER,
      LEGACY,
      TODAY,
      LANG
    );
    expect(result).toEqual([]);
  });

  it("읽기 실패한 날짜는 건너뛰고 나머지를 반환한다", async () => {
    // 한 파일의 I/O 실패가 회고 생성 전체를 막아서는 안 된다.
    const contents = new Map([
      [pathDaysAgo(1), `${AI_HEADING}\n어제 회고.\n`],
      [pathDaysAgo(2), `${AI_HEADING}\n2일 전 회고.\n`],
    ]);
    const app = makeApp(contents);
    app.vault.read = vi.fn(async (file: TFile) => {
      if (file.path === pathDaysAgo(1)) throw new Error("EIO");
      return contents.get(file.path) ?? "";
    });

    const result = await collectPastRetrospectives(app, FOLDER, LEGACY, TODAY, LANG);
    expect(result.map((r) => r.text)).toEqual(["2일 전 회고."]);
  });
});

describe("buildRetrospectivePrompt: 과거 회고를 입력에 포함한다", () => {
  it("과거 회고가 있으면 날짜와 함께 프롬프트에 넣고 반복 점검을 지시한다", () => {
    const prompt = buildRetrospectivePrompt("- [x] 작업", [], LANG, [
      { date: "2026-07-27", text: "회의가 길어 집중이 어려웠다." },
    ]);

    expect(prompt).toContain("2026-07-27");
    expect(prompt).toContain("회의가 길어 집중이 어려웠다.");
    // 과거를 넣는 목적은 "반복 여부 판단"이다. 지시가 없으면 LLM이 그냥 요약만 한다.
    expect(prompt.toLowerCase()).toContain("recurring");
  });

  it("과거 회고가 없으면 관련 섹션과 지시를 넣지 않는다", () => {
    // 도입 초기: 비어 있는 섹션을 넣으면 LLM이 없는 과거를 추측한다.
    const prompt = buildRetrospectivePrompt("- [x] 작업", [], LANG);
    expect(prompt.toLowerCase()).not.toContain("recurring");
    expect(prompt).not.toContain("Previous Retrospectives");
  });

  it("과거 회고 인자를 생략해도 기존 프롬프트 구조를 유지한다(하위 호환)", () => {
    const prompt = buildRetrospectivePrompt("- [x] 작업", [], LANG);
    expect(prompt).toContain("## Today's To-Do");
    expect(prompt).toContain("- [x] 작업");
  });
});
