import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "./types";

// ============================================
// multi-provider-ai-backends 설정 기본값 단위 테스트
// ============================================
// 이 파일은 OpenAI/Ollama 백엔드 신규 설정 필드의 DEFAULT_SETTINGS 기본값을 검증한다.
// _Requirements: 2.3, 2.4, 2.5_

describe("DEFAULT_SETTINGS OpenAI 백엔드 기본값 (Req 2.3, 2.4)", () => {
  it("openaiApiKey 기본값은 빈 문자열이다", () => {
    // API 키 기본값은 빈 문자열 (Req 2.3)
    expect(DEFAULT_SETTINGS.openaiApiKey).toBe("");
  });

  it("openaiBaseUrl 기본값은 빈 문자열이다", () => {
    // base URL 기본값은 빈 문자열 (빈 값이면 공식 엔드포인트 사용, Req 2.3/2.7)
    expect(DEFAULT_SETTINGS.openaiBaseUrl).toBe("");
  });

  it("openaiChatModel 기본값은 'gpt-5.4-mini'이다", () => {
    // 채팅 모델 기본값 (Req 2.4)
    expect(DEFAULT_SETTINGS.openaiChatModel).toBe("gpt-5.4-mini");
  });

  it("openaiEmbeddingModel 기본값은 'text-embedding-3-large'이다", () => {
    // 임베딩 모델 기본값 (2026-06 기준, Req 2.4)
    expect(DEFAULT_SETTINGS.openaiEmbeddingModel).toBe("text-embedding-3-large");
  });
});

describe("DEFAULT_SETTINGS Ollama 백엔드 기본값 (Req 2.3, 2.4)", () => {
  it("ollamaBaseUrl 기본값은 빈 문자열이다", () => {
    // base URL 기본값은 빈 문자열 (빈 값이면 http://localhost:11434 사용, Req 2.3/2.9)
    expect(DEFAULT_SETTINGS.ollamaBaseUrl).toBe("");
  });

  it("ollamaChatModel 기본값은 'llama4'이다", () => {
    // 채팅 모델 기본값 (2026-06 기준, Req 2.4)
    expect(DEFAULT_SETTINGS.ollamaChatModel).toBe("llama4");
  });

  it("ollamaEmbeddingModel 기본값은 'nomic-embed-text'이다", () => {
    // 임베딩 모델 기본값 (2026-06 기준, Req 2.4)
    expect(DEFAULT_SETTINGS.ollamaEmbeddingModel).toBe("nomic-embed-text");
  });
});

describe("채팅/임베딩 모델 기본값은 비어 있지 않은 문자열 (Req 2.4, 2.5)", () => {
  // 모델 ID 기본값은 공급자에서 사용 가능한 비어 있지 않은 문자열이어야 한다 (Req 2.4).
  // 이 값들은 작성 시점(2026-06) 기준 예시이며 향후 변경될 수 있다 (Req 2.5).
  const modelFields: Array<keyof typeof DEFAULT_SETTINGS> = [
    "openaiChatModel",
    "openaiEmbeddingModel",
    "ollamaChatModel",
    "ollamaEmbeddingModel",
  ];

  for (const field of modelFields) {
    it(`${field}는 비어 있지 않은 문자열이다`, () => {
      const value = DEFAULT_SETTINGS[field];
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    });
  }
});

// ============================================
// Property 13: 설정 마이그레이션 (기본값 보강 + 기존값 보존)
// ============================================
// main.ts의 loadSettings는 `Object.assign({}, DEFAULT_SETTINGS, loaded)`
// (= { ...DEFAULT_SETTINGS, ...loaded }) 패턴으로 저장 설정을 병합한다.
// 본 속성 테스트는 동일한 병합 패턴을 사용하여 다음을 검증한다.
//   - 입력(loaded)에 누락된 신규 백엔드 필드는 DEFAULT_SETTINGS 기본값으로 채워진다 (Req 14.2)
//   - 입력에 이미 존재하던 모든 필드 값은 변경 없이 보존된다 (Req 14.3)
// _Requirements: 14.2, 14.3_

import * as fc from "fast-check";

// 신규 백엔드 필드 목록 (일부/전부 누락 케이스를 제너레이터가 포함해야 함)
const NEW_BACKEND_FIELDS = [
  "openaiApiKey",
  "openaiChatModel",
  "openaiEmbeddingModel",
  "openaiBaseUrl",
  "ollamaBaseUrl",
  "ollamaChatModel",
  "ollamaEmbeddingModel",
] as const;

