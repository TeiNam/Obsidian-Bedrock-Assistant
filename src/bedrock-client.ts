import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  BedrockClient as BedrockControlClient,
  ListInferenceProfilesCommand,
  ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";
import type {
  EffortLevel,
  GeminiAssistantSettings,
  IAiClient,
  ToolDefinition,
  ConverseMessage,
  ConverseResult,
  ContentBlock,
  ModelInfo,
} from "./types";
import {
  buildEffortParams,
  chatModelRank,
  compareModelVersion,
  inferProviderName,
  supportsPromptCaching,
} from "./provider-utils";
import { buildSystemPromptSegments } from "./system-prompt";
import { noticeI18n } from "./notice-i18n";

/** 임베딩 입력 최대 글자 수 (Titan v2 8192 토큰 기준의 보수적 상한). */
const EMBEDDING_MAX_CHARS = 20000;

/**
 * SigV4 서명 스킴 식별자. 프로필 인증과 fail-closed 경로에서 이 값으로 고정한다.
 *
 * 고정하지 않으면 AWS SDK가 환경변수 `AWS_BEARER_TOKEN_BEDROCK`을 감지해
 * authSchemePreference를 `["httpBearerAuth"]`로 자동 승격시키고(@aws-sdk/core의
 * NODE_AUTH_SCHEME_PREFERENCE_OPTIONS), 그러면 우리가 넣은 credentials 공급자를
 * 아예 호출하지 않는다. 즉 사용자가 프로필을 명시하거나 인증값을 비워 fail-closed로
 * 막아뒀는데도 환경에 남은 다른 계정의 토큰으로 요청이 나간다.
 */
const SIGV4_AUTH_SCHEME = "aws.auth#sigv4";

/** 베어러 토큰 스킴 식별자. Bedrock API 키 인증에서만 사용한다. */
const BEARER_AUTH_SCHEME = "httpBearerAuth";

/** Titan 임베딩 요청 시 지정할 출력 차원. Titan v2만 이 파라미터를 받는다. */
const TITAN_EMBED_DIMENSIONS = 512;

/**
 * 지원하는 임베딩 모델인지 판별한다.
 * 요청/응답 스키마를 구현한 벤더만 허용한다(Amazon Titan, Cohere Embed).
 */
export function isSupportedEmbeddingModel(modelId: string): boolean {
  const id = (modelId ?? "").toLowerCase();
  return /titan-embed/.test(id) || /cohere\.embed/.test(id);
}

/**
 * 모델별 임베딩 요청 본문을 구성한다.
 *  - Amazon Titan v2: `{ inputText, dimensions, normalize }`
 *  - Amazon Titan v1: `{ inputText }` (dimensions 미지원 — 전달하면 오류)
 *  - Cohere Embed: `{ texts: [...], input_type }`
 */
export function buildEmbeddingRequest(modelId: string, text: string): Record<string, unknown> {
  const id = (modelId ?? "").toLowerCase();

  if (/cohere\.embed/.test(id)) {
    // Cohere는 배열 입력과 용도(input_type) 지정을 요구한다.
    return { texts: [text], input_type: "search_document" };
  }

  // Titan: v2만 dimensions/normalize를 받는다. v1에 전달하면 ValidationException.
  const isTitanV2 = /titan-embed-text-v2/.test(id);
  return isTitanV2
    ? { inputText: text, dimensions: TITAN_EMBED_DIMENSIONS, normalize: true }
    : { inputText: text };
}

/**
 * 모델별 임베딩 응답에서 벡터를 추출한다. 해석할 수 없으면 null.
 *  - Titan: `{ embedding: number[] }`
 *  - Cohere: `{ embeddings: number[][] }`
 */
export function extractEmbedding(modelId: string, body: unknown): number[] | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;

  // Titan 형식
  if (Array.isArray(obj.embedding)) return obj.embedding as number[];

  // Cohere 형식(배열의 배열) — 첫 벡터를 사용한다(입력 텍스트가 1개이므로).
  if (Array.isArray(obj.embeddings)) {
    const first = (obj.embeddings as unknown[])[0];
    if (Array.isArray(first)) return first as number[];
    // 일부 응답은 { embeddings: { float: number[][] } } 형태를 쓴다.
  }
  const nested = obj.embeddings as Record<string, unknown> | undefined;
  if (nested && Array.isArray(nested.float)) {
    const first = (nested.float as unknown[])[0];
    if (Array.isArray(first)) return first as number[];
  }

  return null;
}

