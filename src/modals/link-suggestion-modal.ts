// 링크 제안 검토 모달 — 고아·스텁 노트에 붙일 링크 후보를 승인받는다.
//
// 지식 공백 리포트는 "연결되지 않은 노트"를 찾아주지만 무엇에 연결할지는 말하지 않는다.
// 후보 계산은 link-suggestions.ts(순수 함수, LLM 호출 없음)가 하고, 이 모달은 승인만 받는다.
//
// 링크는 그래프를 영구히 바꾸고 이후 모든 검색의 이웃 확장에 영향을 준다. 그래서
// 기본 해제 상태이고, 승인한 것만 적용한다.

import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { LinkSuggestion } from "../second-brain/link-suggestions";
import { groupBySource } from "../second-brain/link-suggestions";
import { ApprovalListModal, type ApprovalLabels } from "./approval-list-modal";

export class LinkSuggestionModal extends ApprovalListModal<LinkSuggestion> {
  constructor(
    app: App,
    plugin: GeminiAssistantPlugin,
    suggestions: LinkSuggestion[],
    private onApply: (approved: LinkSuggestion[]) => Promise<{ notes: number; links: number }>
  ) {
    super(app, plugin, suggestions);
  }

  protected containerClass(): string {
    return "ba-link-suggest-modal";
  }

  protected labels(): ApprovalLabels {
    const t = this.t;
    return {
      title: t.linkSuggestTitle,
      intro: t.linkSuggestIntro,
      apply: t.linkSuggestApply,
      cancel: t.linkSuggestCancel,
      applying: t.linkSuggestApplying,
      failed: t.linkSuggestFailed,
    };
  }

  protected renderItems(list: HTMLElement): void {
    // 노트 단위로 묶어 보여준다. 같은 노트의 후보가 흩어져 있으면 "이 노트에 몇 개를
    // 붙일 것인가"를 판단할 수 없다.
    for (const [sourcePath, group] of groupBySource(this.items)) {
      const card = list.createDiv({ cls: "ba-link-suggest-card" });
      card.createDiv({ cls: "ba-link-suggest-source", text: sourcePath });

      for (const suggestion of group) {
        const row = card.createDiv({ cls: "ba-link-suggest-row" });
        // 전체 배열에서의 위치를 승인 키로 쓴다 — 그룹 내 위치가 아니다.
        this.createCheckbox(row, this.items.indexOf(suggestion));

        row.createSpan({ cls: "ba-link-suggest-target", text: `[[${suggestion.targetTitle}]]` });
        // 유사도를 보여줘야 사용자가 "왜 이게 후보인지"를 판단할 수 있다.
        row.createSpan({
          cls: "ba-link-suggest-score",
          text: this.t.linkSuggestSimilarity((suggestion.similarity * 100).toFixed(1)),
        });
      }
    }
  }

  protected async applyApproved(approved: LinkSuggestion[]): Promise<string> {
    const result = await this.onApply(approved);
    return this.t.linkSuggestApplied(result.notes, result.links);
  }
}
