import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon, MarkdownView, TFile, FuzzySuggestModal, Notice, Modal } from "obsidian";
import type BedrockAssistantPlugin from "./main";
import { KIRO_ICON_ID } from "./main";
import type { ChatMessage, ConverseMessage, ContentBlock, ContentBlockToolUse, ModelInfo, ChatSession } from "./types";
import { TOOLS } from "./obsidian-tools";

export const VIEW_TYPE = "assistant-kiro-view";

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
    searchPlaceholder: "Search for a note to attach...",
    unsupportedExt: (ext: string) => `Unsupported file format: .${ext}`,
    webSearchHint: "[Web search enabled: Search the web for up-to-date information when needed. Include source URLs.]",
    contextLabel: (used: string, total: string) => `Context: ~${used}K / ${total}K tokens`,
    toolError: (e: string) => `Tool execution error: ${e}`,
    attachedFileLabel: (path: string) => `[Attached file: ${path}]`,
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
    searchPlaceholder: "첨부할 노트를 검색하세요...",
    unsupportedExt: (ext: string) => `지원하지 않는 파일 형식입니다: .${ext}`,
    webSearchHint: "[웹 서치 활성화됨: 필요한 경우 최신 정보를 웹에서 검색하여 답변에 포함하세요. 출처 URL을 함께 제공하세요.]",
    contextLabel: (used: string, total: string) => `컨텍스트: ~${used}K / ${total}K 토큰`,
    toolError: (e: string) => `도구 실행 오류: ${e}`,
    attachedFileLabel: (path: string) => `[첨부 파일: ${path}]`,
    tagPrompt: (title: string, content: string) => `다음 노트의 내용을 분석하여 적절한 태그 3개를 생성해주세요.
태그만 쉼표로 구분하여 한 줄로 출력하세요. 다른 설명은 불필요합니다.
태그는 한국어 또는 영어로, 노트 내용에 맞게 작성하세요.
예시: 프로젝트관리, AI, 회의록

---
제목: ${title}

${content}`,
  },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViewLang = Record<string, any>;

// Claudian 스타일 사이드바 채팅 뷰
export class ChatView extends ItemView {
  private plugin: BedrockAssistantPlugin;
  private messages: ChatMessage[] = [];

  // DOM 요소
  private viewContainerEl: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLElement;
  private stopBtn: HTMLElement;
  private contextRow: HTMLElement;
  private fileChipContainer: HTMLElement;
  private isGenerating = false;
  private abortController: AbortController | null = null;

  // 첨부된 파일 컨텍스트
  private attachedFiles: Map<string, string> = new Map(); // path → content (텍스트 파일)
  private attachedBinaryFiles: Map<string, ArrayBuffer> = new Map(); // path → binary data
  private manuallyAttachedPaths: Set<string> = new Set(); // 수동 첨부 경로 (문서 이동 시 유지)
  private autoAttachedPath: string | null = null; // 자동 첨부 경로 (문서 이동 시 교체)

  // 모델 선택
  private modelSelectorEl: HTMLElement;
  private modelLabelEl: HTMLElement;
  private cachedModels: ModelInfo[] = [];
  private modelDropdownEl: HTMLElement | null = null;