/**
 * Bedrock 클라이언트 설정을 구성한다. API 키(베어러 토큰) 단독 인증만 지원한다.
 *
 * 키가 비어 있으면 fail-closed로 처리한다. SDK 기본 자격증명 체인으로 폴백하면
 * 사용자가 선택하지 않은 AWS 계정으로 프롬프트가 전송되고 과금될 수 있기 때문이다.
 * 특히 볼트 인덱싱은 자동으로 대량 호출하므로 사용자가 알아차리기 전에 번진다 —
 * `~/.aws/credentials`의 `[default]` 프로필이나 환경변수·IAM 역할이 조용히
 * 집히는 경로를 남기지 않는다.
 *
 * authSchemePreference를 항상 고정하는 이유: AWS SDK는 환경변수
 * `AWS_BEARER_TOKEN_BEDROCK`을 감지하면 authSchemePreference를 `["httpBearerAuth"]`로
 * 자동 승격시키고(@aws-sdk/core의 NODE_AUTH_SCHEME_PREFERENCE_OPTIONS), 그러면
 * credentials 공급자를 아예 호출하지 않는다. 즉 fail-closed 공급자를 넣어도
 * 환경에 남은 다른 계정의 토큰으로 요청이 나간다. 스킴을 명시적으로 고정해 막는다.
 *
 * 순수 함수로 분리해 단위 테스트가 가능하게 한다(SDK 인스턴스화 없이 검증).
 */
export function buildBedrockClientConfig(
  settings: GeminiAssistantSettings
): Record<string, unknown> {
  const config: Record<string, unknown> = { region: settings.awsRegion };

  // 손상된 data.json(수동 편집·동기화 충돌)에 문자열이 아닌 값이 들어올 수 있다.
  // `?.`는 null/undefined만 막으므로 숫자·객체에서 .trim()이 TypeError를 던지고,
  // 이 함수는 BedrockClient 생성자에서 호출되어 onload 전체가 실패한다. 플러그인이
  // 아예 뜨지 않으면 사용자는 설정을 고칠 수도 없으므로, 빈 값으로 보고 fail-closed로 넘긴다.
  const raw = settings.bedrockApiKey;
  const apiKey = typeof raw === "string" ? raw.trim() : "";
  if (apiKey) {
    config.token = { token: apiKey };
    config.authSchemePreference = [BEARER_AUTH_SCHEME];
  } else {
    config.credentials = () =>
      Promise.reject(
        new Error(noticeI18n(settings.language).errNoApiKey("Bedrock"))
      );
    // 값이 비어도 스킴을 고정한다 — authSchemePreference 주석 참조.
    config.authSchemePreference = [SIGV4_AUTH_SCHEME];
  }

  return config;
}

// Bedrock API 클라이언트 (IAiClient 인터페이스 구현)
export class BedrockClient implements IAiClient {
  private client: BedrockRuntimeClient;
  private settings: GeminiAssistantSettings;

  constructor(settings: GeminiAssistantSettings) {
    this.settings = settings;
    this.client = this.createClient();
  }

  // 설정 변경 시 클라이언트 재생성
  updateSettings(settings: GeminiAssistantSettings) {
    this.settings = settings;
    this.client = this.createClient();
  }

  /** 인증 방식별 클라이언트 설정 구성 (buildBedrockClientConfig에 위임) */
  private buildClientConfig(): Record<string, unknown> {
    return buildBedrockClientConfig(this.settings);
  }

  private createClient(): BedrockRuntimeClient {
    const config = this.buildClientConfig();
    return new BedrockRuntimeClient(config as any);
  }

  /**
   * Converse 입력에 펼쳐 넣을 effort 관련 필드를 구성한다.
   * effort 지원 모델이면 `{ additionalModelRequestFields: {...} }`, 아니면 빈 객체.
   */
  private effortRequestFields(effort: EffortLevel): Record<string, unknown> {
    const fields = buildEffortParams("bedrock", this.settings.bedrockChatModel, effort);
    return Object.keys(fields).length > 0 ? { additionalModelRequestFields: fields } : {};
  }

