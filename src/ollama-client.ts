/**
 * ollama-client.ts
 *
 * Ollama(로컬/셀프호스트) 백엔드용 IAiClient 구현.
 * - 스트리밍 채팅(converse)은 NDJSON 수신을 위해 fetch를 직접 사용한다.
 * - 비스트리밍 호출(converseLight/getEmbedding/listModels)은 Obsidian requestUrl을 사용한다.
 * - 타임아웃은 fetch의 경우 AbortController+setTimeout(연결 10초) + 사용자 signal 결합,
 *   requestUrl의 경우 네이티브 abort가 없으므로 Promise.race 기반 타임아웃으로 구현한다.
 * - 공급자별 순수 매핑/정규화 로직은 provider-utils.ts에 위임한다.
 *
 * Ollama는 API 키가 없으며(로컬/셀프호스트), 엔드포인트는 base URL에 "/api"를 부착한다(Req 2.8.2).
 */

import { requestUrl } from "obsidian";
import type {
	GeminiAssistantSettings,
	IAiClient,
	ToolDefinition,
	ConverseMessage,
	ConverseResult,
	ContentBlock,
	ModelInfo,
} from "./types";
import {
	resolveBaseUrl,
	truncateForEmbedding,
	mapStopReason,
	toOllamaTools,
	ollamaToolCallsToBlocks,
	toOllamaMessages,
} from "./provider-utils";
import { buildSystemPrompt } from "./system-prompt";

// === 공급자 기본값/타임아웃 상수 ===
/** Ollama 기본 엔드포인트(base URL 미설정 시 폴백) - Req 2.9 */
const OLLAMA_DEFAULT_BASE = "http://localhost:11434";
/** 임베딩 입력 최대 글자 수(기존 Gemini/Bedrock과 일관) - Req 6.3 */
const EMBEDDING_MAX_CHARS = 20000;
/** 스트리밍 연결 수립 타임아웃(10초) - Req 10.2 */
const CONNECT_TIMEOUT_MS = 10000;
/** 모델 목록 조회 타임아웃(10초) - Req 7.7 */
const LIST_MODELS_TIMEOUT_MS = 10000;
/** 비스트리밍 요청 타임아웃(60초) - Req 10.6 */
const NONSTREAM_TIMEOUT_MS = 60000;
/** converseLight 기본 maxTokens - Req 8.3 */
const DEFAULT_LIGHT_MAX_TOKENS = 1024;

export class OllamaClient implements IAiClient {
	private settings: GeminiAssistantSettings;

	constructor(settings: GeminiAssistantSettings) {
		this.settings = settings;
	}

	// 설정 변경 시 내부 설정 갱신
	updateSettings(settings: GeminiAssistantSettings): void {
		this.settings = settings;
	}

	/**
	 * base URL 해석.
	 * 설정값을 정규화하고, 비어 있으면 기본 엔드포인트(http://localhost:11434)로 폴백한다(Req 2.9).
	 * Ollama는 API 키가 없으므로 인증 헤더를 구성하지 않는다.
	 */
	private baseUrl(): string {
		return resolveBaseUrl(this.settings.ollamaBaseUrl, OLLAMA_DEFAULT_BASE);
	}

