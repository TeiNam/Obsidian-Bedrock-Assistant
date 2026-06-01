import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildDateStr,
  buildTodoDocBasename,
  buildTimeboxDocBasename,
  buildTodoLink,
  buildTimeboxLink,
  ensureCrossLink,
  localizeTemplateLinks,
  parseDateFolder,
  parseLegacyBasename,
  parseWikiLinkTarget,
  substituteDate,
} from "./planner-paths";

// ============================================
// planner-paths 속성 테스트
// ============================================
// 이 파일은 daily-planner 스펙의 순수 경로/명명/링크 함수 속성을 검증한다.
// 각 속성은 향후 병합 충돌을 피하기 위해 독립된 describe(...) 블록으로 구성한다.
// (Property 1 외 Property 2/3/4/11/13은 이후 작업에서 별도 블록으로 추가된다.)

// Feature: daily-planner, Property 1: 날짜 문자열 라운드트립 및 형식 검증
describe("Property 1: 날짜 문자열 라운드트립 및 형식 검증", () => {
  // 유효한 Date d에 대해:
  //  - buildDateStr(d)는 ^\d{4}-\d{2}-\d{2}$ 형식(월/일 2자리 zero-pad)을 만족한다.
  //  - parseDateFolder/parseLegacyBasename는 d의 연/월/일을 동일하게 복원한다.
  // Validates: Requirements 1.6, 8.2, 8.3
  it("buildDateStr → parseDateFolder/parseLegacyBasename 라운드트립 및 형식 일치", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date(2000, 0, 1),
          max: new Date(2099, 11, 31),
        }),
        (d) => {
          const s = buildDateStr(d);

          // 형식 검증: 4자리 연도 - 2자리 월 - 2자리 일
          expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);

          // 두 파서 모두 동일한 연/월/일을 복원해야 한다.
          for (const parsed of [parseDateFolder(s), parseLegacyBasename(s)]) {
            expect(parsed).not.toBeNull();
            expect(parsed!.getFullYear()).toBe(d.getFullYear());
            expect(parsed!.getMonth()).toBe(d.getMonth());
            expect(parsed!.getDate()).toBe(d.getDate());
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // YYYY-MM-DD 형식이 아니거나 달력상 유효하지 않은 임의 문자열에 대해
  // 두 파서는 모두 null을 반환한다.
  // Validates: Requirements 1.6, 8.2, 8.3
  it("형식 위반 또는 달력 무효 문자열은 두 파서 모두 null 반환", () => {
    const yearField = fc.integer({ min: 2000, max: 2099 }).map(String);
    const validMonthField = fc
      .integer({ min: 1, max: 12 })
      .map((n) => String(n).padStart(2, "0"));
    const validDayField = fc
      .integer({ min: 1, max: 31 })
      .map((n) => String(n).padStart(2, "0"));

    // 범위를 벗어난 2자리 월/일 (형식은 맞지만 달력상 무효)
    const invalidMonthField = fc.oneof(
      fc.constant("00"),
      fc.integer({ min: 13, max: 99 }).map((n) => String(n).padStart(2, "0"))
    );
    const invalidDayField = fc.oneof(
      fc.constant("00"),
      fc.integer({ min: 32, max: 99 }).map((n) => String(n).padStart(2, "0"))
    );

    // 형식(정규식)은 만족하지만 월/일이 범위를 벗어난 달력 무효 문자열
    const outOfRange = fc
      .oneof(
        fc.tuple(yearField, invalidMonthField, validDayField),
        fc.tuple(yearField, validMonthField, invalidDayField),
        fc.tuple(yearField, invalidMonthField, invalidDayField)
      )
      .map(([y, m, d]) => `${y}-${m}-${d}`);

    // YYYY-MM-DD 형식 자체를 위반하는 문자열
    const malformed = fc.oneof(
      fc.constant(""),
      fc.constant("not-a-date"),
      fc.constant("2026/02/10"),
      fc.constant("2026.02.10"),
      fc.constant("20260210"),
      fc.constant("26-02-10"),
      fc.constant("2026-2-10"),
      fc.constant("2026-02-1"),
      fc.constant("2026-02-100"),
      fc.constant("2026-02-10 "),
      fc.constant(" 2026-02-10"),
      fc.constant("2026-02-10x"),
      // 무작위 문자열 중 형식에 일치하지 않는 것만 사용
      fc.string().filter((s) => !/^\d{4}-\d{2}-\d{2}$/.test(s))
    );

    fc.assert(
      fc.property(fc.oneof(outOfRange, malformed), (s) => {
        expect(parseDateFolder(s)).toBeNull();
        expect(parseLegacyBasename(s)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // 형식과 월/일 범위는 만족하지만 실제 달력상 존재하지 않는 날짜(예: 2월 30일)도 null이어야 한다.
  // Validates: Requirements 1.6, 8.2, 8.3
  it("달력상 존재하지 않는 날짜(2월 30일 등)는 두 파서 모두 null 반환", () => {
    const calendarInvalid = [
      "2026-02-30", // 2월 30일 없음
      "2026-02-31", // 2월 31일 없음
      "2023-02-29", // 2023은 윤년 아님
      "2025-04-31", // 4월은 30일까지
      "2024-06-31", // 6월은 30일까지
      "2027-09-31", // 9월은 30일까지
      "2026-11-31", // 11월은 30일까지
    ];

    for (const s of calendarInvalid) {
      expect(parseDateFolder(s)).toBeNull();
      expect(parseLegacyBasename(s)).toBeNull();
    }
  });
});

// Feature: daily-planner, Property 11: 템플릿 {{date}} 치환 완전성
describe("Property 11: 템플릿 {{date}} 치환 완전성", () => {
  // {{date}} 토큰을 0개 이상 포함하는 임의의 템플릿 콘텐츠와 날짜 d에 대해:
  //  - substituteDate(content, d) 결과는 더 이상 "{{date}}" 토큰을 포함하지 않는다.
  //  - 원본에 토큰이 1개 이상 있었다면 결과는 buildDateStr(d) 문자열을 포함한다.
  //  - (추가) 입력의 토큰 개수와 결과에 추가된 buildDateStr(d) 개수가 정확히 일치한다.
  // Validates: Requirements 1.5, 3.7

  // 부분 문자열 needle이 haystack 안에서 등장하는 횟수(겹치지 않게)를 센다.
  const countOccurrences = (haystack: string, needle: string): number => {
    if (needle.length === 0) return 0;
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      count++;
      index = haystack.indexOf(needle, index + needle.length);
    }
    return count;
  };

  // 토큰과 충돌하지 않는 "안전한" 텍스트 조각 제너레이터.
  // - '{' / '}' 를 배제하여 조각이 우연히 "{{date}}" 토큰을 형성하지 못하게 한다.
  // - 숫자/'-' 를 배제하여 조각이 우연히 buildDateStr(d)("YYYY-MM-DD")를 포함하지 못하게 한다.
  //   → 이를 통해 "토큰 개수 == 추가된 날짜 문자열 개수" 불변식을 안전하게 검증할 수 있다.
  const safeChar = fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEF가나다라마 \t\n#.,:!?()[]".split("")
  );
  const fragment = fc
    .array(safeChar, { maxLength: 20 })
    .map((chars) => chars.join(""));

  it("substituteDate는 모든 {{date}} 토큰을 제거하고 YYYY-MM-DD로 치환한다", () => {
    fc.assert(
      fc.property(
        // 1개 이상의 안전한 조각을 "{{date}}"로 이어붙여 토큰을 사이사이에 끼워 넣는다.
        // 조각이 1개면 토큰 0개(치환 대상 없음) 케이스도 함께 검증된다.
        fc.array(fragment, { minLength: 1, maxLength: 6 }),
        fc.date({
          min: new Date(2000, 0, 1),
          max: new Date(2099, 11, 31),
        }),
        (fragments, d) => {
          const content = fragments.join("{{date}}");
          const tokenCount = fragments.length - 1; // 조각 사이마다 토큰 1개
          const dateStr = buildDateStr(d);

          const result = substituteDate(content, d);

          // 1) 치환 후에는 어떤 경우에도 "{{date}}" 토큰이 남아 있지 않다.
          expect(result.includes("{{date}}")).toBe(false);

          // 2) 원본에 토큰이 하나라도 있었다면 결과는 날짜 문자열을 포함한다.
          if (tokenCount > 0) {
            expect(result.includes(dateStr)).toBe(true);
          }

          // 3) 안전한 조각은 날짜 문자열을 포함하지 않으므로,
          //    입력 토큰 개수만큼 정확히 날짜 문자열이 추가되어야 한다.
          expect(countOccurrences(result, dateStr)).toBe(tokenCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 13: 문서 파일명 단사성(injective)
describe("Property 13: 문서 파일명 단사성(injective)", () => {
  // 두 (날짜, 종류) 쌍 (d1, k1), (d2, k2) — 종류 ∈ {To-Do, TimeBox} — 에 대해:
  //  - 생성된 basename이 같으면 (d1, k1) = (d2, k2) 여야 한다 (단사성/injective).
  //    즉 basename(d1,k1) === basename(d2,k2) ⇒ (sameYMD(d1,d2) AND k1===k2).
  //  - 같은 날짜라도 To-Do basename과 TimeBox basename은 항상 다르다.
  //  - 다른 날짜(연/월/일 중 하나라도 다름)의 같은 종류 basename도 항상 다르다.
  // Validates: Requirements 2.5

  type Kind = "todo" | "timebox";

  // 종류에 따라 적절한 basename 빌더를 선택하는 헬퍼.
  const basenameOf = (date: Date, kind: Kind): string =>
    kind === "todo"
      ? buildTodoDocBasename(date)
      : buildTimeboxDocBasename(date);

  // 두 날짜의 연/월/일(Y/M/D)이 동일한지 비교한다.
  // basename은 "YYYY-MM-DD" 단위로만 날짜를 표현하므로 시/분/초는 무시한다.
  const sameYMD = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const dateArb = fc.date({
    min: new Date(2000, 0, 1),
    max: new Date(2099, 11, 31),
  });
  const kindArb = fc.constantFrom<Kind>("todo", "timebox");

  it("basename이 같으면 (날짜 Y/M/D, 종류)가 같다 (단사성)", () => {
    fc.assert(
      fc.property(
        dateArb,
        kindArb,
        dateArb,
        kindArb,
        (d1, k1, d2, k2) => {
          const equalName = basenameOf(d1, k1) === basenameOf(d2, k2);
          // 단사성: 이름이 같다는 것은 곧 (Y/M/D 동일) ∧ (종류 동일) 을 함의한다.
          if (equalName) {
            expect(sameYMD(d1, d2)).toBe(true);
            expect(k1).toBe(k2);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("같은 날짜의 To-Do basename과 TimeBox basename은 항상 다르다", () => {
    fc.assert(
      fc.property(dateArb, (d) => {
        expect(buildTodoDocBasename(d)).not.toBe(buildTimeboxDocBasename(d));
      }),
      { numRuns: 100 }
    );
  });

  it("연/월/일이 다른 같은 종류 basename은 항상 다르다", () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        kindArb,
        (d1, d2, kind) => {
          // 전제: 두 날짜의 Y/M/D가 실제로 다른 경우에만 검증한다.
          fc.pre(!sameYMD(d1, d2));
          expect(basenameOf(d1, kind)).not.toBe(basenameOf(d2, kind));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 2: 템플릿 링크 지역화(generic → per-date)
describe("Property 2: 템플릿 링크 지역화(generic → per-date)", () => {
  // 임의의 날짜 d와, 일반 링크 토큰 "[[Daily To-Do]]"·"[[TimeBox Daily]]"(설정된
  // 템플릿명)를 포함하는 임의의 템플릿 콘텐츠에 대해:
  //  - localizeTemplateLinks(content, d, "Daily To-Do", "TimeBox Daily") 결과는
  //    buildTodoLink(d)("[[YYYY-MM-DD To-Do]]")와 buildTimeboxLink(d)
  //    ("[[YYYY-MM-DD TimeBox]]")를 포함한다.
  //  - 원래의 단독 일반 토큰("[[Daily To-Do]]"/"[[TimeBox Daily]]")은 더 이상 포함하지 않는다.
  //  - 동일 변환을 한 번 더 적용해도 결과가 변하지 않는다(멱등).
  // Validates: Requirements 2.1

  // 설정된 고정 템플릿명 (md_templates/Daily To-Do.md, TimeBox Daily.md 와 일치)
  const TODO_TEMPLATE_NAME = "Daily To-Do";
  const TIMEBOX_TEMPLATE_NAME = "TimeBox Daily";

  // 일반 토큰과 충돌하지 않는 "안전한" 텍스트 조각 제너레이터.
  // - '[' / ']' 를 배제하여 조각이 우연히 위키 링크 토큰("[[...]]")을 형성하지 못하게 한다.
  // - 숫자/'-' 를 배제하여 조각이 우연히 per-date 문자열("YYYY-MM-DD ...")을 포함하지 못하게 한다.
  //   → 이를 통해 "치환 후 per-date 링크가 생겼는지/일반 토큰이 사라졌는지"를 안전하게 검증할 수 있다.
  const safeChar = fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEF가나다라마 \t\n#.,:!?()".split("")
  );
  const fragment = fc
    .array(safeChar, { maxLength: 20 })
    .map((chars) => chars.join(""));

  const dateArb = fc.date({
    min: new Date(2000, 0, 1),
    max: new Date(2099, 11, 31),
  });

  it("일반 토큰을 per-date 링크로 치환하고 원본 토큰을 제거한다(멱등)", () => {
    fc.assert(
      fc.property(
        // 안전한 조각들 사이사이에 일반 토큰을 끼워 넣어 임의의 템플릿 콘텐츠를 구성한다.
        // 두 종류의 일반 토큰이 모두 최소 1회 이상 등장하도록 보장한다.
        fc.array(fragment, { minLength: 1, maxLength: 5 }),
        fc.array(fragment, { minLength: 1, maxLength: 5 }),
        dateArb,
        (todoFragments, timeboxFragments, d) => {
          const TODO_TOKEN = `[[${TODO_TEMPLATE_NAME}]]`;
          const TIMEBOX_TOKEN = `[[${TIMEBOX_TEMPLATE_NAME}]]`;

          // 조각 사이마다 토큰을 끼우고, 두 토큰 그룹을 합쳐 하나의 콘텐츠로 만든다.
          const todoSection = todoFragments.join(TODO_TOKEN);
          const timeboxSection = timeboxFragments.join(TIMEBOX_TOKEN);
          // 두 종류 토큰이 모두 최소 1회 등장하도록 명시적으로 추가 결합한다.
          const content = `${todoSection}\n${TODO_TOKEN} ${TIMEBOX_TOKEN}\n${timeboxSection}`;

          const todoLink = buildTodoLink(d); // [[YYYY-MM-DD To-Do]]
          const timeboxLink = buildTimeboxLink(d); // [[YYYY-MM-DD TimeBox]]

          const result = localizeTemplateLinks(
            content,
            d,
            TODO_TEMPLATE_NAME,
            TIMEBOX_TEMPLATE_NAME
          );

          // 1) 결과는 per-date To-Do/TimeBox 링크를 포함한다.
          expect(result.includes(todoLink)).toBe(true);
          expect(result.includes(timeboxLink)).toBe(true);

          // 2) 결과에는 단독 일반 토큰이 더 이상 남아 있지 않다.
          expect(result.includes(TODO_TOKEN)).toBe(false);
          expect(result.includes(TIMEBOX_TOKEN)).toBe(false);

          // 3) 멱등: 한 번 더 변환해도 결과가 동일하다.
          const again = localizeTemplateLinks(
            result,
            d,
            TODO_TEMPLATE_NAME,
            TIMEBOX_TEMPLATE_NAME
          );
          expect(again).toBe(result);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 3: Cross_Link 빌드/파싱 왕복 일관성
describe("Property 3: Cross_Link 빌드/파싱 왕복 일관성", () => {
  // 임의의 날짜 d에 대해:
  //  - parseWikiLinkTarget(buildTimeboxLink(d)) === buildTimeboxDocBasename(d)
  //  - parseWikiLinkTarget(buildTodoLink(d))   === buildTodoDocBasename(d)
  //  - 각 basename의 선두 "YYYY-MM-DD" 날짜 부분을 다시 파싱하면 d의 연/월/일과 같다.
  //    (Todo → 링크 → 대상(basename) → 날짜 → Todo, TimeBox 동일 왕복이 원래 날짜로 복귀)
  // Validates: Requirements 2.6, 2.5

  const dateArb = fc.date({
    min: new Date(2000, 0, 1),
    max: new Date(2099, 11, 31),
  });

  // basename("YYYY-MM-DD <종류>")에서 선두 10자(YYYY-MM-DD) 날짜 부분을 잘라낸다.
  const leadingDateStr = (basename: string): string => basename.slice(0, 10);

  it("buildXxxLink → parseWikiLinkTarget → basename → 날짜 왕복이 일관된다", () => {
    fc.assert(
      fc.property(dateArb, (d) => {
        // 1) TimeBox 링크의 파싱 대상은 TimeBox basename과 정확히 일치한다.
        const timeboxBasename = buildTimeboxDocBasename(d);
        expect(parseWikiLinkTarget(buildTimeboxLink(d))).toBe(timeboxBasename);

        // 2) To-Do 링크의 파싱 대상은 To-Do basename과 정확히 일치한다.
        const todoBasename = buildTodoDocBasename(d);
        expect(parseWikiLinkTarget(buildTodoLink(d))).toBe(todoBasename);

        // 3) 각 basename의 선두 날짜 부분을 다시 파싱하면 원래 날짜(연/월/일)로 복귀한다.
        for (const basename of [timeboxBasename, todoBasename]) {
          const dateStr = leadingDateStr(basename);

          // 선두 10자는 buildDateStr(d)와 동일해야 한다(형식 일관성 보강 확인).
          expect(dateStr).toBe(buildDateStr(d));

          // parseDateFolder/parseLegacyBasename 모두 동일한 날짜를 복원해야 한다.
          for (const parsed of [
            parseDateFolder(dateStr),
            parseLegacyBasename(dateStr),
          ]) {
            expect(parsed).not.toBeNull();
            expect(parsed!.getFullYear()).toBe(d.getFullYear());
            expect(parsed!.getMonth()).toBe(d.getMonth());
            expect(parsed!.getDate()).toBe(d.getDate());
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 4: ensureCrossLink 보장 및 멱등성
describe("Property 4: ensureCrossLink 보장 및 멱등성", () => {
  // 임의의 문자열 콘텐츠 c와 위키 링크 target에 대해:
  //  - 보장: ensureCrossLink(c, target)의 결과는 항상 target(대상 동일성 기준)을 포함한다.
  //  - 멱등: ensureCrossLink(ensureCrossLink(c, target), target) === ensureCrossLink(c, target)
  //          (한 번 더 적용해도 결과가 변하지 않으며 링크가 중복 추가되지 않는다).
  //  - 무중복: target과 같은 대상을 가리키는 위키 링크의 개수는 결과에서 정확히 1개다.
  // Validates: Requirements 2.2

  const dateArb = fc.date({
    min: new Date(2000, 0, 1),
    max: new Date(2099, 11, 31),
  });

  // 대괄호('[' / ']')를 제거한 임의의 본문 제너레이터(스마트 제너레이터).
  // - fc.string()의 임의 문자열에서 대괄호만 제거하여, 우연히 생성되거나 닫히지 않은
  //   위키 링크 토큰("[[...")이 만들어지지 않도록 입력 공간을 의미 있게 제한한다.
  // - 이렇게 하면 "본문에는 target 링크가 없다(혹은 의도적으로 1개만 주입한다)"는 전제를
  //   안전하게 보장할 수 있어 보장/멱등/무중복 속성을 정확히 검증할 수 있다.
  const linkFreeContent = fc.string().map((s) => s.replace(/[\[\]]/g, ""));

  // 임의의 [[name]] 링크용 이름 제너레이터(대괄호·파이프 미포함, 앞뒤 공백 없음, 비어 있지 않음).
  const nameChar = fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789 가나다라마-".split("")
  );
  const linkName = fc
    .array(nameChar, { minLength: 1, maxLength: 24 })
    .map((cs) => cs.join(""))
    .filter((s) => s.length > 0 && s === s.trim());

  // 유효한 위키 링크 target: 현실적인 날짜 기반 링크(To-Do/TimeBox) + 임의의 [[name]] 링크.
  const validTargetArb = fc.oneof(
    dateArb.map((d) => buildTimeboxLink(d)),
    dateArb.map((d) => buildTodoLink(d)),
    linkName.map((n) => `[[${n}]]`)
  );

  // 별칭(alias) 텍스트: 대괄호·파이프 미포함의 단순 문자.
  const aliasText = fc
    .array(fc.constantFrom(..."abcdAB가나 ".split("")), { maxLength: 10 })
    .map((cs) => cs.join(""));

  // 콘텐츠 안에서 parse된 대상이 targetName과 일치하는 위키 링크의 개수를 센다.
  // 구현의 collectWikiLinkTargets와 동일한 정규식을 사용해 함수의 내부 판정과 일치시킨다.
  const countLinksWithTarget = (content: string, targetName: string): number => {
    const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
    let count = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1].trim() === targetName) count++;
    }
    return count;
  };

  it("target 링크가 없는 콘텐츠에는 링크를 추가하여 항상 포함시키고, 멱등이며 중복이 없다", () => {
    fc.assert(
      fc.property(linkFreeContent, validTargetArb, (content, target) => {
        const targetName = parseWikiLinkTarget(target);
        expect(targetName).not.toBeNull();

        const result = ensureCrossLink(content, target);

        // 보장(문자열): 추가되었으므로 결과는 target 링크 문자열을 그대로 포함한다.
        expect(result.includes(target)).toBe(true);
        // 보장(대상 동일성) + 무중복: 같은 대상의 링크가 정확히 1개 존재한다.
        expect(countLinksWithTarget(result, targetName!)).toBe(1);

        // 멱등: 한 번 더 적용해도 결과가 동일하다(중복 추가 없음).
        expect(ensureCrossLink(result, target)).toBe(result);
      }),
      { numRuns: 100 }
    );
  });

  it("이미 같은 대상의 링크가 있으면(별칭 포함) 변경 없이 반환하고 멱등이며 중복을 추가하지 않는다", () => {
    fc.assert(
      fc.property(
        linkFreeContent,
        linkFreeContent,
        validTargetArb,
        fc.boolean(),
        aliasText,
        (prefix, suffix, target, useAlias, alias) => {
          const targetName = parseWikiLinkTarget(target);
          expect(targetName).not.toBeNull();

          // 이미 존재하는 링크: 정확한 형태 [[name]] 또는 별칭 형태 [[name|alias]].
          const existingLink = useAlias
            ? `[[${targetName}|${alias}]]`
            : `[[${targetName}]]`;
          const content = `${prefix}\n${existingLink}\n${suffix}`;

          // 전제: 콘텐츠에는 같은 대상 링크가 정확히 1개만 존재한다.
          expect(countLinksWithTarget(content, targetName!)).toBe(1);

          const result = ensureCrossLink(content, target);

          // 같은 대상 링크가 이미 있으므로 원본을 그대로 반환한다(중복 추가 없음).
          expect(result).toBe(content);
          // 같은 대상의 링크 수는 여전히 정확히 1개다.
          expect(countLinksWithTarget(result, targetName!)).toBe(1);

          // 멱등: 한 번 더 적용해도 결과가 동일하다.
          expect(ensureCrossLink(result, target)).toBe(result);
        }
      ),
      { numRuns: 100 }
    );
  });
});
