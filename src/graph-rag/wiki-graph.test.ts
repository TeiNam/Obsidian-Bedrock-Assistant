// 위키 폴더 구조 그래프 테스트 (Wiki Graph)
// ==========================================
// buildWikiGraph는 순수 함수이므로 Vault·LLM·i18n 없이 가짜 VaultIndexEntry만으로
// 전부 검증한다. mermaid를 테스트 의존성으로 추가하지 않고(신규 의존성 0 원칙),
// "생성된 문자열이 mermaid 문법 계약을 지키는가"를 구조적으로 단정한다.
//
// 특히 중점 검증:
// - 위키 노트가 서로 전혀 연결되지 않은 상태(= 파일 더미)가 그림에서 즉시 드러나는가
// - 라벨에 이스케이프되지 않은 위험 문자(" < > & #)가 남지 않는가
// - 경로 판별이 세그먼트 경계 기준인가(제목에 카테고리 이름이 들어간 오탐 방지)

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { VaultIndexEntry } from "../types";
import { DEFAULT_SECOND_BRAIN_SETTINGS } from "../types";
import { WIKI_CATEGORIES } from "../second-brain/wiki-structure";
import {
  buildWikiGraph,
  WIKI_GRAPH_MAX_NODES,
  WIKI_GRAPH_MAX_EDGES,
} from "./wiki-graph";

const WIKI = DEFAULT_SECOND_BRAIN_SETTINGS.wikiFolder; // "Second Brain"

/** 테스트용 VaultIndexEntry 팩토리 — 그래프가 쓰지 않는 필드는 최소값으로 채운다. */
function entry(
  path: string,
  title: string,
  outlinks: string[] = [],
  backlinks: string[] = [],
): VaultIndexEntry {
  return {
    path,
    title,
    embedding: [],
    lastModified: 0,
    excerpt: "",
    outlinks,
    backlinks,
  };
}

/** 활성 상태 기본 옵션. */
function opts(wikiFolder: string = WIKI) {
  return { wikiFolder, enabled: true };
}

/** mermaid 코드블록 본문(펜스 제외) 줄 목록. */
function bodyLines(markdown: string): string[] {
  const lines = markdown.split("\n");
  expect(lines[0]).toBe("```mermaid");
  // 공유 코어(buildMermaidGraph)와 동일하게 닫는 펜스가 마지막 줄이다(끝 개행 없음).
  expect(lines[lines.length - 1]).toBe("```");
  return lines.slice(1, -1);
}

/** 들여쓰기를 제거한 본문 줄 목록 — 접두사 검사용. */
function trimmedLines(markdown: string): string[] {
  return bodyLines(markdown).map((l) => l.trim());
}

