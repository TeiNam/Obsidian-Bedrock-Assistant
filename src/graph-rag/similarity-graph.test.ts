// 의미 유사도 그래프 (Semantic Similarity Graph) 테스트
// ====================================================
// 전부 순수 함수 테스트다. 볼트·LLM·임베딩 API 호출이 0회이며, 가짜 임베딩
// 벡터를 직접 만들어 넣는다. 그래서 테스트가 즉시(수 ms) 끝난다.
//
// 벡터 만들기 트릭: 중심을 [1, 0]으로 고정하면 후보 [s, sqrt(1-s²)]의
// 코사인 유사도가 정확히 s가 된다. 임계값 경계를 오차 없이 겨냥할 수 있다.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  analyzeSimilarity,
  buildSimilarityGraph,
  resolveEntryVector,
  SIMILARITY_MIN_SCORE,
  DEGENERATE_SIMILARITY,
  DEGENERATE_MIN_SAMPLE,
} from "./similarity-graph";
import { MERMAID_MAX_NODES } from "./mermaid-graph";
import type { VaultIndexEntry } from "../types";

// ============================================
// 픽스처 헬퍼
// ============================================

/** 중심 [1, 0] 대비 코사인 유사도가 정확히 sim이 되는 2차원 단위 벡터. */
function vecAt(sim: number): number[] {
  return [sim, Math.sqrt(Math.max(0, 1 - sim * sim))];
}

/** 중심 노트로 쓸 기준 벡터. */
const CENTER_VEC = [1, 0];

interface EntryOverrides {
  title?: string;
  embedding?: number[];
  chunks?: VaultIndexEntry["chunks"];
  outlinks?: string[];
  backlinks?: string[];
}

/** 최소 필드만 채운 인덱스 엔트리를 만든다. */
function makeEntry(path: string, o: EntryOverrides = {}): VaultIndexEntry {
  return {
    path,
    title: o.title ?? path.replace(/\.md$/, ""),
    embedding: o.embedding ?? [],
    lastModified: 1000,
    excerpt: "",
    ...(o.chunks !== undefined ? { chunks: o.chunks } : {}),
    outlinks: o.outlinks ?? [],
    backlinks: o.backlinks ?? [],
  };
}

/** 지정 유사도를 갖는 후보 엔트리. */
function candidateAt(path: string, sim: number, o: EntryOverrides = {}): VaultIndexEntry {
  return makeEntry(path, { ...o, embedding: vecAt(sim) });
}

/** 중심 노트 엔트리. */
function centerEntry(o: EntryOverrides = {}): VaultIndexEntry {
  return makeEntry("center.md", { title: "중심 노트", ...o, embedding: CENTER_VEC });
}

// ============================================
// mermaid 라벨 검증 헬퍼
// ============================================

/**
 * 생성된 마크다운에서 인용 라벨 본문을 모두 추출한다.
 * 이스케이프를 통과한 라벨에는 생 따옴표가 남지 않으므로 [^"]* 로 안전하게 끊긴다.
 * 노드 라벨(["..."])과 엣지 라벨(|"..."|)을 모두 수집한다.
 */
