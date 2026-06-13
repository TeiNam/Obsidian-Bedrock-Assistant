import type { GeminiAssistantSettings, IAiClient } from "./types";
import { BedrockClient } from "./bedrock-client";

/**
 * AI 클라이언트 팩토리 함수
 * 이 에디션은 AWS Bedrock 단일 백엔드만 지원하므로 항상 BedrockClient를 생성한다.
 * (호출부 호환을 위해 시그니처는 그대로 유지한다.)
 */
export function createAiClient(settings: GeminiAssistantSettings): IAiClient {
  return new BedrockClient(settings);
}
