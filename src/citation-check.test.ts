import { describe, it, expect } from "vitest";
import {
  stripCode,
  extractCitations,
  buildCitationIndex,
  findUnresolvedCitations,
} from "./citation-check";

const VAULT = ["Meetings/2026-09-01 회의록.md", "Projects/Agent LLMs.md", "daily/2026-09-03.md"];

/** 인용 대상만 뽑아 비교용으로 정렬한다. */
function targets(markdown: string): string[] {
  return extractCitations(markdown)
    .map((c) => c.target)
    .sort();
}

describe("stripCode", () => {
  it("펜스 코드블록 안의 위키링크는 남기지 않는다", () => {
    const md = ["앞 문장 [[실제노트]]", "```md", "예시: [[가짜노트]]", "```", "뒤 문장"].join("\n");

    const out = stripCode(md);
    expect(out).toContain("[[실제노트]]");
    expect(out).not.toContain("가짜노트");
  });

  it("길이를 보존한다(원문과 위치가 어긋나지 않는다)", () => {
    const md = "a\n```\nbbb\n```\nc";
    expect(stripCode(md)).toHaveLength(md.length);
  });

  it("인라인 코드 안의 경로는 남기지 않는다", () => {
    const out = stripCode("설정은 `config/app.md` 를 보세요");
    expect(out).not.toContain("config/app.md");
  });

  it("닫히지 않은 펜스는 문서 끝까지 코드로 본다", () => {
    // 스트리밍이 중간에 끊긴 응답에서 뒤쪽 전부가 오탐이 되는 걸 막는다.
    const out = stripCode("본문 [[실제노트]]\n```\n[[가짜1]]\n[[가짜2]]");
    expect(out).toContain("[[실제노트]]");
    expect(out).not.toContain("가짜1");
    expect(out).not.toContain("가짜2");
  });

  it("~~~ 펜스도 처리한다", () => {
    const out = stripCode("~~~\n[[가짜]]\n~~~");
    expect(out).not.toContain("가짜");
  });
});

describe("extractCitations", () => {
  it("위키링크에서 별칭과 헤딩을 떼어낸다", () => {
    expect(targets("[[노트A|다른이름]] 그리고 [[노트B#섹션]] 또 [[노트C^block]]")).toEqual([
      "노트A",
      "노트B",
      "노트C",
    ]);
  });

  it("마크다운 링크의 .md 대상을 잡는다", () => {
    expect(targets("[회의록](Meetings/2026-09-01%20회의록.md) 참고")).toEqual([
      "Meetings/2026-09-01 회의록.md",
    ]);
  });

  it("문장 안의 맨 경로는 의도적으로 잡지 않는다", () => {
    // 노트 이름에 공백이 흔해 경계를 정할 수 없다. "Projects/Agent"로 자르든
    // "LLMs.md"로 자르든 틀리고, 잘린 경로는 전부 거짓 경고가 된다.
    expect(targets("근거는 Projects/Agent LLMs.md 입니다")).toEqual([]);
  });

  it("확장자 없는 일반 명사는 인용으로 보지 않는다", () => {
    // "회의록에 있습니다" 같은 문장을 경로로 오인하면 경고 신뢰가 먼저 무너진다.
    expect(targets("이 내용은 회의록에 정리되어 있습니다")).toEqual([]);
  });

  it("외부 URL은 인용이 아니다", () => {
    expect(targets("[문서](https://example.com/a.md) 와 [[https://x.com]]")).toEqual([]);
  });

  it("같은 대상은 한 번만 반환한다", () => {
    expect(targets("[[노트A]] 그리고 [[노트A|별칭]] 그리고 [[노트A#섹션]]")).toEqual(["노트A"]);
  });

  it("코드블록 안의 인용은 제외된다", () => {
    const md = "실제 근거는 [[노트A]]\n\n```ts\n// [[코드속가짜]]\nconst p = \"x/y.md\";\n```";
    expect(targets(md)).toEqual(["노트A"]);
    expect(targets("[본문](Real/Note.md)\n```\n[가짜](Fake/Note.md)\n```")).toEqual([
      "Real/Note.md",
    ]);
  });

  it("인용이 없으면 빈 배열이다", () => {
    expect(extractCitations("근거가 되는 노트를 찾지 못했습니다.")).toEqual([]);
  });
});

describe("buildCitationIndex", () => {
  it("전체 경로, 확장자 뗀 경로, basename 모두로 찾을 수 있다", () => {
    const idx = buildCitationIndex(["Projects/Agent LLMs.md"]);

    expect(idx.paths.has("projects/agent llms.md")).toBe(true);
    expect(idx.paths.has("projects/agent llms")).toBe(true);
    expect(idx.basenames.has("agent llms")).toBe(true);
  });
});

describe("findUnresolvedCitations", () => {
  it("노트 이름만 쓴 위키링크를 해결한다", () => {
    // 옵시디언 링크는 보통 전체 경로가 아니라 노트 이름만 쓴다.
    const cites = extractCitations("[[Agent LLMs]] 를 보세요");
    expect(findUnresolvedCitations(cites, VAULT)).toEqual([]);
  });

  it("전체 경로 인용을 해결한다", () => {
    const cites = extractCitations("[[Meetings/2026-09-01 회의록]]");
    expect(findUnresolvedCitations(cites, VAULT)).toEqual([]);
  });

  it("대소문자가 달라도 해결한다", () => {
    const cites = extractCitations("[[agent llms]]");
    expect(findUnresolvedCitations(cites, VAULT)).toEqual([]);
  });

  it("존재하지 않는 노트를 잡아낸다", () => {
    const cites = extractCitations("[[있는노트는아님]] 에 근거가 있습니다");
    const unresolved = findUnresolvedCitations(cites, VAULT);

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].target).toBe("있는노트는아님");
  });

  it("실재하는 것과 지어낸 것이 섞여 있으면 지어낸 것만 돌려준다", () => {
    const cites = extractCitations("[[Agent LLMs]] 와 [[존재하지않음]] 을 종합하면");
    const unresolved = findUnresolvedCitations(cites, VAULT);

    expect(unresolved.map((c) => c.target)).toEqual(["존재하지않음"]);
  });

  it("인덱스가 비어 있으면 아무것도 경고하지 않는다", () => {
    // 인덱싱 전에는 모든 인용이 미해결로 보인다 — 전부 거짓 경고가 된다.
    const cites = extractCitations("[[무엇이든]]");
    expect(findUnresolvedCitations(cites, [])).toEqual([]);
  });
});