  // MCP 상태 표시
  private mcpStatusEl: HTMLElement;

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
    return "Bedrock Assistant";
  }

  getIcon(): string {
    return KIRO_ICON_ID;
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
    setIcon(titleIcon, KIRO_ICON_ID);
    titleSlot.createEl("h4", { text: "Assistant Kiro", cls: "ba-title-text" });

    // 액션 버튼들
    const actions = header.createDiv({ cls: "ba-header-actions" });

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
    const tagBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.generateTags } });
    setIcon(tagBtn, "tag");
    tagBtn.createSpan({ cls: "ba-action-btn-label", text: this.t.generateTags });
    tagBtn.addEventListener("click", () => this.generateTags());

    // To-Do 생성 버튼
    const todoBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.createTodo } });
    setIcon(todoBtn, "check-square");
    todoBtn.createSpan({ cls: "ba-action-btn-label", text: this.t.createTodo });
    todoBtn.addEventListener("click", () => this.createTodoNote());

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

    // 첨부 파일 컨텍스트가 있으면 내부적으로 주입
    const contextPrefix = this.buildContextPrefix();
    if (contextPrefix) {
      // 실제 API에 보내는 메시지에만 컨텍스트 추가 (UI에는 원본 표시)
      const lastMsg = this.messages[this.messages.length - 1];
      lastMsg.content = contextPrefix + text;
    }

    // AI 응답 생성
    await this.generateResponse();
  }

  private handleStop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ============================================
  // 응답 생성 (도구 사용 루프 포함)
  // ============================================

  private async generateResponse(): Promise<void> {
      this.setGenerating(true);
      this.abortController = new AbortController();
      const startTime = Date.now();

      // 어시스턴트 메시지 컨테이너
      const msgEl = this.messagesEl.createDiv({ cls: "ba-message ba-message-assistant" });
      const contentEl = msgEl.createDiv({ cls: "ba-message-content" });
      const thinkingEl = contentEl.createSpan({ cls: "ba-thinking", text: this.t.thinking });
      this.scrollToBottom();

      // Converse API용 메시지 히스토리 구성
      const converseMessages: ConverseMessage[] = this.messages.map((m) => ({
        role: m.role,
        content: [{ text: m.content }],
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
      let fullText = "";

      // 옵시디언 내장 도구 + MCP 도구 합치기
      const allTools = [...TOOLS, ...this.plugin.mcpManager.getAllTools()];

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (this.abortController?.signal.aborted) break;

          // 텍스트 스트리밍 렌더링용
          let roundText = "";

          const result = await this.plugin.bedrockClient.converse(
            converseMessages,
            allTools,
            (delta) => {
              // 텍스트 델타 실시간 렌더링
              if (this.abortController?.signal.aborted) return;
              if (thinkingEl.parentElement) thinkingEl.remove();
              roundText += delta;
              fullText += delta;
              contentEl.empty();
              MarkdownRenderer.render(this.app, fullText, contentEl, "", this);
              this.scrollToBottom();
            },
            this.abortController.signal
          );

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
            toolResultContents.push({
              toolResult: {
                toolUseId: toolBlock.toolUseId,
                content: [{ text: toolResult }],
              },
            });
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

      this.scrollToBottom();

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
      if (file.extension !== "md") return;

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
        content = this.injectCarryOverTasks(content, carryOver);
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
    // 미완료 체크박스 항목 추출 (- [ ] 로 시작하는 줄)
    const lines = content.split("\n");
    const unfinished: string[] = [];
    for (const line of lines) {
      if (/^\s*- \[ \]\s+.+/.test(line)) {
        unfinished.push(line);
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

      // 응답에서 태그 파싱
      const rawTags = textBlock.text.trim();
      const tags = rawTags
        .split(/[,，、\n]+/)
        .map((t) => t.trim().replace(/^#/, ""))
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
          totalChars += 765 * 2.5; // 이미지 토큰을 문자 수로 환산
        } else {
          totalChars += data.byteLength / 3; // 문서 바이트 기반 추정
        }
      }

      // 현재 입력
      totalChars += this.inputEl.value.length;

      // 시스템 프롬프트
      totalChars += this.plugin.settings.systemPrompt.length;

      // 대략적 토큰 추정 (한국어 혼합 기준 약 2.5자/토큰)
      const estimatedTokens = Math.ceil(totalChars / 2.5);
      const ratio = Math.min(estimatedTokens / contextWindow, 1);

      // 시각적 비율: 로그 스케일 적용 (적은 사용량에서도 링이 채워지도록)
      // 0 토큰 → 0, 1K → ~0.15, 10K → ~0.30, 100K → ~0.60, 1M → 1.0
      const logMax = Math.log10(contextWindow);
      const visualRatio = estimatedTokens > 0
        ? Math.min(Math.log10(Math.max(estimatedTokens, 1)) / logMax, 1)
        : 0;

      // SVG 링 업데이트
      const ringSize = 22;
      const strokeWidth = 2.5;
      const radius = (ringSize - strokeWidth) / 2;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference * (1 - visualRatio);
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
        setIcon(labelIcon, KIRO_ICON_ID);
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

  private clearChat(): void {
          this.messages = [];
          this.messagesEl.empty();
          this.renderWelcome();
          // 저장된 히스토리도 삭제
          this.plugin.saveChatHistory([]);
          // 바이너리 첨부 파일도 초기화
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
        for (const msg of history) {
          if (msg.role === "user") {
            this.renderUserMessage(msg);
          } else {
            // 어시스턴트 메시지는 마크다운 렌더링
            const msgEl = this.messagesEl.createDiv({ cls: "ba-message ba-message-assistant" });
            const contentEl = msgEl.createDiv({ cls: "ba-message-content" });
            await MarkdownRenderer.render(this.app, msg.content, contentEl, "", this);
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
    }

}



// 지난 대화 세션 목록 모달
class SessionListModal extends Modal {
  private plugin: BedrockAssistantPlugin;
  private sessions: ChatSession[];
  private t: ViewLang;
  private onSelect: (session: ChatSession) => void;

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

    if (this.sessions.length === 0) {
      contentEl.createEl("p", { text: this.t.noSessions, cls: "setting-item-description" });
      return;
    }

    const listEl = contentEl.createDiv({ cls: "ba-session-list" });
    for (const session of this.sessions) {
      const row = listEl.createDiv({ cls: "ba-session-row" });

      // 세션 정보 (클릭하면 복원)
      const infoEl = row.createDiv({ cls: "ba-session-info" });
      infoEl.createDiv({ cls: "ba-session-title", text: session.title });
      const date = new Date(session.updatedAt);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      infoEl.createDiv({
        cls: "ba-session-date",
        text: `${this.t.sessionDate(dateStr)} · ${session.messages.length} messages`,
      });
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
          listEl.remove();
          contentEl.createEl("p", { text: this.t.noSessions, cls: "setting-item-description" });
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




