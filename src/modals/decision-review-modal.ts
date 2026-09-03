// 결정 검토 모달 — 추출된 결정을 보여주고 승인한 것만 원장에 병합한다.
//
// LLM은 추출만 하고 상태 판정·병합은 규칙이 처리한다. 이 모달은 그 사이에서 "이게 정말
// 결정인가"를 사람이 판정하게 한다 — 아이디어를 결정으로 기록하면 원장이 오염되고,
// 오염된 원장은 "왜 X를 선택했나"에 잘못 답한다.

import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { DecisionEntry } from "../second-brain/decisions";
import { ApprovalListModal, type ApprovalLabels } from "./approval-list-modal";

const STATUS_TEXT: Record<DecisionEntry["status"], string> = {
  open: "열림",
  done: "완료",
  superseded: "대체됨",
};

export class DecisionReviewModal extends ApprovalListModal<DecisionEntry> {
  constructor(
    app: App,
    plugin: GeminiAssistantPlugin,
    decisions: DecisionEntry[],
    private onApply: (approved: DecisionEntry[]) => Promise<{ merged: number; total: number }>
  ) {
    super(app, plugin, decisions);
  }

  protected containerClass(): string {
    return "ba-decision-modal";
  }

  protected labels(): ApprovalLabels {
    const t = this.t;
    return {
      title: t.decisionTitle,
      intro: t.decisionIntro,
      apply: t.decisionApply,
      cancel: t.decisionCancel,
      applying: t.decisionApplying,
      failed: t.decisionFailed,
    };
  }

  protected renderItems(list: HTMLElement): void {
    const t = this.t;

    this.items.forEach((item, index) => {
      const card = list.createDiv({ cls: "ba-decision-card" });

      const head = card.createDiv({ cls: "ba-decision-head" });
      this.createCheckbox(head, index);
      head.createSpan({ cls: "ba-decision-text", text: item.decision });
      head.createSpan({ cls: "ba-decision-status", text: STATUS_TEXT[item.status] });

      const body = card.createDiv({ cls: "ba-decision-body" });

      // 이유가 비면 원장의 가치가 절반으로 줄어드니 빈 것도 드러내 보여준다.
      body.createDiv({
        cls: "ba-decision-field",
        text: `${t.decisionRationale}: ${item.rationale || "—"}`,
      });

      const meta: string[] = [];
      if (item.owner !== "") meta.push(item.owner);
      if (item.due !== "") meta.push(item.due);
      if (meta.length > 0) {
        body.createDiv({ cls: "ba-decision-field", text: meta.join(" · ") });
      }

      // 출처는 승인 판정의 핵심 근거다 — 확인할 수 없으면 승인해선 안 된다.
      body.createDiv({
        cls: "ba-decision-sources",
        text: `${t.decisionSources}: ${item.sources.join(", ")}`,
      });
    });
  }

  protected async applyApproved(approved: DecisionEntry[]): Promise<string> {
    const result = await this.onApply(approved);
    return this.t.decisionApplied(result.merged, result.total);
  }
}
