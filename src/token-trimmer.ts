import type { ConverseMessage, ToolDefinition } from "./types";

// 컨텍스트 윈도우 크기 (토큰 단위, 200K 기본)
const CONTEXT_WINDOW = 200_000;
// 컨텍스트 윈도우의 80%를 메시지 허용 한도로 설정
const CONTEXT_USAGE_RATIO = 0.8;
// 시스템 프롬프트 등 기본 예약 토큰 수
const BASE_RESERVED_TOKENS = 3000;
// 최소 유지할 메시지 수 (마지막 user + assistant 쌍)
const MIN_MESSAGES = 2;

/**
 * 메시지 배열의 토큰 수를 추정합니다.
 * 간단한 추정: JSON.stringify(messages).length / 4 (영어 기준 ~4자/토큰)
 */
export function estimateTokens(messages: ConverseMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

/**
 * 컨텍스트 윈도우 초과를 방지하기 위해 오래된 메시지를 제거합니다.
 * 원본 배열을 직접 수정(mutate)합니다.
 *
 * - 토큰 추정: JSON.stringify(messages).length / 4
 * - 컨텍스트 윈도우의 80% 초과 시 가장 오래된 메시지부터 제거
 * - 시스템 프롬프트 + 도구 정의 토큰도 예약
 * - 최소 마지막 2개 메시지(user + assistant)는 유지
 * - Converse API 규약: 첫 메시지는 반드시 user 역할이어야 함
 */
export function trimConversationHistory(
  messages: ConverseMessage[],
  tools: ToolDefinition[]
): void {
  const MAX_MESSAGE_TOKENS = CONTEXT_WINDOW * CONTEXT_USAGE_RATIO;
  // 도구 정의 크기도 토큰 예약에 포함
  const toolTokens = Math.ceil(JSON.stringify(tools).length / 4);
  const reservedTokens = BASE_RESERVED_TOKENS + toolTokens;

  // 메시지에 사용 가능한 실제 토큰 한도
  const availableTokens = MAX_MESSAGE_TOKENS - reservedTokens;

  let currentTokens = estimateTokens(messages);

  // 토큰 한도 초과 시 오래된 메시지부터 제거
  while (currentTokens > availableTokens && messages.length > MIN_MESSAGES) {
    messages.shift();
    currentTokens = estimateTokens(messages);
  }

  // Converse API 규약: 첫 메시지는 반드시 user 역할이어야 함
  // 트리밍 후 첫 메시지가 assistant인 경우 제거
  while (messages.length > MIN_MESSAGES && messages[0]?.role === "assistant") {
    messages.shift();
  }
}
