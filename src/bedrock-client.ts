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
} from "./provider-utils";
import { buildSystemPrompt } from "./system-prompt";
import { loadProfileCredentials, type AwsCredentials } from "./aws-profile";
import { runtimeProfileDeps } from "./aws-profile-runtime";

/** 임베딩 입력 최대 글자 수 (Titan v2 8192 토큰 기준의 보수적 상한). */
const EMBEDDING_MAX_CHARS = 20000;

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
 * 인증 방식별 Bedrock 클라이언트 설정을 구성한다.
 *  - apiKey: Bedrock API 키를 베어러 토큰으로 전달하고 SigV4보다 우선하도록
 *    authSchemePreference를 httpBearerAuth로 지정한다.
 *  - profile: `~/.aws` 프로필을 읽는 비동기 공급자를 credentials에 전달한다.
 *    SDK가 요청 시점에 호출하고 만료(expiration) 이후 자동 재호출한다.
 *  - accessKey: 입력된 키를 그대로 사용한다. 비어 있으면 SDK 기본 체인
 *    (환경변수, IAM 역할 등)에 위임한다 — 기존 동작 유지.
 *
 * apiKey/profile을 명시했는데 값이 비어 있으면 fail-closed로 처리한다. SDK 기본
 * 자격증명 체인으로 폴백하면 사용자가 선택하지 않은 AWS 계정으로 프롬프트가
 * 전송되고 과금될 수 있기 때문이다.
 *
 * 순수 함수로 분리해 단위 테스트가 가능하게 한다(SDK 인스턴스화 없이 검증).
 */
export function buildBedrockClientConfig(
  settings: GeminiAssistantSettings,
  profileDeps = runtimeProfileDeps
): Record<string, unknown> {
  const config: Record<string, unknown> = { region: settings.awsRegion };

  switch (settings.awsAuthMethod) {
    case "apiKey": {
      const apiKey = settings.bedrockApiKey?.trim();
      if (apiKey) {
        config.token = { token: apiKey };
        config.authSchemePreference = ["httpBearerAuth"];
      } else {
        config.credentials = () =>
          Promise.reject(
            new Error("Bedrock API 키가 설정되지 않았습니다. 설정에서 API 키를 입력하세요")
          );
      }
      break;
    }
    case "profile": {
      const profile = settings.awsProfile?.trim();
      if (profile) {
        config.credentials = (): Promise<AwsCredentials> =>
          loadProfileCredentials(profile, profileDeps);
      } else {
        config.credentials = () =>
          Promise.reject(
            new Error("AWS 프로필이 선택되지 않았습니다. 설정에서 프로필을 선택하세요")
          );
      }
      break;
    }
    default: {
      if (settings.awsAccessKeyId) {
        config.credentials = {
          accessKeyId: settings.awsAccessKeyId,
          secretAccessKey: settings.awsSecretAccessKey,
        };
      }
      break;
    }
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
    const fullSystemPrompt = buildSystemPrompt(this.settings);

    const input: Record<string, unknown> = {
      modelId: this.settings.bedrockChatModel,
      messages,
      system: [{ text: fullSystemPrompt }],
      inferenceConfig: {
        maxTokens: this.settings.maxTokens,
      },
      // 추론 강도는 벤더 고유 파라미터로 전달한다(Anthropic: output_config.effort,
      // OpenAI: reasoning_effort). effort 미지원 모델에서는 빈 객체이므로 생략된다.
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

    try {
      return await this.converseStream(input, onTextDelta, abortSignal);
    } catch (error) {
      // 중단된 경우 그대로 throw
      if (abortSignal?.aborted) throw error;
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
      throw new Error(`임베딩 응답을 해석할 수 없습니다 (model=${modelId})`);
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
    throw new Error("converseLight 응답에 텍스트가 없습니다");
  }
}