/** `["..."]` 형태로 선언된 모든 라벨 본문을 추출한다(노드 라벨 + 서브그래프 라벨). */
function labelsOf(markdown: string): string[] {
  // 이스케이프 후 라벨 안에는 raw `"`가 존재할 수 없으므로 [^"]* 로 안전하게 끊긴다.
  return [...markdown.matchAll(/\["([^"]*)"\]/g)].map((m) => m[1]);
}

/** 노드 선언(`  nN["..."]`)에서 id 목록을 추출한다. */
function declaredIds(markdown: string): string[] {
  return [...markdown.matchAll(/^\s+(n\d+)\["/gm)].map((m) => m[1]);
}

/**
 * subgraph 라벨만 선언 순서대로 추출한다(= 카테고리 그룹).
 * 노드 라벨과 반드시 분리해야 한다 — 노트 제목이 "entities" 인 경우처럼 노드 라벨이
 * 카테고리 이름과 같을 수 있어, 전체 라벨을 이름으로 걸러내면 그룹으로 오탐된다.
 */
function groupLabels(markdown: string): string[] {
  return [...markdown.matchAll(/^\s+subgraph g\d+\["([^"]*)"\]$/gm)].map((m) => m[1]);
}

/** 노드 라벨만 선언 순서대로 추출한다. */
function nodeLabels(markdown: string): string[] {
  return [...markdown.matchAll(/^\s+n\d+\["([^"]*)"\]$/gm)].map((m) => m[1]);
}

/** 엣지 줄(`  nA --> nB`)의 (from, to) 목록. */
function edgePairs(markdown: string): Array<[string, string]> {
  return [...markdown.matchAll(/^\s+(n\d+) --> (n\d+)$/gm)].map((m) => [m[1], m[2]]);
}

/** 주어진 클래스명으로 적용된 `class` 줄의 노드 id 목록. 줄이 없으면 null. */
function classMembers(markdown: string, cls: string): string[] | null {
  const line = trimmedLines(markdown).find(
    (l) => l.startsWith("class ") && l.endsWith(` ${cls}`),
  );
  if (!line) return null;
  return line.slice("class ".length, -` ${cls}`.length).split(",");
}

/**
 * mermaid 문법 계약을 구조적으로 단정한다.
 * mermaid 파서를 붙이지 않고도 "파스를 깨는 알려진 원인"을 전부 막는다.
 */
function assertMermaidShape(markdown: string): void {
  // 1) 코드펜스가 닫혀 있고 다이어그램 타입 선언으로 시작한다.
  expect(markdown.startsWith("```mermaid\n")).toBe(true);
  expect(markdown.endsWith("\n```")).toBe(true);

  const lines = trimmedLines(markdown);
  expect(lines[0]).toBe("graph TD");

  // 2) subgraph / end 개수가 일치한다(불일치는 파스 에러).
  const subgraphs = lines.filter((l) => l.startsWith("subgraph ")).length;
  const ends = lines.filter((l) => l === "end").length;
  expect(ends).toBe(subgraphs);

  // 3) 모든 라벨은 비어 있지 않고, 이스케이프되지 않은 위험 문자가 없다.
  for (const label of labelsOf(markdown)) {
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toContain('"'); // 인용 라벨을 깨는 유일한 문자
    expect(label).not.toContain("<");
    expect(label).not.toContain(">");
    expect(label).not.toContain("&");
    // `#`은 엔티티 형태(#quot; / #35;)로만 존재해야 한다.
    expect(label.replace(/#(?:quot|\d+);/g, "")).not.toContain("#");
  }

  // 4) 노드 id는 예약어를 절대 만들지 않는 `n` + 순번 형태다.
  const ids = declaredIds(markdown);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length); // 중복 선언 없음
  for (const id of ids) expect(id).toMatch(/^n\d+$/);

  // 5) 엣지 양 끝이 모두 선언된 노드다(미선언 id = 유령 노드).
  const idSet = new Set(ids);
  for (const [from, to] of edgePairs(markdown)) {
    expect(idSet.has(from)).toBe(true);
    expect(idSet.has(to)).toBe(true);
  }

  // 6) classDef 줄은 세미콜론으로 끝나지 않고, dasharray에 콤마가 없다.
  for (const line of lines.filter((l) => l.startsWith("classDef "))) {
    expect(line.endsWith(";")).toBe(false);
    expect(line).not.toMatch(/stroke-dasharray:\s*\d+\s*,/);
  }

  // 7) class 적용 줄에 빈 id 목록이 없다(`class  wiki`는 파스 에러).
  for (const line of lines.filter((l) => l.startsWith("class "))) {
    expect(line).toMatch(/^class n\d+(?:,n\d+)* [a-z]+$/);
  }

  // 8) 본문 모든 줄이 우리가 생성하는 문법의 부분집합에만 매치한다.
  for (const line of lines.slice(1)) {
    expect(line).toMatch(
      /^(?:subgraph g\d+\["[^"]*"\]|end|n\d+\["[^"]*"\]|n\d+ --> n\d+|classDef [A-Za-z][\w-]* [^;]+|class n\d+(?:,n\d+)* [A-Za-z][\w-]*)$/,
    );
  }
}

describe("buildWikiGraph — 중단 조건", () => {
  it("Second Brain이 비활성이면 그래프를 만들지 않고 disabled를 보고한다", () => {
    const entries = [entry(`${WIKI}/concepts/a.md`, "A")];

    const graph = buildWikiGraph(entries, { wikiFolder: WIKI, enabled: false });

    expect(graph.status).toBe("disabled");
    expect(graph.markdown).toBe("");
    expect(graph.shownNodes).toBe(0);
    expect(graph.totalNodes).toBe(0);
  });

  it("엔트리가 0개면 empty를 보고하고 빈 코드블록을 만들지 않는다", () => {
    const graph = buildWikiGraph([], opts());

    expect(graph.status).toBe("empty");
    // `graph TD`만 있는 블록은 파스는 되지만 빈 사각형이 렌더되어 고장으로 보인다.
    expect(graph.markdown).toBe("");
  });

  it("위키 폴더가 없어 위키 노트가 0개면 empty를 보고한다", () => {
    // Second Brain을 켜기만 하고 안 쓴 가장 흔한 초기 상태.
    const entries = [entry("Daily/2026-08-02.md", "일지"), entry("Ideas/x.md", "X")];

    const graph = buildWikiGraph(entries, opts());

    expect(graph.status).toBe("empty");
    expect(graph.markdown).toBe("");
    expect(graph.totalNodes).toBe(0);
  });

  it("카테고리 폴더만 만들어져 있고 안이 비어 있으면 empty를 보고한다", () => {
    // ensureWikiFolders가 만든 빈 폴더는 인덱스 엔트리가 아니므로 노트가 0개다.
    const entries = [entry("Notes/other.md", "다른 노트")];

    const graph = buildWikiGraph(entries, opts());

    expect(graph.status).toBe("empty");
    expect(graph.markdown).toBe("");
  });

  it("위키 폴더에 생성물(index.md/log.md)만 있으면 empty를 보고한다", () => {
    // index.md는 모든 위키 노트를 링크하므로 노드로 넣으면 "전부 연결됨"으로 오독된다.
    const entries = [
      entry(`${WIKI}/index.md`, "Index", [`${WIKI}/concepts/a.md`]),
      entry(`${WIKI}/log.md`, "Log"),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(graph.status).toBe("empty");
    expect(graph.markdown).toBe("");
  });
});

describe("buildWikiGraph — wikiFolder 방어", () => {
  it("wikiFolder가 빈 문자열이면 기본 위키 폴더로 보정한다", () => {
    const entries = [entry(`${WIKI}/concepts/a.md`, "A")];

    const graph = buildWikiGraph(entries, { wikiFolder: "", enabled: true });

    expect(graph.status).toBe("ok");
    expect(graph.totalNodes).toBe(1);
  });

  it("wikiFolder가 공백만이면 기본 위키 폴더로 보정한다", () => {
    const entries = [entry(`${WIKI}/entities/b.md`, "B")];

    const graph = buildWikiGraph(entries, { wikiFolder: "   ", enabled: true });

    expect(graph.status).toBe("ok");
    expect(graph.totalNodes).toBe(1);
  });

  it("wikiFolder의 앞뒤 공백과 끝 슬래시를 정규화한다", () => {
    const entries = [entry("Wiki/concepts/a.md", "A")];

    const graph = buildWikiGraph(entries, { wikiFolder: "  Wiki/  ", enabled: true });

    expect(graph.status).toBe("ok");
    expect(graph.totalNodes).toBe(1);
  });

  it("위키 폴더명을 접두사로 갖는 다른 폴더는 포함하지 않는다", () => {
    // "Second Brain2"는 "Second Brain" 하위가 아니다 — 세그먼트 경계 비교.
    const entries = [
      entry(`${WIKI}2/concepts/a.md`, "남의 노트"),
      entry(`${WIKI}/concepts/mine.md`, "내 노트"),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(graph.totalNodes).toBe(1);
    expect(labelsOf(graph.markdown)).toContain("내 노트");
    expect(labelsOf(graph.markdown)).not.toContain("남의 노트");
  });
});

describe("buildWikiGraph — 카테고리 분류(세그먼트 경계)", () => {
  it("표준 카테고리 폴더 하위 노트를 해당 subgraph로 묶는다", () => {
    const entries = [
      entry(`${WIKI}/entities/e.md`, "엔티티"),
      entry(`${WIKI}/concepts/c.md`, "개념"),
      entry(`${WIKI}/projects/p.md`, "프로젝트"),
    ];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    for (const category of WIKI_CATEGORIES) {
      expect(graph.markdown).toContain(`subgraph g`);
      expect(labelsOf(graph.markdown)).toContain(category);
    }
  });

  it("위키 루트 직속 노트는 기타 그룹으로 묶는다", () => {
    const entries = [entry(`${WIKI}/root-note.md`, "루트 노트")];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(labelsOf(graph.markdown)).toContain("기타");
    expect(labelsOf(graph.markdown)).toContain("루트 노트");
  });

  it("제목에 카테고리 이름이 들어가도 루트 직속이면 기타로 분류한다", () => {
    // 경로 판별을 문자열 포함으로 하면 오탐 — 세그먼트 경계로 비교해야 한다.
    const entries = [
      entry(`${WIKI}/concepts note.md`, "concepts note"),
      entry(`${WIKI}/my projects overview.md`, "my projects overview"),
      entry(`${WIKI}/entities.md`, "entities"),
    ];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    // 표준 카테고리 subgraph는 하나도 만들어지지 않고 기타만 존재해야 한다.
    expect(groupLabels(graph.markdown)).toEqual(["기타"]);
  });

  it("카테고리 이름을 접두사로 갖는 폴더는 기타로 분류한다", () => {
    const entries = [
      entry(`${WIKI}/entities-backup/x.md`, "백업"),
      entry(`${WIKI}/conceptsold/y.md`, "예전"),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(groupLabels(graph.markdown)).toEqual(["기타"]);
  });

  it("카테고리 하위의 더 깊은 폴더도 그 카테고리로 분류한다", () => {
    const entries = [entry(`${WIKI}/entities/people/kim.md`, "김씨")];

    const graph = buildWikiGraph(entries, opts());

    expect(groupLabels(graph.markdown)).toEqual(["entities"]);
  });

  it("그룹 순서는 WIKI_CATEGORIES 순서 뒤에 기타로 고정된다", () => {
    const entries = [
      entry(`${WIKI}/root.md`, "루트"),
      entry(`${WIKI}/projects/p.md`, "P"),
      entry(`${WIKI}/entities/e.md`, "E"),
      entry(`${WIKI}/concepts/c.md`, "C"),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(groupLabels(graph.markdown)).toEqual(["entities", "concepts", "projects", "기타"]);
  });
});

describe("buildWikiGraph — 링크(엣지)", () => {
  it("위키 내부 상호 링크를 엣지로 그린다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A", [`${WIKI}/concepts/b.md`]),
      entry(`${WIKI}/concepts/b.md`, "B"),
    ];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(edgePairs(graph.markdown)).toHaveLength(1);
    expect(graph.totalEdges).toBe(1);
    expect(graph.shownEdges).toBe(1);
  });

  it("백링크로만 표현된 관계도 엣지로 복원한다", () => {
    // 인덱스가 outlinks/backlinks 중 한쪽만 갖는 어긋난 상태에서도 연결을 놓치지 않는다.
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A"),
      entry(`${WIKI}/concepts/b.md`, "B", [], [`${WIKI}/concepts/a.md`]),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(edgePairs(graph.markdown)).toHaveLength(1);
  });

  it("같은 방향의 중복 링크는 엣지 하나로 합친다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A", [`${WIKI}/concepts/b.md`]),
      entry(`${WIKI}/concepts/b.md`, "B", [], [`${WIKI}/concepts/a.md`]),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(graph.totalEdges).toBe(1);
    expect(edgePairs(graph.markdown)).toHaveLength(1);
  });

  it("상호 링크(양방향)는 방향별로 각각 그린다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A", [`${WIKI}/concepts/b.md`]),
      entry(`${WIKI}/concepts/b.md`, "B", [`${WIKI}/concepts/a.md`]),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(graph.totalEdges).toBe(2);
  });

  it("위키 밖으로 나가는 링크는 그리지 않고 개수만 보고한다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A", ["Daily/2026-08-02.md", "Ideas/x.md"]),
    ];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    // 볼트 전체가 딸려오지 않는다 — 노드는 위키 노트 1개뿐.
    expect(declaredIds(graph.markdown)).toHaveLength(1);
    expect(edgePairs(graph.markdown)).toHaveLength(0);
    expect(graph.externalLinks).toBe(2);
    expect(graph.totalEdges).toBe(0);
  });

  it("위키 밖에서 들어오는 링크는 외부 링크로 세지 않는다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A", [], ["Daily/2026-08-02.md"]),
      entry("Daily/2026-08-02.md", "일지", [`${WIKI}/concepts/a.md`]),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(graph.externalLinks).toBe(0);
    expect(edgePairs(graph.markdown)).toHaveLength(0);
  });

  it("존재하지 않는 위키 노트를 가리키는 링크로 유령 노드를 만들지 않는다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A", [`${WIKI}/concepts/ghost.md`]),
    ];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(declaredIds(graph.markdown)).toHaveLength(1);
    expect(edgePairs(graph.markdown)).toHaveLength(0);
  });

  it("자기 자신을 가리키는 링크는 엣지로 그리지 않는다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A", [`${WIKI}/concepts/a.md`]),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(graph.totalEdges).toBe(0);
  });

  it("중복 경로 엔트리는 노드 하나로 합친다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A"),
      entry(`${WIKI}/concepts/a.md`, "A"),
    ];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(graph.totalNodes).toBe(1);
    expect(declaredIds(graph.markdown)).toHaveLength(1);
  });

  it("index.md를 경유한 연결은 엣지로 그리지 않는다", () => {
    // 카탈로그가 모든 노트를 링크하므로 포함하면 "전부 연결됨"으로 거짓 신호가 된다.
    const entries = [
      entry(`${WIKI}/index.md`, "Index", [
        `${WIKI}/concepts/a.md`,
        `${WIKI}/concepts/b.md`,
      ]),
      entry(`${WIKI}/concepts/a.md`, "A", [], [`${WIKI}/index.md`]),
      entry(`${WIKI}/concepts/b.md`, "B", [], [`${WIKI}/index.md`]),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(graph.totalNodes).toBe(2);
    expect(graph.totalEdges).toBe(0);
    // 생성물로 향하는 링크는 "위키 밖"이 아니므로 외부 링크로도 세지 않는다.
    expect(graph.externalLinks).toBe(0);
  });
});

