import { describe, it, expect } from "vitest";
import { prepareRegeneration } from "./regenerate-helper";
import type { ChatMessage } from "./types";

describe("prepareRegeneration", () => {
  it("마지막 어시스턴트 메시지를 제거한 배열을 반환한다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "안녕", timestamp: 1 },
      { role: "assistant", content: "안녕하세요!", timestamp: 2 },
    ];

    const result = prepareRegeneration(messages);

    expect(result).toEqual([{ role: "user", content: "안녕", timestamp: 1 }]);
  });

  it("빈 배열이면 null을 반환한다", () => {
    const result = prepareRegeneration([]);
    expect(result).toBeNull();
  });

  it("마지막 메시지가 user이면 null을 반환한다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "안녕", timestamp: 1 },
      { role: "assistant", content: "응답", timestamp: 2 },
      { role: "user", content: "다음 질문", timestamp: 3 },
    ];

    const result = prepareRegeneration(messages);
    expect(result).toBeNull();
  });

  it("원본 배열을 변경하지 않는다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "질문", timestamp: 1 },
      { role: "assistant", content: "답변", timestamp: 2 },
    ];

    const original = [...messages];
    prepareRegeneration(messages);

    expect(messages).toEqual(original);
  });

  it("여러 라운드의 대화에서 마지막 어시스턴트만 제거한다", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "첫 질문", timestamp: 1 },
      { role: "assistant", content: "첫 답변", timestamp: 2 },
      { role: "user", content: "두번째 질문", timestamp: 3 },
      { role: "assistant", content: "두번째 답변", timestamp: 4 },
    ];

    const result = prepareRegeneration(messages);

    expect(result).toHaveLength(3);
    expect(result![result!.length - 1]).toEqual({
      role: "user",
      content: "두번째 질문",
      timestamp: 3,
    });
  });
});
