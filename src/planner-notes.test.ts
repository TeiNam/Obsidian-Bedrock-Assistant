import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { parseDateFromNoteLine } from "./todo-manager";
import { buildDateStr } from "./planner-paths";

// ============================================
// planner-notes 속성 테스트
// ============================================
// 이 파일은 daily-planner 스펙의 메모 날짜 항목 승계 관련 순수 함수
// (parseDateFromNoteLine)의 속성을 검증한다.
// 각 속성은 향후 병합 충돌을 피하기 위해 독립된 describe(...) 블록으로 구성한다.
// (Property 10은 이후 작업 3.9에서 별도 블록으로 추가된다.)

// 날짜와 today를 "일(day)" 단위로만 비교하기 위해 시/분/초를 제거한 epoch(ms)로 환산한다.
// buildDateStr이 getFullYear/getMonth/getDate만 사용하므로 비교 기준을 동일하게 맞춘다.
const dayOnlyTime = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Feature: daily-planner, Property 9: 메모 날짜 항목 필터(오늘 이후만 승계)
describe("Property 9: 메모 날짜 항목 필터(오늘 이후만 승계)", () => {
  // 안전한 범위(2000~2099)의 Date 제너레이터.
  // 이 범위에서는 연도가 모두 4자리이므로 "YYYY-MM-DD" 문자열의 사전식(lexicographic)
  // 비교가 실제 날짜 대소 비교와 항상 일치한다.
  const dateArb = fc.date({
    min: new Date(2000, 0, 1),
    max: new Date(2099, 11, 31),
  });

  // "의미 있는 텍스트" 제너레이터.
  // - 영문자/한글/공백만 사용하여 날짜·시간·구분자 패턴과 충돌하지 않게 한다.
  //   (parseDateFromNoteLine은 날짜 뒤의 HH:MM / N시 / "예정" / 선행 콜론·대시를
  //    제거하므로, 숫자/특수문자로 시작하면 텍스트가 비어버릴 수 있다.)
  // - trim 후 비어 있지 않은(= 의미 있는) 텍스트만 사용한다.
  const meaningfulTextChar = fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP가나다라마바사아자차 ".split("")
  );
  const meaningfulText = fc
    .array(meaningfulTextChar, { minLength: 1, maxLength: 25 })
    .map((cs) => cs.join("").trim())
    // 첫 글자는 반드시 영문자/한글이 되도록 보장(선행 공백 제거 후) → 스트립으로 사라지지 않음
    .filter((s) => s.length > 0 && /^[A-Za-z가-힣]/.test(s));

  // ── 6.2 / 6.3: parseDateFromNoteLine이 올바른 dateStr을 보고하여
  //              호출부의 "dateStr >= todayStr" 사전식 필터가 의미적으로 정확히 동작함 ──
  //
  // 임의의 기준 날짜 today와 임의의 대상 날짜 targetDate, 의미 있는 텍스트로
  // "- YYYY-MM-DD <text>" 메모 줄을 구성하면:
  //  1) parseDateFromNoteLine은 null이 아닌 결과를 반환한다.
  //  2) 반환된 dateStr은 대상 날짜의 "YYYY-MM-DD" 문자열과 정확히 일치한다.
  //  3) 호출부 사전식 비교(dateStr >= todayStr)의 결과는 실제 날짜 비교
  //     (targetDate >= today, 일 단위)의 결과와 항상 일치한다.
  //     → 즉 today 이상이면 승계 대상(포함), today 미만이면 제외된다(6.2/6.3).
  // Validates: Requirements 6.2, 6.3
  it("올바른 dateStr 보고로 today 이상/미만 승계 결정이 일치한다", () => {
    fc.assert(
      fc.property(dateArb, dateArb, meaningfulText, (today, targetDate, text) => {
        const expectedDateStr = buildDateStr(targetDate);
        const todayStr = buildDateStr(today);
        const line = `- ${expectedDateStr} ${text}`;

        const result = parseDateFromNoteLine(line, today);

        // 1) 날짜 표기 + 의미 있는 텍스트가 있으므로 null이 아니어야 한다.
        expect(result).not.toBeNull();

        // 2) 보고된 dateStr이 대상 날짜와 정확히 일치해야 한다.
        expect(result!.dateStr).toBe(expectedDateStr);

        // 3) 사전식 필터 결과 == 실제 날짜(일 단위) 비교 결과.
        const lexIncluded = result!.dateStr >= todayStr;
        const actualIncluded = dayOnlyTime(targetDate) >= dayOnlyTime(today);
        expect(lexIncluded).toBe(actualIncluded);
      }),
      { numRuns: 100 }
    );
  });

  // ── 6.6: 날짜 표기 외 의미 있는 텍스트를 추출할 수 없으면 어떤 날짜든 제외(null) ──
  //
  // 날짜 마커만 있고 의미 있는 텍스트가 없는 줄(공백/구분자/제거 대상 키워드만 존재)은
  // parseDateFromNoteLine이 null을 반환해야 한다(승계 대상에서 제외).
  // Validates: Requirements 6.6
  it("날짜 마커만 있고 의미 있는 텍스트가 없으면 null을 반환한다", () => {
    // 날짜 뒤에 붙는 "무의미한 꼬리표" 후보.
    // 모두 parseDateFromNoteLine 내부의 스트립 규칙으로 제거되어 텍스트가 비게 된다.
    const emptyTail = fc.constantFrom(
      "", // 날짜만
      " ", // 공백 1개
      "   ", // 공백 여러 개
      "\t", // 탭
      " :", // 선행 콜론 구분자
      " -", // 선행 대시 구분자
      " 예정", // "예정" 키워드 (제거됨)
      " 예정 ", // "예정" + 공백
      " : ", // 콜론 + 공백
      " - " // 대시 + 공백
    );

    fc.assert(
      fc.property(dateArb, emptyTail, (targetDate, tail) => {
        const dateStr = buildDateStr(targetDate);
        const line = `- ${dateStr}${tail}`;

        // 날짜 외 의미 있는 텍스트가 없으므로 null이어야 한다.
        expect(parseDateFromNoteLine(line, targetDate)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // ── 보조: 리스트 항목("- ")이 아니면 어떤 날짜/텍스트가 있어도 null ──
  //
  // parseDateFromNoteLine은 "- "로 시작하는 목록 항목만 메모 후보로 인식한다.
  // 목록 마커가 없는 줄은 (날짜와 텍스트가 모두 있어도) null을 반환한다.
  // Validates: Requirements 6.2 (메모 목록 항목 한정 추출의 경계 조건)
  it("목록 항목('- ')이 아닌 줄은 null을 반환한다", () => {
    // "- " 로 시작하지 않는 다양한 비-목록 접두사.
    const nonListPrefix = fc.constantFrom(
      "", // 마커 없음: "2026-03-01 텍스트"
      "* ", // 별표 불릿 (대시가 아님)
      "+ ", // 플러스 불릿
      "> ", // 인용
      "#", // 헤딩 기호
      "텍스트 ", // 일반 텍스트 선행
      "-" // 대시 뒤 공백 없음 ("-\\s+" 불일치)
    );

    fc.assert(
      fc.property(
        dateArb,
        meaningfulText,
        nonListPrefix,
        (targetDate, text, prefix) => {
          const dateStr = buildDateStr(targetDate);
          const line = `${prefix}${dateStr} ${text}`;
          expect(parseDateFromNoteLine(line, targetDate)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 10: 메모 날짜 형식 인식 및 연도 보정
describe("Property 10: 메모 날짜 형식 인식 및 연도 보정", () => {
  // 기준 날짜(refDate) 제너레이터. 2000~2099 범위라 연도는 항상 4자리.
  const refDateArb = fc.date({
    min: new Date(2000, 0, 1),
    max: new Date(2099, 11, 31),
  });

  // 대상(연,월,일) 제너레이터.
  // - year: 4자리 안전 범위(2000~2099) → "YYYY-MM-DD" 형식에서 정규식 (\d{4}) 와 일치.
  // - month: 1~12.
  // - day: 1~28 → 달력 말일 경계(예: 2/30) 모호성 회피. 이 형식들은 달력 유효성을
  //   엄격히 검증하지 않으므로 안전한 범위만 사용한다.
  const targetYearArb = fc.integer({ min: 2000, max: 2099 });
  const monthArb = fc.integer({ min: 1, max: 12 });
  const dayArb = fc.integer({ min: 1, max: 28 });

  // "의미 있는 텍스트" 제너레이터 (Property 9와 동일한 안전 규칙 재사용).
  // 날짜/시간/구분자/제거 키워드("예정") 패턴과 충돌하지 않는 문자만 사용하고,
  // trim 후 첫 글자가 영문자/한글이 되도록 보장해 스트립 후에도 텍스트가 남도록 한다.
  const meaningfulTextChar = fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP가나다라마바사아자차 ".split("")
  );
  const meaningfulText = fc
    .array(meaningfulTextChar, { minLength: 1, maxLength: 25 })
    .map((cs) => cs.join("").trim())
    .filter((s) => s.length > 0 && /^[A-Za-z가-힣]/.test(s));

  // 요일 괄호 표기용 문자.
  const weekdayArb = fc.constantFrom("월", "화", "수", "목", "금", "토", "일");

  const pad2 = (n: number): string => String(n).padStart(2, "0");

  // ── 6.4: 날짜 형식 인식 및 연도 보정 ──
  //
  // 임의의 기준 날짜 refDate와 임의의 (연,월,일), 의미 있는 텍스트에 대해,
  // 그 날짜를 다섯 가지 형식으로 표기한 메모 줄을 parseDateFromNoteLine으로 파싱하면:
  //   - 연도가 있는 형식(YYYY-MM-DD) → 표기된 그 연도를 적용한 dateStr.
  //   - 연도가 생략된 형식(M/D, MM/DD, M/D(요일), N월 N일) → refDate의 연도를 적용한 dateStr.
  // 모든 결과는 null이 아니며 dateStr은 0 채움된 "YYYY-MM-DD" 형식이어야 한다.
  // Validates: Requirements 6.4
  it("연도 형식별로 올바른 YYYY-MM-DD dateStr을 반환한다", () => {
    fc.assert(
      fc.property(
        refDateArb,
        targetYearArb,
        monthArb,
        dayArb,
        meaningfulText,
        weekdayArb,
        (refDate, targetYear, month, day, text, weekday) => {
          const mm = pad2(month);
          const dd = pad2(day);
          const refYear = refDate.getFullYear();

          // 연도 생략 형식이 적용해야 하는 기대 dateStr (refDate 연도).
          const refYearDateStr = `${refYear}-${mm}-${dd}`;

          // 1) YYYY-MM-DD → 표기된 그 연도 사용.
          {
            const line = `- ${targetYear}-${mm}-${dd} ${text}`;
            const r = parseDateFromNoteLine(line, refDate);
            expect(r).not.toBeNull();
            expect(r!.dateStr).toBe(`${targetYear}-${mm}-${dd}`);
          }

          // 2) M/D (연도 생략) → refDate 연도.
          {
            const line = `- ${month}/${day} ${text}`;
            const r = parseDateFromNoteLine(line, refDate);
            expect(r).not.toBeNull();
            expect(r!.dateStr).toBe(refYearDateStr);
          }

          // 3) MM/DD (연도 생략, 0 채움) → refDate 연도.
          {
            const line = `- ${mm}/${dd} ${text}`;
            const r = parseDateFromNoteLine(line, refDate);
            expect(r).not.toBeNull();
            expect(r!.dateStr).toBe(refYearDateStr);
          }

          // 4) M/D(요일) (연도 생략 + 요일 괄호) → refDate 연도.
          {
            const line = `- ${month}/${day}(${weekday}) ${text}`;
            const r = parseDateFromNoteLine(line, refDate);
            expect(r).not.toBeNull();
            expect(r!.dateStr).toBe(refYearDateStr);
          }

          // 5) N월 N일 (연도 생략) → refDate 연도.
          {
            const line = `- ${month}월 ${day}일 ${text}`;
            const r = parseDateFromNoteLine(line, refDate);
            expect(r).not.toBeNull();
            expect(r!.dateStr).toBe(refYearDateStr);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
