import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon, MarkdownView, TFile, FuzzySuggestModal, Notice, Modal } from "obsidian";
import type BedrockAssistantPlugin from "./main";
import type { ChatMessage, ConverseMessage, ContentBlock, ContentBlockToolUse, ModelInfo, ChatSession } from "./types";
import { TOOLS } from "./obsidian-tools";
import { BRANDING } from "./branding";
import { trimConversationHistory, CHARS_PER_TOKEN } from "./token-trimmer";
import { isToolError } from "./tool-failure-tracker";
import { prepareRegeneration } from "./regenerate-helper";
import { filterSessions } from "./session-search";
import { DESTRUCTIVE_TOOLS, needsToolConfirmation } from "./tool-confirm-utils";
import { isAllowedTextExtension } from "./file-extension-utils";
import { WebClipperModal } from "./web-clipper";

export const VIEW_TYPE = BRANDING.viewType;

// 채팅 뷰 다국어 레이블
const VIEW_I18N = {
  en: {
    indexVault: "Index vault",
    newChat: "New chat",
    generateTags: "Generate tags",
    placeholder: "Type a message...",
    attachNote: "Attach current note",
    searchFile: "Search & attach file",
    attachFile: "Attach file",
    webSearch: "Web search",
    contextUsage: "Context usage",
    copy: "Copy",
    thinking: "Thinking...",
    defaultGreeting: "How can I help you?",
    indexedNotes: (n: number) => `📊 Indexed notes: ${n}`,
    indexHint: "💡 Index your vault using the icon above",
    noOpenNote: "No open note found.",
    tagsExist: "Tags already exist.",
    generatingTags: "Generating tags...",
    tagsFailed: "Tag generation failed",
    tagsExtractFail: "Could not extract tags.",
    tagsAdded: (t: string) => `Tags added: ${t}`,
    tagsError: (e: string) => `Tag generation failed: ${e}`,
    modelLoading: "Loading models...",
    modelFailed: "Model loading failed",
    error: (e: string) => `Error: ${e}`,
    checkingChanges: " Checking for changes...",
    indexing: (pct: number) => ` Indexing... ${pct}%`,
    filesProgress: (c: number, t: number) => `${c} / ${t} files`,
    allUpToDate: " All files are up to date",
    totalIndexed: (n: number) => `Total ${n} notes indexed`,
    indexDone: " Indexing complete",
    updated: (n: number) => `${n} updated`,
    failed: (n: number) => `${n} failed`,
    totalIndexedShort: (n: number) => `${n} total indexed`,
    failHeader: (n: number) => `⚠️ ${n} files failed to index`,
    createTodo: "Create To-Do",
    chatHistory: "Chat history",
    noSessions: "No saved sessions.",
    deleteSession: "Delete",
    sessionDate: (d: string) => `${d}`,
    todoCreated: (path: string) => `To-Do created: ${path}`,
    todoExists: (path: string) => `To-Do already exists: ${path}`,
    todoError: (e: string) => `To-Do creation failed: ${e}`,
    todoArchived: (n: number) => `${n} old to-do(s) archived`,
    cleanArchive: "Clean archive",
    cleanArchiveTitle: "Clean Archive",
    cleanArchiveEmpty: "No old files to delete.",
    cleanArchiveSelectAll: "Select all",
    cleanArchiveDelete: "Delete selected",
    cleanArchiveCancel: "Cancel",
    cleanArchiveDeleted: (n: number) => `${n} file(s) deleted`,
    retrospective: "Retrospective",
    retroConfirmTitle: "Daily Retrospective",
    retroConfirmMessage: "Have you finished all tasks for today?",
    retroNotYet: "Not yet",
    retroDone: "Done",
    retroNoTodo: "No To-Do found for today. Please create today's To-Do first.",
    retroOk: "OK",
    retroGenerating: "Generating retrospective...",
    retroComplete: "Retrospective added to today's To-Do.",
    retroFailed: (e: string) => `Retrospective failed: ${e}`,
    searchPlaceholder: "Search for a note to attach...",
    unsupportedExt: (ext: string) => `Unsupported file format: .${ext}`,
    webSearchHint: "[Web search enabled: Search the web for up-to-date information when needed. Include source URLs.]",
    contextLabel: (used: string, total: string) => `Context: ~${used}K / ${total}K tokens`,
    toolError: (e: string) => `Tool execution error: ${e}`,
    toolConfirmTitle: "Confirm Tool Execution",
    toolConfirmMessage: (name: string) => `The AI wants to execute a destructive tool: "${name}"`,
    toolConfirmParams: "Parameters:",
    toolConfirmApprove: "Execute",
    toolConfirmDeny: "Deny",
    toolConfirmDontAsk: "Don't ask again",
    toolRunning: "Running...",
    toolDenied: "Tool execution denied by user.",
    toolConsecutiveFailures: "Tool execution failed 3 times in a row. Stopping the tool loop to prevent further errors.",
    attachedFileLabel: (path: string) => `[Attached file: ${path}]`,
    webClip: "Summarize web page",
    exportChat: "Export chat",
    exportSuccess: (path: string) => `Chat exported: ${path}`,
    exportEmpty: "No messages to export.",
    regenerate: "Regenerate",
    sessionSearch: "Search conversations...",
    sessionSearchNoResults: "No matching conversations.",
    tagPrompt: (title: string, content: string) => `Analyze the following note and generate 3 appropriate tags.
Output only the tags separated by commas on a single line. No other explanation needed.
Tags can be in English or the note's language, matching the content.
Example: project-management, AI, meeting-notes

---
Title: ${title}

${content}`,
  },
  ko: {
    indexVault: "볼트 인덱싱",
    newChat: "새 대화",
    generateTags: "태그 생성",
    placeholder: "메시지를 입력하세요...",
    attachNote: "현재 노트 첨부",
    searchFile: "파일 검색 첨부",
    attachFile: "파일 첨부",
    webSearch: "웹 서치",
    contextUsage: "컨텍스트 사용량",
    copy: "복사",
    thinking: "생각 중...",
    defaultGreeting: "무엇을 도와드릴까요?",
    indexedNotes: (n: number) => `📊 인덱싱된 노트: ${n}개`,
    indexHint: "💡 상단 DB 아이콘으로 볼트를 인덱싱하세요",
    noOpenNote: "열려있는 노트가 없습니다.",
    tagsExist: "이미 태그가 존재합니다.",
    generatingTags: "태그 생성 중...",
    tagsFailed: "태그 생성 실패",
    tagsExtractFail: "태그를 추출할 수 없습니다.",
    tagsAdded: (t: string) => `태그 추가됨: ${t}`,
    tagsError: (e: string) => `태그 생성 실패: ${e}`,
    modelLoading: "모델 목록 로딩 중...",
    modelFailed: "모델 조회 실패",
    error: (e: string) => `오류: ${e}`,
    checkingChanges: " 변경 사항 확인 중...",
    indexing: (pct: number) => ` 인덱싱 중... ${pct}%`,
    filesProgress: (c: number, t: number) => `${c} / ${t} 파일`,
    allUpToDate: " 모든 파일이 최신 상태입니다",
    totalIndexed: (n: number) => `총 ${n}개 노트 인덱싱 완료`,
    indexDone: " 인덱싱 완료",
    updated: (n: number) => `${n}개 업데이트`,
    failed: (n: number) => `${n}개 실패`,
    totalIndexedShort: (n: number) => `총 ${n}개 인덱싱됨`,
    failHeader: (n: number) => `⚠️ ${n}개 파일 인덱싱 실패`,
    createTodo: "To-Do 생성",
    chatHistory: "지난 대화",
    noSessions: "저장된 대화가 없습니다.",
    deleteSession: "삭제",
    sessionDate: (d: string) => `${d}`,
    todoCreated: (path: string) => `To-Do 생성됨: ${path}`,
    todoExists: (path: string) => `이미 존재합니다: ${path}`,
    todoError: (e: string) => `To-Do 생성 실패: ${e}`,
    todoArchived: (n: number) => `${n}개의 오래된 To-Do가 아카이브됨`,
    cleanArchive: "아카이브 비우기",
    cleanArchiveTitle: "아카이브 비우기",
    cleanArchiveEmpty: "삭제할 오래된 파일이 없습니다.",
    cleanArchiveSelectAll: "전체 선택",
    cleanArchiveDelete: "선택 항목 삭제",
    cleanArchiveCancel: "취소",
    cleanArchiveDeleted: (n: number) => `${n}개 파일 삭제됨`,
    retrospective: "회고",
    retroConfirmTitle: "오늘의 회고",
    retroConfirmMessage: "오늘 할 일을 모두 끝마쳤나요?",
    retroNotYet: "아직",
    retroDone: "했음",
    retroNoTodo: "오늘자 To-Do 문서가 없습니다. 먼저 오늘 문서를 작성해주세요.",
    retroOk: "확인",
    retroGenerating: "회고 작성 중...",
    retroComplete: "오늘자 To-Do에 회고가 추가되었습니다.",
    retroFailed: (e: string) => `회고 작성 실패: ${e}`,
    searchPlaceholder: "첨부할 노트를 검색하세요...",
    unsupportedExt: (ext: string) => `지원하지 않는 파일 형식입니다: .${ext}`,
    webSearchHint: "[웹 서치 활성화됨: 필요한 경우 최신 정보를 웹에서 검색하여 답변에 포함하세요. 출처 URL을 함께 제공하세요.]",
    contextLabel: (used: string, total: string) => `컨텍스트: ~${used}K / ${total}K 토큰`,
    toolError: (e: string) => `도구 실행 오류: ${e}`,
    toolConfirmTitle: "도구 실행 확인",
    toolConfirmMessage: (name: string) => `AI가 파괴적 도구를 실행하려 합니다: "${name}"`,
    toolConfirmParams: "파라미터:",
    toolConfirmApprove: "실행",
    toolConfirmDeny: "거부",
    toolConfirmDontAsk: "다음부터 묻지 않기",
    toolRunning: "실행 중...",
    toolDenied: "사용자가 도구 실행을 거부했습니다.",
    toolConsecutiveFailures: "도구 실행이 3회 연속 실패하여 루프를 중단합니다. 추가 오류를 방지하기 위해 중단되었습니다.",
    attachedFileLabel: (path: string) => `[첨부 파일: ${path}]`,
    webClip: "웹 페이지 요약",
    exportChat: "대화 내보내기",
    exportSuccess: (path: string) => `대화 내보내기 완료: ${path}`,
    exportEmpty: "내보낼 메시지가 없습니다.",
    regenerate: "재생성",
    sessionSearch: "대화 검색...",
    sessionSearchNoResults: "일치하는 대화가 없습니다.",
    tagPrompt: (title: string, content: string) => `다음 노트의 내용을 분석하여 적절한 태그 3개를 생성해주세요.
태그만 쉼표로 구분하여 한 줄로 출력하세요. 다른 설명은 불필요합니다.
태그는 한국어 또는 영어로, 노트 내용에 맞게 작성하세요.
예시: 프로젝트관리, AI, 회의록

---
제목: ${title}

${content}`,
  },
  ja: {
    indexVault: "ボルトインデックス",
    newChat: "新しいチャット",
    generateTags: "タグ生成",
    placeholder: "メッセージを入力...",
    attachNote: "現在のノートを添付",
    searchFile: "ファイル検索・添付",
    attachFile: "ファイル添付",
    webSearch: "Web検索",
    contextUsage: "コンテキスト使用量",
    copy: "コピー",
    thinking: "考え中...",
    defaultGreeting: "何かお手伝いできますか？",
    indexedNotes: (n: number) => `📊 インデックス済みノート: ${n}件`,
    indexHint: "💡 上部のDBアイコンでボルトをインデックスしてください",
    noOpenNote: "開いているノートがありません。",
    tagsExist: "タグは既に存在します。",
    generatingTags: "タグ生成中...",
    tagsFailed: "タグ生成失敗",
    tagsExtractFail: "タグを抽出できません。",
    tagsAdded: (t: string) => `タグ追加: ${t}`,
    tagsError: (e: string) => `タグ生成失敗: ${e}`,
    modelLoading: "モデル一覧を読み込み中...",
    modelFailed: "モデル取得失敗",
    error: (e: string) => `エラー: ${e}`,
    checkingChanges: " 変更を確認中...",
    indexing: (pct: number) => ` インデックス中... ${pct}%`,
    filesProgress: (c: number, t: number) => `${c} / ${t} ファイル`,
    allUpToDate: " すべてのファイルが最新です",
    totalIndexed: (n: number) => `合計${n}件のノートをインデックス完了`,
    indexDone: " インデックス完了",
    updated: (n: number) => `${n}件更新`,
    failed: (n: number) => `${n}件失敗`,
    totalIndexedShort: (n: number) => `合計${n}件インデックス済み`,
    failHeader: (n: number) => `⚠️ ${n}件のファイルのインデックスに失敗`,
    createTodo: "To-Do作成",
    chatHistory: "チャット履歴",
    noSessions: "保存されたセッションがありません。",
    deleteSession: "削除",
    sessionDate: (d: string) => `${d}`,
    todoCreated: (path: string) => `To-Do作成完了: ${path}`,
    todoExists: (path: string) => `既に存在します: ${path}`,
    todoError: (e: string) => `To-Do作成失敗: ${e}`,
    todoArchived: (n: number) => `${n}件の古いTo-Doをアーカイブしました`,
    cleanArchive: "アーカイブ整理",
    cleanArchiveTitle: "アーカイブ整理",
    cleanArchiveEmpty: "削除する古いファイルがありません。",
    cleanArchiveSelectAll: "すべて選択",
    cleanArchiveDelete: "選択項目を削除",
    cleanArchiveCancel: "キャンセル",
    cleanArchiveDeleted: (n: number) => `${n}件のファイルを削除しました`,
    retrospective: "振り返り",
    retroConfirmTitle: "今日の振り返り",
    retroConfirmMessage: "今日のタスクはすべて完了しましたか？",
    retroNotYet: "まだ",
    retroDone: "完了",
    retroNoTodo: "今日のTo-Doドキュメントがありません。先に今日のドキュメントを作成してください。",
    retroOk: "OK",
    retroGenerating: "振り返りを作成中...",
    retroComplete: "今日のTo-Doに振り返りが追加されました。",
    retroFailed: (e: string) => `振り返り作成失敗: ${e}`,
    searchPlaceholder: "添付するノートを検索...",
    unsupportedExt: (ext: string) => `サポートされていないファイル形式: .${ext}`,
    webSearchHint: "[Web検索有効: 必要に応じて最新情報をWebで検索して回答に含めてください。出典URLも提供してください。]",
    contextLabel: (used: string, total: string) => `コンテキスト: ~${used}K / ${total}K トークン`,
    toolError: (e: string) => `ツール実行エラー: ${e}`,
    toolConfirmTitle: "ツール実行確認",
    toolConfirmMessage: (name: string) => `AIが破壊的ツールを実行しようとしています: "${name}"`,
    toolConfirmParams: "パラメータ:",
    toolConfirmApprove: "実行",
    toolConfirmDeny: "拒否",
    toolConfirmDontAsk: "次回から確認しない",
    toolRunning: "実行中...",
    toolDenied: "ユーザーがツール実行を拒否しました。",
    toolConsecutiveFailures: "ツール実行が3回連続で失敗したため、ループを停止します。",
    attachedFileLabel: (path: string) => `[添付ファイル: ${path}]`,
    webClip: "Webページ要約",
    exportChat: "チャットをエクスポート",
    exportSuccess: (path: string) => `チャットエクスポート完了: ${path}`,
    exportEmpty: "エクスポートするメッセージがありません。",
    regenerate: "再生成",
    sessionSearch: "会話を検索...",
    sessionSearchNoResults: "一致する会話がありません。",
    tagPrompt: (title: string, content: string) => `以下のノートの内容を分析して、適切なタグを3つ生成してください。
タグのみをカンマ区切りで1行で出力してください。他の説明は不要です。
タグは日本語または英語で、ノートの内容に合わせて作成してください。
例: プロジェクト管理, AI, 議事録

---
タイトル: ${title}

${content}`,
  },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViewLang = Record<string, any>;

// Claudian 스타일 사이드바 채팅 뷰
export class ChatView extends ItemView {
  private plugin: BedrockAssistantPlugin;
  private messages: ChatMessage[] = [];

  // DOM 요소 (onOpen()에서 초기화)
  private viewContainerEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLElement;
  private stopBtn!: HTMLElement;
  private contextRow!: HTMLElement;
  private fileChipContainer!: HTMLElement;
  private isGenerating = false;
  private abortController: AbortController | null = null;

  // 첨부된 파일 컨텍스트
  private attachedFiles: Map<string, string> = new Map(); // path → content (텍스트 파일)
  private attachedBinaryFiles: Map<string, ArrayBuffer> = new Map(); // path → binary data
  private manuallyAttachedPaths: Set<string> = new Set(); // 수동 첨부 경로 (문서 이동 시 유지)
  private autoAttachedPath: string | null = null; // 자동 첨부 경로 (문서 이동 시 교체)

  // 모델 선택 (onOpen()에서 초기화)
  private modelSelectorEl!: HTMLElement;
  private modelLabelEl!: HTMLElement;
  private cachedModels: ModelInfo[] = [];
  private modelDropdownEl: HTMLElement | null = null;

  // MCP 상태 표시 (onOpen()에서 초기화)
  private mcpStatusEl!: HTMLElement;

  // 컨텍스트 사용량 링
  private contextRingEl: SVGCircleElement | null = null;
  private contextLabelEl: HTMLElement | null = null;

  // 웹 서치 토글
  private webSearchEnabled = false;
  private webSearchBtn: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: BedrockAssistantPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return BRANDING.displayName;
  }

  getIcon(): string {
    return BRANDING.icon.id;
  }

  // 현재 언어에 맞는 I18N 레이블 반환
  private get t(): ViewLang {
    return VIEW_I18N[this.plugin.settings.language] || VIEW_I18N.en;
  }

  async onOpen(): Promise<void> {
        const container = this.contentEl ?? (this.containerEl.children[1] as HTMLElement);
        if (!container) return;

        this.viewContainerEl = container;
        this.viewContainerEl.empty();
        this.viewContainerEl.addClass("ba-container");

        // 헤더
        this.buildHeader();

        // 메시지 영역
        const messagesWrapper = this.viewContainerEl.createDiv({ cls: "ba-messages-wrapper" });
        this.messagesEl = messagesWrapper.createDiv({ cls: "ba-messages" });

        // 채팅 폰트 크기 적용
        this.applyFontSize();

        // 입력 영역
        this.buildInputArea();

        // 저장된 대화 히스토리 복원
        await this.restoreChatHistory();

        // 컨텍스트 링 초기화
        this.updateContextRing();
      }


  // ============================================
  // UI 빌드
  // ============================================

  private buildHeader(): void {
    const header = this.viewContainerEl.createDiv({ cls: "ba-header" });

    // 타이틀
    const titleSlot = header.createDiv({ cls: "ba-title-slot" });
    const titleIcon = titleSlot.createDiv({ cls: "ba-title-icon" });
    setIcon(titleIcon, BRANDING.icon.id);
    titleSlot.createEl("h4", { text: BRANDING.displayName, cls: "ba-title-text" });

    // 액션 버튼들
    const actions = header.createDiv({ cls: "ba-header-actions" });

    // 대화 내보내기 버튼
    const exportBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.exportChat } });
    setIcon(exportBtn, "download");
    exportBtn.addEventListener("click", () => this.exportChat());

    // 웹 페이지 요약 버튼
    const webClipBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.webClip } });
    setIcon(webClipBtn, "globe");
    webClipBtn.addEventListener("click", () => this.openWebClipper());

    // 인덱싱 버튼
    const indexBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.indexVault } });
    setIcon(indexBtn, "file-search");
    indexBtn.addEventListener("click", () => this.handleIndexVault());

    // 새 대화 버튼
    const newBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.newChat } });
    setIcon(newBtn, "square-pen");
    newBtn.addEventListener("click", () => this.startNewChat());

    // 지난 대화 버튼
    const historyBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.chatHistory } });
    setIcon(historyBtn, "history");
    historyBtn.addEventListener("click", () => this.showSessionList());
  }

  private buildInputArea(): void {
    const inputContainer = this.viewContainerEl.createDiv({ cls: "ba-input-container" });

    // 액션 툴바 (입력창 바로 위)
    const actionToolbar = inputContainer.createDiv({ cls: "ba-action-toolbar" });

    // To-Do 생성 버튼
    const todoBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.createTodo } });
    setIcon(todoBtn, "check-square");
    todoBtn.createSpan({ cls: "ba-action-btn-label", text: this.t.createTodo });
    todoBtn.addEventListener("click", () => this.createTodoNote());

    // 회고 버튼
    const retroBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.retrospective } });
    setIcon(retroBtn, "book-open");
    retroBtn.createSpan({ cls: "ba-action-btn-label", text: this.t.retrospective });
    retroBtn.addEventListener("click", () => this.openRetrospectiveModal());

    // 태그 생성 버튼
    const tagBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.generateTags } });
    setIcon(tagBtn, "tag");
    tagBtn.createSpan({ cls: "ba-action-btn-label", text: this.t.generateTags });
    tagBtn.addEventListener("click", () => this.generateTags());

    // 아카이브 비우기 버튼
    const cleanBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.cleanArchive } });
    setIcon(cleanBtn, "trash-2");
    cleanBtn.createSpan({ cls: "ba-action-btn-label", text: this.t.cleanArchive });
    cleanBtn.addEventListener("click", () => this.openCleanArchiveModal());

    const inputWrapper = inputContainer.createDiv({ cls: "ba-input-wrapper" });

    // 컨텍스트 행 (첨부된 파일 칩 표시)
    this.contextRow = inputWrapper.createDiv({ cls: "ba-context-row" });
    this.fileChipContainer = this.contextRow.createDiv({ cls: "ba-file-chips" });

    // 텍스트 입력
    this.inputEl = inputWrapper.createEl("textarea", {
      cls: "ba-input",
      attr: { placeholder: this.t.placeholder, rows: "1" },
    });

    // 툴바
    const toolbar = inputWrapper.createDiv({ cls: "ba-input-toolbar" });
    const toolbarLeft = toolbar.createDiv({ cls: "ba-toolbar-left" });

    // 현재 노트 첨부 버튼
    const attachBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn", attr: { "aria-label": this.t.attachNote } });
    setIcon(attachBtn, "file-plus");
    attachBtn.addEventListener("click", () => this.attachCurrentNote());

    // 파일 검색 첨부 버튼
    const searchBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn", attr: { "aria-label": this.t.searchFile } });
    setIcon(searchBtn, "search");
    searchBtn.addEventListener("click", () => this.openFileSearchModal());

    // 파일 첨부 버튼 (이미지, PDF, XLSX 등)
    const clipBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn", attr: { "aria-label": this.t.attachFile } });
    setIcon(clipBtn, "paperclip");
    clipBtn.addEventListener("click", () => this.openBinaryFileAttach());

    // 웹 서치 토글 버튼
    this.webSearchBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn ba-web-search-btn", attr: { "aria-label": this.t.webSearch } });
    setIcon(this.webSearchBtn, "globe");
    this.webSearchBtn.addEventListener("click", () => this.toggleWebSearch());

    // 툴바 오른쪽 (링 + 전송/중지)
    const toolbarRight = toolbar.createDiv({ cls: "ba-toolbar-right" });

    // 컨텍스트 사용량 링
    const ringContainer = toolbarRight.createDiv({ cls: "ba-context-ring-container", attr: { "aria-label": this.t.contextUsage } });
    const ringSize = 22;
    const strokeWidth = 2.5;
    const radius = (ringSize - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", String(ringSize));
    svg.setAttribute("height", String(ringSize));
    svg.setAttribute("viewBox", `0 0 ${ringSize} ${ringSize}`);
    svg.classList.add("ba-context-ring-svg");

    // 배경 원
    const bgCircle = document.createElementNS(svgNS, "circle");
    bgCircle.setAttribute("cx", String(ringSize / 2));
    bgCircle.setAttribute("cy", String(ringSize / 2));
    bgCircle.setAttribute("r", String(radius));
    bgCircle.setAttribute("fill", "none");
    bgCircle.setAttribute("stroke", "var(--background-modifier-border)");
    bgCircle.setAttribute("stroke-width", String(strokeWidth));
    svg.appendChild(bgCircle);

    // 프로그레스 원
    const progressCircle = document.createElementNS(svgNS, "circle");
    progressCircle.setAttribute("cx", String(ringSize / 2));
    progressCircle.setAttribute("cy", String(ringSize / 2));
    progressCircle.setAttribute("r", String(radius));
    progressCircle.setAttribute("fill", "none");
    progressCircle.setAttribute("stroke", "var(--ba-brand)");
    progressCircle.setAttribute("stroke-width", String(strokeWidth));
    progressCircle.setAttribute("stroke-dasharray", String(circumference));
    progressCircle.setAttribute("stroke-dashoffset", String(circumference));
    progressCircle.setAttribute("stroke-linecap", "round");
    progressCircle.classList.add("ba-context-ring-progress");
    svg.appendChild(progressCircle);

    ringContainer.appendChild(svg);
    this.contextRingEl = progressCircle;
    this.contextLabelEl = ringContainer.createSpan({ cls: "ba-context-ring-label", text: "0%" });

    // 전송/중지 버튼
    this.sendBtn = toolbarRight.createEl("button", { cls: "ba-send-btn" });
    setIcon(this.sendBtn, "arrow-up");

    this.stopBtn = toolbarRight.createEl("button", { cls: "ba-stop-btn" });
    setIcon(this.stopBtn, "square");

    // 이벤트
    this.sendBtn.addEventListener("click", () => this.handleSend());
    this.stopBtn.addEventListener("click", () => this.handleStop());

    this.inputEl.addEventListener("keydown", (e) => {
      // 한글 등 IME 조합 중에는 Enter 무시
      if (e.isComposing || e.keyCode === 229) return;
      // Enter 단독: 전송, Shift+Enter: 줄바꿈
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        this.handleSend();
      }
    });

    // 자동 높이 조절
    this.inputEl.addEventListener("input", () => {
      this.inputEl.style.height = "auto";
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + "px";
      this.updateContextRing();
    });

    // Escape로 스트리밍 중지
    this.registerDomEvent(this.containerEl, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.isGenerating) {
        e.preventDefault();
        this.handleStop();
      }
    });

    // 파일 열기 이벤트 → 자동 첨부
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file && this.plugin.settings.autoAttachActiveNote) {
          this.autoAttachFile(file.path);
        }
      })
    );

    // 초기 로드 시 현재 열린 파일 첨부
    if (this.plugin.settings.autoAttachActiveNote) {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView?.file) {
        this.autoAttachFile(activeView.file.path);
      }
    }

    // 하단 바 (모델 선택 + MCP 상태)
    const bottomBar = inputContainer.createDiv({ cls: "ba-bottom-bar" });
    this.modelSelectorEl = bottomBar.createDiv({ cls: "ba-model-selector" });
    this.mcpStatusEl = bottomBar.createDiv({ cls: "ba-mcp-indicator" });
    this.updateMcpIndicator();

    // 드래그 앤 드롭 파일 첨부
    inputWrapper.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      inputWrapper.addClass("ba-drag-over");
    });
    inputWrapper.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      inputWrapper.removeClass("ba-drag-over");
    });
    inputWrapper.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      inputWrapper.removeClass("ba-drag-over");
      if (e.dataTransfer?.files) {
        for (const file of Array.from(e.dataTransfer.files)) {
          await this.addLocalFile(file);
        }
      }
    });

    // 클립보드 붙여넣기 (스크린샷 등)
    this.inputEl.addEventListener("paste", async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            await this.addLocalFile(file);
          }
        }
      }
    });
    const modelBtn = this.modelSelectorEl.createDiv({ cls: "ba-model-btn" });
    const modelIcon = modelBtn.createDiv({ cls: "ba-model-icon" });
    setIcon(modelIcon, "cpu");
    this.modelLabelEl = modelBtn.createSpan({ cls: "ba-model-label" });
    this.updateModelLabel();
    const chevron = modelBtn.createDiv({ cls: "ba-model-chevron" });
    setIcon(chevron, "chevron-down");

    modelBtn.addEventListener("click", () => this.openModelPicker());

    // 입력창에도 폰트 크기 적용
    this.applyFontSize();
  }

  // ============================================
  // 환영 메시지
  // ============================================

  private renderWelcome(): void {
    const welcome = this.messagesEl.createDiv({ cls: "ba-welcome" });
    const greeting = this.plugin.settings.welcomeGreeting || this.t.defaultGreeting;
    welcome.createDiv({ cls: "ba-welcome-greeting", text: greeting });

    const info = welcome.createDiv({ cls: "ba-welcome-info" });
    const indexCount = this.plugin.indexer?.size ?? 0;
    info.setText(
      indexCount > 0
        ? this.t.indexedNotes(indexCount)
        : this.t.indexHint
    );
  }

  // ============================================
  // 메시지 전송
  // ============================================

  private async handleSend(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.isGenerating) return;

    this.inputEl.value = "";
    this.inputEl.style.height = "auto";

    // 환영 메시지 제거
    const welcome = this.messagesEl.querySelector(".ba-welcome");
    if (welcome) welcome.remove();

    // 사용자 메시지 렌더링
    const userMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };
    this.messages.push(userMsg);
    this.renderUserMessage(userMsg);

    // 첨부 파일 컨텍스트를 별도로 구성 (원본 메시지는 변경하지 않음)
    const contextPrefix = this.buildContextPrefix();

    // AI 응답 생성 (컨텍스트 접두사는 API 호출용 복사본에만 적용)
    await this.generateResponse(contextPrefix);
  }

  private handleStop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // 어시스턴트 메시지 상단에 아이콘 + 이름 라벨을 추가하는 헬퍼
  private addAssistantLabel(msgEl: HTMLElement): void {
    const labelEl = msgEl.createDiv({ cls: "ba-assistant-label" });
    const iconEl = labelEl.createDiv({ cls: "ba-assistant-label-icon" });
    setIcon(iconEl, BRANDING.icon.id);
    labelEl.createSpan({ cls: "ba-assistant-label-name", text: BRANDING.displayName });
  }


  // ============================================
  // 대화 히스토리 토큰 트리밍 (REQ-3)
  // ============================================

  /**
   * 컨텍스트 윈도우 초과를 방지하기 위해 오래된 메시지를 제거합니다.
   * 핵심 로직은 token-trimmer.ts에 분리되어 있습니다.
   */
  private trimMessages(
    messages: ConverseMessage[],
    tools: import("./types").ToolDefinition[]
  ): void {
    trimConversationHistory(messages, tools);
  }

  // ============================================
  // 응답 생성 (도구 사용 루프 포함)
  // ============================================

  private async generateResponse(contextPrefix?: string): Promise<void> {
      this.setGenerating(true);
      this.abortController = new AbortController();
      const startTime = Date.now();

      // 어시스턴트 메시지 컨테이너
      const msgEl = this.messagesEl.createDiv({ cls: "ba-message ba-message-assistant" });
      this.addAssistantLabel(msgEl);
      const contentEl = msgEl.createDiv({ cls: "ba-message-content" });
      const thinkingEl = contentEl.createSpan({ cls: "ba-thinking", text: this.t.thinking });
      this.scrollToBottom();

      // Converse API용 메시지 히스토리 구성
      // 원본 this.messages는 변경하지 않고, API 호출용 복사본에만 컨텍스트 접두사 적용
      const converseMessages: ConverseMessage[] = this.messages.map((m, i) => ({
        role: m.role,
        content: [{ text: (contextPrefix && i === this.messages.length - 1 && m.role === "user")
          ? contextPrefix + m.content
          : m.content }],
      }));

      // 바이너리 첨부 파일을 마지막 user 메시지에 추가
      if (this.attachedBinaryFiles.size > 0 && converseMessages.length > 0) {
        const lastUserIdx = converseMessages.length - 1;
        if (converseMessages[lastUserIdx].role === "user") {
          for (const [path, data] of this.attachedBinaryFiles) {
            const ext = path.split(".").pop()?.toLowerCase() || "";
            const block = this.buildBinaryContentBlock(path, ext, data);
            if (block) {
              (converseMessages[lastUserIdx].content as unknown[]).unshift(block);
            }
          }
        }
      }

      const MAX_TOOL_ROUNDS = 10; // 무한 루프 방지
      const MAX_CONSECUTIVE_FAILURES = 3; // 연속 실패 허용 횟수
      let consecutiveFailures = 0; // 연속 실패 카운터
      let fullText = "";

      // 옵시디언 내장 도구 + MCP 도구 합치기
      const allTools = [...TOOLS, ...this.plugin.mcpManager.getAllTools()];

      // ── 대화 히스토리 토큰 트리밍 (REQ-3) ──
      // 컨텍스트 윈도우 초과 방지를 위해 오래된 메시지부터 제거
      this.trimMessages(converseMessages, allTools);

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (this.abortController?.signal.aborted) break;

          // 텍스트 스트리밍 렌더링용
          let roundText = "";

          // requestAnimationFrame 기반 디바운싱 변수
          let renderPending = false;
          let streamingPreEl: HTMLPreElement | null = null;
          // 스트리밍 텍스트를 감싸는 wrapper (도구 호출 UI 보존을 위해 별도 div 사용)
          const streamingState = { wrapper: null as HTMLElement | null };

          const result = await this.plugin.bedrockClient.converse(
            converseMessages,
            allTools,
            (delta) => {
              // 텍스트 델타: 누적만 하고 렌더링은 다음 프레임에서 한 번만 수행
              if (this.abortController?.signal.aborted) return;
              if (thinkingEl.parentElement) thinkingEl.remove();
              // 다음 라운드 "생각 중..." 표시도 제거
              const pendingThinking = contentEl.querySelector(".ba-thinking");
              if (pendingThinking) pendingThinking.remove();
              roundText += delta;
              fullText += delta;

              // 렌더링이 이미 예약되어 있으면 누적만 하고 리턴
              if (renderPending) return;
              renderPending = true;

              requestAnimationFrame(() => {
                renderPending = false;
                if (this.abortController?.signal.aborted) return;

                // 스트리밍 중에는 별도 div 안의 <pre> 태그로 빠르게 표시
                // Dataview 등 다른 플러그인 간섭을 방지하기 위해 MarkdownRenderer는 완료 후에만 호출
                if (!streamingPreEl) {
                  streamingState.wrapper = contentEl.createDiv({ cls: "ba-streaming-wrapper" });
                  streamingPreEl = streamingState.wrapper.createEl("pre", { cls: "ba-streaming-text" });
                }
                streamingPreEl.textContent = roundText;
                this.scrollToBottom();
              });
            },
            this.abortController.signal
          );

          // 스트리밍 완료 후 마크다운으로 최종 렌더링 (스트리밍 wrapper만 교체)
          if (streamingState.wrapper && roundText) {
            streamingState.wrapper.empty();
            streamingPreEl = null;
            await MarkdownRenderer.render(this.app, roundText, streamingState.wrapper, "", this);
            streamingState.wrapper = null;
            this.scrollToBottom();
          }

          // 어시스턴트 응답을 히스토리에 추가 (Converse API 형식)
          const assistantContent: unknown[] = [];
          for (const block of result.contentBlocks) {
            if (block.type === "text") {
              assistantContent.push({ text: block.text });
            } else if (block.type === "tool_use") {
              assistantContent.push({
                toolUse: {
                  toolUseId: block.toolUseId,
                  name: block.name,
                  input: block.input,
                },
              });
            }
          }
          converseMessages.push({ role: "assistant", content: assistantContent });

          // 도구 호출이 없으면 종료
          if (result.stopReason !== "tool_use") break;

          // 도구 호출 블록 수집 및 실행
          const toolBlocks = result.contentBlocks.filter(
            (b): b is ContentBlockToolUse => b.type === "tool_use"
          );

          if (toolBlocks.length === 0) break;

          // 각 도구 실행 및 UI 표시
          const toolResultContents: unknown[] = [];

          for (const toolBlock of toolBlocks) {
            if (this.abortController?.signal.aborted) break;

            const toolResult = await this.executeAndRenderTool(toolBlock, contentEl);

            // 연속 실패 카운터 관리: 에러 문자열 접두사로 실패 여부 판별
            if (isToolError(toolResult)) {
              consecutiveFailures++;
            } else {
              // 성공 시 카운터 리셋
              consecutiveFailures = 0;
            }

            toolResultContents.push({
              toolResult: {
                toolUseId: toolBlock.toolUseId,
                content: [{ text: toolResult }],
              },
            });

            // 연속 실패 횟수 초과 시 루프 조기 중단
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              break;
            }
          }

          // 연속 실패 횟수 초과 시 전체 도구 루프 중단 + 사용자 안내
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            contentEl.createDiv({
              cls: "ba-error",
              text: this.t.toolConsecutiveFailures,
            });
            this.scrollToBottom();
            break;
          }

          // 도구 결과를 user 메시지로 추가 (Converse API 규약)
          converseMessages.push({ role: "user", content: toolResultContents });

          // 다음 라운드 전 "생각 중..." 표시
          const nextThinking = contentEl.createSpan({ cls: "ba-thinking", text: this.t.thinking });
          this.scrollToBottom();
        }

        // 응답 시간 표시
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const footer = msgEl.createDiv({ cls: "ba-response-footer" });
        footer.createSpan({ cls: "ba-duration", text: `${duration}s` });

        // 재생성 버튼 추가 (REQ-8)
        const regenBtn = footer.createEl("button", {
          cls: "ba-regenerate-btn",
          attr: { "aria-label": this.t.regenerate },
        });
        setIcon(regenBtn, "refresh-cw");
        regenBtn.createSpan({ text: this.t.regenerate });
        regenBtn.addEventListener("click", () => {
          if (!this.isGenerating) {
            this.regenerateLastResponse();
          }
        });

        // 최종 텍스트를 ChatMessage 히스토리에 저장
        if (fullText) {
          this.messages.push({
            role: "assistant",
            content: fullText,
            timestamp: Date.now(),
          });
        }

        // 대화 히스토리 영속화
        this.persistHistory();
      } catch (error) {
        if (thinkingEl.parentElement) thinkingEl.remove();
        // 사용자가 중단한 경우 에러 표시 안 함
        if (this.abortController?.signal.aborted) {
          // 중단 시점까지의 텍스트는 유지
        } else {
          contentEl.createDiv({
            cls: "ba-error",
            text: this.t.error((error as Error).message),
          });
        }
      }

      this.setGenerating(false);
    }


  // ============================================
  // 도구 사용 처리
  // ============================================

  // 도구 실행 + UI 렌더링, 결과 문자열 반환
    private async executeAndRenderTool(
          toolBlock: ContentBlockToolUse,
          contentEl: HTMLElement
        ): Promise<string> {
          const toolEl = contentEl.createDiv({ cls: "ba-tool-call" });
          const toolHeader = toolEl.createDiv({ cls: "ba-tool-header" });

          const iconEl = toolHeader.createDiv({ cls: "ba-tool-icon" });
          setIcon(iconEl, "wrench");

          toolHeader.createSpan({ cls: "ba-tool-name", text: toolBlock.name });

          const statusEl = toolHeader.createDiv({ cls: "ba-tool-status status-running" });
          setIcon(statusEl, "loader");

          // 도구 헤더 아래에 "실행 중..." 표시 (별도 div로 확실히 표시)
          const runningLabel = toolEl.createDiv({ cls: "ba-tool-running", text: this.t.toolRunning });

          this.scrollToBottom();

          // 파괴적 도구 실행 전 사용자 확인 모달 표시
          if (needsToolConfirmation(toolBlock.name, this.plugin.settings.confirmToolExecution)) {
            const approved = await new Promise<boolean>((resolve) => {
              new ToolConfirmModal(
                this.app,
                toolBlock.name,
                toolBlock.input as Record<string, unknown>,
                this.t,
                this.plugin,
                resolve
              ).open();
            });

            if (!approved) {
              statusEl.removeClass("status-running");
              statusEl.addClass("status-error");
              statusEl.empty();
              setIcon(statusEl, "x");
              runningLabel.remove();

              const resultEl = toolEl.createDiv({ cls: "ba-tool-content" });
              resultEl.setText(this.t.toolDenied);

              this.scrollToBottom();
              return this.t.toolDenied;
            }
          }

          try {
            // MCP 도구인지 확인하여 라우팅
            let result: string;
            if (this.plugin.mcpManager.isMcpTool(toolBlock.name)) {
              result = await this.plugin.mcpManager.executeTool(
                toolBlock.name,
                toolBlock.input
              );
            } else {
              result = await this.plugin.toolExecutor.execute(
                toolBlock.name,
                toolBlock.input
              );
            }

            // 성공 UI
            statusEl.removeClass("status-running");
            statusEl.addClass("status-completed");
            statusEl.empty();
            setIcon(statusEl, "check");
            runningLabel.remove();

            const resultEl = toolEl.createDiv({ cls: "ba-tool-content" });
            resultEl.setText(result.slice(0, 500) + (result.length > 500 ? "..." : ""));

            toolHeader.createSpan({
              cls: "ba-tool-summary",
              text: result.slice(0, 80).replace(/\n/g, " "),
            });

            this.scrollToBottom();
            return result;
          } catch (error) {
            // 실패 UI
            statusEl.removeClass("status-running");
            statusEl.addClass("status-error");
            statusEl.empty();
            setIcon(statusEl, "x");
            runningLabel.remove();

            this.scrollToBottom();
            const errMsg = this.t.toolError((error as Error).message);
            return errMsg;
          }
        }






  // ============================================
  // 사용자 메시지 렌더링
  // ============================================

  private renderUserMessage(msg: ChatMessage): void {
    const msgEl = this.messagesEl.createDiv({ cls: "ba-message ba-message-user" });
    const contentEl = msgEl.createDiv({ cls: "ba-message-content" });
    contentEl.setText(msg.content);

    // 복사/편집 액션
    const actions = msgEl.createDiv({ cls: "ba-user-msg-actions" });
    const copyBtn = actions.createSpan({ attr: { "aria-label": this.t.copy } });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(msg.content);
      copyBtn.empty();
      copyBtn.setText("✓");
      setTimeout(() => {
        copyBtn.empty();
        setIcon(copyBtn, "copy");
      }, 1500);
    });

    this.scrollToBottom();
  }

  // ============================================
  // 파일 컨텍스트 첨부
  // ============================================

  private async autoAttachFile(path: string): Promise<void> {
      // 이전 자동 첨부 파일만 제거 (수동 첨부는 유지)
      if (this.autoAttachedPath && this.autoAttachedPath !== path) {
        // 수동 첨부에도 포함된 경우 제거하지 않음
        if (!this.manuallyAttachedPaths.has(this.autoAttachedPath)) {
          this.attachedFiles.delete(this.autoAttachedPath);
        }
      }
      this.autoAttachedPath = path;
      await this.addFileContext(path, false);
    }

  private async addFileContext(path: string, manual = true): Promise<void> {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof TFile)) return;
      if (!isAllowedTextExtension(file.extension)) return;

      const content = await this.app.vault.cachedRead(file as any);
      this.attachedFiles.set(path, content);
      if (manual) {
        this.manuallyAttachedPaths.add(path);
      }
      this.renderFileChips();
    }

  private removeFileContext(path: string): void {
      this.attachedFiles.delete(path);
      this.attachedBinaryFiles.delete(path);
      this.manuallyAttachedPaths.delete(path);
      if (this.autoAttachedPath === path) {
        this.autoAttachedPath = null;
      }
      this.renderFileChips();
    }

  private renderFileChips(): void {
      this.fileChipContainer.empty();

      const allPaths = new Set([
        ...this.attachedFiles.keys(),
        ...this.attachedBinaryFiles.keys(),
      ]);

      if (allPaths.size === 0) {
        this.contextRow.removeClass("has-content");
        this.updateContextRing();
        return;
      }

      this.contextRow.addClass("has-content");

      for (const path of allPaths) {
        const chip = this.fileChipContainer.createDiv({ cls: "ba-file-chip" });

        const iconEl = chip.createDiv({ cls: "ba-file-chip-icon" });
        const ext = path.split(".").pop()?.toLowerCase() || "";
        // 파일 타입별 아이콘
        const iconName = this.getFileIcon(ext);
        setIcon(iconEl, iconName);

        const basename = path.split("/").pop() || path;
        chip.createSpan({ cls: "ba-file-chip-name", text: basename });

        const removeBtn = chip.createDiv({ cls: "ba-file-chip-remove", text: "×" });
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.removeFileContext(path);
        });

        chip.addEventListener("click", () => {
          const f = this.app.vault.getAbstractFileByPath(path);
          if (f) this.app.workspace.getLeaf(false).openFile(f as any);
        });
      }

      this.updateContextRing();
    }

    // 파일 확장자에 따른 아이콘 반환
    private getFileIcon(ext: string): string {
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
      if (imageExts.includes(ext)) return "image";
      if (ext === "pdf") return "file-text";
      if (["xls", "xlsx", "csv"].includes(ext)) return "table";
      if (["doc", "docx"].includes(ext)) return "file-text";
      if (ext === "md") return "file-text";
      return "file";
    }

    // 바이너리 파일을 Converse API 콘텐츠 블록으로 변환
    private buildBinaryContentBlock(
      path: string,
      ext: string,
      data: ArrayBuffer
    ): unknown | null {
      const bytes = new Uint8Array(data);

      // 이미지 파일
      const imageFormats: Record<string, string> = {
        png: "png",
        jpg: "jpeg",
        jpeg: "jpeg",
        gif: "gif",
        webp: "webp",
      };
      if (imageFormats[ext]) {
        return {
          image: {
            format: imageFormats[ext],
            source: { bytes },
          },
        };
      }

      // 문서 파일
      const docFormats: Record<string, string> = {
        pdf: "pdf",
        doc: "doc",
        docx: "docx",
        xls: "xls",
        xlsx: "xlsx",
      };
      if (docFormats[ext]) {
        const name = path.split("/").pop()?.replace(/\.[^.]+$/, "") || "document";
        return {
          document: {
            format: docFormats[ext],
            name: name.replace(/[^a-zA-Z0-9가-힣_\-\s]/g, "_").substring(0, 200),
            source: { bytes },
          },
        };
      }

      return null;
    }

  private attachCurrentNote(): void {
      // 사이드바에서 버튼 클릭 시 active view가 채팅 뷰로 바뀌므로,
      // 모든 leaf에서 마크다운 뷰를 찾아야 함
      const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
      // 가장 최근 활성화된 마크다운 leaf 찾기
      const sorted = markdownLeaves.sort(
        (a, b) => ((b as any).activeTime ?? 0) - ((a as any).activeTime ?? 0)
      );
      const leaf = sorted[0];
      if (!leaf) return;

      const view = leaf.view as MarkdownView;
      if (!view?.file) return;
      this.addFileContext(view.file.path);
    }


  // 파일 검색 모달 열기
  private openFileSearchModal(): void {
    const modal = new FileSearchModal(this.app, (file: TFile) => {
      this.addFileContext(file.path);
    }, this.t.searchPlaceholder);
    modal.open();
  }

  // 메시지에 첨부 파일 컨텍스트 주입
  private buildContextPrefix(): string {
    const parts: string[] = [];

    // 웹 서치 활성화 시 지시 추가
    if (this.webSearchEnabled) {
      parts.push(this.t.webSearchHint);
    }

    // 첨부 파일 컨텍스트
    for (const [path, content] of this.attachedFiles) {
      parts.push(`${this.t.attachedFileLabel(path)}\n${content.slice(0, 8000)}`);
    }

    if (parts.length === 0) return "";
    return parts.join("\n\n") + "\n\n---\n\n";
  }

  // ============================================
  // 모델 선택
  // ============================================

  // 모델 라벨 업데이트 (현재 선택된 모델 표시)
  private updateModelLabel(): void {
    const modelId = this.plugin.settings.chatModel;
    const displayName = this.getModelDisplayName(modelId);
    this.modelLabelEl.setText(displayName);
  }

  // MCP 연결 상태 인디케이터 업데이트
  updateMcpIndicator(): void {
    if (!this.mcpStatusEl) return;
    this.mcpStatusEl.empty();

    const status = this.plugin.mcpManager.getStatus();
    if (status.length === 0) return; // MCP 서버가 없으면 표시 안 함

    const connectedCount = status.filter((s) => s.connected).length;
    const totalCount = status.length;
    const allConnected = connectedCount === totalCount;

    const dot = this.mcpStatusEl.createSpan({ cls: `ba-mcp-dot ${allConnected ? "connected" : "disconnected"}` });
    const label = `MCP ${connectedCount}/${totalCount}`;
    this.mcpStatusEl.createSpan({ cls: "ba-mcp-indicator-label", text: label });

    // 툴팁에 상세 정보
    const tooltip = status.map((s) => `${s.connected ? "🟢" : "🔴"} ${s.name} (${s.toolCount} tools)`).join("\n");
    this.mcpStatusEl.setAttr("aria-label", tooltip);
    this.mcpStatusEl.setAttr("title", tooltip);
  }

  // 모델 ID에서 표시명 추출
  private getModelDisplayName(modelId: string): string {
    // 캐시된 모델에서 이름 찾기
    const cached = this.cachedModels.find((m) => m.modelId === modelId);
    if (cached) return cached.modelName;
    // 없으면 ID에서 추출 (예: "us.anthropic.claude-sonnet-4-20250514-v1:0" → "claude-sonnet-4...")
    const parts = modelId.split(".");
    const last = parts[parts.length - 1] || modelId;
    return last.length > 30 ? last.slice(0, 30) + "..." : last;
  }

  // 모델 선택 팝업 열기
  private async openModelPicker(): Promise<void> {
      // 이미 열려 있으면 닫기
      if (this.modelDropdownEl) {
        this.closeModelDropdown();
        return;
      }

      // 모델 목록이 없으면 API에서 로드
      if (this.cachedModels.length === 0) {
        this.modelLabelEl.setText(this.t.modelLoading);
        try {
          this.cachedModels = await this.plugin.bedrockClient.listModels();
        } catch (e) {
          console.error("모델 목록 조회 실패:", e);
        }
        this.updateModelLabel();
      }

      if (this.cachedModels.length === 0) {
        this.modelLabelEl.setText(this.t.modelFailed);
        return;
      }

      // 인라인 드롭다운 생성 (위로 열림)
      this.modelDropdownEl = this.modelSelectorEl.createDiv({ cls: "ba-model-dropdown" });

      const currentModelId = this.plugin.settings.chatModel;
      for (const model of this.cachedModels) {
        const item = this.modelDropdownEl.createDiv({ cls: "ba-model-dropdown-item" });
        if (model.modelId === currentModelId) {
          item.addClass("is-active");
        }
        const prefix = model.isProfile ? "⚡ " : "";
        item.createSpan({ cls: "ba-model-dropdown-name", text: `${prefix}${model.modelName}` });
        if (model.modelId === currentModelId) {
          item.createSpan({ cls: "ba-model-dropdown-check", text: "✓" });
        }
        item.addEventListener("click", async () => {
          this.plugin.settings.chatModel = model.modelId;
          await this.plugin.saveSettings();
          this.updateModelLabel();
          this.closeModelDropdown();
        });
      }

      // 외부 클릭 시 닫기
      setTimeout(() => {
        document.addEventListener("click", this.handleDropdownOutsideClick);
      }, 0);
    }

    private handleDropdownOutsideClick = (e: MouseEvent) => {
      if (this.modelDropdownEl && !this.modelSelectorEl.contains(e.target as Node)) {
        this.closeModelDropdown();
      }
    };

    private closeModelDropdown(): void {
      if (this.modelDropdownEl) {
        this.modelDropdownEl.remove();
        this.modelDropdownEl = null;
      }
      document.removeEventListener("click", this.handleDropdownOutsideClick);
    }

  // 모델 목록 캐시 새로고침
  // 바이너리 파일 첨부 (이미지, PDF, XLSX 등)
  // 로컬 디바이스에서 파일 첨부 (네이티브 파일 선택)
    private openBinaryFileAttach(): void {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.csv,.doc,.docx,.xls,.xlsx,.html,.txt";
      input.multiple = true;
      input.addEventListener("change", async () => {
        if (!input.files) return;
        for (const file of Array.from(input.files)) {
          await this.addLocalFile(file);
        }
      });
      input.click();
    }

    // 로컬 File 객체를 컨텍스트에 추가
    private async addLocalFile(file: File): Promise<void> {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const supportedExts = [
        "png", "jpg", "jpeg", "gif", "webp",
        "pdf", "csv", "doc", "docx", "xls", "xlsx", "html", "txt",
      ];

      if (!supportedExts.includes(ext)) {
        new Notice(this.t.unsupportedExt(ext));
        return;
      }

      const textExts = ["txt", "csv", "html"];
      if (textExts.includes(ext)) {
        const text = await file.text();
        this.attachedFiles.set(file.name, text);
      } else {
        const buffer = await file.arrayBuffer();
        this.attachedBinaryFiles.set(file.name, buffer);
      }

      this.manuallyAttachedPaths.add(file.name);
      this.renderFileChips();
    }


  // 오늘 날짜로 To-Do 노트 생성
  private async createTodoNote(): Promise<void> {
    try {
      const folder = this.plugin.settings.todoFolder || "ToDo";

      // 폴더가 없으면 생성
      const folderExists = this.app.vault.getAbstractFileByPath(folder);
      if (!folderExists) {
        await this.app.vault.createFolder(folder);
      }

      // 오늘 날짜 (YYYY-MM-DD)
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const path = `${folder}/${dateStr}.md`;

      // 이미 존재하면 열기만
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing && existing instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(existing);
        new Notice(this.t.todoExists(path));
        return;
      }

      // 템플릿 파일에서 내용 읽기
      const templateFolder = this.plugin.settings.templateFolder || "Templates";
      const templateName = this.plugin.settings.todoTemplateName || "Daily To-Do";
      const templatePath = `${templateFolder}/${templateName}.md`;
      let template = `# 📋 {{date}}\n\n## To-Do\n\n- [ ] \n\n## Notes\n\n`;
      const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
      if (templateFile && templateFile instanceof TFile) {
        template = await this.app.vault.cachedRead(templateFile);
      }

      // 이전 날짜 계산
      const prev = new Date(now);
      prev.setDate(prev.getDate() - 1);
      const prevDateStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
      let content = template
        .replace(/\{\{date\}\}/g, dateStr)
        .replace(/\{\{prevDate\}\}/g, prevDateStr);

      // 전일자(또는 가장 최근) To-Do에서 미완료 항목 가져오기
      const carryOver = await this.getUnfinishedTasks(folder, now);
      if (carryOver.length > 0) {
        // 템플릿에서 오늘의 할 일 섹션 내 ### 서브섹션 추출
        const subSections = this.extractTodoSubSections(content);

        if (subSections.length >= 2) {
          // AI로 서브섹션별 분류
          const classified = await this.classifyTasksForSections(subSections, carryOver);
          // 각 서브섹션의 빈 체크박스 자리에 분류된 항목 주입
          for (const [section, sectionTasks] of classified) {
            content = this.injectTasksIntoSubSection(content, section, sectionTasks);
          }
        } else {
          // 서브섹션이 없으면 기존 방식으로 주입
          content = this.injectCarryOverTasks(content, carryOver);
        }
      }

      // 이전 투두의 메모 섹션에서 오늘 이후(오늘 포함) 날짜 항목을 메모에 승계
      const datedNotes = await this.getDatedNotesFromPrevTodo(folder, now);
      if (datedNotes.length > 0) {
        console.log("[ToDo] 메모 승계 항목:", datedNotes.length, datedNotes.map(n => n.date));
        const noteLines = datedNotes.map((n) => n.raw);
        content = this.injectNotesIntoMemoSection(content, noteLines);
      }

      const file = await this.app.vault.create(path, content);
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(this.t.todoCreated(path));

      // 오래된 To-Do 파일 아카이브
      await this.archiveOldTodos(folder, now);
    } catch (error) {
      new Notice(this.t.todoError((error as Error).message));
    }
  }

  // 전일자(또는 가장 최근) To-Do 파일에서 미완료 항목 추출
  private async getUnfinishedTasks(todoFolder: string, today: Date): Promise<string[]> {
    const folder = this.app.vault.getAbstractFileByPath(todoFolder);
    if (!folder) return [];

    const children = (folder as any).children || [];
    // YYYY-MM-DD.md 형식 파일만 필터링하고 날짜순 정렬 (내림차순)
    const dated: { file: TFile; date: Date }[] = [];
    for (const child of children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      const match = child.basename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) continue;
      const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      // 오늘 이전 파일만
      if (d < today) {
        dated.push({ file: child, date: d });
      }
    }

    if (dated.length === 0) return [];

    // 가장 최근 파일
    dated.sort((a, b) => b.date.getTime() - a.date.getTime());
    const latest = dated[0].file;

    const content = await this.app.vault.cachedRead(latest);
    // 미완료 체크박스 항목 추출 (계층 구조 유지)
    const lines = content.split("\n");
    const unfinished: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 최상위 미완료 항목 (들여쓰기 없음)
      if (/^- \[ \]\s+.+/.test(line)) {
        unfinished.push(line);
        // 하위 들여쓰기 항목도 함께 수집
        let j = i + 1;
        while (j < lines.length && /^[\t ]+/.test(lines[j]) && lines[j].trim().length > 0) {
          unfinished.push(lines[j]);
          j++;
        }
        i = j - 1;
      }
    }
    return unfinished;
  }

  // 미완료 항목을 템플릿 콘텐츠에 주입
  private injectCarryOverTasks(content: string, tasks: string[]): string {
      const taskBlock = tasks.join("\n");

      // "이전 미완료" 관련 섹션 헤더를 찾아서 그 아래에 삽입
      // 패턴: ## 🔄 또는 ## 이전 미완료 또는 ## Carry 등
      const sectionPattern = /^(##\s+.*(?:이전 미완료|미완료 업무|carry.?over|unfinished).*)/im;
      const match = content.match(sectionPattern);

      if (match && match.index !== undefined) {
        // 섹션 헤더 다음 줄에 삽입
        const insertPos = match.index + match[0].length;
        const after = content.substring(insertPos);
        // 헤더 바로 다음의 빈 줄/설명 블록을 건너뛰고 첫 번째 빈 줄 또는 다음 항목 앞에 삽입
        const nextContentMatch = after.match(/\n(- \[[ x]\]|\n##)/);
        if (nextContentMatch && nextContentMatch.index !== undefined) {
          const pos = insertPos + nextContentMatch.index;
          return content.substring(0, pos) + "\n" + taskBlock + content.substring(pos);
        }
        // 섹션 끝에 추가
        return content.substring(0, insertPos) + "\n" + taskBlock + "\n" + content.substring(insertPos);
      }

      // 섹션을 못 찾으면 문서 끝에 추가
      return content + "\n\n## 🔄 Carry Over\n\n" + taskBlock + "\n";
    }

    /**
     * 템플릿의 "오늘의 할 일" / "To-Do" 섹션 내 ### 서브섹션 이름 추출
     */
    private extractTodoSubSections(content: string): string[] {
      const lines = content.split("\n");
      const subSections: string[] = [];
      let inTodoSection = false;

      for (const line of lines) {
        // ## 오늘의 할 일 / To-Do 섹션 시작 감지
        if (/^##\s+.*(?:오늘의 할 일|할 일|to.?do|tasks)/i.test(line)) {
          inTodoSection = true;
          continue;
        }
        // 다음 ## 섹션이 나오면 종료 (### 제외)
        if (inTodoSection && /^##\s+/.test(line) && !/^###/.test(line)) {
          break;
        }
        // ### 서브섹션 수집
        if (inTodoSection) {
          const m = line.match(/^###\s+(.+)/);
          if (m) subSections.push(m[1].trim());
        }
      }
      return subSections;
    }

    /**
     * AI를 사용해 미완료 태스크를 지정된 서브섹션별로 분류
     */
    private async classifyTasksForSections(
      sections: string[],
      tasks: string[]
    ): Promise<Map<string, string[]>> {
      const lang = this.plugin.settings.language === "ko" ? "ko" : "en";
      const prompt = lang === "ko"
        ? `다음은 미완료 To-Do 항목들과 분류할 카테고리입니다.
각 항목을 가장 적절한 카테고리에 분류해주세요.

카테고리:
${sections.map((s, i) => `${i + 1}. ${s}`).join("\n")}

미완료 항목:
${tasks.map((t, i) => `${i + 1}. ${t.replace(/^\s*-\s*\[ \]\s*/, "").replace(/^\t/, "")}`).join("\n")}

JSON 형식으로만 응답하세요. 키는 카테고리 이름(위 목록과 정확히 동일), 값은 항목 번호 배열입니다.
예시: {"${sections[0]}": [1, 3], "${sections[1] || sections[0]}": [2]}
모든 항목을 반드시 분류하세요.`
        : `Classify these unfinished To-Do items into the given categories.

Categories:
${sections.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Items:
${tasks.map((t, i) => `${i + 1}. ${t.replace(/^\s*-\s*\[ \]\s*/, "").replace(/^\t/, "")}`).join("\n")}

Respond ONLY in JSON. Keys must exactly match category names above, values are arrays of item numbers.
Example: {"${sections[0]}": [1, 3], "${sections[1] || sections[0]}": [2]}
Classify ALL items.`;

      try {
        const result = await this.plugin.bedrockClient.converseLight(
          prompt,
          "You are a task classifier. Respond only in JSON."
        );

        let jsonStr = result.text.trim();
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

        const classification = JSON.parse(jsonStr) as Record<string, number[]>;
        const classified = new Map<string, string[]>();

        for (const [section, indices] of Object.entries(classification)) {
          const sectionTasks: string[] = [];
          for (const idx of indices) {
            if (idx >= 1 && idx <= tasks.length) {
              sectionTasks.push(tasks[idx - 1]);
            }
          }
          if (sectionTasks.length > 0) {
            classified.set(section, sectionTasks);
          }
        }

        // 분류되지 않은 항목은 첫 번째 섹션에 추가
        const classifiedIndices = new Set(Object.values(classification).flat());
        const unclassified: string[] = [];
        for (let i = 0; i < tasks.length; i++) {
          if (!classifiedIndices.has(i + 1)) {
            unclassified.push(tasks[i]);
          }
        }
        if (unclassified.length > 0) {
          const firstSection = sections[0];
          const existing = classified.get(firstSection) || [];
          classified.set(firstSection, [...existing, ...unclassified]);
        }

        return classified;
      } catch (e) {
        console.warn("AI 태스크 분류 실패, 첫 번째 섹션에 전부 넣기:", e);
        const result = new Map<string, string[]>();
        result.set(sections[0], tasks);
        return result;
      }
    }

    /**
     * 템플릿의 특정 ### 서브섹션 내 빈 체크박스(- [ ] ) 자리에 태스크 주입
     */
    private injectTasksIntoSubSection(
      content: string,
      sectionName: string,
      tasks: string[]
    ): string {
      const lines = content.split("\n");
      const result: string[] = [];
      let found = false;
      let injected = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // ### 서브섹션 헤더 매칭
        if (!injected && line.match(new RegExp("^###\\s+" + sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))) {
          found = true;
          result.push(line);
          continue;
        }
        // 해당 섹션 내 빈 체크박스를 찾으면 태스크로 교체
        if (found && !injected && /^\s*- \[ \]\s*$/.test(line)) {
          // 들여쓰기 레벨 유지
          for (const task of tasks) {
            result.push(task);
          }
          injected = true;
          continue;
        }
        // 다음 ### 또는 ## 섹션이 나오면 해당 섹션 종료
        if (found && !injected && /^#{2,3}\s+/.test(line)) {
          // 섹션 끝까지 빈 체크박스를 못 찾았으면 헤더 앞에 삽입
          for (const task of tasks) {
            result.push(task);
          }
          injected = true;
        }
        result.push(line);
      }

      // 끝까지 못 찾았으면 마지막에 추가
      if (found && !injected) {
        for (const task of tasks) {
          result.push(task);
        }
      }

      return result.join("\n");
    }

    /**
     * 이전 투두의 메모 섹션에서 날짜가 포함된 항목 추출
     * 날짜가 오늘 이후(오늘 포함)인 항목만 반환
     */
    private async getDatedNotesFromPrevTodo(
      todoFolder: string,
      today: Date
    ): Promise<Array<{ date: string; text: string; time: string | null; raw: string }>> {
      const folder = this.app.vault.getAbstractFileByPath(todoFolder);
      if (!folder) return [];

      const children = (folder as any).children || [];
      const dated: { file: TFile; date: Date }[] = [];
      for (const child of children) {
        if (!(child instanceof TFile) || child.extension !== "md") continue;
        const match = child.basename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) continue;
        const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (d < today) dated.push({ file: child, date: d });
      }
      if (dated.length === 0) return [];

      dated.sort((a, b) => b.date.getTime() - a.date.getTime());
      const latest = dated[0].file;
      const content = await this.app.vault.cachedRead(latest);

      const results: Array<{ date: string; text: string; time: string | null; raw: string }> = [];
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      console.log("[ToDo] 메모 승계 - 이전 파일:", latest.basename, "오늘:", todayStr);

      const lines = content.split("\n");
      let inMemo = false;

      for (const line of lines) {
        if (/^##\s+.*(?:메모|노트|notes|memo)/i.test(line)) {
          inMemo = true;
          continue;
        }
        if (inMemo && /^##\s+/.test(line) && !/^###/.test(line)) break;

        if (inMemo) {
          const parsed = this.parseDateFromNoteLine(line, today);
          if (parsed) {
            // 오늘 이후(오늘 포함)만 승계
            if (parsed.dateStr >= todayStr) {
              results.push({ date: parsed.dateStr, text: parsed.text, time: parsed.time, raw: line });
            } else {
              console.log("[ToDo] 메모 스킵 (과거):", parsed.dateStr, "<", todayStr);
            }
          }
        }
      }
      return results;
    }

    /**
     * 메모 줄에서 다양한 날짜 형식을 파싱
     * 지원 형식: 2026-03-01, 03/01, 3/1, 3월 1일, 3/3(화)
     */
    private parseDateFromNoteLine(
      line: string,
      refDate: Date
    ): { dateStr: string; text: string; time: string | null } | null {
      // 리스트 항목이 아니면 스킵
      if (!/^-\s+/.test(line)) return null;
      const content = line.replace(/^-\s+/, "");

      const year = refDate.getFullYear();

      // 줄 전체에서 날짜 패턴을 탐색 (이모지, 볼드, 기호 등 무시)
      // 마크다운 서식 제거: **, *, 📌 등
      const cleaned = content.replace(/\*\*/g, "").replace(/\*/g, "").trim();

      let month = 0;
      let day = 0;
      let dateYear = year;
      let timeStr: string | null = null;
      let textPart = "";

      // 1) YYYY-MM-DD
      const m1 = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      // 2) M/D 또는 MM/DD (요일 옵션)
      const m2 = !m1 ? cleaned.match(/(\d{1,2})\/(\d{1,2})(?:\([^\)]*\))?/) : null;
      // 3) N월 N일
      const m3 = (!m1 && !m2) ? cleaned.match(/(\d{1,2})월\s*(\d{1,2})일/) : null;

      if (m1) {
        dateYear = Number(m1[1]);
        month = Number(m1[2]);
        day = Number(m1[3]);
      } else if (m2) {
        month = Number(m2[1]);
        day = Number(m2[2]);
      } else if (m3) {
        month = Number(m3[1]);
        day = Number(m3[2]);
      } else {
        return null;
      }

      if (month < 1 || month > 12 || day < 1 || day > 31) return null;

      const dateStr = `${dateYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      // 시간 추출: HH:MM 패턴 (날짜 매치 이후 부분에서만)
      const datePattern = m1 || m2 || m3;
      let afterDateRaw = "";
      if (datePattern && datePattern.index !== undefined) {
        afterDateRaw = cleaned.substring(datePattern.index + datePattern[0].length).trim();
        // 요일 괄호 제거: (화), (월) 등
        afterDateRaw = afterDateRaw.replace(/^\([^\)]*\)\s*/, "").trim();
      }

      const timeMatchInAfter = afterDateRaw.match(/^(\d{1,2}:\d{2})/);
      if (timeMatchInAfter) {
        timeStr = timeMatchInAfter[1].replace(/^(\d):/, "0$1:");
      } else {
        const timeMatch2 = afterDateRaw.match(/^(\d{1,2})시/);
        if (timeMatch2) {
          timeStr = `${timeMatch2[1].padStart(2, "0")}:00`;
        }
      }

      // 텍스트 추출: 날짜/시간/부가설명 이후의 의미 있는 텍스트
      if (datePattern && datePattern.index !== undefined) {
        let afterDate = afterDateRaw;
        // 시간 패턴 제거 (HH:MM)
        afterDate = afterDate.replace(/^\d{1,2}:\d{2}/, "").trim();
        // N시 패턴 제거
        afterDate = afterDate.replace(/^\d{1,2}시/, "").trim();
        // "예정" 같은 부가 설명 제거
        afterDate = afterDate.replace(/^예정\s*/, "").trim();
        // 구분자 콜론/대시 제거
        afterDate = afterDate.replace(/^[:\-–—]\s*/, "").trim();
        textPart = afterDate;
      }

      if (!textPart) return null;

      return { dateStr, text: textPart, time: timeStr };
    }

    /**
     * 메모 섹션에 항목 주입
     */
    private injectNotesIntoMemoSection(content: string, notes: string[]): string {
      const lines = content.split("\n");
      const result: string[] = [];
      let inMemo = false;
      let injected = false;

      for (const line of lines) {
        if (/^##\s+.*(?:메모|노트|notes|memo)/i.test(line)) {
          inMemo = true;
          result.push(line);
          continue;
        }
        // 메모 섹션 내 빈 항목(- ) 또는 첫 번째 빈 줄에 주입
        if (inMemo && !injected && /^-\s*$/.test(line)) {
          for (const note of notes) {
            result.push(note);
          }
          injected = true;
          continue;
        }
        // 다음 ## 섹션이면 메모 종료, 아직 주입 안 했으면 여기서
        if (inMemo && !injected && /^##\s+/.test(line) && !/^###/.test(line)) {
          for (const note of notes) {
            result.push(note);
          }
          result.push("");
          injected = true;
        }
        result.push(line);
      }

      if (!injected) {
        for (const note of notes) {
          result.push(note);
        }
      }

      return result.join("\n");
    }



  // 기준 일수를 초과한 To-Do 파일을 아카이브 폴더로 이동
  private async archiveOldTodos(todoFolder: string, now: Date): Promise<void> {
    const archiveFolder = this.plugin.settings.todoArchiveFolder || "ToDo/Archive";
    const archiveDays = this.plugin.settings.todoArchiveDays || 7;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - archiveDays);
    cutoff.setHours(0, 0, 0, 0);

    // 아카이브 폴더가 없으면 생성
    if (!this.app.vault.getAbstractFileByPath(archiveFolder)) {
      await this.app.vault.createFolder(archiveFolder);
    }

    // To-Do 폴더 내 .md 파일 순회
    const folder = this.app.vault.getAbstractFileByPath(todoFolder);
    if (!folder) return;

    const filesToArchive: TFile[] = [];
    // children 속성으로 직접 접근 (TFolder)
    const children = (folder as any).children || [];
    for (const child of children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      // 파일명에서 날짜 파싱 (YYYY-MM-DD.md)
      const match = child.basename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) continue;
      const fileDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      if (fileDate < cutoff) {
        filesToArchive.push(child);
      }
    }

    if (filesToArchive.length === 0) return;

    for (const f of filesToArchive) {
      const dest = `${archiveFolder}/${f.name}`;
      // 이동 대상에 이미 같은 이름이 있으면 건너뜀
      if (this.app.vault.getAbstractFileByPath(dest)) continue;
      await this.app.vault.rename(f, dest);
    }

    new Notice(this.t.todoArchived(filesToArchive.length));
  }

  // 현재 노트에 AI 기반 태그 자동 생성
  private async generateTags(): Promise<void> {
    // 현재 열린 마크다운 노트 찾기
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    const sorted = markdownLeaves.sort(
      (a, b) => ((b as any).activeTime ?? 0) - ((a as any).activeTime ?? 0)
    );
    const leaf = sorted[0];
    if (!leaf) {
      new Notice(this.t.noOpenNote);
      return;
    }
    const view = leaf.view as MarkdownView;
    if (!view?.file) {
      new Notice(this.t.noOpenNote);
      return;
    }

    const file = view.file;
    const content = await this.app.vault.cachedRead(file);

    // 이미 태그가 있는지 확인
    const hasFrontmatter = content.startsWith("---");
    if (hasFrontmatter) {
      const endIdx = content.indexOf("---", 3);
      if (endIdx > 0) {
        const fm = content.substring(0, endIdx);
        if (fm.includes("tags:") || fm.includes("tag:")) {
          new Notice(this.t.tagsExist);
          return;
        }
      }
    }

    new Notice(this.t.generatingTags);

    try {
      // AI에게 태그 생성 요청 (도구 없이 간단한 텍스트 응답)
      const tagMessages: ConverseMessage[] = [
        {
          role: "user",
          content: [
            {
              text: this.t.tagPrompt(file.basename, content.slice(0, 4000)),
            },
          ],
        },
      ];

      const result = await this.plugin.bedrockClient.converse(tagMessages);
      const textBlock = result.contentBlocks.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        new Notice(this.t.tagsFailed);
        return;
      }

      // 응답에서 태그 파싱 (다양한 AI 응답 형식 대응)
      const rawTags = textBlock.text.trim();
      const tags = rawTags
        .split(/[,，、\n]+/)
        .map((t) => t.trim())
        // YAML 리스트 접두사 "- " 제거
        .map((t) => t.replace(/^-\s*/, ""))
        // "tags:" 헤더 라인 제거
        .map((t) => t.replace(/^tags:\s*/i, ""))
        // 백틱 제거
        .map((t) => t.replace(/`/g, ""))
        // # 접두사 제거
        .map((t) => t.replace(/^#+\s*/, ""))
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 3);

      if (tags.length === 0) {
        new Notice(this.t.tagsExtractFail);
        return;
      }

      // frontmatter에 tags 삽입
      const tagYaml = `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}`;
      let newContent: string;

      if (hasFrontmatter) {
        // 기존 frontmatter에 tags 추가
        const endIdx = content.indexOf("---", 3);
        const before = content.substring(0, endIdx).trimEnd();
        const after = content.substring(endIdx);
        newContent = `${before}\n${tagYaml}\n${after}`;
      } else {
        // frontmatter 새로 생성
        newContent = `---\n${tagYaml}\n---\n${content}`;
      }

      await this.app.vault.modify(file, newContent);
      new Notice(this.t.tagsAdded(tags.join(", ")));
    } catch (error) {
      console.error("Tag generation error:", error);
      new Notice(this.t.tagsError((error as Error).message));
    }
  }

  // 컨텍스트 사용량 링 업데이트
  private updateContextRing(): void {
      if (!this.contextRingEl || !this.contextLabelEl) return;

      // 모델별 컨텍스트 윈도우 크기 (토큰)
      const modelId = this.plugin.settings.chatModel;
      const contextWindow = 200000; // Claude 모델 기본 200K

      // 현재 사용 중인 토큰 추정
      let totalChars = 0;

      // 대화 히스토리
      for (const msg of this.messages) {
        totalChars += msg.content.length;
      }

      // 텍스트 첨부 파일
      for (const content of this.attachedFiles.values()) {
        totalChars += Math.min(content.length, 8000);
      }

      // 바이너리 첨부 파일 (이미지: ~765토큰, 문서: 바이트/3 추정)
      for (const [path, data] of this.attachedBinaryFiles) {
        const ext = path.split(".").pop()?.toLowerCase() || "";
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp"];
        if (imageExts.includes(ext)) {
          totalChars += 765 * CHARS_PER_TOKEN; // 이미지 토큰을 문자 수로 환산
        } else {
          totalChars += data.byteLength / 3; // 문서 바이트 기반 추정
        }
      }

      // 현재 입력
      totalChars += this.inputEl.value.length;

      // 시스템 프롬프트
      totalChars += this.plugin.settings.systemPrompt.length;

      // 대략적 토큰 추정 (CHARS_PER_TOKEN 상수 사용)
      const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
      const ratio = Math.min(estimatedTokens / contextWindow, 1);

      // SVG 링 업데이트 (선형 비율 사용 — 라벨 수치와 일치)
      const ringSize = 22;
      const strokeWidth = 2.5;
      const radius = (ringSize - strokeWidth) / 2;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference * (1 - ratio);
      this.contextRingEl.setAttribute("stroke-dashoffset", String(offset));

      // 색상 변경 (실제 비율 기준)
      if (ratio > 0.9) {
        this.contextRingEl.setAttribute("stroke", "var(--text-error)");
      } else if (ratio > 0.7) {
        this.contextRingEl.setAttribute("stroke", "var(--color-yellow)");
      } else {
        this.contextRingEl.setAttribute("stroke", "var(--ba-brand)");
      }

      // 라벨: 실제 토큰 수 (K 단위)
      const usedK = (estimatedTokens / 1000).toFixed(1);
      const totalK = (contextWindow / 1000).toFixed(0);
      this.contextLabelEl.setText(`${usedK}K`);
      this.contextLabelEl.parentElement?.setAttribute(
        "aria-label",
        this.t.contextLabel(usedK, totalK)
      );
    }

  refreshModelList(): void {
    this.cachedModels = [];
  }

  // 채팅 폰트 크기 적용
  applyFontSize(): void {
    const size = this.plugin.settings.chatFontSize || 14;
    if (this.messagesEl) this.messagesEl.style.fontSize = `${size}px`;
    if (this.inputEl) this.inputEl.style.fontSize = `${size}px`;
  }

  // 언어 변경 시 UI 전체 재빌드
  async rebuildUI(): Promise<void> {
    await this.onOpen();
  }

  // 웹 서치 토글
  private toggleWebSearch(): void {
    this.webSearchEnabled = !this.webSearchEnabled;
    if (this.webSearchBtn) {
      if (this.webSearchEnabled) {
        this.webSearchBtn.addClass("is-active");
      } else {
        this.webSearchBtn.removeClass("is-active");
      }
    }
  }

  // ============================================
  // 인덱싱
  // ============================================

  private async handleIndexVault(): Promise<void> {
        if (!this.plugin.indexer || this.plugin.indexer.isIndexing) return;

        const welcome = this.messagesEl.querySelector(".ba-welcome");
        if (welcome) welcome.remove();

        const progressEl = this.messagesEl.createDiv({ cls: "ba-index-progress" });
        const progressLabel = progressEl.createDiv({ cls: "ba-index-label" });
        const labelIcon = progressLabel.createSpan({ cls: "ba-index-label-icon" });
        setIcon(labelIcon, BRANDING.icon.id);
        const labelText = progressLabel.createSpan({ text: this.t.checkingChanges });
        const progressBarOuter = progressEl.createDiv({ cls: "ba-progress-bar-outer" });
        const progressBarInner = progressBarOuter.createDiv({ cls: "ba-progress-bar-inner" });
        const progressDetail = progressEl.createDiv({ cls: "ba-index-detail" });

        this.scrollToBottom();

        const result = await this.plugin.indexer.indexVault((current: number, total: number) => {
          const pct = Math.round((current / total) * 100);
          progressBarInner.style.width = `${pct}%`;
          labelText.setText(this.t.indexing(pct));
          progressDetail.setText(this.t.filesProgress(current, total));
          this.scrollToBottom();
        });

        // 결과에 따라 메시지 분기
        if (result.processed === 0 && result.errors.length === 0) {
          // 변경 파일 없음
          labelText.setText(this.t.allUpToDate);
          progressDetail.setText(this.t.totalIndexed(this.plugin.indexer.size));
          progressBarInner.style.width = "100%";
          progressBarInner.addClass("ba-progress-done");
        } else {
          // 변경 파일 처리됨
          labelText.setText(this.t.indexDone);
          const parts: string[] = [];
          if (result.processed > 0) parts.push(this.t.updated(result.processed));
          if (result.errors.length > 0) parts.push(this.t.failed(result.errors.length));
          parts.push(this.t.totalIndexedShort(this.plugin.indexer.size));
          progressDetail.setText(parts.join(" · "));
          progressBarInner.style.width = "100%";
          progressBarInner.addClass("ba-progress-done");
        }

        // 실패한 파일이 있으면 접을 수 있는 상세 목록 표시
        if (result && result.errors.length > 0) {
          const failSection = progressEl.createDiv({ cls: "ba-index-failures" });

          const failHeader = failSection.createDiv({ cls: "ba-fail-header" });
          const toggleIcon = failHeader.createSpan({ cls: "ba-fail-toggle-icon", text: "▶" });
          failHeader.createSpan({
            cls: "ba-fail-header-text",
            text: this.t.failHeader(result.errors.length),
          });

          const failList = failSection.createDiv({ cls: "ba-fail-list collapsed" });

          for (const failure of result.errors) {
            const item = failList.createDiv({ cls: "ba-fail-item" });
            item.createSpan({ cls: "ba-fail-path", text: failure.path });
            item.createSpan({ cls: "ba-fail-reason", text: failure.reason });
          }

          failHeader.addEventListener("click", () => {
            const isCollapsed = failList.hasClass("collapsed");
            if (isCollapsed) {
              failList.removeClass("collapsed");
              toggleIcon.setText("▼");
            } else {
              failList.addClass("collapsed");
              toggleIcon.setText("▶");
            }
            this.scrollToBottom();
          });
        }

        await this.plugin.saveIndex();
      }

  // ============================================
  // 유틸리티
  // ============================================

  // 마지막 어시스턴트 응답을 제거하고 다시 생성 (REQ-8)
  private async regenerateLastResponse(): Promise<void> {
    // 스트리밍 중에는 실행 불가
    if (this.isGenerating) return;

    // 마지막 어시스턴트 메시지를 히스토리에서 제거
    const trimmed = prepareRegeneration(this.messages);
    if (!trimmed) return;
    this.messages = trimmed;

    // 마지막 어시스턴트 메시지 DOM 요소 제거
    const assistantEls = this.messagesEl.querySelectorAll(".ba-message-assistant");
    if (assistantEls.length > 0) {
      assistantEls[assistantEls.length - 1].remove();
    }

    // 응답 재생성
    await this.generateResponse();
  }

  // 웹 페이지 요약 모달 열기
  private openWebClipper(): void {
    new WebClipperModal(this.app, this.plugin).open();
  }

  // 아카이브 비우기 모달 열기
  private openCleanArchiveModal(): void {
    new CleanArchiveModal(this.app, this.plugin, this.t).open();
  }

  // 회고 모달 열기
  private openRetrospectiveModal(): void {
    new RetrospectiveModal(this.app, this.plugin, this.t).open();
  }

  // 현재 대화를 마크다운 파일로 내보내기
  private async exportChat(): Promise<void> {
    // 내보낼 메시지가 없으면 알림
    if (this.messages.length === 0) {
      new Notice(this.t.exportEmpty);
      return;
    }

    // 메시지를 마크다운 포맷으로 변환
    const lines: string[] = [];
    for (const msg of this.messages) {
      const role = msg.role === "user" ? "User" : "Assistant";
      lines.push(`## ${role}\n${msg.content}\n\n---\n`);
    }
    const markdown = lines.join("\n");

    // 파일명 생성: Chat Export YYYY-MM-DD HH-mm.md
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fileName = `Chat Export ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}.md`;

    // 볼트 루트에 저장
    try {
      await this.app.vault.create(fileName, markdown);
      new Notice(this.t.exportSuccess(fileName));
    } catch (e) {
      // 동일 파일명이 이미 존재하는 경우 등 에러 처리
      new Notice(this.t.error(String(e)));
    }
  }

  private clearChat(): void {
          this.messages = [];
          this.messagesEl.empty();
          this.renderWelcome();
          // 저장된 히스토리도 삭제
          this.plugin.saveChatHistory([]);
          // 모든 첨부 파일 상태 초기화
          this.attachedFiles.clear();
          this.manuallyAttachedPaths.clear();
          this.autoAttachedPath = null;
          this.attachedBinaryFiles.clear();
          this.updateContextRing();
        }

  // 새 대화 시작 (현재 대화를 세션으로 저장 후 초기화)
  private async startNewChat(): Promise<void> {
    if (this.messages.length > 0) {
      await this.plugin.saveCurrentAsSession(this.messages);
    }
    this.clearChat();
  }

  // 지난 대화 목록 표시
  private async showSessionList(): Promise<void> {
    const sessions = await this.plugin.loadSessions();
    new SessionListModal(this.app, this.plugin, sessions, this.t, async (session) => {
      await this.loadSession(session);
    }).open();
  }

  // 세션 복원
  private async loadSession(session: ChatSession): Promise<void> {
    // 현재 대화가 있으면 먼저 저장
    if (this.messages.length > 0) {
      await this.plugin.saveCurrentAsSession(this.messages);
    }
    this.messages = [...session.messages];
    this.messagesEl.empty();
    this.attachedBinaryFiles.clear();
    for (const msg of this.messages) {
      if (msg.role === "user") {
        this.renderUserMessage(msg);
      } else {
        const msgEl = this.messagesEl.createDiv({ cls: "ba-message ba-message-assistant" });
        const contentEl = msgEl.createDiv({ cls: "ba-message-content" });
        await MarkdownRenderer.render(this.app, msg.content, contentEl, "", this);
      }
    }
    this.plugin.saveChatHistory(this.messages);
    this.scrollToBottom();
    this.updateContextRing();
  }


  private setGenerating(generating: boolean): void {
    this.isGenerating = generating;
    if (generating) {
      this.sendBtn.addClass("ba-disabled");
      this.stopBtn.addClass("visible");
    } else {
      this.sendBtn.removeClass("ba-disabled");
      this.stopBtn.removeClass("visible");
    }
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  // 저장된 대화 히스토리 복원
    private async restoreChatHistory(): Promise<void> {
      const history = await this.plugin.loadChatHistory();
      if (history.length > 0) {
        this.messages = history;
        // 마지막 어시스턴트 메시지 인덱스를 찾아 재생성 버튼 추가 대상 결정
        let lastAssistantIdx = -1;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === "assistant") {
            lastAssistantIdx = i;
            break;
          }
        }

        for (let i = 0; i < history.length; i++) {
          const msg = history[i];
          if (msg.role === "user") {
            this.renderUserMessage(msg);
          } else {
            // 어시스턴트 메시지는 마크다운 렌더링
            const msgEl = this.messagesEl.createDiv({ cls: "ba-message ba-message-assistant" });
            this.addAssistantLabel(msgEl);
            const contentEl = msgEl.createDiv({ cls: "ba-message-content" });
            await MarkdownRenderer.render(this.app, msg.content, contentEl, "", this);

            // 마지막 어시스턴트 메시지에 재생성 버튼 footer 추가
            if (i === lastAssistantIdx) {
              const footer = msgEl.createDiv({ cls: "ba-response-footer" });
              const regenBtn = footer.createEl("button", {
                cls: "ba-regenerate-btn",
                attr: { "aria-label": this.t.regenerate },
              });
              setIcon(regenBtn, "refresh-cw");
              regenBtn.createSpan({ text: this.t.regenerate });
              regenBtn.addEventListener("click", () => {
                if (!this.isGenerating) {
                  this.regenerateLastResponse();
                }
              });
            }
          }
        }
        this.scrollToBottom();
      } else {
        this.renderWelcome();
      }
    }

    // 대화 히스토리 저장
    private persistHistory(): void {
          this.plugin.saveChatHistory(this.messages);
          this.updateContextRing();
        }

    async onClose(): Promise<void> {
      this.handleStop();
      this.persistHistory();
      // 드롭다운 이벤트 리스너 정리 (document 레벨 리스너 누수 방지)
      this.closeModelDropdown();
    }

}



