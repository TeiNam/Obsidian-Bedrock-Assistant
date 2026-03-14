// 회고 모달 (chat-view.ts에서 분리)

import { Modal, TFile, Notice } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { ViewLang } from "../chat-view-i18n";

/**
 * 오늘의 회고를 AI로 생성하여 To-Do 문서에 추가하는 모달
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
    const todoPath = `${todoFolder}/${dateStr}.md`;
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
        await this.generateRetrospective(todoFile as TFile, dateStr);
        new Notice(this.t.retroComplete);
      } catch (error) {
        new Notice(this.t.retroFailed((error as Error).message));
      }
      this.close();
    });
  }

  // 회고 생성 및 To-Do 문서에 추가
  private async generateRetrospective(todoFile: TFile, dateStr: string): Promise<void> {
    const todoContent = await this.app.vault.read(todoFile);

    // 오늘 생성된 파일 수집 (To-Do 파일, 아카이브 비우기 대상 폴더 제외)
    const todoFolder = this.plugin.settings.todoFolder || "ToDo";
    const archiveCleanFolder = this.plugin.settings.archiveCleanFolder || "ToDo/Archive";
    const allFiles = this.app.vault.getFiles();
    const todayStart = new Date(dateStr + "T00:00:00").getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;

    const todayFiles: { path: string; content: string }[] = [];
    for (const file of allFiles) {
      // 생성일이 오늘인 파일만
      if (file.stat.ctime < todayStart || file.stat.ctime >= todayEnd) continue;
      // To-Do 파일 자체 제외
      if (file.path === todoFile.path) continue;
      // 아카이브 비우기 대상 폴더 제외
      if (file.path.startsWith(archiveCleanFolder + "/")) continue;
      // 마크다운 파일만
      if (file.extension !== "md") continue;

      try {
        const content = await this.app.vault.cachedRead(file);
        // 너무 긴 파일은 앞부분만
        todayFiles.push({
          path: file.path,
          content: content.length > 2000 ? content.substring(0, 2000) + "..." : content,
        });
      } catch {
        // 읽기 실패 시 건너뜀
      }
    }

    // AI로 회고 생성
    const lang = this.plugin.settings.language;
    const langLabel = lang === "ko" ? "한국어" : lang === "ja" ? "日本語" : "English";

    const filesContext = todayFiles.length > 0
      ? todayFiles.map((f) => `### ${f.path}\n${f.content}`).join("\n\n")
      : "(No additional files created today)";

    const prompt = `You are a daily retrospective assistant. Analyze the following To-Do document and today's created files, then write a retrospective summary.

Language: Write in ${langLabel}.

## Today's To-Do
${todoContent}

## Files Created Today (${todayFiles.length} files)
${filesContext}

## Instructions
- Summarize what was accomplished today based on the To-Do items and created files
- Note any incomplete tasks and possible reasons
- Provide brief insights or suggestions for improvement
- Keep it concise (under 300 words)
- Use markdown format with a ## heading
- The heading should be "${lang === "ko" ? "📝 오늘의 회고" : lang === "ja" ? "📝 今日の振り返り" : "📝 Daily Retrospective"}"`;

    const { BedrockClient } = await import("../bedrock-client");
    const client = new BedrockClient(this.plugin.settings);
    const result = await client.converseLight(prompt, "You are a helpful retrospective assistant. Write in markdown format.", 2048);

    // To-Do 문서 끝에 회고 추가
    const updatedContent = todoContent.trimEnd() + "\n\n" + result.text.trim() + "\n";
    await this.app.vault.modify(todoFile, updatedContent);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
