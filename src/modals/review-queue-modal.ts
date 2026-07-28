// 복습 큐 모달 — 다시 볼 노트를 제시하고 클릭으로 열게 한다.
//
// LLM 호출이 없는 순수 표시 계층이다. 점수 계산은 review-queue.ts가 담당하고,
// 이 모달은 결과를 보여주고 열기만 한다.

import { Modal } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { ReviewItem } from "../second-brain/review-queue";

export class ReviewQueueModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  private queue: ReviewItem[];

  constructor(app: App, plugin: GeminiAssistantPlugin, queue: ReviewItem[]) {
    super(app);
    this.plugin = plugin;
    this.queue = queue;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "다시 볼 노트" });
    contentEl.createEl("p", {
      text: "오래 열지 않았지만 연결이 많은 노트입니다. 클릭하면 열립니다.",
      cls: "setting-item-description",
    });

    const list = contentEl.createDiv({ cls: "ba-review-list" });

    for (const item of this.queue) {
      const row = list.createDiv({ cls: "ba-review-row" });

      const info = row.createDiv({ cls: "ba-review-info" });
      info.createDiv({ cls: "ba-review-title", text: item.title || item.path });
      info.createDiv({ cls: "ba-review-reason", text: item.reason });

      row.addEventListener("click", async () => {
        // 기존 open_note 경로와 동일하게 워크스페이스에서 연다.
        const file = this.app.vault.getAbstractFileByPath(item.path);
        if (file) {
          await this.app.workspace.getLeaf(false).openFile(file as never);
        }
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