// 지난 대화 세션 목록 모달
class SessionListModal extends Modal {
  private plugin: BedrockAssistantPlugin;
  private sessions: ChatSession[];
  private t: ViewLang;
  private onSelect: (session: ChatSession) => void;
  private listEl: HTMLDivElement | null = null;

  constructor(
    app: import("obsidian").App,
    plugin: BedrockAssistantPlugin,
    sessions: ChatSession[],
    t: ViewLang,
    onSelect: (session: ChatSession) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.sessions = sessions;
    this.t = t;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.t.chatHistory });

    // 검색 입력 필드 추가
    const searchContainer = contentEl.createDiv({ cls: "ba-session-search" });
    const searchInput = searchContainer.createEl("input", {
      type: "text",
      placeholder: this.t.sessionSearch,
      cls: "ba-session-search-input",
    });

    // 세션 목록 컨테이너
    this.listEl = contentEl.createDiv({ cls: "ba-session-list" });

    // 초기 렌더링 (전체 세션)
    this.renderFilteredSessions("");

    // 실시간 필터링 (keyup 이벤트)
    searchInput.addEventListener("keyup", () => {
      this.renderFilteredSessions(searchInput.value);
    });

    // 모달 열릴 때 검색 입력에 포커스
    searchInput.focus();
  }

  /** 검색어로 필터링된 세션 목록을 렌더링 */
  private renderFilteredSessions(query: string): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const results = filterSessions(this.sessions, query);

    if (results.length === 0) {
      const msg = query.trim()
        ? this.t.sessionSearchNoResults
        : this.t.noSessions;
      this.listEl.createEl("p", { text: msg, cls: "setting-item-description" });
      return;
    }

    for (const result of results) {
      const session = result.session;
      const row = this.listEl.createDiv({ cls: "ba-session-row" });

      // 세션 정보 (클릭하면 복원)
      const infoEl = row.createDiv({ cls: "ba-session-info" });

      // 하이라이트된 제목 (innerHTML 사용)
      const titleEl = infoEl.createDiv({ cls: "ba-session-title" });
      titleEl.innerHTML = result.highlightedTitle;

      // 날짜 정보
      const date = new Date(session.updatedAt);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      infoEl.createDiv({
        cls: "ba-session-date",
        text: `${this.t.sessionDate(dateStr)} · ${session.messages.length} messages`,
      });

      // 검색어가 있고 첫 메시지에서 매칭된 경우 미리보기 표시
      if (query.trim() && result.highlightedPreview) {
        const previewEl = infoEl.createDiv({ cls: "ba-session-preview" });
        previewEl.innerHTML = result.highlightedPreview;
      }

      infoEl.addEventListener("click", () => {
        this.onSelect(session);
        this.close();
      });

      // 삭제 버튼
      const delBtn = row.createDiv({ cls: "ba-session-delete", attr: { "aria-label": this.t.deleteSession } });
      setIcon(delBtn, "trash-2");
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        this.sessions = this.sessions.filter((s) => s.id !== session.id);
        await this.plugin.saveSessions(this.sessions);
        row.remove();
        if (this.sessions.length === 0) {
          this.listEl?.empty();
          this.listEl?.createEl("p", { text: this.t.noSessions, cls: "setting-item-description" });
        }
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


// 볼트 파일 검색 모달
class FileSearchModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: import("obsidian").App, onChoose: (file: TFile) => void, placeholder?: string) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder(placeholder || "Search for a note...");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.onChoose(item);
  }
}

