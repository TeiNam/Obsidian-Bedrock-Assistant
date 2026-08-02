// 지식 공백 그래프 테스트
// ========================
// 전부 순수 함수 테스트다. 볼트·LLM·Obsidian API·i18n 테이블을 전혀 쓰지 않는다.
//
// mermaid 를 테스트 의존성으로 추가하지 않는다(신규 의존성 0 원칙). 대신
// assertValidMermaid() 가 우리가 생성하는 문법의 부분집합을 구조적으로 검증한다.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { buildGapGraph } from "./gap-graph";
import { MERMAID_MAX_NODES, UNTITLED_LABEL } from "./mermaid-graph";
import {
  collectGaps,
  GAP_REPORT_LIMIT,
  type GapCandidate,
  type GapKind,
} from "../second-brain/knowledge-gaps";
import type { VaultIndexEntry } from "../types";

// === 테스트 헬퍼 ===

/** 공백 후보 팩토리. weight 는 정렬에만 쓰이므로 기본값으로 충분하다. */
function gap(kind: GapKind, path: string, weight = 1): GapCandidate {
  return { kind, path, detail: `${kind} 근거`, weight };
}

/** 인덱스 엔트리 팩토리 — collectGaps 통합 검증용. */
function entry(
  over: Partial<VaultIndexEntry> & { path: string },
): VaultIndexEntry {
  return {
    embedding: [],
    lastModified: 1000,
    title: over.path.replace(/\.md$/, ""),
    excerpt: "",
    chunks: [],
    outlinks: [],
    backlinks: [],
    tags: [],
    frontmatter: {},
    ...over,
  };
}

/** 생성된 엔티티를 원문으로 되돌린다(왕복 검증용). */
function decodeEntities(s: string): string {
  return s.replace(/#(?:quot|60|62|38|35);/g, (m) =>
    m === "#quot;" ? '"' : String.fromCodePoint(Number(m.slice(1, -1))),
  );
}

/** 코드펜스를 벗겨 mermaid 본문 줄 배열을 돌려준다. */
function mermaidLines(markdown: string): string[] {
  const lines = markdown.split("\n");
  expect(lines[0]).toBe("```mermaid");
  expect(lines[lines.length - 1]).toBe("```");
  return lines.slice(1, -1);
}

const NODE_LINE = /^ {2}(n\d+)\["([^"]*)"\]$/;
const CLASSDEF_LINE = /^ {2}classDef [A-Za-z][\w-]* [^;]+$/;
const CLASS_LINE = /^ {2}class (n\d+(?:,n\d+)*) ([A-Za-z][\w-]*)$/;

/**
 * mermaid 문법 유효성 구조 검증.
 * - 첫 줄이 `graph LR` 또는 `graph TD`
 * - 나머지 줄은 노드·classDef·class 중 하나에만 매치(공백 그래프는 엣지를 만들지 않는다)
 * - class 가 참조하는 id 는 반드시 선언되어 있다(유령 노드 금지)
 * - 라벨은 항상 인용되고 이스케이프 안 된 `" < > & #` 가 남지 않으며 비어 있지 않다
 */
