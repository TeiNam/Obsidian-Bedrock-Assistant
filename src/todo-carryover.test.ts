import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  extractUnfinishedTasks,
  extractUnfinishedTasksBySection,
  injectCarryOverTasks,
  injectTasksIntoSubSection,
  selectMostRecentBefore,
} from "./todo-manager";

// ============================================
// todo-carryover 속성 테스트
// ============================================
// 이 파일은 daily-planner 스펙의 미완료 이월(carry-over) 순수 헬퍼 속성을 검증한다.
// 각 속성은 향후 병합 충돌을 피하기 위해 독립된 describe(...) 블록으로 구성한다.
// (Property 5 외 Property 6/7/8/16은 이후 작업에서 별도 블록으로 추가된다.)

// 줄바꿈을 포함하지 않으면서 의미 있는(trim 후 비어 있지 않은) 텍스트 제너레이터.
// content는 줄 단위로 join("\n") 되므로 텍스트에 개행 문자가 포함되면 안 된다.
const textChar = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789 가나다라마-_.,:!?()[]*".split("")
);
const meaningfulText = fc
  .array(textChar, { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(""))
  .filter((s) => s.trim().length > 0);

// Feature: daily-planner, Property 5: 미완료 항목 추출 정확성
describe("Property 5: 미완료 항목 추출 정확성", () => {
  // 미완료(`- [ ] 텍스트`)·완료(`- [x]`/`- [X]`)·빈 체크박스(`- [ ]` 텍스트 없음)·
  // 일반 줄이 임의로 섞인 콘텐츠에 대해:
  //  1) extractUnfinishedTasks(content)가 반환하는 모든 비들여쓰기(최상위) 항목은
  //     `- [ ] `로 시작하고 마커 뒤 텍스트가 비어 있지 않다.
  //  2) 반환 결과에 완료 체크박스(`- [x]`/`- [X]`)는 포함되지 않는다.
  //  3) 반환 결과에 텍스트 없는 빈 체크박스(마커 뒤 공백만)는 포함되지 않는다.
  //  4) (개수/순서 정합) 들여쓰기 하위 줄을 생성하지 않으므로, 비들여쓰기 반환 항목은
  //     생성된 "미완료 + 텍스트" 최상위 줄과 정확히 같은 순서·개수로 일치한다.
  // Validates: Requirements 5.1, 5.4

  type LineItem = { line: string; top: boolean };

  // (1) 최상위 미완료 항목: `- [ ] ` + 비어 있지 않은 텍스트 (들여쓰기 없음)
  const unfinishedItem: fc.Arbitrary<LineItem> = meaningfulText.map((txt) => ({
    line: `- [ ] ${txt}`,
    top: true,
  }));

  // (2) 완료 항목: `- [x] ...` / `- [X] ...` (텍스트는 있어도/없어도 됨)
  const completedItem: fc.Arbitrary<LineItem> = fc
    .tuple(
      fc.constantFrom("x", "X"),
      fc.oneof(fc.constant(""), meaningfulText)
    )
    .map(([mark, txt]) => ({
      line: txt.length > 0 ? `- [${mark}] ${txt}` : `- [${mark}]`,
      top: false,
    }));

  // (3) 빈 체크박스: `- [ ]` 또는 `- [ ] ` (의미 있는 텍스트 없음)
  const emptyCheckboxItem: fc.Arbitrary<LineItem> = fc
    .constantFrom("- [ ]", "- [ ] ")
    .map((line) => ({ line, top: false }));

  // (4) 일반 줄 / 빈 줄.
  //  - 들여쓰기(선행 공백/탭)가 없어야 한다 (그래야 미완료 항목의 하위 줄로 수집되지 않음).
  //  - 최상위 미완료 패턴(`- [ ] 텍스트`)을 형성하지 않아야 한다 (개수 정합 보장).
  const ordinaryItem: fc.Arbitrary<LineItem> = fc
    .oneof(
      fc.constant(""),
      meaningfulText.filter(
        (s) => !/^[\t ]/.test(s) && !/^- \[ \]\s+.+/.test(s)
      )
    )
    .map((line) => ({ line, top: false }));

  const lineItem = fc.oneof(
    unfinishedItem,
    completedItem,
    emptyCheckboxItem,
    ordinaryItem
  );

  it("최상위 반환 항목은 모두 미완료 마커+텍스트이며 완료/빈 체크박스는 제외된다", () => {
    fc.assert(
      fc.property(fc.array(lineItem, { maxLength: 30 }), (items) => {
        const content = items.map((it) => it.line).join("\n");
        // 생성된 "미완료 + 텍스트" 최상위 줄 (기대값)
        const expectedTop = items
          .filter((it) => it.top)
          .map((it) => it.line);

        const result = extractUnfinishedTasks(content);

        // 반환 결과 중 비들여쓰기(최상위) 줄만 추린다.
        const returnedTop = result.filter((line) => !/^[\t ]/.test(line));

        for (const line of returnedTop) {
          // (1) 최상위 항목은 `- [ ] ` + 비어 있지 않은 텍스트
          expect(line).toMatch(/^- \[ \] .+/);
        }

        for (const line of result) {
          // (2) 완료 체크박스는 결과에 없다.
          expect(line).not.toMatch(/^- \[[xX]\]/);
          // (3) 텍스트 없는 빈 체크박스(마커 뒤 공백만)는 결과에 없다.
          expect(line).not.toMatch(/^- \[ \]\s*$/);
        }

        // (4) 개수/순서 정합: 들여쓰기 줄을 생성하지 않으므로 반환 항목은 모두 최상위이며
        //     생성된 미완료+텍스트 줄과 정확히 일치한다.
        expect(returnedTop).toEqual(expectedTop);
        expect(result).toEqual(expectedTop);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 6: 들여쓰기 하위 항목 수집
describe("Property 6: 들여쓰기 하위 항목 수집", () => {
  // 최상위 미완료 항목 바로 뒤에 들여쓰기(탭/공백)된 비어 있지 않은 하위 줄이 이어지면:
  //  1) extractUnfinishedTasks(content)는 부모 항목과 그 직후의 K개 하위 줄을
  //     순서대로(연속하여) 포함한다.
  //  2) 첫 번째 비들여쓰기 줄 또는 빈 줄(터미네이터) 이후의 하위 줄은 부모에 귀속되지 않는다.
  // Validates: Requirements 5.3

  // 들여쓰기 접두사: 탭/공백 1개 이상 (반드시 `^[\t ]+` 에 매칭되어야 함)
  const indentPrefix = fc
    .array(fc.constantFrom("\t", " "), { minLength: 1, maxLength: 4 })
    .map((arr) => arr.join(""));

  // 들여쓰기된 비어 있지 않은 하위 줄: <indent><meaningfulText>
  // (trim 후 비어 있지 않으므로 impl의 `trim().length > 0` 조건을 만족한다.)
  const subLine = fc
    .tuple(indentPrefix, meaningfulText)
    .map(([indent, txt]) => `${indent}${txt}`);

  // 최상위 미완료 부모 항목: `- [ ] ` + 비어 있지 않은 텍스트 (들여쓰기 없음)
  const parentLineArb = meaningfulText.map((txt) => `- [ ] ${txt}`);

  // "기타 줄" / 터미네이터로 안전한 줄:
  //  - 비들여쓰기(선행 공백/탭 없음) → 하위 줄로 수집되지 않음
  //  - 최상위 미완료 패턴(`- [ ] 텍스트`)이 아님 → 새 부모 체인을 시작하지 않음
  // 이로써 콘텐츠의 유일한 최상위 미완료 항목이 parentLine 하나로 보장된다.
  const nonIndentedNonUnfinished = meaningfulText.filter(
    (s) => !/^[\t ]/.test(s) && !/^- \[ \]\s+.+/.test(s)
  );

  // 터미네이터: 빈 줄(blank) 또는 (비들여쓰기 + 미완료 아님) 줄
  const terminator = fc.oneof(fc.constant(""), nonIndentedNonUnfinished);

  // prefix/suffix 등 무관한 줄: 빈 줄 또는 (비들여쓰기 + 미완료 아님) 줄
  const safeOtherLine = fc.oneof(fc.constant(""), nonIndentedNonUnfinished);

  it("부모 항목 직후 들여쓰기 하위 줄을 터미네이터 전까지 수집하고, 그 이후 줄은 귀속하지 않는다", () => {
    fc.assert(
      fc.property(
        parentLineArb,
        fc.array(subLine, { minLength: 1, maxLength: 6 }), // K개 하위 줄 (>=1)
        terminator,
        fc.array(subLine, { minLength: 0, maxLength: 4 }), // 터미네이터 이후 하위 줄(귀속 X)
        fc.array(safeOtherLine, { maxLength: 5 }), // prefix (무관한 줄)
        fc.array(safeOtherLine, { maxLength: 5 }), // suffix (무관한 줄)
        (parentLine, subLines, term, trailingSubs, prefix, suffix) => {
          const lines = [
            ...prefix,
            parentLine,
            ...subLines,
            term,
            ...trailingSubs,
            ...suffix,
          ];
          const content = lines.join("\n");

          const result = extractUnfinishedTasks(content);

          // (1) 콘텐츠의 유일한 최상위 미완료 항목은 parentLine 이므로,
          //     결과는 정확히 [parentLine, ...subLines](부모 + 직후 K개 하위 줄)이어야 한다.
          expect(result).toEqual([parentLine, ...subLines]);

          // (2) 터미네이터(빈 줄/비들여쓰기) 이후의 하위 줄들은 부모에 귀속되지 않는다.
          //     → 결과 길이는 정확히 (부모 1 + 하위 K)개로, trailingSubs 가 추가되지 않는다.
          expect(result.length).toBe(1 + subLines.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 7: 서브섹션별 이월 매핑 보존
describe("Property 7: 서브섹션별 이월 매핑 보존", () => {
  // `## 할 일`(또는 인식되는 동의어) 섹션 아래에 여러 `###` 서브섹션이 있고,
  // 각 서브섹션이 미완료 항목(`- [ ] 텍스트`)을 가질 때:
  //  1) extractUnfinishedTasksBySection(content)가 반환하는 맵에서 각 서브섹션 키의 값은
  //     원본에서 그 서브섹션에 속한 미완료 항목들과 정확히 같다(순서·내용 일치, 타 섹션 항목 없음).
  //  2) (역방향 인덱스) 반환된 모든 (키 → 항목)에 대해, 각 항목은 원본에서 바로 그 키에
  //     속해 있던 항목이다(서브섹션 간 이동 없음).
  //  3) 완료(`- [x]`/`- [X]`)·텍스트 없는 빈 체크박스(`- [ ]`)는 어떤 서브섹션 리스트에도 없다.
  // Validates: Requirements 5.2

  // 영숫자만으로 구성한 단순 토큰. 공백/개행/정규식 특수문자가 없어 서브섹션 이름과
  // 항목 텍스트의 추적(원본 귀속 판별)을 모호함 없이 만든다.
  const tokenChar7 = fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
  );
  const token7 = fc
    .array(tokenChar7, { minLength: 1, maxLength: 6 })
    .map((chars) => chars.join(""));

  // impl이 인식하는 `## 할 일` 류 섹션 헤딩 (정규식과 정확히 일치하는 키워드만 사용)
  const todoHeadingArb = fc.constantFrom(
    "## 할 일",
    "## 오늘의 할 일",
    "## To-Do",
    "## Tasks"
  );

  // 서브섹션 원자료(raw). 인덱스는 이후 .map에서 부여해 전역 유일성을 보장한다.
  const rawSubArb = fc.record({
    nameToken: token7,
    // 각 서브섹션의 미완료 항목 토큰 (>=1개)
    unfinishedTokens: fc.array(token7, { minLength: 1, maxLength: 4 }),
    // 노이즈: 완료 항목 개수 / 빈 체크박스 개수 (둘 다 결과에서 제외되어야 함)
    completedCount: fc.nat({ max: 2 }),
    emptyCount: fc.nat({ max: 2 }),
  });

  // 2개 이상(>=2)의 서브섹션. 인덱스 i를 이름/항목에 인코딩하여
  //  - 서브섹션 이름(`Sub-${i}-...`)을 전역 유일하게,
  //  - 미완료 항목(`- [ ] item-${i}-${j}-...`)을 전역 유일하게 만들어 원본 귀속을 추적 가능하게 한다.
  const subsectionsArb = fc
    .array(rawSubArb, { minLength: 2, maxLength: 5 })
    .map((raws) =>
      raws.map((r, i) => ({
        name: `Sub-${i}-${r.nameToken}`,
        unfinished: r.unfinishedTokens.map(
          (tok, j) => `- [ ] item-${i}-${j}-${tok}`
        ),
        completed: Array.from(
          { length: r.completedCount },
          (_, k) => `- [x] done-${i}-${k}`
        ),
        empty: Array.from({ length: r.emptyCount }, () => `- [ ]`),
      }))
    );

  it("각 미완료 항목은 원래 속한 서브섹션 키에만 매핑되며 완료/빈 체크박스는 제외된다", () => {
    fc.assert(
      fc.property(todoHeadingArb, subsectionsArb, (heading, subs) => {
        // content 구성: `## 할 일` 헤딩 + 각 `### 서브섹션`(미완료 → 완료 → 빈 순)
        // 중간에 다른 `##` 헤딩을 넣지 않아 섹션이 조기 종료되지 않도록 한다.
        const lines: string[] = [heading];
        const expected = new Map<string, string[]>(); // 기대 매핑(서브섹션 → 미완료 항목)
        const itemOwner = new Map<string, string>(); // 미완료 항목 라인 → 소유 서브섹션
        const excludedLines: string[] = []; // 결과에 없어야 하는 완료/빈 체크박스 라인

        for (const sub of subs) {
          lines.push(`### ${sub.name}`);
          expected.set(sub.name, [...sub.unfinished]);
          // 미완료 항목 (들여쓰기 없이 → 하위 줄 수집 영향 없음)
          for (const u of sub.unfinished) {
            lines.push(u);
            itemOwner.set(u, sub.name);
          }
          // 노이즈: 완료/빈 체크박스 (모두 들여쓰기 없음)
          for (const c of sub.completed) {
            lines.push(c);
            excludedLines.push(c);
          }
          for (const e of sub.empty) {
            lines.push(e);
            excludedLines.push(e);
          }
        }
        const content = lines.join("\n");

        const result = extractUnfinishedTasksBySection(content);

        // (1) 각 서브섹션 키 → 정확히 그 서브섹션의 미완료 항목(순서·내용 일치)
        for (const [name, items] of expected) {
          expect(result.get(name)).toEqual(items);
        }
        // 반환 키 집합이 기대 키 집합과 정확히 동일 (누락/추가 키 없음)
        expect([...result.keys()].sort()).toEqual(
          [...expected.keys()].sort()
        );

        // (2) 역방향 인덱스: 반환된 모든 (키 → 항목)에서 각 항목은 원본에서 바로 그 키 소유
        for (const [key, items] of result) {
          for (const item of items) {
            expect(itemOwner.get(item)).toBe(key);
          }
        }

        // (3) 완료/빈 체크박스는 어떤 서브섹션 리스트에도 포함되지 않는다
        const allReturned = [...result.values()].flat();
        for (const ex of excludedLines) {
          expect(allReturned).not.toContain(ex);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 8: 이월 주입 후 템플릿 본문 보존
describe("Property 8: 이월 주입 후 템플릿 본문 보존", () => {
  // 임의의 템플릿 콘텐츠(여러 `##`/`###` 헤딩 포함)와 이월 태스크 목록에 대해:
  //  A) injectCarryOverTasks(template, tasks)
  //     - 원본 템플릿의 모든 `##`/`###` 헤딩 줄을 (정확히) 그대로 포함한다(본문 구조 보존).
  //     - 주입된 모든 태스크 줄을 결과에 포함한다.
  //  B) injectTasksIntoSubSection(template, sectionName, tasks) (sectionName ∈ 템플릿의 `###`)
  //     - 원본 템플릿의 모든 `##`/`###` 헤딩 줄을 그대로 포함한다.
  //     - 주입된 모든 태스크 줄을 결과에 포함한다.
  // Validates: Requirements 5.5

  // 헤딩/서브섹션 이름에 사용할 안전한 토큰(영숫자만).
  //  - 정규식 특수문자/공백/개행 없음 → 헤딩 매칭이 모호해지지 않는다.
  //  - 최대 6자 단일 토큰이므로 injectCarryOverTasks가 인식하는 carry-over 키워드
  //    (`carry over`, `unfinished`, `이전 미완료` 등)를 형성할 수 없어 항상 append 분기를 탄다.
  const tokenChar8 = fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789".split("")
  );
  const token8 = fc
    .array(tokenChar8, { minLength: 1, maxLength: 6 })
    .map((chars) => chars.join(""));

  // 템플릿 명세: 1~3개의 `##` 섹션, 각 섹션은 1~3개의 `###` 서브섹션을 가진다.
  const sectionSpecArb = fc.record({
    topTok: token8,
    subTokens: fc.array(token8, { minLength: 1, maxLength: 3 }),
  });
  const templateSpecArb = fc.array(sectionSpecArb, {
    minLength: 1,
    maxLength: 3,
  });

  // 이월 태스크 줄: `- [ ] <텍스트>` (텍스트는 개행 없는 의미 있는 문자열)
  const taskLineArb = meaningfulText.map((txt) => `- [ ] ${txt}`);
  const tasksArb = fc.array(taskLineArb, { minLength: 1, maxLength: 8 });

  // 템플릿 명세 → 실제 콘텐츠 문자열과 메타데이터를 구성한다.
  //  - 헤딩에 섹션/서브섹션 인덱스(i, j)를 인코딩해 전역적으로 유일한 헤딩 줄을 만든다.
  //  - 각 서브섹션 아래에 빈 체크박스(`- [ ]`) 슬롯을 두어 injectTasksIntoSubSection의
  //    삽입 지점을 제공한다.
  function buildTemplate(spec: { topTok: string; subTokens: string[] }[]): {
    template: string;
    headingLines: string[];
    subSectionNames: string[];
  } {
    const lines: string[] = [];
    const headingLines: string[] = [];
    const subSectionNames: string[] = [];

    spec.forEach((sec, i) => {
      const topHeading = `## Top-${i}-${sec.topTok}`;
      lines.push(topHeading);
      headingLines.push(topHeading);
      lines.push(""); // 무관한 본문(빈 줄)

      sec.subTokens.forEach((subTok, j) => {
        const name = `Sub-${i}-${j}-${subTok}`;
        const subHeading = `### ${name}`;
        lines.push(subHeading);
        headingLines.push(subHeading);
        subSectionNames.push(name);
        lines.push("- [ ]"); // 빈 체크박스 슬롯
      });
    });

    return { template: lines.join("\n"), headingLines, subSectionNames };
  }

  it("A) injectCarryOverTasks는 모든 원본 헤딩을 보존하고 모든 태스크 줄을 포함한다", () => {
    fc.assert(
      fc.property(templateSpecArb, tasksArb, (spec, tasks) => {
        const { template, headingLines } = buildTemplate(spec);

        const result = injectCarryOverTasks(template, tasks);
        const resultLines = result.split("\n");

        // (1) 본문 구조 보존: 원본의 모든 `##`/`###` 헤딩 줄이 결과에 그대로 존재.
        for (const heading of headingLines) {
          expect(resultLines).toContain(heading);
        }

        // (2) 주입된 모든 태스크 줄이 결과에 포함된다.
        for (const task of tasks) {
          expect(resultLines).toContain(task);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("B) injectTasksIntoSubSection은 모든 원본 헤딩을 보존하고 모든 태스크 줄을 포함한다", () => {
    fc.assert(
      fc.property(
        templateSpecArb,
        tasksArb,
        fc.nat(),
        (spec, tasks, selectionSeed) => {
          const { template, headingLines, subSectionNames } =
            buildTemplate(spec);

          // 템플릿의 `###` 서브섹션 중 하나를 결정적으로 선택한다(항상 1개 이상 존재).
          const sectionName =
            subSectionNames[selectionSeed % subSectionNames.length];

          const result = injectTasksIntoSubSection(
            template,
            sectionName,
            tasks
          );
          const resultLines = result.split("\n");

          // (1) 본문 구조 보존: 원본의 모든 `##`/`###` 헤딩 줄이 결과에 그대로 존재.
          //     (빈 체크박스 슬롯은 소비되어 사라질 수 있으나 헤딩은 보존된다.)
          for (const heading of headingLines) {
            expect(resultLines).toContain(heading);
          }

          // (2) 주입된 모든 태스크 줄이 결과에 포함된다.
          for (const task of tasks) {
            expect(resultLines).toContain(task);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 16: selectMostRecentBefore — today 미만 중 최대 날짜 선택
describe("Property 16: selectMostRecentBefore — today 미만 중 최대 날짜 선택", () => {
  // `{ date }` 후보의 임의 목록과 기준 날짜 today에 대해:
  //  1) 결과가 null이면 → date < today인 후보가 하나도 없다.
  //  2) 결과가 non-null이면 → result.date < today 이고, today 미만인 다른 모든 후보의
  //     날짜 이상이다(즉 today 미만 후보 중 최대 날짜).
  //  3) 동률(최대 날짜 < today가 여러 개)일 때, 반환되는 항목은 입력 순서상 가장 먼저
  //     등장한 해당 최대-날짜 후보다(first-encountered).
  // Validates: Requirements 5.1

  // 날짜를 "일(day)" 단위 자정 Date로만 생성한다.
  //  - 기준 epoch(2026-01-01 UTC)에서 dayOffset 만큼 떨어진 시각.
  //  - 시간 성분이 없어 getTime() 비교가 깔끔하며, 좁은 범위(±120일)로 동률(같은 날짜)이
  //    자주 발생하도록 하여 tie 동작(규칙 3)을 충분히 검증한다.
  const BASE_UTC = Date.UTC(2026, 0, 1);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dayDate = fc
    .integer({ min: -120, max: 120 })
    .map((off) => new Date(BASE_UTC + off * DAY_MS));

  // 후보 목록: 날짜 배열을 생성한 뒤 입력 순서 추적용 id(=원본 인덱스)를 부여한다.
  const candidatesArb = fc
    .array(dayDate, { maxLength: 30 })
    .map((dates) => dates.map((date, id) => ({ date, id })));

  it("today 미만 후보 중 최대 날짜를 반환하고(동률 시 first-encountered), 없으면 null", () => {
    fc.assert(
      fc.property(candidatesArb, dayDate, (candidates, today) => {
        const result = selectMostRecentBefore(candidates, today);

        const todayTime = today.getTime();
        // today 미만(엄격한 <) 후보만 추린다.
        const before = candidates.filter((c) => c.date.getTime() < todayTime);

        if (result === null) {
          // (1) null → today 미만 후보가 존재하지 않는다.
          expect(before.length).toBe(0);
        } else {
          // (2a) 반환 항목은 today 미만이다.
          expect(result.date.getTime()).toBeLessThan(todayTime);

          // (2b) 반환 항목은 today 미만 후보 중 최대 날짜다.
          const maxBeforeTime = Math.max(
            ...before.map((c) => c.date.getTime())
          );
          expect(result.date.getTime()).toBe(maxBeforeTime);
          for (const c of before) {
            expect(result.date.getTime()).toBeGreaterThanOrEqual(
              c.date.getTime()
            );
          }

          // (3) 동률 시 first-encountered: 최대 날짜이면서 today 미만인 후보 중
          //     입력 순서상 가장 먼저 등장한 항목이 반환되어야 한다.
          const firstMaxIndex = candidates.findIndex(
            (c) =>
              c.date.getTime() === maxBeforeTime &&
              c.date.getTime() < todayTime
          );
          // 반환 객체는 그 인덱스의 후보와 동일한 참조여야 한다.
          expect(candidates[firstMaxIndex]).toBe(result);
          expect(result.id).toBe(firstMaxIndex);
        }
      }),
      { numRuns: 100 }
    );
  });
});
