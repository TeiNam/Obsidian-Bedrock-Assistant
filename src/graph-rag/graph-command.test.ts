import { describe, it, expect } from "vitest";
import {
  buildSimilarityMessage,
  buildGapMessage,
  buildWikiMessage,
  type GraphCommandLabels,
} from "./graph-command";
import type { SimilarityGraph } from "./similarity-graph";
import type { WikiGraph } from "./wiki-graph";
import type { MermaidGraph } from "./mermaid-graph";

/**
 * 명령 팔레트 3종 메시지 조립 테스트
 *
 * 각 빌더는 "왜 비었는가"를 플래그·숫자로만 보고하고 문구를 모른다. 그 플래그를 읽어
 * 사용자에게 무엇을 보여줄지 결정하는 분기가 여기 있는데, 이 분기가 틀리면 전부
 * "조용한 실패"로 나타난다.
 *
 *   (a) 빈 그래프에 헤딩만 붙여 내보내면 "제목만 있는 메시지"가 채팅에 남는다.
 *   (b) 임베딩이 없어서 빈 것과 유사 노트가 없어서 빈 것을 구분하지 못하면 사용자가
 *       재인덱싱이 필요한 상태를 영구히 모른다.
 *   (c) 고립 경고를 빠뜨리면 "위키가 그냥 파일 더미"라는 이 그래프의 유일한 결론이
 *       사용자에게 전달되지 않는다.
 *
 * 반환값이 {notice} 인지 {markdown} 인지로 "Notice 로 안내" vs "채팅에 렌더"를 구분한다.
 */

const FENCED = ["```mermaid", "graph LR", '  n0["가"]', "```"].join("\n");

// 실제 VIEW_I18N 과 같은 시그니처. 언어 테이블을 import 하지 않는다.
const LABELS: GraphCommandLabels = {
  truncated: (shown, total) => `전체 ${total}개 중 상위 ${shown}개만 표시`,
  truncatedEdges: (sn, tn, se, te) => `노트 ${tn}개 중 ${sn}개, 연결 ${te}개 중 ${se}개만 표시`,
  similarityHeading: (title) => `**"${title}" 와(과) 비슷한 노트**`,
  similarityEmpty: "비슷한 노트를 찾지 못했습니다.",
  similarityNoVector: "현재 노트에 임베딩이 없습니다.",
  similarityDegenerate: "임베딩이 붕괴했습니다.",
  gapHeading: "**지식 공백**",
  gapEmpty: "구조적 공백이 발견되지 않았습니다.",
  wikiHeading: "**위키 구조**",
  wikiEmpty: "아직 위키 노트가 없습니다.",
  wikiIsolated: (isolated, total) => `위키 노트 ${total}개 중 ${isolated}개가 아무 링크도 없습니다.`,
  sbDisabled: "Second Brain 기능이 비활성화되어 있습니다.",
};

function simGraph(overrides: Partial<SimilarityGraph> = {}): SimilarityGraph {
  return {
    markdown: FENCED,
    shownNodes: 3,
    totalNodes: 3,
    totalEdges: 2,
    degenerate: false,
    centerHasVector: true,
    incomparableCount: 0,
    linkedCount: 0,
    ...overrides,
  };
}

function wikiGraph(overrides: Partial<WikiGraph> = {}): WikiGraph {
  return {
    status: "ok",
    markdown: FENCED,
    shownNodes: 5,
    totalNodes: 5,
    shownEdges: 4,
    totalEdges: 4,
    isolatedNodes: 0,
    externalLinks: 0,
    ...overrides,
  };
}

function gapGraph(overrides: Partial<MermaidGraph> = {}): MermaidGraph {
  return { markdown: FENCED, shownNodes: 4, totalNodes: 4, totalEdges: 0, ...overrides };
}

describe("buildSimilarityMessage", () => {
  it("후보가 있으면 헤딩 + 그래프를 채팅용 마크다운으로 반환한다", () => {
    const out = buildSimilarityMessage("내 노트", simGraph(), LABELS);
    expect(out.markdown).toContain("내 노트");
    expect(out.markdown).toContain("```mermaid");
    expect(out.notice).toBeUndefined();
  });

  it("중심 노트에 벡터가 없으면 재인덱싱 안내를 Notice 로만 낸다", () => {
    // 유사 노트가 없는 것과 계산 자체가 불가능한 것은 다른 상태다. 같은 문구로
    // 뭉치면 사용자가 재인덱싱이 필요한 상태를 영구히 모른다.
    const out = buildSimilarityMessage(
      "내 노트",
      simGraph({ markdown: "", centerHasVector: false }),
      LABELS
    );
    expect(out.notice).toBe(LABELS.similarityNoVector);
    expect(out.markdown).toBeUndefined();
  });

  it("임베딩 붕괴는 별도 안내를 낸다", () => {
    const out = buildSimilarityMessage(
      "내 노트",
      simGraph({ markdown: "", degenerate: true }),
      LABELS
    );
    expect(out.notice).toBe(LABELS.similarityDegenerate);
  });

  it("붕괴 판정이 벡터 없음보다 우선하지 않는다(벡터가 없으면 붕괴 판정도 의미 없다)", () => {
    const out = buildSimilarityMessage(
      "내 노트",
      simGraph({ markdown: "", centerHasVector: false, degenerate: true }),
      LABELS
    );
    expect(out.notice).toBe(LABELS.similarityNoVector);
  });

  it("그냥 후보가 없으면 '못 찾음' 안내를 낸다", () => {
    const out = buildSimilarityMessage("내 노트", simGraph({ markdown: "" }), LABELS);
    expect(out.notice).toBe(LABELS.similarityEmpty);
    expect(out.markdown).toBeUndefined();
  });

  it("절단 시 고지를 코드블록 밖에 붙인다", () => {
    const out = buildSimilarityMessage(
      "내 노트",
      simGraph({ shownNodes: 60, totalNodes: 300 }),
      LABELS
    );
    const md = out.markdown ?? "";
    expect(md).toContain("300");
    expect(md.indexOf("300")).toBeGreaterThan(md.lastIndexOf("```"));
  });

  it("제목이 비어도 헤딩을 만든다(빈 메시지 금지)", () => {
    const out = buildSimilarityMessage("", simGraph(), LABELS);
    expect(out.markdown).toContain("```mermaid");
  });
});