function assertValidMermaid(markdown: string): string[] {
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
    const stripped = label.replace(/#(?:quot|60|62|38|35|96|37);/g, "");
    expect(stripped).not.toMatch(/["<>&#`]/);
    // 빈 라벨(`n0[""]`)은 mermaid 파스 에러다.
    expect(label.length).toBeGreaterThan(0);
  }
  return labels;
}

// === 기본 조립 ===

describe("buildGapGraph: 종류별 시각 구분", () => {
  it("4종을 한 그래프에 담고 종류별 classDef 로 구분한다", () => {
    const graph = buildGapGraph([
      gap("missing", "없는 노트"),
      gap("stub", "빈약.md"),
      gap("orphan", "고아.md"),
      gap("one-way", "단방향.md"),
    ]);

    // 종류별 클래스가 각각 부여된다 — 색만이 아니라 클래스 자체가 구분 단위다.
    expect(graph.markdown).toContain("class n0 gapMissing");
    expect(graph.markdown).toContain("class n1 gapStub");
    expect(graph.markdown).toContain("class n2 gapOrphan");
    expect(graph.markdown).toContain("class n3 gapOneWay");
    assertValidMermaid(graph.markdown);
  });

  it("종류를 라벨 접두사로도 표기한다 — 색맹·테마 변화에 대한 대비", () => {
    const labels = assertValidMermaid(
      buildGapGraph([
        gap("missing", "없는 노트"),
        gap("stub", "빈약.md"),
        gap("orphan", "고아.md"),
        gap("one-way", "단방향.md"),
      ]).markdown,
    );
    expect(labels).toEqual([
      "[없음] 없는 노트",
      "[빈약] 빈약",
      "[고립] 고아",
      "[단방향] 단방향",
    ]);
  });

  it("classDef 를 4종 모두 내보내고 세미콜론으로 끝내지 않는다", () => {
    const body = mermaidLines(buildGapGraph([gap("orphan", "a.md")]).markdown);
    const defs = body.filter((l) => l.includes("classDef"));
    expect(defs).toHaveLength(4);
    for (const def of defs) {
      // mermaid encodeEntities 가 `/classDef.*:\S*#.*;/g` 의 끝 문자를 잘라먹는다.
      expect(def.endsWith(";")).toBe(false);
      // stroke-dasharray 의 콤마는 이스케이프가 필요하므로 공백 구분을 쓴다.
      expect(def).not.toMatch(/stroke-dasharray:\S*,/);
    }
  });

  it("missing 은 점선 테두리로 실존 노트와 구분한다 — path 가 실제 경로가 아니다", () => {
    const body = mermaidLines(buildGapGraph([gap("missing", "없는 노트")]).markdown);
    const missingDef = body.find((l) => l.includes("classDef gapMissing"));
    expect(missingDef).toMatch(/stroke-dasharray:/);
    // 실존 노트 종류에는 점선을 쓰지 않는다(구분이 무의미해진다).
    for (const cls of ["gapStub", "gapOrphan", "gapOneWay"]) {
      expect(body.find((l) => l.includes(`classDef ${cls}`))).not.toMatch(
        /stroke-dasharray:/,
      );
    }
  });

  it("엣지를 만들지 않는다 — GapCandidate 에 상대 경로가 구조적으로 없다", () => {
    const graph = buildGapGraph([
      gap("one-way", "A.md"),
      gap("missing", "B"),
      gap("orphan", "C.md"),
    ]);
    expect(graph.markdown).not.toContain("-->");
    expect(graph.totalEdges).toBe(0);
  });

  it("방향은 LR — 노트 경로 라벨이 가로로 길어 폭을 덜 낭비한다", () => {
    expect(mermaidLines(buildGapGraph([gap("orphan", "a.md")]).markdown)[0]).toBe(
      "graph LR",
    );
  });

  it("종류를 KIND_ORDER(missing→stub→orphan→one-way)로 묶어 배치한다", () => {
    // 입력이 섞여 있어도 같은 종류가 인접해야 시각적으로 묶여 보인다.
    const labels = assertValidMermaid(
      buildGapGraph([
        gap("one-way", "w.md"),
        gap("missing", "m"),
        gap("orphan", "o.md"),
        gap("stub", "s.md"),
      ]).markdown,
    );
    expect(labels.map((l) => l.slice(0, l.indexOf("]") + 1))).toEqual([
      "[없음]",
      "[빈약]",
      "[고립]",
      "[단방향]",
    ]);
  });

  it("같은 종류 안에서는 주어진 순서(rankGaps 결과)를 유지한다", () => {
    const labels = assertValidMermaid(
      buildGapGraph([
        gap("orphan", "b.md", 5),
        gap("orphan", "a.md", 3),
        gap("orphan", "c.md", 1),
      ]).markdown,
    );
    expect(labels).toEqual(["[고립] b", "[고립] a", "[고립] c"]);
  });
});

// === 엣지케이스 1: 빈 배열 ===

describe("빈 배열: 공백 없음은 축하 메시지지 오류가 아니다", () => {
  it("빈 문자열을 반환한다 — `graph LR` 만 내보내면 빈 사각형이 렌더된다", () => {
    expect(buildGapGraph([])).toEqual({
      markdown: "",
      shownNodes: 0,
      totalNodes: 0,
      totalEdges: 0,
    });
  });

  it("에러를 던지지 않는다", () => {
    expect(() => buildGapGraph([])).not.toThrow();
  });
});

// === 엣지케이스 2: GAP_REPORT_LIMIT 초과 ===

describe("GAP_REPORT_LIMIT(20) 초과", () => {
  it("20개를 넘어도 자체적으로 20 에서 자르지 않는다 — 상한은 노드 60이다", () => {
    const many = Array.from({ length: GAP_REPORT_LIMIT + 5 }, (_, i) =>
      gap("orphan", `note-${i}.md`),
    );
    const graph = buildGapGraph(many);
    expect(graph.shownNodes).toBe(GAP_REPORT_LIMIT + 5);
    expect(graph.totalNodes).toBe(GAP_REPORT_LIMIT + 5);
    assertValidMermaid(graph.markdown);
  });

  it("노드 상한을 넘으면 앞에서 자르고 전체 수를 보고한다 — 호출부가 고지 문구를 만든다", () => {
    const many = Array.from({ length: MERMAID_MAX_NODES + 7 }, (_, i) =>
      gap("orphan", `note-${i}.md`),
    );
    const graph = buildGapGraph(many);
    expect(graph.shownNodes).toBe(MERMAID_MAX_NODES);
    expect(graph.totalNodes).toBe(MERMAID_MAX_NODES + 7);
    assertValidMermaid(graph.markdown);
  });

  it("절단 고지를 코드블록 안에 넣지 않는다 — 안내 노드도 노드다", () => {
    const many = Array.from({ length: MERMAID_MAX_NODES + 7 }, (_, i) =>
      gap("orphan", `note-${i}.md`),
    );
    const graph = buildGapGraph(many);
    // 노드는 전부 실제 공백 후보여야 한다. "생략"·"외 N개" 같은 안내 노드 금지.
    expect(graph.markdown).not.toMatch(/생략|외 \d+개|더 보기/);
    assertValidMermaid(graph.markdown);
  });

  it("절단이 없으면 shownNodes 와 totalNodes 가 같다 — 호출부가 고지를 생략할 근거", () => {
    const graph = buildGapGraph([gap("orphan", "a.md"), gap("stub", "b.md")]);
    expect(graph.shownNodes).toBe(graph.totalNodes);
  });
});

// === 엣지케이스 3: 같은 path 가 여러 kind 로 중복 ===

describe("같은 path 가 여러 kind 로 중복 등장", () => {
  it("하나의 노드로 합치고 라벨에 두 종류를 모두 표기한다", () => {
    // 백링크가 있고(스텁) 되돌아오지 않는 아웃링크도 있는 노트는 실제로 두 종류다.
    const labels = assertValidMermaid(
      buildGapGraph([gap("stub", "겹침.md"), gap("one-way", "겹침.md")]).markdown,
    );
    expect(labels).toEqual(["[빈약+단방향] 겹침"]);
  });

  it("종류가 겹치면 KIND_ORDER 상 가장 앞선 종류의 클래스를 적용한다", () => {
    const graph = buildGapGraph([
      gap("one-way", "겹침.md"),
      gap("stub", "겹침.md"),
    ]);
    // stub 이 one-way 보다 앞서므로 gapStub 이 이긴다. 입력 순서에 좌우되지 않는다.
    // class 줄만 검사한다 — classDef 선언은 4종 모두 항상 나오므로 구분되지 않는다.
    const classLines = mermaidLines(graph.markdown).filter((l) =>
      /^ {2}class /.test(l),
    );
    expect(classLines).toEqual(["  class n0 gapStub"]);
  });

  it("중복 종류 표기 순서는 입력 순서와 무관하게 KIND_ORDER 를 따른다", () => {
    const a = buildGapGraph([gap("one-way", "x.md"), gap("stub", "x.md")]);
    const b = buildGapGraph([gap("stub", "x.md"), gap("one-way", "x.md")]);
    expect(a.markdown).toBe(b.markdown);
    expect(a.markdown).toContain("[빈약+단방향] x");
  });

  it("같은 kind 로 여러 번 등장해도 종류를 한 번만 표기한다", () => {
    // findOneWayLinks 는 아웃링크 대상마다 후보를 push 하므로 같은 경로가 반복된다.
    const labels = assertValidMermaid(
      buildGapGraph([
        gap("one-way", "A.md"),
        gap("one-way", "A.md"),
        gap("one-way", "A.md"),
      ]).markdown,
    );
    expect(labels).toEqual(["[단방향] A"]);
  });

  it("중복을 합친 뒤의 노드 수를 totalNodes 로 보고한다", () => {
    const graph = buildGapGraph([
      gap("orphan", "A.md"),
      gap("stub", "A.md"),
      gap("missing", "B"),
    ]);
    expect(graph.totalNodes).toBe(2);
    expect(graph.shownNodes).toBe(2);
  });

  it("중복 병합은 노드 상한 계산 전에 일어난다 — 중복이 상한을 먹지 않는다", () => {
    // 같은 경로 3번 × 30개 = 후보 90건이지만 실제 노드는 30개다.
    const many = Array.from({ length: 30 }, (_, i) => `note-${i}.md`).flatMap(
      (p) => [gap("one-way", p), gap("one-way", p), gap("one-way", p)],
    );
    const graph = buildGapGraph(many);
    expect(graph.totalNodes).toBe(30);
    expect(graph.shownNodes).toBe(30);
    assertValidMermaid(graph.markdown);
  });
});

// === 엣지케이스 4: 위키 폴더 노트 혼입 ===

describe("위키 폴더 노트 혼입", () => {
  it("collectGaps 는 실존 노트 4종의 위키 폴더 경로를 이미 걸러낸다", () => {
    // isGenerated 검증: orphan/stub/one-way 는 상류에서 제외된다.
    const entries = [
      entry({ path: "Second Brain/생성 고아.md" }),
      entry({ path: "진짜 고아.md" }),
      entry({
        path: "Second Brain/생성 스텁.md",
        backlinks: ["x.md"],
        chunks: [{ index: 0, text: "짧음", embedding: [] }],
      }),
    ];
    const paths = collectGaps(entries, {}, "Second Brain").map((g) => g.path);
    expect(paths).toEqual(["진짜 고아.md"]);
  });

  it("missing 의 대상 경로는 상류가 걸러주지 않아 위키 폴더 이름이 통과한다", () => {
    // findUnresolvedLinkTargets 는 링크 '출처'만 isGenerated 로 거른다(:167).
    // 대상 이름은 아직 존재하지 않는 노트라 걸러낼 근거가 없다 — 실측 확인된 상류 동작.
    const gaps = collectGaps([], {
      "note.md": { "Second Brain/leaked": 2 },
    }, "Second Brain");
    expect(gaps.map((g) => g.path)).toEqual(["Second Brain/leaked"]);
  });

  it("렌더러는 상류가 넘긴 경로를 걸러내지 않는다 — 리스트 뷰와 어긋나면 더 나쁘다", () => {
    // 필터링은 도메인(collectGaps) 책임이다. 렌더러가 몰래 빼면 같은 데이터의 두 뷰가
    // 불일치하고, 사용자는 그래프에 없는 항목을 리스트에서 보게 된다.
    const graph = buildGapGraph([gap("missing", "Second Brain/leaked")]);
    expect(graph.shownNodes).toBe(1);
    expect(graph.markdown).toContain("[없음] Second Brain/leaked");
    assertValidMermaid(graph.markdown);
  });
});

// === mermaid 문법 유효성 ===

describe("mermaid 문법 유효성", () => {
  it("제목에 위험 문자가 있어도 이스케이프해 파싱 가능한 문법을 유지한다", () => {
    const raw = '노트 [초안] & 검토 (2026) | v2 "final" #35; <b>';
    const graph = buildGapGraph([gap("orphan", `${raw}.md`)]);
    const labels = assertValidMermaid(graph.markdown);
    // 이스케이프를 되돌리면 원문이 그대로 살아 있다 — 문자 소실·훼손 없음.
    expect(decodeEntities(labels[0])).toBe(`[고립] ${raw}`);
  });

  it("HTML 태그를 불활성 텍스트로 만든다 — 태그 소실·XSS 방지", () => {
    const graph = buildGapGraph([
      gap("missing", '<img src=x onerror=alert(1)>'),
      gap("orphan", "<script>alert(1)</script>.md"),
    ]);
    expect(graph.markdown).not.toMatch(/<(img|script|a|br)\b/);
    assertValidMermaid(graph.markdown);
  });

  it("파이프·대괄호·중괄호는 인용 안에서 안전하므로 손대지 않는다", () => {
    // 이들을 제거·치환하면 `[초안]`·`(2026)` 같은 실제 제목 정보가 파괴된다.
    // 백틱은 예외다 — 선행 백틱이 mermaid lexer 를 markdown-string 모드로 보내
    // 그래프 전체를 깨뜨리므로 `#96;` 으로 엔티티화된다(원문은 렌더 시 복원된다).
    const labels = assertValidMermaid(
      buildGapGraph([gap("orphan", "A | B [x] (y) {z}; c: d, `e`.md")]).markdown,
    );
    expect(labels[0]).toBe("[고립] A | B [x] (y) {z}; c: d, #96;e#96;");
  });

  it("화살표 유사 문자열은 > 만 엔티티화되고 원문으로 왕복한다", () => {
    // 인용 라벨 안의 `-->` 는 화살표로 해석되지 않는 텍스트지만, `>` 는 htmlLabels
    // 때문에 엔티티화 대상이다. 엔티티가 되어도 렌더는 원문 그대로다.
    const labels = assertValidMermaid(
      buildGapGraph([gap("orphan", "A --> B ==> C.md")]).markdown,
    );
    expect(labels[0]).toBe("[고립] A --#62; B ==#62; C");
    expect(decodeEntities(labels[0])).toBe("[고립] A --> B ==> C");
  });

  it("한글·이모지·CJK 경로를 원문 그대로 보존한다", () => {
    const labels = assertValidMermaid(
      buildGapGraph([
        gap("orphan", "🎉 파티 노트.md"),
        gap("missing", "温度 25° 노트"),
      ]).markdown,
    );
    expect(labels).toEqual(["[없음] 温度 25° 노트", "[고립] 🎉 파티 노트"]);
  });

  it("빈 경로여도 빈 라벨을 만들지 않는다 — `n0[\"\"]` 는 파스 에러다", () => {
    const labels = assertValidMermaid(
      buildGapGraph([gap("orphan", ""), gap("missing", ".md")]).markdown,
    );
    // `.md` 의 점은 확장자 구분자가 아니라 이름의 일부이므로 이름 전체가 라벨이 된다.
    expect(labels[0]).toBe("[없음] .md");
    // 경로가 통째로 비면 상수로 폴백한다 — 접두사만 남기지 않는다.
    expect(labels[1]).toBe(`[고립] ${UNTITLED_LABEL}`);
  });

  it("공백뿐인 경로도 상수로 폴백한다", () => {
    const labels = assertValidMermaid(
      buildGapGraph([gap("orphan", "   ")]).markdown,
    );
    expect(labels[0]).toBe(`[고립] ${UNTITLED_LABEL}`);
  });

  it("경로의 점을 제목 확장자로 오인해 자르지 않는다", () => {
    // resolveLabel 은 `2026.01 회고` 의 첫 점을 확장자로 보고 자른다. 라벨을 직접
    // 만들어 이 휴리스틱을 우회한다.
    const labels = assertValidMermaid(
      buildGapGraph([gap("missing", "2026.01 회고")]).markdown,
    );
    expect(labels[0]).toBe("[없음] 2026.01 회고");
  });

  it("속성: 임의 경로에도 항상 유효한 문법을 만든다", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom<GapKind>("orphan", "stub", "one-way", "missing"),
            path: fc.fullUnicodeString(),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (raw) => {
          const graph = buildGapGraph(
            raw.map((r) => gap(r.kind, r.path)),
          );
          // 경로가 전부 빈 문자열이면 노드 1개로 합쳐지므로 빈 결과는 없다.
          expect(graph.markdown).not.toBe("");
          assertValidMermaid(graph.markdown);
        },
      ),
    );
  });
});

