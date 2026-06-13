import type { GeminiAssistantSettings, IAiClient } from "./types";
import { BedrockClient } from "./bedrock-client";
import { GeminiClient } from "./gemini-client";
import { OpenAIClient } from "./openai-client";
import { OllamaClient } from "./ollama-client";

/**
 * AI 클라이언트 팩토리 함수
 * 설정의 aiBackend 값에 따라 적절한 AI 클라이언트 인스턴스를 생성한다.
 * - "bedrock": BedrockClient 반환
 * - "openai": OpenAIClient 반환
 * - "ollama": OllamaClient 반환
 * - "gemini": GeminiClient 반환
 * - 그 외 알 수 없는 값(null/undefined 포함): GeminiClient 폴백 (Req 1.5)
 */
export function createAiClient(settings: GeminiAssistantSettings): IAiClient {
  switch (settings.aiBackend) {
    case "bedrock":
      return new BedrockClient(settings);
    case "openai":
      return new OpenAIClient(settings);
    case "ollama":
      return new OllamaClient(settings);
    case "gemini":
      return new GeminiClient(settings);
    default:
      // 알 수 없는 백엔드 값은 GeminiClient로 폴백한다 (Req 1.5)
      return new GeminiClient(settings);
  }
}
