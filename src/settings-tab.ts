import { App, FuzzySuggestModal, Modal, Notice, PluginSettingTab, Setting, TFolder, setIcon } from "obsidian";
import type GeminiAssistantPlugin from "./main";
import type { CustomSkill, EffortLevel, Locale } from "./types";
// Second Brain 설정 정규화 (Req 1.4, 1.5): onChange 시점 값 보정에 사용
import { normalizeSecondBrainSettings } from "./types";
import { SKILLS } from "./skills";
import { BRANDING, updateBranding } from "./branding";
import { CleanArchiveModal } from "./modals/clean-archive-modal";
import { ParaModal } from "./modals/para-modal";
import { VIEW_I18N } from "./chat-view-i18n";
import { isPluginEnabled } from "./plugin-detect";
import { validateJson, matchBrackets, formatJson, getDefaultTemplate } from "./json-editor-utils";
import type { JsonValidationResult, BracketMatchResult } from "./json-editor-utils";
import { normalizePlannerSetting } from "./planner-settings";
// OpenAI/Ollama base URL 검증 (Req 2.10): onChange 시점 형식 검증에 사용
// clampMaxTokens: maxTokens 입력 범위 보정 / embeddingSignature: 임베딩 구성 변경 감지
import {
  isValidBaseUrl,
  activeChatModelId,
  clampEffort,
  clampMaxTokens,
  effortLevels,
  embeddingSignature,
} from "./provider-utils";
// Graph RAG 설정 보정 함수 (Req 9.4~9.7): 저장 전 값 보정에 사용
import { normalizeChunkConfig } from "./graph-rag/chunker";
import { normalizeTraversalDepth } from "./graph-rag/graph-traversal";
import { parseMcpConfig } from "./mcp-client";

// To-Do 폴더 기본값 (빈/공백 입력 정규화에 사용)
const TODO_FOLDER_DEFAULT = "ToDo";

