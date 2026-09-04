import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_SETTINGS, GeminiAssistantSettings } from "./types";

// ============================================
// obsidian.requestUrl 모킹
// ============================================
// 비스트리밍 호출(converseLight/getEmbedding/listModels)은 obsidian의 requestUrl을 사용한다.
// vi.hoisted로 끌어올린 mock 함수를 vi.mock 팩토리에서 노출하여 테스트에서 제어한다.
const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock("obsidian", () => ({
	requestUrl: requestUrlMock,
}));

// 모킹 후 구현체 import
import { OllamaClient } from "./ollama-client";
import { NOTICE_I18N } from "./notice-i18n";

/** 정규식 메타문자를 이스케이프한다. i18n 문구를 부분 일치로 검증하기 위해 쓴다. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================
// 테스트 헬퍼
// ============================================

/** 기본 Ollama 설정 (필요 필드만 덮어쓴다) */
function makeSettings(
	overrides: Partial<GeminiAssistantSettings> = {}
): GeminiAssistantSettings {
	return {
		...DEFAULT_SETTINGS,
		aiBackend: "ollama",
		ollamaBaseUrl: "http://localhost:11434",
		ollamaChatModel: "llama4",
		ollamaEmbeddingModel: "nomic-embed-text",
		systemPrompt: "SYS",
		enabledSkills: [],
		maxTokens: 2048,
		effort: "medium",
		...overrides,
	};
}

/**
 * NDJSON 스트리밍 fetch 응답을 모방한다.
 * chunks 배열의 각 문자열을 개별 스트림 청크로 enqueue하여 reader.read()가
 * 청크 단위로 반환하도록 한다(스트림 중 abort 검증에 활용).
 */
function makeStreamResponse(
	chunks: string[],
	opts: { ok?: boolean; status?: number; bodyText?: string } = {}
): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
	return {
		ok: opts.ok ?? true,
		status: opts.status ?? 200,
		body: stream,
		text: async () => opts.bodyText ?? "",
	} as unknown as Response;
}

/** 한 줄(JSON) → NDJSON 라인 문자열 */
function ndjsonLine(obj: unknown): string {
	return JSON.stringify(obj) + "\n";
}

