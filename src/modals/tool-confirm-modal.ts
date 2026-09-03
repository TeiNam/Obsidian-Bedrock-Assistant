// 파괴적 도구 실행 전 사용자 확인 모달 (chat-view.ts에서 분리)

import { Modal, setIcon } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { ViewLang } from "../chat-view-i18n";

/**
 * 파괴적 도구 실행 전 사용자에게 확인을 요청하는 모달
 */
export class ToolConfirmModal extends Modal {
  private toolName: string;
  private toolInput: Record<string, unknown>;
  private t: ViewLang;
  private resolvePromise: (approved: boolean) => void;
  private plugin: GeminiAssistantPlugin;
  private resolved = false;

  constructor(
    app: App,
    toolName: string,
    toolInput: Record<string, unknown>,
    t: ViewLang,
    plugin: GeminiAssistantPlugin,
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
    header.createDiv({ text: this.t.toolConfirmTitle, cls: "ba-tool-confirm-title" });

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
