import { describe, it, expect } from "vitest";
import {
  recallAt,
  precisionAt,
  reciprocalRank,
  meanOf,
  runEval,
  type EvalCase,
} from "./retrieval-metrics";

describe("recallAt", () => {
  it("상위 k 안의 정답 비율을 낸다", () => {
    const ranked = ["a.md", "x.md", "b.md", "y.md"];

    expect(recallAt(ranked, ["a.md", "b.md"], 4)).toBe(1);
    expect(recallAt(ranked, ["a.md", "b.md"], 2)).toBe(0.5);
    expect(recallAt(ranked, ["a.md", "b.md"], 1)).toBe(0.5);
  });

  it("정답이 하나도 없으면 0이다", () => {
    expect(recallAt(["x.md"], ["a.md"], 5)).toBe(0);
  });

  it("순위 목록의 중복은 한 번만 센다", () => {
    // 같은 노트가 시드와 이웃 양쪽에서 올라오는 경우가 있다.
    expect(recallAt(["a.md", "a.md"], ["a.md", "b.md"], 2)).toBe(0.5);
  });

  it("k가 목록보다 크면 목록 전체를 본다", () => {
    expect(recallAt(["a.md"], ["a.md"], 100)).toBe(1);
  });

  it("대소문자를 무시한다", () => {
    expect(recallAt(["Notes/A.md"], ["notes/a.md"], 1)).toBe(1);
  });

  it("k가 0 이하면 0이다", () => {
    expect(recallAt(["a.md"], ["a.md"], 0)).toBe(0);
    expect(recallAt(["a.md"], ["a.md"], -1)).toBe(0);
  });

  it("정답 집합이 비면 1이다(놓칠 것이 없다)", () => {
    expect(recallAt(["x.md"], [], 5)).toBe(1);
  });
});

describe("precisionAt", () => {
  it("분모는 반환 개수가 아니라 k다", () => {
    // 2개만 돌려주고 둘 다 맞혔을 때 1.0으로 보고하면 적게 돌려주는 쪽이 유리해진다.
    expect(precisionAt(["a.md", "b.md"], ["a.md", "b.md"], 5)).toBe(0.4);
    expect(precisionAt(["a.md", "b.md"], ["a.md", "b.md"], 2)).toBe(1);
  });

  it("무관한 결과가 섞이면 내려간다", () => {
    expect(precisionAt(["a.md", "x.md", "y.md", "z.md"], ["a.md"], 4)).toBe(0.25);
  });
});

describe("reciprocalRank", () => {
  it("첫 정답의 역순위다", () => {
    expect(reciprocalRank(["a.md"], ["a.md"])).toBe(1);
    expect(reciprocalRank(["x.md", "a.md"], ["a.md"])).toBe(0.5);
    expect(reciprocalRank(["x.md", "y.md", "a.md"], ["a.md"])).toBeCloseTo(1 / 3);
  });

  it("정답이 없으면 0이다", () => {
    expect(reciprocalRank(["x.md"], ["a.md"])).toBe(0);
  });
});

describe("meanOf", () => {
  it("산술 평균이고 빈 배열은 0이다", () => {
    expect(meanOf([1, 0])).toBe(0.5);
    expect(meanOf([])).toBe(0);
  });
});

describe("runEval", () => {
  const cases: EvalCase[] = [
    { name: "정답을 찾는 질의", query: "hit", relevant: ["a.md"] },
    { name: "정답을 놓치는 질의", query: "miss", relevant: ["b.md"] },
  ];

  /** query가 "hit"일 때만 정답을 상위에 올리는 가짜 검색. */
  const fakeSearch = (query: string): string[] =>
    query === "hit" ? ["a.md", "x.md"] : ["x.md", "y.md"];

  it("케이스별 지표와 상위 결과를 함께 돌려준다", () => {
    const out = runEval(cases, fakeSearch, 2);

    expect(out.map((o) => o.name)).toEqual([
      "정답을 찾는 질의",
      "정답을 놓치는 질의",
    ]);
    expect(out[0].recall).toBe(1);
    expect(out[1].recall).toBe(0);
    // 실패한 케이스에서 무엇이 대신 올라왔는지 보여야 원인을 찾을 수 있다.
    expect(out[1].top).toEqual(["x.md", "y.md"]);
  });

  it("정답이 빈 케이스는 오류로 막는다", () => {
    // recall이 항상 1이 되어 조용히 평균을 끌어올리고 회귀를 가린다.
    const bad: EvalCase[] = [{ name: "빈 정답", query: "q", relevant: [] }];

    expect(() => runEval(bad, fakeSearch, 5)).toThrow("정답 경로가 없습니다");
  });

  it("같은 케이스로 서로 다른 랭킹을 비교할 수 있다", () => {
    // 이게 하네스의 존재 이유다 — dense 전용과 하이브리드를 같은 잣대로 잰다.
    const always = (): string[] => ["a.md", "b.md"];

    const baseline = meanOf(runEval(cases, fakeSearch, 2).map((o) => o.recall));
    const improved = meanOf(runEval(cases, always, 2).map((o) => o.recall));

    expect(baseline).toBe(0.5);
    expect(improved).toBe(1);
  });
});
