import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  findOrphanNotes,
  findStubNotes,
  findOneWayLinks,
  findUnresolvedLinkTargets,
  rankGaps,
  collectGaps,
  buildGapReport,
  STUB_MAX_CHARS,
  GAP_REPORT_LIMIT,
  type GapCandidate,
} from "./knowledge-gaps";
import type { VaultIndexEntry } from "../types";

// ============================================
// 지식 공백 리포트 (Knowledge Gaps) 테스트
// ============================================
// 배경: "무엇을 아는가"는 검색으로 알 수 있지만 "무엇을 모르는가"는 알 수 없다.
// 인덱스에 이미 있는 outlinks/backlinks/tags는 지금까지 검색(graph-traversal)에만
// 쓰였다. 같은 데이터로 구조적 공백을 로컬 계산한다 — LLM 호출 0회.
//
// 중요: 인덱스는 "존재하는 링크만" 보존한다(graph-extractor). 깨진 링크는
// metadataCache.unresolvedLinks에서 따로 가져와야 한다.

/** 테스트용 인덱스 엔트리 생성. 지정하지 않은 필드는 빈 값으로 둔다. */
function entry(over: Partial<VaultIndexEntry> & { path: string }): VaultIndexEntry {
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

describe("findOrphanNotes: 아무 노트와도 연결되지 않은 노트", () => {
  it("outlinks와 backlinks가 모두 비면 고아로 판정한다", () => {
    const entries = [
      entry({ path: "orphan.md" }),
      entry({ path: "linked.md", outlinks: ["other.md"] }),
      entry({ path: "referenced.md", backlinks: ["other.md"] }),
    ];
    expect(findOrphanNotes(entries).map((g) => g.path)).toEqual(["orphan.md"]);
  });

  it("생성된 노트(위키 폴더 하위)는 제외한다", () => {
    // 생성물이 통계를 오염시키면 사용자가 손대야 할 대상이 묻힌다.
    const entries = [
      entry({ path: "Second Brain/Reports/Knowledge Gaps.md" }),
      entry({ path: "real-orphan.md" }),
    ];
    expect(findOrphanNotes(entries, "Second Brain").map((g) => g.path)).toEqual([
      "real-orphan.md",
    ]);
  });

  it("고아가 없으면 빈 배열을 반환한다", () => {
    expect(findOrphanNotes([entry({ path: "a.md", outlinks: ["b.md"] })])).toEqual([]);
  });
});

describe("findStubNotes: 링크는 받지만 본문이 거의 없는 노트", () => {
  it("백링크가 있는데 본문이 짧으면 스텁으로 판정한다", () => {
    // 여러 곳에서 참조하는데 내용이 없다 = 채워야 할 공백.
    const entries = [
      entry({
        path: "stub.md",
        backlinks: ["a.md", "b.md"],
        chunks: [{ index: 0, text: "짧은 메모", embedding: [] }],
      }),
    ];
    const result = findStubNotes(entries);
    expect(result.map((g) => g.path)).toEqual(["stub.md"]);
    // 참조가 많을수록 우선순위가 높아야 하므로 근거에 개수를 남긴다.
    expect(result[0].detail).toContain("2");
  });

  it("백링크가 없는 짧은 노트는 스텁이 아니다", () => {
    // 아무도 참조하지 않는 짧은 메모는 공백이 아니라 그냥 메모다.
    const entries = [
      entry({ path: "memo.md", chunks: [{ index: 0, text: "짧음", embedding: [] }] }),
    ];
    expect(findStubNotes(entries)).toEqual([]);
  });

  it("본문이 충분히 길면 스텁이 아니다", () => {
    const entries = [
      entry({
        path: "full.md",
        backlinks: ["a.md"],
        chunks: [{ index: 0, text: "가".repeat(STUB_MAX_CHARS + 1), embedding: [] }],
      }),
    ];
    expect(findStubNotes(entries)).toEqual([]);
  });

  it("여러 청크의 길이를 합산해 판정한다", () => {
    const half = Math.ceil(STUB_MAX_CHARS / 2) + 10;
    const entries = [
      entry({
        path: "multi.md",
        backlinks: ["a.md"],
        chunks: [
          { index: 0, text: "가".repeat(half), embedding: [] },
          { index: 1, text: "나".repeat(half), embedding: [] },
        ],
      }),
    ];
    // 합이 상한을 넘으므로 스텁이 아니다.
    expect(findStubNotes(entries)).toEqual([]);
  });
});

describe("findOneWayLinks: 한쪽만 참조하는 링크", () => {
  it("A가 B를 링크하는데 B의 백링크에 A가 없으면 단방향으로 본다", () => {
    const entries = [
      entry({ path: "a.md", outlinks: ["b.md"] }),
      entry({ path: "b.md", backlinks: [] }),
    ];
    const result = findOneWayLinks(entries);
    expect(result).toHaveLength(1);
    expect(result[0].detail).toContain("b.md");
  });

  it("양방향으로 연결되면 보고하지 않는다", () => {
    const entries = [
      entry({ path: "a.md", outlinks: ["b.md"], backlinks: ["b.md"] }),
      entry({ path: "b.md", outlinks: ["a.md"], backlinks: ["a.md"] }),
    ];
    expect(findOneWayLinks(entries)).toEqual([]);
  });

  it("인덱스에 없는 대상은 무시한다", () => {
    // 존재하지 않는 노트는 깨진 링크이며 unresolvedLinks가 담당한다.
    const entries = [entry({ path: "a.md", outlinks: ["missing.md"] })];
    expect(findOneWayLinks(entries)).toEqual([]);
  });
});

describe("findUnresolvedLinkTargets: 깨진 링크 대상", () => {
  it("참조 횟수가 많은 미해결 대상을 집계한다", () => {
    // 인덱스는 존재하는 링크만 보존하므로 이 정보는 metadataCache에서 온다.
    const unresolved = {
      "a.md": { "없는노트": 2 },
      "b.md": { "없는노트": 1, "다른노트": 1 },
    };
    const result = findUnresolvedLinkTargets(unresolved);
    // 여러 곳에서 찾는 대상일수록 만들 가치가 크므로 앞에 온다.
    expect(result[0].path).toBe("없는노트");
    expect(result[0].detail).toContain("3");
    expect(result.map((g) => g.path)).toContain("다른노트");
  });

  it("빈 입력은 빈 배열을 반환한다", () => {
    expect(findUnresolvedLinkTargets({})).toEqual([]);
  });

  it("참조가 0인 항목은 제외한다", () => {
    expect(findUnresolvedLinkTargets({ "a.md": { "x": 0 } })).toEqual([]);
  });

  it("위키 폴더 하위 소스는 집계에서 제외한다", () => {
    // 생성 노트의 링크가 통계를 왜곡하지 않게 한다.
    const unresolved = { "Second Brain/gen.md": { "생성물이만든링크": 5 } };
    expect(findUnresolvedLinkTargets(unresolved, "Second Brain")).toEqual([]);
  });
});

describe("rankGaps: 상위 후보 선별", () => {
  it("가중치 내림차순으로 정렬하고 상한을 적용한다", () => {
    const candidates: GapCandidate[] = Array.from({ length: GAP_REPORT_LIMIT + 5 }, (_, i) => ({
      kind: "orphan",
      path: `n${i}.md`,
      detail: "",
      weight: i,
    }));
    const ranked = rankGaps(candidates);
    expect(ranked).toHaveLength(GAP_REPORT_LIMIT);
    expect(ranked[0].weight).toBeGreaterThan(ranked[1].weight);
  });

  it("가중치가 같으면 경로 오름차순으로 결정적 순서를 유지한다", () => {
    // 매 실행마다 순서가 바뀌면 sentinel 블록이 계속 변경돼 diff가 시끄럽다.
    const ranked = rankGaps([
      { kind: "orphan", path: "b.md", detail: "", weight: 1 },
      { kind: "orphan", path: "a.md", detail: "", weight: 1 },
    ]);
    expect(ranked.map((g) => g.path)).toEqual(["a.md", "b.md"]);
  });

  it("빈 입력은 빈 배열을 반환한다", () => {
    expect(rankGaps([])).toEqual([]);
  });
});

describe("buildGapReport: 마크다운 렌더", () => {
  it("종류별로 묶어 렌더하고 위키링크를 쓴다", () => {
    const report = buildGapReport([
      { kind: "orphan", path: "고아.md", detail: "연결 없음", weight: 3 },
      { kind: "stub", path: "스텁.md", detail: "백링크 2개, 본문 12자", weight: 5 },
    ]);
    expect(report).toContain("[[고아]]");
    expect(report).toContain("백링크 2개, 본문 12자");
  });

  it("후보가 없으면 그렇다고 표시한다", () => {
    // 빈 블록을 쓰면 사용자가 "실행이 실패했나" 의심한다.
    expect(buildGapReport([])).toContain("발견된 구조적 공백이 없습니다");
  });

  it("같은 입력은 같은 출력을 만든다(결정론)", () => {
    const input: GapCandidate[] = [
      { kind: "stub", path: "a.md", detail: "d1", weight: 2 },
      { kind: "orphan", path: "b.md", detail: "d2", weight: 1 },
    ];
    expect(buildGapReport(input)).toBe(buildGapReport(input));
  });
});

describe("속성: 지표 계산은 어떤 인덱스 입력에도 예외 없이 완료된다", () => {
  it("임의의 엔트리 집합에 대해 모든 탐지 함수가 유효한 결과를 반환한다", () => {
    const entryArb = fc.record({
      path: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `${s}.md`),
      outlinks: fc.array(fc.string({ minLength: 1, maxLength: 8 }).map((s) => `${s}.md`), {
        maxLength: 3,
      }),
      backlinks: fc.array(fc.string({ minLength: 1, maxLength: 8 }).map((s) => `${s}.md`), {
        maxLength: 3,
      }),
      textLen: fc.nat({ max: 400 }),
    });

    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 12 }), (raw) => {
        const entries = raw.map((r) =>
          entry({
            path: r.path,
            outlinks: r.outlinks,
            backlinks: r.backlinks,
            chunks: [{ index: 0, text: "가".repeat(r.textLen), embedding: [] }],
          })
        );

        for (const gaps of [
          findOrphanNotes(entries),
          findStubNotes(entries),
          findOneWayLinks(entries),
        ]) {
          expect(Array.isArray(gaps)).toBe(true);
          for (const g of gaps) {
            expect(typeof g.path).toBe("string");
            expect(g.weight).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(g.weight)).toBe(true);
          }
        }

        // 랭킹은 항상 상한 이하이며 결정적이다.
        const all = [...findOrphanNotes(entries), ...findStubNotes(entries)];
        const ranked = rankGaps(all);
        expect(ranked.length).toBeLessThanOrEqual(GAP_REPORT_LIMIT);
        expect(rankGaps(all)).toEqual(ranked);
      }),
      { numRuns: 100 }
    );
  });
});

