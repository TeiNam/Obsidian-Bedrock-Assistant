import type { ConverseMessage, ToolDefinition } from "./types";

// 토큰 추정 비율: 한국어 혼합 기준 약 2.5자/토큰
export const CHARS_PER_TOKEN = 2.5;

// 컨텍스트 윈도우 기본값 (토큰 단위, 200K)
// trimConversationHistory()에 contextWindow 파라미터가 전달되지 않을 때 사용
const DEFAULT_CONTEXT_WINDOW = 200_000;
// 컨텍스트 윈도우의 80%를 메시지 허용 한도로 설정
const CONTEXT_USAGE_RATIO = 0.8;
// 시스템 프롬프트 등 기본 예약 토큰 수
const BASE_RESERVED_TOKENS = 3000;
// 최소 유지할 메시지 수 (마지막 user + assistant 쌍)
const MIN_MESSAGES = 2;

/**
 * 메시지 배열의 토큰 수를 추정합니다.
 * 한국어 혼합 기준 약 2.5자/토큰 비율을 사용합니다.
 */
export function estimateTokens(messages: ConverseMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);
}

/**
 * 컨텍스트 윈도우 초과를 방지하기 위해 오래된 메시지를 제거합니다.
 * 원본 배열을 직접 수정(mutate)합니다.
 *
 * - 토큰 추정: JSON.stringify(messages).length / CHARS_PER_TOKEN
 * - 컨텍스트 윈도우의 80% 초과 시 가장 오래된 메시지부터 제거
 * - 시스템 프롬프트 + 도구 정의 토큰도 예약
 * - 최소 마지막 2개 메시지(user + assistant)는 유지
 * - Converse API 규약: 첫 메시지는 반드시 user 역할이어야 함
 */
export function trimConversationHistory(
  messages: ConverseMessage[],
  tools: ToolDefinition[],
  contextWindow = DEFAULT_CONTEXT_WINDOW
): void {
  const MAX_MESSAGE_TOKENS = contextWindow * CONTEXT_USAGE_RATIO;
  // 도구 정의 크기도 토큰 예약에 포함
  const toolTokens = Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN);
  const reservedTokens = BASE_RESERVED_TOKENS + toolTokens;

  // 메시지에 사용 가능한 실제 토큰 한도
  const availableTokens = MAX_MESSAGE_TOKENS - reservedTokens;

  let currentTokens = estimateTokens(messages);

  // 토큰 한도 초과 시 오래된 메시지부터 제거
  while (currentTokens > availableTokens && messages.length > MIN_MESSAGES) {
    messages.shift();
    currentTokens = estimateTokens(messages);
  }

  // Converse API 규약: 첫 메시지는 반드시 user 역할이어야 함.
  //
  // 여기서는 MIN_MESSAGES 하한을 적용하지 않는다. 위 토큰 트리밍의 하한과 목적이 다르다 —
  // 그쪽은 "문맥을 너무 많이 버리지 않기" 위한 것이고, 이쪽은 API 규약이라 위반하면
  // 요청 자체가 실패한다(Bedrock ValidationException, Gemini 400). 메시지가 줄어드는
  // 것보다 전송 실패가 나쁘다.
  //
  // 과거 조건은 `length > MIN_MESSAGES(2)` 여서 길이가 **정확히 2**일 때 동작하지 않았고,
  // [assistant, user] 배열이 그대로 API 로 전송됐다.
  while (messages.length > 0 && messages[0]?.role === "assistant") {
    messages.shift();
  }
}
