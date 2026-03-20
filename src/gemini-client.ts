import { requestUrl } from "obsidian";
import type {
  GeminiAssistantSettings,
  ToolDefinition,
  ConverseMessage,
  ConverseResult,
  ContentBlock,
  ModelInfo,
} from "./types";
import { buildSkillsPrompt } from "./skills";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Gemini API 클라이언트 (BedrockClient와 동일한 public 인터페이스)
export class GeminiClient {
  private settings: GeminiAssistantSettings;

  constructor(settings: GeminiAssistantSettings) {
    this.settings = settings;
  }

  // 설정 변경 시 업데이트
  updateSettings(settings: GeminiAssistantSettings) {
    this.settings = settings;
  }

  // 사용 가능한 모델 목록 반환
  async listModels(): Promise<ModelInfo[]> {
    try {
      const url = `${GEMINI_BASE}/models?key=${this.settings.geminiApiKey}`;
      const resp = await requestUrl({ url, method: "GET" });
      const data = resp.json;
      if (!data.models) return [];

      const models: ModelInfo[] = [];
      for (const m of data.models) {
        const id = (m.name as string).replace("models/", "");
        // generateContent를 지원하는 모델만 필터
        const methods: string[] = m.supportedGenerationMethods || [];
        if (!methods.includes("generateContent")) continue;
        // 임베딩 전용 모델 제외
        if (id.includes("embedding")) continue;
        models.push({
          modelId: id,
          modelName: m.displayName || id,
          provider: "Google",
          isProfile: false,
        });
      }

      // gemini 모델만 필터하고 정렬 (최신 버전 우선)
      return models
        .filter((m) => m.modelId.startsWith("gemini-"))
        .sort((a, b) => b.modelId.localeCompare(a.modelId));
    } catch (e) {
      console.error("모델 목록 조회 실패:", e);
      return [];
    }
  }

  // ConverseMessage → Gemini contents 변환
  private convertMessages(messages: ConverseMessage[]): unknown[] {
    const contents: unknown[] = [];
    for (const msg of messages) {
      const role = msg.role === "assistant" ? "model" : "user";
      const parts: unknown[] = [];

      for (const block of msg.content as unknown[]) {
        if (typeof block === "object" && block !== null) {
          const b = block as Record<string, unknown>;
          if ("text" in b && typeof b.text === "string") {
            const textPart: Record<string, unknown> = { text: b.text };
            // 텍스트 파트의 thoughtSignature 보존 (Gemini 3.x 권장)
            if (b.thoughtSignature) {
              textPart.thoughtSignature = b.thoughtSignature;
            }
            parts.push(textPart);
          } else if ("toolResult" in b) {
            // 도구 결과 → functionResponse
            const tr = b.toolResult as Record<string, unknown>;
            const resultContent = tr.content as unknown[];
            let responseText = "";
            if (Array.isArray(resultContent)) {
              for (const rc of resultContent) {
                if (typeof rc === "object" && rc !== null && "text" in (rc as Record<string, unknown>)) {
                  responseText += (rc as Record<string, unknown>).text;
                }
              }
            }
            // Gemini functionResponse.name은 도구 이름이어야 함
            // Bedrock toolUseId에 Gemini에서는 도구 이름이 들어감
            parts.push({
              functionResponse: {
                name: (tr.name as string) || (tr.toolUseId as string) || "unknown",
                response: { result: responseText },
              },
            });
          } else if ("toolUse" in b) {
            // 도구 호출 → functionCall (어시스턴트 메시지에서)
            const tu = b.toolUse as Record<string, unknown>;
            const fc: Record<string, unknown> = {
              functionCall: {
                name: tu.name,
                args: tu.input || {},
              },
            };
            // Gemini 3.x thought signature 보존 (필수)
            if (tu.thoughtSignature) {
              fc.thoughtSignature = tu.thoughtSignature;
            }
            parts.push(fc);
          }
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }
    return contents;
  }

  // ToolDefinition → Gemini functionDeclarations 변환
  private convertTools(tools: ToolDefinition[]): unknown[] {
    const declarations = tools.map((t) => {
      const params = this.convertSchema(t.input_schema);
      const decl: Record<string, unknown> = {
        name: t.name,
        description: t.description,
      };
      // 파라미터가 있는 경우에만 포함 (빈 properties 방지)
      const props = params.properties as Record<string, unknown> | undefined;
      if (props && Object.keys(props).length > 0) {
        decl.parameters = params;
      }
      return decl;
    });
    return [{ functionDeclarations: declarations }];
  }

  // JSON Schema → Gemini 호환 스키마 변환
  private convertSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (schema.type) result.type = (schema.type as string).toUpperCase();
    if (schema.description) result.description = schema.description;
    if (schema.properties) {
      const props: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(schema.properties as Record<string, unknown>)) {
        props[key] = this.convertSchema(val as Record<string, unknown>);
      }
      result.properties = props;
    }
    if (schema.required) result.required = schema.required;
    if (schema.items) result.items = this.convertSchema(schema.items as Record<string, unknown>);
    if (schema.enum) result.enum = schema.enum;
    return result;
  }

