// 플러그인 설정 타입
export interface BedrockAssistantSettings {
  awsRegion: string;
  // 자격증명 소스: "manual" = 직접 입력, "env" = 환경변수/프로파일
  awsCredentialSource: "manual" | "env";
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsProfile: string; // env 모드에서 사용할 AWS 프로파일명
  chatModel: string;
  embeddingModel: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  welcomeGreeting: string;
  autoAttachActiveNote: boolean;
  enabledSkills: string[];
  // 대화 히스토리 저장 여부
  persistChat: boolean;
}

export const DEFAULT_SETTINGS: BedrockAssistantSettings = {
  awsRegion: "us-east-1",
  awsCredentialSource: "manual",
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  awsProfile: "default",
  chatModel: "global.anthropic.claude-opus-4-6-v1",
  embeddingModel: "amazon.titan-embed-text-v2:0",
  maxTokens: 32000,
  temperature: 0.7,
  systemPrompt:
    "You are a helpful assistant embedded in Obsidian. You can help with note-taking, searching the vault, and answering questions based on the user's notes. Respond in the same language the user uses.",
  welcomeGreeting: "무엇을 도와드릴까요?",
  autoAttachActiveNote: true,
  enabledSkills: ["obsidian-markdown", "obsidian-bases", "json-canvas"],
  persistChat: true,
};

// 채팅 메시지 타입
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// 볼트 인덱스 항목
export interface VaultIndexEntry {
  path: string;
  embedding: number[];
  lastModified: number;
  title: string;
  excerpt: string;
  searchText?: string;
}

// Obsidian 제어 도구 정의
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// Converse API 스트리밍 응답의 콘텐츠 블록
export interface ContentBlockText {
  type: "text";
  text: string;
}

export interface ContentBlockToolUse {
  type: "tool_use";
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
}

export type ContentBlock = ContentBlockText | ContentBlockToolUse;

// converse() 호출 결과
export interface ConverseResult {
  contentBlocks: ContentBlock[];
  stopReason: string; // "end_turn" | "tool_use" 등
}

// Converse API 메시지 (도구 호출/결과 포함)
export interface ConverseMessage {
  role: "user" | "assistant";
  content: unknown[];
}

// 인덱싱 결과 (실패 상세 포함)
export interface IndexFailure {
  path: string;
  reason: string;
}

export interface IndexResult {
  processed: number;
  skipped: number;
  errors: IndexFailure[];
}