describe("buildGapMessage", () => {
  it("공백이 있으면 헤딩 + 그래프를 반환한다", () => {
    const out = buildGapMessage(gapGraph(), LABELS);
    expect(out.markdown).toContain("지식 공백");
    expect(out.markdown).toContain("```mermaid");
  });

  it("공백이 0건이면 축하 문구를 Notice 로 낸다 — 빈 코드블록을 만들지 않는다", () => {
    const out = buildGapMessage(
      gapGraph({ markdown: "", shownNodes: 0, totalNodes: 0 }),
      LABELS
    );
    expect(out.notice).toBe(LABELS.gapEmpty);
    expect(out.markdown).toBeUndefined();
  });

  it("절단 시 분모를 포함한 고지를 붙인다", () => {
    const out = buildGapMessage(gapGraph({ shownNodes: 60, totalNodes: 88 }), LABELS);
    expect(out.markdown).toContain("88");
  });
});

describe("buildWikiMessage", () => {
  it("status ok 면 헤딩 + 그래프를 반환한다", () => {
    const out = buildWikiMessage(wikiGraph(), LABELS);
    expect(out.markdown).toContain("위키 구조");
    expect(out.markdown).toContain("```mermaid");
  });

  it("status disabled 면 기존 sbDisabled 문구를 재사용한다", () => {
    // 새 키를 만들지 않는다 — 같은 상황에 두 문구가 생기면 표기가 갈라진다.
    const out = buildWikiMessage(wikiGraph({ status: "disabled", markdown: "" }), LABELS);
    expect(out.notice).toBe(LABELS.sbDisabled);
    expect(out.markdown).toBeUndefined();
  });

  it("status empty 면 위키 노트 없음 안내를 낸다", () => {
    const out = buildWikiMessage(wikiGraph({ status: "empty", markdown: "" }), LABELS);
    expect(out.notice).toBe(LABELS.wikiEmpty);
  });

  it("고립 노트가 있으면 경고 줄을 코드블록 밖에 덧붙인다", () => {
    // 이 그래프의 유일한 결론이 "연결돼 있는가"라 고립 수가 핵심 신호다.
    const out = buildWikiMessage(
      wikiGraph({ isolatedNodes: 7, totalNodes: 10, totalEdges: 0, shownEdges: 0 }),
      LABELS
    );
    const md = out.markdown ?? "";
    expect(md).toContain("7");
    expect(md.indexOf("7개가")).toBeGreaterThan(md.lastIndexOf("```"));
  });

  it("고립 노트가 0개면 경고를 넣지 않는다", () => {
    const out = buildWikiMessage(wikiGraph({ isolatedNodes: 0 }), LABELS);
    expect(out.markdown).not.toContain("아무 링크도");
  });

  it("절단 고지와 고립 경고가 함께 나올 수 있다(서로 다른 정보다)", () => {
    const out = buildWikiMessage(
      wikiGraph({ shownNodes: 60, totalNodes: 200, isolatedNodes: 30 }),
      LABELS
    );
    const md = out.markdown ?? "";
    expect(md).toContain("200");
    expect(md).toContain("30");
  });

  it("엣지가 잘리면 shownEdges 실측값을 쓴다(추정하지 않는다)", () => {
    const out = buildWikiMessage(
      wikiGraph({ shownNodes: 60, totalNodes: 60, shownEdges: 150, totalEdges: 900 }),
      LABELS
    );
    expect(out.markdown).toContain("900");
    expect(out.markdown).toContain("150");
  });
});

describe("공통 — 불변성·결정론", () => {
  it("인자 객체를 변형하지 않는다", () => {
    const g = wikiGraph({ isolatedNodes: 3, shownNodes: 10, totalNodes: 40 });
    const snapshot = JSON.stringify(g);
    buildWikiMessage(g, LABELS);
    expect(JSON.stringify(g)).toBe(snapshot);
  });

  it("같은 입력에 같은 출력을 반환한다", () => {
    const g = simGraph({ shownNodes: 60, totalNodes: 90 });
    expect(buildSimilarityMessage("t", g, LABELS)).toEqual(buildSimilarityMessage("t", g, LABELS));
  });

  it("세 함수 모두 notice 와 markdown 을 동시에 반환하지 않는다", () => {
    // 둘 다 있으면 호출부가 Notice 를 띄우면서 채팅에도 렌더해 중복 안내가 된다.
    const cases = [
      buildSimilarityMessage("t", simGraph(), LABELS),
      buildSimilarityMessage("t", simGraph({ markdown: "" }), LABELS),
      buildGapMessage(gapGraph(), LABELS),
      buildGapMessage(gapGraph({ markdown: "" }), LABELS),
      buildWikiMessage(wikiGraph(), LABELS),
      buildWikiMessage(wikiGraph({ status: "empty", markdown: "" }), LABELS),
    ];
    for (const c of cases) {
      expect(Boolean(c.notice) !== Boolean(c.markdown)).toBe(true);
    }
  });
});