describe("buildWikiGraph — 연결 없음이 즉시 드러난다", () => {
  it("서로 전혀 연결되지 않으면 모든 노드를 isolated로 표시하고 엣지가 0이다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A"),
      entry(`${WIKI}/entities/b.md`, "B"),
      entry(`${WIKI}/root.md`, "C"),
    ];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(graph.totalEdges).toBe(0);
    expect(graph.markdown).not.toContain(" --> ");
    // 3개 노드 전부 isolated 클래스 — 그림 전체가 경고색 점선 상자가 된다.
    expect(classMembers(graph.markdown, "isolated")).toHaveLength(3);
    // 연결된 노드용 class 줄은 아예 나오지 않는다.
    expect(classMembers(graph.markdown, "wiki")).toBeNull();
  });

  it("연결된 노트는 isolated로 표시하지 않는다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A", [`${WIKI}/concepts/b.md`]),
      entry(`${WIKI}/concepts/b.md`, "B"),
      entry(`${WIKI}/root.md`, "고립"),
    ];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(classMembers(graph.markdown, "wiki")).toHaveLength(2);
    expect(classMembers(graph.markdown, "isolated")).toHaveLength(1);
  });

  it("노드가 절단되어도 고립 판정은 전체 위키 기준으로 한다", () => {
    // 절단된 이웃 때문에 연결된 노트가 고립으로 잘못 표시되면 신호가 거짓이 된다.
    const entries: VaultIndexEntry[] = [];
    for (let i = 0; i < WIKI_GRAPH_MAX_NODES + 10; i += 1) {
      const id = String(i).padStart(3, "0");
      entries.push(entry(`${WIKI}/entities/${id}.md`, `E${id}`));
    }
    // 첫 노트와 마지막(절단될) 노트를 연결한다.
    const last = entries[entries.length - 1];
    entries[0] = entry(entries[0].path, entries[0].title, [last.path]);

    const graph = buildWikiGraph(entries, opts());

    expect(graph.totalEdges).toBe(1);
    // n0(첫 노트)은 연결된 노트이므로 isolated 목록에 들어가지 않는다.
    expect(classMembers(graph.markdown, "isolated")).not.toContain("n0");
    expect(classMembers(graph.markdown, "wiki")).toContain("n0");
    // isolatedNodes는 절단 전 전체(70) 기준이다. 절단 후(60) 기준으로 세면
    // 잘려나간 이웃이 통계에서 사라져 "연결됨"을 과소 보고한다.
    expect(graph.totalNodes).toBe(WIKI_GRAPH_MAX_NODES + 10);
    expect(graph.isolatedNodes).toBe(graph.totalNodes - 2);
  });

  it("isolatedNodes가 연결 없음을 숫자로도 보고한다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A"),
      entry(`${WIKI}/entities/b.md`, "B"),
    ];

    const graph = buildWikiGraph(entries, opts());

    // 호출부가 "지식 베이스가 아니라 파일 더미"임을 문구로 알릴 수 있는 근거.
    expect(graph.isolatedNodes).toBe(2);
    expect(graph.totalEdges).toBe(0);
  });
});

