import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  BedrockClient as BedrockControlClient,
  ListInferenceProfilesCommand,
} from "@aws-sdk/client-bedrock";
import type {
  BedrockAssistantSettings,
  ToolDefinition,
  ConverseMessage,
  ConverseResult,
  ContentBlock,
  ModelInfo,
} from "./types";
import { buildSkillsPrompt } from "./skills";

// 가져올 글로벌 모델 키워드 (opus, sonnet, haiku만 필터)
const MODEL_KEYWORDS = ["claude-opus", "claude-sonnet", "claude-haiku"];
// 모델 정렬 우선순위 (opus > sonnet > haiku)
const MODEL_PRIORITY: Record<string, number> = {
  "claude-opus": 0,
  "claude-sonnet": 1,
  "claude-haiku": 2,
};

// Bedrock API 클라이언트
export class BedrockClient {
  private client: BedrockRuntimeClient;
  private settings: BedrockAssistantSettings;

  constructor(settings: BedrockAssistantSettings) {
    this.settings = settings;
    this.client = this.createClient();
  }

  // 설정 변경 시 클라이언트 재생성
  updateSettings(settings: BedrockAssistantSettings) {
    this.settings = settings;
    this.client = this.createClient();
  }

  private createClient(): BedrockRuntimeClient {
      const config: Record<string, unknown> = {
        region: this.settings.awsRegion,
      };

      if (this.settings.awsCredentialSource === "manual" && this.settings.awsAccessKeyId) {
        // 수동 입력 자격증명
        config.credentials = {
          accessKeyId: this.settings.awsAccessKeyId,
          secretAccessKey: this.settings.awsSecretAccessKey,
        };
      } else if (this.settings.awsCredentialSource === "apikey" && this.settings.bedrockApiKey) {
        // Bedrock API Key 인증: Bearer 토큰 방식
        // SDK에 더미 자격증명을 넣고, 미들웨어로 Authorization 헤더를 덮어씀
        config.credentials = {
          accessKeyId: "apikey",
          secretAccessKey: "apikey",
        };
      }
      // "env" 모드: credentials 미지정 → SDK 기본 체인 사용

      const client = new BedrockRuntimeClient(config as any);

      // API Key 모드일 때 미들웨어로 Bearer 토큰 주입
      if (this.settings.awsCredentialSource === "apikey" && this.settings.bedrockApiKey) {
        const apiKey = this.settings.bedrockApiKey;
        client.middlewareStack.add(
          (next: any) => async (args: any) => {
            // SigV4 서명 대신 Bearer 토큰 사용
            args.request.headers["Authorization"] = `Bearer ${apiKey}`;
            // SigV4가 추가한 불필요한 헤더 제거
            delete args.request.headers["x-amz-date"];
            delete args.request.headers["x-amz-security-token"];
            delete args.request.headers["x-amz-content-sha256"];
            return next(args);
          },
          {
            step: "finalizeRequest",
            name: "bedrockApiKeyAuth",
            override: true,
          }
        );
      }

      return client;
    }

