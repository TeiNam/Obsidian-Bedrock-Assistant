// 플러그인 설정 타입
export interface GeminiAssistantSettings {
  language: "en" | "ko" | "ja";
  // Gemini API Key
  geminiApiKey: string;
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
  // 템플릿 저장 폴더 경로
  templateFolder: string;
  // 채팅 영역 폰트 크기 (px)
  chatFontSize: number;
  // To-Do 리스트 저장 폴더 경로
  todoFolder: string;
  // To-Do 템플릿 파일명 (템플릿 폴더 내, .md 제외)
  todoTemplateName: string;
  // To-Do 아카이브 폴더 경로
  todoArchiveFolder: string;
  // To-Do 아카이브 기준 일수
  todoArchiveDays: number;
  // 파괴적 도구 실행 전 확인 모달 표시 여부
  confirmToolExecution: boolean;
  // MCP 도구 요청 타임아웃 (초)
  mcpTimeout: number;
  // 웹 클리퍼 저장 폴더 경로
  webClipFolder: string;
  // 웹 클리퍼 전용 모델 ID
  webClipModel: string;
  // 아카이브 비우기 기준 일수
  archiveCleanDays: number;
  // 아카이브 비우기 대상 폴더
  archiveCleanFolder: string;

  // === AI 백엔드 통합 필드 ===
  /** AI 백엔드 선택 ("bedrock" 또는 "gemini") */
  aiBackend: "bedrock" | "gemini";
  /** AWS Access Key ID (Bedrock 자격증명) */
  awsAccessKeyId: string;
  /** AWS Secret Access Key (Bedrock 자격증명) */
  awsSecretAccessKey: string;
  /** AWS 리전 (Bedrock) */
  awsRegion: string;
  /** Bedrock 채팅 모델 ID */
  bedrockChatModel: string;
  /** Bedrock 임베딩 모델 ID */
  bedrockEmbeddingModel: string;
}

// AI 클라이언트 공통 인터페이스 (GeminiClient, BedrockClient가 구현)
export interface IAiClient {
  /** 설정 변경 시 클라이언트 내부 설정 업데이트 */
  updateSettings(settings: GeminiAssistantSettings): void;
  /** 사용 가능한 모델 목록 반환 */
  listModels(): Promise<ModelInfo[]>;
  /** 스트리밍 채팅 호출 */
  converse(
    messages: ConverseMessage[],
    tools: ToolDefinition[],
    onTextDelta?: (delta: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ConverseResult>;
  /** 텍스트 임베딩 생성 */
  getEmbedding(text: string): Promise<number[]>;
  /** 경량 converse 호출 (분류, 요약 등 간단한 작업용) */
  converseLight(
    prompt: string,
    systemPrompt: string,
    maxTokens?: number
  ): Promise<{ text: string }>;
}

export const DEFAULT_SETTINGS: GeminiAssistantSettings = {
  language: "en",
  geminiApiKey: "",
  chatModel: "gemini-3.1-flash-lite",
  embeddingModel: "text-embedding-004",
  maxTokens: 32000,
  temperature: 0.1,
  systemPrompt:
    "You are a helpful assistant embedded in Obsidian. You can help with note-taking, searching the vault, and answering questions based on the user's notes. Respond in the same language the user uses. When writing code blocks, always specify the programming language (e.g. ```python, ```javascript, ```sql) so that syntax highlighting and Code Styler plugin can render them properly.",
  welcomeGreeting: "",
  autoAttachActiveNote: true,
  enabledSkills: ["obsidian-markdown", "obsidian-bases", "json-canvas"],
  persistChat: true,
  templateFolder: "Templates",
  chatFontSize: 14,
  todoFolder: "ToDo",
  todoTemplateName: "Daily To-Do",
  todoArchiveFolder: "ToDo/Archive",
  todoArchiveDays: 7,
  confirmToolExecution: false,
  mcpTimeout: 30,
  webClipFolder: "WebClips",
  webClipModel: "gemini-3.1-flash-lite",
  archiveCleanDays: 90,
  archiveCleanFolder: "ToDo/Archive",
  // AI 백엔드 통합 기본값
  aiBackend: "bedrock",
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  awsRegion: "us-east-1",
  bedrockChatModel: "",
  bedrockEmbeddingModel: "",
};

// 채팅 메시지 타입
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// 채팅 세션 타입 (다중 대화 관리)
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
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
  /** Gemini 3.x thought signature (function calling 시 필수 보존) */
  thoughtSignature?: string;
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

// 모델 정보 (목록 조회 결과)
export interface ModelInfo {
  modelId: string;
  modelName: string;
  provider: string;
  isProfile: boolean; // 추론 프로파일 여부
}
