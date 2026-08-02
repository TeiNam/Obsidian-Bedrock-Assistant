import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  composeGraphMessage,
  type GraphCounts,
  type GraphTruncationLabels,
} from "./graph-message";
import { MERMAID_MAX_EDGES, MERMAID_MAX_NODES } from "./mermaid-graph";

/**
 * 그래프 → 채팅 메시지 조립 테스트 (뷰 계층)
 *
 * 순수 빌더 4종은 숫자(shownNodes/totalNodes/totalEdges)만 반환하고 i18n 을 모른다.
 * 절단 고지 문구를 붙이는 책임은 호출부(chat-view / 명령)에 있는데, 그 판단 로직
 * — "고지를 붙일지", "노드·엣지 중 무엇이 잘렸는지", "코드블록 밖에 두는지" —
 * 은 DOM 없이 검증 가능한 순수 로직이므로 여기서 고정한다.
 *
 * 이 로직이 틀리면 나타나는 실패는 전부 "조용한 실패"다.
 *   (a) 절단을 고지하지 않으면 사용자가 부분 그래프를 전체로 오독한다.
 *   (b) 고지를 코드블록 안에 넣으면 mermaid 문법이 깨져 그래프가 통째로 사라진다.
 *   (c) 빈 그래프에 헤딩만 붙이면 "제목만 있고 내용 없는 메시지"가 나간다.
 */

// 실제 빌더 출력과 같은 형태의 최소 mermaid 코드블록.
const FENCED = ["```mermaid", "graph LR", '  n0["가"]', "```"].join("\n");

// 테스트용 라벨 — 실제 VIEW_I18N 과 같은 함수형 시그니처를 흉내낸다.
// 언어 테이블을 import 하지 않는다(순수 로직 테스트가 i18n 에 묶이면 안 된다).
const LABELS: GraphTruncationLabels = {
  truncated: (shown, total) => `전체 ${total}개 중 상위 ${shown}개만 표시`,
  truncatedEdges: (shownNodes, totalNodes, shownEdges, totalEdges) =>
    `노드 ${totalNodes}개 중 ${shownNodes}개, 연결 ${totalEdges}개 중 ${shownEdges}개만 표시`,
};

function counts(overrides: Partial<GraphCounts> = {}): GraphCounts {
  return {
    markdown: FENCED,
    shownNodes: 3,
    totalNodes: 3,
    totalEdges: 2,
    ...overrides,
  };
}

describe("composeGraphMessage — 빈 그래프", () => {
  it("markdown 이 빈 문자열이면 빈 문자열을 반환한다", () => {
    // 빌더는 노드 0개일 때 markdown:"" 을 돌려준다. 여기서 헤딩만 붙여 내보내면
    // 제목만 있고 그래프가 없는 메시지가 채팅에 남는다.
    const result = composeGraphMessage("## 제목", counts({ markdown: "", shownNodes: 0, totalNodes: 0, totalEdges: 0 }), LABELS);
    expect(result).toBe("");
  });

  it("markdown 이 비면 헤딩이 있어도 아무것도 내보내지 않는다", () => {
    const result = composeGraphMessage("헤딩", counts({ markdown: "" }), LABELS);
    expect(result).toBe("");
  });

  it("markdown 이 공백뿐이어도 빈 문자열로 취급한다", () => {
    // 방어적 처리. 빌더 계약상 발생하지 않지만 공백만 렌더하면 빈 메시지가 된다.
    expect(composeGraphMessage("헤딩", counts({ markdown: "   \n  " }), LABELS)).toBe("");
  });
});

describe("composeGraphMessage — 절단 없음", () => {
  it("절단이 없으면 고지 줄을 아예 넣지 않는다", () => {
    // 항상 "3/3 표시"를 출력하면 노이즈가 되어 '있음' 자체가 신호가 되지 못한다.
    const result = composeGraphMessage("", counts(), LABELS);
    expect(result).not.toMatch(/표시/);
    expect(result).not.toMatch(/생략/);
  });

  it("헤딩이 있으면 코드블록 앞에 붙고 사이에 빈 줄이 있다", () => {
    const result = composeGraphMessage("## 검색 근거", counts(), LABELS);
    expect(result).toBe(`## 검색 근거\n\n${FENCED}`);
  });

  it("헤딩이 비면 코드블록만 반환한다(앞에 빈 줄이 생기지 않는다)", () => {
    const result = composeGraphMessage("", counts(), LABELS);
    expect(result).toBe(FENCED);
    expect(result.startsWith("```mermaid")).toBe(true);
  });
});

