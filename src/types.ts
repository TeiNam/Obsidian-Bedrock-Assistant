// 사용자 정의(커스텀) 스킬. 설정(data.json)에 저장되며 토글로 활성화한다.
export interface CustomSkill {
  /** 고유 ID (소문자/숫자/하이픈) */
  id: string;
  /** 표시 이름 */
  name: string;
  /** 짧은 설명 */
  description: string;
  /** 스킬 본문 (마크다운, 시스템 프롬프트에 주입됨) */
  content: string;
  /** 활성화 여부 */
  enabled: boolean;
}

// Second Brain Layer 설정 (옵트인). Graph RAG "읽기" 위에 능동 "쓰기" 레이어를 제어한다.
export interface SecondBrainSettings {
  /** 기능 활성화 (옵트인, 기본 false) (Req 1.1) */
  enabled: boolean;
  /** Wiki_Folder 루트 경로 (기본 "Second Brain") (Req 1.2) */
  wikiFolder: string;
  /** 스케줄러 자동 트리거 활성화 (기본 false) (Req 1.2) */
  schedulerEnabled: boolean;
  /** 스케줄러 주기 (시간 단위, 기본 24, 최소 1 정수) (Req 1.2, 1.5) */
  schedulerIntervalHours: number;
  /** 마지막 Cleanup_Pipeline 실행 시각 (epoch ms, 미실행 시 0) (Req 11.2, 11.6) */
  lastScheduledRun: number;
}

// Second Brain Layer 기본값 (옵트인이므로 enabled/schedulerEnabled는 false)
export const DEFAULT_SECOND_BRAIN_SETTINGS: SecondBrainSettings = {
  enabled: false,
  wikiFolder: "Second Brain",
  schedulerEnabled: false,
  schedulerIntervalHours: 24,
  lastScheduledRun: 0,
};

/**
 * 부분/누락/이상 값을 가진 입력을 안전한 SecondBrainSettings로 정규화한다 (Req 1.3, 1.4, 1.5).
 * - 누락 필드는 DEFAULT로 채움
 * - wikiFolder 공백/빈 문자열 → "Second Brain"
 * - schedulerIntervalHours < 1 또는 비정수 → max(1, round(n))
 */
export function normalizeSecondBrainSettings(raw: unknown): SecondBrainSettings {
  // 객체가 아니면(undefined/null/원시값) 전체 기본값으로 시작 (Req 1.3)
  const source: Record<string, unknown> =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  // enabled: 불리언이 아니면 기본값 사용
  const enabled =
    typeof source.enabled === "boolean"
      ? source.enabled
      : DEFAULT_SECOND_BRAIN_SETTINGS.enabled;

  // wikiFolder: 문자열이고 공백 제거 후 비어 있지 않으면 trim 값, 아니면 기본값 (Req 1.4)
  let wikiFolder = DEFAULT_SECOND_BRAIN_SETTINGS.wikiFolder;
  if (typeof source.wikiFolder === "string") {
    const trimmed = source.wikiFolder.trim();
    if (trimmed.length > 0) {
      wikiFolder = trimmed;
    }
  }

  // schedulerEnabled: 불리언이 아니면 기본값 사용
  const schedulerEnabled =
    typeof source.schedulerEnabled === "boolean"
      ? source.schedulerEnabled
      : DEFAULT_SECOND_BRAIN_SETTINGS.schedulerEnabled;

  // schedulerIntervalHours: 유한 수치면 max(1, round(n))로 보정, 아니면 기본값 (Req 1.5)
  let schedulerIntervalHours = DEFAULT_SECOND_BRAIN_SETTINGS.schedulerIntervalHours;
  if (
    typeof source.schedulerIntervalHours === "number" &&
    Number.isFinite(source.schedulerIntervalHours)
  ) {
    schedulerIntervalHours = Math.max(1, Math.round(source.schedulerIntervalHours));
  }

  // lastScheduledRun: 유한 수치면 그대로, 아니면 기본값(0)
  const lastScheduledRun =
    typeof source.lastScheduledRun === "number" &&
    Number.isFinite(source.lastScheduledRun)
      ? source.lastScheduledRun
      : DEFAULT_SECOND_BRAIN_SETTINGS.lastScheduledRun;

  return {
    enabled,
    wikiFolder,
    schedulerEnabled,
    schedulerIntervalHours,
    lastScheduledRun,
  };
}

/**
 * Bedrock 인증 방식.
 *  - accessKey: Access Key ID + Secret Access Key 직접 입력 (기존 방식, 기본값)
 *  - apiKey: Bedrock API 키(장기 베어러 토큰)로 인증
 *  - profile: `~/.aws` 공유 설정의 프로필 사용(정적 자격증명 또는 `aws sso login` 결과)
 */
export type AwsAuthMethod = "accessKey" | "apiKey" | "profile";

