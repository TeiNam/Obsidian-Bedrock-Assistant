import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

import { GeminiClient } from "./gemini-client";
import { BedrockClient } from "./bedrock-client";
import { DEFAULT_SETTINGS, type ConverseMessage, type ConverseResult } from "./types";

const messages: ConverseMessage[] = [{ role: "user", content: [{ type: "text", text: "안녕" }] }];
const fallbackResult: ConverseResult = { contentBlocks: [], stopReason: "end_turn" };

describe("스트리밍 실패 폴백", () => {
  it("Gemini는 텍스트 노출 전 실패하면 비스트리밍으로 재시도한다", async () => {
    const client = new GeminiClient({ ...DEFAULT_SETTINGS, chatModel: "gemini-test" });
    (client as any).streamGenerate = vi.fn().mockRejectedValue(new Error("연결 실패"));
    (client as any).nonStreamGenerate = vi.fn().mockResolvedValue(fallbackResult);

    await expect(client.converse(messages)).resolves.toBe(fallbackResult);
    expect((client as any).nonStreamGenerate).toHaveBeenCalledOnce();
  });

  it("Gemini는 일부 텍스트를 노출한 뒤 실패하면 전체 응답을 중복 요청하지 않는다", async () => {
    const client = new GeminiClient({ ...DEFAULT_SETTINGS, chatModel: "gemini-test" });
    const fallback = vi.fn();
    (client as any).streamGenerate = vi.fn(
      async (_model: string, _body: unknown, emit: (text: string) => void) => {
        emit("부분");
        throw new Error("스트림 끊김");
      }
    );
    (client as any).nonStreamGenerate = fallback;

    await expect(client.converse(messages, undefined, vi.fn())).rejects.toThrow("스트림 끊김");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("Bedrock은 텍스트 노출 전 실패하면 일반 호출로 재시도한다", async () => {
    const client = new BedrockClient({
      ...DEFAULT_SETTINGS,
      bedrockChatModel: "anthropic.claude-test",
    });
    (client as any).converseStream = vi.fn().mockRejectedValue(new Error("연결 실패"));
    (client as any).converseFallback = vi.fn().mockResolvedValue(fallbackResult);

    await expect(client.converse(messages)).resolves.toBe(fallbackResult);
    expect((client as any).converseFallback).toHaveBeenCalledOnce();
  });

  it("Bedrock은 일부 텍스트를 노출한 뒤 실패하면 전체 응답을 중복 요청하지 않는다", async () => {
    const client = new BedrockClient({
      ...DEFAULT_SETTINGS,
      bedrockChatModel: "anthropic.claude-test",
    });
    const fallback = vi.fn();
    (client as any).converseStream = vi.fn(
      async (_input: unknown, emit: (text: string) => void) => {
        emit("부분");
        throw new Error("스트림 끊김");
      }
    );
    (client as any).converseFallback = fallback;

    await expect(client.converse(messages, undefined, vi.fn())).rejects.toThrow("스트림 끊김");
    expect(fallback).not.toHaveBeenCalled();
  });
});
