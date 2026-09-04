import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { I18N } from "./settings-tab";

/**
 * 옵시디언 커뮤니티 플러그인 심사 기준 중, 코드를 읽어야 확인되는 항목을 고정한다.
 *
 * 이 기준들은 위반하면 심사에서 리젝된다. 사람이 매번 눈으로 확인하는 대신 테스트로
 * 잡는다 — 한 번 고쳐도 새 설정 항목을 추가할 때 다시 어긋나기 때문이다.
 */

/** 첫 단어 뒤에도 대문자로 남겨야 하는 고유명사·약어. */
const PROPER_NOUNS = new Set([
  "AI", "MCP", "API", "URL", "AWS", "OpenAI", "Ollama", "Gemini", "Bedrock",
  "Obsidian", "Graph", "RAG", "Second", "Brain", "JSON", "To-Do", "ID", "Code",
  "Styler", "Tasks", "LLM", "LLMs", "Agent", "Inbox", "Wiki", "Markdown",
  "Bases", "Canvas", "Web", "Clipper", "Do", "Documentation", "P.A.R.A",
]);

describe("설정 레이블 Sentence case (심사 기준)", () => {
  /**
   * 설명(`*Desc`)·플레이스홀더·파일명은 대상이 아니다. 설명은 완결된 문장이고,
   * 파일명(`README-KR.md`)은 실제 경로다.
   */
  const isLabelKey = (key: string) =>
    !key.endsWith("Desc") && !key.endsWith("Placeholder") && !key.endsWith("File");

  it("en 레이블에 Title Case가 없다", () => {
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(I18N.en)) {
      if (typeof value !== "string" || !isLabelKey(key)) continue;
      // 완결된 문장(마침표로 끝나거나 문장 구분이 있는 값)은 레이블이 아니라 안내문이다.
      if (/\.(\s|$)/.test(value.trim())) continue;
      const words = value.trim().split(/\s+/);
      if (words.length < 2) continue;
      for (const word of words.slice(1)) {
        const bare = word.replace(/^[^A-Za-z]+|[^A-Za-z-]+$/g, "");
        if (bare === "" || !/^[A-Z]/.test(bare)) continue;
        if (PROPER_NOUNS.has(bare)) continue;
        offenders.push(`${key}: "${value}" → "${bare}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("리젝 사유 코드 패턴 (심사 기준)", () => {
  const SOURCES = [
    "src/main.ts",
    "src/chat-view.ts",
    "src/settings-tab.ts",
    "src/obsidian-tools.ts",
    "src/vault-indexer.ts",
    "src/web-clipper.ts",
  ];

  /** 발견 시 즉시 리젝되는 패턴. 주석은 제외하고 실제 코드만 본다. */
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["innerHTML", /\.innerHTML\s*=/],
    ["outerHTML", /\.outerHTML\s*=/],
    ["insertAdjacentHTML", /insertAdjacentHTML\(/],
    ["window.app", /\bwindow\.app\b/],
    ["var 선언", /^\s*var\s+\w/m],
    ["console.log", /\bconsole\.log\(/],
    ["console.warn", /\bconsole\.warn\(/],
    ["console.debug", /\bconsole\.debug\(/],
    ["workspace.activeLeaf", /workspace\.activeLeaf/],
    ["detachLeavesOfType", /detachLeavesOfType\(/],
    ["eval", /\beval\(/],
    ["new Function", /new Function\(/],
    ["설정 탭 createEl(\"h2\")", /createEl\(\s*"h[1-3]"/],
  ];

  for (const [name, pattern] of FORBIDDEN) {
    it(`${name}을 쓰지 않는다`, () => {
      const hits: string[] = [];
      for (const file of SOURCES) {
        const lines = readFileSync(file, "utf-8").split("\n");
        lines.forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
          if (pattern.test(code)) hits.push(`${file}:${i + 1}`);
        });
      }
      expect(hits).toEqual([]);
    });
  }
});
