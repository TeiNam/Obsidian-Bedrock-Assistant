import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  mergeTimeboxDraft,
  TIMEBOX_TIME_LINE_RE,
  type TimeboxDraft,
} from "./todo-manager";

// ============================================
// timebox-merge 속성 테스트
// ============================================
// 이 파일은 daily-planner 스펙의 mergeTimeboxDraft 순수 함수 속성을 검증한다.
// (실제 TimeBox Daily 템플릿 구조를 기반으로 한 제너레이터를 사용한다.)

// mergeTimeboxDraft의 섹션 판별이 의존하는 실제 템플릿 헤딩 라인.
// detectSection은 헤딩 텍스트에 "priorit"/"goal"/"schedule"/"note"(또는 한국어)가
// 포함되는지로 섹션을 구분하므로, 아래 헤딩들은 안정적으로 감지된다.
const HEADING_PRIORITIES = "## 📌 Top Priorities";
const HEADING_GOALS = "## 🎯 Goals of the Day";
const HEADING_SCHEDULE = "## 🕐 Schedule";
const HEADING_NOTES = "## 📝 Notes";

// 시간(0~23) → "- [ ] **HH:00** — " 형식의 시간 라인 생성.
// TIMEBOX_TIME_LINE_RE가 매칭하는 형식과 정확히 일치한다.
const buildTimeLine = (hour: number): string =>
  `- [ ] **${String(hour).padStart(2, "0")}:00** — `;

// 주어진 템플릿 콘텐츠에서 시간 라인(TIMEBOX_TIME_LINE_RE 매칭)의 개수를 센다.
// mergeTimeboxDraft 내부의 시간 라인 판정과 동일한 정규식 의미를 사용한다.
const countTimeLines = (content: string): number =>
  content.split("\n").filter((line) => TIMEBOX_TIME_LINE_RE.test(line)).length;

// ----------------------------------------------------------------------------
// 제너레이터
// ----------------------------------------------------------------------------

// 안전한 텍스트 조각용 문자 집합.
// - '{' 배제: 우연히 "{{date}}" 토큰을 재주입하지 않도록 한다.
// - '*' 배제: 우연히 "**HH:00**" 시간 마커를 형성하지 않도록 한다.
// (개수 불변/토큰 부재 속성을 입력 잡음 없이 안정적으로 검증하기 위함)
const SAFE_CHARS = "abcdefgABCDEF가나다라마 \t.,:!?()-/".split("");
const safeText = fc
  .array(fc.constantFrom(...SAFE_CHARS), { maxLength: 30 })
  .map((chars) => chars.join(""));

// 줄바꿈(개행)을 포함할 수 있는 작업 텍스트.
// 작업에 개행(LF "\n" 또는 CRLF "\r\n")이 들어가도 시간 라인이 여러 줄로
// 쪼개지지 않음을 확인하기 위해 사용한다.
//   - 안전한 텍스트 조각 사이사이에 "", "\n", "\r\n" 구분자를 끼워 넣는다.
//   - "\r"은 항상 "\r\n" 쌍으로만 등장하므로(단독 캐리지리턴 제외) 현실적인
//     개행 입력 공간으로 제한된다(smart generator).
const taskSegment = fc
  .array(fc.constantFrom(...SAFE_CHARS), { maxLength: 15 })
  .map((chars) => chars.join(""));
const taskText = fc
  .array(fc.tuple(taskSegment, fc.constantFrom("", "\n", "\r\n")), {
    maxLength: 4,
  })
  .map((parts) => parts.map(([seg, sep]) => seg + sep).join(""));

// "HH:00" 또는 "H:00"(0 미패딩) 형식의 시간 문자열.
// 일부는 템플릿 시간과 매칭되고 일부는 매칭되지 않도록 0~23 전체에서 생성한다.
const scheduleTimeArb = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.boolean())
  .map(([hour, pad]) =>
    pad ? `${String(hour).padStart(2, "0")}:00` : `${hour}:00`
  );

// 임의의 TimeboxDraft 제너레이터.
const draftArb: fc.Arbitrary<TimeboxDraft> = fc.record({
  topPriorities: fc.array(safeText, { maxLength: 5 }),
  goals: fc.array(safeText, { maxLength: 8 }),
  schedule: fc.array(
    fc.record({ time: scheduleTimeArb, task: taskText }),
    { maxLength: 12 }
  ),
});

// 날짜 문자열 d ("YYYY-MM-DD").
const dateArb = fc
  .date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31) })
  .map(
    (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`
  );

// N개(1~24)의 서로 다른 시간을 가진 시간 라인을 포함하는 실제형 TimeBox 템플릿 생성.
const templateArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 23 }), {
    minLength: 1,
    maxLength: 24,
  })
  .map((hours) => {
    const timeLines = hours.map(buildTimeLine).join("\n");
    return [
      "---",
      "date: {{date}}",
      "tags: [daily, timebox]",
      "---",
      "",
      "# 🗓️ TimeBox Daily — {{date}}",
      "",
      "---",
      "",
      "## 📅 Date",
      "",
      "> {{date}}",
      "",
      "---",
      "",
      HEADING_PRIORITIES,
      "",
      "> [!tip] 할 일 목록은 👉 [[Daily To-Do]] 에서 가져오기",
      "",
      "1. ",
      "2. ",
      "3. ",
      "",
      "---",
      "",
      HEADING_GOALS,
      "",
      "- [ ] ",
      "- [ ] ",
      "- [ ] ",
      "",
      "---",
      "",
      HEADING_SCHEDULE,
      "",
      timeLines,
      "",
      "---",
      "",
      HEADING_NOTES,
      "",
      "> [!note]",
      "> ",
    ].join("\n");
  });

// Feature: daily-planner, Property 12: mergeTimeboxDraft 섹션 구조 및 시간 라인 불변
describe("Property 12: mergeTimeboxDraft 섹션 구조 및 시간 라인 불변", () => {
  // 네 섹션(Top Priorities, Goals of the Day, Schedule, Notes)과 N개의 시간 라인
  // ("**HH:00** —")을 가진 임의의 TimeBox 템플릿, 임의의 TimeboxDraft, 날짜 d에 대해:
  //  1) 네 섹션 헤딩 라인이 모두 보존된다.
  //  2) 시간 라인(TIMEBOX_TIME_LINE_RE 매칭) 개수가 정확히 N개로 유지된다(추가/삭제 없음).
  //  3) 결과에 "{{date}}" 토큰이 남아 있지 않다.
  // Validates: Requirements 3.7
  it("섹션 헤딩 보존 + 시간 라인 개수 불변 + {{date}} 토큰 부재", () => {
    fc.assert(
      fc.property(templateArb, draftArb, dateArb, (template, draft, date) => {
        const before = countTimeLines(template);
        const result = mergeTimeboxDraft(template, draft, date);

        // 1) 네 섹션 헤딩이 모두 그대로 남아 있어야 한다.
        for (const heading of [
          HEADING_PRIORITIES,
          HEADING_GOALS,
          HEADING_SCHEDULE,
          HEADING_NOTES,
        ]) {
          expect(result.split("\n")).toContain(heading);
        }

        // 2) 시간 라인 개수는 병합 전후로 동일(= N)해야 한다.
        expect(countTimeLines(result)).toBe(before);

        // 3) {{date}} 토큰은 모두 치환되어 남아 있지 않아야 한다.
        expect(result.includes("{{date}}")).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
