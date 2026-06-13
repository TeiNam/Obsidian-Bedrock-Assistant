import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
	normalizeBaseUrl,
	resolveBaseUrl,
	isValidBaseUrl,
	truncateForEmbedding,
	mapStopReason,
	filterEmbeddingModels,
	toOpenAITools,
	toOllamaTools,
	openAIToolCallsToBlocks,
	ollamaToolCallsToBlocks,
	generateToolUseId,
	toOpenAIMessages,
	toOllamaMessages,
	supportsTemperature,
} from "./provider-utils";
import type { ModelInfo, ToolDefinition, ConverseMessage } from "./types";

// ============================================
// 속성 기반 테스트: base URL 정규화/해석
// ============================================

describe("provider-utils base URL 정규화", () => {
	// Feature: multi-provider-ai-backends, Property 2: base URL 정규화 invariant
	it("Property 2: normalizeBaseUrl은 앞뒤 공백·후행 슬래시를 제거하고, resolveBaseUrl은 정규화 결과가 빈 문자열일 때 fallback을 반환한다", () => {
		// base URL의 실제 입력 공간을 반영한 "정제된 코어" 생성기.
		// URL-safe 문자만 사용하므로 앞뒤 공백·후행 슬래시를 포함하지 않는다.
		// (빈 문자열도 허용하여 fallback 분기를 함께 검증한다.)
		const cleanCore = fc.stringOf(
			fc.constantFrom(
				..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.:-_".split("")
			),
			{ maxLength: 30 }
		);
		// 앞뒤에 덧붙일 공백 문자(공백/탭/개행 등) — 임의 개수
		const whitespace = fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), {
			maxLength: 5,
		});
		// 후행에 덧붙일 슬래시(/) — 임의 개수
		const trailingSlashes = fc.stringOf(fc.constant("/"), { maxLength: 5 });

		fc.assert(
			fc.property(
				cleanCore,
				whitespace,
				whitespace,
				trailingSlashes,
				fc.string({ minLength: 1 }),
				(core, leading, trailing, slashes, fallback) => {
					// 정제된 코어에 앞뒤 공백과 후행 슬래시를 덧붙인 입력 구성
					const raw = `${leading}${core}${slashes}${trailing}`;

					const normalized = normalizeBaseUrl(raw);

					// invariant 1: 정규화 결과는 코어와 동일해야 한다(덧붙인 공백·슬래시 제거)
					expect(normalized).toBe(core);
					// invariant 2: 앞뒤 공백이 없어야 한다
					expect(normalized).toBe(normalized.trim());
					// invariant 3: 후행 슬래시로 끝나지 않아야 한다(빈 문자열 예외)
					if (normalized.length > 0) {
						expect(normalized.endsWith("/")).toBe(false);
					}

					// resolveBaseUrl: 정규화 결과가 빈 문자열이면 항상 fallback, 아니면 정규화값
					const resolved = resolveBaseUrl(raw, fallback);
					if (normalized === "") {
						expect(resolved).toBe(fallback);
					} else {
						expect(resolved).toBe(normalized);
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});

// ============================================
// 속성 기반 테스트: base URL 검증 술어
// ============================================

describe("provider-utils base URL 검증", () => {
	// Feature: multi-provider-ai-backends, Property 3: base URL 검증 술어
	it("Property 3: isValidBaseUrl은 정규화 후 빈 문자열이거나 http(s):// scheme으로 시작할 때만 true, 그 외 모든 scheme/형식에 false를 반환한다", () => {
		// --- 유효 케이스 생성기 ---
		// 정규화 후 빈 문자열이 되는 입력(공백/탭/개행 + 후행 슬래시만으로 구성).
		const emptyAfterNormalize = fc.tuple(
			fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), { maxLength: 5 }),
			fc.stringOf(fc.constant("/"), { maxLength: 5 }),
			fc.stringOf(fc.constantFrom(" ", "\t", "\n"), { maxLength: 5 })
		).map(([lead, slashes, trail]) => `${lead}${slashes}${trail}`);

		// http:// 또는 https:// scheme으로 시작하는 유효 URL.
		const hostPart = fc.stringOf(
			fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789.-".split("")),
			{ minLength: 1, maxLength: 20 }
		);
		const httpUrl = fc
			.tuple(fc.constantFrom("http", "https"), hostPart)
			.map(([scheme, host]) => `${scheme}://${host}`);

		// 유효 케이스 통합: 빈 문자열로 정규화되는 입력 또는 http(s) URL
		const validInput = fc.oneof(emptyAfterNormalize, httpUrl);

		// --- 무효 케이스 생성기 ---
		// http/https가 아닌 scheme을 가진 URL (ftp, ws, file, gopher 등).
		const invalidScheme = fc
			.tuple(
				fc.constantFrom("ftp", "ws", "wss", "file", "gopher", "ssh", "ftps", "data", "mailto"),
				hostPart
			)
			.map(([scheme, host]) => `${scheme}://${host}`);
		// scheme이 없는(://가 없는) 일반 문자열 형식.
		const noScheme = fc
			.stringOf(
				fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789.-".split("")),
				{ minLength: 1, maxLength: 20 }
			)
			.filter((s) => !/^https?:\/\//.test(s.trim().replace(/\/+$/, "")));
		// "http" 문자열을 포함하지만 scheme 위치가 아닌 형식 (예: "//http://x", "xhttp://x").
		const httpNotAtStart = hostPart.map((host) => `x-http://${host}`);

		const invalidInput = fc.oneof(invalidScheme, noScheme, httpNotAtStart);

		// 검증 1: 유효 케이스는 항상 true를 반환해야 한다.
		fc.assert(
			fc.property(validInput, (raw) => {
				expect(isValidBaseUrl(raw)).toBe(true);
			}),
			{ numRuns: 150 }
		);

		// 검증 2: 무효 케이스는 항상 false를 반환해야 한다.
		fc.assert(
			fc.property(invalidInput, (raw) => {
				expect(isValidBaseUrl(raw)).toBe(false);
			}),
			{ numRuns: 150 }
		);
	});
});

// ============================================
// 속성 기반 테스트: 임베딩 입력 절단
// ============================================

describe("provider-utils 임베딩 입력 절단", () => {
	// Feature: multi-provider-ai-backends, Property 10: 임베딩 입력 절단
	it("Property 10: truncateForEmbedding 결과는 길이가 maxChars 이하이고 입력의 접두사이며, 입력 길이가 maxChars 이하이면 입력을 그대로 반환한다", () => {
		// 텍스트 생성기: 빈 문자열·경계·긴 입력·유니코드를 모두 포함한다.
		//  - fc.string: 일반 ASCII 위주의 임의 문자열(빈 문자열 포함)
		//  - fc.unicodeString / fc.fullUnicodeString: 다국어·이모지 등 유니코드 포함
		//    (참고: JS의 .length/.slice는 UTF-16 코드 유닛 기준이므로 서로게이트 쌍이
		//     포함될 수 있으나, 접두사 검증은 result === input.slice(0, result.length)
		//     형태로 일관되게 작성하여 코드 유닛 기준에서 항상 성립한다.)
		//  - 긴 입력을 확실히 만들기 위해 maxLength를 크게 둔 생성기를 함께 사용
		const textArb = fc.oneof(
			fc.string(),
			fc.string({ maxLength: 500 }),
			fc.unicodeString(),
			fc.fullUnicodeString(),
			fc.fullUnicodeString({ maxLength: 500 })
		);

		// maxChars 생성기: 1 이상의 정수. 작은 값(경계 근처)부터 큰 값까지 폭넓게 생성.
		const maxCharsArb = fc.integer({ min: 1, max: 1000 });

		fc.assert(
			fc.property(textArb, maxCharsArb, (text, maxChars) => {
				const result = truncateForEmbedding(text, maxChars);

				// invariant 1: 결과 길이는 항상 maxChars 이하(UTF-16 코드 유닛 기준)
				expect(result.length).toBeLessThanOrEqual(maxChars);

				// invariant 2: 결과는 항상 입력의 접두사
				//   (코드 유닛 기준 일관성을 위해 result.length 만큼 slice하여 비교)
				expect(result).toBe(text.slice(0, result.length));

				// invariant 3: 입력 길이가 maxChars 이하이면 입력을 그대로 반환
				if (text.length <= maxChars) {
					expect(result).toBe(text);
				}
			}),
			{ numRuns: 200 }
		);
	});
});

// ============================================
// 속성 기반 테스트: stopReason 매핑
// ============================================

describe("provider-utils stopReason 매핑", () => {
	// Feature: multi-provider-ai-backends, Property 5: stopReason 매핑
	it("Property 5: 도구 호출 존재 시 항상 \"tool_use\", 미존재 시 stop/end_turn→\"end_turn\", length/max_tokens→\"max_tokens\", 그 외(임의 문자열/null)→\"end_turn\" 폴백으로 매핑한다", () => {
		// 종료 사유 원문 생성기:
		//  - 알려진 사유: "stop"/"end_turn"(→end_turn), "length"/"max_tokens"(→max_tokens)
		//  - 임의 문자열: 폴백 분기(end_turn) 검증
		//  - null: 폴백 분기(end_turn) 검증
		const knownEndTurn = fc.constantFrom("stop", "end_turn");
		const knownMaxTokens = fc.constantFrom("length", "max_tokens");
		const rawReasonArb = fc.oneof(
			knownEndTurn,
			knownMaxTokens,
			fc.string(), // 임의 문자열(알려지지 않은 사유 포함)
			fc.constant(null) // null 입력
		);

		// 도구 호출 존재 여부 boolean 조합
		const hasToolUseArb = fc.boolean();

		fc.assert(
			fc.property(rawReasonArb, hasToolUseArb, (rawReason, hasToolUse) => {
				const result = mapStopReason(rawReason, hasToolUse);

				if (hasToolUse) {
					// invariant 1: 도구 호출이 존재하면 종료 사유와 무관하게 항상 "tool_use"
					expect(result).toBe("tool_use");
				} else if (rawReason === "stop" || rawReason === "end_turn") {
					// invariant 2: stop/end_turn → "end_turn"
					expect(result).toBe("end_turn");
				} else if (rawReason === "length" || rawReason === "max_tokens") {
					// invariant 3: length/max_tokens → "max_tokens"
					expect(result).toBe("max_tokens");
				} else {
					// invariant 4: 그 외(임의 문자열/null) → "end_turn" 폴백
					expect(result).toBe("end_turn");
				}

				// 추가 invariant: 반환값은 항상 알려진 내부 값 집합에 속한다
				expect(["tool_use", "end_turn", "max_tokens"]).toContain(result);
			}),
			{ numRuns: 100 }
		);
	});
});

// ============================================
// 속성 기반 테스트: OpenAI 임베딩 모델 필터링
// ============================================

describe("provider-utils OpenAI 임베딩 모델 필터링", () => {
	// Feature: multi-provider-ai-backends, Property 11: OpenAI 임베딩 모델 필터링
	it("Property 11: filterEmbeddingModels 결과의 모든 항목은 modelId에 \"embedding\"을 포함하고, 입력에서 \"embedding\"을 포함하는 모든 항목이 결과에 정확히 보존된다", () => {
		// modelId 생성기: "embedding"을 포함하는 모델과 미포함 모델을 섞어서 생성한다.
		//  - 임베딩 모델: 임의 접두/접미 토큰 사이에 "embedding"을 삽입 (예: "text-embedding-3-large")
		//  - 채팅 모델: "embedding"을 포함하지 않도록 제한된 문자 집합으로 구성 (예: "gpt-5.1")
		// 임의 토큰(접두/접미)에 사용할 문자 집합. "embedding"이 우연히 생성되지 않도록
		// 일반 모델명 문자(영숫자/하이픈/점)만 사용한다.
		const tokenChars = "abcdfghijklnopqrstuvwxyz0123456789.-".split("");
		const tokenArb = fc.stringOf(fc.constantFrom(...tokenChars), { maxLength: 12 });

		// "embedding"을 포함하는 modelId (앞뒤에 임의 토큰을 붙여 다양화)
		const embeddingModelId = fc
			.tuple(tokenArb, tokenArb)
			.map(([prefix, suffix]) => `${prefix}embedding${suffix}`);

		// "embedding"을 포함하지 않는 modelId.
		// 채팅 모델 후보를 우선 사용하되, 임의 토큰도 "embedding" 미포함을 보장하기 위해 필터링한다.
		const nonEmbeddingModelId = fc.oneof(
			fc.constantFrom(
				"gpt-5.1",
				"gpt-4o",
				"gpt-4-turbo",
				"o1-preview",
				"chatgpt-4o-latest",
				"davinci-002"
			),
			tokenArb.filter((s) => !s.includes("embedding"))
		);

		// ModelInfo 생성기: 위 두 종류의 modelId를 무작위로 섞어 단일 항목을 만든다.
		const modelInfoArb: fc.Arbitrary<ModelInfo> = fc
			.tuple(
				fc.oneof(embeddingModelId, nonEmbeddingModelId),
				fc.string({ maxLength: 20 }),
				fc.constantFrom("openai", "ollama", "bedrock", "gemini"),
				fc.boolean()
			)
			.map(([modelId, modelName, provider, isProfile]) => ({
				modelId,
				modelName,
				provider,
				isProfile,
			}));

		// 임베딩/비임베딩 모델이 혼합된 임의 길이 목록
		const modelsArb = fc.array(modelInfoArb, { maxLength: 30 });

		fc.assert(
			fc.property(modelsArb, (models) => {
				const result = filterEmbeddingModels(models);

				// invariant 1: 결과의 모든 항목은 modelId에 "embedding"을 포함한다(임베딩 모델만 선별)
				for (const m of result) {
					expect(m.modelId.includes("embedding")).toBe(true);
				}

				// invariant 2: 입력에서 "embedding"을 포함하는 모든 항목이 결과에 보존된다
				//   (정확한 선별 검증을 위해, 기대 결과는 입력 중 "embedding" 포함 항목 전체와 동일해야 한다)
				const expected = models.filter((m) => m.modelId.includes("embedding"));
				expect(result).toEqual(expected);

				// invariant 3: 누락/추가 없이 개수도 일치한다
				expect(result.length).toBe(expected.length);
			}),
			{ numRuns: 100 }
		);
	});
});

// ============================================
// 속성 기반 테스트: 도구 정의 매핑 보존
// ============================================

describe("provider-utils 도구 정의 매핑 보존", () => {
	// Feature: multi-provider-ai-backends, Property 6: 도구 정의 매핑 보존
	it("Property 6: toOpenAITools/toOllamaTools는 빈 목록이면 undefined, 비어 있지 않으면 입력과 동일 개수 항목을 생성하고 각 name/description/input_schema를 function.parameters로 손실 없이 매핑한다", () => {
		// input_schema(JSON Schema 형태)에 들어갈 임의의 JSON 직렬화 가능한 객체 생성기.
		// 키-값을 가진 Record<string, unknown> 형태를 모사하되, 빈 객체도 허용한다.
		const jsonSchemaArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
			fc.string({ maxLength: 12 }),
			fc.oneof(
				fc.string(),
				fc.integer(),
				fc.boolean(),
				fc.constant(null),
				fc.array(fc.string(), { maxLength: 5 }),
				fc.dictionary(fc.string({ maxLength: 8 }), fc.string(), { maxKeys: 5 })
			),
			{ maxKeys: 6 }
		);

		// 단일 ToolDefinition 생성기: name/description/input_schema 필드를 임의로 채운다.
		const toolDefArb: fc.Arbitrary<ToolDefinition> = fc
			.tuple(fc.string({ maxLength: 30 }), fc.string({ maxLength: 60 }), jsonSchemaArb)
			.map(([name, description, input_schema]) => ({
				name,
				description,
				input_schema,
			}));

		// 도구 목록 생성기: 빈 목록(0개)과 N개(N≥1) 목록을 모두 포함하도록 minLength=0으로 둔다.
		const toolsArb = fc.array(toolDefArb, { maxLength: 12 });

		// 두 매퍼는 동일한 function 스키마(`{type:"function",function:{name,description,parameters}}`)를
		// 사용하므로 동일한 검증 로직을 공유한다.
		const mappers: Array<(tools: ToolDefinition[]) => unknown[] | undefined> = [
			toOpenAITools,
			toOllamaTools,
		];

		fc.assert(
			fc.property(toolsArb, (tools) => {
				for (const mapper of mappers) {
					const result = mapper(tools);

					if (tools.length === 0) {
						// invariant 1: 빈 목록이면 항상 undefined를 반환한다(요청에서 tools 생략, Req 5.3)
						expect(result).toBeUndefined();
						continue;
					}

					// invariant 2: 비어 있지 않으면 배열을 반환하며 입력과 개수가 정확히 일치한다(Req 5.1, 5.2)
					expect(Array.isArray(result)).toBe(true);
					expect((result as unknown[]).length).toBe(tools.length);

					// invariant 3: 각 항목은 function 스키마로 손실 없이 매핑된다.
					const arr = result as Array<Record<string, unknown>>;
					arr.forEach((item, i) => {
						const src = tools[i];

						// type은 항상 "function"
						expect(item.type).toBe("function");

						const fn = item.function as Record<string, unknown>;
						// name/description를 그대로 보존
						expect(fn.name).toBe(src.name);
						expect(fn.description).toBe(src.description);
						// input_schema는 function.parameters로 손실 없이(구조적 동일) 매핑
						expect(fn.parameters).toEqual(src.input_schema);
						// 참조 보존: 새 객체 복사 없이 동일 input_schema를 그대로 전달한다(손실 없음 보장)
						expect(fn.parameters).toBe(src.input_schema);
					});
				}
			}),
			{ numRuns: 200 }
		);
	});
});

// ============================================
// 속성 기반 테스트: 도구 호출 응답 변환 및 ID 부여
// ============================================

describe("provider-utils 도구 호출 응답 변환 및 ID 부여", () => {
	// Feature: multi-provider-ai-backends, Property 7: 도구 호출 응답 변환 및 ID 부여
	it("Property 7: openAIToolCallsToBlocks/ollamaToolCallsToBlocks는 N개(N≥1) 도구 호출(일부/전부 ID 누락 포함)에 대해 정확히 N개의 ContentBlockToolUse를 생성하고 모든 블록이 비어 있지 않은 toolUseId를 가진다", () => {
		// 도구 호출 인자로 사용할 JSON 직렬화 가능한 객체 생성기.
		// OpenAI는 이 객체를 JSON 문자열로, Ollama는 객체 그대로 인자에 사용한다.
		const argsObjArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
			fc.string({ maxLength: 10 }),
			fc.oneof(
				fc.string(),
				fc.integer(),
				fc.boolean(),
				fc.constant(null),
				fc.array(fc.string(), { maxLength: 4 }),
				fc.dictionary(fc.string({ maxLength: 6 }), fc.string(), { maxKeys: 4 })
			),
			{ maxKeys: 5 }
		);

		// 도구 이름 생성기(임의 문자열, 빈 문자열 포함 가능)
		const nameArb = fc.string({ maxLength: 20 });

		// id 필드 표현 방식 생성기: 일부/전부 누락 케이스를 포함하도록 다양화한다.
		//  - 비어 있지 않은 문자열 id(제공됨)
		//  - 빈 문자열 id(누락으로 간주)
		//  - id 키 자체가 없음(undefined; 누락으로 간주)
		const idVariantArb = fc.oneof(
			fc.string({ minLength: 1, maxLength: 12 }).map((id) => ({ id })),
			fc.constant({ id: "" }),
			fc.constant({})
		);

		// OpenAI 도구 호출 생성기: function.arguments는 유효 JSON 문자열.
		const openAICallArb = fc
			.tuple(idVariantArb, nameArb, argsObjArb)
			.map(([idPart, name, argsObj]) => ({
				...idPart,
				type: "function",
				function: {
					name,
					// OpenAI는 인자를 유효한 JSON 문자열로 전달한다.
					arguments: JSON.stringify(argsObj),
				},
			}));

		// Ollama 도구 호출 생성기: function.arguments는 객체.
		const ollamaCallArb = fc
			.tuple(idVariantArb, nameArb, argsObjArb)
			.map(([idPart, name, argsObj]) => ({
				...idPart,
				function: {
					name,
					// Ollama는 인자를 객체로 전달한다.
					arguments: argsObj,
				},
			}));

		// N≥1 보장(minLength: 1)을 위해 각 호출 배열을 최소 1개로 생성한다.
		const openAICallsArb = fc.array(openAICallArb, { minLength: 1, maxLength: 12 });
		const ollamaCallsArb = fc.array(ollamaCallArb, { minLength: 1, maxLength: 12 });

		// --- OpenAI 변환 검증 ---
		fc.assert(
			fc.property(openAICallsArb, (calls) => {
				const blocks = openAIToolCallsToBlocks(calls);

				// invariant 1: 입력 N개에 대해 정확히 N개의 블록을 생성한다(Req 5.4)
				expect(blocks.length).toBe(calls.length);

				blocks.forEach((block) => {
					// invariant 2: 모든 블록은 type:"tool_use"
					expect(block.type).toBe("tool_use");
					// invariant 3: 모든 블록은 비어 있지 않은 toolUseId를 가진다(미제공 시 생성, Req 5.7)
					expect(typeof block.toolUseId).toBe("string");
					expect(block.toolUseId.length).toBeGreaterThan(0);
				});
			}),
			{ numRuns: 100 }
		);

		// --- Ollama 변환 검증 ---
		fc.assert(
			fc.property(ollamaCallsArb, (calls) => {
				const blocks = ollamaToolCallsToBlocks(calls);

				// invariant 1: 입력 N개에 대해 정확히 N개의 블록을 생성한다(Req 5.4)
				expect(blocks.length).toBe(calls.length);

				blocks.forEach((block) => {
					// invariant 2: 모든 블록은 type:"tool_use"
					expect(block.type).toBe("tool_use");
					// invariant 3: 모든 블록은 비어 있지 않은 toolUseId를 가진다(Ollama 미제공 시 생성, Req 5.7)
					expect(typeof block.toolUseId).toBe("string");
					expect(block.toolUseId.length).toBeGreaterThan(0);
				});
			}),
			{ numRuns: 100 }
		);
	});

	// Feature: multi-provider-ai-backends, Property 7: 도구 호출 응답 변환 및 ID 부여(보조 검증)
	it("Property 7(보조): generateToolUseId()는 항상 비어 있지 않은 문자열을 생성하여 ID 누락 호출의 폴백을 보장한다", () => {
		// ID가 전부 누락된(id 키 없음) 도구 호출만으로 구성된 배열을 생성하여
		// generateToolUseId() 폴백 경로가 모든 블록에 비어 있지 않은 ID를 부여하는지 검증한다.
		const noIdOpenAICallArb = fc
			.tuple(fc.string({ maxLength: 20 }), fc.dictionary(fc.string({ maxLength: 8 }), fc.string(), { maxKeys: 4 }))
			.map(([name, argsObj]) => ({
				type: "function",
				function: { name, arguments: JSON.stringify(argsObj) },
			}));

		const callsArb = fc.array(noIdOpenAICallArb, { minLength: 1, maxLength: 10 });

		fc.assert(
			fc.property(callsArb, (calls) => {
				const blocks = openAIToolCallsToBlocks(calls);
				// 모든 블록이 폴백 ID로 채워졌는지 확인(빈 ID 없음)
				blocks.forEach((block) => {
					expect(block.toolUseId.length).toBeGreaterThan(0);
				});
			}),
			{ numRuns: 100 }
		);

		// generateToolUseId 자체 검증: 직접 호출해도 항상 비어 있지 않은 문자열을 반환한다.
		expect(generateToolUseId().length).toBeGreaterThan(0);
	});
});

// ============================================
// 속성 기반 테스트: OpenAI 도구 인자 JSON round-trip
// ============================================

describe("provider-utils OpenAI 도구 인자 JSON round-trip", () => {
	// Feature: multi-provider-ai-backends, Property 8: OpenAI 도구 인자 JSON round-trip
	it("Property 8: JSON 직렬화 가능한 임의 객체를 arguments 문자열로 만든 뒤 openAIToolCallsToBlocks로 변환하면 결과 블록의 input이 원래 객체와 구조적으로 동일하다", () => {
		// JSON 직렬화 가능한 값 생성기.
		// JSON.stringify→JSON.parse는 undefined/함수/심볼을 제거하고, NaN/Infinity는 null로,
		// -0은 0으로 변환하여 round-trip 동일성을 깨뜨린다. 따라서 생성기는 round-trip이
		// 보장되는 JSON-safe 값(string/유한 number(±0 제외 -0)/boolean/null/배열/객체)만 만든다.
		const jsonValueArb: fc.Arbitrary<unknown> = fc.letrec<{ value: unknown }>(
			(tie) => ({
				value: fc.oneof(
					fc.string(),
					fc.integer(),
					// NaN/Infinity 제외(JSON에서 null로 바뀜), -0 제외(0으로 바뀜)
					fc
						.double({ noNaN: true, noDefaultInfinity: true })
						.filter((n) => !Object.is(n, -0)),
					fc.boolean(),
					fc.constant(null),
					fc.array(tie("value"), { maxLength: 4 }),
					fc.dictionary(fc.string({ maxLength: 8 }), tie("value"), {
						maxKeys: 4,
					})
				),
			})
		).value;

		// input은 객체여야 하므로 최상위는 record/dictionary로 구성한다(빈 객체 포함).
		const argsObjectArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
			fc.string({ maxLength: 10 }),
			jsonValueArb,
			{ maxKeys: 6 }
		);

		fc.assert(
			fc.property(argsObjectArb, fc.string({ maxLength: 20 }), (argsObj, name) => {
				// 임의 객체를 JSON.stringify하여 OpenAI 도구 호출의 arguments 문자열로 만든다.
				const call = {
					id: "call_fixed",
					type: "function",
					function: {
						name,
						arguments: JSON.stringify(argsObj),
					},
				};

				const blocks = openAIToolCallsToBlocks([call]);

				// 단일 호출 → 단일 블록
				expect(blocks.length).toBe(1);

				// round-trip invariant: 결과 블록의 input은 원래 객체와 구조적으로 동일하다(Req 5.5)
				expect(blocks[0].input).toEqual(argsObj);

				// 보조 검증: JSON.parse(JSON.stringify(x))와도 동일(파서 동작 일관성)
				expect(blocks[0].input).toEqual(JSON.parse(JSON.stringify(argsObj)));
			}),
			{ numRuns: 200 }
		);
	});
});