// 설정 탭 다국어 레이블
// (테스트에서 i18n 키 완전성 검증을 위해 export — 런타임 동작 변화 없음, 추가적 export일 뿐)
export const I18N = {
  en: {
    pluginDesc: "An AI assistant sidebar that reads, searches, and writes your Obsidian vault. Everything below is off or empty until you configure it — nothing runs on your notes without your say-so.",
    featuresLabel: "What's included",
    features: [
      {
        name: "Four AI backends",
        desc: "AWS Bedrock, Google Gemini, OpenAI (or any OpenAI-compatible endpoint), and Ollama for fully local models. Chat model and embedding model are picked separately.",
      },
      {
        name: "Vault chat with tools",
        desc: "The assistant searches, reads, creates, edits, moves, and deletes notes itself. Tools that change notes ask for confirmation first.",
      },
      {
        name: "Graph RAG search",
        desc: "Notes are indexed as chunks with embeddings, then results expand along wikilinks and merge with keyword hits — so a note found through its neighbour still surfaces.",
      },
      {
        name: "LLM wiki (Second Brain)",
        desc: "Synthesize a topic into one note, report contradictions, keep a decision ledger, flag duplicate candidates, suggest links for orphan notes, surface a review queue, triage your Inbox, and write a knowledge-gap report. Every write is opt-in and only replaces generated blocks.",
      },
      {
        name: "Reusable templates",
        desc: "Save a template once and reuse it. {{variable}} placeholders are filled in when the note is created, so notes written on different days keep the same shape.",
      },
      {
        name: "Web page summary",
        desc: "Paste a URL to fetch the page, translate and summarize it in your language, and save it as a note.",
      },
      {
        name: "Automatic tags",
        desc: "Analyze the open note and add three to five tags to its frontmatter — the same tags Obsidian's graph view uses for color groups and filters.",
      },
      {
        name: "To-Do and retrospective",
        desc: "Daily to-do notes with unfinished items carried over, automatic archiving and cleanup of old files, and an AI retrospective appended to today's note.",
      },
      {
        name: "P.A.R.A setup",
        desc: "Create the four P.A.R.A folders and let the AI classify existing notes into them.",
      },
      {
        name: "MCP servers",
        desc: "Connect external MCP servers and use their tools in the same conversation as the vault tools.",
      },
      {
        name: "Skills",
        desc: "Built-in Obsidian knowledge (Markdown, Bases, Canvas) plus your own skills, which the AI can draft for you. Enabled skills are injected into the system prompt.",
      },
      {
        name: "Citation check",
        desc: "Warns you when an answer cites a note that isn't actually in your vault.",
      },
    ],
    readmeLabel: "📖 Documentation",
    readmeFile: "README.md",
    sponsorLabel: "If you find this plugin useful, consider supporting its development.",
    language: "Language",
    languageDesc: "UI language for settings",
    // AI 백엔드 선택
    aiBackendLabel: "AI Backend",
    aiBackendDesc: "Select AI backend to use",
    reindexNeeded:
      "Embedding model changed. The existing vault index uses a different embedding space, so search may return no results. Please re-index the vault.",
    // Gemini 자격증명
    awsAuth: "Gemini API",
    apiKey: "Gemini API Key",
    apiKeyDesc: "Your Gemini API key from Google AI Studio",
    apiKeyPlaceholder: "Enter Gemini API key",
    // Bedrock 자격증명
    bedrockApiKeyLabel: "Bedrock API Key",
    bedrockApiKeyDesc: "Long-term Bedrock API key for authentication. Get your API key from AWS Bedrock console.",
    bedrockApiKeyPlaceholder: "Enter Bedrock API key",
    awsRegionLabel: "AWS Region",
    awsRegionDesc: "AWS Region for Bedrock API",
    awsRegionPlaceholder: "us-east-1",
    // Bedrock 모델 설정
    bedrockChatModelLabel: "Bedrock Chat Model",
    bedrockChatModelDesc: "Bedrock chat model ID",
    bedrockEmbeddingModelLabel: "Bedrock Embedding Model",
    bedrockEmbeddingModelDesc: "Bedrock embedding model ID (used for vault document indexing)",
    // OpenAI 백엔드 설정 (Req 2.1, 13)
    openaiAuth: "OpenAI",
    openaiApiKey: "OpenAI API Key",
    openaiApiKeyDesc: "Your OpenAI API key",
    openaiApiKeyPlaceholder: "Enter OpenAI API key",
    openaiBaseUrl: "Base URL (optional)",
    openaiBaseUrlDesc: "OpenAI-compatible endpoint including /v1 (leave empty for the official OpenAI API)",
    openaiBaseUrlPlaceholder: "https://api.openai.com/v1",
    openaiChatModel: "OpenAI Chat Model",
    openaiChatModelDesc: "OpenAI chat model ID",
    openaiEmbeddingModel: "OpenAI Embedding Model",
    openaiEmbeddingModelDesc: "OpenAI embedding model ID (used for vault document indexing)",
    // Ollama 백엔드 설정 (Req 2.2, 13)
    ollamaServer: "Ollama",
    ollamaBaseUrl: "Server Base URL",
    ollamaBaseUrlDesc: "Ollama server address (leave empty for http://localhost:11434)",
    ollamaBaseUrlPlaceholder: "http://localhost:11434",
    ollamaChatModel: "Ollama Chat Model",
    ollamaChatModelDesc: "Ollama chat model ID",
    ollamaEmbeddingModel: "Ollama Embedding Model",
    ollamaEmbeddingModelDesc: "Ollama embedding model ID (used for vault document indexing)",
    // base URL 형식 오류 (Req 2.10)
    baseUrlInvalid: "Invalid base URL. It must start with http:// or https://",
    modelSettings: "Model Settings",
    chatModel: "Chat Model",
    chatModelDesc: "Gemini model ID",
    embeddingModel: "Embedding Model",
    embeddingModelDesc: "Gemini embedding model ID (used for vault document indexing)",
    genSettings: "Generation Settings",
    maxTokens: "Max Tokens",
    maxTokensDesc: "Maximum response tokens",
    effortLabel: "Reasoning Effort",
    effortDesc:
      "Reasoning depth for the selected model. Replaces temperature on models that support it.",
    systemPrompt: "System Prompt",
    systemPromptDesc: "Extra instructions appended to the built-in base prompt. Leave empty to use only the built-in prompt.",
    systemPromptPlaceholder: "Enter system prompt...",
    systemPromptEdit: "Edit",
    systemPromptSave: "Save",
    systemPromptCancel: "Cancel",
    ux: "User Experience",
    greeting: "Welcome Greeting",
    greetingDesc: "Greeting shown when opening the sidebar",
    paraSetup: "Set Up P.A.R.A",
    paraSetupDesc: "P.A.R.A (Projects, Areas, Resources, Archives) is a universal organizational system. This will create 4 folders at the vault root and use AI to classify existing notes into the appropriate category.",
    paraSetupBtn: "Set Up P.A.R.A",
    paraModalTitle: "P.A.R.A Setup",
    paraModalRunning: "Organizing vault with P.A.R.A structure...",
    paraModalDone: "P.A.R.A setup complete!",
    paraModalCreated: "Folders created",
    paraModalMoved: "Notes moved",
    paraModalSkipped: "Skipped (duplicate name)",
    paraModalErrors: "Errors",
    paraModalNoFiles: "No notes to move — folders are ready.",
    paraModalClose: "Close",
    autoAttach: "Auto-attach Active Note",
    autoAttachDesc: "Automatically include the currently open note as context",
    persistChat: "Save Chat History",
    persistChatDesc: "Preserve conversation after plugin restart",
    clearHistory: "Clear All History",
    clearHistoryDesc: "Delete all saved chat sessions",
    clearHistoryBtn: "Clear History",
    clearHistoryConfirm: "All chat history has been cleared.",
    templateFolder: "Template Folder",
    templateFolderDesc: "Vault folder path for storing templates",
    chatFontSize: "Chat Font Size",
    chatFontSizeDesc: "Font size for the chat area (px)",
    codeStylerInstall: "Install Code Styler",
    codeStylerInfo: "Install the Code Styler plugin to enhance code block rendering with language-specific styling.",
    pluginInstalled: "Installed",
    recommendedPlugins: "Recommended Plugins",
    todo: "To-Do",
    todoFolder: "To-Do Folder",
    todoFolderDesc: "Vault folder path for storing To-Do notes (saved flat as YYYY-MM-DD To-Do.md)",
    todoTasksInstall: "Install Tasks Plugin",
    todoTasksInfo: "Install the Tasks plugin to enable advanced task management with due dates, recurring tasks, and queries.",
    todoTemplate: "To-Do Template",
    todoTemplateDesc: "Template file name in the Templates folder (without .md). Variables: {{date}}, {{prevDate}}.",
    todoTemplatePlaceholder: "Daily To-Do",
    todoArchiveFolder: "Archive Folder",
    todoArchiveFolderDesc: "Folder to move old to-do files into",
    todoArchiveDays: "Archive After (days)",
    todoArchiveDaysDesc: "Move to-do files older than this many days to the archive folder",
    archiveClean: "Archive Cleanup",
    archiveCleanFolder: "Cleanup Folder",
    archiveCleanFolderDesc: "Folder to clean up old archived files from",
    archiveCleanDays: "Delete After (days)",
    archiveCleanDaysDesc: "Delete files in the archive folder older than this many days when using the Clean Archive button",
    archiveCleanBtn: "Clean Archive",
    webClip: "Web Clipper",
    webClipFolder: "Save Folder",
    webClipFolderDesc: "Folder to save web page summaries",
    skills: "Skills",
    skillsDesc: "Enabled skills add knowledge/instructions to the system prompt. Built-in Obsidian skills are always on.",
    skillAdd: "Add Skill",
    skillAddDesc: "Add a custom skill. Its content is injected into the system prompt when enabled.",
    skillEdit: "Edit",
    skillDelete: "Delete",
    skillModalNew: "New Skill",
    skillModalEdit: "Edit Skill",
    skillNameLabel: "Name",
    skillNamePlaceholder: "e.g. Korean Writing Polish",
    skillDescLabel: "What it does",
    skillDescPlaceholder: "Describe what this skill should do (used for AI generation)",
    skillContentLabel: "Content (Markdown)",
    skillContentPlaceholder: "Click Generate to create this with AI, or write it yourself in Markdown...",
    skillGenerate: "Generate with AI",
    skillGenerating: "Generating...",
    skillGenerateNeedInput: "Enter a name and what the skill should do first.",
    skillGenerateFailed: "Failed to generate skill:",
    skillSave: "Save",
    skillCancel: "Cancel",
    skillNameRequired: "Please enter a name and content.",
    mcpServers: "MCP Servers",
    mcpNoServers: "No MCP servers configured.",
    mcpManage: "Manage MCP Servers",
    mcpManageDesc: "Edit MCP server configuration and manage connections",
    mcpEdit: "Edit Config",
    mcpStopAll: "Stop All",
    mcpStopped: "All MCP server connections terminated.",
    mcpModalTitle: "MCP Server Settings",
    mcpModalTools: (name: string, count: number) => `${name} — ${count} tools`,
    mcpModalDesc: "Edit MCP server configuration in JSON format.",
    mcpModalSave: "Save & Connect",
    mcpModalCancel: "Close",
    mcpModalJsonError: "❌ Invalid JSON format.",
    mcpModalConfigError: (message: string) => `❌ Invalid MCP configuration: ${message}`,
    mcpModalSaving: "MCP config saved. Connecting...",
    mcpModalConnected: (names: string) => `✅ MCP connected: ${names}`,
    mcpModalFailed: (names: string) => `❌ MCP failed: ${names}`,
    mcpModalNoServers: "No MCP servers configured.",
    mcpStatusTitle: "Connection Status",
    mcpStatusDisconnected: (name: string) => `${name} — disconnected`,
    mcpStatusNone: "No servers connected.",
    folderSelectPlaceholder: "Select a folder...",
    confirmToolExecution: "Confirm Note Changes",
    confirmToolExecutionDesc: "Show a confirmation dialog before tools that create, edit, delete, or move notes",
    secAppearance: "Appearance",
    secChat: "Chat",
    secVault: "Vault",
    mcpTimeout: "MCP Tool Timeout",
    mcpTimeoutDesc: "Timeout in seconds for MCP tool requests (1–60)",
    // Graph RAG 검색 설정 I18N 키 (Req 9)
    graphRagSearch: "Graph RAG Search",
    graphTraversalDepth: "Graph Traversal Depth",
    graphTraversalDepthDesc: "Number of link hops to expand from search results (0–3, 0 disables graph traversal)",
    chunkMaxSize: "Chunk Max Size",
    chunkMaxSizeDesc: "Maximum size of a single chunk in characters (min 1, default 2000)",
    chunkOverlap: "Chunk Overlap",
    chunkOverlapDesc: "Overlap size between adjacent chunks in characters (must be smaller than chunk max size, default 200)",
    // Second Brain Layer 설정 I18N 키 (Req 12.1)
    secondBrain: "Second Brain",
    secondBrainEnabled: "Enable Second Brain",
    secondBrainEnabledDesc: "Turn on the active knowledge layer. While off, no notes are created, modified, or deleted automatically.",
    secondBrainWikiFolder: "Wiki Folder",
    secondBrainWikiFolderDesc: "Root folder where Second Brain notes are created and managed (default: Second Brain)",
    secondBrainScheduler: "Enable Scheduler",
    secondBrainSchedulerDesc: "Automatically run the non-destructive cleanup pipeline on app startup once the interval has elapsed",
    secondBrainInterval: "Scheduler Interval (hours)",
    secondBrainIntervalDesc: "Minimum hours between automatic scheduler runs (minimum 1, default 24)",
    // JSON 에디터 관련 I18N 키
    mcpFormatBtn: "Format",
    mcpTemplateBtn: "Insert Template",
    mcpBracketError: (char: string, line: number, col: number) => `Unmatched '${char}' at line ${line}, column ${col}`,
    mcpJsonErrorAt: (line: number, col: number, msg: string) => `JSON error at line ${line}, column ${col}: ${msg}`,
  },
  ko: {
    pluginDesc: "볼트를 읽고 검색하고 쓰는 AI 어시스턴트 사이드바입니다. 아래 기능은 설정하기 전까지 모두 꺼져 있거나 비어 있습니다 — 승인 없이 노트를 건드리지 않습니다.",
    featuresLabel: "들어 있는 기능",
    features: [
      {
        name: "AI 백엔드 4종",
        desc: "AWS Bedrock, Google Gemini, OpenAI(호환 엔드포인트 포함), 그리고 완전히 로컬로 도는 Ollama. 대화 모델과 임베딩 모델을 따로 고릅니다.",
      },
      {
        name: "볼트 도구를 쓰는 대화",
        desc: "어시스턴트가 직접 노트를 검색·읽기·생성·수정·이동·삭제합니다. 노트를 바꾸는 도구는 실행 전에 확인을 받습니다.",
      },
      {
        name: "Graph RAG 검색",
        desc: "노트를 청크로 쪼개 임베딩으로 색인하고, 위키링크를 따라 결과를 넓힌 뒤 키워드 적중과 합칩니다 — 이웃 노트를 거쳐야 닿는 노트도 결과에 올라옵니다.",
      },
      {
        name: "LLM 위키 (Second Brain)",
        desc: "한 주제를 노트 하나로 종합하고, 모순을 리포트하고, 결정 원장을 쌓고, 중복 후보를 표시하고, 고아 노트에 링크를 제안하고, 복습 큐를 띄우고, Inbox를 정리하고, 지식 공백 리포트를 씁니다. 모든 쓰기는 옵트인이며 자동 생성 영역만 교체합니다.",
      },
      {
        name: "재사용 템플릿",
        desc: "템플릿을 한 번 저장해 두고 계속 씁니다. 노트를 만들 때 {{변수}} 자리를 채우므로, 다른 날 쓴 글도 같은 양식을 유지합니다.",
      },
      {
        name: "웹 페이지 요약",
        desc: "URL을 넣으면 본문을 가져와 설정 언어로 번역·요약해 노트로 저장합니다.",
      },
      {
        name: "태그 자동 생성",
        desc: "열려 있는 노트를 분석해 태그 3~5개를 프론트매터에 추가합니다 — 옵시디언 그래프 뷰의 색상 그룹·필터가 쓰는 그 태그입니다.",
      },
      {
        name: "To-Do와 회고",
        desc: "날짜별 To-Do 노트를 만들고 미완료 항목을 이월하며, 오래된 파일을 아카이브·정리합니다. AI 회고를 오늘 노트에 덧붙일 수 있습니다.",
      },
      {
        name: "P.A.R.A 정리",
        desc: "P.A.R.A 폴더 4개를 만들고 기존 노트를 AI가 분류해 옮깁니다.",
      },
      {
        name: "MCP 서버",
        desc: "외부 MCP 서버를 연결해 볼트 도구와 같은 대화에서 함께 씁니다.",
      },
      {
        name: "스킬",
        desc: "내장 옵시디언 지식(Markdown, Bases, Canvas)과 직접 만든 스킬(AI가 초안을 써줍니다). 활성화한 스킬은 시스템 프롬프트에 주입됩니다.",
      },
      {
        name: "인용 검증",
        desc: "답변이 인용한 노트가 볼트에 실제로 없으면 경고합니다.",
      },
    ],
    readmeLabel: "📖 사용 가이드",
    readmeFile: "README-KR.md",
    sponsorLabel: "이 플러그인이 유용하다면 개발을 후원해 주세요.",
    language: "언어",
    languageDesc: "설정 UI 언어",
    // AI 백엔드 선택
    aiBackendLabel: "AI 백엔드",
    aiBackendDesc: "사용할 AI 백엔드를 선택합니다",
    reindexNeeded:
      "임베딩 모델이 변경되었습니다. 기존 볼트 인덱스는 다른 임베딩 공간을 사용하므로 검색 결과가 비어 나올 수 있습니다. 볼트를 다시 인덱싱해 주세요.",
    // Gemini 자격증명
    awsAuth: "Gemini API",
    apiKey: "Gemini API Key",
    apiKeyDesc: "Google AI Studio에서 발급받은 Gemini API 키",
    apiKeyPlaceholder: "Gemini API 키 입력",
    // Bedrock 자격증명
    bedrockApiKeyLabel: "Bedrock API 키",
    bedrockApiKeyDesc: "인증에 사용할 Bedrock 장기 API 키. AWS Bedrock 콘솔에서 API 키를 발급받으세요.",
    bedrockApiKeyPlaceholder: "Bedrock API 키 입력",
    awsRegionLabel: "AWS 리전",
    awsRegionDesc: "Bedrock API용 AWS 리전",
    awsRegionPlaceholder: "us-east-1",
    // Bedrock 모델 설정
    bedrockChatModelLabel: "Bedrock 채팅 모델",
    bedrockChatModelDesc: "Bedrock 채팅 모델 ID",
    bedrockEmbeddingModelLabel: "Bedrock 임베딩 모델",
    bedrockEmbeddingModelDesc: "Bedrock 임베딩 모델 ID (볼트 문서 인덱싱에 사용)",
    // OpenAI 백엔드 설정 (Req 2.1, 13)
    openaiAuth: "OpenAI",
    openaiApiKey: "OpenAI API 키",
    openaiApiKeyDesc: "OpenAI API 키",
    openaiApiKeyPlaceholder: "OpenAI API 키 입력",
    openaiBaseUrl: "Base URL (선택)",
    openaiBaseUrlDesc: "OpenAI 호환 엔드포인트 (/v1 포함). 비우면 OpenAI 공식 API를 사용합니다",
    openaiBaseUrlPlaceholder: "https://api.openai.com/v1",
    openaiChatModel: "OpenAI 채팅 모델",
    openaiChatModelDesc: "OpenAI 채팅 모델 ID",
    openaiEmbeddingModel: "OpenAI 임베딩 모델",
    openaiEmbeddingModelDesc: "OpenAI 임베딩 모델 ID (볼트 문서 인덱싱에 사용)",
    // Ollama 백엔드 설정 (Req 2.2, 13)
    ollamaServer: "Ollama",
    ollamaBaseUrl: "서버 Base URL",
    ollamaBaseUrlDesc: "Ollama 서버 주소 (비우면 http://localhost:11434 사용)",
    ollamaBaseUrlPlaceholder: "http://localhost:11434",
    ollamaChatModel: "Ollama 채팅 모델",
    ollamaChatModelDesc: "Ollama 채팅 모델 ID",
    ollamaEmbeddingModel: "Ollama 임베딩 모델",
    ollamaEmbeddingModelDesc: "Ollama 임베딩 모델 ID (볼트 문서 인덱싱에 사용)",
    // base URL 형식 오류 (Req 2.10)
    baseUrlInvalid: "잘못된 base URL입니다. http:// 또는 https://로 시작해야 합니다",
    modelSettings: "모델 설정",
    chatModel: "채팅 모델",
    chatModelDesc: "Gemini 모델 ID",
    embeddingModel: "임베딩 모델",
    embeddingModelDesc: "Gemini 임베딩 모델 ID (볼트 문서 인덱싱에 사용)",
    genSettings: "생성 설정",
    maxTokens: "최대 토큰",
    maxTokensDesc: "응답 최대 토큰 수",
    effortLabel: "추론 강도 (Effort)",
    effortDesc:
      "선택한 모델의 추론 깊이입니다. 지원 모델에서는 temperature 대신 이 값을 사용합니다.",
    systemPrompt: "시스템 프롬프트",
    systemPromptDesc: "내장 기본 프롬프트에 덧붙일 추가 지침입니다. 비워두면 내장 기본 프롬프트만 사용합니다.",
    systemPromptPlaceholder: "시스템 프롬프트를 입력하세요...",
    systemPromptEdit: "편집",
    systemPromptSave: "저장",
    systemPromptCancel: "취소",
    ux: "사용자 경험",
    greeting: "환영 인사",
    greetingDesc: "사이드바를 열 때 표시되는 인사말",
    paraSetup: "P.A.R.A 환경 설정",
    paraSetupDesc: "P.A.R.A(Projects, Areas, Resources, Archives)는 범용 정보 정리 시스템입니다. 볼트 루트에 4개의 폴더를 생성하고, 기존 노트를 AI가 적절한 카테고리로 분류하여 이동합니다.",
    paraSetupBtn: "P.A.R.A 설정하기",
    paraModalTitle: "P.A.R.A 환경 설정",
    paraModalRunning: "볼트를 P.A.R.A 구조로 정리하는 중...",
    paraModalDone: "P.A.R.A 환경 설정 완료!",
    paraModalCreated: "생성된 폴더",
    paraModalMoved: "이동된 노트",
    paraModalSkipped: "건너뜀 (이름 중복)",
    paraModalErrors: "오류",
    paraModalNoFiles: "이동할 노트가 없습니다 — 폴더가 준비되었습니다.",
    paraModalClose: "닫기",
    autoAttach: "현재 노트 자동 첨부",
    autoAttachDesc: "메시지 전송 시 현재 열려있는 노트를 자동으로 컨텍스트에 포함합니다",
    persistChat: "대화 히스토리 저장",
    persistChatDesc: "플러그인 재시작 후에도 대화 내용을 유지합니다",
    clearHistory: "히스토리 비우기",
    clearHistoryDesc: "저장된 모든 대화 세션을 삭제합니다",
    clearHistoryBtn: "히스토리 비우기",
    clearHistoryConfirm: "모든 대화 히스토리가 삭제되었습니다.",
    templateFolder: "템플릿 폴더",
    templateFolderDesc: "템플릿을 저장할 볼트 내 폴더 경로",
    chatFontSize: "채팅 폰트 크기",
    chatFontSizeDesc: "채팅 영역의 글자 크기 (px)",
    codeStylerInstall: "Code Styler 설치",
    codeStylerInfo: "Code Styler 플러그인을 설치하면 코드 블록이 언어별 스타일로 더 보기 좋게 렌더링됩니다.",
    pluginInstalled: "설치됨",
    recommendedPlugins: "추천 플러그인",
    todo: "To-Do",
    todoFolder: "To-Do 폴더",
    todoFolderDesc: "To-Do 노트를 저장할 볼트 내 폴더 경로 (파일은 YYYY-MM-DD To-Do.md 형식으로 평면 저장)",
    todoTasksInstall: "Tasks 플러그인 설치",
    todoTasksInfo: "Tasks 플러그인을 설치하면 마감일, 반복 작업, 쿼리 등 고급 할 일 관리 기능을 사용할 수 있습니다.",
    todoTemplate: "To-Do 템플릿",
    todoTemplateDesc: "템플릿 폴더 내 파일명 (.md 제외). 사용 가능 변수: {{date}}, {{prevDate}}.",
    todoTemplatePlaceholder: "Daily To-Do",
    todoArchiveFolder: "아카이브 폴더",
    todoArchiveFolderDesc: "오래된 To-Do 파일을 이동할 폴더",
    todoArchiveDays: "아카이브 기준 (일)",
    todoArchiveDaysDesc: "이 일수를 초과한 To-Do 파일을 아카이브 폴더로 이동합니다",
    archiveClean: "아카이브 비우기",
    archiveCleanFolder: "비우기 대상 폴더",
    archiveCleanFolderDesc: "아카이브 비우기 버튼으로 삭제할 파일이 있는 폴더",
    archiveCleanDays: "삭제 기준 (일)",
    archiveCleanDaysDesc: "아카이브 비우기 버튼 사용 시 아카이브 폴더에서 이 일수를 초과한 파일을 삭제합니다",
    archiveCleanBtn: "아카이브 비우기",
    webClip: "웹 클리퍼",
    webClipFolder: "저장 폴더",
    webClipFolderDesc: "웹 페이지 요약을 저장할 폴더",
    skills: "스킬",
    skillsDesc: "활성화된 스킬의 지식/지침이 시스템 프롬프트에 추가됩니다. 내장 Obsidian 스킬은 항상 켜져 있습니다.",
    skillAdd: "스킬 추가",
    skillAddDesc: "커스텀 스킬을 추가합니다. 활성화하면 내용이 시스템 프롬프트에 주입됩니다.",
    skillEdit: "편집",
    skillDelete: "삭제",
    skillModalNew: "새 스킬",
    skillModalEdit: "스킬 편집",
    skillNameLabel: "이름",
    skillNamePlaceholder: "예: 한국어 윤문 다듬기",
    skillDescLabel: "어떤 일을 하나요?",
    skillDescPlaceholder: "이 스킬이 어떤 일을 하는지 적어주세요 (AI 생성에 사용됩니다)",
    skillContentLabel: "내용 (마크다운)",
    skillContentPlaceholder: "생성하기를 누르면 AI가 작성합니다. 직접 마크다운으로 작성해도 됩니다...",
    skillGenerate: "AI로 생성하기",
    skillGenerating: "생성 중...",
    skillGenerateNeedInput: "먼저 이름과 '어떤 일을 하는지'를 입력하세요.",
    skillGenerateFailed: "스킬 생성에 실패했습니다:",
    skillSave: "저장",
    skillCancel: "취소",
    skillNameRequired: "이름과 내용을 입력하세요.",
    mcpServers: "MCP 서버",
    mcpNoServers: "설정된 MCP 서버가 없습니다.",
    mcpManage: "MCP 서버 관리",
    mcpManageDesc: "MCP 서버 설정을 편집하고 연결을 관리합니다",
    mcpEdit: "설정 편집",
    mcpStopAll: "모두 종료",
    mcpStopped: "모든 MCP 서버 연결이 종료되었습니다.",
    mcpModalTitle: "MCP 서버 설정",
    mcpModalTools: (name: string, count: number) => `${name} — 도구 ${count}개`,
    mcpModalDesc: "MCP 서버 설정을 JSON 형식으로 편집하세요.",
    mcpModalSave: "저장 및 연결",
    mcpModalCancel: "닫기",
    mcpModalJsonError: "❌ JSON 형식이 올바르지 않습니다.",
    mcpModalConfigError: (message: string) => `❌ MCP 설정이 올바르지 않습니다: ${message}`,
    mcpModalSaving: "MCP 설정 저장됨. 서버 연결 중...",
    mcpModalConnected: (names: string) => `✅ MCP 서버 연결: ${names}`,
    mcpModalFailed: (names: string) => `❌ MCP 서버 실패: ${names}`,
    mcpModalNoServers: "설정된 MCP 서버가 없습니다.",
    mcpStatusTitle: "연결 상태",
    mcpStatusDisconnected: (name: string) => `${name} — 연결 끊김`,
    mcpStatusNone: "연결된 서버가 없습니다.",
    folderSelectPlaceholder: "폴더를 선택하세요...",
    confirmToolExecution: "노트 변경 확인",
    confirmToolExecutionDesc: "노트를 생성·편집·삭제·이동하는 도구 실행 전 확인 대화상자를 표시합니다",
    secAppearance: "모양",
    secChat: "대화",
    secVault: "볼트 관리",
    mcpTimeout: "MCP 도구 타임아웃",
    mcpTimeoutDesc: "MCP 도구 요청 타임아웃 (1~60초)",
    // Graph RAG 검색 설정 I18N 키 (Req 9)
    graphRagSearch: "Graph RAG 검색",
    graphTraversalDepth: "그래프 순회 깊이",
    graphTraversalDepthDesc: "검색 결과에서 링크를 따라 확장할 hop 수 (0~3, 0이면 그래프 순회 비활성)",
    chunkMaxSize: "청크 최대 크기",
    chunkMaxSizeDesc: "단일 청크의 최대 크기 (문자 수, 최소 1, 기본값 2000)",
    chunkOverlap: "청크 겹침 크기",
    chunkOverlapDesc: "인접 청크 간 겹침 크기 (문자 수, 청크 최대 크기보다 작아야 함, 기본값 200)",
    // Second Brain Layer 설정 I18N 키 (Req 12.1)
    secondBrain: "Second Brain",
    secondBrainEnabled: "Second Brain 활성화",
    secondBrainEnabledDesc: "능동 지식 레이어를 켭니다. 꺼져 있는 동안에는 어떤 노트도 자동으로 생성·수정·삭제하지 않습니다.",
    secondBrainWikiFolder: "위키 폴더",
    secondBrainWikiFolderDesc: "Second Brain 노트를 생성·관리할 루트 폴더 (기본값: Second Brain)",
    secondBrainScheduler: "스케줄러 활성화",
    secondBrainSchedulerDesc: "주기가 지났으면 앱 시작 시 비파괴 정리 파이프라인을 자동 실행합니다",
    secondBrainInterval: "스케줄러 주기 (시간)",
    secondBrainIntervalDesc: "자동 스케줄러 실행 간 최소 시간 (최소 1, 기본값 24)",
    // JSON 에디터 관련 I18N 키
    mcpFormatBtn: "포맷",
    mcpTemplateBtn: "템플릿 삽입",
    mcpBracketError: (char: string, line: number, col: number) => `줄 ${line}, 열 ${col}에서 짝이 맞지 않는 '${char}'`,
    mcpJsonErrorAt: (line: number, col: number, msg: string) => `줄 ${line}, 열 ${col}에서 JSON 오류: ${msg}`,
  },
  ja: {
    pluginDesc: "ボルトを読み・検索し・書くAIアシスタントサイドバーです。以下の機能は設定するまですべてオフか空の状態で、承認なしにノートを触ることはありません。",
    featuresLabel: "含まれる機能",
    features: [
      {
        name: "4種のAIバックエンド",
        desc: "AWS Bedrock、Google Gemini、OpenAI（互換エンドポイントを含む）、そして完全ローカルで動くOllama。対話モデルと埋め込みモデルは別々に選べます。",
      },
      {
        name: "ボルトツールを使う対話",
        desc: "アシスタント自身がノートを検索・読み取り・作成・編集・移動・削除します。ノートを変更するツールは実行前に確認を求めます。",
      },
      {
        name: "Graph RAG検索",
        desc: "ノートをチャンクに分けて埋め込みでインデックスし、Wikiリンクをたどって結果を広げ、キーワード一致と統合します — 隣接ノート経由でしか届かないノートも結果に上がります。",
      },
      {
        name: "LLM Wiki (Second Brain)",
        desc: "1つのトピックをノート1件に統合し、矛盾をレポートし、決定台帳を積み、重複候補を示し、孤立ノートにリンクを提案し、復習キューを出し、Inboxを整理し、知識ギャップレポートを書きます。すべての書き込みはオプトインで、自動生成領域だけを置き換えます。",
      },
      {
        name: "再利用できるテンプレート",
        desc: "テンプレートを一度保存して使い続けます。ノート作成時に{{変数}}の箇所を埋めるため、別の日に書いた文書も同じ様式を保ちます。",
      },
      {
        name: "Webページ要約",
        desc: "URLを入れると本文を取得し、設定言語に翻訳・要約してノートに保存します。",
      },
      {
        name: "タグ自動生成",
        desc: "開いているノートを分析してタグ3〜5個をフロントマターに追加します — Obsidianのグラフビューのカラーグループ・フィルタが使うタグです。",
      },
      {
        name: "To-Doと振り返り",
        desc: "日付別のTo-Doノートを作り未完了項目を繰り越し、古いファイルをアーカイブ・整理します。AIによる振り返りを本日のノートに追記できます。",
      },
      {
        name: "P.A.R.A整理",
        desc: "P.A.R.Aの4フォルダを作成し、既存ノートをAIが分類して移動します。",
      },
      {
        name: "MCPサーバー",
        desc: "外部のMCPサーバーを接続し、ボルトツールと同じ会話の中で一緒に使えます。",
      },
      {
        name: "スキル",
        desc: "内蔵のObsidian知識（Markdown、Bases、Canvas）と自作スキル（AIが下書きを書きます）。有効にしたスキルはシステムプロンプトに注入されます。",
      },
      {
        name: "引用チェック",
        desc: "回答が引用したノートがボルトに実際に無い場合に警告します。",
      },
    ],
    readmeLabel: "📖 ドキュメント",
    readmeFile: "README-JA.md",
    sponsorLabel: "このプラグインが役に立ったら、開発を支援してください。",
    language: "言語",
    languageDesc: "設定UIの言語",
    // AI バックエンド選択
    aiBackendLabel: "AIバックエンド",
    aiBackendDesc: "使用するAIバックエンドを選択",
    reindexNeeded:
      "埋め込みモデルが変更されました。既存のボルトインデックスは異なる埋め込み空間を使用しているため、検索結果が空になる場合があります。ボルトを再インデックスしてください。",
    // Gemini 資格情報
    awsAuth: "Gemini API",
    apiKey: "Gemini APIキー",
    apiKeyDesc: "Google AI Studioから取得したGemini APIキー",
    apiKeyPlaceholder: "Gemini APIキーを入力",
    // Bedrock 資格情報
    bedrockApiKeyLabel: "Bedrock APIキー",
    bedrockApiKeyDesc: "認証に使用するBedrockの長期APIキー。AWS Bedrockコンソールから APIキーを取得してください。",
    bedrockApiKeyPlaceholder: "Bedrock APIキーを入力",
    awsRegionLabel: "AWSリージョン",
    awsRegionDesc: "Bedrock API用 AWSリージョン",
    awsRegionPlaceholder: "us-east-1",
    // Bedrock モデル設定
    bedrockChatModelLabel: "Bedrockチャットモデル",
    bedrockChatModelDesc: "BedrockチャットモデルID",
    bedrockEmbeddingModelLabel: "Bedrock埋め込みモデル",
    bedrockEmbeddingModelDesc: "Bedrock埋め込みモデルID（ボルトドキュメントのインデックスに使用）",
    // OpenAI バックエンド設定 (Req 2.1, 13)
    openaiAuth: "OpenAI",
    openaiApiKey: "OpenAI APIキー",
    openaiApiKeyDesc: "OpenAI APIキー",
    openaiApiKeyPlaceholder: "OpenAI APIキーを入力",
    openaiBaseUrl: "Base URL（任意）",
    openaiBaseUrlDesc: "OpenAI互換エンドポイント（/v1を含む）。空の場合はOpenAI公式APIを使用します",
    openaiBaseUrlPlaceholder: "https://api.openai.com/v1",
    openaiChatModel: "OpenAIチャットモデル",
    openaiChatModelDesc: "OpenAIチャットモデルID",
    openaiEmbeddingModel: "OpenAI埋め込みモデル",
    openaiEmbeddingModelDesc: "OpenAI埋め込みモデルID（ボルトドキュメントのインデックスに使用）",
    // Ollama バックエンド設定 (Req 2.2, 13)
    ollamaServer: "Ollama",
    ollamaBaseUrl: "サーバー Base URL",
    ollamaBaseUrlDesc: "Ollamaサーバーアドレス（空の場合はhttp://localhost:11434を使用）",
    ollamaBaseUrlPlaceholder: "http://localhost:11434",
    ollamaChatModel: "Ollamaチャットモデル",
    ollamaChatModelDesc: "OllamaチャットモデルID",
    ollamaEmbeddingModel: "Ollama埋め込みモデル",
    ollamaEmbeddingModelDesc: "Ollama埋め込みモデルID（ボルトドキュメントのインデックスに使用）",
    // base URL 形式エラー (Req 2.10)
    baseUrlInvalid: "無効なbase URLです。http:// または https:// で始まる必要があります",
    modelSettings: "モデル設定",
    chatModel: "チャットモデル",
    chatModelDesc: "GeminiモデルID",
    embeddingModel: "埋め込みモデル",
    embeddingModelDesc: "Gemini埋め込みモデルID（ボルトドキュメントのインデックスに使用）",
    genSettings: "生成設定",
    maxTokens: "最大トークン数",
    maxTokensDesc: "応答の最大トークン数",
    effortLabel: "推論強度 (Effort)",
    effortDesc:
      "選択したモデルの推論の深さです。対応モデルでは temperature の代わりにこの値を使用します。",
    systemPrompt: "システムプロンプト",
    systemPromptDesc: "内蔵の基本プロンプトに追加する指示です。空欄の場合は内蔵プロンプトのみを使用します。",
    systemPromptPlaceholder: "システムプロンプトを入力...",
    systemPromptEdit: "編集",
    systemPromptSave: "保存",
    systemPromptCancel: "キャンセル",
    ux: "ユーザー体験",
    greeting: "ウェルカムメッセージ",
    greetingDesc: "サイドバーを開いた時に表示される挨拶",
    paraSetup: "P.A.R.A セットアップ",
    paraSetupDesc: "P.A.R.A（Projects, Areas, Resources, Archives）は汎用的な情報整理システムです。ボルトのルートに4つのフォルダを作成し、AIが既存のノートを適切なカテゴリに分類して移動します。",
    paraSetupBtn: "P.A.R.A セットアップ",
    paraModalTitle: "P.A.R.A セットアップ",
    paraModalRunning: "ボルトをP.A.R.A構造で整理中...",
    paraModalDone: "P.A.R.A セットアップ完了！",
    paraModalCreated: "作成されたフォルダ",
    paraModalMoved: "移動されたノート",
    paraModalSkipped: "スキップ（名前重複）",
    paraModalErrors: "エラー",
    paraModalNoFiles: "移動するノートがありません — フォルダの準備ができました。",
    paraModalClose: "閉じる",
    autoAttach: "アクティブノートを自動添付",
    autoAttachDesc: "現在開いているノートをコンテキストとして自動的に含める",
    persistChat: "チャット履歴を保存",
    persistChatDesc: "プラグイン再起動後も会話を保持",
    clearHistory: "全履歴を削除",
    clearHistoryDesc: "保存されたすべてのチャットセッションを削除",
    clearHistoryBtn: "履歴を削除",
    clearHistoryConfirm: "すべてのチャット履歴が削除されました。",
    templateFolder: "テンプレートフォルダ",
    templateFolderDesc: "テンプレートを保存するボルト内のフォルダパス",
    chatFontSize: "チャットフォントサイズ",
    chatFontSizeDesc: "チャットエリアのフォントサイズ (px)",
    codeStylerInstall: "Code Stylerをインストール",
    codeStylerInfo: "Code Stylerプラグインをインストールして、言語別スタイリングでコードブロックの表示を強化します。",
    pluginInstalled: "インストール済み",
    recommendedPlugins: "おすすめプラグイン",
    todo: "To-Do",
    todoFolder: "To-Doフォルダ",
    todoFolderDesc: "To-Doノートを保存するボルト内のフォルダパス（ファイルは YYYY-MM-DD To-Do.md 形式でフラットに保存）",
    todoTasksInstall: "Tasksプラグインをインストール",
    todoTasksInfo: "Tasksプラグインをインストールして、期限、繰り返しタスク、クエリなどの高度なタスク管理を有効にします。",
    todoTemplate: "To-Doテンプレート",
    todoTemplateDesc: "テンプレートフォルダ内のテンプレートファイル名（.md不要）。変数: {{date}}, {{prevDate}}。",
    todoTemplatePlaceholder: "Daily To-Do",
    todoArchiveFolder: "アーカイブフォルダ",
    todoArchiveFolderDesc: "古いTo-Doファイルを移動するフォルダ",
    todoArchiveDays: "アーカイブ基準（日数）",
    todoArchiveDaysDesc: "この日数を超えたTo-DoファイルをアーカイブフォルダにMoveします",
    archiveClean: "アーカイブ整理",
    archiveCleanFolder: "整理対象フォルダ",
    archiveCleanFolderDesc: "アーカイブ整理ボタンで削除するファイルがあるフォルダ",
    archiveCleanDays: "削除基準（日数）",
    archiveCleanDaysDesc: "アーカイブ整理ボタン使用時、アーカイブフォルダ内でこの日数を超えたファイルを削除します",
    archiveCleanBtn: "アーカイブ整理",
    webClip: "Webクリッパー",
    webClipFolder: "保存フォルダ",
    webClipFolderDesc: "Webページ要約を保存するフォルダ",
    skills: "スキル",
    skillsDesc: "有効なスキルの知識・指示がシステムプロンプトに追加されます。内蔵のObsidianスキルは常に有効です。",
    skillAdd: "スキルを追加",
    skillAddDesc: "カスタムスキルを追加します。有効にすると内容がシステムプロンプトに注入されます。",
    skillEdit: "編集",
    skillDelete: "削除",
    skillModalNew: "新しいスキル",
    skillModalEdit: "スキルを編集",
    skillNameLabel: "名前",
    skillNamePlaceholder: "例: 韓国語の推敲",
    skillDescLabel: "何をするスキルですか？",
    skillDescPlaceholder: "このスキルが何をするか記述してください（AI生成に使用されます）",
    skillContentLabel: "内容（マークダウン）",
    skillContentPlaceholder: "「生成」を押すとAIが作成します。自分でマークダウンで書くこともできます...",
    skillGenerate: "AIで生成",
    skillGenerating: "生成中...",
    skillGenerateNeedInput: "先に名前と「何をするスキルか」を入力してください。",
    skillGenerateFailed: "スキルの生成に失敗しました:",
    skillSave: "保存",
    skillCancel: "キャンセル",
    skillNameRequired: "名前と内容を入力してください。",
    mcpServers: "MCPサーバー",
    mcpNoServers: "MCPサーバーが設定されていません。",
    mcpManage: "MCPサーバー管理",
    mcpManageDesc: "MCPサーバー設定を編集し、接続を管理します",
    mcpEdit: "設定を編集",
    mcpStopAll: "すべて停止",
    mcpStopped: "すべてのMCPサーバー接続が終了しました。",
    mcpModalTitle: "MCPサーバー設定",
    mcpModalTools: (name: string, count: number) => `${name} — ツール${count}個`,
    mcpModalDesc: "MCPサーバー設定をJSON形式で編集してください。",
    mcpModalSave: "保存して接続",
    mcpModalCancel: "閉じる",
    mcpModalJsonError: "❌ JSON形式が正しくありません。",
    mcpModalConfigError: (message: string) => `❌ MCP設定が正しくありません: ${message}`,
    mcpModalSaving: "MCP設定を保存しました。サーバーに接続中...",
    mcpModalConnected: (names: string) => `✅ MCP接続: ${names}`,
    mcpModalFailed: (names: string) => `❌ MCP失敗: ${names}`,
    mcpModalNoServers: "MCPサーバーが設定されていません。",
    mcpStatusTitle: "接続状態",
    mcpStatusDisconnected: (name: string) => `${name} — 切断`,
    mcpStatusNone: "接続されたサーバーがありません。",
    folderSelectPlaceholder: "フォルダを選択...",
    confirmToolExecution: "ノート変更の確認",
    confirmToolExecutionDesc: "ノートを作成・編集・削除・移動するツールの実行前に確認ダイアログを表示します",
    secAppearance: "外観",
    secChat: "チャット",
    secVault: "ボルト管理",
    mcpTimeout: "MCPツールタイムアウト",
    mcpTimeoutDesc: "MCPツールリクエストのタイムアウト（1〜60秒）",
    // Graph RAG 検索設定 I18N キー (Req 9)
    graphRagSearch: "Graph RAG 検索",
    graphTraversalDepth: "グラフ探索の深さ",
    graphTraversalDepthDesc: "検索結果からリンクをたどって拡張するhop数（0〜3、0でグラフ探索を無効化）",
    chunkMaxSize: "チャンク最大サイズ",
    chunkMaxSizeDesc: "単一チャンクの最大サイズ（文字数、最小1、デフォルト2000）",
    chunkOverlap: "チャンク重複サイズ",
    chunkOverlapDesc: "隣接チャンク間の重複サイズ（文字数、チャンク最大サイズより小さくする必要あり、デフォルト200）",
    // Second Brain Layer 設定 I18N キー (Req 12.1)
    secondBrain: "Second Brain",
    secondBrainEnabled: "Second Brainを有効化",
    secondBrainEnabledDesc: "能動的なナレッジレイヤーを有効にします。オフの間は、ノートが自動的に作成・変更・削除されることはありません。",
    secondBrainWikiFolder: "Wikiフォルダ",
    secondBrainWikiFolderDesc: "Second Brainノートを作成・管理するルートフォルダ（デフォルト: Second Brain）",
    secondBrainScheduler: "スケジューラを有効化",
    secondBrainSchedulerDesc: "間隔が経過した場合、アプリ起動時に非破壊的なクリーンアップパイプラインを自動実行します",
    secondBrainInterval: "スケジューラ間隔（時間）",
    secondBrainIntervalDesc: "自動スケジューラ実行間の最小時間（最小1、デフォルト24）",
    // JSON エディター関連 I18N キー
    mcpFormatBtn: "フォーマット",
    mcpTemplateBtn: "テンプレート挿入",
    mcpBracketError: (char: string, line: number, col: number) => `行${line}, 列${col}で対応しない '${char}'`,
    mcpJsonErrorAt: (line: number, col: number, msg: string) => `行${line}, 列${col}のJSONエラー: ${msg}`,
  },
} as const;

