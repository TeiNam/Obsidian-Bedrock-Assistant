/**
 * provider-utils.ts
 *
 * OpenAI/Ollama 클라이언트가 공유하는 부수효과 없는(pure) 매핑/정규화 함수 모음.
 * 네트워크/스트리밍 등 부수효과는 각 클라이언트에 격리하고, 이 모듈은 속성 기반
 * 테스트가 가능한 순수 함수만 포함한다.
 *
 * (후속 작업 2.4, 2.7, 2.9에서 임베딩 절단/모델 필터/도구·메시지 매퍼 등이 같은
 *  파일에 추가된다.)
 */

import type {
	ModelInfo,
	ConverseMessage,
	ContentBlockToolUse,
	ToolDefinition,
} from "./types";

// === base URL 정규화/해석/검증 (Req 2.6~2.10) ===

/**
 * base URL 정규화.
 * 앞뒤 공백을 제거하고 후행 슬래시("/")를 모두 제거한다.
 * 예) "  https://api.example.com//  " → "https://api.example.com"
 */
export function normalizeBaseUrl(raw: string): string {
	// trim으로 앞뒤 공백 제거 후, 끝에 붙은 슬래시를 모두(/+$) 제거한다.
	return raw.trim().replace(/\/+$/, "");
}

/**
 * base URL 해석.
 * 정규화 결과가 빈 문자열이면 공급자별 기본 엔드포인트(fallback)를 사용하고(Req 2.7, 2.9),
 * 비어 있지 않으면 정규화된 값을 그대로 사용한다(Req 2.8).
 */
export function resolveBaseUrl(raw: string, fallback: string): string {
	const normalized = normalizeBaseUrl(raw);
	return normalized === "" ? fallback : normalized;
}

/**
 * base URL 형식 검증 술어.
 * 정규화 후 빈 문자열(= 기본 엔드포인트 사용)이거나 http:// 또는 https:// scheme으로
 * 시작하는 경우에만 true를 반환한다(Req 2.10). 설정 저장 시점의 검증에 사용한다.
 */
export function isValidBaseUrl(raw: string): boolean {
	const normalized = normalizeBaseUrl(raw);
	return normalized === "" || /^https?:\/\//.test(normalized);
}

// === 임베딩 입력 절단 (Req 6.3) ===

/**
 * 임베딩 입력 텍스트 절단.
 * 텍스트 길이가 maxChars 이하이면 원본을 그대로 반환하고,
 * 초과하면 앞부분(접두사)부터 maxChars 글자까지만 잘라서 반환한다.
 * 결과는 항상 입력의 접두사이며 길이는 maxChars 이하임이 보장된다(Property 10).
 * 각 클라이언트의 getEmbedding에서 maxChars=20000(기존 Gemini/Bedrock과 일관)으로 적용한다.
 */
export function truncateForEmbedding(text: string, maxChars: number): string {
	return text.length <= maxChars ? text : text.slice(0, maxChars);
}

// === temperature 지원 여부 판별 (공급자별 최신 모델 대응) ===

/**
 * 주어진 공급자/모델이 temperature 파라미터를 지원하는지 판별한다.
 * 최신 추론(reasoning) 모델 중 일부는 temperature를 기본값 외 값으로 지정하면
 * 요청이 거부되거나(예: OpenAI GPT-5/o 시리즈) 권장되지 않으므로(예: Gemini 3),
 * 이런 모델에는 요청에서 temperature를 생략하기 위해 false를 반환한다.
 *
 * 공급자별 규칙:
 *  - openai: gpt-5 계열 및 o1/o2/.../o9 추론 모델은 미지원(기본값 1만 허용) → false
 *  - gemini: gemini-3 계열은 기본값(1.0) 유지 권장 → false(생략)
 *  - bedrock: Anthropic claude-opus-4 계열은 temperature 미지원 → false
 *  - ollama: 로컬/셀프호스트 모델은 거부하지 않으므로 항상 지원 → true
 * 그 외 모델은 모두 지원하는 것으로 간주한다(true).
 */
