import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { DEFAULT_SETTINGS, GeminiAssistantSettings } from "./types";

// ============================================
// BedrockClient / GeminiClient 모킹
// ============================================
// 두 클라이언트 모듈을 모킹하여 생성자 호출과 설정 전달만 검증한다.
// 실제 AWS SDK / Gemini API 의존성을 제거하기 위한 전략이다.
// `new` 키워드로 호출 가능하도록 class 기반 모킹을 사용한다.

// BedrockClient 생성자 호출 기록
const bedrockConstructorCalls: GeminiAssistantSettings[] = [];
// GeminiClient 생성자 호출 기록
const geminiConstructorCalls: GeminiAssistantSettings[] = [];
// OpenAIClient 생성자 호출 기록 (Property 1 검증용)
const openaiConstructorCalls: GeminiAssistantSettings[] = [];
// OllamaClient 생성자 호출 기록 (Property 1 검증용)
const ollamaConstructorCalls: GeminiAssistantSettings[] = [];

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

vi.mock("./gemini-client", () => {
  return {
    GeminiClient: class MockGeminiClient {
      updateSettings = vi.fn();
      listModels = vi.fn();
      converse = vi.fn();
      getEmbedding = vi.fn();
      converseLight = vi.fn();
      _capturedSettings: GeminiAssistantSettings;
      constructor(settings: GeminiAssistantSettings) {
        this._capturedSettings = settings;
        geminiConstructorCalls.push(settings);
      }
    },
  };
});

// OpenAIClient / OllamaClient 모킹
// Property 1(팩토리 분기 및 폴백) 검증을 위해 두 클라이언트도 동일한 class 기반 전략으로 모킹한다.
// 실제 네트워크(fetch/requestUrl) 의존성을 제거하고, 어떤 클라이언트가 생성되는지만 확인한다.
vi.mock("./openai-client", () => {
  return {
    OpenAIClient: class MockOpenAIClient {
      updateSettings = vi.fn();
      listModels = vi.fn();
      converse = vi.fn();
      getEmbedding = vi.fn();
      converseLight = vi.fn();
      _capturedSettings: GeminiAssistantSettings;
      constructor(settings: GeminiAssistantSettings) {
        this._capturedSettings = settings;
        openaiConstructorCalls.push(settings);
      }
    },
  };
});

vi.mock("./ollama-client", () => {
  return {
    OllamaClient: class MockOllamaClient {
      updateSettings = vi.fn();
      listModels = vi.fn();
      converse = vi.fn();
      getEmbedding = vi.fn();
      converseLight = vi.fn();
      _capturedSettings: GeminiAssistantSettings;
      constructor(settings: GeminiAssistantSettings) {
        this._capturedSettings = settings;
        ollamaConstructorCalls.push(settings);
      }
    },
  };
});

// 모킹 후 import
import { createAiClient } from "./ai-client-factory";
import { BedrockClient } from "./bedrock-client";
import { GeminiClient } from "./gemini-client";
import { OpenAIClient } from "./openai-client";
import { OllamaClient } from "./ollama-client";

// IAiClient 인터페이스가 요구하는 메서드 목록
const REQUIRED_METHODS = [
  "updateSettings",
  "listModels",
  "converse",
  "getEmbedding",
  "converseLight",
] as const;

// ============================================
// 단위 테스트: createAiClient
// ============================================

