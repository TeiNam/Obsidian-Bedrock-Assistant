// 복습 큐 모달 — 다시 볼 노트를 제시하고 클릭으로 열게 한다.
//
// LLM 호출이 없는 순수 표시 계층이다. 점수 계산과 원자료 수집은 review-queue.ts가
// 담당하고, 이 모달은 원자료를 현재 언어의 문구로 조립해 보여주고 열기만 한다.

import { Modal } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { ReviewItem } from "../second-brain/review-queue";
import { VIEW_I18N } from "../chat-view-i18n";

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
    const t = VIEW_I18N[this.plugin.settings.language] || VIEW_I18N.en;

    contentEl.empty();
    this.setTitle(t.reviewQueueTitle);
    contentEl.createEl("p", {
      text: t.reviewQueueDesc,
      cls: "setting-item-description",
    });

    const list = contentEl.createDiv({ cls: "ba-review-list" });

    for (const item of this.queue) {
      const row = list.createDiv({ cls: "ba-review-row" });

      // 선정 이유 문구는 원자료(basis/elapsedDays/links)에서 현재 언어로 조립한다.
      const reason =
        item.basis === "opened"
          ? t.reviewQueueNotOpened(item.elapsedDays, item.links)
          : t.reviewQueueNotModified(item.elapsedDays, item.links);

      const info = row.createDiv({ cls: "ba-review-info" });
      info.createDiv({ cls: "ba-review-title", text: item.title || item.path });
      info.createDiv({ cls: "ba-review-reason", text: reason });

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
