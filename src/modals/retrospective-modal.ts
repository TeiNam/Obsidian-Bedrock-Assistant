// 회고 모달 (chat-view.ts에서 분리)
// 공통 서비스(retrospective-service)를 호출하여 회고를 생성한다.

import { Modal, TFile, Notice, normalizePath } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import { generateRetrospective } from "../retrospective-service";

/**
 * 오늘의 회고를 AI로 생성하여 To-Do 문서에 추가하는 모달.
 * 회고 생성 로직은 retrospective-service 공통 모듈에 위임한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class RetrospectiveModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  private t: Record<string, any>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(app: App, plugin: GeminiAssistantPlugin, t: Record<string, any>) {
    super(app);
    this.plugin = plugin;
    this.t = t;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    // 모달 컨테이너에 클래스 추가 (사이즈 제어)
    this.modalEl.addClass("ba-retro-modal");
    contentEl.addClass("ba-retro-content");

    // 오늘자 To-Do 파일 존재 확인
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const todoFolder = this.plugin.settings.todoFolder || "ToDo";
    const todoPath = normalizePath(`${todoFolder}/${dateStr}.md`);
    const todoFile = this.app.vault.getAbstractFileByPath(todoPath);

    if (!todoFile || !(todoFile instanceof TFile)) {
      // 오늘자 문서 없음 경고
      contentEl.createEl("h2", { text: this.t.retroConfirmTitle });
      contentEl.createEl("p", { text: this.t.retroNoTodo, cls: "ba-retro-warning" });
      const btnRow = contentEl.createDiv({ cls: "ba-retro-btn-row" });
      const okBtn = btnRow.createEl("button", { text: this.t.retroOk, cls: "mod-cta" });
      okBtn.addEventListener("click", () => this.close());
      return;
    }

    // 할 일 완료 여부 확인 모달
    contentEl.createEl("h2", { text: this.t.retroConfirmTitle });
    contentEl.createEl("p", { text: this.t.retroConfirmMessage, cls: "ba-retro-message" });

    const btnRow = contentEl.createDiv({ cls: "ba-retro-btn-row" });
    const notYetBtn = btnRow.createEl("button", { text: this.t.retroNotYet });
    notYetBtn.addEventListener("click", () => this.close());

    const doneBtn = btnRow.createEl("button", { text: this.t.retroDone, cls: "mod-cta" });
    doneBtn.addEventListener("click", async () => {
      contentEl.empty();
      contentEl.createEl("h2", { text: this.t.retroConfirmTitle });
      contentEl.createEl("p", { text: this.t.retroGenerating, cls: "ba-retro-message" });

      try {
        // 공통 서비스를 호출하여 회고 생성 (BedrockClient 직접 생성 대신 aiClient 사용)
        const result = await generateRetrospective({
          app: this.app,
          settings: this.plugin.settings,
          aiClient: this.plugin.aiClient,
        });

        if (result.success) {
          new Notice(this.t.retroComplete);
        } else if (result.message) {
          // 서비스에서 에러 메시지가 반환된 경우
          new Notice(this.t.retroFailed(result.message));
        }
      } catch (error) {
        new Notice(this.t.retroFailed((error as Error).message));
      }
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