  // 사용 가능한 모델 목록 반환 (Bedrock 추론 프로파일에서 최신 Claude 모델 조회)
  async listModels(): Promise<ModelInfo[]> {
    try {
      const controlClient = this.createControlClient();
      const resp = await controlClient.send(
        new ListInferenceProfilesCommand({ typeEquals: "SYSTEM_DEFINED" })
      );

      if (!resp.inferenceProfileSummaries) return [];

      // global.anthropic.claude-{opus,sonnet,haiku} 프로파일만 필터
      const models: ModelInfo[] = [];
      for (const p of resp.inferenceProfileSummaries) {
        if (!p.inferenceProfileId || !p.inferenceProfileName) continue;
        // "global." 접두사가 있는 글로벌 프로파일만
        if (!p.inferenceProfileId.startsWith("global.")) continue;

        const matched = MODEL_KEYWORDS.some((kw) =>
          p.inferenceProfileId!.includes(kw)
        );
        if (!matched) continue;

        models.push({
          modelId: p.inferenceProfileId,
          modelName: p.inferenceProfileName,
          provider: "Anthropic",
          isProfile: true,
        });
      }

      // 같은 계열(opus/sonnet/haiku)에서 최신 버전만 남기기
      // 모델 ID 기준 내림차순 정렬 후 계열별 첫 번째만 선택
      const bestByFamily = new Map<string, ModelInfo>();
      for (const m of models) {
        const family = MODEL_KEYWORDS.find((kw) => m.modelId.includes(kw)) || "";
        const existing = bestByFamily.get(family);
        if (!existing || m.modelId > existing.modelId) {
          bestByFamily.set(family, m);
        }
      }

      // 우선순위 순으로 정렬 (opus > sonnet > haiku)
      return Array.from(bestByFamily.entries())
        .sort(([a], [b]) => (MODEL_PRIORITY[a] ?? 99) - (MODEL_PRIORITY[b] ?? 99))
        .map(([, m]) => m);
    } catch (e) {
      console.warn("모델 목록 조회 실패:", e);
      return [];
    }
  }

  // Bedrock 컨트롤 플레인 클라이언트 생성 (모델 목록 조회용)
  private createControlClient(): BedrockControlClient {
    const config: Record<string, unknown> = {
      region: this.settings.awsRegion,
    };

    if (this.settings.awsCredentialSource === "manual" && this.settings.awsAccessKeyId) {
      config.credentials = {
        accessKeyId: this.settings.awsAccessKeyId,
        secretAccessKey: this.settings.awsSecretAccessKey,
      };
    } else if (this.settings.awsCredentialSource === "apikey" && this.settings.bedrockApiKey) {
      config.credentials = {
        accessKeyId: "apikey",
        secretAccessKey: "apikey",
      };
    }

    const client = new BedrockControlClient(config as any);

    if (this.settings.awsCredentialSource === "apikey" && this.settings.bedrockApiKey) {
      const apiKey = this.settings.bedrockApiKey;
      client.middlewareStack.add(
        (next: any) => async (args: any) => {
          args.request.headers["Authorization"] = `Bearer ${apiKey}`;
          delete args.request.headers["x-amz-date"];
          delete args.request.headers["x-amz-security-token"];
          delete args.request.headers["x-amz-content-sha256"];
          return next(args);
        },
        { step: "finalizeRequest", name: "bedrockApiKeyAuth", override: true }
      );
    }

    return client;
  }


  // Converse API 입력 구성
  private buildInput(
    messages: ConverseMessage[],
    tools?: ToolDefinition[]
  ): Record<string, unknown> {
    const skillsPrompt = buildSkillsPrompt(this.settings.enabledSkills || []);
    const fullSystemPrompt = this.settings.systemPrompt + skillsPrompt;

    const input: Record<string, unknown> = {
      modelId: this.settings.chatModel,
      messages,
      system: [{ text: fullSystemPrompt }],
      inferenceConfig: {
        maxTokens: this.settings.maxTokens,
        temperature: this.settings.temperature,
      },
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
      console.warn("스트리밍 실패, 일반 호출로 전환:", error);
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

  // Titan 임베딩 생성
  async getEmbedding(text: string): Promise<number[]> {
    // 텍스트 길이 제한 (Titan v2 최대 8192 토큰)
    const truncated = text.slice(0, 20000);

    const command = new InvokeModelCommand({
      modelId: this.settings.embeddingModel,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: truncated,
        dimensions: 512,
        normalize: true,
      }),
    });

    const response = await this.client.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    return body.embedding;
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
      modelId: this.settings.chatModel,
      messages: [{ role: "user", content: [{ text: userText }] }],
      system: [{ text: systemText }],
      inferenceConfig: { maxTokens, temperature: 0 },
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
    throw new Error("No text in converseLight response");
  }

}