// ============================================
// 속성 기반 테스트: 메시지 매핑 일관성
// ============================================

describe("provider-utils 메시지 매핑 일관성", () => {
	// Feature: multi-provider-ai-backends, Property 9: 메시지 매핑 일관성
	it("Property 9: toOpenAIMessages/toOllamaMessages는 role(user/assistant)을 보존하고 text/tool_use/tool_result 블록을 공급자 구조로 매핑하며, 각 tool_result가 원 도구 호출 식별자와 일관 매칭된다", () => {
		// --- JSON 직렬화가 round-trip되는 안전한 값 생성기 ---
		// OpenAI는 도구 인자를 JSON 문자열로 직렬화하므로, JSON.parse(JSON.stringify(x))가
		// 원본과 구조적으로 동일해야 검증이 성립한다. 따라서 undefined/함수/심볼/NaN/Infinity/-0
		// 같이 round-trip을 깨뜨리는 값은 제외한다.
		const jsonSafeValue: fc.Arbitrary<unknown> = fc.letrec<{ value: unknown }>(
			(tie) => ({
				value: fc.oneof(
					fc.string(),
					fc.integer(),
					fc
						.double({ noNaN: true, noDefaultInfinity: true })
						.filter((n) => !Object.is(n, -0)),
					fc.boolean(),
					fc.constant(null),
					fc.array(tie("value"), { maxLength: 3 }),
					fc.dictionary(fc.string({ maxLength: 6 }), tie("value"), {
						maxKeys: 3,
					})
				),
			})
		).value;

		// 도구 호출 인자(input) 객체 생성기 — 최상위는 항상 객체(Record)
		const inputArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
			fc.string({ maxLength: 8 }),
			jsonSafeValue,
			{ maxKeys: 4 }
		);

		// 도구 호출/결과 쌍 생성기. idCore로 고유성을 보장하여 식별자 매칭 검증이 명확해진다.
		const pairArb = fc.record({
			idCore: fc.string({ minLength: 1, maxLength: 8 }),
			name: fc.string({ maxLength: 15 }),
			input: inputArb,
			result: fc.string({ maxLength: 30 }),
		});

		// idCore 기준으로 중복 없는 쌍 목록(빈 목록 포함). 각 쌍은 assistant tool_use 1개와
		// 이를 참조하는 user tool_result 1개를 만들어 식별자 매칭을 검증한다.
		const pairsArb = fc.uniqueArray(pairArb, {
			selector: (p) => p.idCore,
			maxLength: 5,
		});

		// 블록 표현 방식: 구현은 Bedrock 스타일 중첩과 평면 판별 유니온을 모두 인식한다.
		// 두 표현을 모두 exercise하기 위해 시나리오 단위로 무작위 선택한다.
		const repArb = fc.constantFrom<"flat" | "nested">("flat", "nested");

		// 텍스트 블록 생성(공급자 매퍼는 text 필드를 가진 블록을 텍스트로 인식한다)
		const makeTextBlock = (text: string, rep: "flat" | "nested"): unknown =>
			rep === "nested" ? { text } : { type: "text", text };

		// tool_use 블록 생성(중첩: {toolUse:{...}}, 평면: {type:"tool_use",...})
		const makeToolUseBlock = (
			id: string,
			name: string,
			input: Record<string, unknown>,
			rep: "flat" | "nested"
		): unknown =>
			rep === "nested"
				? { toolUse: { toolUseId: id, name, input } }
				: { type: "tool_use", toolUseId: id, name, input };

		// tool_result 블록 생성(중첩: {toolResult:{toolUseId,content:[{text}]}}, 평면: {type:"tool_result",tool_use_id,content})
		const makeToolResultBlock = (
			id: string,
			content: string,
			rep: "flat" | "nested"
		): unknown =>
			rep === "nested"
				? { toolResult: { toolUseId: id, content: [{ text: content }] } }
				: { type: "tool_result", tool_use_id: id, content };

		fc.assert(
			fc.property(
				pairsArb,
				fc.string({ maxLength: 20 }), // 선행 user 텍스트
				fc.string({ maxLength: 20 }), // 후행 assistant 텍스트
				repArb,
				repArb,
				repArb,
				(rawPairs, leadingText, trailingText, textRep, toolUseRep, toolResultRep) => {
					// idCore에 접두사를 붙여 실제 식별자를 구성한다.
					const pairs = rawPairs.map((p) => ({
						id: `call_${p.idCore}`,
						name: p.name,
						input: p.input,
						result: p.result,
					}));

					// 대화 구성: [선행 user 텍스트] → 각 쌍마다 [assistant tool_use, user tool_result] → [후행 assistant 텍스트]
					const messages: ConverseMessage[] = [];
					messages.push({
						role: "user",
						content: [makeTextBlock(leadingText, textRep)],
					});
					for (const p of pairs) {
						messages.push({
							role: "assistant",
							content: [makeToolUseBlock(p.id, p.name, p.input, toolUseRep)],
						});
						messages.push({
							role: "user",
							content: [makeToolResultBlock(p.id, p.result, toolResultRep)],
						});
					}
					messages.push({
						role: "assistant",
						content: [makeTextBlock(trailingText, textRep)],
					});

					const expectedIds = new Set(pairs.map((p) => p.id));

					// ===== OpenAI 매핑 검증 =====
					{
						const out = toOpenAIMessages(messages) as Array<
							Record<string, unknown>
						>;

						// invariant: 모든 출력 엔트리의 role은 user/assistant/tool 중 하나
						for (const e of out) {
							expect(["user", "assistant", "tool"]).toContain(e.role);
						}

						const assistantEntries = out.filter((e) => e.role === "assistant");
						const userEntries = out.filter((e) => e.role === "user");
						const toolEntries = out.filter((e) => e.role === "tool");

						// invariant: 입력 assistant 메시지 수와 출력 assistant 엔트리 수 일치(각 assistant→1 엔트리)
						expect(assistantEntries.length).toBe(pairs.length + 1);
						// invariant: 텍스트를 가진 user 메시지(선행)만 user 엔트리로 보존 → 정확히 1개
						expect(userEntries.length).toBe(1);
						expect(userEntries[0].content).toBe(leadingText);
						// invariant: tool_result 블록 수와 tool 엔트리 수 일치
						expect(toolEntries.length).toBe(pairs.length);

						// invariant: 식별자 매칭 — tool 엔트리의 tool_call_id 집합 == 원 도구 호출 id 집합
						const toolCallIds = new Set(
							toolEntries.map((e) => e.tool_call_id as string)
						);
						expect(toolCallIds).toEqual(expectedIds);

						// invariant: assistant tool_calls의 id 집합도 동일(호출↔결과 일관 매칭)
						const assistantToolCallIds = new Set<string>();
						for (const a of assistantEntries) {
							const tcs = a.tool_calls as
								| Array<Record<string, unknown>>
								| undefined;
							if (tcs) {
								for (const tc of tcs) {
									assistantToolCallIds.add(tc.id as string);
								}
							}
						}
						expect(assistantToolCallIds).toEqual(expectedIds);

						// 쌍별 상세: tool 결과 내용 + tool_call 인자 round-trip + 이름 보존
						for (const p of pairs) {
							const toolMsg = toolEntries.find(
								(e) => e.tool_call_id === p.id
							);
							expect(toolMsg).toBeDefined();
							expect((toolMsg as Record<string, unknown>).content).toBe(
								p.result
							);

							let foundTc: Record<string, unknown> | undefined;
							for (const a of assistantEntries) {
								const tcs = a.tool_calls as
									| Array<Record<string, unknown>>
									| undefined;
								if (tcs) {
									const hit = tcs.find((t) => t.id === p.id);
									if (hit) foundTc = hit;
								}
							}
							expect(foundTc).toBeDefined();
							const tc = foundTc as Record<string, unknown>;
							expect(tc.type).toBe("function");
							const fn = tc.function as Record<string, unknown>;
							expect(fn.name).toBe(p.name);
							// OpenAI 인자는 JSON 문자열 → 파싱하면 원 input과 구조적으로 동일
							expect(JSON.parse(fn.arguments as string)).toEqual(p.input);
						}

						// invariant: 후행 assistant 텍스트는 role:"assistant"로 보존되며 tool_calls가 없다(role 미교환)
						const textAssistant = assistantEntries.find(
							(a) => a.content === trailingText && a.tool_calls === undefined
						);
						expect(textAssistant).toBeDefined();
					}

					// ===== Ollama 매핑 검증 =====
					{
						const out = toOllamaMessages(messages) as Array<
							Record<string, unknown>
						>;

						for (const e of out) {
							expect(["user", "assistant", "tool"]).toContain(e.role);
						}

						const assistantEntries = out.filter((e) => e.role === "assistant");
						const userEntries = out.filter((e) => e.role === "user");
						const toolEntries = out.filter((e) => e.role === "tool");

						expect(assistantEntries.length).toBe(pairs.length + 1);
						expect(userEntries.length).toBe(1);
						expect(userEntries[0].content).toBe(leadingText);
						expect(toolEntries.length).toBe(pairs.length);

						// Ollama tool 엔트리는 tool_call_id를 사용하지 않으며, 매칭은 순서로 보장된다(Req 5.8).
						for (const e of toolEntries) {
							expect(e.tool_call_id).toBeUndefined();
						}
						// 순서 기반 매칭: tool 결과 내용 시퀀스가 입력 쌍의 결과 시퀀스와 일치
						expect(toolEntries.map((e) => e.content)).toEqual(
							pairs.map((p) => p.result)
						);

						// assistant tool_calls(객체 인자) — 순서대로 이름/인자 보존
						const toolCallEntries = assistantEntries.filter(
							(a) => a.tool_calls !== undefined
						);
						expect(toolCallEntries.length).toBe(pairs.length);
						toolCallEntries.forEach((a, i) => {
							const tcs = a.tool_calls as Array<Record<string, unknown>>;
							expect(tcs.length).toBe(1);
							const fn = tcs[0].function as Record<string, unknown>;
							expect(fn.name).toBe(pairs[i].name);
							// Ollama 인자는 객체 그대로 보존(구조적 동일)
							expect(fn.arguments).toEqual(pairs[i].input);
						});

						// 후행 assistant 텍스트 role 보존 + tool_calls 없음
						const textAssistant = assistantEntries.find(
							(a) => a.content === trailingText && a.tool_calls === undefined
						);
						expect(textAssistant).toBeDefined();
					}
				}
			),
			{ numRuns: 150 }
		);
	});
});

