import { Modal, App, Notice, setIcon, requestUrl, normalizePath } from "obsidian";
import type GeminiAssistantPlugin from "./main";

// 웹 클리퍼 다국어 레이블
const CLIPPER_I18N = {
  en: {
    title: "Web Page Summary",
    urlPlaceholder: "Enter URL (https://...)",
    summarizeBtn: "Summarize",
    cancelBtn: "Cancel",
    fetching: "Fetching web page...",
    summarizing: "Translating & summarizing with AI...",
    saving: "Saving note...",
    done: (path: string) => `Summary saved: ${path}`,
    fetchError: (e: string) => `Failed to fetch page: ${e}`,
    aiError: (e: string) => `AI summary failed: ${e}`,
    invalidUrl: "Please enter a valid URL starting with http:// or https://",
    saveFolder: "WebClips",
  },
  ko: {
    title: "웹 페이지 요약",
    urlPlaceholder: "URL을 입력하세요 (https://...)",
    summarizeBtn: "요약하기",
    cancelBtn: "취소",
    fetching: "웹 페이지를 가져오는 중...",
    summarizing: "AI로 번역 및 요약 중...",
    saving: "노트 저장 중...",
    done: (path: string) => `요약 저장 완료: ${path}`,
    fetchError: (e: string) => `페이지 가져오기 실패: ${e}`,
    aiError: (e: string) => `AI 요약 실패: ${e}`,
    invalidUrl: "http:// 또는 https://로 시작하는 올바른 URL을 입력하세요",
    saveFolder: "WebClips",
  },
  ja: {
    title: "Webページ要約",
    urlPlaceholder: "URLを入力 (https://...)",
    summarizeBtn: "要約する",
    cancelBtn: "キャンセル",
    fetching: "Webページを取得中...",
    summarizing: "AIで翻訳・要約中...",
    saving: "ノートを保存中...",
    done: (path: string) => `要約を保存しました: ${path}`,
    fetchError: (e: string) => `ページ取得失敗: ${e}`,
    aiError: (e: string) => `AI要約失敗: ${e}`,
    invalidUrl: "http:// または https:// で始まる正しいURLを入力してください",
    saveFolder: "WebClips",
  },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClipperLang = Record<string, any>;

/**
 * HTML에서 본문 텍스트를 추출하는 유틸리티
 */
function extractTextFromHtml(html: string): { title: string; body: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // 타이틀 추출
  const title = doc.querySelector("title")?.textContent?.trim() ?? "Untitled";

  // 불필요한 요소 제거
  const removeSelectors = [
    "script", "style", "nav", "footer", "header",
    "iframe", "noscript", "svg", "img", "video", "audio",
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    ".sidebar", ".menu", ".nav", ".footer", ".header", ".ad", ".advertisement",
  ];
  for (const sel of removeSelectors) {
    doc.querySelectorAll(sel).forEach((el) => el.remove());
  }

  // article 또는 main 우선, 없으면 body
  const mainEl = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.body;
  const body = mainEl?.textContent?.replace(/\s+/g, " ").trim() ?? "";

  return { title, body };
}

/**
 * 파일명에 사용할 수 없는 문자를 제거
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * 웹 페이지 URL 입력 모달
 */
export class WebClipperModal extends Modal {
  private plugin: GeminiAssistantPlugin;
  private t: ClipperLang;
  private urlInput!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private submitBtn!: HTMLButtonElement;

  constructor(app: App, plugin: GeminiAssistantPlugin) {
    super(app);
    this.plugin = plugin;
    this.t = CLIPPER_I18N[plugin.settings.language] ?? CLIPPER_I18N.en;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("web-clipper-modal");

    // 타이틀
    contentEl.createEl("h2", { text: this.t.title, cls: "web-clipper-title" });

    // URL 입력
    const inputWrapper = contentEl.createDiv({ cls: "web-clipper-input-wrapper" });
    const iconEl = inputWrapper.createDiv({ cls: "web-clipper-input-icon" });
    setIcon(iconEl, "globe");
    this.urlInput = inputWrapper.createEl("input", {
      type: "url",
      placeholder: this.t.urlPlaceholder,
      cls: "web-clipper-url-input",
    });
    this.urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.handleSubmit();
    });

    // 상태 표시
    this.statusEl = contentEl.createDiv({ cls: "web-clipper-status" });

    // 버튼 영역
    const btnRow = contentEl.createDiv({ cls: "web-clipper-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: this.t.cancelBtn, cls: "web-clipper-btn-cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    this.submitBtn = btnRow.createEl("button", { text: this.t.summarizeBtn, cls: "web-clipper-btn-submit" });
    this.submitBtn.addEventListener("click", () => this.handleSubmit());

    // 포커스
    setTimeout(() => this.urlInput.focus(), 50);
  }

  private setStatus(msg: string, isError = false): void {
    this.statusEl.textContent = msg;
    this.statusEl.toggleClass("web-clipper-status-error", isError);
  }

  private setLoading(loading: boolean): void {
    this.submitBtn.disabled = loading;
    this.urlInput.disabled = loading;
    this.submitBtn.toggleClass("web-clipper-btn-loading", loading);
  }

  private async handleSubmit(): Promise<void> {
    const url = this.urlInput.value.trim();
    if (!url || !/^https?:\/\/.+/i.test(url)) {
      this.setStatus(this.t.invalidUrl, true);
      return;
    }

    this.setLoading(true);
    this.setStatus(this.t.fetching);

    try {
      // 1. 웹 페이지 가져오기
      const html = await this.fetchPage(url);
      const { title, body } = extractTextFromHtml(html);

      if (!body || body.length < 50) {
        this.setStatus(this.t.fetchError("Content too short or empty"), true);
        this.setLoading(false);
        return;
      }

      // 본문이 너무 길면 잘라내기 (토큰 제한 고려)
      const maxChars = 80000;
      const trimmedBody = body.length > maxChars ? body.slice(0, maxChars) + "\n\n[... content truncated ...]" : body;

      // 2. AI로 번역 및 요약 (실패 시 원본 텍스트 앞부분으로 폴백)
      this.setStatus(this.t.summarizing);
      let summary: string;
      try {
        summary = await this.summarizeWithAI(url, title, trimmedBody);
      } catch (e) {
        // AI 요약 실패 시 원본 텍스트 앞부분으로 폴백
        new Notice("AI 요약에 실패하여 원본 텍스트로 저장합니다.");
        summary = body.slice(0, 2000) + (body.length > 2000 ? "\n\n..." : "");
      }

      // 3. 노트로 저장
      this.setStatus(this.t.saving);
      const savedPath = await this.saveAsNote(url, title, summary);

      new Notice(this.t.done(savedPath));
      this.close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus(this.t.aiError(msg), true);
      this.setLoading(false);
    }
  }

  /**
   * 웹 페이지 HTML을 가져옴 (Obsidian requestUrl로 CORS 우회)
   */
  private async fetchPage(url: string): Promise<string> {
    try {
      const resp = await requestUrl({ url });
      return resp.text;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(this.t.fetchError(msg));
    }
  }

  /**
   * Bedrock AI를 사용하여 번역 및 요약 (설정 언어에 따라 동작 변경)
   */
  private async summarizeWithAI(url: string, title: string, body: string): Promise<string> {
    // 별도 웹 요약 모델 없이, 설정에서 선택한 LLM 클라이언트를 그대로 사용한다.
    const client = this.plugin.aiClient;
    const lang = this.plugin.settings.language;
    const langName = lang === "ko" ? "Korean (한국어)" : lang === "ja" ? "Japanese (日本語)" : "English";

    const sectionNames = {
      en: { key: "Key Takeaways", detail: "Detailed Summary", keywords: "Keywords" },
      ko: { key: "핵심 요약", detail: "상세 내용", keywords: "키워드" },
      ja: { key: "要点まとめ", detail: "詳細内容", keywords: "キーワード" },
    };
    const sections = sectionNames[lang] || sectionNames.en;

    const termExample = lang === "ko"
      ? "머신러닝(Machine Learning)"
      : lang === "ja"
        ? "機械学習(Machine Learning)"
        : "Machine Learning(머신러닝)";

    const systemPrompt = `You are an expert content analyst and translator.

Your task:
1. Detect the language of the given web page content.
2. If the content is already in ${langName}, create a comprehensive summary ONLY (no translation needed).
3. If the content is in a different language, translate it into ${langName} AND create a comprehensive summary.

Output format (in ${langName}):
## 📌 ${sections.key}
(3-5 bullet points of the most important takeaways)

## 📖 ${sections.detail}
(Detailed summary organized by topic/section, preserving all important information, data, and arguments. Translate into ${langName} if the source is in a different language.)

## 🔑 ${sections.keywords}
(5-10 relevant keywords/tags)

Rules:
- NEVER skip important details, data points, or arguments
- Preserve technical terms with both ${langName} and original language (e.g., "${termExample}")
- Use clear, natural ${langName}
- Keep the original structure and flow of the article
- Include any statistics, dates, or specific data mentioned`;

    const userPrompts: Record<string, string> = {
      ko: `다음 웹 페이지를 분석하고 한국어로 요약해주세요. 원문이 한국어가 아닌 경우 번역도 함께 해주세요.\n\nURL: ${url}\n제목: ${title}\n\n본문:\n${body}`,
      ja: `以下のWebページを分析し、日本語で要約してください。原文が日本語でない場合は翻訳も行ってください。\n\nURL: ${url}\nタイトル: ${title}\n\n本文:\n${body}`,
      en: `Analyze and summarize the following web page in English. If the source is not in English, translate it as well.\n\nURL: ${url}\nTitle: ${title}\n\nContent:\n${body}`,
    };
    const userPrompt = userPrompts[lang] || userPrompts.en;

    const result = await client.converseLight(userPrompt, systemPrompt, this.plugin.settings.maxTokens);
    return result.text;
  }

  /**
   * 요약 결과를 옵시디언 노트로 저장
   */
  private async saveAsNote(url: string, title: string, summary: string): Promise<string> {
    const folder = normalizePath(this.plugin.settings.webClipFolder || "WebClips");
    const vault = this.app.vault;

    // 폴더 생성 (없으면)
    if (!vault.getAbstractFileByPath(folder)) {
      await vault.createFolder(folder);
    }

    const safeName = sanitizeFilename(title) || "web-clip";
    const date = new Date();
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    const fileName = `${folder}/${safeName}.md`;

    // 중복 방지: 같은 이름이 있으면 숫자 suffix 추가
    let finalPath = fileName;
    let counter = 1;
    while (vault.getAbstractFileByPath(finalPath)) {
      finalPath = `${folder}/${safeName} ${counter}.md`;
      counter++;
    }

    const lang = this.plugin.settings.language;
    const sourceLabel = lang === "ko" ? "원문" : lang === "ja" ? "原文" : "Source";
    const dateLabel = lang === "ko" ? "클리핑 날짜" : lang === "ja" ? "クリップ日" : "Clipped";

    const content = `---
source: "${url}"
created: ${dateStr}
type: web-clip
tags: [web-clip]
---

# ${title}

> 🔗 ${sourceLabel}: [${url}](${url})
> 📅 ${dateLabel}: ${dateStr}

${summary}
`;

    await vault.create(finalPath, content);
    return finalPath;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