describe("createAiClient", () => {
  beforeEach(() => {
    bedrockConstructorCalls.length = 0;
    geminiConstructorCalls.length = 0;
  });

  it('"bedrock" 설정에 BedrockClient를 반환한다', () => {
    const settings: GeminiAssistantSettings = {
      ...DEFAULT_SETTINGS,
      aiBackend: "bedrock",
    };

    const client = createAiClient(settings);

    // BedrockClient 생성자가 호출되었는지 확인
    expect(bedrockConstructorCalls).toHaveLength(1);
    expect(geminiConstructorCalls).toHaveLength(0);
    expect(client).toBeInstanceOf(BedrockClient);
  });

  it('"gemini" 설정에 GeminiClient를 반환한다', () => {
    const settings: GeminiAssistantSettings = {
      ...DEFAULT_SETTINGS,
      aiBackend: "gemini",
    };

    const client = createAiClient(settings);

    // GeminiClient 생성자가 호출되었는지 확인
    expect(geminiConstructorCalls).toHaveLength(1);
    expect(bedrockConstructorCalls).toHaveLength(0);
    expect(client).toBeInstanceOf(GeminiClient);
  });

  it("반환된 클라이언트가 IAiClient 인터페이스의 모든 메서드를 보유한다", () => {
    const bedrockClient = createAiClient({
      ...DEFAULT_SETTINGS,
      aiBackend: "bedrock",
    });
    const geminiClient = createAiClient({
      ...DEFAULT_SETTINGS,
      aiBackend: "gemini",
    });

    for (const method of REQUIRED_METHODS) {
      expect(typeof (bedrockClient as unknown as Record<string, unknown>)[method]).toBe("function");
      expect(typeof (geminiClient as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  });
});

// ============================================
// Property 1: 팩토리 클라이언트 생성 정확성
// ============================================

/**
 * Property 1: 팩토리 클라이언트 생성 정확성
 *
 * 임의의 유효한 설정 객체에 대해, createAiClient(settings)가 반환하는 클라이언트는
 * settings.aiBackend가 "bedrock"이면 BedrockClient 인스턴스이고,
 * "gemini"이면 GeminiClient 인스턴스여야 하며,
 * 반환된 클라이언트는 converse, getEmbedding, listModels, converseLight,
 * updateSettings 메서드를 모두 가져야 한다.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */

// aiBackend 값 arbitrary
const aiBackendArb = fc.constantFrom("bedrock" as const, "gemini" as const);

// 임의의 설정 필드를 가진 GeminiAssistantSettings arbitrary
const settingsArb = fc.record({
  aiBackend: aiBackendArb,
  geminiApiKey: fc.string({ minLength: 0, maxLength: 50 }),
  awsAccessKeyId: fc.string({ minLength: 0, maxLength: 50 }),
  awsSecretAccessKey: fc.string({ minLength: 0, maxLength: 50 }),
  awsRegion: fc.string({ minLength: 1, maxLength: 20 }),
  chatModel: fc.string({ minLength: 1, maxLength: 30 }),
  embeddingModel: fc.string({ minLength: 1, maxLength: 30 }),
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
    geminiConstructorCalls.length = 0;
  });

  it("임의의 aiBackend 값에 따라 올바른 클라이언트 인스턴스가 반환된다", () => {
    fc.assert(
      fc.property(settingsArb, (settings) => {
        bedrockConstructorCalls.length = 0;
        geminiConstructorCalls.length = 0;

        const client = createAiClient(settings);

        if (settings.aiBackend === "bedrock") {
          // BedrockClient 인스턴스여야 함
          expect(client).toBeInstanceOf(BedrockClient);
          expect(bedrockConstructorCalls).toHaveLength(1);
          expect(geminiConstructorCalls).toHaveLength(0);
        } else {
          // GeminiClient 인스턴스여야 함
          expect(client).toBeInstanceOf(GeminiClient);
          expect(geminiConstructorCalls).toHaveLength(1);
          expect(bedrockConstructorCalls).toHaveLength(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("임의의 설정으로 생성된 클라이언트는 IAiClient의 모든 메서드를 가진다", () => {
    fc.assert(
      fc.property(settingsArb, (settings) => {
        const client = createAiClient(settings);

        // IAiClient 인터페이스의 모든 메서드 존재 확인
        for (const method of REQUIRED_METHODS) {
          expect(typeof (client as unknown as Record<string, unknown>)[method]).toBe("function");
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================
// Property 4: 활성 백엔드 모델 설정 전달
// ============================================

/**
 * Property 4: 활성 백엔드 모델 설정 전달
 *
 * 임의의 유효한 설정 객체에 대해, aiBackend가 "gemini"이면 생성된 클라이언트에
 * chatModel과 embeddingModel이 전달되고, "bedrock"이면 bedrockChatModel과
 * bedrockEmbeddingModel이 전달되어야 한다.
 *
 * Validates: Requirements 6.4
 */

// 임의의 모델 ID를 포함한 설정 arbitrary
const modelSettingsArb = fc.record({
  aiBackend: aiBackendArb,
  chatModel: fc.string({ minLength: 1, maxLength: 40 }),
  embeddingModel: fc.string({ minLength: 1, maxLength: 40 }),
  bedrockChatModel: fc.string({ minLength: 1, maxLength: 60 }),
  bedrockEmbeddingModel: fc.string({ minLength: 1, maxLength: 60 }),
}).map((partial) => ({
  ...DEFAULT_SETTINGS,
  ...partial,
}));

describe("Property 4: 활성 백엔드 모델 설정 전달", () => {
  beforeEach(() => {
    bedrockConstructorCalls.length = 0;
    geminiConstructorCalls.length = 0;
  });

  it("임의의 모델 ID로 팩토리 클라이언트 생성 시 올바른 모델 설정이 전달된다", () => {
    fc.assert(
      fc.property(modelSettingsArb, (settings) => {
        bedrockConstructorCalls.length = 0;
        geminiConstructorCalls.length = 0;

        const client = createAiClient(settings);

        // 생성자에 전달된 설정 객체를 캡처하여 검증
        const capturedSettings = (client as unknown as Record<string, unknown>)._capturedSettings as GeminiAssistantSettings;

        if (settings.aiBackend === "bedrock") {
          // Bedrock 백엔드: bedrockChatModel, bedrockEmbeddingModel이 전달되어야 함
          expect(capturedSettings.bedrockChatModel).toBe(settings.bedrockChatModel);
          expect(capturedSettings.bedrockEmbeddingModel).toBe(settings.bedrockEmbeddingModel);
        } else {
          // Gemini 백엔드: chatModel, embeddingModel이 전달되어야 함
          expect(capturedSettings.chatModel).toBe(settings.chatModel);
          expect(capturedSettings.embeddingModel).toBe(settings.embeddingModel);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("전달된 설정 객체는 원본 설정과 동일한 모델 필드를 포함한다", () => {
    fc.assert(
      fc.property(modelSettingsArb, (settings) => {
        const client = createAiClient(settings);

        // 생성자에 전달된 전체 설정 객체 확인
        const capturedSettings = (client as unknown as Record<string, unknown>)._capturedSettings as GeminiAssistantSettings;

        // 양쪽 백엔드의 모델 필드가 모두 설정 객체에 포함되어야 함
        expect(capturedSettings.chatModel).toBe(settings.chatModel);
        expect(capturedSettings.embeddingModel).toBe(settings.embeddingModel);
        expect(capturedSettings.bedrockChatModel).toBe(settings.bedrockChatModel);
        expect(capturedSettings.bedrockEmbeddingModel).toBe(settings.bedrockEmbeddingModel);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================
// Property 1: 팩토리 분기 및 폴백
// ============================================

/**
 * Property 1: 팩토리 분기 및 폴백
 *
 * 임의의 aiBackend 값(4개 유효값 "bedrock"/"gemini"/"openai"/"ollama" 및
 * 임의의 무효 문자열·null·undefined)에 대해, createAiClient는
 * "openai"→OpenAIClient, "ollama"→OllamaClient, "bedrock"→BedrockClient,
 * "gemini" 및 그 외 모든 값→GeminiClient 인스턴스를 반환한다.
 *
 * Validates: Requirements 1.3, 1.4, 1.5, 14.4
 */

// 4개 유효 백엔드 값 생성기
const validBackendArb = fc.constantFrom(
  "bedrock" as const,
  "gemini" as const,
  "openai" as const,
  "ollama" as const,
);

// 무효 백엔드 값 생성기: 임의 문자열(유효 4값과 우연히 겹치지 않도록 필터) + null + undefined
const invalidBackendArb = fc.oneof(
  fc
    .string()
    .filter((s) => !["bedrock", "gemini", "openai", "ollama"].includes(s)),
  fc.constant(null),
  fc.constant(undefined),
);

// 유효/무효 값을 모두 포함하는 통합 백엔드 생성기
const anyBackendArb = fc.oneof(validBackendArb, invalidBackendArb);

describe("Property 1: 팩토리 분기 및 폴백", () => {
  beforeEach(() => {
    bedrockConstructorCalls.length = 0;
    geminiConstructorCalls.length = 0;
    openaiConstructorCalls.length = 0;
    ollamaConstructorCalls.length = 0;
  });

  it("Feature: multi-provider-ai-backends, Property 1: 팩토리 분기 및 폴백", () => {
    // Feature: multi-provider-ai-backends, Property 1: 팩토리 분기 및 폴백
    fc.assert(
      fc.property(anyBackendArb, (backend) => {
        // 각 실행마다 생성자 호출 기록 초기화
        bedrockConstructorCalls.length = 0;
        geminiConstructorCalls.length = 0;
        openaiConstructorCalls.length = 0;
        ollamaConstructorCalls.length = 0;

        // aiBackend는 4값 union 타입이므로 무효 값 주입을 위해 캐스팅한다.
        const settings = {
          ...DEFAULT_SETTINGS,
          aiBackend: backend,
        } as unknown as GeminiAssistantSettings;

        const client = createAiClient(settings);

        if (backend === "openai") {
          // "openai" → OpenAIClient
          expect(client).toBeInstanceOf(OpenAIClient);
          expect(openaiConstructorCalls).toHaveLength(1);
          expect(bedrockConstructorCalls).toHaveLength(0);
          expect(ollamaConstructorCalls).toHaveLength(0);
          expect(geminiConstructorCalls).toHaveLength(0);
        } else if (backend === "ollama") {
          // "ollama" → OllamaClient
          expect(client).toBeInstanceOf(OllamaClient);
          expect(ollamaConstructorCalls).toHaveLength(1);
          expect(bedrockConstructorCalls).toHaveLength(0);
          expect(openaiConstructorCalls).toHaveLength(0);
          expect(geminiConstructorCalls).toHaveLength(0);
        } else if (backend === "bedrock") {
          // "bedrock" → BedrockClient
          expect(client).toBeInstanceOf(BedrockClient);
          expect(bedrockConstructorCalls).toHaveLength(1);
          expect(openaiConstructorCalls).toHaveLength(0);
          expect(ollamaConstructorCalls).toHaveLength(0);
          expect(geminiConstructorCalls).toHaveLength(0);
        } else {
          // "gemini" 및 그 외 모든 무효 값(임의 문자열/null/undefined) → GeminiClient 폴백
          expect(client).toBeInstanceOf(GeminiClient);
          expect(geminiConstructorCalls).toHaveLength(1);
          expect(bedrockConstructorCalls).toHaveLength(0);
          expect(openaiConstructorCalls).toHaveLength(0);
          expect(ollamaConstructorCalls).toHaveLength(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});