// ============================================
// 예시 단위 테스트: JSON 파싱 실패 엣지 (Req 5.6)
// ============================================

describe("provider-utils openAIToolCallsToBlocks JSON 파싱 실패 엣지", () => {
	// Req 5.6: 도구 호출 인자의 JSON 파싱에 실패하면 정상 호출로 반환하지 않고 오류를 throw한다.
	// 주의: 구현은 빈/공백 arguments 문자열을 {}로 처리(throw 안 함)하므로,
	//       반드시 "비어 있지 않은" invalid JSON 문자열로만 검증한다.

	// 비어 있지 않은 잘못된 JSON 문자열 예시 모음
	// (각 문자열은 JSON.parse가 실패하는 형태이며, trim 후에도 비어 있지 않다.)
	const invalidJsonSamples = [
		"{invalid", // 닫히지 않은 객체
		"not json", // JSON이 아닌 일반 텍스트
		"{'a':1}", // 작은따옴표 사용(유효 JSON 아님)
		"{a:1}", // 키에 따옴표 없음
		'{"a":}', // 값 누락
		"[1,2,", // 닫히지 않은 배열
		"undefined", // JSON 리터럴 아님
		"{,}", // 잘못된 구분자
	];

	it("Req 5.6: 비어 있지 않은 잘못된 JSON 문자열을 arguments로 주입하면 throw한다", () => {
		for (const badArgs of invalidJsonSamples) {
			const call = {
				id: "call_1",
				type: "function",
				function: {
					name: "doSomething",
					arguments: badArgs,
				},
			};
			// 잘못된 JSON은 JSON.parse 실패 → 예외 전파(정상 호출 미반환)
			expect(() => openAIToolCallsToBlocks([call])).toThrow();
		}
	});

	it("Req 5.6: 유효 호출과 잘못된 JSON 호출이 섞여 있으면 전체 변환이 throw한다(정상 호출 미반환)", () => {
		const calls = [
			{
				id: "call_ok",
				type: "function",
				function: {
					name: "validTool",
					arguments: JSON.stringify({ key: "value" }),
				},
			},
			{
				id: "call_bad",
				type: "function",
				function: {
					name: "brokenTool",
					arguments: "{invalid json", // 비어 있지 않은 invalid JSON
				},
			},
		];
		// 하나라도 파싱 실패하면 결과 배열을 정상 반환하지 않고 throw한다.
		expect(() => openAIToolCallsToBlocks(calls)).toThrow();
	});
});