describe("Property 13: 설정 마이그레이션 (기본값 보강 + 기존값 보존) (Req 14.2, 14.3)", () => {
  // Feature: multi-provider-ai-backends, Property 13: 설정 마이그레이션 (기본값 보강 + 기존값 보존)
  it("신규 필드 누락 시 기본값으로 채워지고 기존 필드 값은 보존된다", () => {
    // 기존 Bedrock/Gemini 값을 보유한 부분 설정 제너레이터.
    // 신규 백엔드 필드는 requiredKeys에서 제외하여 일부/전부 누락 케이스를 생성한다.
    const loadedArb = fc.record(
      {
        // === 기존 필드 (항상 존재, 임의의 커스텀 값 보유) ===
        aiBackend: fc.constantFrom<"bedrock" | "gemini">("bedrock", "gemini"),
        geminiApiKey: fc.string(),
        awsAccessKeyId: fc.string(),
        awsSecretAccessKey: fc.string(),
        bedrockChatModel: fc.string(),
        bedrockEmbeddingModel: fc.string(),
        // === 신규 백엔드 필드 (선택적 — 누락 가능) ===
        openaiApiKey: fc.string(),
        openaiChatModel: fc.string(),
        openaiEmbeddingModel: fc.string(),
        openaiBaseUrl: fc.string(),
        ollamaBaseUrl: fc.string(),
        ollamaChatModel: fc.string(),
        ollamaEmbeddingModel: fc.string(),
      },
      {
        // 기존 필드만 필수 — 신규 필드는 무작위로 누락되어 부분/전체 누락 케이스를 포함한다
        requiredKeys: [
          "aiBackend",
          "geminiApiKey",
          "awsAccessKeyId",
          "awsSecretAccessKey",
          "bedrockChatModel",
          "bedrockEmbeddingModel",
        ],
      }
    );

    fc.assert(
      fc.property(loadedArb, (loaded) => {
        // main.ts loadSettings와 동일한 병합 패턴
        const merged = Object.assign({}, DEFAULT_SETTINGS, loaded);

        // 신규 백엔드 필드: 누락 시 기본값 보강, 존재 시 값 보존
        for (const field of NEW_BACKEND_FIELDS) {
          if (field in loaded) {
            // 입력에 존재하던 값은 변경 없이 보존된다 (Req 14.3)
            expect(merged[field]).toBe((loaded as Record<string, unknown>)[field]);
          } else {
            // 누락된 신규 필드는 DEFAULT_SETTINGS 기본값으로 채워진다 (Req 14.2)
            expect(merged[field]).toBe(DEFAULT_SETTINGS[field]);
          }
        }

        // 기존 Bedrock/Gemini 필드 값은 항상 보존된다 (Req 14.3)
        expect(merged.aiBackend).toBe(loaded.aiBackend);
        expect(merged.geminiApiKey).toBe(loaded.geminiApiKey);
        expect(merged.awsAccessKeyId).toBe(loaded.awsAccessKeyId);
        expect(merged.awsSecretAccessKey).toBe(loaded.awsSecretAccessKey);
        expect(merged.bedrockChatModel).toBe(loaded.bedrockChatModel);
        expect(merged.bedrockEmbeddingModel).toBe(loaded.bedrockEmbeddingModel);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: multi-provider-ai-backends, Property 13: 설정 마이그레이션 (기본값 보강 + 기존값 보존)
  it("신규 백엔드 필드가 전부 누락된 설정은 모든 신규 필드를 기본값으로 채운다", () => {
    // 전부 누락 케이스를 명시적으로 검증 (제너레이터의 경계 케이스 보강)
    const legacyArb = fc.record({
      aiBackend: fc.constantFrom<"bedrock" | "gemini">("bedrock", "gemini"),
      geminiApiKey: fc.string(),
      bedrockChatModel: fc.string(),
    });

    fc.assert(
      fc.property(legacyArb, (legacy) => {
        const merged = Object.assign({}, DEFAULT_SETTINGS, legacy);

        // 모든 신규 필드는 기본값으로 채워진다 (Req 14.2)
        for (const field of NEW_BACKEND_FIELDS) {
          expect(merged[field]).toBe(DEFAULT_SETTINGS[field]);
        }
        // 기존 값은 보존된다 (Req 14.3)
        expect(merged.aiBackend).toBe(legacy.aiBackend);
        expect(merged.geminiApiKey).toBe(legacy.geminiApiKey);
        expect(merged.bedrockChatModel).toBe(legacy.bedrockChatModel);
      }),
      { numRuns: 100 }
    );
  });
});