function extractLabels(markdown: string): string[] {
  const labels: string[] = [];
  for (const m of markdown.matchAll(/\["([^"]*)"\]/g)) labels.push(m[1]);
  for (const m of markdown.matchAll(/\|"([^"]*)"\|/g)) labels.push(m[1]);
  return labels;
}

/**
 * 라벨에 미이스케이프 위험 문자가 남았는지 검사한다.
 * mermaid 엔티티 형태(#quot; / #60; 등)를 먼저 제거한 뒤 남은 위험 문자를 본다.
 */
function unescapedChars(label: string): string[] {
  const stripped = label.replace(/#(?:quot|\d+);/g, "");
  return [...stripped].filter((c) => '"<>&#'.includes(c));
}

/** mermaid 코드블록 본문(펜스 제외)을 꺼낸다. 블록이 없으면 null. */
function mermaidBody(markdown: string): string | null {
  const m = markdown.match(/```mermaid\n([\s\S]*?)```/);
  return m ? m[1] : null;
}

// ============================================
// resolveEntryVector — 엔트리당 임베딩 1개 확정
// ============================================

describe("resolveEntryVector: 엔트리당 대표 벡터를 하나만 고른다", () => {
  it("레거시 단일 임베딩이 있으면 그것을 쓴다", () => {
    // 노트당 1개 벡터로 고정해야 비교 횟수가 O(N)에 머문다.
    // 청크마다 비교하면 청크 수만큼 비용이 배가된다(실측: 30청크 × 3000노트 = 323ms).
    const entry = makeEntry("a.md", {
      embedding: [1, 2, 3],
      chunks: [{ index: 0, text: "본문", embedding: [9, 9, 9] }],
    });
    expect(resolveEntryVector(entry)).toEqual([1, 2, 3]);
  });

  it("레거시 임베딩이 비면 첫 유효 청크 임베딩으로 폴백한다", () => {
    const entry = makeEntry("a.md", {
      embedding: [],
      chunks: [
        { index: 0, text: "실패", embedding: [], embedFailed: true },
        { index: 1, text: "성공", embedding: [4, 5, 6] },
      ],
    });
    expect(resolveEntryVector(entry)).toEqual([4, 5, 6]);
  });

  it("사용 가능한 벡터가 전혀 없으면 빈 배열을 반환한다", () => {
    const entry = makeEntry("a.md", {
      embedding: [],
      chunks: [{ index: 0, text: "실패", embedding: [], embedFailed: true }],
    });
    expect(resolveEntryVector(entry)).toEqual([]);
  });

  it("chunks 필드 자체가 없어도(레거시 직렬화) 안전하다", () => {
    const entry = makeEntry("a.md", { embedding: [] });
    expect(resolveEntryVector(entry)).toEqual([]);
  });
});

// ============================================
// analyzeSimilarity — 핵심 계산
// ============================================

describe("analyzeSimilarity: 링크 없는 유사 노트만 추린다", () => {
  it("임계값을 넘고 링크가 없는 노트를 유사도 내림차순으로 반환한다", () => {
    const center = centerEntry();
    const entries = [
      center,
      candidateAt("low.md", 0.8),
      candidateAt("high.md", 0.95),
      candidateAt("mid.md", 0.87),
    ];

    const result = analyzeSimilarity(center, entries);

    expect(result.candidates.map((c) => c.path)).toEqual(["high.md", "mid.md", "low.md"]);
    expect(result.candidates[0].similarity).toBeCloseTo(0.95);
  });

  it("중심 노트 자신은 후보에 넣지 않는다", () => {
    // 자기 자신과의 유사도는 1.0이라 넣으면 항상 최상위를 차지하고 자기 루프 엣지가 생긴다.
    const center = centerEntry();
    const result = analyzeSimilarity(center, [center, candidateAt("b.md", 0.9)]);
    expect(result.candidates.map((c) => c.path)).toEqual(["b.md"]);
  });

  it("동점 유사도는 경로 오름차순으로 결정론적으로 정렬한다", () => {
    const center = centerEntry();
    const entries = [
      center,
      candidateAt("z.md", 0.9),
      candidateAt("a.md", 0.9),
      candidateAt("m.md", 0.9),
    ];
    expect(analyzeSimilarity(center, entries).candidates.map((c) => c.path)).toEqual([
      "a.md",
      "m.md",
      "z.md",
    ]);
  });

  it("입력 순서를 바꿔도 같은 결과를 낸다", () => {
    const center = centerEntry();
    const a = candidateAt("a.md", 0.9);
    const b = candidateAt("b.md", 0.85);
    const c = candidateAt("c.md", 0.95);

    const forward = analyzeSimilarity(center, [center, a, b, c]);
    const backward = analyzeSimilarity(center, [c, b, a, center]);
    expect(forward.candidates).toEqual(backward.candidates);
  });

  it("중복 경로는 한 번만 후보가 된다", () => {
    // 같은 경로가 두 번 들어오면 엣지가 중복 생성되어 엣지 상한을 헛되게 먹는다.
    const center = centerEntry();
    const dup = candidateAt("a.md", 0.9);
    const result = analyzeSimilarity(center, [center, dup, candidateAt("a.md", 0.9)]);
    expect(result.candidates).toHaveLength(1);
  });

  it("엔트리 배열과 엔트리 객체를 변형하지 않는다", () => {
    const center = centerEntry();
    const entries = [center, candidateAt("b.md", 0.9), candidateAt("c.md", 0.8)];
    const snapshot = JSON.stringify(entries);
    const order = entries.map((e) => e.path);

    analyzeSimilarity(center, entries);

    expect(JSON.stringify(entries)).toBe(snapshot);
    expect(entries.map((e) => e.path)).toEqual(order);
  });
});

// ============================================
// 링크 제외 — 이 기능의 존재 이유
// ============================================

describe("analyzeSimilarity: 이미 링크된 쌍을 제외한다", () => {
  it("중심의 outlink 대상은 제외한다", () => {
    // 링크가 있으면 코어 그래프가 이미 보여준다. 이 그래프의 가치는 "안 보이던 연결"뿐이다.
    const center = centerEntry({ outlinks: ["linked.md"] });
    const result = analyzeSimilarity(center, [
      center,
      candidateAt("linked.md", 0.99),
      candidateAt("free.md", 0.8),
    ]);
    expect(result.candidates.map((c) => c.path)).toEqual(["free.md"]);
    expect(result.linkedCount).toBe(1);
  });

  it("중심의 backlink 대상도 제외한다", () => {
    const center = centerEntry({ backlinks: ["linked.md"] });
    const result = analyzeSimilarity(center, [center, candidateAt("linked.md", 0.95)]);
    expect(result.candidates).toEqual([]);
    expect(result.linkedCount).toBe(1);
  });

  it("후보 쪽에만 링크가 기록된 단방향도 제외한다", () => {
    // 인덱스의 outlinks/backlinks는 어긋날 수 있다(knowledge-gaps의 one-way 공백이
    // 존재하는 이유). 네 방향 모두 확인해야 링크된 쌍이 새어 나오지 않는다.
    const center = centerEntry();
    const viaOut = candidateAt("out.md", 0.95, { outlinks: ["center.md"] });
    const viaBack = candidateAt("back.md", 0.95, { backlinks: ["center.md"] });

    const result = analyzeSimilarity(center, [center, viaOut, viaBack]);
    expect(result.candidates).toEqual([]);
    expect(result.linkedCount).toBe(2);
  });

  it("링크 필드가 undefined여도(레거시 엔트리) 정상 동작한다", () => {
    const center: VaultIndexEntry = {
      path: "center.md",
      title: "중심",
      embedding: CENTER_VEC,
      lastModified: 1,
      excerpt: "",
    };
    const bare: VaultIndexEntry = {
      path: "b.md",
      title: "B",
      embedding: vecAt(0.9),
      lastModified: 1,
      excerpt: "",
    };
    expect(analyzeSimilarity(center, [center, bare]).candidates).toHaveLength(1);
  });
});

// ============================================
// 엣지케이스: 임베딩 이상
// ============================================

describe("analyzeSimilarity: 임베딩 이상을 후보에서 제외하고 보고한다", () => {
  it("임베딩이 빈 배열인 엔트리를 제외한다(인덱싱 실패로 격리된 청크)", () => {
    const center = centerEntry();
    const broken = makeEntry("broken.md", {
      embedding: [],
      chunks: [{ index: 0, text: "본문", embedding: [], embedFailed: true }],
    });

    const result = analyzeSimilarity(center, [center, broken, candidateAt("ok.md", 0.9)]);
    expect(result.candidates.map((c) => c.path)).toEqual(["ok.md"]);
    expect(result.incomparableCount).toBe(1);
  });

  it("차원이 다른 임베딩을 제외한다(모델 변경 후 부분 재인덱싱)", () => {
    // compareVectors가 null을 반환하는 경우다. 유사도 0으로 취급하면 무관한 노트가
    // 임계값 아래에 머물러 조용히 사라지거나, 반대로 오답이 섞인다.
    const center = centerEntry();
    const other = makeEntry("other-dim.md", { embedding: new Array(768).fill(0.5) });

    const result = analyzeSimilarity(center, [center, other, candidateAt("ok.md", 0.9)]);
    expect(result.candidates.map((c) => c.path)).toEqual(["ok.md"]);
    expect(result.incomparableCount).toBe(1);
  });

  it("중심 노트의 임베딩이 없으면 후보가 하나도 나오지 않는다", () => {
    const center = makeEntry("center.md", { embedding: [] });
    const result = analyzeSimilarity(center, [center, candidateAt("a.md", 0.95)]);
    expect(result.candidates).toEqual([]);
    expect(result.centerHasVector).toBe(false);
  });

  it("영벡터는 유사도 0이 되어 임계값에서 걸러진다", () => {
    const center = centerEntry();
    const zero = makeEntry("zero.md", { embedding: [0, 0] });
    expect(analyzeSimilarity(center, [center, zero]).candidates).toEqual([]);
  });
});

describe("analyzeSimilarity: 임계값 미달과 노트 수 부족", () => {
  it("노트가 중심 하나뿐이면 빈 결과다", () => {
    const center = centerEntry();
    const result = analyzeSimilarity(center, [center]);
    expect(result.candidates).toEqual([]);
    expect(result.incomparableCount).toBe(0);
  });

  it("엔트리 배열이 비어도 안전하다", () => {
    expect(analyzeSimilarity(centerEntry(), []).candidates).toEqual([]);
  });

  it("전부 임계값 미달이면 빈 결과다", () => {
    const center = centerEntry();
    const entries = [center, candidateAt("a.md", 0.5), candidateAt("b.md", 0.1)];
    expect(analyzeSimilarity(center, entries).candidates).toEqual([]);
  });

  it("임계값 경계값은 포함한다(>= 비교)", () => {
    const center = centerEntry();
    const result = analyzeSimilarity(center, [center, candidateAt("edge.md", SIMILARITY_MIN_SCORE)]);
    expect(result.candidates.map((c) => c.path)).toEqual(["edge.md"]);
  });

  it("임계값 직전 값은 제외한다", () => {
    const center = centerEntry();
    const below = candidateAt("below.md", SIMILARITY_MIN_SCORE - 0.01);
    expect(analyzeSimilarity(center, [center, below]).candidates).toEqual([]);
  });

  it("음수 유사도(반대 방향 벡터)는 제외한다", () => {
    const center = centerEntry();
    const opposite = makeEntry("opposite.md", { embedding: [-1, 0] });
    expect(analyzeSimilarity(center, [center, opposite]).candidates).toEqual([]);
  });
});

// ============================================
// 엣지케이스: 임베딩 붕괴(전부 0.99 이상)
// ============================================

describe("analyzeSimilarity: 유사도가 전부 0.99 이상이면 붕괴로 판정한다", () => {
  it("모든 후보가 0.99 이상이면 degenerate 표시와 함께 후보를 비운다", () => {
    // 이걸 그리면 완전 그래프가 되어 정보량이 0이다. 임베딩 공급자가 상수 벡터를
    // 돌려주는 등 인덱스가 망가진 상태이므로 그래프 대신 경고가 맞다.
    const center = centerEntry();
    // 표본 하한(DEGENERATE_MIN_SAMPLE)을 채워야 붕괴로 판정된다. 경계값 0.99 포함.
    const sims = [0.999, 0.995, 1, 0.99, 0.9999];
    expect(sims.length).toBeGreaterThanOrEqual(DEGENERATE_MIN_SAMPLE);
    const entries = [center, ...sims.map((s, i) => candidateAt(`d${i}.md`, s))];

    const result = analyzeSimilarity(center, entries);
    expect(result.degenerate).toBe(true);
    expect(result.candidates).toEqual([]);
  });

  it("하나라도 0.99 미만이면 붕괴가 아니다", () => {
    const center = centerEntry();
    const entries = [
      center,
      candidateAt("a.md", 0.999),
      candidateAt("b.md", 0.995),
      candidateAt("c.md", 0.98),
    ];

    const result = analyzeSimilarity(center, entries);
    expect(result.degenerate).toBe(false);
    expect(result.candidates).toHaveLength(3);
  });

  it("후보가 표본 최소치 미만이면 붕괴로 판정하지 않는다(진짜 중복 노트 보호)", () => {
    // 노트 2개가 실제로 거의 같은 내용일 수 있다. 그걸 "임베딩 고장"으로 숨기면
    // 정상 볼트에 거짓 경고가 뜬다.
    const center = centerEntry();
    const few = Array.from({ length: DEGENERATE_MIN_SAMPLE - 1 }, (_, i) =>
      candidateAt(`dup${i}.md`, 1)
    );

    const result = analyzeSimilarity(center, [center, ...few]);
    expect(result.degenerate).toBe(false);
    expect(result.candidates).toHaveLength(DEGENERATE_MIN_SAMPLE - 1);
  });

  it("붕괴 판정 경계는 DEGENERATE_SIMILARITY 미만 값 하나로 깨진다", () => {
    const center = centerEntry();
    const entries = [
      center,
      ...Array.from({ length: DEGENERATE_MIN_SAMPLE }, (_, i) => candidateAt(`d${i}.md`, 1)),
      candidateAt("normal.md", DEGENERATE_SIMILARITY - 0.01),
    ];
    expect(analyzeSimilarity(center, entries).degenerate).toBe(false);
  });
});

// ============================================
// buildSimilarityGraph — mermaid 조립
// ============================================

describe("buildSimilarityGraph: 유효한 mermaid 마크다운을 만든다", () => {
  it("graph LR 방향으로 중심-후보 방사형 그래프를 만든다", () => {
    const center = centerEntry();
    const graph = buildSimilarityGraph(center, [center, candidateAt("a.md", 0.9)]);

    const body = mermaidBody(graph.markdown);
    expect(body).not.toBeNull();
    expect(body).toContain("graph LR");
  });

  it("엣지 라벨에 소수점 둘째 자리 유사도를 넣는다", () => {
    const center = centerEntry();
    const graph = buildSimilarityGraph(center, [center, candidateAt("a.md", 0.87)]);
    expect(graph.markdown).toContain('"0.87"');
  });

  it("모든 엣지의 양 끝이 선언된 노드 id를 가리킨다(유령 노드 방지)", () => {
    // 미선언 id를 쓰면 mermaid가 에러 없이 새 노드를 만들어 n42 같은 무의미한
    // 노드가 나타난다. 파스가 성공하므로 조용한 거짓말이 된다.
    const center = centerEntry();
    const entries = [
      center,
      ...Array.from({ length: 5 }, (_, i) => candidateAt(`a${i}.md`, 0.9 - i * 0.01)),
    ];
    const body = mermaidBody(buildSimilarityGraph(center, entries).markdown) ?? "";

    const declared = new Set([...body.matchAll(/^\s*(n\d+)\["/gm)].map((m) => m[1]));
    const referenced = [...body.matchAll(/(n\d+)\s*(?:-->|--)/g)].map((m) => m[1]);
    const targets = [...body.matchAll(/(?:-->|\|)\s*(n\d+)\s*$/gm)].map((m) => m[1]);

    expect(declared.size).toBe(6);
    for (const id of [...referenced, ...targets]) {
      expect(declared.has(id)).toBe(true);
    }
  });

  it("후보가 없으면 빈 마크다운을 반환한다(빈 사각형 렌더 방지)", () => {
    // graph LR만 내보내면 파스·렌더가 성공하면서 빈 사각형이 그려져
    // "기능이 고장났다"로 보인다. 안내 문구는 i18n을 가진 호출부가 붙인다.
    const center = centerEntry();
    const graph = buildSimilarityGraph(center, [center, candidateAt("far.md", 0.2)]);

    expect(graph.markdown).toBe("");
    expect(graph.shownNodes).toBe(0);
    expect(graph.totalNodes).toBe(0);
  });

  it("붕괴 판정 시에도 빈 마크다운을 반환한다", () => {
    const center = centerEntry();
    const entries = [
      center,
      ...Array.from({ length: DEGENERATE_MIN_SAMPLE }, (_, i) => candidateAt(`d${i}.md`, 1)),
    ];
    expect(buildSimilarityGraph(center, entries).markdown).toBe("");
  });

  it("코드블록 안에 절단 안내 노드를 넣지 않는다", () => {
    const center = centerEntry();
    const entries = [
      center,
      ...Array.from({ length: 80 }, (_, i) => candidateAt(`a${i}.md`, 0.98 - i * 0.001)),
    ];
    const body = mermaidBody(buildSimilarityGraph(center, entries).markdown) ?? "";
    expect(body).not.toMatch(/생략|omitted|외 \d+개/);
  });
});

// ============================================
// 상한 — 절단과 보고
// ============================================

describe("buildSimilarityGraph: 노드 상한을 지키고 절단을 숫자로 보고한다", () => {
  const center = centerEntry();
  const many = Array.from({ length: 80 }, (_, i) => candidateAt(`a${i}.md`, 0.98 - i * 0.001));

  it("노드 수가 MERMAID_MAX_NODES를 넘지 않는다", () => {
    const graph = buildSimilarityGraph(center, [center, ...many]);
    expect(graph.shownNodes).toBeLessThanOrEqual(MERMAID_MAX_NODES);
  });

  it("절단 전 전체 노드 수를 보고해 호출부가 분모를 표시할 수 있다", () => {
    const graph = buildSimilarityGraph(center, [center, ...many]);
    // 전체 노드 = 중심 1 + 후보 80. 이 분모가 있어야 "340개 중 60개"를 안내할 수 있다.
    expect(graph.totalNodes).toBe(81);
    expect(graph.shownNodes).toBe(MERMAID_MAX_NODES);
    expect(graph.shownNodes).toBeLessThan(graph.totalNodes);
  });

  it("totalEdges 는 노드 절단 후 살아남은 엣지 수다", () => {
    // 공유 코어의 계약: 엣지 상한은 노드 상한을 적용한 뒤 검사하며, 잘려나간 노드를
    // 가리키는 엣지는 유효 엣지에서 빠진다(미선언 id → 유령 노드 방지). 따라서
    // totalEdges 는 "절단 전 후보 수"가 아니라 방사형에서 shownNodes - 1 이 된다.
    const graph = buildSimilarityGraph(center, [center, ...many]);
    expect(graph.totalEdges).toBe(graph.shownNodes - 1);
  });

  it("중심 노트는 절단되지 않는다", () => {
    const graph = buildSimilarityGraph(center, [center, ...many]);
    // 중심 라벨이 살아 있어야 엣지의 from이 미선언 id가 되지 않는다.
    expect(graph.markdown).toContain("중심 노트");
  });

  it("점수가 낮은 쪽부터 버린다", () => {
    const graph = buildSimilarityGraph(center, [center, ...many]);
    const body = mermaidBody(graph.markdown) ?? "";
    // 최상위(0.98)는 남고 최하위(0.901)는 잘린다.
    expect(body).toContain("a0");
    expect(body).not.toContain("a79");
  });

  it("절단이 없으면 shownNodes와 totalNodes가 같다", () => {
    const graph = buildSimilarityGraph(center, [center, candidateAt("a.md", 0.9)]);
    expect(graph.shownNodes).toBe(graph.totalNodes);
    expect(graph.totalNodes).toBe(2);
  });
});

// ============================================
// mermaid 문법 유효성 — 라벨 이스케이프
// ============================================

describe("buildSimilarityGraph: 노트 제목의 위험 문자를 이스케이프한다", () => {
  it("제목의 따옴표·꺾쇠·앰퍼샌드·해시가 라벨에 생으로 남지 않는다", () => {
    // 따옴표는 인용 라벨을 깨는 유일한 문자다. 하나만 새도 파스가 통째로 실패하고
    // 사용자는 빈 블록만 본다.
    const center = centerEntry({ title: '중심 "따옴표" & <b>태그</b> #35;' });
    const entries = [
      center,
      candidateAt("a.md", 0.9, { title: '노트 [초안] & 검토 (2026) | v2 "final" #35;' }),
      candidateAt("b.md", 0.85, { title: "A <script>alert(1)</script> t" }),
    ];

    const labels = extractLabels(buildSimilarityGraph(center, entries).markdown);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(unescapedChars(label)).toEqual([]);
    }
  });

  it("대괄호·파이프·괄호는 훼손하지 않고 원문 그대로 보존한다", () => {
    // 인용 라벨 안에서는 안전하다. 새니타이즈하면 한국어 제목의 실제 정보가 파괴된다.
    const center = centerEntry();
    const graph = buildSimilarityGraph(center, [
      center,
      candidateAt("a.md", 0.9, { title: "회고 [초안] (2026) | v2" }),
    ]);
    expect(graph.markdown).toContain("회고 [초안] (2026) | v2");
  });

  it("한글·이모지 제목을 그대로 보존한다", () => {
    const center = centerEntry();
    const graph = buildSimilarityGraph(center, [
      center,
      candidateAt("a.md", 0.9, { title: "🎉 파티 노트 한글 제목" }),
    ]);
    expect(graph.markdown).toContain("🎉 파티 노트 한글 제목");
  });

  it("제목이 빈 문자열이어도 빈 라벨을 만들지 않는다", () => {
    // 실측: n1[""] 는 mermaid 파스 에러다. 노트 하나가 그래프 전체를 죽인다.
    const center = centerEntry({ title: "" });
    const graph = buildSimilarityGraph(center, [
      center,
      candidateAt("Notes/hidden.md", 0.9, { title: "" }),
    ]);

    for (const label of extractLabels(graph.markdown)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("제목이 공백뿐이어도 빈 라벨을 만들지 않는다", () => {
    const center = centerEntry({ title: "   " });
    const graph = buildSimilarityGraph(center, [center, candidateAt("a.md", 0.9, { title: "\t" })]);
    for (const label of extractLabels(graph.markdown)) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("mermaid 예약어와 같은 경로도 노드 id를 깨뜨리지 않는다", () => {
    // 실측: end/graph/subgraph/class/style/click 은 id로 쓰면 전부 파스 에러다.
    // 순번 + n 접두사가 이 전체를 막는다.
    const center = centerEntry();
    const entries = [
      center,
      candidateAt("end.md", 0.95, { title: "end" }),
      candidateAt("graph.md", 0.9, { title: "graph" }),
      candidateAt("subgraph.md", 0.85, { title: "subgraph" }),
    ];
    const body = mermaidBody(buildSimilarityGraph(center, entries).markdown) ?? "";

    // 선언은 전부 n<숫자> 형태다.
    const decls = [...body.matchAll(/^\s*(\S+)\["/gm)].map((m) => m[1]);
    expect(decls.length).toBe(4);
    for (const id of decls) expect(id).toMatch(/^n\d+$/);
  });

  it("제목의 백틱이 코드펜스를 조기 종료시키지 않는다", () => {
    // `# ```x``` ` 는 실제로 도달 가능한 H1 이라 제목에 백틱 3개가 들어올 수 있다.
    // 그런데 CommonMark 의 닫는 펜스는 백틱 뒤에 공백만 와야 하고 들여쓰기 3칸까지만
    // 허용된다(실측 확인). 노드 줄은 항상 2칸 들여쓰기 + `n0["` 로 시작하므로
    // 백틱만으로 이루어진 줄이 될 수 없다 — 이게 펜스 방어선이다.
    const center = centerEntry();
    const graph = buildSimilarityGraph(center, [
      center,
      candidateAt("a.md", 0.9, { title: "```" }),
      candidateAt("b.md", 0.85, { title: "``` injected" }),
    ]);

    // mermaid 블록이 정확히 하나이고, 그 안에 백틱만인 줄이 없어야 한다.
    expect([...graph.markdown.matchAll(/```mermaid/g)]).toHaveLength(1);
    const body = mermaidBody(graph.markdown) ?? "";
    for (const line of body.split("\n")) {
      expect(/^ {0,3}`{3,}[ \t]*$/.test(line)).toBe(false);
    }
  });

  it("경로 basename 에 개행이 있어도 노드 선언이 한 줄로 유지된다", () => {
    // 제목에는 개행이 들어올 수 없다(vault-indexer 의 H1 정규식 `.` 이 모든 줄
    // 종결자를 배제함을 node 로 확인했다). 하지만 파일명에는 개행을 넣을 수 있고
    // (실측: macOS 에서 생성 성공) 제목이 비면 basename 이 라벨 폴백이 된다.
    // 그 경로로 라벨에 개행이 유입되면 노드 선언이 두 줄로 쪼개진다.
    const center = centerEntry();
    const graph = buildSimilarityGraph(center, [
      center,
      candidateAt("Notes/we\nird.md", 0.9, { title: "" }),
    ]);

    const body = mermaidBody(graph.markdown) ?? "";
    // 노드 선언 줄 수 = 노드 수. 라벨 개행이 새면 이 수가 늘어난다.
    const declLines = body.split("\n").filter((l) => /^\s*n\d+\["/.test(l));
    expect(declLines).toHaveLength(graph.shownNodes);
    for (const line of declLines) {
      // 각 선언 줄은 자체적으로 닫혀야 한다.
      expect(line.trimEnd()).toMatch(/"\]$/);
    }
  });
});

// ============================================
// 속성 테스트 — 임의 입력에도 계약이 깨지지 않는다
// ============================================

describe("buildSimilarityGraph: 속성 테스트", () => {
  /** 임의 제목·경로·유사도를 가진 후보 엔트리. */
  const candidateArb = fc.record({
    path: fc.string({ minLength: 1, maxLength: 12 }).map((s) => `${s}.md`),
    title: fc.string({ maxLength: 30 }),
    sim: fc.double({ min: -1, max: 1, noNaN: true }),
  });

  it("임의 제목을 넣어도 라벨에 미이스케이프 위험 문자가 남지 않는다", () => {
    fc.assert(
      fc.property(fc.array(candidateArb, { maxLength: 12 }), fc.string({ maxLength: 30 }), (
        raw,
        centerTitle
      ) => {
        const center = centerEntry({ title: centerTitle });
        const entries = [
          center,
          ...raw.map((r) => candidateAt(r.path, r.sim, { title: r.title })),
        ];
        const graph = buildSimilarityGraph(center, entries);

        for (const label of extractLabels(graph.markdown)) {
          expect(unescapedChars(label)).toEqual([]);
          expect(label.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("임의 입력에서도 노드 수가 상한을 넘지 않고 절단 보고가 일관된다", () => {
    // 유사도를 임계값 위쪽에 몰아 생성한다. [-1,1] 균일 분포로는 10%만 임계값을 넘어
    // 후보가 60개를 넘는 일이 거의 없고, 그러면 절단 경로가 검증되지 않는다.
    const highSimArb = fc.record({
      path: fc.string({ minLength: 1, maxLength: 12 }).map((s) => `${s}.md`),
      title: fc.string({ maxLength: 30 }),
      sim: fc.double({ min: SIMILARITY_MIN_SCORE, max: 0.98, noNaN: true }),
    });

    fc.assert(
      fc.property(fc.array(highSimArb, { maxLength: 90 }), (raw) => {
        const center = centerEntry();
        const entries = [
          center,
          ...raw.map((r) => candidateAt(r.path, r.sim, { title: r.title })),
        ];
        const graph = buildSimilarityGraph(center, entries);

        expect(graph.shownNodes).toBeLessThanOrEqual(MERMAID_MAX_NODES);
        expect(graph.shownNodes).toBeLessThanOrEqual(graph.totalNodes);
        // 엣지는 노드 절단 후 집계되므로 방사형에서 항상 shownNodes - 1 이다.
        // 절단이 있든 없든 성립하는 불변식이라 절단 경로까지 함께 고정한다.
        expect(graph.totalEdges).toBe(
          graph.shownNodes === 0 ? 0 : graph.shownNodes - 1
        );
      }),
      { numRuns: 100 }
    );
  });

  it("후보가 상한을 넘는 입력이 실제로 생성되어 절단 경로가 검증된다", () => {
    // 위 속성 테스트가 절단을 한 번도 안 밟고 통과하는 일(공허한 통과)을 막는 확인.
    const center = centerEntry();
    const over = Array.from({ length: MERMAID_MAX_NODES + 20 }, (_, i) =>
      candidateAt(`c${i}.md`, 0.95 - i * 0.0001)
    );
    const graph = buildSimilarityGraph(center, [center, ...over]);
    expect(graph.shownNodes).toBe(MERMAID_MAX_NODES);
    expect(graph.totalNodes).toBeGreaterThan(MERMAID_MAX_NODES);
  });

  it("임의 입력에서도 엔트리 배열을 변형하지 않는다", () => {
    fc.assert(
      fc.property(fc.array(candidateArb, { maxLength: 20 }), (raw) => {
        const center = centerEntry();
        const entries = [
          center,
          ...raw.map((r) => candidateAt(r.path, r.sim, { title: r.title })),
        ];
        const snapshot = JSON.stringify(entries);

        buildSimilarityGraph(center, entries);
        expect(JSON.stringify(entries)).toBe(snapshot);
      }),
      { numRuns: 50 }
    );
  });

  it("같은 입력에 항상 같은 문자열을 반환한다(결정론)", () => {
    fc.assert(
      fc.property(fc.array(candidateArb, { maxLength: 15 }), (raw) => {
        const center = centerEntry();
        const entries = [
          center,
          ...raw.map((r) => candidateAt(r.path, r.sim, { title: r.title })),
        ];
        expect(buildSimilarityGraph(center, entries).markdown).toBe(
          buildSimilarityGraph(center, entries).markdown
        );
      }),
      { numRuns: 50 }
    );
  });
});
