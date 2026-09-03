import { Component, ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon, MarkdownView, TFile, FuzzySuggestModal, Notice } from "obsidian";
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
// 모델 변경 시 effort 허용 집합 보정에 사용
import {
  clampEffort,
  supportsAttachmentFormat,
  attachmentKindOf,
  backendsSupportingFormat,
} from "./provider-utils";
import {
  citationMatchesPath,
  extractCitations,
  findUnresolvedCitations,
  buildHeadingIndex,
} from "./citation-check";
import { createTodoNote } from "./todo-manager";
import { SessionListModal } from "./modals/session-list-modal";
import { ToolConfirmModal } from "./modals/tool-confirm-modal";
import { isRetrospectiveCommand } from "./retrospective-command";
import { generateRetrospective } from "./retrospective-service";

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
  private autoAttachVersion = 0;
  private uiEvents!: Component;

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
        if (this.uiEvents) this.removeChild(this.uiEvents);
        this.uiEvents = this.addChild(new Component());

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
    this.uiEvents.registerDomEvent(indexBtn, "click", () => this.handleIndexVault());

    // 새 대화 버튼
    const newBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.newChat } });
    setIcon(newBtn, "square-pen");
    this.uiEvents.registerDomEvent(newBtn, "click", () => this.startNewChat());

    // 대화 내보내기 버튼
    const exportBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.exportChat } });
    setIcon(exportBtn, "download");
    this.uiEvents.registerDomEvent(exportBtn, "click", () => this.exportChat());

    // 지난 대화 버튼
    const historyBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": this.t.chatHistory } });
    setIcon(historyBtn, "history");
    this.uiEvents.registerDomEvent(historyBtn, "click", () => this.showSessionList());
  }

  private async buildInputArea(): Promise<void> {
    const inputContainer = this.viewContainerEl.createDiv({ cls: "ba-input-container" });

    // 액션 툴바 (입력창 바로 위)
    const actionToolbar = inputContainer.createDiv({ cls: "ba-action-toolbar" });

    // To-Do 생성 버튼
    const todoBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.createTodo } });
    setIcon(todoBtn, "check-square");
    this.uiEvents.registerDomEvent(todoBtn, "click", () => this.handleCreateTodoNote());

    // 태그 생성 버튼
    const tagBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.generateTags } });
    setIcon(tagBtn, "tag");
    this.uiEvents.registerDomEvent(tagBtn, "click", () => this.generateTags());

    // 웹 페이지 요약 버튼
    const webClipBtn = actionToolbar.createDiv({ cls: "ba-action-btn", attr: { "aria-label": this.t.webClip } });
    setIcon(webClipBtn, "globe");
    this.uiEvents.registerDomEvent(webClipBtn, "click", () => this.openWebClipper());

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
    this.uiEvents.registerDomEvent(attachBtn, "click", () => this.attachCurrentNote());

    // 파일 검색 첨부 버튼
    const searchBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn", attr: { "aria-label": this.t.searchFile } });
    setIcon(searchBtn, "search");
    this.uiEvents.registerDomEvent(searchBtn, "click", () => this.openFileSearchModal());

    // 파일 첨부 버튼 (이미지, PDF, XLSX 등)
    const clipBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn", attr: { "aria-label": this.t.attachFile } });
    setIcon(clipBtn, "paperclip");
    this.uiEvents.registerDomEvent(clipBtn, "click", () => this.openBinaryFileAttach());

    // 웹 서치 토글 버튼
    this.webSearchBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn ba-web-search-btn", attr: { "aria-label": this.t.webSearch } });
    setIcon(this.webSearchBtn, "globe");
    this.uiEvents.registerDomEvent(this.webSearchBtn, "click", () => this.toggleWebSearch());

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
    this.uiEvents.registerDomEvent(this.sendBtn, "click", () => this.handleSend());
    this.uiEvents.registerDomEvent(this.stopBtn, "click", () => this.handleStop());

    this.uiEvents.registerDomEvent(this.inputEl, "keydown", (e: KeyboardEvent) => {
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
    this.uiEvents.registerDomEvent(this.inputEl, "input", () => {
      this.inputEl.style.height = "auto";
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + "px";
      this.updateContextRing();
    });

    // Escape로 스트리밍 중지
    this.uiEvents.registerDomEvent(this.containerEl, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.isGenerating) {
        e.preventDefault();
        this.handleStop();
      }
    });

    // 파일 열기 이벤트 → 자동 첨부
    this.uiEvents.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file && this.plugin.settings.autoAttachActiveNote) {
          this.autoAttachFile(file.path);
        }
      })
    );

    // 탭 전환(active-leaf-change) 이벤트 → 자동 첨부
    // file-open은 새로 열 때만 발생하므로, 이미 열린 탭 클릭 시에도 감지
    this.uiEvents.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.plugin.settings.autoAttachActiveNote) return;
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.file) {
          this.autoAttachFile(activeView.file.path);
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
    this.uiEvents.registerDomEvent(inputWrapper, "dragover", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      inputWrapper.addClass("ba-drag-over");
    });
    this.uiEvents.registerDomEvent(inputWrapper, "dragleave", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      inputWrapper.removeClass("ba-drag-over");
    });
    this.uiEvents.registerDomEvent(inputWrapper, "drop", async (e: DragEvent) => {
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
    this.uiEvents.registerDomEvent(this.inputEl, "paste", async (e: ClipboardEvent) => {
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

    this.uiEvents.registerDomEvent(modelBtn, "click", () => this.openModelPicker());

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

    // 회고 명령 인터셉트 — AI API 호출 전에 판별
    if (isRetrospectiveCommand(text)) {
      await this.handleRetrospectiveCommand();
      return;
    }

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

  /**
   * 저장된 어시스턴트 메시지 하나를 그린다.
   *
   * 세션 불러오기와 사이드바 복원이 같은 것을 각자 그리다가 갈라졌다 — 한쪽은 라벨과
   * 재생성 버튼이 없고, 한쪽은 인용 검증이 없었다. 두 경로가 이 함수를 함께 쓴다.
   *
   * @param showRegenerate 마지막 어시스턴트 메시지에만 true. 중간 메시지에 붙이면
   *   어느 것을 다시 만드는지 모호해진다.
   */
  private async renderStoredAssistantMessage(
    content: string,
    showRegenerate: boolean
  ): Promise<void> {
    const msgEl = this.messagesEl.createDiv({ cls: "ba-message ba-message-assistant" });
    this.addAssistantLabel(msgEl);
    const contentEl = msgEl.createDiv({ cls: "ba-message-content" });
    await MarkdownRenderer.render(this.app, content, contentEl, "", this);

    // 경고는 저장되지 않으므로 복원할 때 다시 검증한다. 그러지 않으면 같은 허위 인용이
    // 아무 표시 없이 근거처럼 보인다.
    this.appendCitationWarning(msgEl, content);

    if (!showRegenerate) return;

    const footer = msgEl.createDiv({ cls: "ba-response-footer" });
    const regenBtn = footer.createEl("button", {
      cls: "ba-regenerate-btn",
      attr: { "aria-label": this.t.regenerate },
    });
    setIcon(regenBtn, "refresh-cw");
    regenBtn.createSpan({ text: this.t.regenerate });
    regenBtn.addEventListener("click", () => {
      if (!this.isGenerating) this.regenerateLastResponse();
    });
  }

  /**
   * 재생성 버튼을 붙일 메시지의 인덱스. 없으면 -1.
   *
   * **마지막 메시지가 어시스턴트일 때만** 준다. `prepareRegeneration`은 배열의 마지막
   * 역할이 assistant일 때만 동작하므로, 사용자 메시지로 끝난 세션에서 앞선 어시스턴트
   * 메시지에 버튼을 붙이면 눌러도 아무 일이 없다.
   */
  private lastAssistantIndex(messages: readonly { role: string }[]): number {
    const last = messages.length - 1;
    return last >= 0 && messages[last].role === "assistant" ? last : -1;
  }

  /**
   * 채팅 기반 회고 처리.
   * 어시스턴트 메시지 컨테이너를 생성하고, 진행 상태를 표시하며,
   * RetrospectiveService를 호출하여 결과를 채팅에 렌더링한다.
   */
  private async handleRetrospectiveCommand(): Promise<void> {
    this.setGenerating(true);

    // 어시스턴트 메시지 컨테이너 생성
    const msgEl = this.messagesEl.createDiv({ cls: "ba-message ba-message-assistant" });
    this.addAssistantLabel(msgEl);
    const contentEl = msgEl.createDiv({ cls: "ba-message-content" });

    // 생성 중 상태 표시
    contentEl.createDiv({ cls: "ba-thinking", text: this.t.chatRetroGenerating });
    this.scrollToBottom();

    try {
      const result = await generateRetrospective({
        app: this.app,
        settings: this.plugin.settings,
        aiClient: this.plugin.aiClient,
      });

      // 생성 중 표시 제거
      contentEl.empty();

      if (result.success && result.text) {
        // 성공: 회고 텍스트를 마크다운으로 렌더링
        await MarkdownRenderer.render(this.app, result.text, contentEl, "", this);
        contentEl.createDiv({ cls: "ba-info", text: this.t.chatRetroComplete });

        // 어시스턴트 메시지를 히스토리에 추가
        this.messages.push({
          role: "assistant",
          content: result.text,
          timestamp: Date.now(),
        });
      } else if (!result.message) {
        // To-Do 없음 (message 없는 실패)
        contentEl.createDiv({ cls: "ba-info", text: this.t.chatRetroNoTodo });

        this.messages.push({
          role: "assistant",
          content: this.t.chatRetroNoTodo,
          timestamp: Date.now(),
        });
      } else {
        // 에러 (message 있는 실패)
        contentEl.createDiv({ cls: "ba-error", text: this.t.chatRetroFailed(result.message) });

        this.messages.push({
          role: "assistant",
          content: this.t.chatRetroFailed(result.message),
          timestamp: Date.now(),
        });
      }

      this.scrollToBottom();
      this.persistHistory();
    } finally {
      this.setGenerating(false);
    }
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

      // 바이너리 첨부 파일을 마지막 user 메시지에 추가.
      //
      // 첨부 후 백엔드를 전환했을 수 있으므로 전송 시점에 한 번 더 확인한다.
      // addLocalFile의 게이팅만으로는 "Bedrock에서 이미지 첨부 → Gemini로 전환 → 전송"
      // 경로를 막지 못하고, 그 경로에서 블록은 변환기에서 조용히 사라진다.
      if (this.attachedBinaryFiles.size > 0 && converseMessages.length > 0) {
        const backend = this.plugin.settings.aiBackend;
        const lastUserIdx = converseMessages.length - 1;
        const dropped: string[] = [];

        for (const [path, data] of this.attachedBinaryFiles) {
          const ext = path.split(".").pop()?.toLowerCase() || "";
          // 첨부 후 백엔드를 전환했을 수 있다. 전환 경로는 첨부 게이팅을 이미 통과한
          // 상태이므로 전송 시점에 형식별로 다시 판정해야 한다.
          if (!supportsAttachmentFormat(backend, ext)) {
            dropped.push(path);
            continue;
          }
          if (converseMessages[lastUserIdx].role !== "user") continue;
          const block = this.buildBinaryContentBlock(path, ext, data);
          if (block) {
            (converseMessages[lastUserIdx].content as unknown[]).unshift(block);
          }
        }

        if (dropped.length > 0) {
          new Notice(this.t.binaryDropped(dropped.join(", ")));
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
            this.abortController.signal,
            this.webSearchEnabled
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

        // 인용 검증 — 모델이 지어낸 노트 경로를 표시한다.
        this.appendCitationWarning(msgEl, fullText);

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
      const version = ++this.autoAttachVersion;
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
      await this.addFileContext(path, false, version);
    }

  private async addFileContext(
    path: string,
    manual = true,
    autoAttachVersion?: number
  ): Promise<void> {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof TFile)) return;
      if (!isAllowedTextExtension(file.extension)) return;

      const content = await this.app.vault.cachedRead(file as any);
      if (
        !manual &&
        (autoAttachVersion !== this.autoAttachVersion || this.autoAttachedPath !== path)
      ) {
        return;
      }
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
        this.autoAttachVersion++;
      }
      this.renderFileChips();
    }

    // 모든 첨부 파일 해제
    private removeAllFileContexts(): void {
      this.attachedFiles.clear();
      this.attachedBinaryFiles.clear();
      this.manuallyAttachedPaths.clear();
      this.autoAttachedPath = null;
      this.autoAttachVersion++;
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
      // 자동 마운트된 현재 노트는 "열린 노트" 라벨로 구분
      const label = path === this.autoAttachedPath
        ? this.t.activeNoteLabel(path)
        : this.t.attachedFileLabel(path);
      parts.push(`${label}\n${content.slice(0, 8000)}`);
    }

    if (parts.length === 0) return "";
    return parts.join("\n\n") + "\n\n---\n\n";
  }

  // ============================================
  // 모델 선택
  // ============================================

  // 현재 백엔드에 해당하는 채팅 모델 ID를 반환한다.
  // 모델 선택 박스가 백엔드별 올바른 설정 필드를 읽도록 한다(bedrock/openai/ollama/gemini).
  private getActiveChatModel(): string {
    const s = this.plugin.settings;
    switch (s.aiBackend) {
      case "bedrock":
        return s.bedrockChatModel;
      case "openai":
        return s.openaiChatModel;
      case "ollama":
        return s.ollamaChatModel;
      case "gemini":
      default:
        return s.chatModel;
    }
  }

  // 현재 백엔드에 해당하는 채팅 모델 ID를 설정한다.
  private setActiveChatModel(modelId: string): void {
    const s = this.plugin.settings;
    switch (s.aiBackend) {
      case "bedrock":
        s.bedrockChatModel = modelId;
        break;
      case "openai":
        s.openaiChatModel = modelId;
        break;
      case "ollama":
        s.ollamaChatModel = modelId;
        break;
      case "gemini":
      default:
        s.chatModel = modelId;
        break;
    }
  }

  // 모델 라벨 업데이트 (현재 선택된 모델 표시)
  private updateModelLabel(): void {
    const modelId = this.getActiveChatModel();
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

      const currentModelId = this.getActiveChatModel();
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
          this.setActiveChatModel(model.modelId);
          // 모델이 바뀌면 effort 허용 집합이 달라진다. 요청 시점에도 보정되지만
          // 저장값과 실제 전송값이 어긋나지 않도록 여기서 확정한다.
          this.plugin.settings.effort = clampEffort(
            this.plugin.settings.aiBackend,
            model.modelId,
            this.plugin.settings.effort
          );
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
      // 텍스트로 읽어 프롬프트에 인라인하는 형식 — 모든 백엔드에서 동작한다.
      const textExts = ["txt", "csv", "html"];
      // 바이너리로 전달하는 형식 목록은 provider-utils가 단일 출처로 갖고 있다.
      const isBinary = attachmentKindOf(ext) !== null;

      if (!textExts.includes(ext) && !isBinary) {
        new Notice(this.t.unsupportedExt(ext));
        return;
      }

      const backend = this.plugin.settings.aiBackend;
      // 종류가 아니라 형식 단위로 판정한다 — Gemini는 PDF는 받지만 docx는 못 받는다.
      // 붙이게 놔두면 전송 시점에 조용히 버려지므로 여기서 거절해 이유를 알린다.
      if (isBinary && !supportsAttachmentFormat(backend, ext)) {
        new Notice(
          this.t.binaryUnsupported(ext, backend, backendsSupportingFormat(ext).join(", "))
        );
        return;
      }

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
      const modelId = this.getActiveChatModel();
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

  // 연결된 MCP 중 웹 서치용(fetch/exa/brave) 도구가 하나라도 있는지 확인
  private hasWebSearchMcp(): boolean {
    const KEYWORDS = ["fetch", "exa", "brave"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = (this.plugin.mcpManager?.getAllTools?.() ?? []) as any[];
    return tools.some((t) => {
      const hay = `${t._mcpServer ?? ""} ${t._mcpToolName ?? ""} ${t.name ?? ""}`.toLowerCase();
      return KEYWORDS.some((k) => hay.includes(k));
    });
  }

  // 현재 백엔드가 네이티브 웹서치를 지원하는지 (Gemini = Google Search grounding)
  private backendHasNativeWebSearch(): boolean {
    return this.plugin.settings.aiBackend === "gemini";
  }

  // 웹 서치 토글
  private toggleWebSearch(): void {
    // 켜려는 경우: 네이티브 웹서치(Gemini)도, 웹서치용 MCP(fetch/exa/brave)도 없으면
    // 알림 후 활성화하지 않는다.
    if (
      !this.webSearchEnabled &&
      !this.backendHasNativeWebSearch() &&
      !this.hasWebSearchMcp()
    ) {
      new Notice(this.t.webSearchNoMcp);
      return;
    }
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
    const lastAssistant = this.lastAssistantIndex(this.messages);
    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      if (msg.role === "user") this.renderUserMessage(msg);
      else await this.renderStoredAssistantMessage(msg.content, i === lastAssistant);
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

  /**
   * 응답이 인용한 노트 경로 중 볼트에서 찾을 수 없는 것을 경고로 덧붙인다.
   *
   * 시스템 프롬프트가 근거 경로를 밝히라고 지시하므로 모델은 경로를 쓴다. 그런데 그
   * 경로가 실재하는지는 아무도 확인하지 않았다 — 지어낸 인용을 잡지 못하면 사용자는
   * 클릭해봐야 알고, 그때까지 답변을 근거 있는 것으로 믿는다.
   *
   * 볼트에 노트가 하나도 없으면 경고하지 않는다. 실패는 삼킨다 — 검증이
   * 응답 표시를 막아선 안 된다.
   */
  private appendCitationWarning(container: HTMLElement, text: string): void {
    try {
      if (!text) return;

      const citations = extractCitations(text);
      if (citations.length === 0) return;

      // 존재 판정은 볼트에서 직접 한다. 인덱스 스냅샷을 쓰면 플러그인이 꺼져 있는 동안
      // 만든 노트가 "없는 노트"로 경고되고, 인덱싱 전에는 모든 인용이 경고 대상이 된다.
      //
      // 마크다운만이 아니라 **볼트 전체 파일**과 대조한다. 모델이 `[[Images/chart.png]]`
      // 처럼 첨부를 근거로 링크하면, 마크다운 목록에는 그 파일이 없어 실재하는데도 항상
      // 경고가 붙는다.
      const paths = this.app.vault.getFiles().map((f) => f.path);
      // 헤딩은 마크다운에만 있다.
      const files = this.app.vault.getMarkdownFiles();

      // 앵커 검증도 metadataCache가 출처다. 인덱스 청크의 heading은 청크 하나를 대표하는
      // 헤딩 한 개일 뿐이어서, `# A ... ## B`가 한 청크에 들어간 노트는 B를 인용하면
      // 없는 절이라고 잘못 경고한다.
      //
      // 인용된 노트만 훑는다. 응답 한 건마다 볼트 전체에 getFileCache를 돌리면 수천 개
      // 볼트에서 메시지마다 수천 번 조회가 된다 — 인용은 보통 한 자리 수다.
      // 인용 대상과 **같은 규칙으로** 파일을 고른다. 존재 판정은 경로 접미사를 인정하는데
      // (옵시디언이 그렇게 해석한다) 여기서 정확 일치만 보면 접미사로 맞은 노트가 헤딩
      // 인덱스에 빠지고, 앵커 검증이 "헤딩 정보 없음 → 통과"로 지어낸 절을 놓친다.
      const citedTargets = citations.map((c) => c.target.toLowerCase());
      const headings = buildHeadingIndex(
        files
          .filter((f) => citedTargets.some((target) => citationMatchesPath(target, f.path)))
          .map((f) => [
            f.path,
            (this.app.metadataCache.getFileCache(f)?.headings ?? []).map((h) => h.heading),
          ])
      );

      const unresolved = findUnresolvedCitations(citations, paths, headings);
      if (unresolved.length === 0) return;

      const box = container.createDiv({ cls: "ba-citation-warning" });
      const icon = box.createDiv({ cls: "ba-citation-warning-icon" });
      setIcon(icon, "alert-triangle");
      // 앵커가 있으면 함께 보여준다 — "노트는 있는데 그 절이 없다"를 구분해야
      // 사용자가 무엇을 확인할지 안다.
      const labels = unresolved.map((c) => (c.anchor ? `${c.target}#${c.anchor}` : c.target));
      box.createSpan({ text: this.t.citationsUnresolved(labels.join(", ")) });
    } catch (e) {
      console.error("인용 검증 실패:", e);
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
        const lastAssistant = this.lastAssistantIndex(history);
        for (let i = 0; i < history.length; i++) {
          const msg = history[i];
          if (msg.role === "user") this.renderUserMessage(msg);
          else await this.renderStoredAssistantMessage(msg.content, i === lastAssistant);
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
