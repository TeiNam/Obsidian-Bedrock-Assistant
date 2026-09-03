// 중복 후보 검토 모달 — 정본 후보와 흡수 대상을 보여주고 승인받는다.
//
// 아무것도 지우거나 합치지 않는다. 승인하면 정본 노트에 별칭과 후보 목록을 기록하는
// 것까지다 — 오병합은 되돌리기 가장 어려운 손실이므로 판단은 사용자에게 남긴다.

import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { DuplicateCluster } from "../second-brain/canonicalize";
import { ApprovalListModal, type ApprovalLabels } from "./approval-list-modal";

export class CanonicalizeModal extends ApprovalListModal<DuplicateCluster> {
  constructor(
    app: App,
    plugin: GeminiAssistantPlugin,
    clusters: DuplicateCluster[],
    private onApply: (approved: DuplicateCluster[]) => Promise<{ notes: number; aliases: number }>
  ) {
    super(app, plugin, clusters);
  }

  protected containerClass(): string {
    return "ba-canonical-modal";
  }

  protected labels(): ApprovalLabels {
    const t = this.t;
    return {
      title: t.canonicalTitle,
      intro: t.canonicalIntro,
      apply: t.canonicalApply,
      cancel: t.canonicalCancel,
      applying: t.canonicalApplying,
      failed: t.canonicalFailed,
    };
  }

  protected renderItems(list: HTMLElement): void {
    const t = this.t;

    this.items.forEach((cluster, index) => {
      const card = list.createDiv({ cls: "ba-canonical-card" });

      const head = card.createDiv({ cls: "ba-canonical-head" });
      this.createCheckbox(head, index);
      head.createSpan({ cls: "ba-canonical-label", text: t.canonicalCanonical });
      head.createSpan({ cls: "ba-canonical-path", text: cluster.canonical.path });
      // 정본을 왜 이 노트로 골랐는지 근거를 보여준다 — 링크 수와 본문 길이 순이다.
      head.createSpan({
        cls: "ba-canonical-evidence",
        text: t.canonicalEvidence(cluster.canonical.linkCount, cluster.canonical.bodyLength),
      });

      const body = card.createDiv({ cls: "ba-canonical-body" });
      body.createDiv({ cls: "ba-canonical-label", text: t.canonicalAbsorb });
      const ul = body.createEl("ul", { cls: "ba-canonical-list-items" });
      for (const d of cluster.duplicates) {
        ul.createEl("li", {
          text: `${d.path} — ${(d.similarity * 100).toFixed(1)}% · ${t.canonicalEvidence(
            d.linkCount,
            d.bodyLength
          )}`,
        });
      }
    });
  }

  protected async applyApproved(approved: DuplicateCluster[]): Promise<string> {
    const result = await this.onApply(approved);
    return this.t.canonicalApplied(result.notes, result.aliases);
  }
}