/** 설정 상단 기능 목록의 한 항목. */
export interface FeatureSummary {
  name: string;
  desc: string;
}

/**
 * 설정 상단에 나열할 기능 목록. 해당 언어에 없으면 en으로 폴백한다.
 *
 * `I18N[lang].features`는 `as const` 때문에 언어별로 다른 튜플 타입이 되므로, 화면에서
 * 쓸 수 있는 하나의 타입으로 좁혀 돌려준다.
 */
export function localizedFeatures(lang: Locale): readonly FeatureSummary[] {
  const dict = (I18N[lang] ?? I18N.en) as { features?: readonly FeatureSummary[] };
  return dict.features ?? I18N.en.features;
}

// 설정 탭
export class GeminiSettingTab extends PluginSettingTab {
  plugin: GeminiAssistantPlugin;
  // 자격증명 변경 시 모델 목록 재로드 디바운스 타이머
  private credentialDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  // 탭 오픈 시점의 임베딩 구성 시그니처. 탭을 닫을 때 변경 여부를 비교해
  // 재인덱싱 안내를 띄운다. (display()는 재렌더로 여러 번 호출되므로 최초 1회만 기록)
  private embeddingSignatureSnapshot: string | null = null;

  constructor(app: App, plugin: GeminiAssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // 자격증명 변경 후 모델 목록 재로드 (디바운스 1.5초)
  private scheduleModelReload(): void {
    if (this.credentialDebounceTimer) {
      clearTimeout(this.credentialDebounceTimer);
    }
    this.credentialDebounceTimer = setTimeout(() => {
      this.credentialDebounceTimer = null;
      this.display();
    }, 1500);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // 탭 최초 오픈 시점의 임베딩 시그니처를 1회 기록한다(백엔드 전환에 따른 재렌더에서는 유지).
    if (this.embeddingSignatureSnapshot === null) {
      this.embeddingSignatureSnapshot = embeddingSignature(this.plugin.settings);
    }
    const lang = this.plugin.settings.language;
    const t = I18N[lang] || I18N.en;
    // 신규 백엔드 라벨용 키 단위 en 폴백 헬퍼 (Req 13.3):
    // 현재 언어에 해당 키가 없으면 영어(en) 라벨로 폴백한다.
    const tk = (key: string): string => {
      const cur = (I18N[lang] as Record<string, unknown>)[key];
      if (typeof cur === "string") return cur;
      const en = (I18N.en as Record<string, unknown>)[key];
      return typeof en === "string" ? en : "";
    };

    // 최상단 타이틀 헤딩은 두지 않는다. 옵시디언은 설정 탭을 이미 플러그인 이름
    // 아래에 렌더하므로, 심사 기준이 헤딩에 플러그인 이름과 "Settings"를 넣는 것을
    // 금지한다(첫 섹션이 하나뿐이면 헤딩 자체가 불필요하다).

    // 플러그인 설명 + 기능 목록 + README 링크. 후원 배너는 설정 맨 아래에 둔다.
    const aboutBox = containerEl.createDiv({ cls: "ba-about-box" });
    aboutBox.createEl("p", { text: t.pluginDesc, cls: "ba-about-desc" });

    // 기능 목록 — 무엇이 들어 있는지 한눈에 보이게 항목별 제목 + 한 줄 설명으로 나열한다.
    aboutBox.createEl("p", { text: tk("featuresLabel"), cls: "ba-features-label" });
    const featureList = aboutBox.createEl("ul", { cls: "ba-features" });
    for (const feature of localizedFeatures(lang)) {
      const item = featureList.createEl("li");
      item.createEl("strong", { text: feature.name });
      item.createSpan({ text: ` — ${feature.desc}` });
    }

    // README 링크 (GitHub에서 열기)
    const readmeRow = aboutBox.createDiv({ cls: "ba-about-readme" });
    const readmeLink = readmeRow.createEl("a", {
      text: t.readmeLabel,
      cls: "ba-readme-link",
    });
    const readmeFilePath = `${this.app.vault.configDir}/plugins/${BRANDING.pluginId}/${t.readmeFile}`;
    readmeLink.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        // README 파일은 .obsidian 하위 플러그인 폴더에 위치하므로 adapter를 직접 사용
        const content = await this.app.vault.adapter.read(readmeFilePath);
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(
          this.app.vault.getAbstractFileByPath(readmeFilePath) as any
        ).catch(() => {
          window.open(`https://github.com/teinam/obsidian-agent-llms/blob/main/${t.readmeFile}`);
        });
      } catch {
        window.open(`https://github.com/teinam/obsidian-agent-llms/blob/main/${t.readmeFile}`);
      }
    });

    // 언어 선택
    new Setting(containerEl)
      .setName(t.language)
      .setDesc(t.languageDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("en", "English")
          .addOption("ko", "한국어")
          .addOption("ja", "日本語")
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as "en" | "ko" | "ja";
            await this.plugin.saveSettings();
            // 열려있는 채팅 뷰 UI 즉시 재빌드
            const leaves = this.app.workspace.getLeavesOfType(BRANDING.viewType);
            for (const leaf of leaves) {
              (leaf.view as any).rebuildUI?.();
            }
            this.display();
          })
      );

    // AI 백엔드 선택 (언어 선택 바로 아래)
    new Setting(containerEl)
      .setName(t.aiBackendLabel)
      .setDesc(t.aiBackendDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("gemini", "Gemini")
          .addOption("bedrock", "Bedrock")
          .addOption("openai", "OpenAI")
          .addOption("ollama", "Ollama")
          .setValue(this.plugin.settings.aiBackend)
          .onChange(async (value) => {
            // 4값 union으로 캐스팅 (Req 1.1)
            this.plugin.settings.aiBackend = value as "bedrock" | "gemini" | "openai" | "ollama";
            // 백엔드가 바뀌면 effort 허용 집합도 달라지므로(예: Anthropic 전용 max)
            // 새 백엔드·모델 기준으로 저장값을 보정한다.
            this.plugin.settings.effort = clampEffort(
              this.plugin.settings.aiBackend,
              activeChatModelId(this.plugin.settings),
              this.plugin.settings.effort
            );
            await this.plugin.saveSettings();
            this.plugin.recreateAiClient();
            updateBranding(this.plugin.settings.aiBackend);
            // 리본/뷰 헤더 아이콘을 새 백엔드 브랜딩으로 즉시 갱신한다.
            // refreshBranding이 열린 뷰를 rebuildUI(→onOpen→preloadModels)하므로,
            // 헤더 아이콘 갱신과 새 백엔드 모델 목록 재로드가 한 번에 처리된다.
            this.plugin.refreshBranding();
            this.display(); // 설정 탭 UI 재렌더링 (표시 필드 집합 갱신 — Req 12.5)
          })
      );

    // 조건부 자격증명 필드: 백엔드에 따라 다른 필드 표시
    if (this.plugin.settings.aiBackend === "gemini") {
      // Gemini API 설정
      new Setting(containerEl).setName(t.awsAuth).setHeading();

      const apiKeySetting = new Setting(containerEl)
        .setName(t.apiKey)
        .setDesc(t.apiKeyDesc)
        .addText((text) => {
          text
            .setPlaceholder(t.apiKeyPlaceholder)
            .setValue(this.plugin.settings.geminiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.geminiApiKey = value.trim();
              await this.plugin.saveSettings();
              // API 키 변경 시 모델 목록 재로드 예약
              this.scheduleModelReload();
            });
          text.inputEl.type = "password";
          text.inputEl.addClass("ba-secret-input");
        });
      // 눈 버튼 추가
      this.addToggleVisibilityButton(apiKeySetting.controlEl);
    } else if (this.plugin.settings.aiBackend === "bedrock") {
      // Bedrock (AWS) 자격증명 설정
      new Setting(containerEl).setName("AWS Bedrock").setHeading();

      const bedrockApiKeySetting = new Setting(containerEl)
        .setName(t.bedrockApiKeyLabel)
        .setDesc(t.bedrockApiKeyDesc)
        .addText((text) => {
          text
            .setPlaceholder(t.bedrockApiKeyPlaceholder)
            .setValue(this.plugin.settings.bedrockApiKey)
            .onChange(async (value) => {
              this.plugin.settings.bedrockApiKey = value.trim();
              await this.plugin.saveSettings();
              this.scheduleModelReload();
            });
          text.inputEl.type = "password";
          text.inputEl.addClass("ba-secret-input");
        });
      this.addToggleVisibilityButton(bedrockApiKeySetting.controlEl);

      new Setting(containerEl)
        .setName(t.awsRegionLabel)
        .setDesc(t.awsRegionDesc)
        .addText((text) =>
          text
            .setPlaceholder(t.awsRegionPlaceholder)
            .setValue(this.plugin.settings.awsRegion)
            .onChange(async (value) => {
              this.plugin.settings.awsRegion = value.trim() || "us-east-1";
              await this.plugin.saveSettings();
              // 리전 변경 시 모델 목록 재로드 예약
              this.scheduleModelReload();
            })
        );
    } else if (this.plugin.settings.aiBackend === "openai") {
      // OpenAI 자격증명 설정 (Req 12.1): API 키(마스킹) + 선택적 base URL
      new Setting(containerEl).setName(tk("openaiAuth")).setHeading();

      // OpenAI API 키 — 기존 password + 눈 버튼 마스킹 패턴 재사용 (Req 3.7)
      const openaiKeySetting = new Setting(containerEl)
        .setName(tk("openaiApiKey"))
        .setDesc(tk("openaiApiKeyDesc"))
        .addText((text) => {
          text
            .setPlaceholder(tk("openaiApiKeyPlaceholder"))
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openaiApiKey = value.trim();
              await this.plugin.saveSettings();
              // API 키 변경 시 모델 목록 재로드 예약
              this.scheduleModelReload();
            });
          text.inputEl.type = "password";
          text.inputEl.addClass("ba-secret-input");
        });
      this.addToggleVisibilityButton(openaiKeySetting.controlEl);

      // 선택적 base URL — onChange에서 형식 검증, 실패 시 Notice + 이전 유효값 유지 (Req 2.10)
      this.addBaseUrlSetting(
        containerEl,
        tk("openaiBaseUrl"),
        tk("openaiBaseUrlDesc"),
        tk("openaiBaseUrlPlaceholder"),
        () => this.plugin.settings.openaiBaseUrl,
        (v) => { this.plugin.settings.openaiBaseUrl = v; },
        tk("baseUrlInvalid"),
      );
    } else if (this.plugin.settings.aiBackend === "ollama") {
      // Ollama 서버 설정 (Req 12.2): 서버 base URL (API 키 없음)
      new Setting(containerEl).setName(tk("ollamaServer")).setHeading();

      // 서버 base URL — onChange에서 형식 검증, 실패 시 Notice + 이전 유효값 유지 (Req 2.10)
      this.addBaseUrlSetting(
        containerEl,
        tk("ollamaBaseUrl"),
        tk("ollamaBaseUrlDesc"),
        tk("ollamaBaseUrlPlaceholder"),
        () => this.plugin.settings.ollamaBaseUrl,
        (v) => { this.plugin.settings.ollamaBaseUrl = v; },
        tk("baseUrlInvalid"),
      );
    }

    // 조건부 모델 설정: 백엔드별 모델 드롭다운 표시
    new Setting(containerEl).setName(t.modelSettings).setHeading();

    if (this.plugin.settings.aiBackend === "gemini") {
      // Gemini 채팅 모델 드롭다운
      new Setting(containerEl)
        .setName(t.chatModel)
        .setDesc(t.chatModelDesc)
        .addDropdown((dropdown) => {
          // 현재 설정값을 기본 옵션으로 추가
          const current = this.plugin.settings.chatModel;
          dropdown.addOption(current, current);
          dropdown.setValue(current);
          dropdown.onChange(async (value) => {
            this.plugin.settings.chatModel = value;
            // 모델이 바뀌면 effort 허용 집합이 달라지므로 저장값을 보정한다.
            this.plugin.settings.effort = clampEffort(
              "gemini",
              value,
              this.plugin.settings.effort
            );
            await this.plugin.saveSettings();
            // effort 항목 노출/옵션이 모델에 따라 바뀌므로 탭을 다시 그린다.
            this.display();
          });
          // 비동기로 모델 목록 로드 후 드롭다운 갱신
          (async () => {
            try {
              const models = await this.plugin.aiClient.listModels();
              dropdown.selectEl.empty();
              for (const m of models) {
                dropdown.addOption(m.modelId, m.modelName || m.modelId);
              }
              dropdown.setValue(this.plugin.settings.chatModel);
            } catch {
              // 모델 로드 실패 시 현재값 유지
            }
          })();
        });

      // Gemini 임베딩 모델
      new Setting(containerEl)
        .setName(t.embeddingModel)
        .setDesc(t.embeddingModelDesc)
        .addText((text) =>
          text
            .setPlaceholder("text-embedding-004")
            .setValue(this.plugin.settings.embeddingModel)
            .onChange(async (value) => {
              this.plugin.settings.embeddingModel = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.aiBackend === "bedrock") {
      // Bedrock 채팅 모델 드롭다운
      new Setting(containerEl)
        .setName(t.bedrockChatModelLabel)
        .setDesc(t.bedrockChatModelDesc)
        .addDropdown((dropdown) => {
          const current = this.plugin.settings.bedrockChatModel;
          if (current) {
            dropdown.addOption(current, current);
          }
          dropdown.setValue(current);
          dropdown.onChange(async (value) => {
            this.plugin.settings.bedrockChatModel = value;
            // 모델이 바뀌면 effort 허용 집합이 달라지므로 저장값을 보정한다.
            this.plugin.settings.effort = clampEffort(
              "bedrock",
              value,
              this.plugin.settings.effort
            );
            await this.plugin.saveSettings();
            // effort 항목 노출/옵션이 모델에 따라 바뀌므로 탭을 다시 그린다.
            this.display();
          });
          // 비동기로 모델 목록 로드 후 드롭다운 갱신
          (async () => {
            try {
              const models = await this.plugin.aiClient.listModels();
              // 빈 목록이면 기존 옵션을 지우지 않는다. 목록 조회는 컨트롤 플레인
              // 권한을 요구하므로(API 키 인증 등에서 실패 가능) 지워버리면 이미
              // 설정된 모델까지 선택 불가가 된다.
              if (models.length === 0) return;
              dropdown.selectEl.empty();
              for (const m of models) {
                dropdown.addOption(m.modelId, m.modelName || m.modelId);
              }
              // 저장된 모델이 목록에 없으면 옵션으로 추가해 선택을 유지한다.
              const saved = this.plugin.settings.bedrockChatModel;
              if (saved && !models.some((m) => m.modelId === saved)) {
                dropdown.addOption(saved, saved);
              }
              dropdown.setValue(saved);
            } catch {
              // 모델 로드 실패 시 현재값 유지
            }
          })();
        });

      // Bedrock 임베딩 모델 드롭다운
      new Setting(containerEl)
        .setName(t.bedrockEmbeddingModelLabel)
        .setDesc(t.bedrockEmbeddingModelDesc)
        .addDropdown((dropdown) => {
          const current = this.plugin.settings.bedrockEmbeddingModel;
          if (current) {
            dropdown.addOption(current, current);
          }
          dropdown.setValue(current);
          dropdown.onChange(async (value) => {
            this.plugin.settings.bedrockEmbeddingModel = value;
            await this.plugin.saveSettings();
          });
          // 비동기로 임베딩 모델 목록 로드 후 드롭다운 갱신 (kind="embedding")
          (async () => {
            try {
              const models = await this.plugin.aiClient.listModels("embedding");
              // 빈 목록/오류 시 현재값 유지 (Req 7.9)
              if (!models || models.length === 0) return;
              const cur = this.plugin.settings.bedrockEmbeddingModel;
              dropdown.selectEl.empty();
              for (const m of models) {
                dropdown.addOption(m.modelId, m.modelName || m.modelId);
              }
              // 현재 설정 ID가 목록에 없으면 현재값을 옵션으로 추가하여 선택 유지 (Req 7.9.1)
              if (cur && !models.some((m) => m.modelId === cur)) {
                dropdown.addOption(cur, cur);
              }
              dropdown.setValue(cur);
            } catch {
              // 모델 로드 실패 시 현재값 유지
            }
          })();
        });
    } else if (this.plugin.settings.aiBackend === "openai") {
      // OpenAI 채팅/임베딩 모델 드롭다운 (Req 12.1, 12.3)
      this.addProviderModelDropdown(
        containerEl,
        tk("openaiChatModel"),
        tk("openaiChatModelDesc"),
        () => this.plugin.settings.openaiChatModel,
        (v) => { this.plugin.settings.openaiChatModel = v; },
        "chat",
      );
      this.addProviderModelDropdown(
        containerEl,
        tk("openaiEmbeddingModel"),
        tk("openaiEmbeddingModelDesc"),
        () => this.plugin.settings.openaiEmbeddingModel,
        (v) => { this.plugin.settings.openaiEmbeddingModel = v; },
        "embedding",
      );
    } else if (this.plugin.settings.aiBackend === "ollama") {
      // Ollama 채팅/임베딩 모델 드롭다운 (Req 12.2, 12.3)
      this.addProviderModelDropdown(
        containerEl,
        tk("ollamaChatModel"),
        tk("ollamaChatModelDesc"),
        () => this.plugin.settings.ollamaChatModel,
        (v) => { this.plugin.settings.ollamaChatModel = v; },
        "chat",
      );
      this.addProviderModelDropdown(
        containerEl,
        tk("ollamaEmbeddingModel"),
        tk("ollamaEmbeddingModelDesc"),
        () => this.plugin.settings.ollamaEmbeddingModel,
        (v) => { this.plugin.settings.ollamaEmbeddingModel = v; },
        "embedding",
      );
    }

    // 생성 설정
    new Setting(containerEl).setName(t.genSettings).setHeading();

    new Setting(containerEl)
      .setName(t.maxTokens)
      .setDesc(t.maxTokensDesc)
      .addText((text) =>
        text
          .setPlaceholder("4096")
          .setValue(String(this.plugin.settings.maxTokens))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (Number.isNaN(num)) return;
            // 허용 범위([1, 200000])로 보정한다. 비정상적으로 큰 값이 API에
            // 그대로 전달돼 비용/오류가 발생하는 것을 방지한다.
            const clamped = clampMaxTokens(num);
            this.plugin.settings.maxTokens = clamped;
            await this.plugin.saveSettings();
            // 입력값이 보정됐으면 표시값도 보정 결과로 동기화한다.
            if (clamped !== num) {
              text.setValue(String(clamped));
            }
          })
      );

    // 추론 강도(effort). temperature를 대체하는 파라미터로, 현재 백엔드·모델이
    // 허용하는 값만 노출한다. 지원 모델이 없으면(예: Ollama) 항목 자체를 숨긴다.
    const effortProvider = this.plugin.settings.aiBackend;
    const effortModelId = activeChatModelId(this.plugin.settings);
    const allowedEfforts = effortLevels(effortProvider, effortModelId);
    if (allowedEfforts.length > 0) {
      // 저장값이 허용 집합을 벗어나면 먼저 보정해 확정한다. 표시값만 보정하면
      // 사용자가 드롭다운을 건드리지 않는 한 허용 밖 값이 요청에 실린다.
      const effort = clampEffort(effortProvider, effortModelId, this.plugin.settings.effort);
      if (effort !== this.plugin.settings.effort) {
        this.plugin.settings.effort = effort;
        void this.plugin.saveSettings();
      }
      new Setting(containerEl)
        .setName(t.effortLabel)
        .setDesc(t.effortDesc)
        .addDropdown((dropdown) => {
          for (const level of allowedEfforts) dropdown.addOption(level, level);
          dropdown.setValue(effort);
          dropdown.onChange(async (value) => {
            this.plugin.settings.effort = value as EffortLevel;
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(containerEl)
      .setName(t.systemPrompt)
      .setDesc(t.systemPromptDesc)
      .addButton((btn) =>
        btn.setButtonText(t.systemPromptEdit).onClick(() => {
          new SystemPromptModal(this.app, this.plugin, t).open();
        })
      );

    // 사용자 경험 설정
    // === 모양 (Appearance) ===
    new Setting(containerEl).setName(t.secAppearance).setHeading();

    new Setting(containerEl)
      .setName(t.chatFontSize)
      .setDesc(t.chatFontSizeDesc)
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "10";
        text.inputEl.max = "24";
        text.setValue(String(this.plugin.settings.chatFontSize));
        text.onChange(async (value) => {
          const parsed = parseInt(value, 10);
          if (!Number.isFinite(parsed)) return; // 빈/잘못된 입력 무시
          const clamped = Math.max(10, Math.min(24, parsed));
          this.plugin.settings.chatFontSize = clamped;
          await this.plugin.saveSettings();
          // 열려있는 채팅 뷰에 즉시 반영
          const leaves = this.app.workspace.getLeavesOfType(BRANDING.viewType);
          for (const leaf of leaves) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (leaf.view as any).applyFontSize?.();
          }
          // 범위를 벗어난 입력은 보정된 값으로 표시 갱신
          if (clamped !== parsed) text.setValue(String(clamped));
        });
      });

    new Setting(containerEl)
      .setName(t.greeting)
      .setDesc(t.greetingDesc)
      .addText((text) =>
        text
          .setValue(this.plugin.settings.welcomeGreeting)
          .onChange(async (value) => {
            this.plugin.settings.welcomeGreeting = value;
            await this.plugin.saveSettings();
          })
      );

    // === 대화 (Chat) ===
    new Setting(containerEl).setName(t.secChat).setHeading();

    new Setting(containerEl)
      .setName(t.autoAttach)
      .setDesc(t.autoAttachDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoAttachActiveNote)
          .onChange(async (value) => {
            this.plugin.settings.autoAttachActiveNote = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.persistChat)
      .setDesc(t.persistChatDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.persistChat)
          .onChange(async (value) => {
            this.plugin.settings.persistChat = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.confirmToolExecution)
      .setDesc(t.confirmToolExecutionDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.confirmToolExecution)
          .onChange(async (value) => {
            this.plugin.settings.confirmToolExecution = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.clearHistory)
      .setDesc(t.clearHistoryDesc)
      .addButton((btn) =>
        btn
          .setButtonText(t.clearHistoryBtn)
          .setWarning()
          .onClick(async () => {
            await this.plugin.clearAllSessions();
            // 열려있는 채팅 뷰도 초기화
            const leaves = this.app.workspace.getLeavesOfType(BRANDING.viewType);
            for (const leaf of leaves) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (leaf.view as any).clearChat?.();
            }
            new Notice(t.clearHistoryConfirm);
          })
      );

    // === 볼트 관리 (Vault) ===
    new Setting(containerEl).setName(t.secVault).setHeading();

    new Setting(containerEl)
      .setName(t.templateFolder)
      .setDesc(t.templateFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder("Templates")
          .setValue(this.plugin.settings.templateFolder)
          .onChange(async (value) => {
            this.plugin.settings.templateFolder = value.trim() || "Templates";
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setIcon("folder").setTooltip("Browse").onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.templateFolder = folder;
            await this.plugin.saveSettings();
            this.display();
          }, t.folderSelectPlaceholder).open();
        })
      );

    // P.A.R.A 환경 설정
    new Setting(containerEl)
      .setName(t.paraSetup)
      .setDesc(t.paraSetupDesc)
      .addButton((btn) =>
        btn
          .setButtonText(t.paraSetupBtn)
          .onClick(() => {
            new ParaModal(this.app, this.plugin, {
              paraModalTitle: t.paraModalTitle,
              paraModalRunning: t.paraModalRunning,
              paraModalDone: t.paraModalDone,
              paraModalCreated: t.paraModalCreated,
              paraModalMoved: t.paraModalMoved,
              paraModalSkipped: t.paraModalSkipped,
              paraModalErrors: t.paraModalErrors,
              paraModalNoFiles: t.paraModalNoFiles,
              paraModalClose: t.paraModalClose,
            }).open();
          })
      );

    // === Graph RAG 검색 설정 (Req 9) ===
    new Setting(containerEl).setName(t.graphRagSearch).setHeading();

    // 그래프 순회 깊이 (0~3 정수). 슬라이더 값은 항상 정수지만 normalizeTraversalDepth로 한 번 더 보정한다 (Req 9.2, 9.4, 9.5)
    new Setting(containerEl)
      .setName(t.graphTraversalDepth)
      .setDesc(t.graphTraversalDepthDesc)
      .addSlider((slider) =>
        slider
          .setLimits(0, 3, 1)
          .setValue(this.plugin.settings.graphTraversalDepth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            // 유효 범위(0~3 정수)로 보정 후 저장 (Req 9.4, 9.5)
            const depth = normalizeTraversalDepth(value);
            this.plugin.settings.graphTraversalDepth = depth;
            await this.plugin.saveSettings();
            // 인덱서에 즉시 반영
            this.plugin.indexer.setSearchOptions({ depth });
          })
      );

    // 청크 최대 크기 (최소 1). 입력 변경 시 normalizeChunkConfig로 maxSize>=1, overlap<maxSize 보정 (Req 9.6, 9.7)
    new Setting(containerEl)
      .setName(t.chunkMaxSize)
      .setDesc(t.chunkMaxSizeDesc)
      .addText((text) =>
        text
          .setPlaceholder("2000")
          .setValue(String(this.plugin.settings.chunkMaxSize))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (isNaN(num)) {
              return; // 숫자가 아니면 무시 (입력 도중 상태)
            }
            // maxSize<1→1, overlap>=maxSize→maxSize-1 보정 (Req 9.6, 9.7)
            const normalized = normalizeChunkConfig(num, this.plugin.settings.chunkOverlap);
            this.plugin.settings.chunkMaxSize = normalized.maxSize;
            this.plugin.settings.chunkOverlap = normalized.overlap;
            await this.plugin.saveSettings();
            // 인덱서에 즉시 반영
            this.plugin.indexer.setSearchOptions({
              chunkMaxSize: normalized.maxSize,
              chunkOverlap: normalized.overlap,
            });
          })
      );

    // 청크 겹침 크기 (청크 최대 크기보다 작아야 함). 입력 변경 시 normalizeChunkConfig로 보정 (Req 9.6)
    new Setting(containerEl)
      .setName(t.chunkOverlap)
      .setDesc(t.chunkOverlapDesc)
      .addText((text) =>
        text
          .setPlaceholder("200")
          .setValue(String(this.plugin.settings.chunkOverlap))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (isNaN(num)) {
              return; // 숫자가 아니면 무시 (입력 도중 상태)
            }
            // overlap>=maxSize→maxSize-1 보정 (Req 9.6)
            const normalized = normalizeChunkConfig(this.plugin.settings.chunkMaxSize, num);
            this.plugin.settings.chunkMaxSize = normalized.maxSize;
            this.plugin.settings.chunkOverlap = normalized.overlap;
            await this.plugin.saveSettings();
            // 인덱서에 즉시 반영
            this.plugin.indexer.setSearchOptions({
              chunkMaxSize: normalized.maxSize,
              chunkOverlap: normalized.overlap,
            });
          })
      );

    // === Second Brain Layer 설정 (Req 12.1, 12.2) ===
    // 옵트인 능동 지식 레이어. enabled가 false면 어떤 자동 변경도 일어나지 않는다.
    new Setting(containerEl).setName(t.secondBrain).setHeading();

    // 기능 활성화 토글 (Req 1.1, 12.1)
    new Setting(containerEl)
      .setName(t.secondBrainEnabled)
      .setDesc(t.secondBrainEnabledDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.secondBrain.enabled)
          .onChange(async (value) => {
            // 변경 값을 합쳐 정규화 후 동일 참조에 반영 (Req 1.4, 1.5, 12.2)
            const normalized = normalizeSecondBrainSettings({
              ...this.plugin.settings.secondBrain,
              enabled: value,
            });
            // Object.assign으로 기존 객체를 제자리 갱신해 런타임 참조(컨텍스트)에 즉시 반영한다
            Object.assign(this.plugin.settings.secondBrain, normalized);
            await this.plugin.saveSettings();
          })
      );

    // Wiki_Folder 경로 (Req 1.2, 1.4, 12.1)
    new Setting(containerEl)
      .setName(t.secondBrainWikiFolder)
      .setDesc(t.secondBrainWikiFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder("Second Brain")
          .setValue(this.plugin.settings.secondBrain.wikiFolder)
          .onChange(async (value) => {
            // 공백/빈 문자열은 normalize가 기본값으로 보정한다 (Req 1.4)
            const normalized = normalizeSecondBrainSettings({
              ...this.plugin.settings.secondBrain,
              wikiFolder: value,
            });
            Object.assign(this.plugin.settings.secondBrain, normalized);
            await this.plugin.saveSettings();
            // 보정 결과가 입력과 다르면(공백/빈 입력) 표시값을 갱신
            if (normalized.wikiFolder !== value) text.setValue(normalized.wikiFolder);
          })
      )
      .addButton((btn) =>
        btn.setIcon("folder").setTooltip("Browse").onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            const normalized = normalizeSecondBrainSettings({
              ...this.plugin.settings.secondBrain,
              wikiFolder: folder,
            });
            Object.assign(this.plugin.settings.secondBrain, normalized);
            await this.plugin.saveSettings();
            this.display();
          }, t.folderSelectPlaceholder).open();
        })
      );

    // 스케줄러 활성화 토글 (Req 1.2, 12.1)
    new Setting(containerEl)
      .setName(t.secondBrainScheduler)
      .setDesc(t.secondBrainSchedulerDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.secondBrain.schedulerEnabled)
          .onChange(async (value) => {
            const normalized = normalizeSecondBrainSettings({
              ...this.plugin.settings.secondBrain,
              schedulerEnabled: value,
            });
            Object.assign(this.plugin.settings.secondBrain, normalized);
            await this.plugin.saveSettings();
          })
      );

    // 스케줄러 주기 (시간 단위, 최소 1 정수). normalize가 <1/비정수를 max(1, round(n))로 보정 (Req 1.5)
    new Setting(containerEl)
      .setName(t.secondBrainInterval)
      .setDesc(t.secondBrainIntervalDesc)
      .addText((text) =>
        text
          .setPlaceholder("24")
          .setValue(String(this.plugin.settings.secondBrain.schedulerIntervalHours))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (isNaN(num)) {
              return; // 숫자가 아니면 무시 (입력 도중 상태)
            }
            // <1/비정수 → max(1, round(n)) 보정 (Req 1.5)
            const normalized = normalizeSecondBrainSettings({
              ...this.plugin.settings.secondBrain,
              schedulerIntervalHours: num,
            });
            Object.assign(this.plugin.settings.secondBrain, normalized);
            await this.plugin.saveSettings();
            // 보정 결과가 입력과 다르면 표시값을 동기화
            if (normalized.schedulerIntervalHours !== num) {
              text.setValue(String(normalized.schedulerIntervalHours));
            }
          })
      );

    // To-Do 설정 (평면 폴더 구조)
    new Setting(containerEl).setName(t.todo).setHeading();

    // To-Do 폴더 항목 (평면 구조: {todoFolder}/YYYY-MM-DD To-Do.md)
    new Setting(containerEl)
      .setName(t.todoFolder)
      .setDesc(t.todoFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder(TODO_FOLDER_DEFAULT)
          .setValue(this.plugin.settings.todoFolder)
          .onChange(async (value) => {
            // 빈/공백 입력 시 기본값 적용
            const normalized = normalizePlannerSetting(value, TODO_FOLDER_DEFAULT);
            this.plugin.settings.todoFolder = normalized;
            await this.plugin.saveSettings(); // 즉시 저장
            // 정규화 결과가 입력과 다르면(공백/빈 입력) 표시값을 갱신
            if (normalized !== value) text.setValue(normalized);
          })
      )
      .addButton((btn) =>
        btn.setIcon("folder").setTooltip("Browse").onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.todoFolder = normalizePlannerSetting(folder, TODO_FOLDER_DEFAULT);
            await this.plugin.saveSettings();
            this.display();
          }, t.folderSelectPlaceholder).open();
        })
      );

    new Setting(containerEl)
      .setName(t.todoTemplate)
      .setDesc(t.todoTemplateDesc)
      .addText((text) =>
        text
          .setPlaceholder(t.todoTemplatePlaceholder)
          .setValue(this.plugin.settings.todoTemplateName)
          .onChange(async (value) => {
            this.plugin.settings.todoTemplateName = value.trim() || "Daily To-Do";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.todoArchiveFolder)
      .setDesc(t.todoArchiveFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder("ToDo/Archive")
          .setValue(this.plugin.settings.todoArchiveFolder)
          .onChange(async (value) => {
            this.plugin.settings.todoArchiveFolder = value.trim() || "ToDo/Archive";
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setIcon("folder").setTooltip("Browse").onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.todoArchiveFolder = folder;
            await this.plugin.saveSettings();
            this.display();
          }, t.folderSelectPlaceholder).open();
        })
      );

    new Setting(containerEl)
      .setName(t.todoArchiveDays)
      .setDesc(t.todoArchiveDaysDesc)
      .addText((text) =>
        text
          .setPlaceholder("7")
          .setValue(String(this.plugin.settings.todoArchiveDays))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.todoArchiveDays = num;
              await this.plugin.saveSettings();
            }
          })
      );

    // 아카이브 비우기: 별도 폴더 없이 위의 "아카이브 폴더"를 기준으로 동작한다.
    new Setting(containerEl)
      .setName(t.archiveCleanDays)
      .setDesc(t.archiveCleanDaysDesc)
      .addText((text) =>
        text
          .setPlaceholder("90")
          .setValue(String(this.plugin.settings.archiveCleanDays))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.archiveCleanDays = num;
              await this.plugin.saveSettings();
            }
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText(t.archiveCleanBtn)
          .setWarning()
          .onClick(() => {
            const viewLang = VIEW_I18N[lang] || VIEW_I18N.en;
            new CleanArchiveModal(this.app, this.plugin, viewLang).open();
          })
      );

    // 웹 클리퍼 설정
    new Setting(containerEl).setName(t.webClip).setHeading();

    new Setting(containerEl)
      .setName(t.webClipFolder)
      .setDesc(t.webClipFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder("WebClips")
          .setValue(this.plugin.settings.webClipFolder)
          .onChange(async (value) => {
            this.plugin.settings.webClipFolder = value.trim() || "WebClips";
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setIcon("folder").setTooltip("Browse").onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.webClipFolder = folder;
            await this.plugin.saveSettings();
            this.display();
          }, t.folderSelectPlaceholder).open();
        })
      );

    // Obsidian 스킬 설정
    // 내장(builtin) 스킬은 항상 활성화되며 목록에 노출하지 않는다.
    // 번들 토글 스킬(예: 한국어 윤문)과 사용자 커스텀 스킬을 토글로 표시한다.
    new Setting(containerEl).setName(t.skills).setHeading();

    // 1) 번들 토글 스킬 (builtin이 아닌 내장 제공 스킬)
    const bundledToggleable = SKILLS.filter((s) => !s.builtin);
    for (const skill of bundledToggleable) {
      new Setting(containerEl)
        // ko 이외의 언어는 영어 설명을 쓴다. `=== "en"`으로 갈랐을 때는 ja 사용자에게
        // 한국어 설명이 보였다 — 폴백은 en이어야 한다.
        .setName(this.plugin.settings.language === "ko" ? skill.name : skill.nameEn ?? skill.name)
        .setDesc(this.plugin.settings.language === "ko" ? skill.description : skill.descriptionEn)
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.enabledSkills.includes(skill.id))
            .onChange(async (value) => {
              const skills = this.plugin.settings.enabledSkills;
              if (value && !skills.includes(skill.id)) {
                skills.push(skill.id);
              } else if (!value) {
                const idx = skills.indexOf(skill.id);
                if (idx >= 0) skills.splice(idx, 1);
              }
              await this.plugin.saveSettings();
            })
        );
    }

    // 2) 사용자 커스텀 스킬 (A안: 설정에 저장, 토글 + 편집 + 삭제)
    for (const skill of this.plugin.settings.customSkills) {
      new Setting(containerEl)
        .setName(skill.name || skill.id)
        .setDesc(skill.description || "")
        .addToggle((toggle) =>
          toggle.setValue(skill.enabled).onChange(async (value) => {
            skill.enabled = value;
            await this.plugin.saveSettings();
          })
        )
        .addExtraButton((btn) =>
          btn
            .setIcon("pencil")
            .setTooltip(t.skillEdit)
            .onClick(() => {
              new SkillEditModal(this.app, this.plugin, t, skill, () => this.display()).open();
            })
        )
        .addExtraButton((btn) =>
          btn
            .setIcon("trash")
            .setTooltip(t.skillDelete)
            .onClick(async () => {
              const idx = this.plugin.settings.customSkills.indexOf(skill);
              if (idx >= 0) this.plugin.settings.customSkills.splice(idx, 1);
              await this.plugin.saveSettings();
              this.display();
            })
        );
    }

    // 3) 스킬 추가 버튼
    new Setting(containerEl)
      .setName(t.skillAdd)
      .setDesc(t.skillAddDesc)
      .addButton((btn) =>
        btn.setButtonText(t.skillAdd).setCta().onClick(() => {
          new SkillEditModal(this.app, this.plugin, t, null, () => this.display()).open();
        })
      );

    // MCP 서버 설정
    new Setting(containerEl).setName(t.mcpServers).setHeading();

    new Setting(containerEl)
      .setName(t.mcpManage)
      .setDesc(t.mcpManageDesc)
      .addButton((btn) =>
        btn.setButtonText(t.mcpEdit).onClick(() => {
          new McpConfigModal(this.app, this.plugin, () => this.display()).open();
        })
      )
      .addButton((btn) =>
        btn.setButtonText(t.mcpStopAll).onClick(() => {
          this.plugin.mcpManager.disconnectAll();
          new Notice(t.mcpStopped);
          this.display();
        })
      );

    // MCP 서버 상태 리스트 (관리 버튼 아래, 들여쓰기)
    const mcpStatus = this.plugin.mcpManager.getStatus();
    if (mcpStatus.length > 0) {
      const statusEl = containerEl.createDiv({ cls: "ba-mcp-status-list" });
      for (const s of mcpStatus) {
        const icon = s.connected ? "🟢" : "🔴";
        statusEl.createDiv({
          text: `${icon} ${s.name} — ${s.toolCount} tools`,
        });
      }
    } else {
      containerEl.createEl("p", {
        text: t.mcpNoServers,
        cls: "setting-item-description ba-mcp-status-list",
      });
    }

    // MCP 도구 타임아웃 (MCP 서버 관리 아래에 배치, 숫자 입력 1~60초)
    new Setting(containerEl)
      .setName(t.mcpTimeout)
      .setDesc(t.mcpTimeoutDesc)
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "60";
        text.setValue(String(this.plugin.settings.mcpTimeout));
        text.onChange(async (value) => {
          const parsed = parseInt(value, 10);
          if (!Number.isFinite(parsed)) return; // 빈/잘못된 입력은 무시
          const clamped = Math.max(1, Math.min(60, parsed));
          this.plugin.settings.mcpTimeout = clamped;
          await this.plugin.saveSettings();
          // 실행 중인 MCP 서버에 즉시 반영
          this.plugin.mcpManager.setTimeout(clamped);
          // 범위를 벗어난 입력은 보정된 값으로 표시 갱신
          if (clamped !== parsed) text.setValue(String(clamped));
        });
      });

    // 추천 플러그인 설치 안내 (설정 화면 맨 아래로 이동)
    new Setting(containerEl).setName(t.recommendedPlugins).setHeading();

    // 이미 설치한 사용자에게 설치 버튼을 계속 보여주지 않도록 활성 여부를 확인한다.
    this.addRecommendedPlugin(
      containerEl,
      "code-styler",
      t.codeStylerInstall,
      t.codeStylerInfo,
      t.pluginInstalled
    );
    this.addRecommendedPlugin(
      containerEl,
      "obsidian-tasks-plugin",
      t.todoTasksInstall,
      t.todoTasksInfo,
      t.pluginInstalled
    );

    // 후원 배너 — 설정 맨 아래. 상단은 무엇을 설정해야 하는지 알려주는 자리다.
    const sponsorRow = containerEl.createDiv({ cls: "ba-about-sponsor" });
    sponsorRow.createSpan({ text: t.sponsorLabel });
    const sponsorLink = sponsorRow.createEl("a", {
      href: "https://buymeacoffee.com/teinam",
    });
    sponsorLink.setAttr("target", "_blank");
    sponsorLink.createEl("img", {
      attr: {
        src: "https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png",
        alt: "Buy Me A Coffee",
        height: "36",
      },
      cls: "ba-sponsor-img",
    });
  }

  /**
   * 추천 플러그인 항목을 추가한다.
   * 이미 활성화된 플러그인은 설치 버튼 대신 "설치됨" 배지를 보여준다.
   */
  private addRecommendedPlugin(
    containerEl: HTMLElement,
    pluginId: string,
    installLabel: string,
    description: string,
    installedLabel: string
  ): void {
    const setting = new Setting(containerEl).setName(installLabel).setDesc(description);

    if (isPluginEnabled(this.app, pluginId)) {
      // 설치·활성 상태 — 버튼 대신 정적 배지를 표시한다.
      const badge = setting.controlEl.createSpan({ cls: "ba-plugin-installed" });
      // 체크 아이콘은 장식이므로 스크린리더에서 제외하고, 상태는 텍스트로 전달한다.
      const iconEl = badge.createSpan({ attr: { "aria-hidden": "true" } });
      setIcon(iconEl, "check");
      badge.createSpan({ text: installedLabel });
      return;
    }

    setting.addButton((btn) =>
      btn.setButtonText(installLabel).onClick(() => {
        window.open(`obsidian://show-plugin?id=${pluginId}`);
      })
    );
  }

  // base URL 입력 설정 추가 (OpenAI/Ollama 공용)
  // onChange에서 isValidBaseUrl로 형식을 검증하여, 유효하지 않으면 Notice 오류를 띄우고
  // 값을 Settings_Store에 영속하지 않는다(이전 유효값 유지 — Req 2.10).
  private addBaseUrlSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    placeholder: string,
    getCurrent: () => string,
    setValue: (v: string) => void,
    invalidMsg: string,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text
          .setPlaceholder(placeholder)
          .setValue(getCurrent())
          .onChange(async (value) => {
            const trimmed = value.trim();
            // 형식 검증 실패 시: 영속하지 않고 이전 유효값 유지 (Req 2.10)
            if (!isValidBaseUrl(trimmed)) {
              new Notice(invalidMsg);
              return;
            }
            setValue(trimmed);
            await this.plugin.saveSettings();
            // base URL 변경 시 모델 목록 재로드 예약
            this.scheduleModelReload();
          })
      );
  }

  /**
   * 설정 탭이 닫힐 때 호출된다(Obsidian 라이프사이클).
   * 탭 오픈 시점 대비 임베딩 구성(백엔드 또는 임베딩 모델)이 바뀌었고 기존 인덱스가
   * 비어있지 않으면(=무력화될 벡터가 존재하면) 재인덱싱 안내 Notice를 1회 띄운다.
   * 드롭다운/텍스트 입력/백엔드 전환을 단일 지점에서 처리하여 타이핑 중 중복 알림을 방지한다.
   */
  hide(): void {
    const snapshot = this.embeddingSignatureSnapshot;
    // 다음 오픈을 위해 스냅샷을 초기화한다.
    this.embeddingSignatureSnapshot = null;
    if (snapshot === null) return;

    const nextSignature = embeddingSignature(this.plugin.settings);
    if (snapshot === nextSignature) return;
    if ((this.plugin.indexer?.size ?? 0) === 0) return;

    const lang = this.plugin.settings.language;
    const localized = (I18N[lang] as Record<string, unknown>)?.reindexNeeded;
    const msg =
      typeof localized === "string" ? localized : I18N.en.reindexNeeded;
    new Notice(msg, 10000);
  }

  // 공급자 모델 드롭다운 추가 (채팅/임베딩 공용)
  // 기존 채팅 드롭다운 패턴 재사용: 현재값을 기본 옵션으로 추가 → listModels(kind) 결과로 채움
  // → 실패/빈 목록 시 현재값 유지(Req 7.9, 12.4), 정상 목록이나 현재 ID 미존재 시에도 현재값 유지(Req 7.9.1)
  private addProviderModelDropdown(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    getCurrent: () => string,
    setValue: (v: string) => void,
    kind: "chat" | "embedding",
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addDropdown((dropdown) => {
        // 현재 설정값을 기본 옵션으로 추가
        const current = getCurrent();
        if (current) {
          dropdown.addOption(current, current);
        }
        dropdown.setValue(current);
        dropdown.onChange(async (value) => {
          setValue(value);
          if (kind === "chat") {
            // 채팅 모델이 바뀌면 effort 허용 집합이 달라지므로 저장값을 보정한다.
            this.plugin.settings.effort = clampEffort(
              this.plugin.settings.aiBackend,
              value,
              this.plugin.settings.effort
            );
          }
          await this.plugin.saveSettings();
          // effort 항목 노출/옵션이 모델에 따라 바뀌므로 탭을 다시 그린다.
          if (kind === "chat") this.display();
        });
        // 비동기로 모델 목록 로드 후 드롭다운 갱신
        (async () => {
          try {
            const models = await this.plugin.aiClient.listModels(kind);
            // 빈 목록이면 현재값 유지 (Req 7.9, 12.4)
            if (!models || models.length === 0) {
              return;
            }
            dropdown.selectEl.empty();
            const cur = getCurrent();
            let hasCurrent = false;
            for (const m of models) {
              dropdown.addOption(m.modelId, m.modelName || m.modelId);
              if (m.modelId === cur) hasCurrent = true;
            }
            // 정상 목록이지만 현재 설정 ID가 목록에 없으면 현재값을 옵션으로 유지 (Req 7.9.1)
            if (cur && !hasCurrent) {
              dropdown.addOption(cur, cur);
            }
            dropdown.setValue(cur);
          } catch {
            // 모델 로드 실패 시 현재값 유지 (Req 7.9, 12.4)
          }
        })();
      });
  }

  // 비밀 입력 필드 옆에 눈 아이콘 토글 버튼 추가
  private addToggleVisibilityButton(controlEl: HTMLElement): void {
    const wrapper = controlEl.querySelector(".setting-item-control") || controlEl;
    const input = wrapper.querySelector("input") as HTMLInputElement | null;
    if (!input) return;

    // 입력 필드를 감싸는 래퍼 생성
    const inputWrapper = createDiv({ cls: "ba-secret-wrapper" });
    input.parentElement?.insertBefore(inputWrapper, input);
    inputWrapper.appendChild(input);

    const eyeBtn = inputWrapper.createDiv({ cls: "ba-eye-btn", attr: { "aria-label": "Toggle visibility" } });
    // 초기 아이콘: 숨김 상태 (eye-off)
    setIcon(eyeBtn, "eye-off");

    eyeBtn.addEventListener("click", () => {
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      eyeBtn.empty();
      setIcon(eyeBtn, isPassword ? "eye" : "eye-off");
    });
  }
}


