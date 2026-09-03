import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { formatNoteLink, formatAnchorLink, pathWithoutExtension } from "./wiki-link";

describe("pathWithoutExtension", () => {
  it("후행 .md만 떼고 대소문자를 가리지 않는다", () => {
    expect(pathWithoutExtension("Notes/a.md")).toBe("Notes/a");
    expect(pathWithoutExtension("Notes/a.MD")).toBe("Notes/a");
    expect(pathWithoutExtension("Notes/a.md.md")).toBe("Notes/a.md");
    expect(pathWithoutExtension("Notes/a")).toBe("Notes/a");
  });
});

describe("formatNoteLink", () => {
  it("별칭이 없으면 대상만 쓴다", () => {
    expect(formatNoteLink("Notes/a")).toBe("[[Notes/a]]");
  });

  it("별칭이 대상과 같으면 표기를 늘리지 않는다", () => {
    expect(formatNoteLink("Notes/a", "Notes/a")).toBe("[[Notes/a]]");
  });

  it("별칭이 다르면 붙인다", () => {
    expect(formatNoteLink("Notes/a", "제목")).toBe("[[Notes/a|제목]]");
  });

  it("별칭의 공백은 정리하고 파이프는 보존한다", () => {
    // 옵시디언은 첫 파이프만 구분자로 읽으므로 별칭 안의 파이프는 무해하다.
    expect(formatNoteLink("Notes/a", "  A | B  ")).toBe("[[Notes/a|A | B]]");
  });

  it("경로에 #이 있으면 마크다운 링크로 물러난다", () => {
    // `[[Notes/foo#bar]]`는 `Notes/foo`의 `bar` 절로 해석된다 — 파일을 가리키지 않는다.
    expect(formatNoteLink("Notes/foo#bar", "제목")).toBe("[제목](Notes/foo%23bar.md)");
  });

  it("경로에 |가 있으면 마크다운 링크로 물러난다", () => {
    expect(formatNoteLink("Notes/a|b", "제목")).toBe("[제목](Notes/a%7Cb.md)");
  });

  it("마크다운 링크에서 공백도 인코딩한다", () => {
    expect(formatNoteLink("Notes/a#b c", "제목")).toBe("[제목](Notes/a%23b%20c.md)");
  });

  it("별칭이 없으면 경로를 표시로 쓴다", () => {
    expect(formatNoteLink("Notes/foo#bar")).toBe("[Notes/foo#bar](Notes/foo%23bar.md)");
  });
});

describe("formatAnchorLink", () => {
  it("절 링크를 만든다", () => {
    expect(formatAnchorLink("Notes/a", "결론")).toBe("[[Notes/a#결론]]");
  });

  it("헤딩이 비면 null이다", () => {
    expect(formatAnchorLink("Notes/a", "")).toBeNull();
    expect(formatAnchorLink("Notes/a", "   ")).toBeNull();
  });

  it("헤딩에 파이프나 #이 있으면 null이다", () => {
    // 위키링크로 절을 가리킬 방법이 없다. 호출부가 노트 단위 인용으로 물러난다.
    expect(formatAnchorLink("Notes/a", "A | B")).toBeNull();
    expect(formatAnchorLink("Notes/a", "A # B")).toBeNull();
  });

  it("경로에 파이프나 #이 있으면 null이다", () => {
    expect(formatAnchorLink("Notes/foo#bar", "결론")).toBeNull();
  });
});

// ============================================
// Property: 생성된 링크는 대상을 잃지 않는다
// ============================================
/**
 * 생성 블록의 링크가 깨지면 그래프가 오염되고 RAG 이웃 확장이 무관한 노트를 끌어온다.
 * 어떤 경로에도 "링크 대상을 되찾을 수 있다"가 지켜져야 한다.
 */
describe("Property: formatNoteLink", () => {
  const segment = fc.stringMatching(/^[가-힣A-Za-z0-9 #|._-]{1,12}$/);
  const pathArb = fc
    .array(segment, { minLength: 1, maxLength: 3 })
    .map((parts) => parts.join("/"));

  it("위키링크를 쓰면 대상에 #·|가 없다", () => {
    fc.assert(
      fc.property(pathArb, segment, (target, alias) => {
        const link = formatNoteLink(target, alias);
        if (!link.startsWith("[[")) return;

        const inner = link.slice(2, link.indexOf("]]"));
        const pipe = inner.indexOf("|");
        const linkTarget = pipe < 0 ? inner : inner.slice(0, pipe);
        // 위키링크로 썼다면 대상 부분이 원본 경로와 정확히 같아야 한다.
        expect(linkTarget).toBe(target);
      }),
      { numRuns: 500 }
    );
  });

  it("마크다운 링크로 물러나면 목적지를 디코딩해 원본을 되찾는다", () => {
    fc.assert(
      fc.property(pathArb, segment, (target, alias) => {
        const link = formatNoteLink(target, alias);
        if (link.startsWith("[[")) return;

        const dest = link.slice(link.lastIndexOf("](") + 2, -1);
        expect(decodeURIComponent(dest)).toBe(`${target}.md`);
      }),
      { numRuns: 500 }
    );
  });

  it("항상 링크 문법 하나로 끝난다", () => {
    fc.assert(
      fc.property(pathArb, segment, (target, alias) => {
        const link = formatNoteLink(target, alias);
        const isWiki = link.startsWith("[[") && link.endsWith("]]");
        const isMarkdown = /^\[[^\]]*\]\([^)]*\)$/.test(link);
        expect(isWiki || isMarkdown).toBe(true);
      }),
      { numRuns: 500 }
    );
  });
});