/**
 * 추론 강도(effort). effort 기반 최신 모델에서 temperature를 대체하는 파라미터로,
 * 약함 → 강함 순서로 나열한다. 모델별 허용 값은 provider-utils의 effortLevels 참고.
 */
export type EffortLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

// 플러그인 설정 타입
export interface GeminiAssistantSettings {
  language: "en" | "ko" | "ja";
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  welcomeGreeting: string;
  autoAttachActiveNote: boolean;
  enabledSkills: string[];
  // 사용자가 직접 추가한 커스텀 스킬 목록 (설정에 저장)
  customSkills: CustomSkill[];
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
  // Daily Planner 루트 폴더 경로 (Legacy, 미사용 — 하위호환 유지)
  plannerFolder: string;
  // TimeBox 템플릿 파일명 (Legacy, 미사용 — 하위호환 유지)
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

  // === AWS Bedrock 백엔드 필드 ===
  /** Bedrock 인증 방식 (액세스 키 / API 키 / 공유 프로필) */
  awsAuthMethod: AwsAuthMethod;
  /** AWS Access Key ID (Bedrock 자격증명) */
  awsAccessKeyId: string;
  /** AWS Secret Access Key (Bedrock 자격증명) */
  awsSecretAccessKey: string;
  /** Bedrock API 키 (장기 베어러 토큰). awsAuthMethod="apiKey"에서 사용 */
  bedrockApiKey: string;
  /** `~/.aws` 공유 설정의 프로필 이름. awsAuthMethod="profile"에서 사용 */
  awsProfile: string;
  /** AWS 리전 (Bedrock) */
  awsRegion: string;
  /** Bedrock 채팅 모델 ID */
  bedrockChatModel: string;
  /** Bedrock 임베딩 모델 ID */
  bedrockEmbeddingModel: string;
  /** 추론 강도(effort). effort 기반 최신 모델에서 temperature를 대체한다 */
  effort: EffortLevel;

  // === Graph RAG 검색 설정 필드 ===
  /** 그래프 순회 탐색 깊이 (hop). 기본 1, 유효 범위 0~3 정수 (0이면 그래프 순회 비활성) */
  graphTraversalDepth: number;
  /** 단일 청크 최대 크기 (문자 수). 기본 2000, 최소 1 */
  chunkMaxSize: number;
  /** 인접 청크 겹침 크기 (문자 수). 기본 200, maxSize보다 작아야 함 */
  chunkOverlap: number;

  // === Second Brain Layer 설정 (옵트인) ===
  /** Second Brain Layer 설정 (기능 활성화·위키 폴더·스케줄러) (Req 1.7) */
  secondBrain: SecondBrainSettings;
}

// AI 클라이언트 공통 인터페이스 (BedrockClient가 구현)
export interface IAiClient {
  /** 설정 변경 시 클라이언트 내부 설정 업데이트 */
  updateSettings(settings: GeminiAssistantSettings): void;
  /** 사용 가능한 모델 목록 반환. kind로 채팅/임베딩 목록을 구분 (optional, 기본 "chat", 하위 호환) */
  listModels(kind?: "chat" | "embedding"): Promise<ModelInfo[]>;
  /** 스트리밍 채팅 호출 */
  converse(
    messages: ConverseMessage[],
    tools: ToolDefinition[],
    onTextDelta?: (delta: string) => void,
    abortSignal?: AbortSignal,
    // 웹서치 활성화 플래그. MCP 웹서치 도구(fetch/exa/brave) 사용 의도를 전달한다.
    webSearch?: boolean
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
  maxTokens: 32000,
  temperature: 0.1,
  systemPrompt: "",
  welcomeGreeting: "",
  autoAttachActiveNote: true,
  // 내장 스킬은 항상 활성화되므로 기본 enabledSkills는 비워둔다(커스텀 스킬 id만 보관).
  enabledSkills: [],
  // 커스텀 스킬 기본값(비어 있음). 사용자가 설정에서 추가한다.
  customSkills: [],
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
  mcpTimeout: 10,
  webClipFolder: "WebClips",
  webClipModel: "",
  archiveCleanDays: 90,
  archiveCleanFolder: "ToDo/Archive",
  // AWS Bedrock 백엔드 기본값
  awsAuthMethod: "accessKey",
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  bedrockApiKey: "",
  awsProfile: "",
  awsRegion: "us-east-1",
  bedrockChatModel: "",
  bedrockEmbeddingModel: "",
  // effort 기본값: 품질과 지연시간의 균형점
  effort: "medium",
  // Graph RAG 검색 설정 기본값
  graphTraversalDepth: 1,
  chunkMaxSize: 2000,
  chunkOverlap: 200,
  // Second Brain Layer 기본값 (옵트인)
  secondBrain: DEFAULT_SECOND_BRAIN_SETTINGS,
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

// 모델 정보 (목록 조회 결과)
export interface ModelInfo {
  modelId: string;
  modelName: string;
  provider: string;
  isProfile: boolean; // 추론 프로파일 여부
}
