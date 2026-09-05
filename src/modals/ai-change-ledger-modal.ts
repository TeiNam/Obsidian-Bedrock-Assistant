import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { AiChangeRecord } from "../ai-change-ledger";
import type { Locale } from "../types";

export const AI_CHANGE_I18N = {
  en: {
    title: "AI Change Ledger",
    empty: "No AI changes have been recorded.",
    viewCommand: "Open AI change ledger",
    undoCommand: "Undo last AI change",
    undone: (label: string) => `Undid AI change: ${label}`,
    conflict: "Undo stopped because one or more files changed after the AI action.",
  },
  ko: {
    title: "AI 변경 원장",
    empty: "기록된 AI 변경 작업이 없습니다.",
    viewCommand: "AI 변경 원장 열기",
    undoCommand: "마지막 AI 변경 되돌리기",
    undone: (label: string) => `AI 변경을 되돌렸습니다: ${label}`,
    conflict: "AI 작업 이후 파일이 다시 변경되어 되돌리기를 중단했습니다.",
  },
  ja: {
    title: "AI変更履歴",
    empty: "記録されたAI変更はありません。",
    viewCommand: "AI変更履歴を開く",
    undoCommand: "最後のAI変更を元に戻す",
    undone: (label: string) => `AI変更を元に戻しました: ${label}`,
    conflict: "AI操作後にファイルが変更されたため、元に戻す処理を中止しました。",
  },
} as const;

export function aiChangeLabels(locale: Locale): (typeof AI_CHANGE_I18N)[Locale] {
  return AI_CHANGE_I18N[locale] ?? AI_CHANGE_I18N.en;
}

export class AiChangeLedgerModal extends Modal {
  constructor(
    app: App,
    private locale: Locale,
    private records: readonly AiChangeRecord[],
  ) {
    super(app);
  }

  onOpen(): void {
    const t = aiChangeLabels(this.locale);
    this.setTitle(t.title);
    this.contentEl.empty();
    if (this.records.length === 0) {
      this.contentEl.createEl("p", { text: t.empty });
      return;
    }

    const list = this.contentEl.createEl("ol", { cls: "ba-ai-change-ledger" });
    for (const record of this.records) {
      const row = list.createEl("li");
      row.createEl("strong", { text: record.label });
      row.createSpan({ text: ` — ${new Date(record.createdAt).toLocaleString()}` });
      row.createDiv({
        cls: "setting-item-description",
        text: record.after.map((snapshot) => snapshot.path).join(", "),
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
