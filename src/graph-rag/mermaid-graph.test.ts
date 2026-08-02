// mermaid 그래프 공유 코어 + 검색 근거 그래프 테스트
// ====================================================
// 전부 순수 함수 테스트다. 볼트·LLM·Obsidian API 를 전혀 쓰지 않는다.
//
// mermaid 를 테스트 의존성으로 추가하지 않는다(신규 의존성 0 원칙). 대신
// assertValidMermaid() 가 우리가 생성하는 문법의 부분집합을 구조적으로 검증한다:
// 헤더·노드·엣지·classDef·class 줄만 존재하고, 참조된 id 가 모두 선언되어 있고,
// 라벨이 항상 인용되며 이스케이프 안 된 위험 문자가 남지 않는지.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  escapeLabel,
  resolveLabel,
  mermaidNodeId,
  buildMermaidGraph,
  buildSearchGraph,
  UNTITLED_LABEL,
  MERMAID_MAX_NODES,
  MERMAID_MAX_EDGES,
  type MermaidNode,
  type MermaidEdge,
} from "./mermaid-graph";
import type { GraphRagResult, GraphRagSearchItem } from "../vault-indexer";

// === 테스트 헬퍼 ===

/** 생성된 엔티티를 원문으로 되돌린다(왕복 검증용). */
function decodeEntities(s: string): string {
  return s.replace(/#(?:quot|60|62|38|35|96|37);/g, (m) =>
    m === "#quot;" ? '"' : String.fromCodePoint(Number(m.slice(1, -1)))
  );
}

/** 코드펜스를 벗겨 mermaid 본문 줄 배열을 돌려준다. */
function mermaidLines(markdown: string): string[] {
  const lines = markdown.split("\n");
  expect(lines[0]).toBe("```mermaid");
  expect(lines[lines.length - 1]).toBe("```");
  return lines.slice(1, -1);
}

// 라벨 안에 `"` 는 절대 남지 않으므로(escapeLabel) `[^"]*` 로 정확히 잡을 수 있다.
// 백슬래시 이스케이프 문법을 쓰지 않는다는 사실도 여기서 함께 고정된다.
const NODE_LINE = /^ {2}(n\d+)\["([^"]*)"\]$/;
const EDGE_LINE = /^ {2}(n\d+) --> (n\d+)$/;
const EDGE_LABEL_LINE = /^ {2}(n\d+) -->\|"([^"]*)"\| (n\d+)$/;
const CLASSDEF_LINE = /^ {2}classDef [A-Za-z][\w-]* [^;]+$/;
const CLASS_LINE = /^ {2}class (n\d+(?:,n\d+)*) ([A-Za-z][\w-]*)$/;

/**
 * mermaid 문법 유효성 구조 검증.
 * - 첫 줄이 `graph LR` 또는 `graph TD`
 * - 나머지 줄은 노드·엣지·classDef·class 중 하나에만 매치
 * - 엣지/class 가 참조하는 id 는 반드시 선언되어 있다(유령 노드 금지)
 * - 라벨 안에 이스케이프 안 된 `" < > & #` 가 없다
 */
