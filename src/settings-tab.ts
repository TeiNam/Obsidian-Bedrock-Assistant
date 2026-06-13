import { App, FuzzySuggestModal, Modal, Notice, PluginSettingTab, Setting, TFolder, setIcon } from "obsidian";
import type GeminiAssistantPlugin from "./main";
import type { CustomSkill } from "./types";
import { SKILLS } from "./skills";
import { BRANDING } from "./branding";
import { CleanArchiveModal } from "./modals/clean-archive-modal";
import { ParaModal } from "./modals/para-modal";
import { VIEW_I18N } from "./chat-view-i18n";
import { validateJson, matchBrackets, formatJson, getDefaultTemplate } from "./json-editor-utils";
import type { JsonValidationResult, BracketMatchResult } from "./json-editor-utils";
import { normalizePlannerSetting } from "./planner-settings";
// clampMaxTokens: maxTokens 입력 범위 보정 / embeddingSignature: 임베딩 구성 변경 감지
import {
  clampMaxTokens,
  embeddingSignature,
} from "./provider-utils";
// Graph RAG 설정 보정 함수 (Req 9.4~9.7): 저장 전 값 보정에 사용
import { normalizeChunkConfig } from "./graph-rag/chunker";
import { normalizeTraversalDepth } from "./graph-rag/graph-traversal";

// To-Do 폴더 기본값 (빈/공백 입력 정규화에 사용)
const TODO_FOLDER_DEFAULT = "ToDo";

