import { describe, it, expect } from "vitest";
import { trimConversationHistory, estimateTokens } from "./token-trimmer";
import type { ConverseMessage, ToolDefinition } from "./types";

// 테스트용 헬퍼: 지정된 길이의 텍스트를 가진 메시지 생성
function makeMessage(role: "user" | "assistant", charLength: number): ConverseMessage {
  const text = "x".repeat(charLength);
  return { role, content: [{ text }] };
}

// 테스트용 헬퍼: user/assistant 쌍을 N개 생성
function makeConversation(pairs: number, charsPerMessage = 100): ConverseMessage[] {
  const messages: ConverseMessage[] = [];
  for (let i = 0; i < pairs; i++) {
    messages.push(makeMessage("user", charsPerMessage));
    messages.push(makeMessage("assistant", charsPerMessage));
  }
  return messages;
}

// 빈 도구 목록 (테스트 단순화)
const emptyTools: ToolDefinition[] = [];

describe("estimateTokens", () => {
  it("메시지 배열의 토큰 수를 추정한다", () => {
    const messages = [makeMessage("user", 100)];
    const tokens = estimateTokens(messages);
    // JSON.stringify 길이 / 4 (올림)
    const expected = Math.ceil(JSON.stringify(messages).length / 4);
    expect(tokens).toBe(expected);
  });

  it("빈 배열은 최소 토큰을 반환한다", () => {
    const tokens = estimateTokens([]);
    expect(tokens).toBeGreaterThan(0); // "[]" → 1 토큰
  });
});

describe("trimConversationHistory", () => {
  it("토큰 한도 이내면 메시지를 제거하지 않는다", () => {
    const messages = makeConversation(3, 100);
    const originalLength = messages.length;
    trimConversationHistory(messages, emptyTools);
    expect(messages.length).toBe(originalLength);
  });

  it("토큰 한도 초과 시 오래된 메시지부터 제거한다", () => {
    // 매우 큰 메시지를 많이 생성하여 200K * 0.8 = 160K 토큰 초과 유도
    // 160K 토큰 ≈ 640K 문자 (4자/토큰)
    // 각 메시지 50K 문자 × 20개 = 1M 문자 ≈ 250K 토큰
    const messages = makeConversation(10, 50000);
    const originalLength = messages.length;
    trimConversationHistory(messages, emptyTools);
    // 메시지가 줄어들어야 함
    expect(messages.length).toBeLessThan(originalLength);
  });

  it("최소 2개 메시지(마지막 user+assistant 쌍)는 유지한다", () => {
    // 극단적으로 큰 메시지 2개만 있는 경우
    const messages: ConverseMessage[] = [
      makeMessage("user", 500000),
      makeMessage("assistant", 500000),
    ];
    trimConversationHistory(messages, emptyTools);
    // 최소 2개는 유지
    expect(messages.length).toBe(2);
  });

  it("트리밍 후 첫 메시지가 user 역할이어야 한다", () => {
    // assistant로 시작하는 메시지 배열 (비정상 상태 시뮬레이션)
    // 큰 메시지를 넣어 트리밍이 발생하도록 함
    const messages: ConverseMessage[] = [
      makeMessage("user", 50000),
      makeMessage("assistant", 50000),
      makeMessage("user", 50000),
      makeMessage("assistant", 50000),
      makeMessage("user", 50000),
      makeMessage("assistant", 50000),
      makeMessage("user", 50000),
      makeMessage("assistant", 50000),
      makeMessage("user", 50000),
      makeMessage("assistant", 50000),
      makeMessage("user", 50000),
      makeMessage("assistant", 50000),
      makeMessage("user", 50000),
      makeMessage("assistant", 50000),
      makeMessage("user", 100),
      makeMessage("assistant", 100),
    ];
    trimConversationHistory(messages, emptyTools);
    // 첫 메시지는 반드시 user여야 함
    expect(messages[0].role).toBe("user");
  });

  it("도구 정의가 클수록 메시지에 사용 가능한 토큰이 줄어든다", () => {
    // 큰 도구 정의 생성
    const bigTools: ToolDefinition[] = Array.from({ length: 50 }, (_, i) => ({
      name: `tool_${i}`,
      description: "A".repeat(2000),
      input_schema: { type: "object", properties: { input: { type: "string", description: "B".repeat(1000) } } },
    }));

    const messagesWithSmallTools = makeConversation(10, 50000);
    const messagesWithBigTools = makeConversation(10, 50000);

    trimConversationHistory(messagesWithSmallTools, emptyTools);
    trimConversationHistory(messagesWithBigTools, bigTools);

    // 큰 도구 정의가 있으면 더 많은 메시지가 제거됨
    expect(messagesWithBigTools.length).toBeLessThanOrEqual(messagesWithSmallTools.length);
  });

  it("메시지가 2개 이하면 트리밍하지 않는다", () => {
    const messages: ConverseMessage[] = [
      makeMessage("user", 100),
    ];
    trimConversationHistory(messages, emptyTools);
    expect(messages.length).toBe(1);
  });

  it("빈 메시지 배열은 그대로 유지된다", () => {
    const messages: ConverseMessage[] = [];
    trimConversationHistory(messages, emptyTools);
    expect(messages.length).toBe(0);
  });
});
