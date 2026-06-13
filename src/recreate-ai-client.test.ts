import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, GeminiAssistantSettings, IAiClient } from "./types";

// ============================================
// 4개 백엔드 클라이언트 모킹
// ============================================
// main.ts의 recreateAiClient()는 plugin 메서드라 전체 플러그인을 인스턴스화하기 어렵다.
// 따라서 createAiClient + indexer.client 갱신이라는 "핵심 와이어링"만 떼어내 검증한다.
// 실제 네트워크/SDK 의존성을 제거하기 위해 4개 클라이언트 모듈을 class 기반으로 모킹하고,
// aiBackend별로 서로 다른 클라이언트 인스턴스가 생성되어 indexer.client에 할당되는지 확인한다.

vi.mock("./bedrock-client", () => ({
  BedrockClient: class MockBedrockClient {
    updateSettings = vi.fn();
    listModels = vi.fn();
    converse = vi.fn();
    getEmbedding = vi.fn();
    converseLight = vi.fn();
    constructor(public settings: GeminiAssistantSettings) {}
  },
}));

vi.mock("./gemini-client", () => ({
  GeminiClient: class MockGeminiClient {
    updateSettings = vi.fn();
    listModels = vi.fn();
    converse = vi.fn();
    getEmbedding = vi.fn();
    converseLight = vi.fn();
    constructor(public settings: GeminiAssistantSettings) {}
  },
}));

vi.mock("./openai-client", () => ({
  OpenAIClient: class MockOpenAIClient {
    updateSettings = vi.fn();
    listModels = vi.fn();
    converse = vi.fn();
    getEmbedding = vi.fn();
    converseLight = vi.fn();
    constructor(public settings: GeminiAssistantSettings) {}
  },
}));

vi.mock("./ollama-client", () => ({
  OllamaClient: class MockOllamaClient {
    updateSettings = vi.fn();
    listModels = vi.fn();
    converse = vi.fn();
    getEmbedding = vi.fn();
    converseLight = vi.fn();
    constructor(public settings: GeminiAssistantSettings) {}
  },
}));

// 모킹 후 import (모킹 모듈이 적용된 createAiClient 사용)
import { createAiClient } from "./ai-client-factory";
import { BedrockClient } from "./bedrock-client";
import { GeminiClient } from "./gemini-client";
import { OpenAIClient } from "./openai-client";
import { OllamaClient } from "./ollama-client";

// ============================================
// 최소 plugin 스텁
// ============================================
// main.ts의 GeminiAssistantPlugin.recreateAiClient()와 동일한 와이어링을 재현한다:
//   this.aiClient = createAiClient(this.settings);
//   this.indexer.client = this.aiClient;
// indexer는 client 참조만 보유한 최소 스텁으로 충분하다 (VaultIndexer 대역).
class FakeIndexer {
  // 인덱서가 참조하는 AI 클라이언트 (recreateAiClient가 갱신하는 대상)
  client: IAiClient;
  constructor(client: IAiClient) {
    this.client = client;
  }
}

class FakePlugin {
  settings: GeminiAssistantSettings;
  aiClient: IAiClient;
  indexer: FakeIndexer;

  constructor(settings: GeminiAssistantSettings) {
    this.settings = settings;
    // 초기 클라이언트 생성 및 인덱서에 동일 참조 주입
    this.aiClient = createAiClient(settings);
    this.indexer = new FakeIndexer(this.aiClient);
  }

  /** main.ts와 동일한 백엔드 재생성 로직 */
  recreateAiClient(): void {
    this.aiClient = createAiClient(this.settings);
    // 인덱서의 AI 클라이언트 참조도 갱신
    this.indexer.client = this.aiClient;
  }
}

// 백엔드 값 → 기대 클라이언트 클래스 매핑
const BACKEND_TO_CLIENT = [
  { backend: "bedrock" as const, ClientClass: BedrockClient },
  { backend: "gemini" as const, ClientClass: GeminiClient },
  { backend: "openai" as const, ClientClass: OpenAIClient },
  { backend: "ollama" as const, ClientClass: OllamaClient },
];

describe("recreateAiClient 와이어링 (Req 1.6, 1.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(BACKEND_TO_CLIENT)(
    "aiBackend=$backend 로 변경 시 indexer.client가 해당 클라이언트 인스턴스로 갱신된다",
    ({ backend, ClientClass }) => {
      // gemini로 시작하는 플러그인 (초기 백엔드)
      const plugin = new FakePlugin({
        ...DEFAULT_SETTINGS,
        aiBackend: "gemini",
      });

      // 초기 상태: indexer.client는 초기 aiClient와 동일 참조 (Req 1.7)
      expect(plugin.indexer.client).toBe(plugin.aiClient);

      // 백엔드 변경 후 재생성 (Req 1.6)
      plugin.settings.aiBackend = backend;
      plugin.recreateAiClient();

      // 새 클라이언트가 기대 백엔드 타입의 인스턴스인지 확인
      expect(plugin.aiClient).toBeInstanceOf(ClientClass);
      // indexer.client가 새 인스턴스로 갱신되었는지 확인 (Req 1.7)
      expect(plugin.indexer.client).toBeInstanceOf(ClientClass);
      expect(plugin.indexer.client).toBe(plugin.aiClient);
    },
  );

  it("백엔드 변경 시 indexer.client가 기존 인스턴스와 다른 새 인스턴스로 교체된다", () => {
    // openai로 시작
    const plugin = new FakePlugin({
      ...DEFAULT_SETTINGS,
      aiBackend: "openai",
    });
    const initialClient = plugin.indexer.client;
    expect(initialClient).toBeInstanceOf(OpenAIClient);

    // ollama로 전환
    plugin.settings.aiBackend = "ollama";
    plugin.recreateAiClient();

    // indexer.client가 새 인스턴스(OllamaClient)로 교체됨 (이전 OpenAIClient 인스턴스와 다름)
    expect(plugin.indexer.client).toBeInstanceOf(OllamaClient);
    expect(plugin.indexer.client).not.toBe(initialClient);
    expect(plugin.indexer.client).toBe(plugin.aiClient);
  });

  it("동일 백엔드로 재생성해도 indexer.client는 매번 새 인스턴스로 갱신된다", () => {
    // openai 유지 상태에서 재생성 시에도 항상 새 인스턴스로 갱신되는지 확인 (참조 갱신 보장)
    const plugin = new FakePlugin({
      ...DEFAULT_SETTINGS,
      aiBackend: "openai",
    });
    const firstClient = plugin.indexer.client;

    plugin.recreateAiClient();

    expect(plugin.indexer.client).toBeInstanceOf(OpenAIClient);
    // createAiClient가 매 호출마다 new 인스턴스를 만들므로 참조가 바뀐다
    expect(plugin.indexer.client).not.toBe(firstClient);
    expect(plugin.indexer.client).toBe(plugin.aiClient);
  });
});