  // 사용 가능한 모델 목록 반환 (Bedrock 추론 프로파일에서 최신 Claude 모델 조회)
  // 사용 가능한 모델 목록 반환.
  //  - kind="chat"(기본): Bedrock 추론 프로파일에서 최신 Claude 채팅 모델 조회(기존 동작)
  //  - kind="embedding": Bedrock 파운데이션 모델 중 텍스트 임베딩 모델만 조회
  //    (예: amazon.titan-embed-text-v2:0). 임베딩 드롭다운이 채팅 모델을 보여주던 문제 해결.
  async listModels(kind: "chat" | "embedding" = "chat"): Promise<ModelInfo[]> {
    if (kind === "embedding") {
      return this.listEmbeddingModels();
    }
    try {
      const controlClient = this.createControlClient();
      const resp = await controlClient.send(
        new ListInferenceProfilesCommand({ typeEquals: "SYSTEM_DEFINED" })
      );

      if (!resp.inferenceProfileSummaries) return [];

      // 채팅 모델 계열(Claude opus/sonnet/haiku, GPT sol/terra/luna)만 필터.
      // 계열 판별은 provider-utils.chatModelRank에 위임한다.
      const models: Array<ModelInfo & { rank: number }> = [];
      for (const p of resp.inferenceProfileSummaries) {
        if (!p.inferenceProfileId || !p.inferenceProfileName) continue;
        // "global." 접두사가 있는 글로벌 프로파일만
        if (!p.inferenceProfileId.startsWith("global.")) continue;

        const rank = chatModelRank(p.inferenceProfileId);
        if (rank === null) continue;

        models.push({
          modelId: p.inferenceProfileId,
          modelName: p.inferenceProfileName,
          provider: inferProviderName(p.inferenceProfileId),
          isProfile: true,
          rank,
        });
      }

      // 같은 계열에서 최신 버전만 남기기 (계열 = chatModelRank 그룹)
      const bestByFamily = new Map<number, ModelInfo & { rank: number }>();
      for (const m of models) {
        const existing = bestByFamily.get(m.rank);
        if (!existing || compareModelVersion(m.modelId, existing.modelId) > 0) {
          bestByFamily.set(m.rank, m);
        }
      }

      // 계열 우선순위 순으로 정렬
      return Array.from(bestByFamily.values())
        .sort((a, b) => a.rank - b.rank)
        .map(({ rank: _rank, ...m }) => m);
    } catch (e) {
      console.error("모델 목록 조회 실패:", e);
      return [];
    }
  }

  // Bedrock 텍스트 임베딩 파운데이션 모델 목록 조회.
  // ListFoundationModels를 outputModality=EMBEDDING으로 필터하고, 텍스트 입력을 지원하는
  // 모델(예: amazon.titan-embed-text-v2:0, cohere.embed-*)만 ModelInfo로 매핑한다.
  private async listEmbeddingModels(): Promise<ModelInfo[]> {
    try {
      const controlClient = this.createControlClient();
      const resp = await controlClient.send(
        new ListFoundationModelsCommand({ byOutputModality: "EMBEDDING" })
      );

      const summaries = resp.modelSummaries ?? [];
      const models: ModelInfo[] = [];
      for (const m of summaries) {
        if (!m.modelId) continue;
        // 텍스트 임베딩 모델만 노출(이미지 전용 임베딩 등 제외)
        const inputs = m.inputModalities ?? [];
        if (inputs.length > 0 && !inputs.includes("TEXT")) continue;
        // 요청/응답 형식을 지원하는 모델만 노출한다. 지원하지 않는 모델을 고르면
        // 모든 임베딩 호출이 실패하므로 드롭다운에서 제외하는 것이 안전하다.
        if (!isSupportedEmbeddingModel(m.modelId)) continue;

        models.push({
          modelId: m.modelId,
          modelName: m.modelName || m.modelId,
          provider: m.providerName || "Amazon",
          isProfile: false,
        });
      }
      return models;
    } catch (e) {
      console.error("Bedrock 임베딩 모델 목록 조회 실패:", e);
      return [];
    }
  }

  // Bedrock 컨트롤 플레인 클라이언트 생성 (모델 목록 조회용)
  private createControlClient(): BedrockControlClient {
    const config = this.buildClientConfig();
    return new BedrockControlClient(config as any);
  }