export function supportsTemperature(
	provider: "openai" | "ollama" | "gemini" | "bedrock",
	modelId: string
): boolean {
	const id = (modelId ?? "").toLowerCase();
	switch (provider) {
		case "openai":
			// gpt-5 계열(gpt-5, gpt-5.1 등)과 o 시리즈(o1/o3/o4 등) 추론 모델은 미지원
			return !(/^gpt-5/.test(id) || /^o[1-9]/.test(id));
		case "gemini":
			// Gemini 3 계열은 기본값 1.0 유지를 권장하므로 생략한다
			return !/^gemini-3/.test(id);
		case "bedrock":
			// Anthropic claude-opus-4 계열은 temperature 미지원
			return !/claude-opus-4/.test(id);
		case "ollama":
		default:
			return true;
	}
}

// === 도구 호출 ID 생성 (Req 5.7) ===

/**
 * 고유 toolUseId 생성.
 * 공급자(특히 Ollama)가 도구 호출에 식별자를 제공하지 않을 때, 각 도구 호출에
 * 부여할 고유 ID를 생성한다(Req 5.7). 가용하면 crypto.randomUUID()를 사용하고,
 * 미지원 환경에서는 시간값과 난수를 조합한 폴백 ID를 사용한다.
 */
export function generateToolUseId(): string {
	// crypto.randomUUID는 부수효과가 없는 순수 난수 생성으로, 호출마다 고유 ID를 반환한다.
	const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } })
		.crypto;
	if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
		return `tooluse_${cryptoObj.randomUUID()}`;
	}
	// 폴백: randomUUID 미지원 환경에서 시간값 + 난수로 충돌 가능성이 낮은 ID 구성.
	const rand = Math.random().toString(36).slice(2);
	return `tooluse_${Date.now().toString(36)}_${rand}`;
}

// === stopReason 매핑 (Req 4.4, 4.5) ===

/**
 * 내부 stopReason 매핑.
 * 도구 호출이 존재하면(hasToolUse=true) 공급자 종료 사유와 무관하게 항상 "tool_use"를
 * 반환한다(Req 4.4). 도구 호출이 없으면 공급자 종료 사유 원문을 내부 값으로 매핑한다(Req 4.5):
 *  - "stop"/"end_turn"     → "end_turn"
 *  - "length"/"max_tokens" → "max_tokens"
 *  - 그 외(null 포함)        → "end_turn" 폴백
 */
export function mapStopReason(
	rawReason: string | null,
	hasToolUse: boolean
): string {
	// 도구 호출이 있으면 종료 사유보다 우선하여 tool_use로 확정한다(Req 4.4).
	if (hasToolUse) {
		return "tool_use";
	}
	switch (rawReason) {
		case "stop":
		case "end_turn":
			return "end_turn";
		case "length":
		case "max_tokens":
			return "max_tokens";
		default:
			// 알 수 없는 사유나 null은 정상 종료(end_turn)로 폴백한다.
			return "end_turn";
	}
}

// === OpenAI 임베딩 모델 필터 (Req 7.2, 7.4) ===

/**
 * OpenAI 임베딩 모델 필터.
 * OpenAI `/models` 응답은 채팅/임베딩 모델이 혼합되어 있으므로, modelId에 "embedding"을
 * 포함하는 항목만 남겨 임베딩 모델 목록으로 좁힌다(Req 7.2, 7.4).
 * 부수효과 없이 입력 순서를 보존하는 새 배열을 반환한다.
 * 결과의 모든 항목은 "embedding"을 포함하며, 입력에서 "embedding"을 포함하는 모든
 * 항목은 결과에 보존된다(Property 11).
 */
export function filterEmbeddingModels(models: ModelInfo[]): ModelInfo[] {
	return models.filter((m) => m.modelId.includes("embedding"));
}

// === 도구 정의 매핑 (Req 5.1~5.3) ===

/**
 * 단일 ToolDefinition → 공급자 function 스키마 변환.
 * OpenAI와 Ollama 모두 `{ type:"function", function:{ name, description, parameters } }`
 * 형태를 사용하며, 내부 모델의 `input_schema`를 `function.parameters`로 손실 없이 옮긴다.
 */
