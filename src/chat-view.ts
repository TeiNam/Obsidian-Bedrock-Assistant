import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon, MarkdownView, TFile, FuzzySuggestModal } from "obsidian";
import type BedrockAssistantPlugin from "./main";
import { KIRO_ICON_ID } from "./main";
import type { ChatMessage, ConverseMessage, ContentBlock, ContentBlockToolUse } from "./types";
import { TOOLS } from "./obsidian-tools";

export const VIEW_TYPE = "assistant-kiro-view";

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
  private attachedFiles: Map<string, string> = new Map(); // path → content

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

      // 입력 영역
      this.buildInputArea();

      // 저장된 대화 히스토리 복원
      await this.restoreChatHistory();
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
    const indexBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": "볼트 인덱싱" } });
    setIcon(indexBtn, "database");
    indexBtn.addEventListener("click", () => this.handleIndexVault());

    // 새 대화 버튼
    const newBtn = actions.createDiv({ cls: "ba-header-btn", attr: { "aria-label": "새 대화" } });
    setIcon(newBtn, "square-pen");
    newBtn.addEventListener("click", () => this.clearChat());
  }

  private buildInputArea(): void {
    const inputContainer = this.viewContainerEl.createDiv({ cls: "ba-input-container" });
    const inputWrapper = inputContainer.createDiv({ cls: "ba-input-wrapper" });

    // 컨텍스트 행 (첨부된 파일 칩 표시)
    this.contextRow = inputWrapper.createDiv({ cls: "ba-context-row" });
    this.fileChipContainer = this.contextRow.createDiv({ cls: "ba-file-chips" });

    // 텍스트 입력
    this.inputEl = inputWrapper.createEl("textarea", {
      cls: "ba-input",
      attr: { placeholder: "메시지를 입력하세요...", rows: "1" },
    });

    // 툴바
    const toolbar = inputWrapper.createDiv({ cls: "ba-input-toolbar" });
    const toolbarLeft = toolbar.createDiv({ cls: "ba-toolbar-left" });

    // 현재 노트 첨부 버튼
    const attachBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn", attr: { "aria-label": "현재 노트 첨부" } });
    setIcon(attachBtn, "file-plus");
    attachBtn.addEventListener("click", () => this.attachCurrentNote());

    // 파일 검색 첨부 버튼
    const searchBtn = toolbarLeft.createDiv({ cls: "ba-toolbar-btn", attr: { "aria-label": "파일 검색 첨부" } });
    setIcon(searchBtn, "search");
    searchBtn.addEventListener("click", () => this.openFileSearchModal());

    // 전송/중지 버튼
    this.sendBtn = toolbar.createEl("button", { cls: "ba-send-btn" });
    setIcon(this.sendBtn, "arrow-up");

    this.stopBtn = toolbar.createEl("button", { cls: "ba-stop-btn" });
    setIcon(this.stopBtn, "square");

    // 이벤트
    this.sendBtn.addEventListener("click", () => this.handleSend());
    this.stopBtn.addEventListener("click", () => this.handleStop());

    this.inputEl.addEventListener("keydown", (e) => {
      // 한글 등 IME 조합 중에는 Enter 무시
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // 자동 높이 조절
    this.inputEl.addEventListener("input", () => {
      this.inputEl.style.height = "auto";
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + "px";
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
  }

  // ============================================
  // 환영 메시지
  // ============================================

  private renderWelcome(): void {
    const welcome = this.messagesEl.createDiv({ cls: "ba-welcome" });
    const greeting = this.plugin.settings.welcomeGreeting || "무엇을 도와드릴까요?";
    welcome.createDiv({ cls: "ba-welcome-greeting", text: greeting });

    const info = welcome.createDiv({ cls: "ba-welcome-info" });
    const indexCount = this.plugin.indexer?.size ?? 0;
    info.setText(
      indexCount > 0
        ? `📊 인덱싱된 노트: ${indexCount}개`
        : "💡 상단 DB 아이콘으로 볼트를 인덱싱하세요"
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
      const thinkingEl = contentEl.createSpan({ cls: "ba-thinking", text: "생각 중..." });
      this.scrollToBottom();

      // Converse API용 메시지 히스토리 구성
      const converseMessages: ConverseMessage[] = this.messages.map((m) => ({
        role: m.role,
        content: [{ text: m.content }],
      }));

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
          const nextThinking = contentEl.createSpan({ cls: "ba-thinking", text: "생각 중..." });
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
            text: `오류: ${(error as Error).message}`,
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
        const errMsg = `도구 실행 오류: ${(error as Error).message}`;
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
    const copyBtn = actions.createSpan({ attr: { "aria-label": "복사" } });
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
    // 이전 자동 첨부 파일 제거 (수동 첨부는 유지)
    this.attachedFiles.clear();
    await this.addFileContext(path);
  }

  private async addFileContext(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return;
    if (file.extension !== "md") return;

    const content = await this.app.vault.cachedRead(file as any);
    this.attachedFiles.set(path, content);
    this.renderFileChips();
  }

  private removeFileContext(path: string): void {
    this.attachedFiles.delete(path);
    this.renderFileChips();
  }

  private renderFileChips(): void {
    this.fileChipContainer.empty();

    if (this.attachedFiles.size === 0) {
      this.contextRow.removeClass("has-content");
      return;
    }

    this.contextRow.addClass("has-content");

    for (const path of this.attachedFiles.keys()) {
      const chip = this.fileChipContainer.createDiv({ cls: "ba-file-chip" });

      const iconEl = chip.createDiv({ cls: "ba-file-chip-icon" });
      setIcon(iconEl, "file-text");

      const basename = path.split("/").pop()?.replace(".md", "") || path;
      chip.createSpan({ cls: "ba-file-chip-name", text: basename });

      const removeBtn = chip.createDiv({ cls: "ba-file-chip-remove", text: "×" });
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.removeFileContext(path);
      });

      // 클릭하면 파일 열기
      chip.addEventListener("click", () => {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f) this.app.workspace.getLeaf(false).openFile(f as any);
      });
    }
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
    });
    modal.open();
  }

  // 메시지에 첨부 파일 컨텍스트 주입
  private buildContextPrefix(): string {
    if (this.attachedFiles.size === 0) return "";

    const parts: string[] = [];
    for (const [path, content] of this.attachedFiles) {
      parts.push(`[첨부 파일: ${path}]\n${content.slice(0, 8000)}`);
    }
    return parts.join("\n\n") + "\n\n---\n\n";
  }

  // ============================================
  // 인덱싱
  // ============================================

  private async handleIndexVault(): Promise<void> {
    if (!this.plugin.indexer || this.plugin.indexer.isIndexing) return;

    const welcome = this.messagesEl.querySelector(".ba-welcome");
    if (welcome) welcome.remove();

    const progressEl = this.messagesEl.createDiv({ cls: "ba-index-progress" });
    const progressLabel = progressEl.createDiv({ cls: "ba-index-label", text: "📊 볼트 인덱싱 시작..." });
    const progressBarOuter = progressEl.createDiv({ cls: "ba-progress-bar-outer" });
    const progressBarInner = progressBarOuter.createDiv({ cls: "ba-progress-bar-inner" });
    const progressDetail = progressEl.createDiv({ cls: "ba-index-detail" });

    this.scrollToBottom();

    const result = await this.plugin.indexer.indexVault((current: number, total: number) => {
      const pct = Math.round((current / total) * 100);
      progressBarInner.style.width = `${pct}%`;
      progressLabel.setText(`📊 인덱싱 중... ${pct}%`);
      progressDetail.setText(`${current} / ${total} 파일`);
      this.scrollToBottom();
    });

    progressLabel.setText("✅ 인덱싱 완료");
    progressDetail.setText(`${this.plugin.indexer.size}개 노트 인덱싱됨`);
    progressBarInner.style.width = "100%";
    progressBarInner.addClass("ba-progress-done");

    // 실패한 파일이 있으면 접을 수 있는 상세 목록 표시
    if (result && result.errors.length > 0) {
      const failSection = progressEl.createDiv({ cls: "ba-index-failures" });

      const failHeader = failSection.createDiv({ cls: "ba-fail-header" });
      const toggleIcon = failHeader.createSpan({ cls: "ba-fail-toggle-icon", text: "▶" });
      failHeader.createSpan({
        cls: "ba-fail-header-text",
        text: `⚠️ ${result.errors.length}개 파일 인덱싱 실패`,
      });

      const failList = failSection.createDiv({ cls: "ba-fail-list collapsed" });

      for (const failure of result.errors) {
        const item = failList.createDiv({ cls: "ba-fail-item" });
        item.createSpan({ cls: "ba-fail-path", text: failure.path });
        item.createSpan({ cls: "ba-fail-reason", text: failure.reason });
      }

      // 토글 클릭
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
    }

    async onClose(): Promise<void> {
      this.handleStop();
      this.persistHistory();
    }

}


// 볼트 파일 검색 모달
class FileSearchModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: import("obsidian").App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("첨부할 노트를 검색하세요...");
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
