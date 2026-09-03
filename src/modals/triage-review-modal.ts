// Inbox 검토 모달 — 새 캡처 노트의 정리 제안을 승인받는다.
//
// 이름 변경·이동은 되돌리기 번거로운 동작이다. 무엇이 어떻게 바뀌는지 항목별로 다
// 보여주고, 승인한 것만 적용한다.

import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { TriagePlan } from "../second-brain/inbox-triage";
import { ApprovalListModal, type ApprovalLabels } from "./approval-list-modal";

export interface TriageResult {
  moved: number;
  tagged: number;
  skipped: number;
}

export class TriageReviewModal extends ApprovalListModal<TriagePlan> {
  constructor(
    app: App,
    plugin: GeminiAssistantPlugin,
    plans: TriagePlan[],
    private onApply: (approved: TriagePlan[]) => Promise<TriageResult>
  ) {
    super(app, plugin, plans);
  }

  protected containerClass(): string {
    return "ba-triage-modal";
  }

  protected labels(): ApprovalLabels {
    const t = this.t;
    return {
      title: t.triageTitle,
      intro: t.triageIntro,
      apply: t.triageApply,
      cancel: t.triageCancel,
      applying: t.triageApplying,
      failed: t.triageFailed,
    };
  }

  protected renderItems(list: HTMLElement): void {
    const t = this.t;

    this.items.forEach((item, index) => {
      const card = list.createDiv({ cls: "ba-triage-card" });

      const head = card.createDiv({ cls: "ba-triage-head" });
      this.createCheckbox(head, index);
      head.createSpan({ cls: "ba-triage-path", text: item.path });

      const body = card.createDiv({ cls: "ba-triage-body" });

      // 바뀌는 것을 하나씩 나열한다 — "무엇이 어떻게 되는가"를 묶어 보여주면
      // 사용자가 이름 변경만 원하는데 이동까지 승인하게 된다.
      if (item.suggestedTitle !== "") {
        body.createDiv({ cls: "ba-triage-change", text: t.triageRename(item.suggestedTitle) });
      }
      if (item.suggestedFolder !== "") {
        body.createDiv({ cls: "ba-triage-change", text: t.triageMove(item.suggestedFolder) });
      }
      if (item.tags.length > 0) {
        body.createDiv({
          cls: "ba-triage-change",
          text: t.triageTags(item.tags.map((tag) => `#${tag}`).join(" ")),
        });
      }
      if (item.splitHint !== "") {
        // 분할은 자동으로 하지 않는다 — 어디서 나눌지는 사람이 판단해야 한다.
        body.createDiv({
          cls: "ba-triage-split",
          text: `${t.triageSplit}: ${item.splitHint}`,
        });
      }

      if (item.reason !== "") {
        body.createDiv({ cls: "ba-triage-reason", text: item.reason });
      }
    });
  }

  protected async applyApproved(approved: TriagePlan[]): Promise<string> {
    const r = await this.onApply(approved);
    return this.t.triageApplied(r.moved, r.tagged, r.skipped);
  }
}
