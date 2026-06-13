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
  filterEmbeddingModels,
  toOpenAITools,
  openAIToolCallsToBlocks,
  toOpenAIMessages,
  supportsTemperature,
} from "./provider-utils";
import { isAbortError } from "./abort-utils";
import { buildSystemPrompt } from "./system-prompt";

// OpenAI 공식 기본 엔드포인트. base URL은 버전 경로(/v1)를 포함한다(Req 2.8.1).
const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
// 임베딩 입력 절단 기준(기존 Gemini/Bedrock과 일관, Req 6.3).
const EMBEDDING_MAX_CHARS = 20000;
// 모델 목록 조회 및 연결 수립 타임아웃(Req 7.1, 7.7).
const LIST_TIMEOUT_MS = 10000;
// 비스트리밍 단일 요청 타임아웃(Req 7.1, 10.6).
const NONSTREAM_TIMEOUT_MS = 60000;

// requestUrl의 입력/출력 타입을 추론하여 별도 타입 import 없이 재사용한다.
type RequestOptions = Parameters<typeof requestUrl>[0];
type RequestResponse = Awaited<ReturnType<typeof requestUrl>>;

// SSE 스트림에서 index별로 누적하는 tool_call 조각.
// function.name과 function.arguments(문자열)를 청크가 도착할 때마다 이어 붙인다.
interface ToolCallAccumulator {
  id?: string;
  name: string;
  args: string;
}

/**
 * OpenAI(및 OpenAI 호환) 백엔드 클라이언트.
 * IAiClient의 5개 메서드를 기존 Gemini/Bedrock 클라이언트와 동일 시그니처로 구현한다(Req 14.5).
 * - 스트리밍 converse는 SSE 수신을 위해 fetch를 사용한다.
 * - 비스트리밍 호출(converseLight/getEmbedding/listModels)은 Obsidian requestUrl을 사용한다.
 * 공급자별 매핑/정규화는 provider-utils의 순수 함수에 위임한다.
 */
export class OpenAIClient implements IAiClient {
  private settings: GeminiAssistantSettings;

  constructor(settings: GeminiAssistantSettings) {
    this.settings = settings;
  }

  // 설정 변경 시 내부 설정 갱신.
  updateSettings(settings: GeminiAssistantSettings): void {
    this.settings = settings;
  }

  // === 내부 헬퍼 ===

  // 엔드포인트 base URL 해석. 사용자 입력 base와 기본 base 모두 /v1을 포함한다(Req 2.7, 2.8.1).
  private baseUrl(): string {
    return resolveBaseUrl(this.settings.openaiBaseUrl, OPENAI_DEFAULT_BASE);
  }

  // API 키 필수 확인. 빈/공백 키면 자격증명 누락 오류를 throw하고 요청을 전송하지 않는다(Req 10.1).
  // 오류 메시지에는 키 원문을 포함하지 않는다(Req 10.4).
  private requireKey(): string {
    const key = this.settings.openaiApiKey ?? "";
    if (key.trim() === "") {
      throw new Error("OpenAI API 키가 설정되지 않았습니다. 설정에서 API 키를 입력하세요.");
    }
    return key;
  }

  // 인증/콘텐츠 타입 헤더. Authorization: Bearer {key} 형식(Req 5.10 인증 헤더).
  private authHeaders(key: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
  }

