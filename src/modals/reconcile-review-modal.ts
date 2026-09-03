// 모순 검토·반영 모달 — runReconcile이 찾은 모순을 보여주고 승인한 것만 노트에 반영한다.
//
// reconcile은 의도적으로 2단계로 나뉘어 있다(Req 8.2/8.4). 1단계 runReconcile은 비파괴로
// 모순 후보만 찾고, 2단계 applyReconciliation은 "명시적 사용자 승인" 경로에서만 노트를
// 고친다. 스케줄러(자동) 경로는 2단계를 절대 호출하지 않는다.
//
// 2단계 구현과 테스트는 처음부터 있었지만 이 승인 화면이 없어 도달할 수 없었다.
// 이 모달이 그 유일한 진입점이다.

import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { Contradiction } from "../second-brain/reconcile";
import { ApprovalListModal, type ApprovalLabels } from "./approval-list-modal";

export class ReconcileReviewModal extends ApprovalListModal<Contradiction> {
  constructor(
    app: App,
    plugin: GeminiAssistantPlugin,
    contradictions: Contradiction[],
    private onApply: (approved: Contradiction[]) => Promise<string>
  ) {
    super(app, plugin, contradictions);
  }

  protected containerClass(): string {
    return "ba-reconcile-modal";
  }

  protected labels(): ApprovalLabels {
    const t = this.t;
    return {
      title: t.reconcileReviewTitle,
      intro: t.reconcileReviewIntro,
      apply: t.reconcileReviewApply,
      cancel: t.reconcileReviewCancel,
      applying: t.reconcileReviewApplying,
      failed: t.reconcileReviewFailed,
    };
  }

  protected renderItems(list: HTMLElement): void {
    const t = this.t;

    this.items.forEach((item, index) => {
      const card = list.createDiv({ cls: "ba-reconcile-card" });

      const head = card.createDiv({ cls: "ba-reconcile-head" });
      this.createCheckbox(head, index);
      // 대상 노트 — 무엇이 고쳐지는지가 승인 판단에 가장 중요하므로 헤드에 둔다.
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
    });
  }

  protected async applyApproved(approved: Contradiction[]): Promise<string> {
    const summary = await this.onApply(approved);
    return `${this.t.reconcileReviewApplied(approved.length)}\n${summary}`;
  }
}
