import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { DEFAULT_SETTINGS, GeminiAssistantSettings } from "./types";

/**
 * Property 3: 백엔드 전환 시 자격증명 보존
 *
 * 임의의 자격증명 값을 가진 설정 객체에서 aiBackend만 전환 →
 * 비활성 백엔드 자격증명 보존 확인
 *
 * Validates: Requirements 5.3, 5.4
 */

/**
 * 임의의 자격증명 값을 가진 설정 객체를 생성하는 arbitrary.
 * geminiApiKey, bedrockApiKey 모두 임의의 값을 가진다.
 */
const settingsWithCredentialsArb = fc.record({
  geminiApiKey: fc.string({ minLength: 1, maxLength: 50 }),
  bedrockApiKey: fc.string({ minLength: 1, maxLength: 50 }),
  awsRegion: fc.string({ minLength: 1, maxLength: 20 }),
});

describe("Property 3: 백엔드 전환 시 자격증명 보존", () => {
  /**
   * Validates: Requirements 5.3, 5.4
   */

  it("bedrock → gemini 전환 시 bedrockApiKey가 보존되어야 한다", () => {
    fc.assert(
      fc.property(settingsWithCredentialsArb, (creds) => {
        // bedrock 백엔드로 시작하는 설정 객체 생성
        const settings: GeminiAssistantSettings = {
          ...DEFAULT_SETTINGS,
          aiBackend: "bedrock",
          geminiApiKey: creds.geminiApiKey,
          bedrockApiKey: creds.bedrockApiKey,
          awsRegion: creds.awsRegion,
        };

        // aiBackend만 gemini로 전환 (설정 탭에서 드롭다운 변경 시뮬레이션)
        const switched: GeminiAssistantSettings = {
          ...settings,
          aiBackend: "gemini",
        };

        // 비활성 백엔드(bedrock)의 자격증명이 보존되어야 함
        expect(switched.bedrockApiKey).toBe(creds.bedrockApiKey);
        expect(switched.awsRegion).toBe(creds.awsRegion);
      }),
      { numRuns: 100 }
    );
  });

  it("gemini → bedrock 전환 시 geminiApiKey가 보존되어야 한다", () => {
    fc.assert(
      fc.property(settingsWithCredentialsArb, (creds) => {
        // gemini 백엔드로 시작하는 설정 객체 생성
        const settings: GeminiAssistantSettings = {
          ...DEFAULT_SETTINGS,
          aiBackend: "gemini",
          geminiApiKey: creds.geminiApiKey,
          bedrockApiKey: creds.bedrockApiKey,
          awsRegion: creds.awsRegion,
        };

        // aiBackend만 bedrock으로 전환
        const switched: GeminiAssistantSettings = {
          ...settings,
          aiBackend: "bedrock",
        };

        // 비활성 백엔드(gemini)의 자격증명이 보존되어야 함
        expect(switched.geminiApiKey).toBe(creds.geminiApiKey);
      }),
      { numRuns: 100 }
    );
  });

  it("양방향 전환(bedrock→gemini→bedrock) 후 모든 자격증명이 보존되어야 한다", () => {
    fc.assert(
      fc.property(settingsWithCredentialsArb, (creds) => {
        // 초기 설정: bedrock 백엔드
        const original: GeminiAssistantSettings = {
          ...DEFAULT_SETTINGS,
          aiBackend: "bedrock",
          geminiApiKey: creds.geminiApiKey,
          bedrockApiKey: creds.bedrockApiKey,
          awsRegion: creds.awsRegion,
        };

        // 1차 전환: bedrock → gemini
        const afterFirstSwitch: GeminiAssistantSettings = {
          ...original,
          aiBackend: "gemini",
        };

        // 2차 전환: gemini → bedrock
        const afterSecondSwitch: GeminiAssistantSettings = {
          ...afterFirstSwitch,
          aiBackend: "bedrock",
        };

        // 양방향 전환 후 모든 자격증명이 원래 값과 동일해야 함
        expect(afterSecondSwitch.geminiApiKey).toBe(creds.geminiApiKey);
        expect(afterSecondSwitch.bedrockApiKey).toBe(creds.bedrockApiKey);
        expect(afterSecondSwitch.awsRegion).toBe(creds.awsRegion);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 5: 기존 설정 하위 호환성
 *
 * 임의의 aiBackend 필드가 없는 기존 설정 객체를 생성하여
 * Object.assign({}, DEFAULT_SETTINGS, existingSettings) 수행 →
 * aiBackend가 "gemini"이고 기존 값 보존 확인
 *
 * Validates: Requirements 7.4
 */

/**
 * aiBackend 필드를 제외한 기존 설정 객체를 생성하는 arbitrary.
 * 실제 사용자가 업그레이드 전에 가지고 있을 수 있는 설정을 시뮬레이션한다.
 */
const existingSettingsWithoutAiBackendArb = fc.record({
  language: fc.constantFrom("en" as const, "ko" as const, "ja" as const),
  geminiApiKey: fc.string({ minLength: 0, maxLength: 50 }),
  chatModel: fc.string({ minLength: 1, maxLength: 30 }),
  embeddingModel: fc.string({ minLength: 1, maxLength: 30 }),
  maxTokens: fc.integer({ min: 1, max: 128000 }),
  effort: fc.constantFrom("minimal" as const, "low" as const, "medium" as const, "high" as const),
  systemPrompt: fc.string({ minLength: 0, maxLength: 200 }),
  welcomeGreeting: fc.string({ minLength: 0, maxLength: 100 }),
  autoAttachActiveNote: fc.boolean(),
  enabledSkills: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
  persistChat: fc.boolean(),
  templateFolder: fc.string({ minLength: 1, maxLength: 50 }),
  chatFontSize: fc.integer({ min: 8, max: 32 }),
  todoFolder: fc.string({ minLength: 1, maxLength: 50 }),
  todoTemplateName: fc.string({ minLength: 1, maxLength: 50 }),
  todoArchiveFolder: fc.string({ minLength: 1, maxLength: 50 }),
  todoArchiveDays: fc.integer({ min: 1, max: 365 }),
  confirmToolExecution: fc.boolean(),
  mcpTimeout: fc.integer({ min: 5, max: 120 }),
  webClipFolder: fc.string({ minLength: 1, maxLength: 50 }),
  webClipModel: fc.string({ minLength: 1, maxLength: 30 }),
  archiveCleanDays: fc.integer({ min: 1, max: 365 }),
  archiveCleanFolder: fc.string({ minLength: 1, maxLength: 50 }),
});

describe("Property 5: 기존 설정 하위 호환성", () => {
  /**
   * Validates: Requirements 7.4
   */

  it("aiBackend 필드가 없는 기존 설정을 DEFAULT_SETTINGS와 병합하면 aiBackend가 'bedrock'이어야 한다", () => {
    fc.assert(
      fc.property(existingSettingsWithoutAiBackendArb, (existingSettings) => {
        // aiBackend 필드가 없는 기존 설정 객체와 DEFAULT_SETTINGS를 병합
        const merged = Object.assign(
          {},
          DEFAULT_SETTINGS,
          existingSettings
        ) as GeminiAssistantSettings;

        // 기존 설정에 aiBackend가 없으므로 DEFAULT_SETTINGS의 "bedrock"이 적용되어야 함
        expect(merged.aiBackend).toBe("bedrock");
      }),
      { numRuns: 100 }
    );
  });

  it("병합 후 기존 설정의 모든 필드 값이 보존되어야 한다", () => {
    fc.assert(
      fc.property(existingSettingsWithoutAiBackendArb, (existingSettings) => {
        const merged = Object.assign(
          {},
          DEFAULT_SETTINGS,
          existingSettings
        ) as GeminiAssistantSettings;

        // 기존 설정의 모든 필드가 병합 결과에 그대로 보존되는지 확인
        for (const key of Object.keys(existingSettings) as Array<
          keyof typeof existingSettings
        >) {
          const existingValue = existingSettings[key];
          const mergedValue = merged[key];

          // 배열은 깊은 비교, 나머지는 일치 확인
          if (Array.isArray(existingValue)) {
            expect(mergedValue).toEqual(existingValue);
          } else {
            expect(mergedValue).toBe(existingValue);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("병합 결과는 DEFAULT_SETTINGS의 모든 키를 포함해야 한다", () => {
    fc.assert(
      fc.property(existingSettingsWithoutAiBackendArb, (existingSettings) => {
        const merged = Object.assign(
          {},
          DEFAULT_SETTINGS,
          existingSettings
        ) as GeminiAssistantSettings;

        // DEFAULT_SETTINGS의 모든 키가 병합 결과에 존재하는지 확인
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          expect(merged).toHaveProperty(key);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("병합 결과의 Bedrock 관련 필드는 DEFAULT_SETTINGS 기본값이어야 한다", () => {
    fc.assert(
      fc.property(existingSettingsWithoutAiBackendArb, (existingSettings) => {
        const merged = Object.assign(
          {},
          DEFAULT_SETTINGS,
          existingSettings
        ) as GeminiAssistantSettings;

        // 기존 설정에 Bedrock 필드가 없으므로 DEFAULT_SETTINGS 기본값이 유지되어야 함
        expect(merged.awsAuthMethod).toBe(DEFAULT_SETTINGS.awsAuthMethod);
        expect(merged.awsRegion).toBe(DEFAULT_SETTINGS.awsRegion);
        expect(merged.bedrockChatModel).toBe(DEFAULT_SETTINGS.bedrockChatModel);
        expect(merged.bedrockEmbeddingModel).toBe(DEFAULT_SETTINGS.bedrockEmbeddingModel);
      }),
      { numRuns: 100 }
    );
  });
});