describe("buildWikiGraph — 라벨 이스케이프", () => {
  it("인용 라벨을 깨는 5개 문자만 엔티티로 치환한다", () => {
    const raw = 'A "quoted" <b> & #35; end';
    const entries = [entry(`${WIKI}/concepts/a.md`, raw)];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(labelsOf(graph.markdown)).toContain(
      "A #quot;quoted#quot; #60;b#62; #38; #35;35; end",
    );
  });

  it("대괄호·파이프 등 안전한 문자는 원문 그대로 보존한다", () => {
    // 과잉 새니타이즈는 한국어 제목의 실제 정보를 파괴한다. 인용 라벨 안에서
    // `[ ] ( ) { } |` 는 실측으로 전부 안전하므로 손대지 않는다.
    const raw = "노트 [초안] (2026) | v2 {검토}";
    const entries = [entry(`${WIKI}/concepts/a.md`, raw)];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(nodeLabels(graph.markdown)).toContain(raw);
  });

  it("화살표 유사 문자는 `>`만 엔티티화되고 렌더 시 원문으로 되돌아간다", () => {
    // `>`는 htmlLabels(기본 true) 때문에 엔티티화가 필수다. mermaid가 렌더 시
    // `#62;`를 `>`로 디코드하므로 사용자가 보는 제목은 훼손되지 않는다.
    const entries = [entry(`${WIKI}/concepts/a.md`, "A --> B")];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(nodeLabels(graph.markdown)).toContain("A --#62; B");
  });

  it("한글·이모지·CJK 제목을 훼손하지 않는다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "한글 제목 테스트"),
      entry(`${WIKI}/concepts/b.md`, "🎉 파티 노트"),
      entry(`${WIKI}/concepts/c.md`, "温度 25° 노트"),
    ];

    const graph = buildWikiGraph(entries, opts());
    const labels = labelsOf(graph.markdown);

    expect(labels).toContain("한글 제목 테스트");
    expect(labels).toContain("🎉 파티 노트");
    expect(labels).toContain("温度 25° 노트");
  });

  it("서브그래프 라벨도 같은 이스케이프를 거친다", () => {
    // 카테고리 라벨은 상수지만, 라벨 생성 지점이 모두 같은 함수를 거치는지 확인한다.
    const entries = [entry(`${WIKI}/root.md`, "루트")];

    const graph = buildWikiGraph(entries, opts());

    // 기타 그룹 라벨이 인용 라벨 형태로 선언된다.
    expect(graph.markdown).toMatch(/subgraph g\d+\["기타"\]/);
  });

  it("제목이 비면 파일명으로, 파일명도 비면 상수로 대체한다", () => {
    const entries = [
      entry(`${WIKI}/concepts/파일명.md`, ""),
      entry(`${WIKI}/concepts/공백.md`, "   "),
    ];

    const graph = buildWikiGraph(entries, opts());
    // `n1[""]`는 mermaid 파스 에러이므로 빈 라벨이 절대 나오면 안 된다.
    assertMermaidShape(graph.markdown);

    const labels = labelsOf(graph.markdown);
    expect(labels).toContain("파일명");
    expect(labels).toContain("공백");
  });

  it("제목에 개행이 있어도 노드 선언이 한 줄로 유지된다", () => {
    // 라벨 내 실제 개행은 노드 선언을 두 줄로 쪼개 그래프 전체를 깨뜨린다.
    const entries = [entry(`${WIKI}/concepts/a.md`, "첫 줄\n둘째 줄\t탭")];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(nodeLabels(graph.markdown)).toContain("첫 줄 둘째 줄 탭");
  });

  it("제목과 파일명이 모두 비어도 빈 라벨을 만들지 않는다", () => {
    const entries = [entry(`${WIKI}/.md`, "")];

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(graph.markdown).not.toContain('[""]');
  });
});

