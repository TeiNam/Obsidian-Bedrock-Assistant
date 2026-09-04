import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_SETTINGS, GeminiAssistantSettings } from "./types";

// ============================================
// obsidian.requestUrl 모킹
// ============================================
// 비스트리밍 호출(converseLight/getEmbedding/listModels)은 Obsidian requestUrl을 사용한다.
// vi.hoisted로 모킹 함수를 끌어올려 vi.mock 팩토리에서 참조한다.
const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: requestUrlMock }));

// 모킹 후 클라이언트 import
import { OpenAIClient } from "./openai-client";
import { NOTICE_I18N } from "./notice-i18n";

/** 정규식 메타문자를 이스케이프한다. i18n 문구를 부분 일치로 검증하기 위해 쓴다. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================
// 테스트 헬퍼
// ============================================

// 기본 설정에 OpenAI 필드를 채운 설정 객체를 생성한다.
function makeSettings(
  overrides: Partial<GeminiAssistantSettings> = {}
): GeminiAssistantSettings {
  return {
    ...DEFAULT_SETTINGS,
    aiBackend: "openai",
    openaiApiKey: "sk-test-secret-key-123",
    openaiChatModel: "gpt-5.1",
    openaiEmbeddingModel: "text-embedding-3-large",
    openaiBaseUrl: "",
    maxTokens: 4096,
    effort: "medium",
    ...overrides,
  };
}

// SSE 청크 배열을 본문으로 전달하는 fetch Response 스텁을 만든다.
// 모든 청크를 미리 enqueue한 뒤 닫으므로 reader.read()가 순차적으로 반환한다.
function makeStreamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => "",
    body: stream,
  } as unknown as Response;
}

// 일부 청크를 보낸 뒤 스트림 도중 오류를 발생시키는 Response 스텁.
function makeErroringStreamResponse(
  okChunks: string[],
  error: Error
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of okChunks) controller.enqueue(encoder.encode(c));
      // 정상 청크 이후 오류로 스트림을 종료한다(Req 4.7).
      controller.error(error);
    },
  });
  return {
    ok: true,
    status: 200,
    text: async () => "",
    body: stream,
  } as unknown as Response;
}

// SSE data: 라인 한 줄을 만든다.
function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n`;
}

beforeEach(() => {
  requestUrlMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ============================================
// converse: 스트리밍 (mock fetch SSE)
// ============================================

describe("OpenAIClient.converse 스트리밍", () => {
  it("onTextDelta를 수신 순서대로 전달하고 텍스트 블록으로 병합한다 (Req 4.2, 4.3)", async () => {
    const chunks = [
      sse({ choices: [{ delta: { content: "Hello" } }] }),
      sse({ choices: [{ delta: { content: ", " } }] }),
      sse({ choices: [{ delta: { content: "world" } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n",
    ];
    const fetchMock = vi.fn().mockResolvedValue(makeStreamResponse(chunks));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAIClient(makeSettings());
    const deltas: string[] = [];
    const result = await client.converse([], undefined, (d) => deltas.push(d));

    expect(deltas).toEqual(["Hello", ", ", "world"]);
    expect(result.contentBlocks).toEqual([{ type: "text", text: "Hello, world" }]);
    expect(result.stopReason).toBe("end_turn");
  });

  it("텍스트와 도구 호출을 병합하고 stopReason을 'tool_use'로 설정한다 (Req 4.4, 5.5)", async () => {
    const chunks = [
      sse({ choices: [{ delta: { content: "calling tool" } }] }),
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "get_weather", arguments: "" },
                },
              ],
            },
          },
        ],
      }),
      sse({
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] },
          },
        ],
      }),
      sse({
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: '"NYC"}' } }] },
          },
        ],
      }),
      sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      "data: [DONE]\n",
    ];
    const fetchMock = vi.fn().mockResolvedValue(makeStreamResponse(chunks));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAIClient(makeSettings());
    const result = await client.converse([]);

    expect(result.stopReason).toBe("tool_use");
    // 텍스트 블록 + tool_use 블록을 모두 포함한다.
    const textBlock = result.contentBlocks.find((b) => b.type === "text");
    const toolBlock = result.contentBlocks.find((b) => b.type === "tool_use");
    expect(textBlock).toEqual({ type: "text", text: "calling tool" });
    expect(toolBlock).toMatchObject({
      type: "tool_use",
      toolUseId: "call_1",
      name: "get_weather",
      input: { city: "NYC" },
    });
  });

  it("도구 없이 종료하면 stopReason은 'end_turn'이다 (Req 4.5)", async () => {
    const chunks = [
      sse({ choices: [{ delta: { content: "done" } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n",
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamResponse(chunks)));

    const client = new OpenAIClient(makeSettings());
    const result = await client.converse([]);

    expect(result.stopReason).toBe("end_turn");
    expect(result.contentBlocks).toEqual([{ type: "text", text: "done" }]);
  });

  it("텍스트·도구가 모두 없는 빈 응답은 contentBlocks=[]를 반환한다 (Req 4.8)", async () => {
    const chunks = [
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n",
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamResponse(chunks)));

    const client = new OpenAIClient(makeSettings());
    const result = await client.converse([]);

    expect(result.contentBlocks).toEqual([]);
    expect(result.stopReason).toBe("end_turn");
  });

  it("스트림 도중 오류는 부분 응답을 정상 반환하지 않고 전파한다 (Req 4.7)", async () => {
    const chunks = [sse({ choices: [{ delta: { content: "partial" } }] })];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeErroringStreamResponse(chunks, new Error("stream broke"))
      )
    );

    const client = new OpenAIClient(makeSettings());
    await expect(client.converse([])).rejects.toThrow("stream broke");
  });

  it("HTTP 오류 응답(401)은 식별 가능한 오류로 전파하고 키 원문을 노출하지 않는다 (Req 4.7, 10.3, 10.4)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
      body: null,
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const secret = "sk-super-secret-999";
    const client = new OpenAIClient(makeSettings({ openaiApiKey: secret }));
    await expect(client.converse([])).rejects.toThrow(/401/);
    await expect(
      client.converse([]).catch((e: Error) => {
        expect(e.message).not.toContain(secret);
        throw e;
      })
    ).rejects.toThrow();
  });
});

// ============================================
// converse: abort 처리
// ============================================

describe("OpenAIClient.converse abort 처리", () => {
  it("사전 abort 시 요청을 전송하지 않고 예외 없이 빈 부분 결과를 반환한다 (Req 9.1)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    controller.abort();

    const client = new OpenAIClient(makeSettings());
    const result = await client.converse([], undefined, undefined, controller.signal);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.contentBlocks).toEqual([]);
    expect(result.stopReason).toBe("end_turn");
  });

  it("스트림 도중 abort 시 reader.cancel 후 부분 텍스트를 보존하며 정상 종료한다 (Req 9.2~9.4)", async () => {
    const controller = new AbortController();
    let cancelled = false;

    const encoder = new TextEncoder();
    // 첫 청크 수신 후 abort 되면 다음 루프 진입 시 reader.cancel이 호출된다.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(sse({ choices: [{ delta: { content: "first" } }] })));
        c.enqueue(encoder.encode(sse({ choices: [{ delta: { content: "second" } }] })));
        c.enqueue(encoder.encode("data: [DONE]\n"));
        c.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = {
      ok: true,
      status: 200,
      text: async () => "",
      body: stream,
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const client = new OpenAIClient(makeSettings());
    // 첫 델타 수신 시점에 abort 한다.
    const result = await client.converse(
      [],
      undefined,
      (d) => {
        if (d === "first") controller.abort();
      },
      controller.signal
    );

    expect(cancelled).toBe(true);
    expect(result.stopReason).toBe("end_turn");
    // 부분 텍스트(최소한 첫 델타)는 보존된다.
    const textBlock = result.contentBlocks.find((b) => b.type === "text");
    expect(textBlock && (textBlock as { text: string }).text).toContain("first");
  });
});

// ============================================
// getEmbedding (mock requestUrl)
// ============================================

describe("OpenAIClient.getEmbedding", () => {
  it("정상 입력에 길이 1 이상의 유한한 벡터를 반환한다 (Req 6.1)", async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: { data: [{ embedding: [0.1, -0.2, 0.3] }] },
      text: "",
    });

    const client = new OpenAIClient(makeSettings());
    const vec = await client.getEmbedding("hello");

    expect(vec).toEqual([0.1, -0.2, 0.3]);
    expect(vec.length).toBeGreaterThanOrEqual(1);
    expect(vec.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("빈/공백 입력은 요청 없이 오류를 반환한다 (Req 6.4)", async () => {
    const client = new OpenAIClient(makeSettings());
    await expect(client.getEmbedding("")).rejects.toThrow();
    await expect(client.getEmbedding("   ")).rejects.toThrow();
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("임베딩 모델 ID가 빈 문자열이면 요청 없이 오류를 반환한다 (Req 6.5)", async () => {
    const client = new OpenAIClient(makeSettings({ openaiEmbeddingModel: "" }));
    await expect(client.getEmbedding("hello")).rejects.toThrow();
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("요청 실패(500)는 식별 가능한 오류를 반환한다 (Req 6.6)", async () => {
    requestUrlMock.mockResolvedValue({
      status: 500,
      json: {},
      text: "Internal Server Error",
    });
    const client = new OpenAIClient(makeSettings());
    await expect(client.getEmbedding("hello")).rejects.toThrow(/500/);
  });
});

// ============================================
// listModels (mock requestUrl)
// ============================================

describe("OpenAIClient.listModels", () => {
  const modelsResponse = {
    status: 200,
    json: {
      data: [
        { id: "gpt-5.5" },
        { id: "gpt-5.4" },
        { id: "gpt-5.4-mini" },
        { id: "gpt-5.1" },
        { id: "gpt-4o" },
        { id: "text-embedding-3-large" },
        { id: "text-embedding-3-small" },
      ],
    },
    text: "",
  };

  it("kind='chat'은 gpt-5.4/5.5 계열 채팅 모델만 완전한 필드로 반환한다 (Req 7.1, 7.3)", async () => {
    requestUrlMock.mockResolvedValue(modelsResponse);
    const client = new OpenAIClient(makeSettings());
    const models = await client.listModels("chat");

    // gpt-5.4 / gpt-5.5 계열만 포함(내림차순 정렬), 그 외(gpt-5.1/gpt-4o/임베딩)는 제외
    expect(models.map((m) => m.modelId)).toEqual([
      "gpt-5.5",
      "gpt-5.4-mini",
      "gpt-5.4",
    ]);
    for (const m of models) {
      expect(m.modelId).not.toBe("");
      expect(m.modelName).not.toBe("");
      expect(m.provider).toBe("openai");
      expect(typeof m.isProfile).toBe("boolean");
    }
  });

  it("kind='embedding'은 임베딩 모델만 필터링하여 반환한다 (Req 7.2, 7.4)", async () => {
    requestUrlMock.mockResolvedValue(modelsResponse);
    const client = new OpenAIClient(makeSettings());
    const models = await client.listModels("embedding");

    expect(models.map((m) => m.modelId)).toEqual([
      "text-embedding-3-large",
      "text-embedding-3-small",
    ]);
    expect(models.every((m) => m.modelId.includes("embedding"))).toBe(true);
  });

  it("10초 이내 응답이 없으면 시간 초과 오류를 반환한다 (Req 7.7)", async () => {
    vi.useFakeTimers();
    // 영원히 resolve되지 않는 응답으로 타임아웃 경로를 강제한다.
    requestUrlMock.mockReturnValue(new Promise(() => {}));
    const client = new OpenAIClient(makeSettings());

    const p = client.listModels("chat");
    // 거부를 사전에 핸들링하여 unhandled rejection을 방지한다.
    const assertion = expect(p).rejects.toThrow(new RegExp(escapeRegExp(NOTICE_I18N.en.errTimeout("OpenAI", 0).replace(" after 0s.", ""))));
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
  });

  it("조회 실패(403)는 식별 가능한 오류를 반환한다 (Req 7.8 — 구현은 빈 배열 대신 오류 throw, Req 7.8 허용 범위)", async () => {
    requestUrlMock.mockResolvedValue({ status: 403, json: {}, text: "Forbidden" });
    const client = new OpenAIClient(makeSettings());
    await expect(client.listModels("chat")).rejects.toThrow(/403/);
  });
});

// ============================================
// converseLight (mock requestUrl)
// ============================================

describe("OpenAIClient.converseLight", () => {
  it("{ text }를 반환한다 (Req 8.1)", async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: { choices: [{ message: { content: "분류 결과" } }] },
      text: "",
    });
    const client = new OpenAIClient(makeSettings());
    const result = await client.converseLight("prompt", "system");
    expect(result).toEqual({ text: "분류 결과" });
  });

  it("maxTokens 인자를 적용하고, 미지정 시 기본 1024를 적용한다 (Req 8.2, 8.3)", async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: { choices: [{ message: { content: "ok" } }] },
      text: "",
    });
    const client = new OpenAIClient(makeSettings());

    // 기본 픽스처 모델(gpt-5.1)은 추론 모델이므로 max_completion_tokens를 사용한다.
    // (추론 모델은 max_tokens를 거부한다)
    await client.converseLight("p", "s", 256);
    const body1 = JSON.parse(requestUrlMock.mock.calls[0][0].body);
    expect(body1.max_completion_tokens).toBe(256);
    expect(body1.max_tokens).toBeUndefined();

    await client.converseLight("p", "s");
    const body2 = JSON.parse(requestUrlMock.mock.calls[1][0].body);
    expect(body2.max_completion_tokens).toBe(1024);
  });

  it("비추론 모델에는 기존 max_tokens를 사용한다", async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: { choices: [{ message: { content: "ok" } }] },
      text: "",
    });
    const client = new OpenAIClient(makeSettings({ openaiChatModel: "gpt-4o" }));

    await client.converseLight("p", "s", 256);
    const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
    expect(body.max_tokens).toBe(256);
    expect(body.max_completion_tokens).toBeUndefined();
    // 비추론 모델에는 reasoning_effort도 실리지 않는다
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("응답 텍스트가 없거나 공백이면 오류를 반환한다 (Req 8.5)", async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: { choices: [{ message: { content: "   " } }] },
      text: "",
    });
    const client = new OpenAIClient(makeSettings());
    await expect(client.converseLight("p", "s")).rejects.toThrow();
  });
});

// ============================================
// 오류 분기 (키 누락 / 상태코드 식별 / 네트워크·타임아웃 / 키 미노출)
// ============================================

describe("OpenAIClient 오류 분기", () => {
  it("빈 API 키면 요청을 전송하지 않고 자격증명 누락 오류를 반환한다 (Req 10.1)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenAIClient(makeSettings({ openaiApiKey: "" }));

    await expect(client.converse([])).rejects.toThrow();
    await expect(client.getEmbedding("hi")).rejects.toThrow();
    await expect(client.converseLight("p", "s")).rejects.toThrow();
    await expect(client.listModels("chat")).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("429(요청 한도 초과)를 재시도 없이 즉시 식별 가능한 오류로 반환한다 (Req 10.3.1)", async () => {
    requestUrlMock.mockResolvedValue({ status: 429, json: {}, text: "rate limited" });
    const client = new OpenAIClient(makeSettings());
    await expect(client.converseLight("p", "s")).rejects.toThrow(/429/);
    // 재시도/백오프 없이 단 1회만 호출한다.
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("404(모델 미존재)를 식별 가능한 오류로 반환한다 (Req 10.3)", async () => {
    requestUrlMock.mockResolvedValue({ status: 404, json: {}, text: "not found" });
    const client = new OpenAIClient(makeSettings());
    await expect(client.getEmbedding("hi")).rejects.toThrow(/404/);
  });

  it("네트워크 오류와 타임아웃 오류를 구별 가능한 메시지로 반환한다 (Req 10.6)", async () => {
    // 네트워크 오류: requestUrl이 거부 → 원본 오류 전파(공급자 상태코드 메시지가 아님).
    requestUrlMock.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_REFUSED"));
    const client = new OpenAIClient(makeSettings());
    await expect(client.converseLight("p", "s")).rejects.toThrow(
      /ERR_CONNECTION_REFUSED/
    );

    // 타임아웃 오류: 60초 경과 → "시간 초과" 메시지.
    vi.useFakeTimers();
    requestUrlMock.mockReturnValue(new Promise(() => {}));
    const p = client.getEmbedding("hi");
    const assertion = expect(p).rejects.toThrow(new RegExp(escapeRegExp(NOTICE_I18N.en.errTimeout("OpenAI", 0).replace(" after 0s.", ""))));
    await vi.advanceTimersByTimeAsync(60000);
    await assertion;
  });

  it("오류 메시지에 API 키 원문을 포함하지 않는다 (Req 10.4)", async () => {
    const secret = "sk-leak-me-if-you-can";
    requestUrlMock.mockResolvedValue({ status: 401, json: {}, text: "Unauthorized" });
    const client = new OpenAIClient(makeSettings({ openaiApiKey: secret }));

    try {
      await client.getEmbedding("hi");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/401/);
      expect((e as Error).message).not.toContain(secret);
    }
  });
});
