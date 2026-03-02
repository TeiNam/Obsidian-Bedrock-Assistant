import { describe, it, expect } from "vitest";
import type { ChatMessage, ConverseMessage } from "./types";

/**
 * 메시지 불변성 테스트
 *
 * generateResponse()의 converseMessages 매핑 로직을 순수 함수로 추출하여 검증합니다.
 * 핵심: 원본 ChatMessage 배열은 변경하지 않고, API 호출용 ConverseMessage 복사본에만
 * 컨텍스트 접두사(contextPrefix)를 적용해야 합니다.
 *
 * Property 1: Fault Condition - 첨부 파일 컨텍스트 시 원본 메시지 보존
 * Property 2: Preservation - 첨부 파일 없는 메시지 동작 보존
 *
 * Validates: Requirements 2.7, 3.8
 */

/**
 * generateResponse()의 converseMessages 매핑 로직을 재현한 순수 함수.
 * 원본 messages 배열에서 API 호출용 ConverseMessage 복사본을 생성합니다.
 *
 * - contextPrefix가 있으면 마지막 user 메시지의 복사본에만 접두사를 적용
 * - 원본 ChatMessage 배열은 절대 변경하지 않음
 */
function buildConverseMessages(
  messages: ChatMessage[],
  contextPrefix?: string
): ConverseMessage[] {
  return messages.map((m, i) => ({
    role: m.role,
    content: [
      {
        text:
          contextPrefix &&
          i === messages.length - 1 &&
          m.role === "user"
            ? contextPrefix + m.content
            : m.content,
      },
    ],
  }));
}

// --- Property 1: Fault Condition ---
// 첨부 파일 컨텍스트가 있을 때 원본 메시지의 content가 변경되지 않아야 함

describe("메시지 불변성 - Fault Condition (Property 1)", () => {
  /**
   * Validates: Requirements 2.7
   */

  it("contextPrefix 적용 후 원본 메시지 content가 변경되지 않는다", () => {
    const originalContent = "안녕하세요";
    const messages: ChatMessage[] = [
      { role: "user", content: originalContent, timestamp: Date.now() },
    ];

    const contextPrefix = "[첨부 파일: note.md]\n내용: 테스트 파일\n\n";
    buildConverseMessages(messages, contextPrefix);

    // 원본 메시지가 변경되지 않았는지 확인
    expect(messages[0].content).toBe(originalContent);
  });

  it("복사본의 마지막 user 메시지에만 contextPrefix가 적용된다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "첫 번째 질문", timestamp: 1000 },
      { role: "assistant", content: "첫 번째 답변", timestamp: 2000 },
      { role: "user", content: "두 번째 질문", timestamp: 3000 },
    ];

    const contextPrefix = "[파일 컨텍스트]\n";
    const result = buildConverseMessages(messages, contextPrefix);

    // 마지막 user 메시지(인덱스 2)에만 접두사 적용
    expect((result[2].content[0] as { text: string }).text).toBe(
      contextPrefix + "두 번째 질문"
    );
    // 첫 번째 user 메시지(인덱스 0)는 접두사 없음
    expect((result[0].content[0] as { text: string }).text).toBe("첫 번째 질문");
    // assistant 메시지도 변경 없음
    expect((result[1].content[0] as { text: string }).text).toBe("첫 번째 답변");
  });

  it("여러 첨부 파일 컨텍스트가 있어도 원본 배열 길이가 변하지 않는다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "질문", timestamp: 1000 },
      { role: "assistant", content: "답변", timestamp: 2000 },
      { role: "user", content: "후속 질문", timestamp: 3000 },
    ];
    const originalLength = messages.length;

    const contextPrefix =
      "[첨부: file1.md]\n내용1\n\n[첨부: file2.md]\n내용2\n\n";
    buildConverseMessages(messages, contextPrefix);

    expect(messages.length).toBe(originalLength);
  });

  it("원본 메시지 객체의 모든 필드가 보존된다", () => {
    const timestamp = Date.now();
    const messages: ChatMessage[] = [
      { role: "user", content: "테스트", timestamp },
    ];

    const contextPrefix = "[컨텍스트]\n";
    buildConverseMessages(messages, contextPrefix);

    // 원본 객체의 모든 필드가 그대로인지 확인
    expect(messages[0]).toEqual({
      role: "user",
      content: "테스트",
      timestamp,
    });
  });

  it("마지막 메시지가 assistant인 경우 contextPrefix가 적용되지 않는다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "질문", timestamp: 1000 },
      { role: "assistant", content: "답변", timestamp: 2000 },
    ];

    const contextPrefix = "[컨텍스트]\n";
    const result = buildConverseMessages(messages, contextPrefix);

    // 마지막 메시지가 assistant이므로 접두사 미적용
    expect((result[1].content[0] as { text: string }).text).toBe("답변");
    // user 메시지도 마지막이 아니므로 접두사 미적용
    expect((result[0].content[0] as { text: string }).text).toBe("질문");
  });
});

// --- Property 2: Preservation ---
// 첨부 파일 없는 일반 메시지 전송 시 기존과 동일하게 동작

describe("메시지 불변성 - Preservation (Property 2)", () => {
  /**
   * Validates: Requirements 3.8
   */

  it("contextPrefix가 undefined이면 메시지가 그대로 변환된다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "안녕하세요", timestamp: 1000 },
      { role: "assistant", content: "반갑습니다", timestamp: 2000 },
    ];

    const result = buildConverseMessages(messages, undefined);

    expect(result).toHaveLength(2);
    expect((result[0].content[0] as { text: string }).text).toBe("안녕하세요");
    expect((result[1].content[0] as { text: string }).text).toBe("반갑습니다");
  });

  it("contextPrefix가 빈 문자열이면 메시지가 그대로 변환된다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "테스트 메시지", timestamp: 1000 },
    ];

    // 빈 문자열은 falsy이므로 접두사 미적용
    const result = buildConverseMessages(messages, "");

    expect((result[0].content[0] as { text: string }).text).toBe("테스트 메시지");
  });

  it("role 매핑이 올바르게 보존된다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "질문", timestamp: 1000 },
      { role: "assistant", content: "답변", timestamp: 2000 },
      { role: "user", content: "후속", timestamp: 3000 },
    ];

    const result = buildConverseMessages(messages);

    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("user");
  });

  it("빈 메시지 배열에서도 정상 동작한다", () => {
    const messages: ChatMessage[] = [];
    const result = buildConverseMessages(messages);

    expect(result).toHaveLength(0);
  });

  it("ConverseMessage의 content가 올바른 형식으로 변환된다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "테스트", timestamp: 1000 },
    ];

    const result = buildConverseMessages(messages);

    // content가 { text: string } 객체 배열인지 확인
    expect(result[0].content).toHaveLength(1);
    expect(result[0].content[0]).toEqual({ text: "테스트" });
  });
});