function assertValidMermaid(markdown: string): void {
  const body = mermaidLines(markdown);
  expect(body[0]).toMatch(/^graph (LR|TD)$/);

  const declared = new Set<string>();
  const referenced: string[] = [];
  const labels: string[] = [];

  for (const line of body.slice(1)) {
    const node = NODE_LINE.exec(line);
    if (node) {
      // 같은 id 를 두 번 선언하면 라벨이 덮어써진다 — 중복 선언 금지.
      expect(declared.has(node[1])).toBe(false);
      declared.add(node[1]);
      labels.push(node[2]);
      continue;
    }
    const labeled = EDGE_LABEL_LINE.exec(line);
    if (labeled) {
      referenced.push(labeled[1], labeled[3]);
      labels.push(labeled[2]);
      continue;
    }
    const edge = EDGE_LINE.exec(line);
    if (edge) {
      referenced.push(edge[1], edge[2]);
      // 자기 자신을 가리키는 엣지는 만들지 않는다.
      expect(edge[1]).not.toBe(edge[2]);
      continue;
    }
    if (CLASSDEF_LINE.test(line)) continue;
    const cls = CLASS_LINE.exec(line);
    if (cls) {
      referenced.push(...cls[1].split(","));
      continue;
    }
    throw new Error(`유효하지 않은 mermaid 줄: ${JSON.stringify(line)}`);
  }

  for (const id of referenced) {
    expect(declared.has(id)).toBe(true);
  }
  for (const label of labels) {
    // 라벨 안에 남은 위험 문자 검사 — 생성된 엔티티는 제외한 뒤 확인한다.
    const stripped = label.replace(/#(?:quot|60|62|38|35);/g, "");
    expect(stripped).not.toMatch(/["<>&#]/);
    // 빈 라벨은 mermaid 파스 에러다.
    expect(label.length).toBeGreaterThan(0);
  }
}

/** 검색 결과 항목 팩토리. */
function item(over: Partial<GraphRagSearchItem> = {}): GraphRagSearchItem {
  return {
    path: "A.md",
    title: "A",
    excerpt: "",
    combinedScore: 0.5,
    vectorScore: 0.5,
    hop: 0,
    isSeed: true,
    seedPath: null,
    seedTitle: null,
    ...over,
  };
}

/** 시드 항목. */
function seed(path: string, title: string, score: number): GraphRagSearchItem {
  return item({ path, title, combinedScore: score, vectorScore: score });
}

/** 이웃 항목. */
function neighbor(
  path: string,
  title: string,
  score: number,
  seedPath: string,
  hop = 1
): GraphRagSearchItem {
  return item({
    path,
    title,
    combinedScore: score,
    vectorScore: score,
    hop,
    isSeed: false,
    seedPath,
    seedTitle: seedPath,
  });
}

// === escapeLabel ===

describe("escapeLabel", () => {
  it("인용 라벨을 깨는 따옴표를 #quot; 로 치환한다", () => {
    expect(escapeLabel('a"b')).toBe("a#quot;b");
  });

  it("HTML 로 해석되는 꺾쇠와 앰퍼샌드를 십진 엔티티로 치환한다", () => {
    expect(escapeLabel("<b>")).toBe("#60;b#62;");
    expect(escapeLabel("a & b")).toBe("a #38; b");
  });

  it("샵을 #35; 로 치환한다 — mermaid 가 리터럴 #35; 를 조용히 디코드하기 때문", () => {
    expect(escapeLabel("Price #35; note")).toBe("Price #35;35; note");
    expect(decodeEntities(escapeLabel("Price #35; note"))).toBe("Price #35; note");
  });

  it("실제 노트 제목의 위험 문자 조합을 왕복 보존한다", () => {
    const raw = '노트 [초안] & 검토 (2026) | v2 "final" #35;';
    const escaped = escapeLabel(raw);
    expect(escaped).not.toMatch(/["<>&]/);
    expect(decodeEntities(escaped)).toBe(raw);
  });

  it("HTML 태그를 불활성 텍스트로 만든다 — 태그 소실·XSS 방지", () => {
    expect(escapeLabel("<script>alert(1)</script>")).toBe(
      "#60;script#62;alert(1)#60;/script#62;"
    );
    expect(escapeLabel('<a href="javascript:alert(1)">x</a>')).not.toMatch(/[<>"]/);
  });

  it("인용 안에서 안전한 문자는 손대지 않는다 — 과잉 이스케이프 금지", () => {
    // 대괄호·중괄호·소괄호·파이프·세미콜론은 인용 라벨 안에서 그대로 통과한다.
    // 제거·치환하면 `[초안]`·`(2026)` 같은 실제 제목 정보가 파괴된다.
    // 백틱과 `%`는 여기서 제외한다 — 아래 두 테스트가 따로 다룬다.
    const safe = "A [x] (y) {z} | B --- C; D: E, 'g' = ~~ * _ + \\";
    expect(escapeLabel(safe)).toBe(safe);
  });

  it("백틱을 엔티티화한다 — 선행 백틱은 markdown-string 모드를 열어 파스를 깬다", () => {
    // mermaid 11.13.0 실측: 라벨이 백틱으로 시작하면 lexer 가 md_string 상태로 진입해
    // "Lexical error ... Unrecognized text" 로 그래프 전체가 렌더되지 않는다.
    // "`useState` 훅 정리" 처럼 개발자 볼트에 흔한 H1 제목이 그대로 여기 걸린다.
    // Obsidian 은 파스 실패를 오류로 알리지 않고 빈 블록만 보여주므로 조용한 실패다.
    expect(escapeLabel("`useState` 훅 정리")).toBe("#96;useState#96; 훅 정리");
    expect(decodeEntities(escapeLabel("`useState` 훅 정리"))).toBe("`useState` 훅 정리");
    // 비선행 백틱도 함께 치환한다 — 라벨 앞부분이 잘려나가면 선행이 되므로 위치로 분기하지 않는다.
    expect(escapeLabel("x `y`")).toBe("x #96;y#96;");
  });

  it("%%{ 를 무해화한다 — mermaid 디렉티브로 해석되어 config 주입·본문 소실이 일어난다", () => {
    // mermaid 는 preprocessDiagram 에서 인용 라벨을 구분하지 않고 원문 전체에
    // directiveRegex 를 적용한다. 실측 결과 3가지 실패가 확인됐다:
    //  - 미닫힘 `%%{` 하나가 남은 다이어그램 전체를 먹어치워 파스 에러
    //  - 닫힌 디렉티브 2개 이상이면 mermaid 내부 TypeError
    //  - `%%{init: {'theme':'forest'}}%%` 는 파스는 통과하지만 제목 텍스트가 소실되고
    //    실제로 getConfig().theme 이 바뀐다 — 노트 제목이 렌더 config 주입 경로가 된다
    expect(escapeLabel("%%{init 미완성")).toBe("%#37;{init 미완성");
    expect(decodeEntities(escapeLabel("%%{init 미완성"))).toBe("%%{init 미완성");
    const inject = "mermaid %%{init: {'theme':'forest'}}%% 사용법";
    expect(escapeLabel(inject)).not.toContain("%%{");
    expect(decodeEntities(escapeLabel(inject))).toBe(inject);
  });

  it("단독 %·%%·}%% 는 손대지 않는다 — 깨뜨려야 하는 것은 %%{ 시퀀스뿐이다", () => {
    // 실측상 `%` 단독·`%%` 단독·`}%%` 는 디렉티브로 해석되지 않는다.
    // 전부 엔티티화하면 "성장률 50% 분석" 같은 흔한 제목이 불필요하게 변형된다.
    expect(escapeLabel("성장률 50% 분석")).toBe("성장률 50% 분석");
    expect(escapeLabel("A %% B")).toBe("A %% B");
    expect(escapeLabel("A }%% B")).toBe("A }%% B");
  });

  it("화살표 유사 문자열은 > 만 엔티티화되고 원문으로 왕복한다", () => {
    // `>` 는 htmlLabels 때문에 엔티티화 대상이지만, 인용 라벨 안의 `-->` 는 애초에
    // 화살표로 해석되지 않는 텍스트다. 엔티티가 되어도 렌더는 원문 그대로다.
    expect(escapeLabel("A --> B ==> C")).toBe("A --#62; B ==#62; C");
    expect(decodeEntities(escapeLabel("A --> B ==> C"))).toBe("A --> B ==> C");
  });

  it("한글·이모지·CJK 를 원문 그대로 보존한다", () => {
    expect(escapeLabel("한글 제목 테스트")).toBe("한글 제목 테스트");
    expect(escapeLabel("🎉 파티 노트")).toBe("🎉 파티 노트");
    expect(escapeLabel("温度 25° 노트")).toBe("温度 25° 노트");
  });

  it("빈 문자열은 빈 문자열이다 — 빈 라벨 방어는 resolveLabel 책임", () => {
    expect(escapeLabel("")).toBe("");
  });

  it("개행·CR·TAB 을 공백으로 정규화한다 — 라벨이 줄을 넘으면 안 된다", () => {
    expect(escapeLabel("제목\n둘째줄")).toBe("제목 둘째줄");
    expect(escapeLabel("제목\r\n둘째줄")).toBe("제목 둘째줄");
    expect(escapeLabel("제목\t탭")).toBe("제목 탭");
  });

  it("속성: 결과에 어떤 줄바꿈 문자도 남지 않는다", () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (raw) => {
        // U+2028 LINE SEPARATOR / U+2029 PARAGRAPH SEPARATOR 도 줄바꿈으로 취급한다.
        expect(escapeLabel(raw)).not.toMatch(/[\r\n\t\u{2028}\u{2029}]/u);
      })
    );
  });

  it("속성: 결과에 이스케이프 안 된 위험 문자가 남지 않는다", () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (raw) => {
        const stripped = escapeLabel(raw).replace(/#(?:quot|60|62|38|35);/g, "");
        expect(stripped).not.toMatch(/["<>&#]/);
      })
    );
  });

  it("속성: 엔티티를 되돌리면 원문과 정확히 일치한다 — 문자 소실 없음", () => {
    fc.assert(
      // 줄바꿈류는 의도적으로 공백으로 정규화하므로(라벨이 줄을 넘으면 mermaid 가
      // 깨진다) 왕복 대상에서 제외한다. 그 외 모든 문자는 무손실이어야 한다.
      fc.property(
        fc.fullUnicodeString().filter((s) => !/[\r\n\t\u{2028}\u{2029}]/u.test(s)),
        (raw) => {
          expect(decodeEntities(escapeLabel(raw))).toBe(raw);
        }
      )
    );
  });
});

// === resolveLabel ===

describe("resolveLabel", () => {
  it("제목이 있으면 제목을 쓴다", () => {
    expect(resolveLabel("제목", "folder/note.md")).toBe("제목");
  });

  it("제목이 공백뿐이면 확장자를 뗀 basename 으로 폴백한다", () => {
    expect(resolveLabel("   ", "folder/sub/노트 이름.md")).toBe("노트 이름");
    expect(resolveLabel("", "note.md")).toBe("note");
  });

  it("제목과 basename 이 모두 비면 상수로 폴백한다 — 빈 라벨은 파스 에러", () => {
    expect(resolveLabel("", "")).toBe(UNTITLED_LABEL);
    expect(resolveLabel("", "folder/")).toBe(UNTITLED_LABEL);
    expect(resolveLabel("", "   ")).toBe(UNTITLED_LABEL);
  });

  it("확장자만 있는 경로는 이름 전체를 라벨로 쓴다 — 점 파일 이름 보존", () => {
    // `.md` 의 점은 확장자 구분자가 아니라 이름의 일부다(dot > 0 규칙).
    // 어느 쪽이든 빈 문자열이 아니라는 계약은 지켜진다.
    expect(resolveLabel("", ".md")).toBe(".md");
    expect(resolveLabel("", "folder/.hidden")).toBe(".hidden");
  });

  it("속성: 어떤 입력에도 빈 문자열을 반환하지 않는다", () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), fc.fullUnicodeString(), (title, path) => {
        expect(resolveLabel(title, path).length).toBeGreaterThan(0);
      })
    );
  });
});

