import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { DEFAULT_SETTINGS, GeminiAssistantSettings } from "./types";

// ============================================
// BedrockClient 모킹
// ============================================
// BedrockClient 모듈을 모킹하여 생성자 호출과 설정 전달만 검증한다.
// 실제 AWS SDK 의존성을 제거하기 위한 전략이다.
// `new` 키워드로 호출 가능하도록 class 기반 모킹을 사용한다.

// BedrockClient 생성자 호출 기록
const bedrockConstructorCalls: GeminiAssistantSettings[] = [];

vi.mock("./bedrock-client", () => {
  return {
    BedrockClient: class MockBedrockClient {
      updateSettings = vi.fn();
      listModels = vi.fn();
      converse = vi.fn();
      getEmbedding = vi.fn();
      converseLight = vi.fn();
      _capturedSettings: GeminiAssistantSettings;
      constructor(settings: GeminiAssistantSettings) {
        this._capturedSettings = settings;
        bedrockConstructorCalls.push(settings);
      }
    },
  };
});

// 모킹 후 import
import { createAiClient } from "./ai-client-factory";
import { BedrockClient } from "./bedrock-client";

// IAiClient 인터페이스가 요구하는 메서드 목록
const REQUIRED_METHODS = [
  "updateSettings",
  "listModels",
  "converse",
  "getEmbedding",
  "converseLight",
] as const;

// ============================================
// 단위 테스트: createAiClient (Bedrock 단일)
// ============================================

describe("createAiClient", () => {
  beforeEach(() => {
    bedrockConstructorCalls.length = 0;
  });

  it("항상 BedrockClient를 반환한다", () => {
    const client = createAiClient({ ...DEFAULT_SETTINGS });

    expect(bedrockConstructorCalls).toHaveLength(1);
    expect(client).toBeInstanceOf(BedrockClient);
  });

  it("반환된 클라이언트가 IAiClient 인터페이스의 모든 메서드를 보유한다", () => {
    const client = createAiClient({ ...DEFAULT_SETTINGS });

    for (const method of REQUIRED_METHODS) {
      expect(typeof (client as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  });
});

// ============================================
// Property 1: 팩토리 클라이언트 생성 정확성 (Bedrock 단일)
// ============================================
//
// 임의의 유효한 설정 객체에 대해, createAiClient(settings)는 항상
// BedrockClient 인스턴스를 반환하고, 반환된 클라이언트는 converse,
// getEmbedding, listModels, converseLight, updateSettings 메서드를 모두 가져야 한다.

// 임의의 설정 필드를 가진 GeminiAssistantSettings arbitrary
const settingsArb = fc.record({
  awsAccessKeyId: fc.string({ minLength: 0, maxLength: 50 }),
  awsSecretAccessKey: fc.string({ minLength: 0, maxLength: 50 }),
  awsRegion: fc.string({ minLength: 1, maxLength: 20 }),
  bedrockChatModel: fc.string({ minLength: 0, maxLength: 50 }),
  bedrockEmbeddingModel: fc.string({ minLength: 0, maxLength: 50 }),
  maxTokens: fc.integer({ min: 1, max: 128000 }),
  temperature: fc.double({ min: 0, max: 2, noNaN: true }),
}).map((partial) => ({
  ...DEFAULT_SETTINGS,
  ...partial,
}));

describe("Property 1: 팩토리 클라이언트 생성 정확성", () => {
  beforeEach(() => {
    bedrockConstructorCalls.length = 0;
  });

  it("임의의 설정에 대해 항상 BedrockClient 인스턴스가 반환된다", () => {
    fc.assert(
      fc.property(settingsArb, (settings) => {
        bedrockConstructorCalls.length = 0;

        const client = createAiClient(settings);

        expect(client).toBeInstanceOf(BedrockClient);
        expect(bedrockConstructorCalls).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });

  it("임의의 설정으로 생성된 클라이언트는 IAiClient의 모든 메서드를 가진다", () => {
    fc.assert(
      fc.property(settingsArb, (settings) => {
        const client = createAiClient(settings);

        for (const method of REQUIRED_METHODS) {
          expect(typeof (client as unknown as Record<string, unknown>)[method]).toBe("function");
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================
// Property 4: Bedrock 모델 설정 전달
// ============================================
//
// 임의의 유효한 설정 객체에 대해, 생성된 클라이언트에 bedrockChatModel과
// bedrockEmbeddingModel이 그대로 전달되어야 한다.

// 임의의 모델 ID를 포함한 설정 arbitrary
const modelSettingsArb = fc.record({
  bedrockChatModel: fc.string({ minLength: 1, maxLength: 60 }),
  bedrockEmbeddingModel: fc.string({ minLength: 1, maxLength: 60 }),
}).map((partial) => ({
  ...DEFAULT_SETTINGS,
  ...partial,
}));

describe("Property 4: Bedrock 모델 설정 전달", () => {
  beforeEach(() => {
    bedrockConstructorCalls.length = 0;
  });

  it("임의의 모델 ID로 클라이언트 생성 시 Bedrock 모델 설정이 전달된다", () => {
    fc.assert(
      fc.property(modelSettingsArb, (settings) => {
        bedrockConstructorCalls.length = 0;

        const client = createAiClient(settings);

        // 생성자에 전달된 설정 객체를 캡처하여 검증
        const capturedSettings = (client as unknown as Record<string, unknown>)._capturedSettings as GeminiAssistantSettings;

        expect(capturedSettings.bedrockChatModel).toBe(settings.bedrockChatModel);
        expect(capturedSettings.bedrockEmbeddingModel).toBe(settings.bedrockEmbeddingModel);
      }),
      { numRuns: 100 },
    );
  });
});