  // temperature를 공급자 호환 범위(0.0~1.0)로 정렬한다(기존 백엔드와 일관, Req 4.6).
  private alignedTemperature(): number {
    const t = this.settings.temperature;
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.min(1, t));
  }

  // 현재 채팅 모델이 temperature를 지원하는지 여부.
  // gpt-5 계열/o 시리즈 추론 모델은 temperature를 거부하므로 요청에서 생략한다.
  private temperatureSupported(): boolean {
    return supportsTemperature("openai", this.settings.openaiChatModel);
  }

  // HTTP 상태 코드를 식별 가능한 오류 메시지로 변환한다(Req 10.3, 10.3.1).
  // 응답 본문 일부를 덧붙이되 API 키 원문은 메시지에 포함하지 않는다(Req 10.4).
  private httpError(status: number, bodyText: string): Error {
    let kind: string;
    switch (status) {
      case 401:
        kind = "인증 실패(401): API 키를 확인하세요";
        break;
      case 403:
        kind = "권한 없음(403)";
        break;
      case 404:
        kind = "모델 또는 엔드포인트를 찾을 수 없습니다(404)";
        break;
      case 400:
        kind = "잘못된 요청(400)";
        break;
      case 429:
        // 재시도/백오프 없이 즉시 식별 가능한 오류를 반환한다(Req 10.3.1).
        kind = "요청 한도 초과(429)";
        break;
      default:
        kind = `공급자 오류(${status})`;
    }
    const detail = bodyText ? `: ${bodyText.slice(0, 500)}` : "";
    return new Error(`OpenAI API ${kind}${detail}`);
  }

  // requestUrl은 AbortSignal을 지원하지 않으므로 Promise.race로 타임아웃을 구현한다.
  // 타임아웃 초과 시 네트워크 오류와 구별 가능한 시간 초과 오류를 throw한다(Req 10.6).
  private async requestWithTimeout(
    options: RequestOptions,
    timeoutMs: number
  ): Promise<RequestResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(`OpenAI 요청이 시간 초과되었습니다(${timeoutMs / 1000}초).`)
        );
      }, timeoutMs);
    });
    try {
      return await Promise.race([requestUrl(options), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // === IAiClient 구현 ===

  /**
   * 사용 가능한 모델 목록 조회({base}/models GET).
   * kind="chat"(기본)이면 채팅용 모델을, kind="embedding"이면 임베딩 모델만 반환한다(Req 7.1~7.4).
   * 10초 타임아웃을 적용하며(Req 7.7), 실패 시 식별 가능한 오류를 throw한다(Req 7.8, 10.3).
   */
  async listModels(kind: "chat" | "embedding" = "chat"): Promise<ModelInfo[]> {
    // 빈 키면 요청 없이 자격증명 누락 오류(Req 10.1).
    const key = this.requireKey();

    const resp = await this.requestWithTimeout(
      {
        url: `${this.baseUrl()}/models`,
        method: "GET",
        headers: this.authHeaders(key),
        throw: false,
      },
      LIST_TIMEOUT_MS
    );

    if (resp.status < 200 || resp.status >= 300) {
      throw this.httpError(resp.status, resp.text);
    }

    const data = resp.json;
    const rawList: unknown[] = Array.isArray(data?.data) ? data.data : [];
    // /models 응답을 ModelInfo(provider "openai")로 매핑한다(Req 7.3).
    const all: ModelInfo[] = rawList
      .filter(
        (m): m is { id: string } =>
          typeof m === "object" &&
          m !== null &&
          typeof (m as { id?: unknown }).id === "string"
      )
      .map((m) => ({
        modelId: m.id,
        modelName: m.id,
        provider: "openai",
        isProfile: false,
      }));

    if (kind === "embedding") {
      // 채팅/임베딩 혼합 목록에서 임베딩 모델만 좁힌다(Req 7.2, 7.4).
      return filterEmbeddingModels(all);
    }
    // 채팅 목록은 gpt-5.4 / gpt-5.5 계열만 노출한다(드롭다운 큐레이션).
    return all
      .filter((m) => /^gpt-5\.(4|5)/.test(m.modelId))
      .sort((a, b) => b.modelId.localeCompare(a.modelId));
  }

  /**
   * 스트리밍 채팅 호출({base}/chat/completions, stream:true).
   * 텍스트 증분은 onTextDelta로 전달하고, tool_calls는 index별로 누적 후 변환한다.
   * 진입 시 또는 스트리밍 도중 abort되면 부분 텍스트를 보존한 ConverseResult를 반환하며
   * 처리되지 않은 예외를 전파하지 않는다(Req 9.1~9.4). 스트림 오류는 throw한다(Req 4.7).
   */
  async converse(
    messages: ConverseMessage[],
    tools?: ToolDefinition[],
    onTextDelta?: (delta: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ConverseResult> {
    // 호출 시점에 이미 abort 상태면 요청을 전송하지 않고 빈 부분 결과를 반환한다(Req 9.1).
    if (abortSignal?.aborted) {
      return { contentBlocks: [], stopReason: "end_turn" };
    }

    // 빈 키면 요청 없이 자격증명 누락 오류(Req 10.1).
    const key = this.requireKey();

    const body: Record<string, unknown> = {
      model: this.settings.openaiChatModel,
      // 내장 기본 시스템 프롬프트(+사용자 추가 지침+스킬)를 첫 system 메시지로 주입한다.
      messages: [
        { role: "system", content: buildSystemPrompt(this.settings) },
        ...toOpenAIMessages(messages),
      ],
      max_tokens: this.settings.maxTokens,
      stream: true,
    };
    // temperature 미지원 모델(gpt-5/o 시리즈)에는 파라미터를 생략한다(거부 방지).
    if (this.temperatureSupported()) {
      body.temperature = this.alignedTemperature();
    }
    // 도구 목록이 비어 있으면 toOpenAITools가 undefined를 반환하여 tools를 생략한다(Req 5.3).
    const toolDefs = toOpenAITools(tools ?? []);
    if (toolDefs) {
      body.tools = toolDefs;
    }

    // 사용자 signal과 연결 타임아웃을 결합한 AbortController.
    // 스트리밍은 전체 응답 시간이 아니라 연결/응답 개시 기준으로 타임아웃을 적용한다(Req 7.1).
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (abortSignal) abortSignal.addEventListener("abort", onAbort);
    const connectTimer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl()}/chat/completions`, {
        method: "POST",
        headers: this.authHeaders(key),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // 응답 헤더 수신 → 연결 타임아웃 해제(이후 스트리밍은 시간 제한 없음).
      clearTimeout(connectTimer);

      if (!response.ok) {
        const errText = await response.text();
        throw this.httpError(response.status, errText);
      }

      return await this.readStream(response, onTextDelta, abortSignal);
    } catch (error) {
      // 사용자 abort 또는 연결 타임아웃에 의한 중단은 부분 결과로 정상 종료한다(Req 9.3, 9.4).
      if (isAbortError(error, abortSignal) || controller.signal.aborted) {
        return { contentBlocks: [], stopReason: "end_turn" };
      }
      // 그 외 스트림/네트워크 오류는 부분 응답을 정상 반환하지 않고 전파한다(Req 4.7, 10.6).
      throw error;
    } finally {
      clearTimeout(connectTimer);
      if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
    }
  }

  // SSE 스트림을 읽어 텍스트/도구 호출을 누적하고 ConverseResult로 조립한다.
  private async readStream(
    response: Response,
    onTextDelta?: (delta: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ConverseResult> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("OpenAI 응답 본문(스트림)을 읽을 수 없습니다.");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let finishReason: string | null = null;
    const toolCallsByIndex = new Map<number, ToolCallAccumulator>();
    let aborted = false;

    while (true) {
      // 루프 진입 시 중지 신호를 능동 확인하고 reader를 취소하여 즉시 종료한다(Req 9.2).
      if (abortSignal?.aborted) {
        await reader.cancel().catch(() => {});
        aborted = true;
        break;
      }

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        // abort에 의한 read 거부는 부분 결과를 보존하고 종료한다(Req 9.3).
        if (isAbortError(e, abortSignal)) {
          aborted = true;
          break;
        }
        // 그 외 스트림 오류는 전파한다(Req 4.7).
        throw e;
      }
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      // 마지막(불완전할 수 있는) 라인은 다음 청크와 합치기 위해 버퍼에 남겨둔다.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "") continue;
        // 종료 신호. finish_reason은 직전 청크에서 이미 수집되어 있다.
        if (dataStr === "[DONE]") continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          // 완성된 라인만 처리하므로 파싱 실패는 드물다. 불완전 조각은 건너뛴다.
          continue;
        }

        const choices = (parsed.choices as unknown[]) ?? [];
        const choice = choices[0] as Record<string, unknown> | undefined;
        if (!choice) continue;

        const delta = choice.delta as Record<string, unknown> | undefined;
        if (delta) {
          // 텍스트 증분 → onTextDelta로 전달(Req 4.2).
          if (typeof delta.content === "string" && delta.content !== "") {
            fullText += delta.content;
            onTextDelta?.(delta.content);
          }
          // tool_calls 증분을 index별로 name/arguments(문자열) 누적.
          const toolCalls = delta.tool_calls as unknown[] | undefined;
          if (Array.isArray(toolCalls)) {
            for (const tcRaw of toolCalls) {
              const tc = tcRaw as Record<string, unknown>;
              const idx = typeof tc.index === "number" ? tc.index : 0;
              const acc = toolCallsByIndex.get(idx) ?? { name: "", args: "" };
              if (typeof tc.id === "string" && tc.id !== "") acc.id = tc.id;
              const fn = tc.function as Record<string, unknown> | undefined;
              if (fn) {
                if (typeof fn.name === "string" && fn.name !== "") acc.name = fn.name;
                if (typeof fn.arguments === "string") acc.args += fn.arguments;
              }
              toolCallsByIndex.set(idx, acc);
            }
          }
        }

        if (typeof choice.finish_reason === "string") {
          finishReason = choice.finish_reason;
        }
      }
    }

    // abort 시에는 부분 텍스트만 보존하고 도구 호출 파싱은 시도하지 않는다(Req 9.3).
    if (aborted) {
      const blocks: ContentBlock[] = [];
      if (fullText) blocks.push({ type: "text", text: fullText });
      return { contentBlocks: blocks, stopReason: "end_turn" };
    }

    return this.buildResult(fullText, toolCallsByIndex, finishReason);
  }

  // 누적된 텍스트/도구 호출과 finish_reason으로 ConverseResult를 조립한다.
  private buildResult(
    fullText: string,
    toolCallsByIndex: Map<number, ToolCallAccumulator>,
    finishReason: string | null
  ): ConverseResult {
    const contentBlocks: ContentBlock[] = [];
    if (fullText) {
      contentBlocks.push({ type: "text", text: fullText });
    }

    const hasToolUse = toolCallsByIndex.size > 0;
    if (hasToolUse) {
      // index 오름차순으로 정렬하여 OpenAI tool_calls 형태로 재구성한다.
      const ordered = Array.from(toolCallsByIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([, v]) => ({
          id: v.id,
          type: "function",
          function: { name: v.name, arguments: v.args },
        }));
      // JSON 인자 파싱 실패 시 오류를 전파한다(Req 5.6).
      const toolBlocks = openAIToolCallsToBlocks(ordered);
      for (const tb of toolBlocks) contentBlocks.push(tb);
    }

    // 도구 호출이 있으면 항상 "tool_use", 아니면 finish_reason을 내부 값으로 매핑(Req 4.4, 4.5).
    const stopReason = mapStopReason(finishReason, hasToolUse);
    return { contentBlocks, stopReason };
  }

  /**
   * 텍스트 임베딩 생성({base}/embeddings POST).
   * 빈/공백 입력 또는 빈 모델 ID는 요청 없이 오류로 처리한다(Req 6.4, 6.5).
   * 입력을 절단한 뒤 data[0].embedding(길이≥1 유한 배열)을 반환한다(Req 6.1, 6.3).
   * 요청 실패/파싱 실패 시 오류를 throw한다(Req 6.6, 10.5).
   */
  async getEmbedding(text: string): Promise<number[]> {
    // 빈 키면 요청 없이 자격증명 누락 오류(Req 10.1).
    const key = this.requireKey();

    if (!text || text.trim() === "") {
      throw new Error("임베딩 입력 텍스트가 비어 있습니다.");
    }
    const model = this.settings.openaiEmbeddingModel;
    if (!model || model.trim() === "") {
      throw new Error("OpenAI 임베딩 모델 ID가 설정되지 않았습니다.");
    }

    const input = truncateForEmbedding(text, EMBEDDING_MAX_CHARS);
    const resp = await this.requestWithTimeout(
      {
        url: `${this.baseUrl()}/embeddings`,
        method: "POST",
        headers: this.authHeaders(key),
        body: JSON.stringify({ model, input }),
        throw: false,
      },
      NONSTREAM_TIMEOUT_MS
    );

    if (resp.status < 200 || resp.status >= 300) {
      throw this.httpError(resp.status, resp.text);
    }

    const data = resp.json;
    const embedding = data?.data?.[0]?.embedding;
    if (
      !Array.isArray(embedding) ||
      embedding.length < 1 ||
      !embedding.every((n: unknown) => typeof n === "number" && Number.isFinite(n))
    ) {
      throw new Error("OpenAI 임베딩 응답이 유효한 벡터를 포함하지 않습니다.");
    }
    return embedding as number[];
  }

  /**
   * 경량 converse 호출. 도구 없는 비스트리밍 {base}/chat/completions 단일 호출로
   * 텍스트만 추출한다(Req 8.1). maxTokens 인자를 적용하며 기본값은 1024이다(Req 8.2, 8.3).
   * 응답 텍스트가 없거나 공백만 있으면 오류를 throw한다(Req 8.5).
   */
  async converseLight(
    prompt: string,
    systemPrompt = "You are a helpful assistant. Respond only in JSON.",
    maxTokens = 1024
  ): Promise<{ text: string }> {
    // 빈 키면 요청 없이 자격증명 누락 오류(Req 10.1).
    const key = this.requireKey();

    const resp = await this.requestWithTimeout(
      {
        url: `${this.baseUrl()}/chat/completions`,
        method: "POST",
        headers: this.authHeaders(key),
        body: JSON.stringify({
          model: this.settings.openaiChatModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          max_tokens: maxTokens,
          // temperature 미지원 모델에는 생략한다(gpt-5/o 시리즈는 0을 거부).
          ...(this.temperatureSupported() ? { temperature: 0 } : {}),
          stream: false,
        }),
        throw: false,
      },
      NONSTREAM_TIMEOUT_MS
    );

    if (resp.status < 200 || resp.status >= 300) {
      throw this.httpError(resp.status, resp.text);
    }

    const data = resp.json;
    const textValue = data?.choices?.[0]?.message?.content;
    if (typeof textValue !== "string" || textValue.trim() === "") {
      throw new Error("OpenAI converseLight 응답에 텍스트가 없습니다.");
    }
    return { text: textValue };
  }
}