describe("buildWikiGraph — 상한과 절단 보고", () => {
  it("노드 상한을 넘으면 상한까지만 그리고 전체 수를 보고한다", () => {
    const entries: VaultIndexEntry[] = [];
    const total = WIKI_GRAPH_MAX_NODES + 40;
    for (let i = 0; i < total; i += 1) {
      const id = String(i).padStart(3, "0");
      entries.push(entry(`${WIKI}/entities/${id}.md`, `E${id}`));
    }

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(graph.totalNodes).toBe(total);
    expect(graph.shownNodes).toBe(WIKI_GRAPH_MAX_NODES);
    expect(declaredIds(graph.markdown)).toHaveLength(WIKI_GRAPH_MAX_NODES);
  });

  it("절단 시 한 카테고리가 상한을 다 먹지 않도록 균등 배분한다", () => {
    const entries: VaultIndexEntry[] = [];
    for (let i = 0; i < 100; i += 1) {
      entries.push(entry(`${WIKI}/entities/${String(i).padStart(3, "0")}.md`, `E${i}`));
    }
    for (let i = 0; i < 5; i += 1) {
      entries.push(entry(`${WIKI}/concepts/c${i}.md`, `C${i}`));
    }
    for (let i = 0; i < 5; i += 1) {
      entries.push(entry(`${WIKI}/projects/p${i}.md`, `P${i}`));
    }

    const graph = buildWikiGraph(entries, opts());

    expect(graph.shownNodes).toBe(WIKI_GRAPH_MAX_NODES);
    const labels = labelsOf(graph.markdown);
    // 소수 카테고리가 통째로 사라지지 않는다.
    for (let i = 0; i < 5; i += 1) {
      expect(labels).toContain(`C${i}`);
      expect(labels).toContain(`P${i}`);
    }
  });

  it("엣지 상한을 넘으면 엣지만 자르고 고립된 노드는 남긴다", () => {
    // 60개 노트가 서로 전부 링크 → 방향별 3540개 엣지.
    const paths: string[] = [];
    for (let i = 0; i < WIKI_GRAPH_MAX_NODES; i += 1) {
      paths.push(`${WIKI}/entities/${String(i).padStart(3, "0")}.md`);
    }
    const entries = paths.map((p, i) =>
      entry(p, `E${i}`, paths.filter((other) => other !== p)),
    );

    const graph = buildWikiGraph(entries, opts());
    assertMermaidShape(graph.markdown);

    expect(graph.totalEdges).toBe(
      WIKI_GRAPH_MAX_NODES * (WIKI_GRAPH_MAX_NODES - 1),
    );
    expect(graph.shownEdges).toBe(WIKI_GRAPH_MAX_EDGES);
    expect(edgePairs(graph.markdown)).toHaveLength(WIKI_GRAPH_MAX_EDGES);
    // 엣지가 잘려도 노드는 그대로 남는다("볼트에 없다"로 오독되면 안 된다).
    expect(graph.shownNodes).toBe(WIKI_GRAPH_MAX_NODES);
  });

  it("절단이 없으면 shown과 total이 같다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A", [`${WIKI}/concepts/b.md`]),
      entry(`${WIKI}/concepts/b.md`, "B"),
    ];

    const graph = buildWikiGraph(entries, opts());

    expect(graph.shownNodes).toBe(graph.totalNodes);
    expect(graph.shownEdges).toBe(graph.totalEdges);
  });

  it("상한 상수가 mermaid 하드 리밋 아래에 머문다", () => {
    // mermaid 기본 maxEdges 500을 넘으면 파스 자체가 실패한다.
    expect(WIKI_GRAPH_MAX_NODES).toBe(60);
    expect(WIKI_GRAPH_MAX_EDGES).toBe(150);
    expect(WIKI_GRAPH_MAX_EDGES).toBeLessThan(500);
  });
});