function toFunctionTool(tool: ToolDefinition): {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
} {
	return {
		type: "function",
		function: {
			// name/description/input_schema를 공급자 스키마로 1:1 매핑(손실 없음).
			name: tool.name,
			description: tool.description,
			parameters: tool.input_schema,
		},
	};
}

/**
 * OpenAI 도구 정의 매핑.
 * 도구 목록이 비어 있으면 `undefined`를 반환하여 요청 바디에서 `tools` 파라미터를
 * 생략한다(Req 5.3). 비어 있지 않으면 입력과 동일 개수의 function 도구 항목을 반환한다(Req 5.1).
 */
export function toOpenAITools(
	tools: ToolDefinition[]
): unknown[] | undefined {
	if (tools.length === 0) {
		return undefined;
	}
	return tools.map(toFunctionTool);
}

/**
 * Ollama 도구 정의 매핑.
 * OpenAI와 동일한 function 스키마(`function.parameters`)를 사용한다(Req 5.2).
 * 빈 목록이면 `undefined`(요청에서 생략, Req 5.3).
 */
export function toOllamaTools(
	tools: ToolDefinition[]
): unknown[] | undefined {
	if (tools.length === 0) {
		return undefined;
	}
	return tools.map(toFunctionTool);
}

// === 응답 도구 호출 → ContentBlockToolUse (Req 5.4~5.7) ===

/**
 * OpenAI tool_calls(JSON 문자열 인자) → ContentBlockToolUse[] 변환.
 * 각 호출의 `function.arguments`(JSON 문자열)를 `JSON.parse`하여 `input`에 설정하고(Req 5.5),
 * 파싱에 실패하면 오류를 throw한다(Req 5.6). 호출 ID가 없으면 `generateToolUseId()`로
 * 고유 ID를 부여한다(Req 5.7). 입력 N개에 대해 정확히 N개의 블록을 반환한다(Req 5.4).
 * 빈/공백 인자 문자열은 인자 없는 호출로 간주하여 `{}`로 처리한다(스트리밍 누적 산출물 호환).
 */
export function openAIToolCallsToBlocks(
	toolCalls: unknown[]
): ContentBlockToolUse[] {
	return toolCalls.map((call) => {
		const c = (call ?? {}) as Record<string, unknown>;
		const fn = (c.function ?? {}) as Record<string, unknown>;
		const name = typeof fn.name === "string" ? fn.name : "";
		const rawArgs = fn.arguments;

		let input: Record<string, unknown> = {};
		if (typeof rawArgs === "string" && rawArgs.trim() !== "") {
			// JSON.parse 실패 시 예외를 전파한다(Req 5.6). 정상 호출로 반환하지 않는다.
			input = JSON.parse(rawArgs) as Record<string, unknown>;
		} else if (rawArgs !== null && typeof rawArgs === "object") {
			// 일부 호환 공급자가 이미 객체로 전달하는 경우 그대로 사용한다.
			input = rawArgs as Record<string, unknown>;
		}

		const id = typeof c.id === "string" && c.id !== "" ? c.id : "";
		return {
			type: "tool_use",
			toolUseId: id || generateToolUseId(),
			name,
			input,
		};
	});
}

/**
 * Ollama tool_calls(객체 인자) → ContentBlockToolUse[] 변환.
 * `function.arguments`는 이미 객체이므로 그대로 `input`에 사용한다.
 * 호출 ID가 없으면(Ollama는 미제공 가능) `generateToolUseId()`로 부여한다(Req 5.7).
 * 입력 N개에 대해 정확히 N개의 블록을 반환한다(Req 5.4).
 */
export function ollamaToolCallsToBlocks(
	toolCalls: unknown[]
): ContentBlockToolUse[] {
	return toolCalls.map((call) => {
		const c = (call ?? {}) as Record<string, unknown>;
		const fn = (c.function ?? {}) as Record<string, unknown>;
		const name = typeof fn.name === "string" ? fn.name : "";
		const rawArgs = fn.arguments;

		// Ollama는 인자를 객체로 전달한다. 객체가 아니면 빈 객체로 폴백한다.
		const input: Record<string, unknown> =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};

		const id = typeof c.id === "string" && c.id !== "" ? c.id : "";
		return {
			type: "tool_use",
			toolUseId: id || generateToolUseId(),
			name,
			input,
		};
	});
}

