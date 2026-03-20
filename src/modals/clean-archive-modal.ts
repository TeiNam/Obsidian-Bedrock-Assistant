// 아카이브 비우기 모달 (chat-view.ts에서 분리)

import { Modal, TFile, Notice, normalizePath } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { ViewLang } from "../chat-view-i18n";

/**
 * 아카이브 폴더에서 오래된 파일을 선택적으로 삭제하는 모달
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class CleanArchiveModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  private t: Record<string, any>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(app: App, plugin: GeminiAssistantPlugin, t: Record<string, any>) {
    super(app);
    this.plugin = plugin;
    this.t = t;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("ba-clean-archive-modal");
    contentEl.createEl("h2", { text: this.t.cleanArchiveTitle });

    const archiveFolder = normalizePath(this.plugin.settings.archiveCleanFolder);
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