// === mermaidNodeId ===

describe("mermaidNodeId", () => {
  it("n 접두사 순번을 만든다 — 예약어(end/graph/class) 충돌 불가", () => {
    expect(mermaidNodeId(0)).toBe("n0");
    expect(mermaidNodeId(42)).toBe("n42");
  });
});

// === buildMermaidGraph ===

describe("buildMermaidGraph", () => {
  const nodes: MermaidNode[] = [
    { path: "a.md", label: "A", cls: "seed" },
    { path: "b.md", label: "B", cls: "hop1" },
  ];
  const edges: MermaidEdge[] = [{ from: "a.md", to: "b.md" }];

  it("방향·노드·엣지·classDef·class 를 순서대로 조립한다", () => {
    const g = buildMermaidGraph(nodes, edges, {
      direction: "LR",
      classDefs: ["classDef seed fill:#e8f0ff"],
    });
    expect(g.markdown).toBe(
      [
        "```mermaid",
        "graph LR",
        '  n0["A"]',
        '  n1["B"]',
        "  n0 --> n1",
        "  classDef seed fill:#e8f0ff",
        "  class n0 seed",
        "  class n1 hop1",
        "```",
      ].join("\n")
    );
    assertValidMermaid(g.markdown);
  });

  it("TD 방향을 지원한다", () => {
    const g = buildMermaidGraph(nodes, [], { direction: "TD" });
    expect(mermaidLines(g.markdown)[0]).toBe("graph TD");
  });

  it("노드가 0개면 빈 문자열을 반환한다 — graph LR 만 내보내면 빈 사각형이 렌더된다", () => {
    const g = buildMermaidGraph([], [{ from: "x", to: "y" }], { direction: "LR" });
    expect(g).toEqual({ markdown: "", shownNodes: 0, totalNodes: 0, totalEdges: 0 });
  });

  it("같은 경로가 여러 번 들어오면 하나의 노드로 합치고 첫 라벨을 유지한다", () => {
    const g = buildMermaidGraph(
      [
        { path: "a.md", label: "첫번째" },
        { path: "a.md", label: "두번째" },
      ],
      [],
      { direction: "LR" }
    );
    expect(g.shownNodes).toBe(1);
    expect(g.totalNodes).toBe(1);
    expect(g.markdown).toContain('n0["첫번째"]');
    expect(g.markdown).not.toContain("두번째");
  });

  it("선언되지 않은 경로를 가리키는 엣지를 버린다 — 유령 노드 방지", () => {
    const g = buildMermaidGraph(nodes, [{ from: "ghost.md", to: "b.md" }], {
      direction: "LR",
    });
    expect(g.markdown).not.toContain("-->");
    expect(g.totalEdges).toBe(0);
    assertValidMermaid(g.markdown);
  });

  it("자기 자신을 가리키는 엣지를 버린다", () => {
    const g = buildMermaidGraph(nodes, [{ from: "a.md", to: "a.md" }], {
      direction: "LR",
    });
    expect(g.markdown).not.toContain("-->");
    expect(g.totalEdges).toBe(0);
  });

  it("중복 엣지를 하나로 합친다", () => {
    const g = buildMermaidGraph(nodes, [edges[0], { ...edges[0] }], {
      direction: "LR",
    });
    expect(g.markdown.match(/-->/g)).toHaveLength(1);
    expect(g.totalEdges).toBe(1);
  });

  it("엣지 라벨에도 같은 이스케이프를 적용한다", () => {
    const g = buildMermaidGraph(nodes, [{ from: "a.md", to: "b.md", label: '0.87 "x"' }], {
      direction: "LR",
    });
    expect(g.markdown).toContain('  n0 -->|"0.87 #quot;x#quot;"| n1');
    assertValidMermaid(g.markdown);
  });

  it("노드 라벨을 호출부가 미리 이스케이프하지 않아도 코어가 처리한다", () => {
    const g = buildMermaidGraph([{ path: "a.md", label: 'x"<&#' }], [], {
      direction: "LR",
    });
    expect(g.markdown).toContain('n0["x#quot;#60;#38;#35;"]');
    assertValidMermaid(g.markdown);
  });

  it("라벨이 비면 path 에서 유도한다", () => {
    const g = buildMermaidGraph([{ path: "folder/제목없음.md", label: "" }], [], {
      direction: "LR",
    });
    expect(g.markdown).toContain('n0["제목없음"]');
  });

  it("classDef 줄의 끝 세미콜론을 제거한다 — mermaid encodeEntities 가 잘라먹는다", () => {
    const g = buildMermaidGraph(nodes, [], {
      direction: "LR",
      classDefs: ["classDef seed fill:#e8f0ff,stroke:#4a6fa5;"],
    });
    expect(g.markdown).toContain("  classDef seed fill:#e8f0ff,stroke:#4a6fa5\n");
    assertValidMermaid(g.markdown);
  });

  it("같은 클래스의 노드를 한 줄로 묶는다", () => {
    const g = buildMermaidGraph(
      [
        { path: "a.md", label: "A", cls: "seed" },
        { path: "b.md", label: "B", cls: "hop1" },
        { path: "c.md", label: "C", cls: "seed" },
      ],
      [],
      { direction: "LR" }
    );
    expect(g.markdown).toContain("  class n0,n2 seed");
    expect(g.markdown).toContain("  class n1 hop1");
  });

  it("노드 상한을 넘으면 앞에서 자르고 전체 수를 보고한다", () => {
    const many: MermaidNode[] = Array.from(
      { length: MERMAID_MAX_NODES + 5 },
      (_, i) => ({ path: `n${i}.md`, label: `노트 ${i}` })
    );
    const g = buildMermaidGraph(many, [], { direction: "LR" });
    expect(g.shownNodes).toBe(MERMAID_MAX_NODES);
    expect(g.totalNodes).toBe(MERMAID_MAX_NODES + 5);
    expect(g.markdown).toContain(`n${MERMAID_MAX_NODES - 1}[`);
    expect(g.markdown).not.toContain(`n${MERMAID_MAX_NODES}[`);
    assertValidMermaid(g.markdown);
  });

  it("엣지 상한을 넘으면 자르되 고립된 노드는 남긴다", () => {
    const size = 20;
    const many: MermaidNode[] = Array.from({ length: size }, (_, i) => ({
      path: `n${i}.md`,
      label: `노트 ${i}`,
    }));
    const dense: MermaidEdge[] = [];
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (i !== j) dense.push({ from: `n${i}.md`, to: `n${j}.md` });
      }
    }
    const g = buildMermaidGraph(many, dense, { direction: "LR" });
    expect(g.totalEdges).toBe(size * (size - 1));
    expect(g.markdown.match(/-->/g)).toHaveLength(MERMAID_MAX_EDGES);
    // 노드는 전부 살아 있어야 한다 — 지우면 "볼트에 없다"로 오독된다.
    expect(g.shownNodes).toBe(size);
    assertValidMermaid(g.markdown);
  });

  it("노드 상한으로 잘린 노드를 참조하는 엣지도 함께 버린다", () => {
    const many: MermaidNode[] = Array.from(
      { length: MERMAID_MAX_NODES + 1 },
      (_, i) => ({ path: `n${i}.md`, label: `노트 ${i}` })
    );
    const g = buildMermaidGraph(
      many,
      [{ from: "n0.md", to: `n${MERMAID_MAX_NODES}.md` }],
      { direction: "LR" }
    );
    expect(g.totalEdges).toBe(0);
    assertValidMermaid(g.markdown);
  });

  it("같은 입력에 항상 같은 문자열을 반환한다 — 결정론", () => {
    const a = buildMermaidGraph(nodes, edges, { direction: "LR" });
    const b = buildMermaidGraph(nodes, edges, { direction: "LR" });
    expect(a.markdown).toBe(b.markdown);
  });

  it("인자로 받은 배열·객체를 변형하지 않는다", () => {
    const n = [...nodes];
    const e = [...edges];
    const snapshot = JSON.stringify({ n, e });
    buildMermaidGraph(n, e, { direction: "LR", classDefs: ["classDef seed fill:#fff;"] });
    expect(JSON.stringify({ n, e })).toBe(snapshot);
  });
});

