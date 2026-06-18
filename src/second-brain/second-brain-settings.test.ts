import { describe, it, expect } from "vitest";
import {
  DEFAULT_SECOND_BRAIN_SETTINGS,
  normalizeSecondBrainSettings,
  type SecondBrainSettings,
} from "../types";

/**
 * Second Brain 설정 정규화/마이그레이션 단위 테스트 (Task 1.3)
 *
 * 예시 기반 단위 테스트로 다음을 검증한다.
 * - 누락/null/undefined/비객체 입력 → 전체 기본값 (Req 1.3)
 * - 공백/빈 문자열 wikiFolder → 기본값 "Second Brain" 보정 (Req 1.4)
 * - 음수/0/비정수 주기 → max(1, round(n)) 보정 (Req 1.5)
 * - DEFAULT 상수 값 검증 (Req 1.1, 1.2)
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 */

describe("normalizeSecondBrainSettings", () => {
  // --- DEFAULT 상수 값 검증 (Req 1.1, 1.2) ---
  describe("DEFAULT_SECOND_BRAIN_SETTINGS 기본값 (Req 1.1, 1.2)", () => {
    it("enabled 기본값은 false (옵트인)이다", () => {
      // Req 1.1: 기능 활성화 기본값은 비활성(false)
      expect(DEFAULT_SECOND_BRAIN_SETTINGS.enabled).toBe(false);
    });

    it("wikiFolder 기본값은 'Second Brain'이다", () => {
      // Req 1.2: Wiki_Folder 경로 기본값
      expect(DEFAULT_SECOND_BRAIN_SETTINGS.wikiFolder).toBe("Second Brain");
    });

    it("schedulerEnabled 기본값은 false이다", () => {
      // Req 1.2: Scheduler 활성화 기본값
      expect(DEFAULT_SECOND_BRAIN_SETTINGS.schedulerEnabled).toBe(false);
    });

    it("schedulerIntervalHours 기본값은 24이다", () => {
      // Req 1.2: Scheduler 주기 기본값
      expect(DEFAULT_SECOND_BRAIN_SETTINGS.schedulerIntervalHours).toBe(24);
    });

    it("lastScheduledRun 기본값은 0이다", () => {
      // Req 11.2/11.6: 미실행 시 0
      expect(DEFAULT_SECOND_BRAIN_SETTINGS.lastScheduledRun).toBe(0);
    });
  });

  // --- 누락/비객체 입력 → 전체 기본값 (Req 1.3) ---
  describe("누락/비객체 입력 → 전체 기본값 (Req 1.3)", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["숫자", 42],
      ["문자열", "not-an-object"],
      ["불리언", true],
      ["빈 객체", {}],
    ])("%s 입력 시 전체 기본값을 반환한다", (_label, input) => {
      expect(normalizeSecondBrainSettings(input)).toEqual(
        DEFAULT_SECOND_BRAIN_SETTINGS
      );
    });

    it("배열 입력 시에도 전체 기본값을 반환한다", () => {
      // 배열은 의미 있는 설정 필드를 갖지 않으므로 기본값으로 정규화된다
      expect(normalizeSecondBrainSettings([])).toEqual(
        DEFAULT_SECOND_BRAIN_SETTINGS
      );
    });

    it("반환값은 DEFAULT 상수와 동일 참조가 아니다(복사본)", () => {
      // 정규화 결과를 변경해도 DEFAULT 상수가 오염되지 않아야 한다
      const result = normalizeSecondBrainSettings(undefined);
      expect(result).not.toBe(DEFAULT_SECOND_BRAIN_SETTINGS);
    });

    it("일부 필드만 누락되면 누락 필드만 기본값으로 채운다", () => {
      // Req 1.3: 저장 데이터에 일부 필드가 있으면 그 값을 유지하고 나머지는 기본값
      const partial = { enabled: true, schedulerEnabled: true };
      expect(normalizeSecondBrainSettings(partial)).toEqual<SecondBrainSettings>({
        enabled: true,
        wikiFolder: "Second Brain",
        schedulerEnabled: true,
        schedulerIntervalHours: 24,
        lastScheduledRun: 0,
      });
    });

    it("유효한 전체 입력은 값을 그대로 보존한다", () => {
      const full: SecondBrainSettings = {
        enabled: true,
        wikiFolder: "Knowledge",
        schedulerEnabled: true,
        schedulerIntervalHours: 12,
        lastScheduledRun: 1700000000000,
      };
      expect(normalizeSecondBrainSettings(full)).toEqual(full);
    });

    it("타입이 잘못된 필드는 해당 필드만 기본값으로 보정한다", () => {
      // enabled가 불리언이 아니고 lastScheduledRun이 수치가 아니면 기본값
      const malformed = {
        enabled: "yes",
        schedulerEnabled: 1,
        lastScheduledRun: "soon",
      };
      expect(normalizeSecondBrainSettings(malformed)).toEqual(
        DEFAULT_SECOND_BRAIN_SETTINGS
      );
    });
  });

  // --- wikiFolder 공백/빈 문자열 보정 (Req 1.4) ---
  describe("wikiFolder 공백/빈 문자열 보정 (Req 1.4)", () => {
    it.each([
      ["빈 문자열", ""],
      ["공백 한 칸", " "],
      ["여러 공백", "     "],
      ["탭/개행만", "\t\n  "],
    ])("%s wikiFolder는 기본값으로 보정된다", (_label, value) => {
      const result = normalizeSecondBrainSettings({ wikiFolder: value });
      expect(result.wikiFolder).toBe("Second Brain");
    });

    it("비문자열 wikiFolder는 기본값으로 보정된다", () => {
      expect(normalizeSecondBrainSettings({ wikiFolder: 123 }).wikiFolder).toBe(
        "Second Brain"
      );
      expect(normalizeSecondBrainSettings({ wikiFolder: null }).wikiFolder).toBe(
        "Second Brain"
      );
    });

    it("앞뒤 공백이 있는 유효 경로는 trim하여 보존한다", () => {
      const result = normalizeSecondBrainSettings({ wikiFolder: "  My Wiki  " });
      expect(result.wikiFolder).toBe("My Wiki");
    });

    it("유효한 wikiFolder는 그대로 보존한다", () => {
      const result = normalizeSecondBrainSettings({ wikiFolder: "Brain/Sub" });
      expect(result.wikiFolder).toBe("Brain/Sub");
    });
  });

  // --- schedulerIntervalHours 보정: max(1, round(n)) (Req 1.5) ---
  describe("schedulerIntervalHours 보정 (Req 1.5)", () => {
    it.each([
      ["0", 0, 1],
      ["음수 -5", -5, 1],
      ["1 미만 양수 0.4", 0.4, 1],
      ["경계값 0.5 → round(0.5)=1", 0.5, 1],
      ["비정수 2.7 → round=3", 2.7, 3],
      ["비정수 2.4 → round=2", 2.4, 2],
      ["정수 1 그대로", 1, 1],
      ["정수 24 그대로", 24, 24],
      ["큰 비정수 100.6 → 101", 100.6, 101],
    ])("%s 주기는 %d로 보정된다", (_label, input, expected) => {
      const result = normalizeSecondBrainSettings({
        schedulerIntervalHours: input,
      });
      expect(result.schedulerIntervalHours).toBe(expected);
    });

    it.each([
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["비수치 문자열", "12"],
      ["null", null],
    ])("비유한/비수치 주기(%s)는 기본값 24로 보정된다", (_label, input) => {
      const result = normalizeSecondBrainSettings({
        schedulerIntervalHours: input,
      });
      expect(result.schedulerIntervalHours).toBe(24);
    });

    it("보정된 주기는 항상 1 이상의 정수이다", () => {
      const samples = [-100, -0.1, 0, 0.001, 0.5, 1, 1.5, 2.7, 99.9];
      for (const n of samples) {
        const { schedulerIntervalHours } = normalizeSecondBrainSettings({
          schedulerIntervalHours: n,
        });
        expect(Number.isInteger(schedulerIntervalHours)).toBe(true);
        expect(schedulerIntervalHours).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