// === ConverseMessage → 공급자 메시지 (Req 5.8, 5.9) ===

/**
 * 내부 메시지 콘텐츠 블록의 정규화 표현.
 * 코드베이스에는 두 가지 블록 표현이 공존한다:
 *  - Bedrock 스타일 중첩: `{ text }`, `{ toolUse:{ toolUseId,name,input } }`,
 *    `{ toolResult:{ toolUseId,name,content:[{text}] } }` (실제 ConverseMessage.content에 저장되는 형태)
 *  - 평면 판별 유니온: `{ type:"text", text }`, `{ type:"tool_use", toolUseId/id,... }`,
 *    `{ type:"tool_result", tool_use_id, content }` (types.ts 정의)
 * 매퍼는 두 표현을 모두 인식하여 일관되게 변환한다.
 */
type NormalizedBlock =
	| { kind: "text"; text: string }
	| { kind: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { kind: "tool_result"; id: string; content: string };

/**
 * tool_result 콘텐츠를 평탄한 문자열로 추출한다.
 * 문자열이면 그대로, `[{text}]` 배열이면 text를 이어 붙인다.
 */
function extractResultText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		let text = "";
		for (const part of content) {
			if (
				typeof part === "object" &&
				part !== null &&
				typeof (part as Record<string, unknown>).text === "string"
			) {
				text += (part as Record<string, unknown>).text as string;
			}
		}
		return text;
	}
	return "";
}

/**
 * 단일 콘텐츠 블록을 정규화 표현으로 변환한다(인식 불가 블록은 null).
 */
function normalizeBlock(block: unknown): NormalizedBlock | null {
	if (typeof block !== "object" || block === null) {
		return null;
	}
	const b = block as Record<string, unknown>;

	// Bedrock 스타일 중첩 도구 호출
	if ("toolUse" in b && typeof b.toolUse === "object" && b.toolUse !== null) {
		const tu = b.toolUse as Record<string, unknown>;
		const id = (tu.toolUseId ?? tu.id ?? "") as string;
		return {
			kind: "tool_use",
			id: typeof id === "string" ? id : "",
			name: typeof tu.name === "string" ? tu.name : "",
			input:
				tu.input !== null && typeof tu.input === "object"
					? (tu.input as Record<string, unknown>)
					: {},
		};
	}

	// Bedrock 스타일 중첩 도구 결과
	if (
		"toolResult" in b &&
		typeof b.toolResult === "object" &&
		b.toolResult !== null
	) {
		const tr = b.toolResult as Record<string, unknown>;
		const id = (tr.toolUseId ?? tr.tool_use_id ?? "") as string;
		return {
			kind: "tool_result",
			id: typeof id === "string" ? id : "",
			content: extractResultText(tr.content),
		};
	}

	// 평면 판별 유니온: tool_use
	if (b.type === "tool_use") {
		const id = (b.toolUseId ?? b.id ?? "") as string;
		return {
			kind: "tool_use",
			id: typeof id === "string" ? id : "",
			name: typeof b.name === "string" ? b.name : "",
			input:
				b.input !== null && typeof b.input === "object"
					? (b.input as Record<string, unknown>)
					: {},
		};
	}

	// 평면 판별 유니온: tool_result
	if (b.type === "tool_result") {
		const id = (b.tool_use_id ?? b.toolUseId ?? "") as string;
		return {
			kind: "tool_result",
			id: typeof id === "string" ? id : "",
			content: extractResultText(b.content),
		};
	}

	// 텍스트 블록(중첩/평면 공통: text 필드 보유)
	if (typeof b.text === "string") {
		return { kind: "text", text: b.text };
	}

	return null;
}

/**
 * ConverseMessage 목록 → OpenAI chat 메시지 배열 변환(Req 5.8, 5.9).
 * - `role`은 user/assistant를 그대로 보존한다.
 * - 텍스트 블록은 메시지 `content`로 합친다.
 * - assistant의 tool_use 블록은 `tool_calls`(`{id,type:"function",function:{name,arguments}}`,
 *   arguments는 JSON 문자열)로 매핑한다.
 * - tool_result 블록은 별도의 `{ role:"tool", tool_call_id, content }` 메시지로 매핑하며,
 *   `tool_use_id`를 `tool_call_id`로 사용하여 원 도구 호출과 매칭한다(Req 5.8).
 */
