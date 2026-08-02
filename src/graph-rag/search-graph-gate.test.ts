import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { shouldAttachSearchGraph } from "./graph-message";
import { buildSearchGraph } from "./mermaid-graph";
import type { GraphRagResult, GraphRagSearchItem } from "../vault-indexer";

/**
 * 검색 근거 그래프 부착 판단 테스트
 *
 * "매 검색마다 그래프를 원하지 않을 수 있다"에 대한 답으로 **새 설정을 만들지 않았다**.
 * 대신 그래프가 텍스트 목록이 이미 담고 있는 정보 외에 무언가를 더할 때만 붙인다 —
 * 그 조건은 정확히 "엣지가 1개 이상 있는가"다.
 *
 * 근거:
 *  - 엣지가 0개인 그래프는 시드만 나열한 상자 줄이고, 그건 바로 위 텍스트 목록과
 *    같은 정보를 도형으로 반복하는 것이다. 순수한 노이즈다.
 *  - graphTraversalDepth=0(그래프 순회 비활성)이면 이웃이 없어 엣지가 0이 된다. 즉
 *    **그래프를 원하지 않는 사용자에게는 이미 스위치가 있다** — 기존 설정이 그대로
 *    옵트아웃으로 동작하므로 새 설정 항목이 필요 없다(ponytail).
 *  - 반대로 이웃이 있으면 "이 노트가 왜 결과에 들어왔는가"(시드 경유 경로)는 텍스트
 *    목록으로는 읽기 어렵고 그래프가 압도적으로 잘 보여준다. 그때만 붙인다.
 */

function seed(path: string, score = 0.9): GraphRagSearchItem {
  return {
    path,
    title: path.replace(/\.md$/, ""),
    excerpt: "본문",
    combinedScore: score,
    vectorScore: score,
    hop: 0,
    isSeed: true,
    seedPath: null,
  };
}

function neighbor(path: string, seedPath: string, hop = 1): GraphRagSearchItem {
  return {
    path,
    title: path.replace(/\.md$/, ""),
    excerpt: "본문",
    combinedScore: 0.5,
    vectorScore: 0.4,
    hop,
    isSeed: false,
    seedPath,
    seedTitle: seedPath.replace(/\.md$/, ""),
  };
}

describe("shouldAttachSearchGraph — 붙이지 않는 경우", () => {
  it("검색 결과가 0건이면 붙이지 않는다", () => {
    // 빈 mermaid 블록은 실측 파스 에러다.
    expect(shouldAttachSearchGraph({ items: [] })).toBe(false);
  });

  it("invalidQuery(빈 쿼리)면 붙이지 않는다", () => {
    expect(shouldAttachSearchGraph({ items: [], invalidQuery: true })).toBe(false);
  });

  it("items 필드 자체가 없는 비정상 입력에도 붙이지 않는다(throw 금지)", () => {
    expect(shouldAttachSearchGraph({} as GraphRagResult)).toBe(false);
  });

  it("시드만 있고 이웃이 없으면 붙이지 않는다 — 텍스트 목록과 같은 정보다", () => {
    const result: GraphRagResult = { items: [seed("a.md"), seed("b.md"), seed("c.md")] };
    expect(shouldAttachSearchGraph(result)).toBe(false);
  });

  it("graphTraversalDepth=0 상황(이웃 0)이 그대로 옵트아웃으로 동작한다", () => {
    // depth 0 이면 traverseGraph 가 이웃을 만들지 않아 전부 시드다. 새 설정 없이
    // 기존 설정이 스위치 역할을 한다는 계약을 여기서 고정한다.
    const depthZero: GraphRagResult = { items: [seed("only.md")] };
    expect(shouldAttachSearchGraph(depthZero)).toBe(false);
  });

  it("이웃이 있지만 seedPath 가 null 이면(비정상 데이터) 붙이지 않는다", () => {
    // 엣지를 만들 수 없어 고립 노드만 남는다.
    const orphan: GraphRagSearchItem = { ...neighbor("n.md", "a.md"), seedPath: null };
    expect(shouldAttachSearchGraph({ items: [seed("a.md"), orphan] })).toBe(false);
  });

  it("이웃의 seedPath 가 결과에 없는 경로를 가리키면 붙이지 않는다", () => {
    // 엣지가 폐기되어(유령 노드 방지) 고립 노드만 남으므로 그릴 값이 없다.
    const dangling = neighbor("n.md", "사라진시드.md");
    expect(shouldAttachSearchGraph({ items: [seed("a.md"), dangling] })).toBe(false);
  });
});

