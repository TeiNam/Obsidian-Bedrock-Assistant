// 모순 검토·반영 모달 — runReconcile이 찾은 모순을 보여주고 승인한 것만 노트에 반영한다.
//
// reconcile은 의도적으로 2단계로 나뉘어 있다(Req 8.2/8.4). 1단계 runReconcile은 비파괴로
// 모순 후보만 찾고, 2단계 applyReconciliation은 "명시적 사용자 승인" 경로에서만 노트를
// 고친다. 스케줄러(자동) 경로는 2단계를 절대 호출하지 않는다.
//
// 2단계 구현과 테스트는 처음부터 있었지만 이 승인 화면이 없어 도달할 수 없었다.
// 이 모달이 그 유일한 진입점이다.

import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { Contradiction } from "../second-brain/reconcile";
import { VIEW_I18N } from "../chat-view-i18n";

export class ReconcileReviewModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  private contradictions: Contradiction[];
  /** 승인된 항목의 인덱스. 기본은 빈 집합 — 노트를 고치는 동작이므로 옵트인이다. */
  private approved = new Set<number>();
  private applyBtn: HTMLButtonElement | null = null;
  /** 반영 중 중복 제출을 막는 가드. */
  private applying = false;

  /**
   * @param onApply 승인된 항목을 반영하는 콜백. 모달은 SecondBrainContext를 알지 않는다 —
   *   입력 수집과 실행을 분리하는 SecondBrainInputModal의 규약을 따른다.
   */
  constructor(
    app: App,
    plugin: GeminiAssistantPlugin,
    contradictions: Contradiction[],
    private onApply: (approved: Contradiction[]) => Promise<string>
  ) {
    super(app);
    this.plugin = plugin;
    this.contradictions = contradictions;
  }

  /** 현재 언어의 라벨 묶음. */
  private get t(): (typeof VIEW_I18N)[keyof typeof VIEW_I18N] {
    return VIEW_I18N[this.plugin.settings.language] || VIEW_I18N.en;
  }

  onOpen(): void {
    const { contentEl } = this;
    const t = this.t;

    contentEl.empty();
    contentEl.addClass("ba-reconcile-modal");
    this.setTitle(t.reconcileReviewTitle);

    // 이 모달은 노트를 고친다. 무엇이 보존되는지 먼저 알린다.
    contentEl.createEl("p", {
      text: t.reconcileReviewIntro,
      cls: "setting-item-description",
    });

    const list = contentEl.createDiv({ cls: "ba-reconcile-list" });
    this.contradictions.forEach((item, index) => {
      this.renderItem(list, item, index);
    });

    this.renderFooter(contentEl);
  }

  /** 모순 한 건을 체크박스 + 근거로 렌더한다. */
  private renderItem(parent: HTMLElement, item: Contradiction, index: number): void {
    const t = this.t;
    const card = parent.createDiv({ cls: "ba-reconcile-card" });

    const head = card.createDiv({ cls: "ba-reconcile-head" });
    const checkbox = head.createEl("input", { attr: { type: "checkbox" } });
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.approved.add(index);
      else this.approved.delete(index);
      this.refreshApplyBtn();
    });

    // 대상 노트 — 무엇이 고쳐지는지가 가장 중요한 정보이므로 헤드에 둔다.
    head.createSpan({
      cls: "ba-reconcile-paths",
      text: `${t.reconcileReviewNotes}: ${item.notePaths.join(", ")}`,
    });

    const body = card.createDiv({ cls: "ba-reconcile-body" });

    body.createDiv({ cls: "ba-reconcile-label", text: t.reconcileReviewStatements });
    const statements = body.createEl("ul", { cls: "ba-reconcile-statements" });
    for (const s of item.statements) {
      statements.createEl("li", { text: s });
    }

    body.createDiv({ cls: "ba-reconcile-label", text: t.reconcileReviewSuggestion });
    body.createDiv({ cls: "ba-reconcile-suggestion", text: item.suggestion });
  }

  private renderFooter(parent: HTMLElement): void {
    const t = this.t;
    const row = parent.createDiv({ cls: "ba-reconcile-btn-row" });

    const cancel = row.createEl("button", { text: t.reconcileReviewCancel });
    cancel.addEventListener("click", () => this.close());

    this.applyBtn = row.createEl("button", { cls: "mod-cta" });
    this.applyBtn.addEventListener("click", () => void this.handleApply());
    this.refreshApplyBtn();
  }

  /** 선택 개수를 버튼에 반영하고, 0건이면 비활성화한다. */
  private refreshApplyBtn(): void {
    if (!this.applyBtn) return;
    const count = this.approved.size;
    this.applyBtn.setText(this.t.reconcileReviewApply(count));
    this.applyBtn.disabled = count === 0 || this.applying;
  }

  private async handleApply(): Promise<void> {
    if (this.applying || this.approved.size === 0) return;
    this.applying = true;
    this.refreshApplyBtn();

    const t = this.t;
    if (this.applyBtn) this.applyBtn.setText(t.reconcileReviewApplying);

    // 인덱스 순서대로 넘겨 결과 요약과 화면 순서가 어긋나지 않게 한다.
    const selected = [...this.approved].sort((a, b) => a - b).map((i) => this.contradictions[i]);

    try {
      const summary = await this.onApply(selected);
      new Notice(`${t.reconcileReviewApplied(selected.length)}\n${summary}`);
      this.close();
    } catch (error) {
      // 실패해도 모달을 닫지 않는다 — 사용자가 선택을 잃지 않고 다시 시도할 수 있다.
      const message = error instanceof Error ? error.message : String(error);
      console.error("모순 반영 실패:", error);
      new Notice(t.reconcileReviewFailed(message));
      this.applying = false;
      this.refreshApplyBtn();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
