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
  // To-Do 리스트 저장 폴더 경로 (Legacy 평면 구조 해석 + 마이그레이션 원천)
  todoFolder: string;
  // To-Do 템플릿 파일명 (템플릿 폴더 내, .md 제외)
  todoTemplateName: string;
  // To-Do 아카이브 폴더 경로
  todoArchiveFolder: string;
  // To-Do 아카이브 기준 일수
  todoArchiveDays: number;
  // Daily Planner 루트 폴더 경로 (날짜 폴더를 담는 루트, 신규)
  plannerFolder: string;
  // TimeBox 템플릿 파일명 (템플릿 폴더 내, .md 제외, 신규)
  timeboxTemplateName: string;
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

  // === Graph RAG 검색 설정 필드 ===
  /** 그래프 순회 탐색 깊이 (hop). 기본 1, 유효 범위 0~3 정수 (0이면 그래프 순회 비활성) */
  graphTraversalDepth: number;
  /** 단일 청크 최대 크기 (문자 수). 기본 2000, 최소 1 */
  chunkMaxSize: number;
  /** 인접 청크 겹침 크기 (문자 수). 기본 200, maxSize보다 작아야 함 */
  chunkOverlap: number;
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
  plannerFolder: "Daily Planner",
  timeboxTemplateName: "TimeBox Daily",
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
  bedrockEmbeddingModel: "amazon.titan-embed-text-v2:0",
  // Graph RAG 검색 설정 기본값
  graphTraversalDepth: 1,
  chunkMaxSize: 2000,
  chunkOverlap: 200,
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

// 청크 단위 임베딩
// 긴 노트를 일정 크기로 분할한 텍스트 조각이며, 각 청크는 독립된 임베딩 벡터를 가진다.
export interface IndexChunk {
  /** 노트 내 청크 순번 (0부터 시작) */
  index: number;
  /** 청크 본문 (키워드 검색용) */
  text: string;
  /** 청크 임베딩 벡터 (빈 배열이면 임베딩 실패 또는 미생성) */
  embedding: number[];
  /** 임베딩 생성 실패 표시 (Req 3.6) */
  embedFailed?: boolean;
}

// 볼트 인덱스 항목
export interface VaultIndexEntry {
  // === 기존 필드 (하위 호환 유지) ===
  path: string;
  /** 레거시 노트 단위 임베딩 (마이그레이션/폴백용 유지) */
  embedding: number[];
  lastModified: number;
  title: string;
  excerpt: string;
  searchText?: string;

  // === 신규 필드 (모두 optional, 버전 없는 기존 직렬화 데이터와 타입 호환) ===
  /** 청크 집합 (Req 3) */
  chunks?: IndexChunk[];
  /** 아웃링크 경로 목록 — 볼트 내 존재하는 노트만, 중복 제거 (Req 1.1, 1.3) */
  outlinks?: string[];
  /** 백링크 경로 목록 — 중복 제거 (Req 1.2) */
  backlinks?: string[];
  /** 태그 목록 — 선행 # 제거, 중복 제거 (Req 2.1) */
  tags?: string[];
  /** 프론트매터 키-값 메타데이터 — tags와 분리된 별도 필드 (Req 2.2) */
  frontmatter?: Record<string, unknown>;
}

// 인덱스 직렬화 스키마 버전 (Req 8.1)
export const CURRENT_INDEX_SCHEMA_VERSION = 1;

// 인덱스 직렬화 스키마 (버전 포함)
export interface SerializedIndex {
  /** Index_Schema_Version (Req 8.1) */
  schemaVersion: number;
  /** chunks/links/tags/frontmatter를 포함한 인덱스 항목 집합 */
  entries: VaultIndexEntry[];
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
  /** Gemini 3.x thought signature (텍스트 파트에서도 반환될 수 있음, 권장 보존) */
  thoughtSignature?: string;
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