describe("shouldAttachSearchGraph — 붙이는 경우", () => {
  it("시드 → 이웃 관계가 하나라도 있으면 붙인다", () => {
    const result: GraphRagResult = { items: [seed("a.md"), neighbor("n.md", "a.md")] };
    expect(shouldAttachSearchGraph(result)).toBe(true);
  });

  it("staleEmbeddings 여도 그래프는 붙인다(경고는 별도 경로)", () => {
    const result: GraphRagResult = {
      items: [seed("a.md"), neighbor("n.md", "a.md")],
      staleEmbeddings: true,
    };
    expect(shouldAttachSearchGraph(result)).toBe(true);
  });

  it("usedKeywordFallback 여도 그래프는 붙인다", () => {
    const result: GraphRagResult = {
      items: [seed("a.md"), neighbor("n.md", "a.md")],
      usedKeywordFallback: true,
    };
    expect(shouldAttachSearchGraph(result)).toBe(true);
  });

  it("2 hop 이상 이웃도 붙인다", () => {
    const result: GraphRagResult = {
      items: [seed("a.md"), neighbor("m.md", "a.md", 1), neighbor("n.md", "a.md", 2)],
    };
    expect(shouldAttachSearchGraph(result)).toBe(true);
  });
});

describe("shouldAttachSearchGraph — 빌더와의 일관성 (핵심 계약)", () => {
  it("true 를 반환한 경우 buildSearchGraph 의 markdown 은 절대 비지 않는다", () => {
    // 이 계약이 깨지면 빈 mermaid 블록이 채팅에 나가 렌더 오류를 낸다.
    const result: GraphRagResult = { items: [seed("a.md"), neighbor("n.md", "a.md")] };
    expect(shouldAttachSearchGraph(result)).toBe(true);
    expect(buildSearchGraph(result).markdown).not.toBe("");
  });

  it("false 를 반환한 경우 그래프에 엣지가 없다(그릴 값이 없음)", () => {
    const onlySeeds: GraphRagResult = { items: [seed("a.md"), seed("b.md")] };
    expect(shouldAttachSearchGraph(onlySeeds)).toBe(false);
    expect(buildSearchGraph(onlySeeds).totalEdges).toBe(0);
  });

  it("임의 결과에서 true ⇔ 빌더가 엣지를 1개 이상 그림", () => {
    const itemArb = fc.record({
      path: fc.integer({ min: 0, max: 6 }).map((n) => `note${n}.md`),
      isSeed: fc.boolean(),
      seedIdx: fc.integer({ min: 0, max: 6 }),
      hop: fc.integer({ min: 0, max: 3 }),
    });

    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 10 }), (raw) => {
        const items: GraphRagSearchItem[] = raw.map((r) =>
          r.isSeed ? seed(r.path) : neighbor(r.path, `note${r.seedIdx}.md`, Math.max(1, r.hop))
        );
        const result: GraphRagResult = { items };
        const gate = shouldAttachSearchGraph(result);
        const graph = buildSearchGraph(result);
        // 게이트가 참이면 반드시 그릴 엣지가 있고, markdown 도 비지 않는다.
        expect(gate).toBe(graph.totalEdges > 0);
        if (gate) expect(graph.markdown).not.toBe("");
      }),
      { numRuns: 400 }
    );
  });
});
