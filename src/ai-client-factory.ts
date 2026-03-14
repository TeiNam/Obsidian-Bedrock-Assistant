import type { GeminiAssistantSettings, IAiClient } from "./types";
import { BedrockClient } from "./bedrock-client";
import { GeminiClient } from "./gemini-client";

/**
 * AI 클라이언트 팩토리 함수
 * 설정의 aiBackend 값에 따라 적절한 AI 클라이언트 인스턴스를 생성한다.
 * - "bedrock": BedrockClient 반환
 * - 그 외 (기본값 "gemini"): GeminiClient 반환
 */
export function createAiClient(settings: GeminiAssistantSettings): IAiClient {
  if (settings.aiBackend === "bedrock") {
    return new BedrockClient(settings);
  }
  return new GeminiClient(settings);
}