export function toOpenAIMessages(messages: ConverseMessage[]): unknown[] {
	const result: unknown[] = [];

	for (const msg of messages) {
		const blocks = (msg.content as unknown[]).map(normalizeBlock);

		const textSegments: string[] = [];
		const toolCalls: unknown[] = [];
		const toolResultMessages: unknown[] = [];

		for (const nb of blocks) {
			if (nb === null) continue;
			if (nb.kind === "text") {
				textSegments.push(nb.text);
			} else if (nb.kind === "tool_use") {
				toolCalls.push({
					id: nb.id,
					type: "function",
					function: {
						name: nb.name,
						// OpenAI는 인자를 JSON 문자열로 요구한다.
						arguments: JSON.stringify(nb.input),
					},
				});
			} else {
				// tool_result → role:"tool" 별도 메시지. tool_call_id로 원 호출과 매칭.
				toolResultMessages.push({
					role: "tool",
					tool_call_id: nb.id,
					content: nb.content,
				});
			}
		}

		if (msg.role === "assistant") {
			// 어시스턴트 메시지: 텍스트 + (있으면) tool_calls를 하나의 메시지로 구성.
			const assistantMsg: Record<string, unknown> = {
				role: "assistant",
				content: textSegments.join(""),
			};
			if (toolCalls.length > 0) {
				assistantMsg.tool_calls = toolCalls;
			}
			result.push(assistantMsg);
			// 어시스턴트 메시지에 결과 블록이 섞여 있으면 뒤이어 tool 메시지로 추가(드문 경우).
			for (const trm of toolResultMessages) {
				result.push(trm);
			}
		} else {
			// user 메시지: tool_result(이전 호출 응답)를 먼저 배치한 뒤 사용자 텍스트를 둔다.
			for (const trm of toolResultMessages) {
				result.push(trm);
			}
			if (textSegments.length > 0) {
				result.push({ role: "user", content: textSegments.join("") });
			}
		}
	}

	return result;
}

/**
 * ConverseMessage 목록 → Ollama chat 메시지 배열 변환(Req 5.8, 5.9).
 * - `role`은 user/assistant를 그대로 보존한다.
 * - 텍스트 블록은 메시지 `content`로 합친다.
 * - assistant의 tool_use 블록은 `tool_calls`(`{function:{name,arguments}}`,
 *   arguments는 객체)로 매핑한다.
 * - tool_result 블록은 별도의 `{ role:"tool", content }` 메시지로 매핑한다(Ollama는
 *   tool_call_id를 사용하지 않으며, 직전 호출과의 매칭은 순서로 보장한다, Req 5.8).
 */
export function toOllamaMessages(messages: ConverseMessage[]): unknown[] {
	const result: unknown[] = [];

	for (const msg of messages) {
		const blocks = (msg.content as unknown[]).map(normalizeBlock);

		const textSegments: string[] = [];
		const toolCalls: unknown[] = [];
		const toolResultMessages: unknown[] = [];

		for (const nb of blocks) {
			if (nb === null) continue;
			if (nb.kind === "text") {
				textSegments.push(nb.text);
			} else if (nb.kind === "tool_use") {
				toolCalls.push({
					function: {
						name: nb.name,
						// Ollama는 인자를 객체로 전달한다.
						arguments: nb.input,
					},
				});
			} else {
				toolResultMessages.push({
					role: "tool",
					content: nb.content,
				});
			}
		}

		if (msg.role === "assistant") {
			const assistantMsg: Record<string, unknown> = {
				role: "assistant",
				content: textSegments.join(""),
			};
			if (toolCalls.length > 0) {
				assistantMsg.tool_calls = toolCalls;
			}
			result.push(assistantMsg);
			for (const trm of toolResultMessages) {
				result.push(trm);
			}
		} else {
			for (const trm of toolResultMessages) {
				result.push(trm);
			}
			if (textSegments.length > 0) {
				result.push({ role: "user", content: textSegments.join("") });
			}
		}
	}

	return result;
}