// 파괴적 도구 실행 전 사용자 확인 모달
// 파괴적 도구 실행 전 사용자 확인 모달
class ToolConfirmModal extends Modal {
  private toolName: string;
  private toolInput: Record<string, unknown>;
  private t: ViewLang;
  private resolvePromise: (approved: boolean) => void;
  private plugin: BedrockAssistantPlugin;
  private resolved = false;

  constructor(
    app: import("obsidian").App,
    toolName: string,
    toolInput: Record<string, unknown>,
    t: ViewLang,
    plugin: BedrockAssistantPlugin,
    resolvePromise: (approved: boolean) => void
  ) {
    super(app);
    this.toolName = toolName;
    this.toolInput = toolInput;
    this.t = t;
    this.plugin = plugin;
    this.resolvePromise = resolvePromise;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ba-tool-confirm-modal");

    // 헤더 (아이콘 + 제목)
    const header = contentEl.createDiv({ cls: "ba-tool-confirm-header" });
    const headerIcon = header.createDiv({ cls: "ba-tool-confirm-header-icon" });
    setIcon(headerIcon, "alert-triangle");
    header.createEl("h3", { text: this.t.toolConfirmTitle });

    // 도구 이름 안내 메시지
    contentEl.createEl("p", {
      text: this.t.toolConfirmMessage(this.toolName),
      cls: "ba-tool-confirm-message",
    });

    // 파라미터 표시
    contentEl.createEl("p", {
      text: this.t.toolConfirmParams,
      cls: "ba-tool-confirm-params-label",
    });
    const paramsEl = contentEl.createEl("pre", { cls: "ba-tool-confirm-params" });
    paramsEl.setText(JSON.stringify(this.toolInput, null, 2));

    // "다음부터 묻지 않기" 체크박스
    const checkRow = contentEl.createDiv({ cls: "ba-tool-confirm-check-row" });
    const checkbox = checkRow.createEl("input", {
      type: "checkbox",
      cls: "ba-tool-confirm-checkbox",
    });
    checkbox.id = "ba-tool-confirm-dont-ask";
    checkRow.createEl("label", {
      text: this.t.toolConfirmDontAsk,
      attr: { for: "ba-tool-confirm-dont-ask" },
      cls: "ba-tool-confirm-check-label",
    });

    // 버튼 행
    const btnRow = contentEl.createDiv({ cls: "ba-tool-confirm-btn-row" });

    // 거부 버튼 (왼쪽)
    const denyBtn = btnRow.createEl("button", {
      text: this.t.toolConfirmDeny,
    });
    denyBtn.addEventListener("click", () => {
      this.handleDontAsk(checkbox.checked);
      this.resolved = true;
      this.resolvePromise(false);
      this.close();
    });

    // 실행 버튼 (오른쪽, 강조)
    const approveBtn = btnRow.createEl("button", {
      text: this.t.toolConfirmApprove,
      cls: "mod-cta",
    });
    approveBtn.addEventListener("click", () => {
      this.handleDontAsk(checkbox.checked);
      this.resolved = true;
      this.resolvePromise(true);
      this.close();
    });
  }

