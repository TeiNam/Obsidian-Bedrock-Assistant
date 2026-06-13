import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { normalizePlannerSetting, migratePlannerSettings } from "./planner-settings";
import { DEFAULT_SETTINGS } from "./types";
import { I18N } from "./settings-tab";
import { VIEW_I18N } from "./chat-view-i18n";

// ============================================
// planner-settings 속성 테스트
// ============================================
// 이 파일은 daily-planner 스펙의 설정 정규화/마이그레이션/i18n 관련 속성을 검증한다.
// 각 속성은 향후 병합 충돌을 피하기 위해 독립된 describe(...) 블록으로 구성한다.
// (Property 14 외 Property 15/18은 이후 작업에서 별도 블록으로 추가된다.)

// Feature: daily-planner, Property 14: 공백 입력 시 기본값 정규화
describe("Property 14: 공백 입력 시 기본값 정규화", () => {
  // Daily Planner 설정의 실제 기본값 (Req 4.5: plannerFolder, Req 4.6: timeboxTemplateName)
  const DEFAULT_VALUES = ["Daily Planner", "TimeBox Daily"] as const;

  // trim()이 제거하는 대표적인 공백 문자들 (공백/탭/개행/CR/폼피드/수직탭)
  const wsChar = fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v");

  // 공백 문자로만 구성된 문자열(빈 문자열 포함). fc.array 기본 minLength=0 이므로 ""도 생성된다.
  const whitespaceOnlyInput = fc.array(wsChar).map((chars) => chars.join(""));

  // 공백이 아닌 문자(0x20 space 등은 제외)
  const nonWsChar = fc.char().filter((c) => c.trim().length > 0);

  // 적어도 하나의 비공백 문자를 보장하는 입력: anyStr + nonWsChar + anyStr
  const nonWhitespaceInput = fc
    .tuple(fc.string(), nonWsChar, fc.string())
    .map(([prefix, mid, suffix]) => prefix + mid + suffix);

  // 공백 문자로만 구성되거나 빈 문자열인 입력에 대해서는 항상 기본값을 반환한다.
  // Validates: Requirements 4.5, 4.6
  it("공백 전용/빈 문자열 입력 → 기본값 반환", () => {
    fc.assert(
      fc.property(
        whitespaceOnlyInput,
        fc.constantFrom(...DEFAULT_VALUES),
        (value, defaultValue) => {
          expect(normalizePlannerSetting(value, defaultValue)).toBe(defaultValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  // 공백이 아닌 입력(비공백 문자 1개 이상 포함)에 대해서는 trim된 입력 값을 그대로 반환하며,
  // 그 결과는 항상 비어 있지 않다.
  // Validates: Requirements 4.5, 4.6
  it("비공백 입력 → trim된 입력 값 반환(비어 있지 않음)", () => {
    fc.assert(
      fc.property(
        nonWhitespaceInput,
        fc.constantFrom(...DEFAULT_VALUES),
        (value, defaultValue) => {
          const result = normalizePlannerSetting(value, defaultValue);
          expect(result).toBe(value.trim());
          expect(result.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 15: 설정 병합 — 기존값 보존, 신규 필드 기본값, 마이그레이션
describe("Property 15: 설정 병합 — 기존값 보존, 신규 필드 기본값, 마이그레이션", () => {
  // main.ts loadSettings의 실제 처리 순서를 그대로 모사한다:
  //   const migrated = migratePlannerSettings(loaded ?? {});
  //   const settings = Object.assign({}, DEFAULT_SETTINGS, migrated);
  // 즉, 마이그레이션은 병합 "전" 원본 로드 데이터(plannerFolder 키가 없을 수 있음)에 적용하고
  // 그 다음 DEFAULT_SETTINGS와 병합한다.
  function loadSettings(loaded: Record<string, unknown>): Record<string, unknown> {
    const migrated = migratePlannerSettings({ ...loaded });
    return Object.assign({}, DEFAULT_SETTINGS, migrated);
  }

  // 비어 있지 않은(공백이 아닌 문자 1개 이상 포함) 폴더명 문자열 제너레이터
  const nonEmptyFolder = fc
    .string({ minLength: 1, maxLength: 60 })
    .filter((s) => s.trim().length > 0);

  // 마이그레이션에서 "비어 있음"으로 간주되는 todoFolder 값(빈 문자열 / 비문자열)
  const emptyTodoFolder = fc.constantFrom("", undefined, null, 0, false);

  // 병합을 통해 보존 여부를 검증할 임의의 기존 부가 필드들.
  // chatFontSize: number, todoTemplateName: string 등 기본 설정에 존재하는 필드를 임의 값으로 덮어쓴다.
  const extraFields = fc.record({
    chatFontSize: fc.integer({ min: 1, max: 72 }),
    todoTemplateName: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
    maxTokens: fc.integer({ min: 1, max: 100000 }),
    persistChat: fc.boolean(),
  });

  // 케이스 1: plannerFolder 키가 없고 todoFolder가 비어 있지 않은 기존 객체
  // → 마이그레이션 후 병합하면 plannerFolder === todoFolder,
  //   다른 기존 필드는 보존되고, 신규 필드 timeboxTemplateName은 기본값으로 채워진다.
  // Validates: Requirements 4.9, 8.1, 8.5
  it("plannerFolder 누락 + todoFolder 존재 → plannerFolder가 todoFolder로 승계되고 신규 필드는 기본값", () => {
    fc.assert(
      fc.property(nonEmptyFolder, extraFields, (todoFolder, extra) => {
        // 기존 설정: 신규 필드(plannerFolder/timeboxTemplateName)는 의도적으로 포함하지 않는다.
        const existing: Record<string, unknown> = { ...extra, todoFolder };
        expect(Object.prototype.hasOwnProperty.call(existing, "plannerFolder")).toBe(false);

        const result = loadSettings(existing);

        // 마이그레이션: plannerFolder는 todoFolder 값을 승계한다.
        expect(result.plannerFolder).toBe(todoFolder);
        // todoFolder 자체도 보존된다.
        expect(result.todoFolder).toBe(todoFolder);
        // 신규 필드 timeboxTemplateName은 기본값으로 채워진다.
        expect(result.timeboxTemplateName).toBe(DEFAULT_SETTINGS.timeboxTemplateName);
        // 기존 부가 필드들은 모두 보존된다.
        expect(result.chatFontSize).toBe(extra.chatFontSize);
        expect(result.todoTemplateName).toBe(extra.todoTemplateName);
        expect(result.maxTokens).toBe(extra.maxTokens);
        expect(result.persistChat).toBe(extra.persistChat);
      }),
      { numRuns: 100 }
    );
  });

  // 케이스 2: 기존 객체가 plannerFolder를 이미 포함하는 경우
  // → 마이그레이션은 plannerFolder를 변경하지 않으며(제공한 값 유지),
  //   todoFolder 유무와 무관하게 그 값을 보존한다.
  // Validates: Requirements 4.9, 8.1, 8.5
  it("plannerFolder 이미 존재 → 마이그레이션이 값을 변경하지 않음", () => {
    fc.assert(
      fc.property(
        nonEmptyFolder,
        nonEmptyFolder,
        extraFields,
        (plannerFolder, todoFolder, extra) => {
          // plannerFolder와 (다를 수 있는) todoFolder를 모두 포함하는 기존 설정
          const existing: Record<string, unknown> = { ...extra, plannerFolder, todoFolder };

          const result = loadSettings(existing);

          // 마이그레이션 no-op: 제공한 plannerFolder 값이 그대로 유지된다.
          expect(result.plannerFolder).toBe(plannerFolder);
          // todoFolder도 보존된다.
          expect(result.todoFolder).toBe(todoFolder);
          // 기존 부가 필드 보존.
          expect(result.chatFontSize).toBe(extra.chatFontSize);
          expect(result.todoTemplateName).toBe(extra.todoTemplateName);
        }
      ),
      { numRuns: 100 }
    );
  });

  // 케이스 3: plannerFolder 키도 없고 todoFolder도 없거나 비어 있는 경우
  // → 마이그레이션은 no-op이며 병합 후 plannerFolder는 DEFAULT_SETTINGS의 기본값으로 채워진다.
  //   기존 임의 필드들은 그대로 보존된다.
  // Validates: Requirements 4.9, 8.1, 8.5
  it("plannerFolder 누락 + todoFolder 비어있음/없음 → plannerFolder는 기본값", () => {
    fc.assert(
      fc.property(emptyTodoFolder, extraFields, (todoFolder, extra) => {
        // todoFolder가 빈 문자열이면 포함하고, undefined/null/기타면 키 자체를 생략하거나 그대로 둔다.
        const existing: Record<string, unknown> = { ...extra };
        if (todoFolder !== undefined) {
          existing.todoFolder = todoFolder;
        }
        expect(Object.prototype.hasOwnProperty.call(existing, "plannerFolder")).toBe(false);

        const result = loadSettings(existing);

        // 마이그레이션 no-op → 병합으로 기본값이 채워진다.
        expect(result.plannerFolder).toBe(DEFAULT_SETTINGS.plannerFolder);
        // 신규 필드 timeboxTemplateName도 기본값.
        expect(result.timeboxTemplateName).toBe(DEFAULT_SETTINGS.timeboxTemplateName);
        // 기존 부가 필드 보존.
        expect(result.chatFontSize).toBe(extra.chatFontSize);
        expect(result.todoTemplateName).toBe(extra.todoTemplateName);
        expect(result.maxTokens).toBe(extra.maxTokens);
        expect(result.persistChat).toBe(extra.persistChat);
      }),
      { numRuns: 100 }
    );
  });

  // 보강: 신규 필드(plannerFolder, timeboxTemplateName)가 전혀 없는 임의 기존 객체에 대해
  // 순수 병합 Object.assign({}, DEFAULT_SETTINGS, existing)이 기존값을 보존하고
  // 신규 필드를 기본값으로 채우는지 직접 검증한다(마이그레이션 분리 확인).
  // Validates: Requirements 8.5
  it("신규 필드 없는 기존 객체 → 병합이 기존값 보존 + 신규 필드 기본값 채움", () => {
    fc.assert(
      fc.property(extraFields, (extra) => {
        const existing: Record<string, unknown> = { ...extra };
        const merged = Object.assign({}, DEFAULT_SETTINGS, existing);

        // 기존값 보존
        expect(merged.chatFontSize).toBe(extra.chatFontSize);
        expect(merged.todoTemplateName).toBe(extra.todoTemplateName);
        expect(merged.maxTokens).toBe(extra.maxTokens);
        expect(merged.persistChat).toBe(extra.persistChat);
        // 신규 필드 기본값
        expect(merged.plannerFolder).toBe(DEFAULT_SETTINGS.plannerFolder);
        expect(merged.timeboxTemplateName).toBe(DEFAULT_SETTINGS.timeboxTemplateName);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: daily-planner, Property 18: i18n 키 완전성
describe("Property 18: i18n 키 완전성", () => {
  // 지원 언어 (Req 4.7: en, ko, ja 세 언어 제공)
  const supportedLang = fc.constantFrom<"en" | "ko" | "ja">("en", "ko", "ja");

  // settings-tab I18N 테이블에서 비어 있지 않은 "문자열"이어야 하는 To-Do 폴더 키들
  // (TimeBox 제거 + To-Do 평면 폴더 전환에 맞춰 To-Do 폴더 레이블/설명만 검증)
  const SETTINGS_STRING_KEYS = ["todoFolder", "todoFolderDesc"] as const;

  // chat-view VIEW_I18N 테이블의 To-Do 관련 키 중 "문자열" 값 키
  const VIEW_STRING_KEYS = ["createTodo"] as const;

  // chat-view VIEW_I18N 테이블의 To-Do 관련 키 중 "함수" 값 키 (인자를 받아 문자열 반환)
  const VIEW_FN_KEYS = [
    "todoExists",
    "todoCreated",
    "todoError",
  ] as const;

  // 비어 있지 않은 문자열인지 검사하는 헬퍼
  function expectNonEmptyString(value: unknown, ctx: string): void {
    expect(typeof value, ctx).toBe("string");
    expect((value as string).trim().length, ctx).toBeGreaterThan(0);
  }

  // 각 지원 언어에 대해 settings-tab I18N 테이블이 To-Do 폴더 키를 모두 보유하고
  // 각 값이 비어 있지 않은 문자열인지 검증한다.
  // Validates: Requirements 4.7
  it("settings-tab I18N: 모든 언어가 To-Do 폴더 키를 비어 있지 않은 문자열로 보유", () => {
    fc.assert(
      fc.property(supportedLang, (lang) => {
        const t = I18N[lang] as Record<string, unknown>;
        expect(t, `I18N[${lang}] 존재`).toBeTruthy();
        for (const key of SETTINGS_STRING_KEYS) {
          expectNonEmptyString(t[key], `I18N[${lang}].${key}`);
        }
      }),
      { numRuns: 100 }
    );
  });

  // 각 지원 언어에 대해 chat-view VIEW_I18N 테이블이 To-Do 관련 키를 모두 보유하는지 검증한다.
  // 문자열 값 키는 비어 있지 않은 문자열이어야 하고,
  // 함수 값 키는 함수이며 샘플 인자로 호출하면 비어 있지 않은 문자열을 반환해야 한다.
  // Validates: Requirements 4.7
  it("chat-view VIEW_I18N: 모든 언어가 To-Do 관련 키(문자열/함수)를 비어 있지 않게 보유", () => {
    fc.assert(
      fc.property(supportedLang, (lang) => {
        const t = VIEW_I18N[lang] as Record<string, unknown>;
        expect(t, `VIEW_I18N[${lang}] 존재`).toBeTruthy();

        // 문자열 값 키
        for (const key of VIEW_STRING_KEYS) {
          expectNonEmptyString(t[key], `VIEW_I18N[${lang}].${key}`);
        }

        // 함수 값 키: 함수이며 샘플 인자로 호출 시 비어 있지 않은 문자열 반환
        for (const key of VIEW_FN_KEYS) {
          const fn = t[key];
          expect(typeof fn, `VIEW_I18N[${lang}].${key} 함수`).toBe("function");
          const out = (fn as (arg: string) => unknown)("x");
          expectNonEmptyString(out, `VIEW_I18N[${lang}].${key}("x") 반환값`);
        }
      }),
      { numRuns: 100 }
    );
  });
});