// === 계약 ===

describe("순수 함수 계약", () => {
  it("같은 입력에 항상 같은 문자열을 반환한다 — 결정론", () => {
    const gaps = [
      gap("one-way", "b.md"),
      gap("missing", "a"),
      gap("stub", "b.md"),
    ];
    expect(buildGapGraph(gaps).markdown).toBe(buildGapGraph(gaps).markdown);
  });

  it("인자로 받은 배열·객체를 변형하지 않는다", () => {
    const gaps = [gap("stub", "a.md"), gap("one-way", "a.md")];
    const snapshot = JSON.stringify(gaps);
    buildGapGraph(gaps);
    expect(JSON.stringify(gaps)).toBe(snapshot);
  });

  it("collectGaps 출력을 그대로 받아 그린다 — 실제 배선 경로", () => {
    const entries = [
      entry({ path: "고아.md" }),
      entry({
        path: "스텁.md",
        backlinks: ["허브.md"],
        chunks: [{ index: 0, text: "짧다", embedding: [] }],
      }),
      entry({ path: "허브.md", outlinks: ["스텁.md"], backlinks: [] }),
    ];
    const graph = buildGapGraph(
      collectGaps(entries, { "허브.md": { "없는 노트": 3 } }, "Second Brain"),
    );
    const labels = assertValidMermaid(graph.markdown);
    expect(labels).toContain("[없음] 없는 노트");
    expect(labels).toContain("[빈약] 스텁");
    expect(labels).toContain("[고립] 고아");
  });
});
