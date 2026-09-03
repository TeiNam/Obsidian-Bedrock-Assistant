// Second Brain Layer 명령 팔레트 입력 모달 (Req 12.3)
// ===================================================
// 채팅 경로는 LLM이 ToolExecutor.execute(name, input)에 input(topic/claim/days 등)을
// 채워 호출하지만, 명령 팔레트 경로에는 사용자 텍스트 입력이 없다. 따라서 각 도구가
// 요구하는 인자를 입력받는 얇은 모달을 둔다. 모달은 "입력 수집"만 담당하고, 수집된 값으로
// 채팅 경로와 동일한 실행 래퍼/핸들러를 호출한다(로직 중복 금지, DRY). 모달은 입력 UI이므로
// 단위 테스트 대상에서 제외하며, 실행 래퍼만 모킹 테스트한다(설계 §12 참조).
//
// 브랜딩 무관(Req 12.5): 이 모달은 플러그인 이름/ID를 하드코딩하지 않는다.

import { Modal } from "obsidian";
import type { App } from "obsidian";

/** 모달에서 수집할 입력 필드 1개의 명세. */
export interface SecondBrainField {
  /** 수집된 값이 담길 입력 키 (예: "topic", "claim", "days"). */
  key: string;
  /** 사용자에게 보여줄 레이블(한국어). */
  label: string;
  /** 입력 컨트롤 종류. */
  type: "text" | "textarea" | "number";
  /** 플레이스홀더(선택). */
  placeholder?: string;
  /** 기본값(선택). 활성 노트 제목/선택 텍스트 등으로 프리필한다. */
  defaultValue?: string;
}

/** SecondBrainInputModal 생성 옵션. */
export interface SecondBrainModalOptions {
  /** 모달 제목(한국어). */
  title: string;
  /** 수집할 입력 필드 목록(순서대로 렌더). */
  fields: SecondBrainField[];
  /** 실행 버튼 레이블(한국어). */
  submitLabel: string;
  /**
   * 입력 수집 완료 시 호출되는 콜백. 채팅 경로와 동일한 실행 핸들러를 호출하도록
   * main.ts가 주입한다(DRY). 수집된 값은 key→문자열 맵으로 전달된다.
   */
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
}

/**
 * Second Brain 도구용 범용 입력 모달.
 *
 * 텍스트/멀티라인/숫자 필드를 받아 수집만 수행한 뒤 onSubmit으로 넘긴다. 실행 로직은
 * 일절 포함하지 않으며(입력 UI 책임만), 모든 도구 실행은 채팅과 동일한 핸들러를 공유한다.
 */
export class SecondBrainInputModal extends Modal {
  private opts: SecondBrainModalOptions;
  /** 각 필드 key → 입력 엘리먼트 참조. */
  private inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  /** 중복 제출 방지 가드. */
  private submitted = false;

  constructor(app: App, opts: SecondBrainModalOptions) {
    super(app);
    this.opts = opts;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ba-second-brain-modal");

    this.setTitle(this.opts.title);

    // 필드 렌더 — 첫 입력에 포커스를 준다.
    let firstControl: HTMLInputElement | HTMLTextAreaElement | null = null;
    for (const field of this.opts.fields) {
      const row = contentEl.createDiv({ cls: "ba-second-brain-field" });
      row.createEl("label", { text: field.label });

      let control: HTMLInputElement | HTMLTextAreaElement;
      if (field.type === "textarea") {
        control = row.createEl("textarea", {
          cls: "ba-second-brain-input",
        });
      } else {
        control = row.createEl("input", {
          type: field.type === "number" ? "number" : "text",
          cls: "ba-second-brain-input",
        });
      }
      if (field.placeholder) control.setAttribute("placeholder", field.placeholder);
      if (field.defaultValue !== undefined) control.value = field.defaultValue;

      // 텍스트/숫자 단일 라인 입력은 Enter로 제출을 허용한다(멀티라인 textarea 제외).
      if (field.type !== "textarea") {
        control.addEventListener("keydown", (e: Event) => {
          if ((e as KeyboardEvent).key === "Enter") {
            e.preventDefault();
            void this.handleSubmit();
          }
        });
      }

      this.inputs.set(field.key, control);
      if (!firstControl) firstControl = control;
    }

    // 버튼 행
    const btnRow = contentEl.createDiv({ cls: "ba-second-brain-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: "취소" });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = btnRow.createEl("button", {
      text: this.opts.submitLabel,
      cls: "mod-cta",
    });
    submitBtn.addEventListener("click", () => void this.handleSubmit());

    // 첫 입력에 포커스
    if (firstControl) firstControl.focus();
  }

  /** 입력값을 수집하여 onSubmit으로 위임한 뒤 모달을 닫는다. */
  private async handleSubmit(): Promise<void> {
    if (this.submitted) return;
    this.submitted = true;

    const values: Record<string, string> = {};
    for (const [key, control] of this.inputs) {
      values[key] = control.value;
    }

    // 모달을 먼저 닫고 실행을 위임한다(실행 결과 표시는 핸들러 책임).
    this.close();
    await this.opts.onSubmit(values);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
