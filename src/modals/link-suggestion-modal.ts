// 링크 제안 검토 모달 — 고아·스텁 노트에 붙일 링크 후보를 승인받는다.
//
// 지식 공백 리포트는 "연결되지 않은 노트"를 찾아주지만 무엇에 연결할지는 말하지 않는다.
// 후보 계산은 link-suggestions.ts(순수 함수, LLM 호출 없음)가 하고, 이 모달은 승인만 받는다.
//
// 링크는 그래프를 영구히 바꾸고 이후 모든 검색의 이웃 확장에 영향을 준다. 그래서
// 기본 해제 상태이고, 승인한 것만 적용한다.

import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { LinkSuggestion } from "../second-brain/link-suggestions";
import { groupBySource } from "../second-brain/link-suggestions";
import { VIEW_I18N } from "../chat-view-i18n";

export class LinkSuggestionModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  private suggestions: LinkSuggestion[];
  /** 승인된 제안의 인덱스(suggestions 배열 기준). 기본은 빈 집합 — 옵트인이다. */
  private approved = new Set<number>();
  private applyBtn: HTMLButtonElement | null = null;
  private applying = false;

  /**
   * @param onApply 승인된 제안을 적용하는 콜백. 모달은 Vault 쓰기를 직접 하지 않는다.
   */
  constructor(
    app: App,
    plugin: GeminiAssistantPlugin,
    suggestions: LinkSuggestion[],
    private onApply: (approved: LinkSuggestion[]) => Promise<{ notes: number; links: number }>
  ) {
    super(app);
    this.plugin = plugin;
    this.suggestions = suggestions;
  }

  private get t(): (typeof VIEW_I18N)[keyof typeof VIEW_I18N] {
    return VIEW_I18N[this.plugin.settings.language] || VIEW_I18N.en;
  }

  onOpen(): void {
    const { contentEl } = this;
    const t = this.t;

    contentEl.empty();
    contentEl.addClass("ba-link-suggest-modal");
    this.setTitle(t.linkSuggestTitle);

    contentEl.createEl("p", {
      text: t.linkSuggestIntro,
      cls: "setting-item-description",
    });

    const list = contentEl.createDiv({ cls: "ba-link-suggest-list" });

    // 노트 단위로 묶어 보여준다. 같은 노트의 후보가 흩어져 있으면 "이 노트에 몇 개를
    // 붙일 것인가"를 판단할 수 없다.
    for (const [sourcePath, group] of groupBySource(this.suggestions)) {
      const card = list.createDiv({ cls: "ba-link-suggest-card" });
      card.createDiv({ cls: "ba-link-suggest-source", text: sourcePath });

      for (const suggestion of group) {
        // 전체 배열에서의 위치를 승인 키로 쓴다 — 그룹 내 위치가 아니다.
        const index = this.suggestions.indexOf(suggestion);
        this.renderRow(card, suggestion, index);
      }
    }

    this.renderFooter(contentEl);
  }

  private renderRow(parent: HTMLElement, suggestion: LinkSuggestion, index: number): void {
    const row = parent.createDiv({ cls: "ba-link-suggest-row" });

    const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.approved.add(index);
      else this.approved.delete(index);
      this.refreshApplyBtn();
    });

    row.createSpan({ cls: "ba-link-suggest-target", text: `[[${suggestion.targetTitle}]]` });
    // 유사도를 보여줘야 사용자가 "왜 이게 후보인지"를 판단할 수 있다.
    row.createSpan({
      cls: "ba-link-suggest-score",
      text: this.t.linkSuggestSimilarity((suggestion.similarity * 100).toFixed(1)),
    });
  }

  private renderFooter(parent: HTMLElement): void {
    const t = this.t;
    const row = parent.createDiv({ cls: "ba-link-suggest-btn-row" });

    const cancel = row.createEl("button", { text: t.linkSuggestCancel });
    cancel.addEventListener("click", () => this.close());

    this.applyBtn = row.createEl("button", { cls: "mod-cta" });
    this.applyBtn.addEventListener("click", () => void this.handleApply());
    this.refreshApplyBtn();
  }

  private refreshApplyBtn(): void {
    if (!this.applyBtn) return;
    const count = this.approved.size;
    this.applyBtn.setText(this.t.linkSuggestApply(count));
    this.applyBtn.disabled = count === 0 || this.applying;
  }

  private async handleApply(): Promise<void> {
    if (this.applying || this.approved.size === 0) return;
    this.applying = true;
    this.refreshApplyBtn();

    const t = this.t;
    if (this.applyBtn) this.applyBtn.setText(t.linkSuggestApplying);

    const selected = [...this.approved].sort((a, b) => a - b).map((i) => this.suggestions[i]);

    try {
      const result = await this.onApply(selected);
      new Notice(t.linkSuggestApplied(result.notes, result.links));
      this.close();
    } catch (error) {
      // 실패 시 모달을 닫지 않는다 — 선택을 잃고 처음부터 다시 고르게 하지 않는다.
      const message = error instanceof Error ? error.message : String(error);
      console.error("링크 제안 반영 실패:", error);
      new Notice(t.linkSuggestFailed(message));
      this.applying = false;
      this.refreshApplyBtn();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
