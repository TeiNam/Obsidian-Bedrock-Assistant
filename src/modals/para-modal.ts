// P.A.R.A 환경 설정 모달 — 진행 상황 표시 및 결과 요약

import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import { organizeVaultPara, type ParaResult } from "../para-organizer";

/** 설정 탭 i18n에서 전달받는 P.A.R.A 관련 텍스트 */
export interface ParaI18n {
  paraModalTitle: string;
  paraModalRunning: string;
  paraModalDone: string;
  paraModalCreated: string;
  paraModalMoved: string;
  paraModalSkipped: string;
  paraModalErrors: string;
  paraModalNoFiles: string;
  paraModalClose: string;
}

/**
 * P.A.R.A 환경 설정 실행 모달
 */
export class ParaModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  private t: ParaI18n;

  constructor(app: App, plugin: GeminiAssistantPlugin, t: ParaI18n) {
    super(app);
    this.plugin = plugin;
    this.t = t;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("ba-para-modal");
    contentEl.createEl("h2", { text: this.t.paraModalTitle });

    // 진행 상태 영역
    const statusEl = contentEl.createDiv({ cls: "ba-para-status" });
    statusEl.createEl("p", { text: this.t.paraModalRunning });
    const progressEl = statusEl.createEl("p", { cls: "ba-para-progress" });

    // 실행
    const result = await organizeVaultPara(
      this.app,
      this.plugin,
      (current, total, fileName) => {
        progressEl.textContent = `${current} / ${total} — ${fileName}`;
      }
    );

    // 결과 표시
    statusEl.empty();
    statusEl.createEl("p", { text: this.t.paraModalDone, cls: "ba-para-done" });

    this.renderResult(contentEl, result);

    // 닫기 버튼
    const btnRow = contentEl.createDiv({ cls: "ba-para-btn-row" });
    const closeBtn = btnRow.createEl("button", { text: this.t.paraModalClose });
    closeBtn.addEventListener("click", () => this.close());
  }

  private renderResult(el: HTMLElement, result: ParaResult): void {
    const list = el.createDiv({ cls: "ba-para-result" });

    if (result.created.length > 0) {
      list.createEl("p", {
        text: `${this.t.paraModalCreated}: ${result.created.join(", ")}`,
      });
    }

    if (result.moved.length > 0) {
      list.createEl("p", {
        text: `${this.t.paraModalMoved}: ${result.moved.length}`,
      });
      const ul = list.createEl("ul", { cls: "ba-para-moved-list" });
      for (const m of result.moved) {
        ul.createEl("li", { text: `${m.from} → ${m.to}` });
      }
    } else if (result.errors.length === 0) {
      list.createEl("p", { text: this.t.paraModalNoFiles });
    }

    if (result.skipped.length > 0) {
      list.createEl("p", {
        text: `${this.t.paraModalSkipped}: ${result.skipped.length}`,
      });
    }

    if (result.errors.length > 0) {
      list.createEl("p", {
        text: `${this.t.paraModalErrors}: ${result.errors.length}`,
        cls: "ba-para-errors",
      });
      const ul = list.createEl("ul");
      for (const e of result.errors) {
        ul.createEl("li", { text: e });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