describe("collectGaps: 네 지표 통합", () => {
  it("metadataCache가 비어도 인덱스 기반 세 지표는 계산된다", () => {
    // 초기 로드나 스텁 환경에서 unresolvedLinks가 없을 수 있다. 그때 이 단계 전체가
    // 실패하면 나머지 지표까지 잃는다(스케줄러 단계 실패로 기록됨).
    const entries = [
      entry({ path: "orphan.md" }),
      entry({
        path: "stub.md",
        backlinks: ["a.md"],
        chunks: [{ index: 0, text: "짧음", embedding: [] }],
      }),
    ];
    const gaps = collectGaps(entries, {});
    expect(gaps.map((g) => g.kind).sort()).toEqual(["orphan", "stub"]);
  });

  it("깨진 링크를 가장 높은 우선순위로 올린다", () => {
    // 여러 곳에서 참조하는 없는 노트가 가장 행동 가능한 공백이다.
    const entries = [entry({ path: "orphan.md" })];
    const gaps = collectGaps(entries, { "a.md": { "없는노트": 5 } });
    expect(gaps[0].kind).toBe("missing");
  });

  it("상한을 넘지 않는다", () => {
    const entries = Array.from({ length: GAP_REPORT_LIMIT + 20 }, (_, i) =>
      entry({ path: `orphan${i}.md` })
    );
    expect(collectGaps(entries, {}).length).toBeLessThanOrEqual(GAP_REPORT_LIMIT);
  });
});