	/**
	 * requestUrl 등 네이티브 abort가 없는 Promise에 타임아웃을 적용한다.
	 * timeoutMs 내에 완료되지 않으면 식별 가능한 오류로 reject한다(Req 7.7, 10.6).
	 * 원 Promise는 백그라운드에서 계속 진행될 수 있으나 결과는 무시된다.
	 */
	private withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
		timeoutMessage: string
	): Promise<T> {
		let timer: ReturnType<typeof setTimeout>;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
		});
		return Promise.race([promise, timeout]).finally(() =>
			clearTimeout(timer)
		) as Promise<T>;
	}

	/**
	 * 스트리밍 채팅 호출(Req 4.x).
	 * {base}/api/chat 에 stream:true POST → NDJSON(줄마다 JSON) 수신.
	 *  - 각 줄 message.content 는 onTextDelta 로 전달(Req 4.2)
	 *  - message.tool_calls(객체 인자)는 누적 후 ollamaToolCallsToBlocks 로 변환(Req 5.4, 5.7)
	 *  - done:true 의 done_reason 으로 mapStopReason 적용(Req 4.4, 4.5)
	 * 연결 불가/10초 내 미수립 시 서버 미접속 오류(Req 10.2).
	 * abort 처리는 gemini-client 와 동일: 진입 시 aborted 확인(Req 9.1), 스트림 중 reader.cancel
	 * (Req 9.2~9.4), 부분 텍스트를 보존한 ConverseResult 반환(예외 미전파).
	 */
	async converse(
		messages: ConverseMessage[],
		tools?: ToolDefinition[],
		onTextDelta?: (delta: string) => void,
		abortSignal?: AbortSignal
	): Promise<ConverseResult> {
		// 진입 시 이미 중단된 경우: 요청을 보내지 않고 빈 결과 반환(예외 미전파) - Req 9.1
		if (abortSignal?.aborted) {
			return { contentBlocks: [], stopReason: "end_turn" };
		}

		const base = this.baseUrl();
		const url = `${base}/api/chat`;

		// 시스템 프롬프트(내장 기본 + 사용자 추가 지침 + 스킬)를 첫 system 메시지로 구성
		const fullSystemPrompt = buildSystemPrompt(this.settings);

		const providerMessages = toOllamaMessages(messages);
		// Ollama는 effort 규격이 없고 이 프로젝트는 temperature를 전송하지 않으므로,
		// 샘플링은 모델·서버의 기본 설정을 그대로 사용한다.
		const options: Record<string, unknown> = {
			num_predict: this.settings.maxTokens,
		};
		const body: Record<string, unknown> = {
			model: this.settings.ollamaChatModel,
			messages: [
				{ role: "system", content: fullSystemPrompt },
				...providerMessages,
			],
			stream: true,
			options,
		};

		// 도구 정의가 있으면 tools 파라미터 추가(빈 목록이면 undefined → 생략, Req 5.3)
		const ollamaTools = toOllamaTools(tools ?? []);
		if (ollamaTools) {
			body.tools = ollamaTools;
		}

		// 연결 타임아웃(10초) + 사용자 signal 결합용 컨트롤러
		const controller = new AbortController();
		const connectTimer = setTimeout(
			() => controller.abort(),
			CONNECT_TIMEOUT_MS
		);
		const onUserAbort = () => controller.abort();
		if (abortSignal) {
			abortSignal.addEventListener("abort", onUserAbort);
		}

		let response: Response;
		try {
			response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: controller.signal,
			});
		} catch (e) {
			clearTimeout(connectTimer);
			if (abortSignal) abortSignal.removeEventListener("abort", onUserAbort);
			// 사용자 중단: 예외 미전파, 빈 결과 반환 - Req 9.1
			if (abortSignal?.aborted) {
				return { contentBlocks: [], stopReason: "end_turn" };
			}
			// 연결 불가/10초 내 미수립: 서버 미접속 식별 오류 - Req 10.2
			throw new Error(
				`Ollama 서버에 접속할 수 없습니다 (${base}). Ollama가 실행 중인지 확인하세요.`
			);
		}
		// 응답 수립 → 연결 타임아웃 해제(이후 스트리밍은 사용자 signal로만 제어)
		clearTimeout(connectTimer);

		if (!response.ok) {
			if (abortSignal) abortSignal.removeEventListener("abort", onUserAbort);
			const errText = await response.text().catch(() => "");
			// 공급자 오류 응답(401/404/429 등) 식별 가능 메시지 - Req 10.3, 10.3.1
			throw new Error(
				`Ollama API 오류 (HTTP ${response.status}): ${errText}`
			);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			if (abortSignal) abortSignal.removeEventListener("abort", onUserAbort);
			throw new Error("Ollama 응답 본문이 없습니다");
		}

		const decoder = new TextDecoder();
		let buffer = "";
		let fullText = "";
		const accumulatedToolCalls: unknown[] = [];
		let doneReason: string | null = null;

		// NDJSON 한 줄(완성된 JSON)을 처리한다. 파싱 실패 시 throw(Req 10.5).
		const handleLine = (rawLine: string): void => {
			const trimmed = rawLine.trim();
			if (!trimmed) return;
			let chunk: Record<string, unknown>;
			try {
				chunk = JSON.parse(trimmed);
			} catch (e) {
				throw new Error(
					`Ollama 스트림 JSON 파싱 실패: ${
						e instanceof Error ? e.message : String(e)
					}`
				);
			}
			const msg = chunk.message as Record<string, unknown> | undefined;
			if (msg && typeof msg === "object") {
				if (typeof msg.content === "string" && msg.content) {
					fullText += msg.content;
					onTextDelta?.(msg.content);
				}
				if (Array.isArray(msg.tool_calls)) {
					for (const tc of msg.tool_calls) {
						accumulatedToolCalls.push(tc);
					}
				}
			}
			if (chunk.done === true) {
				doneReason =
					typeof chunk.done_reason === "string"
						? chunk.done_reason
						: null;
			}
		};

		try {
			while (true) {
				// 루프 진입 시 중단 신호를 능동 확인하고 reader를 취소하여 즉시 종료 - Req 9.2
				if (abortSignal?.aborted) {
					await reader.cancel().catch(() => {});
					break;
				}

				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				// 마지막 조각은 미완성일 수 있으므로 버퍼에 보존
				buffer = lines.pop() || "";
				for (const line of lines) {
					handleLine(line);
				}
			}
			// 스트림 종료 후 버퍼에 남은 완성 라인 처리(중단된 경우 제외)
			if (!abortSignal?.aborted && buffer.trim()) {
				handleLine(buffer);
			}
		} catch (e) {
			// 스트리밍 중 사용자 중단: 부분 텍스트 보존, 예외 미전파 - Req 9.2~9.4
			if (!abortSignal?.aborted) {
				if (abortSignal)
					abortSignal.removeEventListener("abort", onUserAbort);
				// 스트리밍/파싱 오류는 부분 결과를 정상 반환하지 않고 전파 - Req 4.7, 10.5
				throw e instanceof Error
					? e
					: new Error(`Ollama 스트리밍 처리 실패: ${String(e)}`);
			}
		} finally {
			if (abortSignal) abortSignal.removeEventListener("abort", onUserAbort);
		}

		// 누적 결과 → ContentBlock 구성
		const contentBlocks: ContentBlock[] = [];
		if (fullText) {
			contentBlocks.push({ type: "text", text: fullText });
		}
		const toolBlocks = ollamaToolCallsToBlocks(accumulatedToolCalls);
		for (const tb of toolBlocks) {
			contentBlocks.push(tb);
		}
		const hasToolUse = toolBlocks.length > 0;
		const stopReason = mapStopReason(doneReason, hasToolUse);

		return { contentBlocks, stopReason };
	}

	/**
	 * 텍스트 임베딩 생성(Req 6.x).
	 * 빈/공백 입력(Req 6.4) 및 빈 모델 ID(Req 6.5)는 요청 없이 오류.
	 * truncateForEmbedding(maxChars=20000)로 절단 후 {base}/api/embeddings (model+prompt) POST →
	 * 벡터 반환(길이 ≥1). 요청 실패 시 오류(Req 6.6).
	 */
	async getEmbedding(text: string): Promise<number[]> {
		// 빈/공백 입력은 요청 없이 잘못된 입력 오류 - Req 6.4
		if (!text || text.trim() === "") {
			throw new Error("임베딩 입력 텍스트가 비어 있습니다");
		}
		// 임베딩 모델 ID 누락은 요청 없이 모델 미설정 오류 - Req 6.5
		const model = this.settings.ollamaEmbeddingModel;
		if (!model || model.trim() === "") {
			throw new Error("Ollama 임베딩 모델 ID가 설정되지 않았습니다");
		}

		const base = this.baseUrl();
		const url = `${base}/api/embeddings`;
		const truncated = truncateForEmbedding(text, EMBEDDING_MAX_CHARS);

		let resp;
		try {
			resp = await this.withTimeout(
				requestUrl({
					url,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ model, prompt: truncated }),
					throw: false,
				}),
				NONSTREAM_TIMEOUT_MS,
				"Ollama 임베딩 요청 시간 초과(60초)"
			);
		} catch (e) {
			// 네트워크 실패/타임아웃: 공급자 오류 응답과 구별되는 오류 - Req 10.6
			throw new Error(
				`Ollama 서버에 접속할 수 없습니다 (${base}): ${
					e instanceof Error ? e.message : String(e)
				}`
			);
		}

		if (resp.status < 200 || resp.status >= 300) {
			// 공급자 오류 응답 식별 가능 메시지 - Req 6.6, 10.3
			throw new Error(`Ollama 임베딩 요청 실패 (HTTP ${resp.status})`);
		}

		const data = resp.json;
		const embedding = data?.embedding;
		if (!Array.isArray(embedding) || embedding.length < 1) {
			throw new Error("Ollama 임베딩 응답에 벡터가 없습니다");
		}
		return embedding as number[];
	}

	/**
	 * 모델 목록 조회(Req 7.x).
	 *  - kind="chat"(기본): {base}/api/tags GET → 설치 모델 전체를 ModelInfo(provider "ollama") 매핑(Req 7.5)
	 *  - kind="embedding": 설치 모델 조회 후 선택적으로 {base}/api/show capability 프로빙하여
	 *    capabilities에 "embedding"이 포함된 모델만 반환. capability 정보를 전혀 얻지 못하면
	 *    설치 모델 전체로 폴백(Req 7.6).
	 * 10초 타임아웃, 실패 시 빈 배열 반환(Req 7.7, 7.8).
	 */
	async listModels(kind: "chat" | "embedding" = "chat"): Promise<ModelInfo[]> {
		try {
			return await this.withTimeout(
				this.fetchModels(kind),
				LIST_MODELS_TIMEOUT_MS,
				"Ollama 모델 목록 조회 시간 초과(10초)"
			);
		} catch (e) {
			// 조회 실패/타임아웃 시 빈 배열 반환(부분 목록 미반환) → 설정 탭은 현재값 유지 - Req 7.8, 7.9
			console.error("Ollama 모델 목록 조회 실패:", e);
			return [];
		}
	}

	/**
	 * listModels 내부 구현(타임아웃 래핑 대상). 설치 모델 조회 및 임베딩 capability 프로빙.
	 */
	private async fetchModels(
		kind: "chat" | "embedding"
	): Promise<ModelInfo[]> {
		const base = this.baseUrl();

		// 설치 모델 전체 조회(api/tags)
		const tagsResp = await requestUrl({
			url: `${base}/api/tags`,
			method: "GET",
			throw: false,
		});
		if (tagsResp.status < 200 || tagsResp.status >= 300) {
			throw new Error(`Ollama 태그 조회 실패 (HTTP ${tagsResp.status})`);
		}
		const data = tagsResp.json;
		const rawModels: unknown[] = Array.isArray(data?.models)
			? data.models
			: [];

		const installed: ModelInfo[] = rawModels
			.map((raw) => {
				const m = (raw ?? {}) as Record<string, unknown>;
				const id =
					typeof m.name === "string"
						? m.name
						: typeof m.model === "string"
						? m.model
						: "";
				return {
					modelId: id,
					modelName: id,
					provider: "ollama",
					isProfile: false,
				};
			})
			.filter((m) => m.modelId !== "");

		// 채팅 목록은 설치 모델 전체 반환 - Req 7.5
		if (kind === "chat") {
			return installed;
		}

		// 임베딩 목록: api/show capability 프로빙 - Req 7.6
		let anyProbeSucceeded = false;
		const embeddingModels: ModelInfo[] = [];
		for (const m of installed) {
			try {
				const showResp = await requestUrl({
					url: `${base}/api/show`,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ model: m.modelId }),
					throw: false,
				});
				if (showResp.status >= 200 && showResp.status < 300) {
					const caps = showResp.json?.capabilities;
					if (Array.isArray(caps)) {
						anyProbeSucceeded = true;
						if (caps.includes("embedding")) {
							embeddingModels.push(m);
						}
					}
				}
			} catch {
				// 개별 모델 프로빙 실패는 무시(graceful) — 전체 폴백 판정에 영향 없음
			}
		}

		// capability 정보를 전혀 얻지 못했으면 설치 모델 전체로 폴백 - Req 7.6
		return anyProbeSucceeded ? embeddingModels : installed;
	}

	/**
	 * 경량 비스트리밍 호출(Req 8.x).
	 * 도구 없는 {base}/api/chat (stream:false) 단일 호출로 텍스트만 추출한다.
	 * maxTokens 인자 적용, 기본값 1024(Req 8.2, 8.3). 텍스트 부재 시 오류(Req 8.5).
	 */
	async converseLight(
		prompt: string,
		systemPrompt = "You are a helpful assistant. Respond only in JSON.",
		maxTokens = DEFAULT_LIGHT_MAX_TOKENS
	): Promise<{ text: string }> {
		const base = this.baseUrl();
		const url = `${base}/api/chat`;
		// Ollama는 effort 규격이 없으므로 출력 길이만 제한한다.
		const lightOptions: Record<string, unknown> = { num_predict: maxTokens };
		const body = {
			model: this.settings.ollamaChatModel,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: prompt },
			],
			stream: false,
			options: lightOptions,
		};

		let resp;
		try {
			resp = await this.withTimeout(
				requestUrl({
					url,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
					throw: false,
				}),
				NONSTREAM_TIMEOUT_MS,
				"Ollama converseLight 요청 시간 초과(60초)"
			);
		} catch (e) {
			// 네트워크 실패/타임아웃 - Req 8.4, 10.6
			throw new Error(
				`Ollama 서버에 접속할 수 없습니다 (${base}): ${
					e instanceof Error ? e.message : String(e)
				}`
			);
		}

		if (resp.status < 200 || resp.status >= 300) {
			// 공급자 오류 응답 - Req 8.4, 10.3
			throw new Error(`Ollama converseLight 실패 (HTTP ${resp.status})`);
		}

		const data = resp.json;
		const content = data?.message?.content;
		if (typeof content !== "string" || content === "") {
			// 텍스트 부재 - Req 8.5
			throw new Error("Ollama converseLight 응답에 텍스트가 없습니다");
		}
		return { text: content };
	}
}
