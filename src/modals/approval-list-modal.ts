// 승인 목록 모달 공통 골격.
//
// Second Brain의 쓰기 동작은 전부 같은 모양을 갖는다: 후보 목록을 보여주고, 사용자가
// 고른 것만 적용하고, 실패하면 선택을 유지한다. 모순 검토·링크 제안·정규화가 각자
// 체크박스 관리와 버튼 상태와 실패 처리를 따로 구현하면 세 곳에서 따로 틀린다.
//
// 항목을 어떻게 그릴지만 하위 클래스가 정하고, 나머지는 여기서 한 번 정한다.

import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import { VIEW_I18N } from "../chat-view-i18n";

/** 승인 목록 모달의 문구. 기능마다 다르므로 하위 클래스가 제공한다. */
export interface ApprovalLabels {
  title: string;
  /** 무엇이 어떻게 기록되는지 알리는 안내문. 쓰기 동작이므로 항상 보여준다. */
  intro: string;
  /** 반영 버튼 문구. 선택 개수를 받는다. */
  apply: (count: number) => string;
  cancel: string;
  applying: string;
  /** 실패 알림 문구. */
  failed: (message: string) => string;
}

/**
 * 승인 목록 모달.
 *
 * @typeParam T 승인 대상 항목의 타입
 */
export abstract class ApprovalListModal<T> extends Modal {
  protected plugin: GeminiAssistantPlugin;
  protected items: T[];
  /** 승인된 항목의 인덱스. 기본은 빈 집합 — 노트를 고치는 동작은 옵트인이다. */
  private approved = new Set<number>();
  private applyBtn: HTMLButtonElement | null = null;
  /** 반영 중 중복 제출을 막는 가드. */
  private applying = false;

  constructor(app: App, plugin: GeminiAssistantPlugin, items: T[]) {
    super(app);
    this.plugin = plugin;
    this.items = items;
  }

  /** 현재 언어의 라벨 묶음. */
  protected get t(): (typeof VIEW_I18N)[keyof typeof VIEW_I18N] {
    return VIEW_I18N[this.plugin.settings.language] || VIEW_I18N.en;
  }

  /** 이 모달의 문구. */
  protected abstract labels(): ApprovalLabels;

  /** 목록 본문을 그린다. 체크박스는 createCheckbox로 만들어 인덱스를 연결한다. */
  protected abstract renderItems(list: HTMLElement): void;

  /** 승인된 항목을 적용하고 사용자에게 보여줄 요약을 돌려준다. */
  protected abstract applyApproved(approved: T[]): Promise<string>;

  /** contentEl에 붙일 CSS 클래스. */
  protected abstract containerClass(): string;

  /**
   * 항목 인덱스에 연결된 체크박스를 만든다.
   * 하위 클래스는 배치만 하고 상태 관리는 하지 않는다.
   */
  protected createCheckbox(parent: HTMLElement, index: number): HTMLInputElement {
    const checkbox = parent.createEl("input", { attr: { type: "checkbox" } });
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.approved.add(index);
      else this.approved.delete(index);
      this.refreshApplyBtn();
    });
    return checkbox;
  }

  onOpen(): void {
    const { contentEl } = this;
    const labels = this.labels();

    contentEl.empty();
    contentEl.addClass(this.containerClass());
    this.setTitle(labels.title);

    contentEl.createEl("p", { text: labels.intro, cls: "setting-item-description" });

    this.renderItems(contentEl.createDiv({ cls: "ba-approval-list" }));
    this.renderFooter(contentEl, labels);
  }

  private renderFooter(parent: HTMLElement, labels: ApprovalLabels): void {
    const row = parent.createDiv({ cls: "ba-approval-btn-row" });

    const cancel = row.createEl("button", { text: labels.cancel });
    cancel.addEventListener("click", () => this.close());

    this.applyBtn = row.createEl("button", { cls: "mod-cta" });
    this.applyBtn.addEventListener("click", () => void this.handleApply());
    this.refreshApplyBtn();
  }

  /** 선택 개수를 버튼에 반영하고, 0건이거나 반영 중이면 비활성화한다. */
  private refreshApplyBtn(): void {
    if (!this.applyBtn) return;
    const count = this.approved.size;
    this.applyBtn.setText(this.labels().apply(count));
    this.applyBtn.disabled = count === 0 || this.applying;
  }

  private async handleApply(): Promise<void> {
    if (this.applying || this.approved.size === 0) return;
    this.applying = true;
    this.refreshApplyBtn();

    const labels = this.labels();
    if (this.applyBtn) this.applyBtn.setText(labels.applying);

    // 인덱스 순서대로 넘겨 결과 요약과 화면 순서가 어긋나지 않게 한다.
    const selected = [...this.approved].sort((a, b) => a - b).map((i) => this.items[i]);

    try {
      const summary = await this.applyApproved(selected);
      new Notice(summary, 10000);
      this.close();
    } catch (error) {
      // 실패해도 모달을 닫지 않는다 — 닫으면 사용자가 선택을 전부 잃고 처음부터
      // 다시 골라야 한다.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${labels.title} 반영 실패:`, error);
      new Notice(labels.failed(message));
      this.applying = false;
      this.refreshApplyBtn();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