describe("buildWikiGraph — 결정론과 불변성", () => {
  it("입력 순서가 달라도 동일한 문자열을 반환한다", () => {
    const entries = [
      entry(`${WIKI}/concepts/a.md`, "A", [`${WIKI}/entities/b.md`]),
      entry(`${WIKI}/entities/b.md`, "B"),
      entry(`${WIKI}/root.md`, "루트"),
      entry(`${WIKI}/projects/p.md`, "P"),
    ];

    const forward = buildWikiGraph(entries, opts());
    const reversed = buildWikiGraph([...entries].reverse(), opts());

    expect(reversed.markdown).toBe(forward.markdown);
  });

  it("인자로 받은 배열과 엔트리를 변형하지 않는다", () => {
    const entries = [
      entry(`${WIKI}/concepts/b.md`, "B", [`${WIKI}/concepts/a.md`]),
      entry(`${WIKI}/concepts/a.md`, "A"),
    ];
    const snapshot = JSON.stringify(entries);

    buildWikiGraph(entries, opts());

    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it("임의의 제목·경로에서도 mermaid 문법 계약을 지킨다", () => {
    const pathArb = fc.oneof(
      fc.constantFrom(
        `${WIKI}/concepts/a.md`,
        `${WIKI}/entities/b.md`,
        `${WIKI}/projects/c.md`,
        `${WIKI}/root.md`,
        `${WIKI}/index.md`,
        `${WIKI}/weird folder/d.md`,
        "Outside/x.md",
      ),
      fc.string().map((s) => `${WIKI}/${s}.md`),
    );
    const entryArb = fc.record({
      path: pathArb,
      title: fc.string(),
      outlinks: fc.array(pathArb, { maxLength: 3 }),
    });

    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 20 }), (raws) => {
        const entries = raws.map((r) => entry(r.path, r.title, r.outlinks));
        const graph = buildWikiGraph(entries, opts());

        if (graph.markdown === "") {
          expect(graph.status).toBe("empty");
          expect(graph.shownNodes).toBe(0);
          return;
        }
        assertMermaidShape(graph.markdown);
        expect(graph.shownNodes).toBeLessThanOrEqual(WIKI_GRAPH_MAX_NODES);
        expect(graph.shownEdges).toBeLessThanOrEqual(WIKI_GRAPH_MAX_EDGES);
        expect(graph.shownNodes).toBeLessThanOrEqual(graph.totalNodes);
        expect(graph.shownEdges).toBeLessThanOrEqual(graph.totalEdges);
      }),
      { numRuns: 200 },
    );
  });

  it("임의의 제목이 라벨에서 위험 문자를 남기지 않는다", () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        const graph = buildWikiGraph(
          [entry(`${WIKI}/concepts/a.md`, title)],
          opts(),
        );
        const [label] = nodeLabels(graph.markdown);
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toMatch(/["<>&]/);
        expect(label.replace(/#(?:quot|\d+);/g, "")).not.toContain("#");
      }),
      { numRuns: 300 },
    );
  });
});
