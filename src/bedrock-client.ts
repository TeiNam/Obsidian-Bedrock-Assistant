import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  BedrockAssistantSettings,
  ToolDefinition,
  ConverseMessage,
  ConverseResult,
  ContentBlock,
} from "./types";
import { buildSkillsPrompt } from "./skills";

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
      }
      // "env" 모드: credentials 미지정 → SDK 기본 체인 사용
      // (환경변수 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY,
      //  ~/.aws/credentials 프로파일, IAM 역할 등)

      return new BedrockRuntimeClient(config as any);
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
}