describe("composeGraphMessage — 노드 절단 고지", () => {
  it("노드가 잘리면 분모를 포함한 고지를 붙인다", () => {
    const result = composeGraphMessage("", counts({ shownNodes: 60, totalNodes: 340 }), LABELS);
    // 분모(340)가 없으면 사용자가 규모를 알 수 없다.
    expect(result).toContain("340");
    expect(result).toContain("60");
  });

  it("고지는 코드블록 '밖'에 온다 — 마지막 펜스 뒤", () => {
    // 코드블록 안에 넣으면 mermaid 문법 오류로 그래프가 통째로 사라진다.
    const result = composeGraphMessage("", counts({ shownNodes: 60, totalNodes: 340 }), LABELS);
    const lastFence = result.lastIndexOf("```");
    expect(result.indexOf("340")).toBeGreaterThan(lastFence);
  });

  it("고지는 architect.ts 선례처럼 이탤릭 한 줄이다", () => {
    const result = composeGraphMessage("", counts({ shownNodes: 60, totalNodes: 340 }), LABELS);
    const notice = result.split("\n").at(-1) ?? "";
    expect(notice.startsWith("_")).toBe(true);
    expect(notice.endsWith("_")).toBe(true);
  });

  it("고지 앞에 빈 줄을 넣어 코드블록과 붙지 않게 한다", () => {
    // 펜스 직후 줄에 텍스트가 붙으면 마크다운 렌더가 어긋난다.
    const result = composeGraphMessage("", counts({ shownNodes: 60, totalNodes: 340 }), LABELS);
    expect(result).toContain("```\n\n_");
  });
});

describe("composeGraphMessage — 엣지 절단 고지", () => {
  it("엣지만 잘리면 노드·엣지를 한 줄로 합쳐 보고한다", () => {
    const result = composeGraphMessage(
      "",
      counts({ shownNodes: 40, totalNodes: 40, totalEdges: 400 }),
      LABELS
    );
    expect(result).toContain("400");
    expect(result).toContain(String(MERMAID_MAX_EDGES));
    // 줄 2개는 과하다 — 고지는 항상 한 줄.
    const noticeLines = result.split("\n").filter((l) => l.startsWith("_"));
    expect(noticeLines).toHaveLength(1);
  });

  it("노드와 엣지가 모두 잘려도 고지는 한 줄이다", () => {
    const result = composeGraphMessage(
      "",
      counts({ shownNodes: MERMAID_MAX_NODES, totalNodes: 500, totalEdges: 900 }),
      LABELS
    );
    const noticeLines = result.split("\n").filter((l) => l.startsWith("_"));
    expect(noticeLines).toHaveLength(1);
    expect(noticeLines[0]).toContain("500");
    expect(noticeLines[0]).toContain("900");
  });

  it("shownEdges 를 명시로 받으면 그 값을 쓴다(위키 그래프 경로)", () => {
    // WikiGraph 는 shownEdges 를 직접 보고한다. 추정하면 실제와 어긋난다.
    const result = composeGraphMessage(
      "",
      counts({ shownNodes: 60, totalNodes: 60, totalEdges: 300, shownEdges: 111 }),
      LABELS
    );
    expect(result).toContain("111");
  });

  it("shownEdges 가 없으면 MERMAID_MAX_EDGES 로 추정한다", () => {
    const result = composeGraphMessage(
      "",
      counts({ shownNodes: 10, totalNodes: 10, totalEdges: 600 }),
      LABELS
    );
    expect(result).toContain(String(MERMAID_MAX_EDGES));
  });

  it("엣지가 상한 이하면 엣지 절단으로 보지 않는다", () => {
    const result = composeGraphMessage(
      "",
      counts({ shownNodes: 5, totalNodes: 5, totalEdges: MERMAID_MAX_EDGES }),
      LABELS
    );
    expect(result).toBe(FENCED);
  });
});

describe("composeGraphMessage — 불변성·결정론", () => {
  it("같은 입력에 같은 문자열을 반환한다", () => {
    const c = counts({ shownNodes: 60, totalNodes: 200 });
    expect(composeGraphMessage("h", c, LABELS)).toBe(composeGraphMessage("h", c, LABELS));
  });

  it("인자 객체를 변형하지 않는다", () => {
    const c = counts({ shownNodes: 60, totalNodes: 200 });
    const snapshot = JSON.stringify(c);
    composeGraphMessage("h", c, LABELS);
    expect(JSON.stringify(c)).toBe(snapshot);
  });

  it("임의 숫자 조합에서 절단이 없으면 고지가 없고, 있으면 정확히 한 줄이다", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 600 }),
        (shownNodes, totalNodes, totalEdges) => {
          const result = composeGraphMessage(
            "",
            { markdown: FENCED, shownNodes, totalNodes, totalEdges },
            LABELS
          );
          const notices = result.split("\n").filter((l) => l.startsWith("_"));
          const truncated = shownNodes < totalNodes || totalEdges > MERMAID_MAX_EDGES;
          expect(notices).toHaveLength(truncated ? 1 : 0);
          // 그래프 본문은 어떤 경우에도 온전히 살아 있어야 한다.
          expect(result).toContain(FENCED);
        }
      ),
      { numRuns: 300 }
    );
  });
});