  // Converse API 입력 구성
  private buildInput(
    messages: ConverseMessage[],
    tools?: ToolDefinition[]
  ): Record<string, unknown> {
    const { stable, volatile } = buildSystemPromptSegments(this.settings);

    // 프롬프트 캐싱: 안정 접두어와 매 요청 변하는 시각 블록 사이에 캐시 경계를 둔다.
    //
    // 캐싱은 접두어가 바이트 단위로 같을 때만 적중한다. 시각 블록을 같은 text 블록에
    // 넣으면 분마다 접두어가 달라져 캐시가 매번 무효화된다. system 배열을
    // [안정, cachePoint, 시각]으로 쪼개면 기본 프롬프트와 스킬 지식은 캐시에 남는다.
    //
    // 지원 모델이 아니거나 접두어가 최소 길이에 못 미치면 마커 없이 보낸다 —
    // 캐싱은 최적화이고, 최적화가 요청을 깨서는 안 된다.
    const cacheable = supportsPromptCaching(
      "bedrock",
      this.settings.bedrockChatModel,
      stable.length
    );
    const system = cacheable
      ? [{ text: stable }, { cachePoint: { type: "default" } }, { text: volatile }]
      : [{ text: stable + volatile }];

    const input: Record<string, unknown> = {
      modelId: this.settings.bedrockChatModel,
      messages,
      system,
      inferenceConfig: {
        maxTokens: this.settings.maxTokens,
      },
      // 추론 강도는 벤더 고유 파라미터로 전달한다(Anthropic: output_config.effort,
      // OpenAI: reasoning.effort). effort 미지원 모델에서는 빈 객체이므로 생략된다.
      ...this.effortRequestFields(this.settings.effort),
    };

    if (tools && tools.length > 0) {
      input.toolConfig = {
        tools: tools.map((t) => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: { json: t.input_schema },
          },
        })),
      };
    }

    return input;
  }

  // 스트리밍 채팅 — 텍스트는 onTextDelta 콜백으로 실시간 전달,
  // 도구 호출 블록은 수집하여 최종 결과에 포함
  async converse(
    messages: ConverseMessage[],
    tools?: ToolDefinition[],
    onTextDelta?: (text: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ConverseResult> {
    const input = this.buildInput(messages, tools);
    let streamedText = false;
    const handleTextDelta = (text: string): void => {
      streamedText = true;
      onTextDelta?.(text);
    };

    try {
      return await this.converseStream(input, handleTextDelta, abortSignal);
    } catch (error) {
      // 중단된 경우 그대로 throw
      if (abortSignal?.aborted) throw error;
      // 이미 화면에 일부 텍스트를 보낸 뒤 전체 응답을 다시 요청하면 같은 답이 중복된다.
      if (streamedText) throw error;
      // 스트리밍 실패 시 일반 호출로 폴백
      return await this.converseFallback(input, onTextDelta, abortSignal);
    }
  }

  // 스트리밍 호출
  private async converseStream(
    input: Record<string, unknown>,
    onTextDelta?: (text: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ConverseResult> {
    const command = new ConverseStreamCommand(input as any);
    const response = await this.client.send(command, {
      abortSignal,
    } as any);

    const contentBlocks: ContentBlock[] = [];
    let currentText = "";
    // 도구 호출 수집용
    let currentToolUse: { toolUseId: string; name: string; inputJson: string } | null = null;
    let stopReason = "end_turn";

    if (response.stream) {
      for await (const event of response.stream) {
        // 중지 신호 능동 확인: 이미 버퍼된 이벤트라도 즉시 수신 중단 (Req 10.4, 13.1)
        if (abortSignal?.aborted) break;

        // 텍스트 블록 시작
        if (event.contentBlockStart?.start && "text" in event.contentBlockStart.start) {
          currentText = "";
        }

        // 도구 사용 블록 시작
        if (event.contentBlockStart?.start && "toolUse" in event.contentBlockStart.start) {
          const tu = event.contentBlockStart.start.toolUse;
          currentToolUse = {
            toolUseId: tu?.toolUseId || "",
            name: tu?.name || "",
            inputJson: "",
          };
        }

        // 델타 처리
        if (event.contentBlockDelta?.delta) {
          const delta = event.contentBlockDelta.delta;

          // 텍스트 델타
          if ("text" in delta && delta.text) {
            currentText += delta.text;
            onTextDelta?.(delta.text);
          }

          // 도구 입력 JSON 델타
          if ("toolUse" in delta && delta.toolUse?.input) {
            if (currentToolUse) {
              currentToolUse.inputJson += delta.toolUse.input;
            }
          }
        }

        // 블록 종료
        if (event.contentBlockStop !== undefined) {
          if (currentToolUse) {
            // 도구 호출 블록 완성
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput = JSON.parse(currentToolUse.inputJson || "{}");
            } catch {
              // JSON 파싱 실패 시 빈 객체
            }
            contentBlocks.push({
              type: "tool_use",
              toolUseId: currentToolUse.toolUseId,
              name: currentToolUse.name,
              input: parsedInput,
            });
            currentToolUse = null;
          } else if (currentText) {
            // 텍스트 블록 완성
            contentBlocks.push({ type: "text", text: currentText });
            currentText = "";
          }
        }

        // 메시지 종료
        if (event.messageStop?.stopReason) {
          stopReason = event.messageStop.stopReason;
        }
      }
    }

    // 스트림이 블록 종료 없이 끝난 경우 잔여 텍스트 처리
    if (currentText) {
      contentBlocks.push({ type: "text", text: currentText });
    }

    return { contentBlocks, stopReason };
  }

  // 일반 호출 폴백
  private async converseFallback(
    input: Record<string, unknown>,
    onTextDelta?: (text: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ConverseResult> {
    const command = new ConverseCommand(input as any);
    const response = await this.client.send(command, {
      abortSignal,
    } as any);

    const contentBlocks: ContentBlock[] = [];
    const stopReason = response.stopReason || "end_turn";
    const output = response.output;

    if (output && "message" in output && output.message?.content) {
      for (const block of output.message.content) {
        if ("text" in block && block.text) {
          contentBlocks.push({ type: "text", text: block.text });
          onTextDelta?.(block.text);
        }
        if ("toolUse" in block && block.toolUse) {
          contentBlocks.push({
            type: "tool_use",
            toolUseId: block.toolUse.toolUseId || "",
            name: block.toolUse.name || "",
            input: (block.toolUse.input as Record<string, unknown>) || {},
          });
        }
      }
    }

    return { contentBlocks, stopReason };
  }

  /**
   * 텍스트 임베딩 생성.
   *
   * Bedrock의 임베딩 모델은 벤더마다 요청/응답 스키마가 다르다. 과거에는 Titan 형식을
   * 하드코딩해, 드롭다운에 노출되는 Cohere 모델을 고르면 모든 임베딩이 실패했다.
   * 모델 ID로 벤더를 판별해 각 스키마에 맞게 요청·파싱한다.
   */
  async getEmbedding(text: string): Promise<number[]> {
    // 텍스트 길이 제한 (Titan v2 최대 8192 토큰)
    const truncated = text.slice(0, EMBEDDING_MAX_CHARS);
    const modelId = this.settings.bedrockEmbeddingModel;

    const command = new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(buildEmbeddingRequest(modelId, truncated)),
    });

    const response = await this.client.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    const embedding = extractEmbedding(modelId, body);
    if (embedding === null) {
      throw new Error(noticeI18n(this.settings.language).errEmbeddingUnparsable("Bedrock", modelId));
    }
    return embedding;
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
    const input = {
      modelId: this.settings.bedrockChatModel,
      messages: [{ role: "user", content: [{ text: userText }] }],
      system: [{ text: systemText }],
      inferenceConfig: { maxTokens },
      // 분류·요약은 짧고 결정적인 출력이 바람직하므로 최저 강도를 쓴다.
      ...this.effortRequestFields("minimal"),
    };
    const command = new ConverseCommand(input as any);
    const response = await this.client.send(command);
    const output = response.output;
    if (output && "message" in output && output.message?.content) {
      for (const block of output.message.content) {
        if ("text" in block && block.text) {
          return { text: block.text };
        }
      }
    }
    throw new Error(noticeI18n(this.settings.language).errNoResponseText("Bedrock"));
  }
}