// ============================================
// 단위 테스트: temperature 지원 여부 판별 (supportsTemperature)
// ============================================

describe("provider-utils supportsTemperature", () => {
	it("OpenAI: gpt-5 계열/o 시리즈 추론 모델은 미지원, 그 외는 지원", () => {
		// 미지원(기본값 1만 허용 → 생략 대상)
		expect(supportsTemperature("openai", "gpt-5.1")).toBe(false);
		expect(supportsTemperature("openai", "gpt-5")).toBe(false);
		expect(supportsTemperature("openai", "o1")).toBe(false);
		expect(supportsTemperature("openai", "o3-mini")).toBe(false);
		expect(supportsTemperature("openai", "o4-mini")).toBe(false);
		// 지원(일반 채팅 모델)
		expect(supportsTemperature("openai", "gpt-4o")).toBe(true);
		expect(supportsTemperature("openai", "gpt-4.1")).toBe(true);
	});

	it("Gemini: gemini-3 계열은 미지원(기본값 유지), 그 외는 지원", () => {
		expect(supportsTemperature("gemini", "gemini-3-pro")).toBe(false);
		expect(supportsTemperature("gemini", "gemini-3-flash")).toBe(false);
		expect(supportsTemperature("gemini", "gemini-2.5-flash")).toBe(true);
		expect(supportsTemperature("gemini", "gemini-1.5-pro")).toBe(true);
	});

	it("Bedrock: claude-opus-4 계열은 미지원, 그 외는 지원", () => {
		expect(supportsTemperature("bedrock", "global.anthropic.claude-opus-4-8")).toBe(false);
		expect(supportsTemperature("bedrock", "global.anthropic.claude-opus-4-1")).toBe(false);
		expect(supportsTemperature("bedrock", "global.anthropic.claude-sonnet-4-5")).toBe(true);
		expect(supportsTemperature("bedrock", "global.anthropic.claude-haiku-4")).toBe(true);
	});

	it("Ollama: 로컬 모델은 항상 지원", () => {
		expect(supportsTemperature("ollama", "llama4")).toBe(true);
		expect(supportsTemperature("ollama", "anything")).toBe(true);
	});
});
