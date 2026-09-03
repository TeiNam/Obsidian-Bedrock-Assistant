import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  formatNoteLink,
  formatAnchorLink,
  parseNoteLinks,
  pathWithoutExtension,
} from "./wiki-link";

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

// ============================================
// 쓰기와 읽기의 왕복
// ============================================
/**
 * formatNoteLink가 경로에 따라 두 형태 중 하나를 쓴다. 되읽는 쪽이 한 형태만 알면 생성
 * 블록을 교체할 때 이전에 승인한 링크가 사라진다 — 실제로 그 결함이 났다.
 */
describe("parseNoteLinks", () => {
  it("위키링크를 읽는다", () => {
    expect(parseNoteLinks("- [[Notes/a|제목]]")).toEqual([{ target: "Notes/a", alias: "제목" }]);
  });

  it("별칭 없는 위키링크를 읽는다", () => {
    expect(parseNoteLinks("- [[Notes/a]]")).toEqual([{ target: "Notes/a", alias: "" }]);
  });

  it("별칭 속 파이프를 보존한다", () => {
    expect(parseNoteLinks("- [[Notes/a|A | B]]")).toEqual([{ target: "Notes/a", alias: "A | B" }]);
  });

  it("헤딩 앵커는 대상에서 뗀다", () => {
    expect(parseNoteLinks("- [[Notes/a#결론]]")[0].target).toBe("Notes/a");
  });

  it("마크다운 링크를 읽고 디코딩한다", () => {
    expect(parseNoteLinks("- [제목](Notes/foo%23bar.md)")).toEqual([
      { target: "Notes/foo#bar.md", alias: "제목" },
    ]);
  });

  it("꺾쇠로 감싼 목적지도 읽는다", () => {
    expect(parseNoteLinks("- [제목](<Notes/a b.md>)")[0].target).toBe("Notes/a b.md");
  });

  it("확장자를 벗기지 않는다", () => {
    // 벗기면 호출부가 .md를 붙일 때 대소문자가 바뀌어 다른 파일이 된다.
    expect(parseNoteLinks("- [[Notes/a.MD]]")[0].target).toBe("Notes/a.MD");
  });

  it("링크가 없으면 빈 배열이다", () => {
    expect(parseNoteLinks("링크 없는 문장")).toEqual([]);
  });
});

describe("Property: formatNoteLink → parseNoteLinks 왕복", () => {
  /**
   * 실제로 존재할 수 있는 경로만 만든다.
   *
   * 세그먼트 앞뒤 공백은 제외한다 — 옵시디언이 파일명을 만들 때 그것을 정규화하고,
   * 위키링크 대상도 앞뒤 공백을 무시하므로 `[[ a]]`와 `[[a]]`가 같은 노트다. 그런 입력을
   * 흔들면 "옵시디언과 같게 동작한다"를 불안정으로 오판한다.
   */
  const segment = fc
    .stringMatching(/^[가-힣A-Za-z0-9 #|%?)._-]{1,12}$/)
    .map((raw) => raw.trim())
    .filter((raw) => raw !== "");
  const pathArb = fc
    .array(segment, { minLength: 1, maxLength: 3 })
    .map((parts) => parts.join("/"));

  it("어떤 경로도 왕복에서 대상을 잃지 않는다", () => {
    fc.assert(
      fc.property(pathArb, (target) => {
        const link = formatNoteLink(target, "제목");
        const parsed = parseNoteLinks(link);

        expect(parsed).toHaveLength(1);
        // 마크다운으로 물러난 경우 확장자가 붙으므로 떼고 비교한다.
        expect(pathWithoutExtension(parsed[0].target)).toBe(target);
      }),
      { numRuns: 600 }
    );
  });

  it("쓰기 → 읽기 → 쓰기가 안정적이다", () => {
    // 별칭 자체의 왕복은 성립하지 않는다 — 마크다운 링크에는 "별칭 없음" 형태가 없어서
    // 빈 별칭이면 대상을 표시로 쓴다. 필요한 보장은 **다시 써도 같은 링크**라는 것이다.
    // 그러지 않으면 생성 블록이 매 실행마다 달라져 재실행이 멱등하지 않다.
    fc.assert(
      fc.property(pathArb, fc.stringMatching(/^[가-힣A-Za-z0-9 |]{0,12}$/), (target, alias) => {
        const once = formatNoteLink(target, alias);
        const parsed = parseNoteLinks(once);
        if (parsed.length === 0) return;

        const twice = formatNoteLink(
          pathWithoutExtension(parsed[0].target),
          parsed[0].alias
        );
        expect(twice).toBe(once);
      }),
      { numRuns: 600 }
    );
  });
});

describe("formatNoteLink — 링크 문법을 깨뜨리는 문자", () => {
  it("괄호를 인코딩한다", () => {
    // encodeURIComponent는 괄호를 남긴다. 목적지의 `)`가 링크를 조기에 끝낸다.
    const link = formatNoteLink("Notes/a(1)#b", "제목");

    expect(link).toBe("[제목](Notes/a%281%29%23b.md)");
    // 목적지 안에 닫는 괄호가 없다.
    const dest = link.slice(link.lastIndexOf("](") + 2, -1);
    expect(dest).not.toContain(")");
  });

  it("표시 텍스트의 대괄호를 둥근 괄호로 바꾼다", () => {
    // `[`·`]`는 링크 문법을 깨뜨린다. 퍼센트 인코딩하면 사용자에게 %5B가 보인다.
    expect(formatNoteLink("Notes/a#b", "제목[초안]")).toBe("[제목(초안)](Notes/a%23b.md)");
  });

  it("리터럴 %도 인코딩한다", () => {
    // 남기면 해석 시 다른 문자로 디코딩되어 엉뚱한 파일을 가리킨다.
    const link = formatNoteLink("Notes/a%20b#c", "제목");
    expect(link).toBe("[제목](Notes/a%2520b%23c.md)");
    expect(parseNoteLinks(link)[0].target).toBe("Notes/a%20b#c.md");
  });
});
