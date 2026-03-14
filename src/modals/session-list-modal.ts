// 지난 대화 세션 목록 모달 (chat-view.ts에서 분리)

import { Modal, setIcon } from "obsidian";
import type { App } from "obsidian";
import type BedrockAssistantPlugin from "../main";
import type { ChatSession } from "../types";
import type { ViewLang } from "../chat-view-i18n";
import { filterSessions } from "../session-search";

/**
 * 지난 대화 세션 목록을 표시하고 선택/삭제할 수 있는 모달
 */
export class SessionListModal extends Modal {
  private plugin: BedrockAssistantPlugin;
  private sessions: ChatSession[];
  private t: ViewLang;
  private onSelect: (session: ChatSession) => void;
  private listEl: HTMLDivElement | null = null;

  constructor(
    app: App,
    plugin: BedrockAssistantPlugin,
    sessions: ChatSession[],
    t: ViewLang,
    onSelect: (session: ChatSession) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.sessions = sessions;
    this.t = t;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.t.chatHistory });

    // 검색 입력 필드 추가
    const searchContainer = contentEl.createDiv({ cls: "ba-session-search" });
    const searchInput = searchContainer.createEl("input", {
      type: "text",
      placeholder: this.t.sessionSearch,
      cls: "ba-session-search-input",
    });

    // 세션 목록 컨테이너
    this.listEl = contentEl.createDiv({ cls: "ba-session-list" });

    // 초기 렌더링 (전체 세션)
    this.renderFilteredSessions("");

    // 실시간 필터링 (keyup 이벤트)
    searchInput.addEventListener("keyup", () => {
      this.renderFilteredSessions(searchInput.value);
    });

    // 모달 열릴 때 검색 입력에 포커스
    searchInput.focus();
  }

  /** 검색어로 필터링된 세션 목록을 렌더링 */
  private renderFilteredSessions(query: string): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const results = filterSessions(this.sessions, query);

    if (results.length === 0) {
      const msg = query.trim()
        ? this.t.sessionSearchNoResults
        : this.t.noSessions;
      this.listEl.createEl("p", { text: msg, cls: "setting-item-description" });
      return;
    }

    for (const result of results) {
      const session = result.session;
      const row = this.listEl.createDiv({ cls: "ba-session-row" });

      // 세션 정보 (클릭하면 복원)
      const infoEl = row.createDiv({ cls: "ba-session-info" });

      // 하이라이트된 제목 (innerHTML 사용)
      const titleEl = infoEl.createDiv({ cls: "ba-session-title" });
      titleEl.innerHTML = result.highlightedTitle;

      // 날짜 정보
      const date = new Date(session.updatedAt);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      infoEl.createDiv({
        cls: "ba-session-date",
        text: `${this.t.sessionDate(dateStr)} · ${session.messages.length} messages`,
      });

      // 검색어가 있고 첫 메시지에서 매칭된 경우 미리보기 표시
      if (query.trim() && result.highlightedPreview) {
        const previewEl = infoEl.createDiv({ cls: "ba-session-preview" });
        previewEl.innerHTML = result.highlightedPreview;
      }

      infoEl.addEventListener("click", () => {
        this.onSelect(session);
        this.close();
      });

      // 삭제 버튼
      const delBtn = row.createDiv({ cls: "ba-session-delete", attr: { "aria-label": this.t.deleteSession } });
      setIcon(delBtn, "trash-2");
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        this.sessions = this.sessions.filter((s) => s.id !== session.id);
        await this.plugin.saveSessions(this.sessions);
        row.remove();
        if (this.sessions.length === 0) {
          this.listEl?.empty();
          this.listEl?.createEl("p", { text: this.t.noSessions, cls: "setting-item-description" });
        }
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
