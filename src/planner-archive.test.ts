import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { selectEntriesToArchive } from "./todo-manager";

// ============================================
// planner-archive 속성 테스트
// ============================================
// 이 파일은 daily-planner 스펙의 아카이브 선별(순수) 함수 속성을 검증한다.
// selectEntriesToArchive는 cutoff 미만 날짜 후보만 입력 순서를 보존하여 선별한다.

// Feature: daily-planner, Property 17: selectEntriesToArchive — cutoff 미만만 선별
describe("Property 17: selectEntriesToArchive — cutoff 미만만 선별", () => {
  // 임의의 { date } 후보 목록과 cutoff 날짜에 대해:
  //  1) 반환된 모든 항목은 date.getTime() < cutoff.getTime() 을 만족한다.
  //  2) date >= cutoff 인 후보는 결과에 하나도 포함되지 않는다.
  //  3) 결과는 "입력을 date<cutoff 로 필터링한 것"과 동일한 순서이며 입력의 부분집합이다.
  // Validates: Requirements 7.1

  // 안전한 날짜 범위(2000~2099)의 Date 제너레이터
  const dateArb = fc.date({
    min: new Date(2000, 0, 1),
    max: new Date(2099, 11, 31),
  });

  // id를 부여하여 결과 항목의 동일성(identity)과 순서 보존을 검증한다.
  // (참조 동일성 비교를 위해 후보 객체를 그대로 사용)
  const candidatesArb = fc
    .array(dateArb, { maxLength: 30 })
    .map((dates) => dates.map((date, id) => ({ date, id })));

  it("cutoff 미만 항목만, 입력 순서를 보존하여 선별한다", () => {
    fc.assert(
      fc.property(candidatesArb, dateArb, (candidates, cutoff) => {
        const cutoffTime = cutoff.getTime();
        const result = selectEntriesToArchive(candidates, cutoff);

        // 1) 반환된 모든 항목은 cutoff 미만이다(엄격한 부등호).
        for (const item of result) {
          expect(item.date.getTime()).toBeLessThan(cutoffTime);
        }

        // 2) cutoff 이상(>=)인 후보는 결과에 하나도 포함되지 않는다.
        const resultIds = new Set(result.map((item) => item.id));
        for (const candidate of candidates) {
          if (candidate.date.getTime() >= cutoffTime) {
            expect(resultIds.has(candidate.id)).toBe(false);
          }
        }

        // 3) 결과는 입력을 date<cutoff 로 필터링한 것과 정확히 동일하다.
        //    (같은 순서, 같은 참조 → 순서 보존 + 부분집합 보장)
        const expected = candidates.filter(
          (candidate) => candidate.date.getTime() < cutoffTime
        );
        expect(result).toEqual(expected);
        result.forEach((item, index) => {
          expect(item).toBe(expected[index]); // 동일 참조 → 부분집합/순서 보존
        });
      }),
      { numRuns: 100 }
    );
  });
});
