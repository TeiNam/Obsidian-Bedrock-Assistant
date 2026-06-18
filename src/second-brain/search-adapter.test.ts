// 검색 어댑터 단위 테스트 (Search Adapter — Unit Tests)
// ====================================================================
// toSearchHits의 필드 추출과 hasNoHits의 0건 판정(invalidQuery / 빈 items)을
// 예시 기반으로 검증한다. (Req 7.5, 7.6)

import { describe, it, expect } from "vitest";
import {
  toSearchHits,
  hasNoHits,
  SECOND_BRAIN_SYSTEM_PROMPT,
} from "./search-adapter";
import type { GraphRagResult, GraphRagSearchItem } from "../vault-indexer";

// 테스트용 GraphRagSearchItem 생성 헬퍼 — second-brain이 쓰지 않는 필드도 채워
// toSearchHits가 path/title/excerpt만 골라내는지 확인할 수 있게 한다.
function makeItem(overrides: Partial<GraphRagSearchItem> = {}): GraphRagSearchItem {
  return {
    path: "Notes/example.md",
    title: "예시 노트",
    excerpt: "이것은 발췌입니다.",
    combinedScore: 0.9,
    vectorScore: 0.8,
    hop: 0,
    isSeed: true,
    seedPath: null,
    seedTitle: null,
    ...overrides,
  };
}

describe("toSearchHits", () => {
  it("items의 path/title/excerpt만 추출한다", () => {
    const result: GraphRagResult = {
      items: [
        makeItem({ path: "A.md", title: "제목 A", excerpt: "발췌 A" }),
        makeItem({ path: "B.md", title: "제목 B", excerpt: "발췌 B" }),
      ],
    };

    const hits = toSearchHits(result);

    expect(hits).toEqual([
      { path: "A.md", title: "제목 A", excerpt: "발췌 A" },
      { path: "B.md", title: "제목 B", excerpt: "발췌 B" },
    ]);
  });

  it("점수·hop 등 부가 필드는 결과에 포함하지 않는다", () => {
    const result: GraphRagResult = { items: [makeItem()] };

    const hit = toSearchHits(result)[0];

    expect(Object.keys(hit).sort()).toEqual(["excerpt", "path", "title"]);
  });

  it("items가 비어 있으면 빈 배열을 반환한다", () => {
    expect(toSearchHits({ items: [] })).toEqual([]);
  });
});

describe("hasNoHits", () => {
  it("invalidQuery=true이면 결과 없음(true)으로 판정한다", () => {
    const result: GraphRagResult = { items: [], invalidQuery: true };
    expect(hasNoHits(result)).toBe(true);
  });

  it("invalidQuery가 있고 items가 있어도 결과 없음(true)으로 판정한다", () => {
    // 빈/공백 쿼리로 검색이 수행되지 않은 경우는 items 유무와 무관하게 결과 없음.
    const result: GraphRagResult = { items: [makeItem()], invalidQuery: true };
    expect(hasNoHits(result)).toBe(true);
  });

  it("items가 비어 있으면 결과 없음(true)으로 판정한다", () => {
    const result: GraphRagResult = { items: [] };
    expect(hasNoHits(result)).toBe(true);
  });

  it("items가 하나 이상 있으면 결과 있음(false)으로 판정한다", () => {
    const result: GraphRagResult = { items: [makeItem()] };
    expect(hasNoHits(result)).toBe(false);
  });
});

describe("SECOND_BRAIN_SYSTEM_PROMPT", () => {
  it("비어 있지 않은 문자열이다", () => {
    expect(typeof SECOND_BRAIN_SYSTEM_PROMPT).toBe("string");
    expect(SECOND_BRAIN_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("백엔드별 표시 이름을 정적으로 보간하지 않는다(브랜딩 무관, Req 5.4)", () => {
    const lowered = SECOND_BRAIN_SYSTEM_PROMPT.toLowerCase();
    expect(lowered).not.toContain("bedrock");
    expect(lowered).not.toContain("gemini");
    expect(lowered).not.toContain("openai");
    expect(lowered).not.toContain("ollama");
    expect(lowered).not.toContain("anthropic");
  });
});
