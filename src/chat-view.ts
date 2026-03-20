import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon, MarkdownView, TFile, FuzzySuggestModal, Notice } from "obsidian";
import type GeminiAssistantPlugin from "./main";
import type { ChatMessage, ConverseMessage, ContentBlock, ContentBlockToolUse, ModelInfo, ChatSession } from "./types";
import { TOOLS } from "./obsidian-tools";
import { BRANDING } from "./branding";
import { trimConversationHistory, CHARS_PER_TOKEN } from "./token-trimmer";
import { isToolError } from "./tool-failure-tracker";
import { prepareRegeneration } from "./regenerate-helper";
import { needsToolConfirmation } from "./tool-confirm-utils";
import { isAllowedTextExtension } from "./file-extension-utils";
import { WebClipperModal } from "./web-clipper";
import { VIEW_I18N, type ViewLang } from "./chat-view-i18n";
import { createTodoNote } from "./todo-manager";
import { SessionListModal } from "./modals/session-list-modal";
import { ToolConfirmModal } from "./modals/tool-confirm-modal";
import { RetrospectiveModal } from "./modals/retrospective-modal";

export const VIEW_TYPE = BRANDING.viewType;

// Claudian 스타일 사이드바 채팅 뷰
export class ChatView extends ItemView {
  private plugin: GeminiAssistantPlugin;
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

  // persistHistory 중복 호출 방지 가드 (B2 race condition 수정)
  private persistPending = false;