describe("OllamaClient", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ============================================
	// converse (스트리밍, NDJSON)
	// ============================================
	describe("converse (스트리밍)", () => {
		it("onTextDelta가 청크 순서대로 호출되고 전체 텍스트가 누적된다", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(
					makeStreamResponse([
						ndjsonLine({ message: { content: "He" } }),
						ndjsonLine({ message: { content: "llo" } }),
						ndjsonLine({ done: true, done_reason: "stop" }),
					])
				);
			vi.stubGlobal("fetch", fetchMock);

			const client = new OllamaClient(makeSettings());
			const deltas: string[] = [];
			const result = await client.converse([], [], (d) => deltas.push(d));

			expect(deltas).toEqual(["He", "llo"]);
			expect(result.contentBlocks).toEqual([{ type: "text", text: "Hello" }]);
			expect(result.stopReason).toBe("end_turn");
			// 엔드포인트는 base + /api/chat
			expect(fetchMock.mock.calls[0][0]).toBe(
				"http://localhost:11434/api/chat"
			);
		});

		it("텍스트와 도구 호출이 병합되고 stopReason이 'tool_use'가 된다", async () => {
			const fetchMock = vi.fn().mockResolvedValue(
				makeStreamResponse([
					ndjsonLine({ message: { content: "검색합니다" } }),
					ndjsonLine({
						message: {
							tool_calls: [
								{ function: { name: "search", arguments: { q: "x" } } },
							],
						},
					}),
					// done_reason이 stop이어도 도구 호출이 있으면 tool_use로 매핑
					ndjsonLine({ done: true, done_reason: "stop" }),
				])
			);
			vi.stubGlobal("fetch", fetchMock);

			const client = new OllamaClient(makeSettings());
			const result = await client.converse([], []);

			expect(result.stopReason).toBe("tool_use");
			// 텍스트 블록이 먼저, 도구 블록이 뒤에 온다
			expect(result.contentBlocks[0]).toEqual({
				type: "text",
				text: "검색합니다",
			});
			const toolBlock = result.contentBlocks[1] as {
				type: string;
				name: string;
				input: unknown;
				toolUseId: string;
			};
			expect(toolBlock.type).toBe("tool_use");
			expect(toolBlock.name).toBe("search");
			expect(toolBlock.input).toEqual({ q: "x" });
			// ID 미제공 시 생성되어 비어 있지 않아야 한다
			expect(toolBlock.toolUseId).toBeTruthy();
		});

		it("도구 호출이 없으면 stopReason이 'end_turn'이다", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(
					makeStreamResponse([
						ndjsonLine({ message: { content: "답변" } }),
						ndjsonLine({ done: true, done_reason: "stop" }),
					])
				);
			vi.stubGlobal("fetch", fetchMock);

			const client = new OllamaClient(makeSettings());
			const result = await client.converse([], []);

			expect(result.stopReason).toBe("end_turn");
			expect(result.contentBlocks).toEqual([{ type: "text", text: "답변" }]);
		});

		it("빈 응답이면 contentBlocks가 빈 배열이고 stopReason은 'end_turn'이다", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(makeStreamResponse([ndjsonLine({ done: true })]));
			vi.stubGlobal("fetch", fetchMock);

			const client = new OllamaClient(makeSettings());
			const result = await client.converse([], []);

			expect(result.contentBlocks).toEqual([]);
			expect(result.stopReason).toBe("end_turn");
		});

		it("스트림 중 JSON 파싱 오류가 전파된다", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(makeStreamResponse(["{ broken json\n"]));
			vi.stubGlobal("fetch", fetchMock);

			const client = new OllamaClient(makeSettings());
			await expect(client.converse([], [])).rejects.toThrow(
				new RegExp(escapeRegExp(NOTICE_I18N.en.errStreamParseFailed("Ollama", "")))
			);
		});

		it("응답이 ok가 아니면 HTTP 상태를 포함한 오류를 던진다", async () => {
			const fetchMock = vi.fn().mockResolvedValue(
				makeStreamResponse([], { ok: false, status: 404, bodyText: "not found" })
			);
			vi.stubGlobal("fetch", fetchMock);

			const client = new OllamaClient(makeSettings());
			await expect(client.converse([], [])).rejects.toThrow(/HTTP 404/);
		});
	});

	// ============================================
	// converse - 서버 미접속 / abort
	// ============================================
	describe("converse (연결 오류 및 abort)", () => {
		it("fetch 실패(연결 불가) 시 서버 미접속 식별 오류를 던진다", async () => {
			const fetchMock = vi
				.fn()
				.mockRejectedValue(new Error("ECONNREFUSED"));
			vi.stubGlobal("fetch", fetchMock);

			const client = new OllamaClient(makeSettings());
			await expect(client.converse([], [])).rejects.toThrow(
				new RegExp(escapeRegExp(NOTICE_I18N.en.errServerUnreachable("Ollama", "http://localhost:11434")))
			);
		});

		it("진입 시 이미 abort된 경우 요청을 보내지 않고 빈 결과를 반환한다", async () => {
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);

			const controller = new AbortController();
			controller.abort();

			const client = new OllamaClient(makeSettings());
			const result = await client.converse(
				[],
				[],
				undefined,
				controller.signal
			);

			expect(result).toEqual({ contentBlocks: [], stopReason: "end_turn" });
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("스트림 중 abort되면 처리를 멈추고 부분 텍스트를 보존한다(예외 미전파)", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(
					makeStreamResponse([
						ndjsonLine({ message: { content: "첫번째" } }),
						ndjsonLine({ message: { content: "두번째" } }),
						ndjsonLine({ done: true, done_reason: "stop" }),
					])
				);
			vi.stubGlobal("fetch", fetchMock);

			const controller = new AbortController();
			const deltas: string[] = [];
			// 첫 청크 수신 직후 abort → 다음 루프 진입 시 reader.cancel + break
			const onDelta = (d: string) => {
				deltas.push(d);
				controller.abort();
			};

			const client = new OllamaClient(makeSettings());
			const result = await client.converse(
				[],
				[],
				onDelta,
				controller.signal
			);

			// 첫 청크만 처리되어야 한다
			expect(deltas).toEqual(["첫번째"]);
			expect(result.contentBlocks).toEqual([
				{ type: "text", text: "첫번째" },
			]);
		});
	});

	// ============================================
	// getEmbedding
	// ============================================
	describe("getEmbedding", () => {
		it("정상 응답 시 벡터를 반환한다", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: { embedding: [0.1, 0.2, 0.3] },
			});

			const client = new OllamaClient(makeSettings());
			const vec = await client.getEmbedding("hello");

			expect(vec).toEqual([0.1, 0.2, 0.3]);
			// api/embeddings 엔드포인트로 model+prompt 전송
			const opts = requestUrlMock.mock.calls[0][0];
			expect(opts.url).toBe("http://localhost:11434/api/embeddings");
			const body = JSON.parse(opts.body);
			expect(body.model).toBe("nomic-embed-text");
			expect(body.prompt).toBe("hello");
		});

		it("빈/공백 입력은 요청 없이 오류를 던진다", async () => {
			const client = new OllamaClient(makeSettings());
			await expect(client.getEmbedding("   ")).rejects.toThrow(
				NOTICE_I18N.en.errEmptyEmbeddingInput
			);
			expect(requestUrlMock).not.toHaveBeenCalled();
		});

		it("임베딩 모델 ID가 비어 있으면 요청 없이 오류를 던진다", async () => {
			const client = new OllamaClient(
				makeSettings({ ollamaEmbeddingModel: "" })
			);
			await expect(client.getEmbedding("hello")).rejects.toThrow(
				NOTICE_I18N.en.errNoEmbeddingModel("Ollama")
			);
			expect(requestUrlMock).not.toHaveBeenCalled();
		});

		it("요청 실패(비2xx) 시 오류를 던진다", async () => {
			requestUrlMock.mockResolvedValue({ status: 500, json: {} });

			const client = new OllamaClient(makeSettings());
			await expect(client.getEmbedding("hello")).rejects.toThrow(
				NOTICE_I18N.en.errHttpStatus("Ollama", NOTICE_I18N.en.whatEmbedding, 500)
			);
		});

		it("응답에 벡터가 없으면 오류를 던진다", async () => {
			requestUrlMock.mockResolvedValue({ status: 200, json: { embedding: [] } });

			const client = new OllamaClient(makeSettings());
			await expect(client.getEmbedding("hello")).rejects.toThrow(
				NOTICE_I18N.en.errNoEmbeddingVector("Ollama")
			);
		});
	});

	// ============================================
	// listModels
	// ============================================
	describe("listModels", () => {
		it("kind='chat'은 api/tags 설치 모델을 ModelInfo로 매핑한다", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: { models: [{ name: "llama4" }, { model: "mistral" }] },
			});

			const client = new OllamaClient(makeSettings());
			const models = await client.listModels("chat");

			expect(models).toEqual([
				{
					modelId: "llama4",
					modelName: "llama4",
					provider: "ollama",
					isProfile: false,
				},
				{
					modelId: "mistral",
					modelName: "mistral",
					provider: "ollama",
					isProfile: false,
				},
			]);
		});

		it("kind='embedding'은 api/show capability로 임베딩 모델만 필터링한다", async () => {
			requestUrlMock.mockImplementation(
				async (opts: { url: string; body?: string }) => {
					if (opts.url.endsWith("/api/tags")) {
						return {
							status: 200,
							json: {
								models: [{ name: "nomic-embed-text" }, { name: "llama4" }],
							},
						};
					}
					// api/show: 모델별 capability 응답
					const body = JSON.parse(opts.body || "{}");
					const caps =
						body.model === "nomic-embed-text"
							? ["embedding"]
							: ["completion"];
					return { status: 200, json: { capabilities: caps } };
				}
			);

			const client = new OllamaClient(makeSettings());
			const models = await client.listModels("embedding");

			expect(models.map((m) => m.modelId)).toEqual(["nomic-embed-text"]);
		});

		it("capability 정보를 전혀 얻지 못하면 설치 모델 전체로 폴백한다", async () => {
			requestUrlMock.mockImplementation(
				async (opts: { url: string }) => {
					if (opts.url.endsWith("/api/tags")) {
						return {
							status: 200,
							json: { models: [{ name: "a" }, { name: "b" }] },
						};
					}
					// api/show 프로빙 전부 실패(비2xx)
					return { status: 500, json: {} };
				}
			);

			const client = new OllamaClient(makeSettings());
			const models = await client.listModels("embedding");

			expect(models.map((m) => m.modelId)).toEqual(["a", "b"]);
		});

		it("10초 내 응답이 없으면 빈 배열을 반환한다", async () => {
			vi.useFakeTimers();
			// 영원히 resolve되지 않는 요청
			requestUrlMock.mockReturnValue(new Promise(() => {}));

			const client = new OllamaClient(makeSettings());
			const p = client.listModels("chat");
			await vi.advanceTimersByTimeAsync(10000);
			const models = await p;

			expect(models).toEqual([]);
			vi.useRealTimers();
		});

		it("조회 실패 시 빈 배열을 반환한다", async () => {
			requestUrlMock.mockResolvedValue({ status: 500, json: {} });

			const client = new OllamaClient(makeSettings());
			const models = await client.listModels("chat");

			expect(models).toEqual([]);
		});
	});

	// ============================================
	// converseLight
	// ============================================
	describe("converseLight", () => {
		it("정상 응답에서 텍스트를 추출한다", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: { message: { content: "결과" } },
			});

			const client = new OllamaClient(makeSettings());
			const res = await client.converseLight("질문", "시스템");

			expect(res).toEqual({ text: "결과" });
			const opts = requestUrlMock.mock.calls[0][0];
			expect(opts.url).toBe("http://localhost:11434/api/chat");
			const body = JSON.parse(opts.body);
			expect(body.stream).toBe(false);
		});

		it("maxTokens 인자를 num_predict로 적용하고 기본값은 1024이다", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: { message: { content: "x" } },
			});

			const client = new OllamaClient(makeSettings());

			// 명시적 maxTokens
			await client.converseLight("q", "s", 256);
			let body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
			expect(body.options.num_predict).toBe(256);

			// 기본값(1024)
			requestUrlMock.mockClear();
			await client.converseLight("q", "s");
			body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
			expect(body.options.num_predict).toBe(1024);
		});

		it("텍스트가 없으면 오류를 던진다", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: { message: { content: "" } },
			});

			const client = new OllamaClient(makeSettings());
			await expect(client.converseLight("q", "s")).rejects.toThrow(
				NOTICE_I18N.en.errNoResponseText("Ollama")
			);
		});
	});

	// ============================================
	// base URL 폴백
	// ============================================
	describe("base URL 폴백", () => {
		it("ollamaBaseUrl이 빈 값이면 http://localhost:11434로 폴백한다", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: { embedding: [0.5] },
			});

			const client = new OllamaClient(makeSettings({ ollamaBaseUrl: "" }));
			await client.getEmbedding("hi");

			const opts = requestUrlMock.mock.calls[0][0];
			expect(opts.url).toBe("http://localhost:11434/api/embeddings");
		});
	});
});