  // "다음부터 묻지 않기" 체크 시 설정 저장
  private handleDontAsk(checked: boolean): void {
    if (checked) {
      this.plugin.settings.confirmToolExecution = false;
      this.plugin.saveSettings();
    }
  }

  onClose(): void {
    // 모달이 닫힐 때 아직 resolve되지 않았으면 거부로 처리
    if (!this.resolved) {
      this.resolvePromise(false);
    }
    this.contentEl.empty();
  }
}

// 아카이브 비우기 모달
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class CleanArchiveModal extends Modal {
  private plugin: BedrockAssistantPlugin;
  private t: Record<string, any>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(app: import("obsidian").App, plugin: BedrockAssistantPlugin, t: Record<string, any>) {
    super(app);
    this.plugin = plugin;
    this.t = t;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("ba-clean-archive-modal");
    contentEl.createEl("h2", { text: this.t.cleanArchiveTitle });

    const archiveFolder = this.plugin.settings.archiveCleanFolder;
    const archiveDays = this.plugin.settings.archiveCleanDays;
    const now = Date.now();
    const cutoff = now - archiveDays * 24 * 60 * 60 * 1000;

    // 아카이브 폴더에서 하위 폴더 포함 재귀 탐색, 생성일(ctime) 기준 n일 이전 파일 수집
    const folder = this.app.vault.getAbstractFileByPath(archiveFolder);
    const oldFiles: TFile[] = [];
    const collectFiles = (parent: any) => {
      if (!parent || !("children" in parent)) return;
      for (const child of parent.children) {
        if (child instanceof TFile && child.stat.ctime < cutoff) {
          oldFiles.push(child);
        } else if ("children" in child) {
          collectFiles(child);
        }
      }
    };
    collectFiles(folder);

    if (oldFiles.length === 0) {
      contentEl.createEl("p", { text: this.t.cleanArchiveEmpty, cls: "ba-clean-archive-empty" });
      const btnRow = contentEl.createDiv({ cls: "ba-clean-archive-btn-row" });
      const closeBtn = btnRow.createEl("button", { text: this.t.cleanArchiveCancel });
      closeBtn.addEventListener("click", () => this.close());
      return;
    }

    // 체크박스 리스트
    const checkboxes: { file: TFile; checkbox: HTMLInputElement }[] = [];

    // 전체 선택 토글
    const selectAllRow = contentEl.createDiv({ cls: "ba-clean-archive-select-all" });
    const selectAllCb = selectAllRow.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    selectAllCb.checked = true;
    selectAllRow.createSpan({ text: this.t.cleanArchiveSelectAll });
    selectAllCb.addEventListener("change", () => {
      for (const item of checkboxes) {
        item.checkbox.checked = selectAllCb.checked;
      }
    });

    const listEl = contentEl.createDiv({ cls: "ba-clean-archive-list" });
    // 생성일 오래된 순으로 정렬
    oldFiles.sort((a, b) => a.stat.ctime - b.stat.ctime);

    for (const file of oldFiles) {
      const row = listEl.createDiv({ cls: "ba-clean-archive-item" });
      const cb = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = true;
      const dateStr = new Date(file.stat.ctime).toLocaleDateString();
      row.createSpan({ text: file.path.replace(archiveFolder + "/", ""), cls: "ba-clean-archive-name" });
      row.createSpan({ text: dateStr, cls: "ba-clean-archive-date" });
      checkboxes.push({ file, checkbox: cb });
    }

    // 버튼 영역
    const btnRow = contentEl.createDiv({ cls: "ba-clean-archive-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: this.t.cleanArchiveCancel });
    cancelBtn.addEventListener("click", () => this.close());

    const deleteBtn = btnRow.createEl("button", {
      text: this.t.cleanArchiveDelete,
      cls: "mod-warning",
    });
    deleteBtn.addEventListener("click", async () => {
      const toDelete = checkboxes.filter((c) => c.checkbox.checked).map((c) => c.file);
      if (toDelete.length === 0) {
        this.close();
        return;
      }
      // 선택된 파일 삭제
      for (const file of toDelete) {
        await this.app.vault.delete(file);
      }
      // 빈 하위 폴더 정리 (깊은 폴더부터 삭제)
      const removeEmptyFolders = (parent: any) => {
        if (!parent || !("children" in parent)) return;
        // 하위 폴더 먼저 재귀 처리
        for (const child of [...parent.children]) {
          if ("children" in child) {
            removeEmptyFolders(child);
          }
        }
        // 루트 아카이브 폴더는 유지, 하위 빈 폴더만 삭제
        if (parent.children.length === 0 && parent.path !== archiveFolder) {
          this.app.vault.delete(parent);
        }
      };
      const rootFolder = this.app.vault.getAbstractFileByPath(archiveFolder);
      removeEmptyFolders(rootFolder);

      new Notice(this.t.cleanArchiveDeleted(toDelete.length));
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


// 회고 모달
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class RetrospectiveModal extends Modal {
  private plugin: BedrockAssistantPlugin;
  private t: Record<string, any>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(app: import("obsidian").App, plugin: BedrockAssistantPlugin, t: Record<string, any>) {
    super(app);
    this.plugin = plugin;
    this.t = t;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    // 모달 컨테이너에 클래스 추가 (사이즈 제어)
    this.modalEl.addClass("ba-retro-modal");
    contentEl.addClass("ba-retro-content");

    // 오늘자 To-Do 파일 존재 확인
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const todoFolder = this.plugin.settings.todoFolder || "ToDo";
    const todoPath = `${todoFolder}/${dateStr}.md`;
    const todoFile = this.app.vault.getAbstractFileByPath(todoPath);

    if (!todoFile || !(todoFile instanceof TFile)) {
      // 오늘자 문서 없음 경고
      contentEl.createEl("h2", { text: this.t.retroConfirmTitle });
      contentEl.createEl("p", { text: this.t.retroNoTodo, cls: "ba-retro-warning" });
      const btnRow = contentEl.createDiv({ cls: "ba-retro-btn-row" });
      const okBtn = btnRow.createEl("button", { text: this.t.retroOk, cls: "mod-cta" });
      okBtn.addEventListener("click", () => this.close());
      return;
    }

    // 할 일 완료 여부 확인 모달
    contentEl.createEl("h2", { text: this.t.retroConfirmTitle });
    contentEl.createEl("p", { text: this.t.retroConfirmMessage, cls: "ba-retro-message" });

    const btnRow = contentEl.createDiv({ cls: "ba-retro-btn-row" });
    const notYetBtn = btnRow.createEl("button", { text: this.t.retroNotYet });
    notYetBtn.addEventListener("click", () => this.close());

    const doneBtn = btnRow.createEl("button", { text: this.t.retroDone, cls: "mod-cta" });
    doneBtn.addEventListener("click", async () => {
      contentEl.empty();
      contentEl.createEl("h2", { text: this.t.retroConfirmTitle });
      contentEl.createEl("p", { text: this.t.retroGenerating, cls: "ba-retro-message" });

      try {
        await this.generateRetrospective(todoFile as TFile, dateStr);
        new Notice(this.t.retroComplete);
      } catch (error) {
        new Notice(this.t.retroFailed((error as Error).message));
      }
      this.close();
    });
  }

  // 회고 생성 및 To-Do 문서에 추가
  private async generateRetrospective(todoFile: TFile, dateStr: string): Promise<void> {
    const todoContent = await this.app.vault.read(todoFile);

    // 오늘 생성된 파일 수집 (To-Do 파일, 아카이브 비우기 대상 폴더 제외)
    const todoFolder = this.plugin.settings.todoFolder || "ToDo";
    const archiveCleanFolder = this.plugin.settings.archiveCleanFolder || "ToDo/Archive";
    const allFiles = this.app.vault.getFiles();
    const todayStart = new Date(dateStr + "T00:00:00").getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;

    const todayFiles: { path: string; content: string }[] = [];
    for (const file of allFiles) {
      // 생성일이 오늘인 파일만
      if (file.stat.ctime < todayStart || file.stat.ctime >= todayEnd) continue;
      // To-Do 파일 자체 제외
      if (file.path === todoFile.path) continue;
      // 아카이브 비우기 대상 폴더 제외
      if (file.path.startsWith(archiveCleanFolder + "/")) continue;
      // 마크다운 파일만
      if (file.extension !== "md") continue;

      try {
        const content = await this.app.vault.cachedRead(file);
        // 너무 긴 파일은 앞부분만
        todayFiles.push({
          path: file.path,
          content: content.length > 2000 ? content.substring(0, 2000) + "..." : content,
        });
      } catch {
        // 읽기 실패 시 건너뜀
      }
    }

    // AI로 회고 생성
    const lang = this.plugin.settings.language;
    const langLabel = lang === "ko" ? "한국어" : lang === "ja" ? "日本語" : "English";

    const filesContext = todayFiles.length > 0
      ? todayFiles.map((f) => `### ${f.path}\n${f.content}`).join("\n\n")
      : "(No additional files created today)";

    const prompt = `You are a daily retrospective assistant. Analyze the following To-Do document and today's created files, then write a retrospective summary.

Language: Write in ${langLabel}.

## Today's To-Do
${todoContent}

## Files Created Today (${todayFiles.length} files)
${filesContext}

## Instructions
- Summarize what was accomplished today based on the To-Do items and created files
- Note any incomplete tasks and possible reasons
- Provide brief insights or suggestions for improvement
- Keep it concise (under 300 words)
- Use markdown format with a ## heading
- The heading should be "${lang === "ko" ? "📝 오늘의 회고" : lang === "ja" ? "📝 今日の振り返り" : "📝 Daily Retrospective"}"`;

    const { BedrockClient } = await import("./bedrock-client");
    const client = new BedrockClient(this.plugin.settings);
    const result = await client.converseLight(prompt, "You are a helpful retrospective assistant. Write in markdown format.", 2048);

    // To-Do 문서 끝에 회고 추가
    const updatedContent = todoContent.trimEnd() + "\n\n" + result.text.trim() + "\n";
    await this.app.vault.modify(todoFile, updatedContent);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