// 시스템 프롬프트 편집 모달
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class SystemPromptModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  private t: Record<string, any>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(app: App, plugin: GeminiAssistantPlugin, t: Record<string, any>) {
    super(app);
    this.plugin = plugin;
    this.t = t;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("ba-sysprompt-modal");

    this.setTitle(this.t.systemPrompt);

    const textarea = contentEl.createEl("textarea", {
      cls: "ba-sysprompt-textarea",
      attr: { placeholder: this.t.systemPromptPlaceholder },
    });
    textarea.value = this.plugin.settings.systemPrompt;
    textarea.rows = 16;

    const btnRow = contentEl.createDiv({ cls: "ba-sysprompt-btn-row" });

    const cancelBtn = btnRow.createEl("button", { text: this.t.systemPromptCancel });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = btnRow.createEl("button", {
      text: this.t.systemPromptSave,
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", async () => {
      this.plugin.settings.systemPrompt = textarea.value;
      await this.plugin.saveSettings();
      this.close();
    });

    setTimeout(() => textarea.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// 커스텀 스킬 추가/편집 모달 (A안)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class SkillEditModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private t: Record<string, any>;
  private existing: CustomSkill | null;
  private onSaved: () => void;

  constructor(
    app: App,
    plugin: GeminiAssistantPlugin,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t: Record<string, any>,
    existing: CustomSkill | null,
    onSaved: () => void
  ) {
    super(app);
    this.plugin = plugin;
    this.t = t;
    this.existing = existing;
    this.onSaved = onSaved;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("ba-sysprompt-modal");

    this.setTitle(this.existing ? this.t.skillModalEdit : this.t.skillModalNew);

    // 이름 입력
    contentEl.createEl("label", { text: this.t.skillNameLabel, cls: "ba-about-desc" });
    const nameInput = contentEl.createEl("input", {
      cls: "ba-skill-input",
      attr: { type: "text", placeholder: this.t.skillNamePlaceholder },
    });
    nameInput.value = this.existing?.name ?? "";

    // 설명 입력 (어떤 일을 하는지) — 세로로 조금 넉넉하게
    contentEl.createEl("label", { text: this.t.skillDescLabel, cls: "ba-about-desc" });
    const descInput = contentEl.createEl("textarea", {
      cls: "ba-skill-input",
      attr: { placeholder: this.t.skillDescPlaceholder },
    });
    descInput.rows = 4;
    descInput.value = this.existing?.description ?? "";

    // "AI로 생성하기" 버튼 — 입력창과 내용 영역 사이에 위아래 여백을 두어 분리
    const genRow = contentEl.createDiv({ cls: "ba-skill-gen-row" });
    const genBtn = genRow.createEl("button", { text: this.t.skillGenerate });

    // 내용(마크다운) 라벨 — 좌측 끝에 두되 살짝 안쪽으로 들여쓰기
    contentEl.createEl("label", {
      text: this.t.skillContentLabel,
      cls: "ba-about-desc ba-skill-content-label",
    });

    const textarea = contentEl.createEl("textarea", {
      cls: "ba-sysprompt-textarea",
      attr: { placeholder: this.t.skillContentPlaceholder },
    });
    textarea.value = this.existing?.content ?? "";
    textarea.rows = 14;

    // 생성하기: 이름 + 설명(어떤 일을 하는지)을 LLM에 전달해 스킬 본문(마크다운)을 작성
    genBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const purpose = descInput.value.trim();
      if (!name || !purpose) {
        new Notice(this.t.skillGenerateNeedInput);
        return;
      }
      genBtn.disabled = true;
      const label = genBtn.textContent;
      genBtn.textContent = this.t.skillGenerating;
      try {
        const sys =
          "You are an expert prompt engineer. Write a concise, well-structured 'skill' instruction document in Markdown that will be injected into an AI assistant's system prompt to guide its behavior for a specific task. " +
          "Output ONLY the Markdown content with no preamble and no surrounding code fences. " +
          "Write in the same language as the user's input. " +
          "Include: an H1 title, a short 'purpose / when to apply' section, concrete actionable rules or steps, and 1-2 brief examples if helpful. Keep it focused and not overly long.";
        const user = `Skill name: ${name}\nWhat this skill should do:\n${purpose}`;
        const result = await this.plugin.aiClient.converseLight(user, sys, 2000);
        textarea.value = (result.text || "").trim();
      } catch (e) {
        new Notice(
          `${this.t.skillGenerateFailed} ${e instanceof Error ? e.message : String(e)}`
        );
      } finally {
        genBtn.disabled = false;
        if (label) genBtn.textContent = label;
      }
    });

    const btnRow = contentEl.createDiv({ cls: "ba-sysprompt-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: this.t.skillCancel });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = btnRow.createEl("button", { text: this.t.skillSave, cls: "mod-cta" });
    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const content = textarea.value.trim();
      if (!name || !content) {
        new Notice(this.t.skillNameRequired);
        return;
      }
      if (this.existing) {
        // 편집: 기존 항목 갱신 (id/enabled 유지)
        this.existing.name = name;
        this.existing.description = descInput.value.trim();
        this.existing.content = content;
      } else {
        // 신규 추가: 고유 id 생성 후 enabled=true로 추가
        const id = this.makeUniqueId(name);
        this.plugin.settings.customSkills.push({
          id,
          name,
          description: descInput.value.trim(),
          content,
          enabled: true,
        });
      }
      await this.plugin.saveSettings();
      this.close();
      this.onSaved();
    });

    setTimeout(() => nameInput.focus(), 50);
  }

  // 이름에서 slug형 고유 id를 생성한다(중복 시 -2, -3 ... 접미사).
  private makeUniqueId(name: string): string {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "skill";
    const existingIds = new Set([
      ...SKILLS.map((s) => s.id),
      ...this.plugin.settings.customSkills.map((s) => s.id),
    ]);
    let id = base;
    let n = 2;
    while (existingIds.has(id)) {
      id = `${base}-${n++}`;
    }
    return id;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// MCP 설정 편집 모달
class McpConfigModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  private onSaved: () => void;
  private textArea!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;
  // 오류 표시 영역 참조
  private errorIndicatorEl!: HTMLElement;
  // 디바운스 타이머 (입력 시 300ms 지연 후 검증 실행)
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // 템플릿 삽입 버튼 참조 (input 핸들러에서 가시성 토글에 사용)
  private templateBtn!: HTMLButtonElement;

  constructor(app: App, plugin: GeminiAssistantPlugin, onSaved: () => void) {
    super(app);
    this.plugin = plugin;
    this.onSaved = onSaved;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ba-mcp-modal");
    const t = I18N[this.plugin.settings.language] || I18N.en;

    this.setTitle(t.mcpModalTitle);

    // 설명
    contentEl.createEl("p", {
      text: t.mcpModalDesc,
      cls: "ba-mcp-desc",
    });

    // 텍스트 에디터
    this.textArea = contentEl.createEl("textarea", { cls: "ba-mcp-editor" });
    this.textArea.rows = 16;
    this.textArea.spellcheck = false;
    this.textArea.placeholder = JSON.stringify(
      {
        mcpServers: {
          "example-server": {
            command: "npx",
            args: ["-y", "@example/mcp-server"],
            disabled: false,
          },
        },
      },
      null,
      2
    );

    // 현재 설정 로드
    const config = await this.plugin.readMcpConfig();
    this.textArea.value = config;

    // Tab 키로 들여쓰기 지원
    this.textArea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = this.textArea.selectionStart;
        const end = this.textArea.selectionEnd;
        this.textArea.value =
          this.textArea.value.substring(0, start) + "  " + this.textArea.value.substring(end);
        this.textArea.selectionStart = this.textArea.selectionEnd = start + 2;
      }
    });

    // 입력 시 300ms 디바운스로 JSON 검증 + 괄호 매칭 수행
    this.textArea.addEventListener("input", () => {
      // 기존 타이머가 있으면 취소
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      // 300ms 후 검증 실행
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        const text = this.textArea.value;
        // 빈 텍스트일 때 검증 건너뛰기: 오류 표시 숨김, 템플릿 버튼 표시
        if (text.trim() === "") {
          this.errorIndicatorEl.textContent = "";
          this.errorIndicatorEl.hide();
          this.textArea.classList.remove("has-error");
          this.templateBtn.show();
          return;
        }
        // 텍스트가 비어있지 않으면 템플릿 버튼 숨김
        this.templateBtn.hide();
        // JSON 검증 및 괄호 매칭 수행
        const jsonResult = validateJson(text);
        const bracketResult = matchBrackets(text);
        // 검증 결과에 따라 Error Indicator 업데이트
        this.updateErrorIndicator(jsonResult, bracketResult);
      }, 300);
    });

    // 오류 표시 영역 (textarea 하단, 초기에는 숨김)
    this.errorIndicatorEl = contentEl.createDiv({ cls: "ba-mcp-error-indicator" });
    this.errorIndicatorEl.hide();

    // 연결 상태 표시 영역
    this.statusEl = contentEl.createDiv({ cls: "ba-mcp-status" });
    this.renderStatus();

    // 버튼 행
    const btnRow = contentEl.createDiv({ cls: "ba-mcp-btn-row" });

    // 템플릿 삽입 버튼: 설정 텍스트가 비어있을 때만 표시
    this.templateBtn = btnRow.createEl("button", {
      text: t.mcpTemplateBtn,
      cls: "ba-mcp-template-btn",
    });
    // 설정 텍스트가 비어있을 때만 표시
    this.templateBtn.toggle(this.textArea.value.trim() === "");
    this.templateBtn.addEventListener("click", () => {
      this.textArea.value = getDefaultTemplate();
      // 삽입 후 즉시 검증 수행
      const jsonResult = validateJson(this.textArea.value);
      const bracketResult = matchBrackets(this.textArea.value);
      this.updateErrorIndicator(jsonResult, bracketResult);
      // 템플릿 삽입 후 버튼 숨김
      this.templateBtn.hide();
    });

    // 포맷 버튼: 클릭 시 JSON을 2칸 들여쓰기로 정렬
    const formatBtn = btnRow.createEl("button", {
      text: t.mcpFormatBtn,
      cls: "ba-mcp-format-btn",
    });
    formatBtn.addEventListener("click", () => {
      const text = this.textArea.value;
      const formatted = formatJson(text);
      // formatJson은 유효하지 않은 JSON이면 원본을 그대로 반환하므로
      // 변경이 있을 때만 textarea 업데이트
      if (formatted !== text) {
        this.textArea.value = formatted;
        // 포맷팅 후 검증 수행
        const jsonResult = validateJson(formatted);
        const bracketResult = matchBrackets(formatted);
        this.updateErrorIndicator(jsonResult, bracketResult);
      }
    });

    const saveBtn = btnRow.createEl("button", {
      text: t.mcpModalSave,
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => this.handleSave());

    const cancelBtn = btnRow.createEl("button", { text: t.mcpModalCancel });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private async handleSave(): Promise<void> {
    const configText = this.textArea.value.trim();
    const t = I18N[this.plugin.settings.language] || I18N.en;

    try {
      parseMcpConfig(configText, this.plugin.settings.language);
    } catch (error) {
      new Notice(
        error instanceof SyntaxError
          ? t.mcpModalJsonError
          : t.mcpModalConfigError((error as Error).message)
      );
      return;
    }

    // 저장 전 자동 포맷팅 적용 (2칸 들여쓰기)
    const formattedText = formatJson(configText);
    this.textArea.value = formattedText;

    let result: Awaited<ReturnType<GeminiAssistantPlugin["loadMcpConfig"]>>;
    try {
      await this.plugin.saveMcpConfig(formattedText);
      new Notice(t.mcpModalSaving);
      result = await this.plugin.loadMcpConfig();
    } catch (error) {
      new Notice(t.mcpModalConfigError((error as Error).message));
      return;
    }
    if (result.connected.length > 0) {
      new Notice(t.mcpModalConnected(result.connected.join(", ")));
    }
    if (result.failed.length > 0) {
      new Notice(t.mcpModalFailed(result.failed.join(", ")));
    }
    if (result.connected.length === 0 && result.failed.length === 0) {
      new Notice(t.mcpModalNoServers);
    }

    // 연결 상태 갱신 (모달 닫지 않음)
    this.renderStatus();
    this.onSaved();

    // 채팅 뷰의 MCP 인디케이터도 갱신
    const leaves = this.app.workspace.getLeavesOfType(BRANDING.viewType);
    for (const leaf of leaves) {
      (leaf.view as any).updateMcpIndicator?.();
    }
  }

  /**
   * 검증 결과에 따라 오류 표시 영역과 textarea 스타일을 업데이트한다.
   * 오류 시: 메시지 + 줄/열 번호 표시, textarea에 .has-error 클래스 추가
   * 정상 시: 오류 영역 숨김, .has-error 클래스 제거
   */
  private updateErrorIndicator(jsonResult: JsonValidationResult, bracketResult: BracketMatchResult): void {
    const t = I18N[this.plugin.settings.language] || I18N.en;

    // 괄호 오류가 있으면 괄호 오류 메시지 우선 표시
    if (!bracketResult.balanced && bracketResult.errors.length > 0) {
      const firstErr = bracketResult.errors[0];
      this.errorIndicatorEl.textContent = t.mcpBracketError(firstErr.char, firstErr.line, firstErr.column);
      this.errorIndicatorEl.show();
      this.textArea.classList.add("has-error");
      return;
    }

    // JSON 검증 오류가 있으면 JSON 오류 메시지 표시
    if (!jsonResult.valid && jsonResult.error) {
      const { line, column, message } = jsonResult.error;
      this.errorIndicatorEl.textContent = t.mcpJsonErrorAt(line, column, message);
      this.errorIndicatorEl.show();
      this.textArea.classList.add("has-error");
      return;
    }

    // 정상: 오류 영역 숨기고 오류 스타일 제거
    this.errorIndicatorEl.textContent = "";
    this.errorIndicatorEl.hide();
    this.textArea.classList.remove("has-error");
  }

  // 연결 상태 렌더링
  private renderStatus(): void {
    this.statusEl.empty();
    const t = I18N[this.plugin.settings.language] || I18N.en;
    const mcpStatus = this.plugin.mcpManager.getStatus();

    if (mcpStatus.length === 0) {
      this.statusEl.createDiv({ text: t.mcpStatusNone, cls: "ba-mcp-status-item" });
      return;
    }

    this.statusEl.createDiv({ text: t.mcpStatusTitle, cls: "ba-mcp-status-title" });
    for (const s of mcpStatus) {
      const item = this.statusEl.createDiv({ cls: "ba-mcp-status-item" });
      if (s.connected) {
        item.setText(`🟢 ${t.mcpModalTools(s.name, s.toolCount)}`);
      } else {
        item.setText(`🔴 ${t.mcpStatusDisconnected(s.name)}`);
      }
    }
  }

  onClose(): void {
    // 디바운스 타이머 정리
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.contentEl.empty();
  }
}


// 볼트 폴더 검색/선택 모달
class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private onChoose: (path: string) => void;

  constructor(app: App, onChoose: (path: string) => void, placeholder?: string) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder(placeholder || "Select a folder...");
  }

  getItems(): TFolder[] {
    const folders: TFolder[] = [];
    const recurse = (folder: TFolder) => {
      folders.push(folder);
      for (const child of folder.children) {
        if (child instanceof TFolder) recurse(child);
      }
    };
    recurse(this.app.vault.getRoot());
    return folders;
  }

  getItemText(item: TFolder): string {
    return item.path || "/";
  }

  onChooseItem(item: TFolder): void {
    this.onChoose(item.path);
  }
}
