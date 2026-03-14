import { describe, it, expect } from "vitest";
import { trimConversationHistory, estimateTokens, CHARS_PER_TOKEN } from "./token-trimmer";
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
    // JSON.stringify 길이 / CHARS_PER_TOKEN (올림)
    const expected = Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);
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


/**
 * Property 1: Fault Condition - 토큰 추정 비율 일관성
 * estimateTokens()와 updateContextRing()이 동일한 CHARS_PER_TOKEN 비율을 사용하는지 확인
 *
 * **Validates: Requirements 2.8**
 */
describe("토큰 추정 비율 일관성 (Property 1: Fault Condition)", () => {
  it("CHARS_PER_TOKEN이 2.5이어야 한다", () => {
    expect(CHARS_PER_TOKEN).toBe(2.5);
  });

  it("estimateTokens()가 CHARS_PER_TOKEN 비율을 사용한다", () => {
    const messages = [makeMessage("user", 250)];
    const result = estimateTokens(messages);
    // 수동으로 기대값 계산: JSON.stringify 길이 / CHARS_PER_TOKEN (올림)
    const jsonLength = JSON.stringify(messages).length;
    const expected = Math.ceil(jsonLength / CHARS_PER_TOKEN);
    expect(result).toBe(expected);
  });

  it("동일 텍스트에 대해 토큰 추정 결과가 일관된다 (동일 입력 → 동일 출력)", () => {
    const messages = [
      makeMessage("user", 500),
      makeMessage("assistant", 300),
    ];
    const firstEstimate = estimateTokens(messages);
    const secondEstimate = estimateTokens(messages);
    expect(firstEstimate).toBe(secondEstimate);
  });

  it("다양한 길이의 텍스트에서 CHARS_PER_TOKEN 비율이 일관되게 적용된다", () => {
    const testCases = [10, 100, 1000, 10000];
    for (const charLength of testCases) {
      const messages = [makeMessage("user", charLength)];
      const result = estimateTokens(messages);
      const jsonLength = JSON.stringify(messages).length;
      const expected = Math.ceil(jsonLength / CHARS_PER_TOKEN);
      expect(result).toBe(expected);
    }
  });
});

/**
 * B5: 커스텀 컨텍스트 윈도우 파라미터 테스트
 * contextWindow 파라미터를 통해 동적으로 컨텍스트 윈도우 크기를 설정할 수 있는지 확인
 *
 * **Validates: Requirements REQ-B5**
 */
describe("커스텀 컨텍스트 윈도우 (B5: CONTEXT_WINDOW 동적 설정)", () => {
  it("기본값(200K) — 파라미터 미전달 시 기존 동작과 동일", () => {
    const messages = makeConversation(3, 100);
    const originalLength = messages.length;
    // contextWindow 파라미터 없이 호출
    trimConversationHistory(messages, emptyTools);
    expect(messages.length).toBe(originalLength);
  });

  it("작은 컨텍스트 윈도우 전달 시 더 많은 메시지가 트리밍된다", () => {
    // 기본 200K로 트리밍
    const messagesDefault = makeConversation(10, 50000);
    trimConversationHistory(messagesDefault, emptyTools);

    // 작은 50K 윈도우로 트리밍
    const messagesSmall = makeConversation(10, 50000);
    trimConversationHistory(messagesSmall, emptyTools, 50_000);

    // 작은 윈도우에서 더 많이 트리밍되어야 함
    expect(messagesSmall.length).toBeLessThanOrEqual(messagesDefault.length);
  });

  it("큰 컨텍스트 윈도우 전달 시 더 적은 메시지가 트리밍된다", () => {
    // 기본 200K로 트리밍
    const messagesDefault = makeConversation(10, 50000);
    trimConversationHistory(messagesDefault, emptyTools);

    // 큰 500K 윈도우로 트리밍
    const messagesBig = makeConversation(10, 50000);
    trimConversationHistory(messagesBig, emptyTools, 500_000);

    // 큰 윈도우에서 더 많은 메시지가 유지되어야 함
    expect(messagesBig.length).toBeGreaterThanOrEqual(messagesDefault.length);
  });

  it("매우 작은 컨텍스트 윈도우에서도 최소 2개 메시지는 유지된다", () => {
    const messages = makeConversation(5, 10000);
    // 극단적으로 작은 윈도우 (1K 토큰)
    trimConversationHistory(messages, emptyTools, 1_000);
    // MIN_MESSAGES = 2
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it("컨텍스트 윈도우 내 메시지는 트리밍되지 않는다", () => {
    // 작은 메시지 3쌍 (총 ~600자 ≈ 240토큰)
    const messages = makeConversation(3, 100);
    const originalLength = messages.length;
    // 충분히 큰 윈도우
    trimConversationHistory(messages, emptyTools, 100_000);
    expect(messages.length).toBe(originalLength);
  });
});

/**
 * Property 2: Preservation - trimConversationHistory() 동작 보존
 * 토큰 추정 변경 후에도 컨텍스트 윈도우 초과 방지 로직이 정상 동작하는지 확인
 *
 * **Validates: Requirements 3.9**
 */
describe("trimConversationHistory() 동작 보존 (Property 2: Preservation)", () => {
  it("토큰 한도 초과 시 메시지를 올바르게 트리밍한다", () => {
    // CHARS_PER_TOKEN=2.5 기준: 160K 토큰 ≈ 400K 문자
    // 각 메시지 50K 문자 × 20개 = 1M 문자 ≈ 400K 토큰 → 초과
    const messages = makeConversation(10, 50000);
    const originalLength = messages.length;
    trimConversationHistory(messages, emptyTools);
    expect(messages.length).toBeLessThan(originalLength);
  });

  it("최소 2개 메시지(마지막 user+assistant 쌍)는 항상 유지한다", () => {
    // 극단적으로 큰 메시지로 트리밍 유도
    const messages: ConverseMessage[] = [
      makeMessage("user", 800000),
      makeMessage("assistant", 800000),
    ];
    trimConversationHistory(messages, emptyTools);
    // 최소 2개는 유지되어야 함
    expect(messages.length).toBe(2);
  });

  it("트리밍 후 전체 토큰이 컨텍스트 윈도우 한도 이내이거나 최소 메시지만 남는다", () => {
    const messages = makeConversation(15, 40000);
    trimConversationHistory(messages, emptyTools);

    const currentTokens = estimateTokens(messages);
    // 200K * 0.8 = 160K 토큰 한도 (도구 없으므로 예약 토큰 3000만 차감)
    const maxTokens = 200000 * 0.8 - 3000;

    // 트리밍 후 한도 이내이거나, 최소 메시지(2개)만 남아야 함
    const withinLimit = currentTokens <= maxTokens;
    const atMinimum = messages.length <= 2;
    expect(withinLimit || atMinimum).toBe(true);
  });
});
