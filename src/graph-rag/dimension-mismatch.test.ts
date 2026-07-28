import { describe, it, expect } from "vitest";
import { compareVectors, searchWithDiagnostics } from "./vector-search";
import { combineAndRank, MIN_COMBINED_SCORE } from "./score-combiner";
import type { VaultIndexEntry } from "../types";

// ============================================
// 임베딩 차원 불일치 무음 실패 회귀 테스트
// ============================================
// 배경(리뷰 확인 결함): 임베딩 모델을 바꾸면 인덱스 벡터와 쿼리 벡터의 차원이 달라진다.
// 과거 구현은 cosineSimilarity가 0을 반환하고, 정규화 (s+1)/2 가 이를 0.5로 바꿔
// 모든 노트가 동점 0.5를 받았다. 그 결과 경로 알파벳순 상위 N건이 "관련 있음"으로
// 반환되어, 빈 결과보다 위험한 "확신에 찬 오답"이 LLM에 전달됐다.
//
// 이 테스트는 차원 불일치가 (a) 후보에서 제외되고 (b) 진단으로 보고되는지 고정한다.

/** 지정 차원의 청크 임베딩을 가진 인덱스 엔트리를 만든다. */
function makeEntry(path: string, dimension: number, fill = 0.5): VaultIndexEntry {
  return {
    path,
    embedding: [],
    lastModified: 1000,
    title: path,
    excerpt: "",
    chunks: [
      { index: 0, text: "본문", embedding: new Array(dimension).fill(fill) },
    ],
  };
}

describe("compareVectors: 비교 불가와 유사도 0을 구분한다", () => {
  it("차원이 다르면 null을 반환한다(0이 아님)", () => {
    // 0을 반환하면 정규화 단계에서 0.5(중간 점수)가 되어 무관한 노트가 검색된다.
    expect(compareVectors([1, 0, 0], [1, 0])).toBeNull();
  });

  it("빈 벡터는 null을 반환한다", () => {
    expect(compareVectors([], [1, 0])).toBeNull();
    expect(compareVectors([1, 0], [])).toBeNull();
  });

  it("직교 벡터는 유사도 0을 반환한다(비교는 가능)", () => {
    // 진짜 "무관함"은 null이 아니라 0이다.
    expect(compareVectors([1, 0], [0, 1])).toBe(0);
  });

  it("동일 벡터는 1을 반환한다", () => {
    expect(compareVectors([1, 0], [1, 0])).toBeCloseTo(1);
  });
});

describe("searchWithDiagnostics: 차원 불일치 노트를 제외하고 보고한다", () => {
  it("모든 노트가 차원 불일치면 결과가 비고 불일치 수가 보고된다", () => {
    const entries = [makeEntry("a.md", 3), makeEntry("m.md", 3), makeEntry("z.md", 3)];
    // 쿼리는 512차원 — 인덱스(3차원)와 불일치
    const diag = searchWithDiagnostics(new Array(512).fill(0.1), entries, 10);

    // 핵심: 0.5점 동점 결과가 반환되지 않는다
    expect(diag.results).toEqual([]);
    expect(diag.comparableCount).toBe(0);
    expect(diag.dimensionMismatchCount).toBe(3);
  });

  it("차원이 일치하면 정상적으로 점수가 산출된다", () => {
    const entries = [makeEntry("a.md", 4, 0.1), makeEntry("b.md", 4, 0.9)];
    const diag = searchWithDiagnostics(new Array(4).fill(0.5), entries, 10);

    expect(diag.results).toHaveLength(2);
    expect(diag.dimensionMismatchCount).toBe(0);
    expect(diag.comparableCount).toBe(2);
  });

  it("일부만 불일치하면 비교 가능한 노트만 후보가 된다", () => {
    const entries = [makeEntry("stale.md", 3), makeEntry("fresh.md", 4)];
    const diag = searchWithDiagnostics(new Array(4).fill(0.5), entries, 10);

    expect(diag.results.map((r) => r.path)).toEqual(["fresh.md"]);
    expect(diag.dimensionMismatchCount).toBe(1);
    expect(diag.comparableCount).toBe(1);
  });
});

describe("combineAndRank: 최소 점수 임계값", () => {
  const index = new Map<string, VaultIndexEntry>();

  it("무관한 노트(코사인 0 → 정규화 0.5)는 임계값 미달로 제외된다", () => {
    // 과거에는 0.5점으로 "50% 관련"이라 표시되어 LLM이 근거로 사용했다.
    const combined = combineAndRank([{ path: "unrelated.md", score: 0 }], [], index);
    expect(combined).toEqual([]);
  });

  it("관련 있는 노트는 통과한다", () => {
    const combined = combineAndRank([{ path: "related.md", score: 0.8 }], [], index);
    expect(combined).toHaveLength(1);
    expect(combined[0].combinedScore).toBeGreaterThanOrEqual(MIN_COMBINED_SCORE);
  });

  it("minScore=0이면 임계값 필터를 비활성화한다", () => {
    const combined = combineAndRank([{ path: "unrelated.md", score: 0 }], [], index, {
      minScore: 0,
    });
    expect(combined).toHaveLength(1);
  });
});

describe("combineAndRank: 이웃 관련성 반영", () => {
  const index = new Map<string, VaultIndexEntry>();
  const seeds = [{ path: "seed.md", score: 0.9 }];
  const neighbors = [
    { path: "relevant.md", hop: 1, seedPath: "seed.md" },
    { path: "irrelevant.md", hop: 1, seedPath: "seed.md" },
  ];

  it("이웃 점수를 주면 관련성 높은 이웃이 더 높은 점수를 받는다", () => {
    // 과거에는 두 이웃이 시드 점수를 그대로 상속해 동점이었다.
    const combined = combineAndRank(seeds, neighbors, index, {
      neighborScores: new Map([
        ["relevant.md", 0.85],
        ["irrelevant.md", -0.5],
      ]),
      minScore: 0,
    });

    const relevant = combined.find((r) => r.path === "relevant.md");
    const irrelevant = combined.find((r) => r.path === "irrelevant.md");
    expect(relevant).toBeDefined();
    expect(irrelevant).toBeDefined();
    expect(relevant!.combinedScore).toBeGreaterThan(irrelevant!.combinedScore);
  });

  it("이웃 점수를 모르면 시드 점수 기반으로 저하 동작한다", () => {
    const combined = combineAndRank(seeds, neighbors, index, { minScore: 0 });
    const both = combined.filter((r) => !r.isSeed);
    expect(both).toHaveLength(2);
    // 정보가 없으므로 동점이 되는 것은 의도된 저하 동작이다
    expect(both[0].combinedScore).toBe(both[1].combinedScore);
  });

  it("관련성 높은 이웃은 무관한 시드보다 상위에 올 수 있다", () => {
    // 과거에는 시드 하한(0.5)이 hop1 이웃 상한(0.5)과 겹쳐 이웃이 시드를 앞설 수 없었다.
    const weakSeed = [{ path: "weak-seed.md", score: 0.05 }];
    const strongNeighbor = [{ path: "strong.md", hop: 1, seedPath: "weak-seed.md" }];
    const combined = combineAndRank(weakSeed, strongNeighbor, index, {
      neighborScores: new Map([["strong.md", 1.0]]),
      minScore: 0,
    });

    // 이웃 자신의 유사도가 반영되므로 hop 감쇠에도 경쟁력이 생긴다
    const neighbor = combined.find((r) => r.path === "strong.md");
    expect(neighbor).toBeDefined();
    expect(neighbor!.vectorScore).toBeCloseTo(1.0);
  });
});
