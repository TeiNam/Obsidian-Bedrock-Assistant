// 지난 대화 세션 목록 모달 (chat-view.ts에서 분리)

import { Modal, Notice, setIcon } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "../main";
import type { ChatSession } from "../types";
import type { ViewLang } from "../chat-view-i18n";
import { filterSessions, type HighlightSegment } from "../session-search";
import { harvestSession } from "../conversation-harvest";

/**
 * 지난 대화 세션 목록을 표시하고 선택/삭제할 수 있는 모달
 */
export class SessionListModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  private sessions: ChatSession[];
  private t: ViewLang;
  private onSelect: (session: ChatSession) => void;
  private listEl: HTMLDivElement | null = null;

  constructor(
    app: App,
    plugin: GeminiAssistantPlugin,
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
    this.setTitle(this.t.chatHistory);

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

      // 하이라이트된 제목 (DOM API로 안전하게 렌더링)
      const titleEl = infoEl.createDiv({ cls: "ba-session-title" });
      this.renderSegments(titleEl, result.titleSegments);

      // 날짜 정보
      const date = new Date(session.updatedAt);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      infoEl.createDiv({
        cls: "ba-session-date",
        text: `${this.t.sessionDate(dateStr)} · ${session.messages.length} messages`,
      });

      // 검색어가 있고 첫 메시지에서 매칭된 경우 미리보기 표시
      if (query.trim() && result.previewSegments.length > 0) {
        const previewEl = infoEl.createDiv({ cls: "ba-session-preview" });
        this.renderSegments(previewEl, result.previewSegments);
      }

      infoEl.addEventListener("click", () => {
        this.onSelect(session);
        this.close();
      });

      // 결론 수확 버튼 — 대화에서 결론만 뽑아 검색 가능한 볼트 노트로 만든다.
      // 세션은 50개 상한으로 조용히 소멸하므로, 남길 가치가 있는 결론은 노트로 옮겨야 한다.
      const harvestBtn = row.createDiv({
        cls: "ba-session-harvest",
        attr: { "aria-label": this.t.harvestSession },
      });
      setIcon(harvestBtn, "sprout");
      harvestBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.harvest(session, harvestBtn);
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

  /**
   * 세션에서 결론을 수확해 볼트 노트로 저장한다.
   * 진행 중에는 버튼을 비활성화해 같은 세션에 중복 LLM 호출이 나가지 않게 한다.
   */
  private async harvest(session: ChatSession, button: HTMLElement): Promise<void> {
    if (button.hasClass("is-busy")) return;
    button.addClass("is-busy");
    const notice = new Notice(this.t.harvestRunning, 0);

    try {
      const result = await harvestSession(
        {
          app: this.app,
          aiClient: this.plugin.aiClient,
          wikiFolder: this.plugin.settings.secondBrain.wikiFolder,
          language: this.plugin.settings.language,
          enabled: this.plugin.settings.secondBrain.enabled,
        },
        session,
      );
      new Notice(result.message ?? "");
    } catch (error) {
      new Notice(String(error));
    } finally {
      notice.hide();
      button.removeClass("is-busy");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** 하이라이트 세그먼트를 DOM API로 안전하게 렌더링 */
  private renderSegments(container: HTMLElement, segments: HighlightSegment[]): void {
    for (const seg of segments) {
      if (seg.highlight) {
        container.createEl("mark", { text: seg.text, cls: "ba-search-highlight" });
      } else {
        container.appendText(seg.text);
      }
    }
  }
}
