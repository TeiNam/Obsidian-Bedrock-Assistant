import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { fuseRanks, RRF_K, type RankedList, reserveSlots } from "./rank-fusion";
import { recallAt, meanOf, runEval, type EvalCase } from "./retrieval-metrics";

/** 경로만 뽑는다. */
const paths = (lists: RankedList[]): string[] => fuseRanks(lists).map((r) => r.path);

describe("fuseRanks", () => {
  it("두 목록 모두에 있는 경로를 위로 올린다", () => {
    const out = paths([
      { name: "dense", paths: ["a.md", "b.md", "c.md"] },
      { name: "lexical", paths: ["c.md", "d.md"] },
    ]);

    // c.md는 dense 3위 + lexical 1위. 어느 한 목록에서만 1위인 a.md보다 위여야 한다.
    expect(out[0]).toBe("c.md");
  });

  it("어느 목록에도 없던 경로는 결과에 없다", () => {
    const out = paths([{ name: "dense", paths: ["a.md"] }]);
    expect(out).toEqual(["a.md"]);
  });

  it("한 목록에만 있는 경로도 결과에 포함한다", () => {
    // 어휘 검색만 잡은 노트를 버리면 융합의 의미가 없다.
    const out = paths([
      { name: "dense", paths: ["a.md"] },
      { name: "lexical", paths: ["only-lexical.md"] },
    ]);

    expect(out).toContain("only-lexical.md");
  });

  it("각 목록의 순위를 보존한다(같은 목록 내에서)", () => {
    const out = paths([{ name: "dense", paths: ["a.md", "b.md", "c.md"] }]);
    expect(out).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("한 목록 안의 중복은 한 번만 센다", () => {
    // 중복이 두 번 기여하면 그 목록의 영향이 부당하게 커진다.
    const dup = fuseRanks([{ name: "d", paths: ["a.md", "a.md", "b.md"] }]);
    const single = fuseRanks([{ name: "d", paths: ["a.md", "b.md"] }]);

    expect(dup.map((r) => r.path)).toEqual(single.map((r) => r.path));
    expect(dup[0].score).toBeCloseTo(single[0].score);
    // 중복을 건너뛰었으므로 b.md의 순위는 2위(rank 1)로 계산돼야 한다.
    expect(dup[1].score).toBeCloseTo(1 / (RRF_K + 2));
  });

  it("어느 신호가 잡았는지 sources로 알려준다", () => {
    const out = fuseRanks([
      { name: "dense", paths: ["both.md"] },
      { name: "lexical", paths: ["both.md", "lex.md"] },
    ]);

    expect(out.find((r) => r.path === "both.md")?.sources.sort()).toEqual(["dense", "lexical"]);
    expect(out.find((r) => r.path === "lex.md")?.sources).toEqual(["lexical"]);
  });

  it("가중치 0 이하인 목록은 무시한다", () => {
    const out = paths([
      { name: "dense", paths: ["a.md"] },
      { name: "lexical", paths: ["b.md"], weight: 0 },
    ]);

    expect(out).toEqual(["a.md"]);
  });

  it("가중치를 낮추면 기여가 줄어든다", () => {
    const full = fuseRanks([{ name: "l", paths: ["a.md"] }]);
    const half = fuseRanks([{ name: "l", paths: ["a.md"], weight: 0.5 }]);

    expect(half[0].score).toBeCloseTo(full[0].score / 2);
  });

  it("빈 입력은 빈 결과다", () => {
    expect(fuseRanks([])).toEqual([]);
    expect(fuseRanks([{ name: "d", paths: [] }])).toEqual([]);
  });

  it("동점은 경로 오름차순으로 깨서 결정적이다", () => {
    // 같은 입력에 매번 같은 순서가 나와야 평가 지표가 흔들리지 않는다.
    const a = paths([
      { name: "x", paths: ["b.md"] },
      { name: "y", paths: ["a.md"] },
    ]);
    const b = paths([
      { name: "y", paths: ["a.md"] },
      { name: "x", paths: ["b.md"] },
    ]);

    expect(a).toEqual(["a.md", "b.md"]);
    expect(a).toEqual(b);
  });

  it("Property: 결과는 입력 경로들의 합집합과 정확히 같다", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.constantFrom("a.md", "b.md", "c.md", "d.md"), { maxLength: 6 }), {
          maxLength: 3,
        }),
        (rawLists) => {
          const lists = rawLists.map((p, i) => ({ name: `l${i}`, paths: p }));
          const union = new Set(rawLists.flat());
          const out = fuseRanks(lists);

          expect(new Set(out.map((r) => r.path))).toEqual(union);
          // 점수는 내림차순이어야 한다.
          for (let i = 1; i < out.length; i++) {
            expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================
// 융합이 실제로 검색 품질을 올리는가 (평가 하네스 사용)
// ============================================
/**
 * dense 전용 랭킹과 하이브리드 랭킹을 같은 케이스로 재서 융합 이득을 계측한다.
 *
 * 케이스는 dense 검색의 알려진 약점을 재현한다 — 에러 코드·함수명·버전 문자열처럼
 * "그 문자열이 그대로 들어 있는 노트"를 임베딩 유사도가 상위권 밖으로 밀어내는 상황이다.
 * 여기서 하이브리드가 dense를 이기지 못하면 융합을 넣을 이유가 없다.
 */
describe("하이브리드 융합 이득 계측", () => {
  const CASES: EvalCase[] = [
    {
      name: "에러 코드 정확 일치",
      query: "CrashLoopBackOff",
      relevant: ["ops/k8s-troubleshooting.md"],
    },
    {
      name: "함수명 정확 일치",
      query: "normalizeSearchFilter",
      relevant: ["dev/entry-filter-notes.md"],
    },
    { name: "일반 개념 질의", query: "쿠버네티스 운영", relevant: ["ops/k8s-troubleshooting.md"] },
  ];

  /**
   * dense 검색 대역 — 개념 질의는 잘 맞히지만 정확한 문자열 질의에서는 정답을
   * 상위권 밖(4위)으로 밀어낸다. 실제 임베딩 검색의 실패 양상이다.
   */
  const denseSearch = (query: string): string[] => {
    if (query === "쿠버네티스 운영") {
      return ["ops/k8s-troubleshooting.md", "ops/monitoring.md", "misc/a.md"];
    }
    // 정확 일치 질의: 유사한 주제 노트들이 정답을 밀어낸다.
    return ["misc/a.md", "misc/b.md", "misc/c.md", ...CASES.map((c) => c.relevant[0])];
  };

  /** 어휘 검색 대역 — 문자열이 그대로 있는 노트를 1위로 잡는다. */
  const lexicalSearch = (query: string): string[] => {
    const hit = CASES.find((c) => c.query === query && query !== "쿠버네티스 운영");
    return hit ? [hit.relevant[0]] : [];
  };

  const hybridSearch = (query: string): string[] =>
    fuseRanks([
      { name: "dense", paths: denseSearch(query) },
      { name: "lexical", paths: lexicalSearch(query) },
    ]).map((r) => r.path);

  const K = 3;

  it("dense 전용은 정확 일치 질의에서 정답을 상위 3에 못 올린다", () => {
    const exact = CASES.filter((c) => c.name !== "일반 개념 질의");
    const recalls = runEval(exact, denseSearch, K).map((o) => o.recall);

    expect(meanOf(recalls)).toBe(0);
  });

  it("하이브리드는 정확 일치 질의를 모두 상위 3에 올린다", () => {
    const exact = CASES.filter((c) => c.name !== "일반 개념 질의");
    const recalls = runEval(exact, hybridSearch, K).map((o) => o.recall);

    expect(meanOf(recalls)).toBe(1);
  });

  it("개념 질의 성능을 떨어뜨리지 않는다", () => {
    // 어휘 신호를 섞어 기존에 잘 되던 질의가 망가지면 순이득이 아니다.
    const concept = CASES.filter((c) => c.name === "일반 개념 질의");

    const before = meanOf(runEval(concept, denseSearch, K).map((o) => o.recall));
    const after = meanOf(runEval(concept, hybridSearch, K).map((o) => o.recall));

    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("전체 recall@3이 0에서 1로 올라간다", () => {
    const before = meanOf(runEval(CASES, denseSearch, K).map((o) => o.recall));
    const after = meanOf(runEval(CASES, hybridSearch, K).map((o) => o.recall));

    expect(before).toBeCloseTo(1 / 3);
    expect(after).toBe(1);
  });
});

// ============================================
// 한 목록 전용 후보의 자리 보장
// ============================================
/**
 * RRF의 K=60은 상위 순위 간 점수 차를 매우 작게 만든다. 가중치 0.5를 곱한 어휘 1위는
 * dense 10위보다도 낮아서, limit으로 자르는 단계에서 항상 사라진다 — 하이브리드 검색을
 * 넣은 이유가 바로 그 경우다.
 */
describe("reserveSlots", () => {
  const ranked = ["a", "b", "c", "d", "e"];

  it("이미 상위권에 있으면 아무것도 바꾸지 않는다", () => {
    expect(reserveSlots(ranked, ["b"], 3)).toEqual(["a", "b", "c"]);
  });

  it("잘려나간 예약분을 목록 끝 자리에 넣는다", () => {
    // dense 상위권(a, b)은 그대로 두고 마지막 자리만 내준다.
    expect(reserveSlots(ranked, ["e"], 3)).toEqual(["a", "b", "e"]);
  });

  it("예약분이 여러 개면 그만큼의 끝자리를 쓴다", () => {
    expect(reserveSlots(ranked, ["d", "e"], 3)).toEqual(["a", "d", "e"]);
  });

  it("limit을 넘기지 않는다", () => {
    expect(reserveSlots(ranked, ["d", "e"], 2)).toEqual(["d", "e"]);
    expect(reserveSlots(ranked, ["d", "e"], 1)).toEqual(["d"]);
  });

  it("limit이 0 이하면 빈 목록이다", () => {
    expect(reserveSlots(ranked, ["a"], 0)).toEqual([]);
  });

  it("예약이 없으면 단순히 자른다", () => {
    expect(reserveSlots(ranked, [], 2)).toEqual(["a", "b"]);
  });

  it("결과에 중복이 없다", () => {
    const out = reserveSlots(ranked, ["a", "e"], 3);
    expect(new Set(out).size).toBe(out.length);
  });
});

// ============================================
// 실제 산수: 어휘 1위가 dense 10위에 밀린다
// ============================================
describe("RRF 가중치의 한계 (reserveSlots가 필요한 이유)", () => {
  it("가중치를 곱한 어휘 1위는 dense 10위보다 낮다", () => {
    const fused = fuseRanks([
      { name: "dense", paths: Array.from({ length: 10 }, (_, i) => `d${i}`) },
      { name: "lexical", paths: ["정확일치.md"], weight: 0.5 },
    ]);

    // limit=10으로 자르면 정확 일치가 사라진다.
    const paths = fused.map((f) => f.path);
    expect(paths.indexOf("정확일치.md")).toBe(10);
    expect(paths.slice(0, 10)).not.toContain("정확일치.md");

    // 자리를 예약하면 남는다.
    expect(reserveSlots(paths, ["정확일치.md"], 10)).toContain("정확일치.md");
  });
});