// === buildSearchGraph ===

describe("buildSearchGraph", () => {
  it("시드에서 이웃으로 뻗는 그래프를 만든다", () => {
    const result: GraphRagResult = {
      items: [
        seed("S.md", "시드", 0.9),
        neighbor("N.md", "이웃", 0.7, "S.md", 1),
      ],
    };
    const g = buildSearchGraph(result);
    expect(g.shownNodes).toBe(2);
    expect(g.totalEdges).toBe(1);
    expect(g.markdown).toContain("graph LR");
    expect(g.markdown).toContain("  n0 --> n1");
    assertValidMermaid(g.markdown);
  });

  it("시드·1hop·2hop 을 classDef 로 구분한다", () => {
    const result: GraphRagResult = {
      items: [
        seed("S.md", "시드", 0.9),
        neighbor("N1.md", "1홉", 0.7, "S.md", 1),
        neighbor("N2.md", "2홉", 0.5, "S.md", 2),
      ],
    };
    const g = buildSearchGraph(result);
    expect(g.markdown).toContain("classDef seed ");
    expect(g.markdown).toContain("classDef hop1 ");
    expect(g.markdown).toContain("classDef hop2 ");
    expect(g.markdown).toContain("  class n0 seed");
    expect(g.markdown).toContain("  class n1 hop1");
    expect(g.markdown).toContain("  class n2 hop2");
    assertValidMermaid(g.markdown);
  });

  it("hop 3 이상도 hop2 클래스로 묶는다 — 클래스 폭발 방지", () => {
    const result: GraphRagResult = {
      items: [seed("S.md", "시드", 0.9), neighbor("N3.md", "3홉", 0.4, "S.md", 3)],
    };
    const g = buildSearchGraph(result);
    expect(g.markdown).toContain("  class n1 hop2");
  });

  it("combinedScore 를 노드 라벨에 소수 2자리로 붙인다", () => {
    const g = buildSearchGraph({ items: [seed("S.md", "시드", 0.8734)] });
    expect(g.markdown).toContain('n0["시드 (0.87)"]');
  });

  it("점수가 유한하지 않으면 접미사를 생략한다", () => {
    const g = buildSearchGraph({
      items: [item({ path: "S.md", title: "시드", combinedScore: NaN })],
    });
    expect(g.markdown).toContain('n0["시드"]');
    assertValidMermaid(g.markdown);
  });

  it("엣지에는 라벨을 붙이지 않는다 — 엣지는 링크 관계이고 점수는 노드 속성이다", () => {
    const g = buildSearchGraph({
      items: [seed("S.md", "시드", 0.9), neighbor("N.md", "이웃", 0.7, "S.md")],
    });
    expect(g.markdown).not.toContain("-->|");
  });

  it("items 가 빈 배열이면 빈 문자열을 반환한다 — 검색 0건", () => {
    const g = buildSearchGraph({ items: [] });
    expect(g.markdown).toBe("");
    expect(g.shownNodes).toBe(0);
    expect(g.totalNodes).toBe(0);
    expect(g.totalEdges).toBe(0);
  });

  it("invalidQuery 로 items 가 비어도 빈 문자열이다", () => {
    const g = buildSearchGraph({ items: [], invalidQuery: true });
    expect(g.markdown).toBe("");
  });

  it("items 가 없어도(비정상 입력) 터지지 않는다", () => {
    const g = buildSearchGraph({} as GraphRagResult);
    expect(g.markdown).toBe("");
  });

  it("전부 시드이고 이웃이 없으면(depth 0) 노드만 그리고 엣지는 만들지 않는다", () => {
    const g = buildSearchGraph({
      items: [seed("A.md", "가", 0.9), seed("B.md", "나", 0.8), seed("C.md", "다", 0.7)],
    });
    expect(g.shownNodes).toBe(3);
    expect(g.totalEdges).toBe(0);
    expect(g.markdown).not.toContain("-->");
    expect(g.markdown).toContain("  class n0,n1,n2 seed");
    assertValidMermaid(g.markdown);
  });

  it("seedPath 가 items 에 없으면 엣지를 버리고 고립 노드로 남긴다 — 유령 노드 금지", () => {
    const g = buildSearchGraph({
      items: [neighbor("N.md", "이웃", 0.7, "잘려나간시드.md", 1)],
    });
    expect(g.shownNodes).toBe(1);
    expect(g.totalEdges).toBe(0);
    expect(g.markdown).not.toContain("-->");
    expect(g.markdown).toContain('n0["이웃 (0.70)"]');
    assertValidMermaid(g.markdown);
  });

  it("seedPath 가 null 인 이웃(비정상)도 엣지 없이 처리한다", () => {
    const g = buildSearchGraph({
      items: [item({ path: "N.md", title: "이웃", hop: 1, isSeed: false, seedPath: null })],
    });
    expect(g.totalEdges).toBe(0);
    assertValidMermaid(g.markdown);
  });

  it("같은 경로가 여러 항목으로 중복되면 하나의 노드로 합친다 — 방어적 확인", () => {
    const g = buildSearchGraph({
      items: [
        seed("S.md", "시드", 0.9),
        neighbor("N.md", "이웃", 0.7, "S.md", 1),
        // traverseGraph 는 최소 hop 하나만 남기므로 정상적으로는 없어야 하는 중복
        neighbor("N.md", "이웃 중복", 0.6, "S.md", 2),
      ],
    });
    expect(g.shownNodes).toBe(2);
    expect(g.totalNodes).toBe(2);
    expect(g.markdown).not.toContain("중복");
    expect(g.markdown.match(/-->/g)).toHaveLength(1);
    assertValidMermaid(g.markdown);
  });

  it("staleEmbeddings 여도 그래프를 그린다 — 신뢰도 고지는 호출부 책임", () => {
    const g = buildSearchGraph({
      items: [seed("S.md", "시드", 0.9), neighbor("N.md", "이웃", 0.7, "S.md")],
      staleEmbeddings: true,
    });
    expect(g.shownNodes).toBe(2);
    expect(g.markdown).toContain("  n0 --> n1");
    // 순수 코어는 언어 테이블을 모른다 — 경고 문구가 코드블록에 섞이면 안 된다.
    expect(g.markdown).not.toMatch(/재인덱싱|stale|경고/);
    assertValidMermaid(g.markdown);
  });

  it("usedKeywordFallback 여도 그래프를 그린다", () => {
    const g = buildSearchGraph({
      items: [seed("S.md", "시드", 0.9)],
      usedKeywordFallback: true,
    });
    expect(g.shownNodes).toBe(1);
    expect(g.markdown).not.toMatch(/키워드|fallback/);
    assertValidMermaid(g.markdown);
  });

  it("제목의 위험 문자를 이스케이프한다", () => {
    const g = buildSearchGraph({
      items: [seed("S.md", '노트 [초안] & 검토 (2026) | v2 "final" #35;', 0.9)],
    });
    expect(g.markdown).toContain(
      '  n0["노트 [초안] #38; 검토 (2026) | v2 #quot;final#quot; #35;35; (0.90)"]'
    );
    assertValidMermaid(g.markdown);
  });

  it("제목이 비면 basename 으로 폴백한다 — 빈 라벨은 파스 에러", () => {
    const g = buildSearchGraph({
      items: [item({ path: "folder/제목없는노트.md", title: "", combinedScore: 0.5 })],
    });
    expect(g.markdown).toContain('n0["제목없는노트 (0.50)"]');
    assertValidMermaid(g.markdown);
  });

  it("상한을 넘으면 시드를 우선 보존하고 전체 수를 보고한다", () => {
    const items: GraphRagSearchItem[] = [];
    // 이웃을 먼저(점수 높게), 시드를 뒤(점수 낮게) 배치해 시드 우선 보존을 강제 검증한다.
    for (let i = 0; i < MERMAID_MAX_NODES; i++) {
      items.push(neighbor(`N${i}.md`, `이웃 ${i}`, 0.9, "S0.md", 1));
    }
    items.push(seed("S0.md", "시드", 0.1));
    const g = buildSearchGraph({ items });

    expect(g.totalNodes).toBe(MERMAID_MAX_NODES + 1);
    expect(g.shownNodes).toBe(MERMAID_MAX_NODES);
    // 시드가 살아남아 첫 노드로 선언되고, 이웃 엣지가 유효하다.
    expect(g.markdown).toContain('n0["시드 (0.10)"]');
    expect(g.totalEdges).toBe(MERMAID_MAX_NODES - 1);
    assertValidMermaid(g.markdown);
  });

  it("절단이 없으면 shownNodes 와 totalNodes 가 같다 — 호출부가 고지 여부를 판단한다", () => {
    const g = buildSearchGraph({
      items: [seed("S.md", "시드", 0.9), neighbor("N.md", "이웃", 0.7, "S.md")],
    });
    expect(g.shownNodes).toBe(g.totalNodes);
  });

  it("결과 배열을 변형하지 않는다", () => {
    const items = [seed("S.md", "시드", 0.9), neighbor("N.md", "이웃", 0.7, "S.md")];
    const snapshot = JSON.stringify(items);
    buildSearchGraph({ items });
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it("같은 입력에 항상 같은 문자열을 반환한다 — 결정론", () => {
    const result: GraphRagResult = {
      items: [seed("S.md", "시드", 0.9), neighbor("N.md", "이웃", 0.7, "S.md")],
    };
    expect(buildSearchGraph(result).markdown).toBe(buildSearchGraph(result).markdown);
  });

  it("속성: 임의의 제목·경로 조합에도 유효한 mermaid 를 생성한다", () => {
    // 개행이 섞인 제목도 그대로 넣는다 — escapeLabel 이 공백으로 접으므로 줄 단위
    // 구조가 유지되어야 한다. 이게 깨지면 노드 선언이 두 줄로 쪼개진다.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            path: fc.fullUnicodeString({ minLength: 1, maxLength: 12 }),
            title: fc.fullUnicodeString({ maxLength: 12 }),
            score: fc.double({ min: 0, max: 1, noNaN: true }),
            isSeed: fc.boolean(),
          }),
          { minLength: 1, maxLength: 30 }
        ),
        (raw) => {
          const items = raw.map((r, i) =>
            r.isSeed
              ? seed(r.path, r.title, r.score)
              : neighbor(r.path, r.title, r.score, raw[0].path, 1 + (i % 3))
          );
          const g = buildSearchGraph({ items });
          if (g.markdown === "") return;
          assertValidMermaid(g.markdown);
        }
      )
    );
  });
});