  // 스트리밍 채팅 (Gemini streamGenerateContent)
  async converse(
    messages: ConverseMessage[],
    tools?: ToolDefinition[],
    onTextDelta?: (text: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ConverseResult> {
    const skillsPrompt = buildSkillsPrompt(this.settings.enabledSkills || []);
    const fullSystemPrompt = this.settings.systemPrompt + skillsPrompt;

    const contents = this.convertMessages(messages);
    const body: Record<string, unknown> = {
      contents,
      systemInstruction: { parts: [{ text: fullSystemPrompt }] },
      generationConfig: {
        maxOutputTokens: this.settings.maxTokens,
        temperature: this.settings.temperature,
      },
    };

    if (tools && tools.length > 0) {
      body.tools = this.convertTools(tools);
      // 도구 호출 모드를 AUTO로 설정하여 적극적으로 function calling 수행
      body.tool_config = { function_calling_config: { mode: "AUTO" } };
    }

    const model = this.settings.chatModel;

    // 스트리밍 시도
    try {
      return await this.streamGenerate(model, body, onTextDelta, abortSignal);
    } catch (error) {
      if (abortSignal?.aborted) throw error;
      return await this.nonStreamGenerate(model, body, onTextDelta);
    }
  }

  // 스트리밍 호출 (SSE)
  // Obsidian의 requestUrl은 SSE 스트리밍을 지원하지 않으므로 fetch API를 직접 사용
  private async streamGenerate(
    model: string,
    body: Record<string, unknown>,
    onTextDelta?: (text: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ConverseResult> {
    const url = `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${this.settings.geminiApiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    const contentBlocks: ContentBlock[] = [];
    let fullText = "";
    let stopReason = "end_turn";
    // 텍스트 파트의 마지막 thoughtSignature 추적 (Gemini 3.x 권장 보존)
    let lastTextThoughtSignature: string | undefined;

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const chunk = JSON.parse(jsonStr);
          const candidates = chunk.candidates;
          if (!candidates || candidates.length === 0) continue;

          const parts = candidates[0].content?.parts;
          if (!parts) continue;

          for (const part of parts) {
            if (part.text) {
              fullText += part.text;
              onTextDelta?.(part.text);
            }
            // 텍스트 파트(빈 텍스트 포함)의 thoughtSignature 추적
            if ("text" in part && part.thoughtSignature) {
              lastTextThoughtSignature = part.thoughtSignature;
            }
            if (part.functionCall) {
              const toolBlock: ContentBlock = {
                type: "tool_use",
                toolUseId: part.functionCall.name || `call_${Date.now()}`,
                name: part.functionCall.name,
                input: part.functionCall.args || {},
              };
              // Gemini 3.x thought signature 보존 (function calling 시 필수)
              if (part.thoughtSignature) {
                (toolBlock as import("./types").ContentBlockToolUse).thoughtSignature = part.thoughtSignature;
              }
              contentBlocks.push(toolBlock);
            }
          }

          // 종료 이유 확인
          if (candidates[0].finishReason) {
            const reason = candidates[0].finishReason;
            if (reason === "STOP") stopReason = "end_turn";
            else if (reason === "MAX_TOKENS") stopReason = "max_tokens";
            else stopReason = reason;
          }
        } catch {
          // JSON 파싱 실패 무시
        }
      }
    }

    if (fullText) {
      const textBlock: ContentBlock = { type: "text", text: fullText };
      // 텍스트 파트의 thoughtSignature 보존 (Gemini 3.x 권장)
      if (lastTextThoughtSignature) {
        (textBlock as import("./types").ContentBlockText).thoughtSignature = lastTextThoughtSignature;
      }
      contentBlocks.unshift(textBlock);
    }

    // Gemini는 function call 시에도 finishReason이 STOP일 수 있음
    // contentBlocks에 tool_use가 있으면 stopReason을 "tool_use"로 강제 설정
    const hasToolUse = contentBlocks.some((b) => b.type === "tool_use");
    if (hasToolUse) {
      stopReason = "tool_use";
    }

    return { contentBlocks, stopReason };
  }


  // 비스트리밍 호출 (requestUrl 사용, 스트리밍 실패 시 폴백)
  private async nonStreamGenerate(
    model: string,
    body: Record<string, unknown>,
    onTextDelta?: (text: string) => void
  ): Promise<ConverseResult> {
    const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${this.settings.geminiApiKey}`;

    const resp = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = resp.json;
    const contentBlocks: ContentBlock[] = [];
    let stopReason = "end_turn";

    const candidates = data.candidates;
    if (candidates && candidates.length > 0) {
      const parts = candidates[0].content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.text) {
            const textBlock: ContentBlock = { type: "text", text: part.text };
            // 텍스트 파트의 thoughtSignature 보존 (Gemini 3.x 권장)
            if (part.thoughtSignature) {
              (textBlock as import("./types").ContentBlockText).thoughtSignature = part.thoughtSignature;
            }
            contentBlocks.push(textBlock);
            onTextDelta?.(part.text);
          }
          if (part.functionCall) {
            const toolBlock: ContentBlock = {
              type: "tool_use",
              toolUseId: part.functionCall.name || `call_${Date.now()}`,
              name: part.functionCall.name,
              input: part.functionCall.args || {},
            };
            // Gemini 3.x thought signature 보존 (function calling 시 필수)
            if (part.thoughtSignature) {
              (toolBlock as import("./types").ContentBlockToolUse).thoughtSignature = part.thoughtSignature;
            }
            contentBlocks.push(toolBlock);
          }
        }
      }

      if (candidates[0].finishReason) {
        const reason = candidates[0].finishReason;
        if (reason === "STOP") stopReason = "end_turn";
        else if (reason === "MAX_TOKENS") stopReason = "max_tokens";
        else stopReason = reason;
      }
    }

    // Gemini는 function call 시에도 finishReason이 STOP일 수 있음
    const hasToolUse = contentBlocks.some((b) => b.type === "tool_use");
    if (hasToolUse) {
      stopReason = "tool_use";
    }

    return { contentBlocks, stopReason };
  }

  // Gemini 임베딩 생성
  async getEmbedding(text: string): Promise<number[]> {
    // 텍스트 길이 제한
    const truncated = text.slice(0, 20000);
    const model = this.settings.embeddingModel;
    const url = `${GEMINI_BASE}/models/${model}:embedContent?key=${this.settings.geminiApiKey}`;

    const resp = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text: truncated }] },
      }),
    });

    const data = resp.json;
    if (!data.embedding?.values) {
      throw new Error("임베딩 응답에 values가 없습니다");
    }
    return data.embedding.values;
  }

  /**
   * 경량 converse 호출 (시스템 프롬프트/스킬 없이, 낮은 maxTokens)
   * 분류, 요약 등 간단한 작업에 사용
   */
  async converseLight(
    userText: string,
    systemText = "You are a helpful assistant. Respond only in JSON.",
    maxTokens = 1024
  ): Promise<{ text: string }> {
    const model = this.settings.chatModel;
    const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${this.settings.geminiApiKey}`;

    const resp = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userText }] }],
        systemInstruction: { parts: [{ text: systemText }] },
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0 },
      }),
    });

    const data = resp.json;
    const candidates = data.candidates;
    if (candidates && candidates.length > 0) {
      const parts = candidates[0].content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.text) {
            return { text: part.text };
          }
        }
      }
    }
    throw new Error("converseLight 응답에 텍스트가 없습니다");
  }
}