// 설정 탭 다국어 레이블
// (테스트에서 i18n 키 완전성 검증을 위해 export — 런타임 동작 변화 없음, 추가적 export일 뿐)
export const I18N = {
  en: {
    title: BRANDING.settingsTitle.en,
    pluginDesc: "An AI assistant sidebar powered by AWS Bedrock to run your whole Obsidian vault — chat with AI, search your vault with embeddings, auto-generate tags, manage to-dos, and use MCP tools, all from within Obsidian.",
    readmeLabel: "📖 Documentation",
    readmeFile: "README.md",
    sponsorLabel: "If you find this plugin useful, consider supporting its development.",
    language: "Language",
    languageDesc: "UI language for settings",
    reindexNeeded:
      "Embedding model changed. The existing vault index uses a different embedding space, so search may return no results. Please re-index the vault.",
    // Bedrock 자격증명
    awsAccessKeyLabel: "AWS Access Key ID",
    awsAccessKeyDesc: "AWS Access Key ID for Bedrock",
    awsAccessKeyPlaceholder: "Enter AWS Access Key ID",
    awsSecretKeyLabel: "AWS Secret Access Key",
    awsSecretKeyDesc: "AWS Secret Access Key for Bedrock",
    awsSecretKeyPlaceholder: "Enter AWS Secret Access Key",
    awsRegionLabel: "AWS Region",
    awsRegionDesc: "AWS Region for Bedrock API",
    awsRegionPlaceholder: "us-east-1",
    // Bedrock 모델 설정
    bedrockChatModelLabel: "Bedrock Chat Model",
    bedrockChatModelDesc: "Bedrock chat model ID",
    bedrockEmbeddingModelLabel: "Bedrock Embedding Model",
    bedrockEmbeddingModelDesc: "Bedrock embedding model ID (used for vault document indexing)",
    // base URL 형식 오류 (Req 2.10)
    baseUrlInvalid: "Invalid base URL. It must start with http:// or https://",
    modelSettings: "Model Settings",
    genSettings: "Generation Settings",
    maxTokens: "Max Tokens",
    maxTokensDesc: "Maximum response tokens",
    temperature: "Temperature",
    temperatureDesc: "Response creativity (0.0 ~ 1.0)",
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
    // JSON 에디터 관련 I18N 키
    mcpFormatBtn: "Format",
    mcpTemplateBtn: "Insert Template",
    mcpBracketError: (char: string, line: number, col: number) => `Unmatched '${char}' at line ${line}, column ${col}`,
    mcpJsonErrorAt: (line: number, col: number, msg: string) => `JSON error at line ${line}, column ${col}: ${msg}`,
  },
  ko: {
    title: BRANDING.settingsTitle.ko,
    pluginDesc: "AWS Bedrock 기반으로 옵시디언 볼트 전반을 AI로 다루는 어시스턴트 사이드바입니다. AI와 대화하고, 임베딩으로 볼트를 검색하고, 태그 자동 생성, To-Do 관리, MCP 도구 연동까지 — 모두 옵시디언 안에서 할 수 있습니다.",
    readmeLabel: "📖 사용 가이드",
    readmeFile: "README-KR.md",
    sponsorLabel: "이 플러그인이 유용하다면 개발을 후원해 주세요.",
    language: "언어",
    languageDesc: "설정 UI 언어",
    reindexNeeded:
      "임베딩 모델이 변경되었습니다. 기존 볼트 인덱스는 다른 임베딩 공간을 사용하므로 검색 결과가 비어 나올 수 있습니다. 볼트를 다시 인덱싱해 주세요.",
    // Bedrock 자격증명
    awsAccessKeyLabel: "AWS Access Key ID",
    awsAccessKeyDesc: "Bedrock용 AWS Access Key ID",
    awsAccessKeyPlaceholder: "AWS Access Key ID 입력",
    awsSecretKeyLabel: "AWS Secret Access Key",
    awsSecretKeyDesc: "Bedrock용 AWS Secret Access Key",
    awsSecretKeyPlaceholder: "AWS Secret Access Key 입력",
    awsRegionLabel: "AWS 리전",
    awsRegionDesc: "Bedrock API용 AWS 리전",
    awsRegionPlaceholder: "us-east-1",
    // Bedrock 모델 설정
    bedrockChatModelLabel: "Bedrock 채팅 모델",
    bedrockChatModelDesc: "Bedrock 채팅 모델 ID",
    bedrockEmbeddingModelLabel: "Bedrock 임베딩 모델",
    bedrockEmbeddingModelDesc: "Bedrock 임베딩 모델 ID (볼트 문서 인덱싱에 사용)",
    // base URL 형식 오류 (Req 2.10)
    baseUrlInvalid: "잘못된 base URL입니다. http:// 또는 https://로 시작해야 합니다",
    modelSettings: "모델 설정",
    genSettings: "생성 설정",
    maxTokens: "최대 토큰",
    maxTokensDesc: "응답 최대 토큰 수",
    temperature: "Temperature",
    temperatureDesc: "응답 창의성 (0.0 ~ 1.0)",
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
    // JSON 에디터 관련 I18N 키
    mcpFormatBtn: "포맷",
    mcpTemplateBtn: "템플릿 삽입",
    mcpBracketError: (char: string, line: number, col: number) => `줄 ${line}, 열 ${col}에서 짝이 맞지 않는 '${char}'`,
    mcpJsonErrorAt: (line: number, col: number, msg: string) => `줄 ${line}, 열 ${col}에서 JSON 오류: ${msg}`,
  },
  ja: {
    title: BRANDING.settingsTitle.ja,
    pluginDesc: "AWS Bedrockを基盤に、Obsidianボルト全体をAIで扱えるアシスタントサイドバーです。AIと対話し、埋め込みによるボルト検索、タグ自動生成、To-Do管理、MCPツール連携まで — すべてObsidian内で行えます。",
    readmeLabel: "📖 ドキュメント",
    readmeFile: "README-JA.md",
    sponsorLabel: "このプラグインが役に立ったら、開発を支援してください。",
    language: "言語",
    languageDesc: "設定UIの言語",
    reindexNeeded:
      "埋め込みモデルが変更されました。既存のボルトインデックスは異なる埋め込み空間を使用しているため、検索結果が空になる場合があります。ボルトを再インデックスしてください。",
    // Bedrock 資格情報
    awsAccessKeyLabel: "AWS Access Key ID",
    awsAccessKeyDesc: "Bedrock用 AWS Access Key ID",
    awsAccessKeyPlaceholder: "AWS Access Key IDを入力",
    awsSecretKeyLabel: "AWS Secret Access Key",
    awsSecretKeyDesc: "Bedrock用 AWS Secret Access Key",
    awsSecretKeyPlaceholder: "AWS Secret Access Keyを入力",
    awsRegionLabel: "AWSリージョン",
    awsRegionDesc: "Bedrock API用 AWSリージョン",
    awsRegionPlaceholder: "us-east-1",
    // Bedrock モデル設定
    bedrockChatModelLabel: "Bedrockチャットモデル",
    bedrockChatModelDesc: "BedrockチャットモデルID",
    bedrockEmbeddingModelLabel: "Bedrock埋め込みモデル",
    bedrockEmbeddingModelDesc: "Bedrock埋め込みモデルID（ボルトドキュメントのインデックスに使用）",
    // base URL 形式エラー (Req 2.10)
    baseUrlInvalid: "無効なbase URLです。http:// または https:// で始まる必要があります",
    modelSettings: "モデル設定",
    genSettings: "生成設定",
    maxTokens: "最大トークン数",
    maxTokensDesc: "応答の最大トークン数",
    temperature: "Temperature",
    temperatureDesc: "応答の創造性 (0.0 ~ 1.0)",
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
    // JSON エディター関連 I18N キー
    mcpFormatBtn: "フォーマット",
    mcpTemplateBtn: "テンプレート挿入",
    mcpBracketError: (char: string, line: number, col: number) => `行${line}, 列${col}で対応しない '${char}'`,
    mcpJsonErrorAt: (line: number, col: number, msg: string) => `行${line}, 列${col}のJSONエラー: ${msg}`,
  },
} as const;

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

    // 설정 페이지 타이틀을 현재 브랜딩에서 동적으로 가져옴 (심사 기준: setHeading 사용)
    new Setting(containerEl).setName(BRANDING.settingsTitle[lang] || BRANDING.settingsTitle.en).setHeading();

    // 플러그인 설명 + README 링크 + 후원 배너 (하나의 박스)
    const aboutBox = containerEl.createDiv({ cls: "ba-about-box" });
    aboutBox.createEl("p", { text: t.pluginDesc, cls: "ba-about-desc" });

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
          window.open(`https://github.com/teinam/obsidian-bedrock-assistant/blob/kiro-edition/${t.readmeFile}`);
        });
      } catch {
        window.open(`https://github.com/teinam/obsidian-bedrock-assistant/blob/kiro-edition/${t.readmeFile}`);
      }
    });

    const sponsorRow = aboutBox.createDiv({ cls: "ba-about-sponsor" });
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

    // AWS Bedrock 자격증명 설정
    new Setting(containerEl).setName("AWS Bedrock").setHeading();

    const awsAccessKeySetting = new Setting(containerEl)
      .setName(t.awsAccessKeyLabel)
      .setDesc(t.awsAccessKeyDesc)
      .addText((text) => {
        text
          .setPlaceholder(t.awsAccessKeyPlaceholder)
          .setValue(this.plugin.settings.awsAccessKeyId)
          .onChange(async (value) => {
            this.plugin.settings.awsAccessKeyId = value.trim();
            await this.plugin.saveSettings();
            // 자격증명 변경 시 모델 목록 재로드 예약
            this.scheduleModelReload();
          });
        text.inputEl.type = "password";
        text.inputEl.addClass("ba-secret-input");
      });
    this.addToggleVisibilityButton(awsAccessKeySetting.controlEl);

    const awsSecretKeySetting = new Setting(containerEl)
      .setName(t.awsSecretKeyLabel)
      .setDesc(t.awsSecretKeyDesc)
      .addText((text) => {
        text
          .setPlaceholder(t.awsSecretKeyPlaceholder)
          .setValue(this.plugin.settings.awsSecretAccessKey)
          .onChange(async (value) => {
            this.plugin.settings.awsSecretAccessKey = value.trim();
            await this.plugin.saveSettings();
            // 자격증명 변경 시 모델 목록 재로드 예약
            this.scheduleModelReload();
          });
        text.inputEl.type = "password";
        text.inputEl.addClass("ba-secret-input");
      });
    this.addToggleVisibilityButton(awsSecretKeySetting.controlEl);

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

    // 모델 설정 (Bedrock)
    new Setting(containerEl).setName(t.modelSettings).setHeading();

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
          await this.plugin.saveSettings();
        });
        // 비동기로 모델 목록 로드 후 드롭다운 갱신
        (async () => {
          try {
            const models = await this.plugin.aiClient.listModels();
            dropdown.selectEl.empty();
            for (const m of models) {
              dropdown.addOption(m.modelId, m.modelName || m.modelId);
            }
            dropdown.setValue(this.plugin.settings.bedrockChatModel);
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

    new Setting(containerEl)
      .setName(t.temperature)
      .setDesc(t.temperatureDesc)
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.1)
          .setValue(this.plugin.settings.temperature)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.temperature = value;
            await this.plugin.saveSettings();
          })
      );

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
        .setName(skill.name)
        .setDesc(this.plugin.settings.language === "en" ? skill.descriptionEn : skill.description)
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

    const codeStylerSetting = new Setting(containerEl)
      .setName(t.codeStylerInstall)
      .setDesc(t.codeStylerInfo);
    codeStylerSetting.addButton((btn) =>
      btn.setButtonText(t.codeStylerInstall).onClick(() => {
        window.open("obsidian://show-plugin?id=code-styler");
      })
    );

    const tasksSetting = new Setting(containerEl)
      .setName(t.todoTasksInstall)
      .setDesc(t.todoTasksInfo);
    tasksSetting.addButton((btn) =>
      btn.setButtonText(t.todoTasksInstall).onClick(() => {
        window.open("obsidian://show-plugin?id=obsidian-tasks-plugin");
      })
    );
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

    contentEl.createEl("h2", { text: this.t.systemPrompt });

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

    contentEl.createEl("h2", {
      text: this.existing ? this.t.skillModalEdit : this.t.skillModalNew,
    });

    // 이름 입력
    contentEl.createEl("label", { text: this.t.skillNameLabel, cls: "ba-about-desc" });
    const nameInput = contentEl.createEl("input", {
      attr: { type: "text", placeholder: this.t.skillNamePlaceholder },
    });
    nameInput.style.width = "100%";
    nameInput.value = this.existing?.name ?? "";

    // 설명 입력 (어떤 일을 하는지) — 세로로 조금 넉넉하게
    contentEl.createEl("label", { text: this.t.skillDescLabel, cls: "ba-about-desc" });
    const descInput = contentEl.createEl("textarea", {
      attr: { placeholder: this.t.skillDescPlaceholder },
    });
    descInput.style.width = "100%";
    descInput.rows = 4;
    descInput.value = this.existing?.description ?? "";

    // "AI로 생성하기" 버튼 — 입력창과 내용 영역 사이에 위아래 여백을 두어 분리
    const genRow = contentEl.createDiv();
    genRow.style.display = "flex";
    genRow.style.justifyContent = "center";
    genRow.style.margin = "20px 0";
    const genBtn = genRow.createEl("button", { text: this.t.skillGenerate });

    // 내용(마크다운) 라벨 — 좌측 끝에 두되 살짝 안쪽으로 들여쓰기
    const contentLabel = contentEl.createEl("label", {
      text: this.t.skillContentLabel,
      cls: "ba-about-desc",
    });
    contentLabel.style.display = "block";
    contentLabel.style.paddingLeft = "4px";
    contentLabel.style.marginBottom = "6px";

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

    contentEl.createEl("h2", { text: t.mcpModalTitle });

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
          this.errorIndicatorEl.style.display = "none";
          this.textArea.classList.remove("has-error");
          this.templateBtn.style.display = "";
          return;
        }
        // 텍스트가 비어있지 않으면 템플릿 버튼 숨김
        this.templateBtn.style.display = "none";
        // JSON 검증 및 괄호 매칭 수행
        const jsonResult = validateJson(text);
        const bracketResult = matchBrackets(text);
        // 검증 결과에 따라 Error Indicator 업데이트
        this.updateErrorIndicator(jsonResult, bracketResult);
      }, 300);
    });

    // 오류 표시 영역 (textarea 하단, 초기에는 숨김)
    this.errorIndicatorEl = contentEl.createDiv({ cls: "ba-mcp-error-indicator" });
    this.errorIndicatorEl.style.display = "none";

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
    this.templateBtn.style.display = this.textArea.value.trim() === "" ? "" : "none";
    this.templateBtn.addEventListener("click", () => {
      this.textArea.value = getDefaultTemplate();
      // 삽입 후 즉시 검증 수행
      const jsonResult = validateJson(this.textArea.value);
      const bracketResult = matchBrackets(this.textArea.value);
      this.updateErrorIndicator(jsonResult, bracketResult);
      // 템플릿 삽입 후 버튼 숨김
      this.templateBtn.style.display = "none";
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
      JSON.parse(configText);
    } catch {
      new Notice(t.mcpModalJsonError);
      return;
    }

    // 저장 전 자동 포맷팅 적용 (2칸 들여쓰기)
    const formattedText = formatJson(configText);
    this.textArea.value = formattedText;

    await this.plugin.saveMcpConfig(formattedText);
    new Notice(t.mcpModalSaving);

    const result = await this.plugin.loadMcpConfig();
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
      this.errorIndicatorEl.style.display = "";
      this.textArea.classList.add("has-error");
      return;
    }

    // JSON 검증 오류가 있으면 JSON 오류 메시지 표시
    if (!jsonResult.valid && jsonResult.error) {
      const { line, column, message } = jsonResult.error;
      this.errorIndicatorEl.textContent = t.mcpJsonErrorAt(line, column, message);
      this.errorIndicatorEl.style.display = "";
      this.textArea.classList.add("has-error");
      return;
    }

    // 정상: 오류 영역 숨기고 오류 스타일 제거
    this.errorIndicatorEl.textContent = "";
    this.errorIndicatorEl.style.display = "none";
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