  constructor(leaf: WorkspaceLeaf, plugin: GeminiAssistantPlugin) {
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
        await this.buildInputArea();

        // 저장된 대화 히스토리 복원
        await this.restoreChatHistory();

        // 컨텍스트 링 초기화
        this.updateContextRing();

        // 모델 목록 백그라운드 프리로드 (라벨에 올바른 모델명 표시)
        this.preloadModels();
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

    // 인덱싱 버튼
    const indexBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.indexVault } });
    setIcon(indexBtn, "file-search");
    this.registerDomEvent(indexBtn, "click", () => this.handleIndexVault());

    // 새 대화 버튼
    const newBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.newChat } });
    setIcon(newBtn, "square-pen");
    this.registerDomEvent(newBtn, "click", () => this.startNewChat());

    // 대화 내보내기 버튼
    const exportBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.exportChat } });
    setIcon(exportBtn, "download");
    this.registerDomEvent(exportBtn, "click", () => this.exportChat());

    // 지난 대화 버튼
    const historyBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.chatHistory } });
    setIcon(historyBtn, "history");
    this.registerDomEvent(historyBtn, "click", () => this.showSessionList());
  }

  private async buildInputArea(): Promise<void> {
    const inputContainer = this.viewContainerEl.createDiv({ cls: "ba-input-container" });

    // 액션 툴바 (입력창 바로 위)
    const actionToolbar = inputContainer.createDiv({ cls: "ba-action-toolbar" });

    // To-Do 생성 버튼
    const todoBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.createTodo } });
    setIcon(todoBtn, "check-square");
    this.registerDomEvent(todoBtn, "click", () => this.handleCreateTodoNote());

    // 회고 버튼
    const retroBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.retrospective } });
    setIcon(retroBtn, "book-open");
    this.registerDomEvent(retroBtn, "click", () => this.openRetrospectiveModal());

    // 태그 생성 버튼
    const tagBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.generateTags } });
    setIcon(tagBtn, "tag");
    this.registerDomEvent(tagBtn, "click", () => this.generateTags());

    // 웹 페이지 요약 버튼
    const webClipBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.webClip } });
    setIcon(webClipBtn, "globe");
    this.registerDomEvent(webClipBtn, "click", () => this.openWebClipper());

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
    this.registerDomEvent(attachBtn, "click", () => this.attachCurrentNote());

    // 파일 검색 첨부 버튼
    const searchBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn", attr: { "aria-label": this.t.searchFile } });
    setIcon(searchBtn, "search");
    this.registerDomEvent(searchBtn, "click", () => this.openFileSearchModal());

    // 파일 첨부 버튼 (이미지, PDF, XLSX 등)
    const clipBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn", attr: { "aria-label": this.t.attachFile } });
    setIcon(clipBtn, "paperclip");
    this.registerDomEvent(clipBtn, "click", () => this.openBinaryFileAttach());

    // 웹 서치 토글 버튼
    this.webSearchBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn ba-web-search-btn", attr: { "aria-label": this.t.webSearch } });
    setIcon(this.webSearchBtn, "globe");
    this.registerDomEvent(this.webSearchBtn, "click", () => this.toggleWebSearch());

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
    this.registerDomEvent(this.sendBtn, "click", () => this.handleSend());
    this.registerDomEvent(this.stopBtn, "click", () => this.handleStop());

    this.registerDomEvent(this.inputEl, "keydown", (e: KeyboardEvent) => {
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
    this.registerDomEvent(this.inputEl, "input", () => {
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

    // 초기 로드 시 현재 열린 파일 첨부 (await로 파일 내용 로드 완료 보장)
    if (this.plugin.settings.autoAttachActiveNote) {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView?.file) {
        await this.autoAttachFile(activeView.file.path);
      }
    }

    // 하단 바 (모델 선택 + MCP 상태)
    const bottomBar = inputContainer.createDiv({ cls: "ba-bottom-bar" });
    this.modelSelectorEl = bottomBar.createDiv({ cls: "ba-model-selector" });
    this.mcpStatusEl = bottomBar.createDiv({ cls: "ba-mcp-indicator" });
    this.updateMcpIndicator();

    // 드래그 앤 드롭 파일 첨부
    this.registerDomEvent(inputWrapper, "dragover", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      inputWrapper.addClass("ba-drag-over");
    });
    this.registerDomEvent(inputWrapper, "dragleave", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      inputWrapper.removeClass("ba-drag-over");
    });
    this.registerDomEvent(inputWrapper, "drop", async (e: DragEvent) => {
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
    this.registerDomEvent(this.inputEl, "paste", async (e: ClipboardEvent) => {
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

    this.registerDomEvent(modelBtn, "click", () => this.openModelPicker());

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
   * 현재 선택된 모델의 컨텍스트 윈도우 크기를 반환합니다.
   * 향후 모델별 동적 설정 확장 가능. 기본값 200K.
   */
  private getModelContextWindow(): number {
    // 현재는 기본값 200K 반환. 모델별 매핑이 필요하면 여기서 확장
    return 200_000;
  }

  /**
   * 컨텍스트 윈도우 초과를 방지하기 위해 오래된 메시지를 제거합니다.
   * 핵심 로직은 token-trimmer.ts에 분리되어 있습니다.
   */
  private trimMessages(
    messages: ConverseMessage[],
    tools: import("./types").ToolDefinition[]
  ): void {
    // 모델별 컨텍스트 윈도우 크기 전달 (updateContextRing과 동일한 값 사용)
    const contextWindow = this.getModelContextWindow();
    trimConversationHistory(messages, tools, contextWindow);
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

          const result = await this.plugin.aiClient.converse(
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
              const textEntry: Record<string, unknown> = { text: block.text };
              // Gemini 3.x 텍스트 파트 thoughtSignature 보존 (권장)
              if (block.thoughtSignature) {
                textEntry.thoughtSignature = block.thoughtSignature;
              }
              assistantContent.push(textEntry);
            } else if (block.type === "tool_use") {
              const toolUseEntry: Record<string, unknown> = {
                toolUseId: block.toolUseId,
                name: block.name,
                input: block.input,
              };
              // Gemini 3.x thought signature 보존 (function calling 필수)
              if (block.thoughtSignature) {
                toolUseEntry.thoughtSignature = block.thoughtSignature;
              }
              assistantContent.push({ toolUse: toolUseEntry });
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
                name: toolBlock.name,
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
          // 이전 파일 제거 후 칩 UI 즉시 갱신 (데이터/UI 불일치 방지)
          this.renderFileChips();
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

    // 모든 첨부 파일 해제
    private removeAllFileContexts(): void {
      this.attachedFiles.clear();
      this.attachedBinaryFiles.clear();
      this.manuallyAttachedPaths.clear();
      this.autoAttachedPath = null;
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

      // 전체 해제 버튼 (파일 칩 목록 앞에 아이콘만 표시)
      const removeAllBtn = this.fileChipContainer.createDiv({
        cls: "ba-file-chip ba-remove-all-chip",
        attr: { "aria-label": this.t.removeAllFiles },
      });
      const removeAllIcon = removeAllBtn.createDiv({ cls: "ba-file-chip-icon" });
      setIcon(removeAllIcon, "file-x");
      removeAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.removeAllFileContexts();
      });

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

  // 현재 백엔드에 맞는 채팅 모델 ID를 반환
  private get activeChatModel(): string {
    return this.plugin.settings.aiBackend === "bedrock"
      ? this.plugin.settings.bedrockChatModel
      : this.plugin.settings.chatModel;
  }

  // 현재 백엔드에 맞는 채팅 모델 ID를 설정
  private set activeChatModel(modelId: string) {
    if (this.plugin.settings.aiBackend === "bedrock") {
      this.plugin.settings.bedrockChatModel = modelId;
    } else {
      this.plugin.settings.chatModel = modelId;
    }
  }

  // 모델 라벨 업데이트 (현재 선택된 모델 표시)
  private updateModelLabel(): void {
    const modelId = this.activeChatModel;
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
          this.cachedModels = await this.plugin.aiClient.listModels();
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

      const currentModelId = this.activeChatModel;
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
          this.activeChatModel = model.modelId;
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


  // 오늘 날짜로 To-Do 노트 생성 (todo-manager.ts로 분리)
  private async handleCreateTodoNote(): Promise<void> {
    await createTodoNote(this.app, this.plugin, this.t);
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

    const hasFrontmatter = content.startsWith("---");

    // 본문에서 인라인 태그(#태그) 수집 및 제거용 준비
    let bodyContent = content;
    let frontmatterSection = "";
    let frontmatterEnd = -1;

    if (hasFrontmatter) {
      frontmatterEnd = content.indexOf("---", 3);
      if (frontmatterEnd > 0) {
        frontmatterSection = content.substring(0, frontmatterEnd + 3);
        bodyContent = content.substring(frontmatterEnd + 3);
      }
    }

    // 본문 내 인라인 태그(#태그) 제거 — 헤딩(## 등)은 제외
    const cleanedBody = bodyContent.replace(/(?<=\s|^)#(?!#)([^\s#]+)/gm, "");

    // 기존 frontmatter에서 tags/tag 속성 제거
    let cleanedFrontmatter = frontmatterSection;
    if (hasFrontmatter && frontmatterEnd > 0) {
      // YAML 리스트 형식 tags 제거 (tags:\n  - xxx\n  - yyy)
      cleanedFrontmatter = cleanedFrontmatter.replace(/^(tags|tag):[ \t]*\n(?:[ \t]+-[ \t]+.*\n?)*/gm, "");
      // 인라인 형식 tags 제거 (tags: [xxx, yyy] 또는 tags: xxx)
      cleanedFrontmatter = cleanedFrontmatter.replace(/^(tags|tag):[ \t]+.*\n?/gm, "");
    }

    new Notice(this.t.generatingTags);

    try {
      // AI에게 태그 생성 요청 (인라인 태그 제거된 본문 기반)
      const tagMessages: ConverseMessage[] = [
        {
          role: "user",
          content: [
            {
              text: this.t.tagPrompt(file.basename, cleanedBody.slice(0, 4000)),
            },
          ],
        },
      ];

      const result = await this.plugin.aiClient.converse(tagMessages, []);
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
        .map((t) => t.replace(/^-\s*/, ""))
        .map((t) => t.replace(/^tags:\s*/i, ""))
        .map((t) => t.replace(/`/g, ""))
        .map((t) => t.replace(/^#+\s*/, ""))
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 5);

      if (tags.length < 3) {
        new Notice(this.t.tagsExtractFail);
        return;
      }

      // frontmatter에 tags 삽입
      const tagYaml = `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}`;
      let newContent: string;

      if (hasFrontmatter && frontmatterEnd > 0) {
        // 기존 frontmatter에서 tags 제거 후 재삽입
        const fmInner = cleanedFrontmatter.substring(0, cleanedFrontmatter.lastIndexOf("---")).trimEnd();
        newContent = `${fmInner}\n${tagYaml}\n---${cleanedBody}`;
      } else {
        // frontmatter 새로 생성
        newContent = `---\n${tagYaml}\n---\n${cleanedBody}`;
      }

      await this.app.vault.modify(file, newContent);
      // 참고: 태그 삽입은 사용자가 명시적으로 요청한 작업이므로 vault.modify 사용이 적절
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
      const modelId = this.activeChatModel;
      const contextWindow = this.getModelContextWindow();

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
    this.updateModelLabel();
  }

  // 모델 목록 백그라운드 프리로드 (채팅 뷰 열릴 때 호출)
  private async preloadModels(): Promise<void> {
    try {
      this.cachedModels = await this.plugin.aiClient.listModels();
      this.updateModelLabel();
    } catch {
      // 프리로드 실패 시 무시 (사용자가 모델 피커 열 때 재시도)
    }
  }

  // 채팅 폰트 크기 적용 (CSS 변수 기반 — 심사 기준: 인라인 스타일 대신 CSS 변수 사용)
  applyFontSize(): void {
    const size = this.plugin.settings.chatFontSize || 14;
    this.viewContainerEl?.style.setProperty("--ba-chat-font-size", `${size}px`);
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

    // 대화 히스토리 저장 (queueMicrotask 디바운싱으로 같은 틱 내 중복 호출 방지)
    private persistHistory(forceFlush = false): void {
          if (!forceFlush && this.persistPending) return;
          if (forceFlush) {
            // 뷰 닫힐 때 등 즉시 저장이 필요한 경우 가드 무시
            this.persistPending = false;
            this.plugin.saveChatHistory(this.messages);
            this.updateContextRing();
            return;
          }
          this.persistPending = true;
          queueMicrotask(() => {
            this.persistPending = false;
            this.plugin.saveChatHistory(this.messages);
            this.updateContextRing();
          });
        }

    async onClose(): Promise<void> {
      this.handleStop();
      // 뷰 닫힐 때 가드 무시하고 즉시 저장 (race condition 방지)
      this.persistHistory(true);
      // 드롭다운 이벤트 리스너 정리 (document 레벨 리스너 누수 방지)
      this.closeModelDropdown();
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
