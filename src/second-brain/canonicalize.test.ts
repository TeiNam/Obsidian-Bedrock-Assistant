import { describe, it, expect } from "vitest";
import {
  normalizeTitle,
  titleTokens,
  buildTitleBuckets,
  findDuplicateClusters,
  buildCanonicalBlock,
  mergeAliases,
  MIN_DUPLICATE_SIMILARITY,
} from "./canonicalize";
import type { VaultIndexEntry } from "../types";

/** 코사인 1.0 → 정규화 1.0. 임계값을 확실히 넘는다. */
const SAME = [1, 0, 0];
/** 코사인 0 → 정규화 0.5. 임계값 미달이다. */
const ORTHOGONAL = [0, 1, 0];

function entry(
  path: string,
  title: string,
  embedding: number[],
  overrides: Partial<VaultIndexEntry> = {}
): VaultIndexEntry {
  return {
    path,
    title,
    embedding: [],
    lastModified: 1000,
    excerpt: "",
    chunks: [{ index: 0, text: "본문", embedding }],
    ...overrides,
  };
}

describe("normalizeTitle / titleTokens", () => {
  it("소문자·구두점 제거·공백 정리를 한다", () => {
    expect(normalizeTitle("  Kubernetes, 운영!! 정리  ")).toBe("kubernetes 운영 정리");
  });

  it("한 글자 토큰은 버린다", () => {
    // 1자 토큰은 아무 노트와도 겹쳐 버킷이 무의미해진다.
    expect(titleTokens("A 회의 록")).toEqual(["회의"]);
  });

  it("빈 제목은 빈 결과다", () => {
    expect(normalizeTitle("!!!")).toBe("");
    expect(titleTokens("!!!")).toEqual([]);
  });
});

describe("buildTitleBuckets", () => {
  it("정규화 제목이 같은 노트를 한 버킷에 묶는다", () => {
    const buckets = buildTitleBuckets([
      entry("A/Kubernetes.md", "Kubernetes", SAME),
      entry("B/kubernetes.md", "kubernetes!", SAME),
    ]);

    expect(buckets.get("title:kubernetes")).toEqual(["A/Kubernetes.md", "B/kubernetes.md"]);
  });

  it("토큰을 공유하는 노트도 묶는다", () => {
    const buckets = buildTitleBuckets([
      entry("a.md", "회의록 2026", SAME),
      entry("b.md", "회의록 정리", SAME),
    ]);

    expect(buckets.get("token:회의록")).toHaveLength(2);
  });

  it("혼자인 버킷은 내보내지 않는다", () => {
    const buckets = buildTitleBuckets([entry("a.md", "유일한 제목", SAME)]);
    expect(buckets.size).toBe(0);
  });

  it("과대 버킷은 버린다", () => {
    // "정리" 같은 흔한 토큰이 사실상 전체 스캔이 되는 것을 막는다.
    const many = Array.from({ length: 20 }, (_, i) => entry(`n${i}.md`, `정리 ${i}0`, SAME));
    const buckets = buildTitleBuckets(many);

    expect(buckets.get("token:정리")).toBeUndefined();
  });
});

describe("findDuplicateClusters", () => {
  it("제목이 같고 임베딩도 가까우면 군집으로 낸다", () => {
    const clusters = findDuplicateClusters([
      entry("A/Kubernetes.md", "Kubernetes", SAME, { outlinks: ["x.md", "y.md"] }),
      entry("B/Kubernetes.md", "Kubernetes", SAME),
    ]);

    expect(clusters).toHaveLength(1);
    // 링크가 많은 쪽이 정본이다.
    expect(clusters[0].canonical.path).toBe("A/Kubernetes.md");
    expect(clusters[0].duplicates.map((d) => d.path)).toEqual(["B/Kubernetes.md"]);
    expect(clusters[0].reason).toBe("same-title");
  });

  it("제목만 비슷하고 내용이 다르면 군집으로 내지 않는다", () => {
    // 제목 버킷은 후보를 좁히는 수단일 뿐이고 확증은 임베딩이 한다.
    const clusters = findDuplicateClusters([
      entry("a.md", "회의록 A", SAME),
      entry("b.md", "회의록 B", ORTHOGONAL),
    ]);

    expect(clusters).toEqual([]);
  });

  it("링크 수가 같으면 본문이 긴 쪽을 정본으로 고른다", () => {
    const clusters = findDuplicateClusters([
      entry("z.md", "주제", SAME, { chunks: [{ index: 0, text: "짧다", embedding: SAME }] }),
      entry("a.md", "주제", SAME, {
        chunks: [{ index: 0, text: "아주 긴 본문입니다".repeat(10), embedding: SAME }],
      }),
    ]);

    expect(clusters[0].canonical.path).toBe("a.md");
  });

  it("링크가 더 많은 쪽이 본문 길이를 이긴다", () => {
    const clusters = findDuplicateClusters([
      entry("short-but-linked.md", "주제", SAME, {
        outlinks: ["x.md"],
        chunks: [{ index: 0, text: "짧다", embedding: SAME }],
      }),
      entry("long-no-links.md", "주제", SAME, {
        chunks: [{ index: 0, text: "긴 본문".repeat(50), embedding: SAME }],
      }),
    ]);

    // 링크는 "다른 노트가 이걸 정본으로 취급한다"는 신호이므로 1순위다.
    expect(clusters[0].canonical.path).toBe("short-but-linked.md");
  });

  it("차원이 다른 노트는 비교 불가로 제외한다", () => {
    // 0으로 취급하면 재인덱싱 중인 노트가 섞이고, 1로 취급하면 무관한 노트를 중복이라 한다.
    const clusters = findDuplicateClusters([
      entry("a.md", "주제", SAME),
      entry("b.md", "주제", [1, 0]),
    ]);

    expect(clusters).toEqual([]);
  });

  it("임베딩이 없는 노트는 제외한다", () => {
    const clusters = findDuplicateClusters([
      entry("a.md", "주제", SAME),
      entry("b.md", "주제", [], { chunks: [], embedding: [] }),
    ]);

    expect(clusters).toEqual([]);
  });

  it("생성물(위키 폴더 하위)은 제외한다", () => {
    const clusters = findDuplicateClusters(
      [
        entry("Second Brain/entities/주제.md", "주제", SAME),
        entry("Second Brain/concepts/주제.md", "주제", SAME),
      ],
      { wikiFolder: "Second Brain" }
    );

    expect(clusters).toEqual([]);
  });

  it("한 노트가 두 군집에 들어가지 않는다", () => {
    // 한 노트를 두 정본에 배정하면 어느 쪽을 승인해도 나머지가 어긋난다.
    const clusters = findDuplicateClusters([
      entry("a.md", "쿠버네티스 운영", SAME),
      entry("b.md", "쿠버네티스 정리", SAME),
      entry("c.md", "운영 정리", SAME),
    ]);

    const all = clusters.flatMap((c) => [c.canonical.path, ...c.duplicates.map((d) => d.path)]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("임계값을 높이면 군집이 줄어든다", () => {
    const entries = [entry("a.md", "주제", SAME), entry("b.md", "주제", SAME)];

    expect(findDuplicateClusters(entries, { minSimilarity: 0.99 })).toHaveLength(1);
    // 1을 넘는 임계값은 어떤 쌍도 통과하지 못한다(정규화 상한이 1이다).
    expect(findDuplicateClusters(entries, { minSimilarity: 1.01 })).toEqual([]);
  });

  it("기본 임계값은 링크 제안보다 높다", () => {
    // 중복 판정은 "같은 것이다"라는 강한 주장이고 사용자가 받아 합치면 되돌리기 어렵다.
    expect(MIN_DUPLICATE_SIMILARITY).toBeGreaterThan(0.82);
  });

  it("같은 입력에 항상 같은 결과를 낸다", () => {
    const entries = [
      entry("b.md", "주제", SAME),
      entry("a.md", "주제", SAME),
      entry("c.md", "주제", SAME),
    ];

    const first = JSON.stringify(findDuplicateClusters(entries));
    const second = JSON.stringify(findDuplicateClusters([...entries].reverse()));
    expect(first).toBe(second);
  });
});

describe("buildCanonicalBlock", () => {
  const cluster = {
    canonical: { path: "A/주제.md", title: "주제", similarity: 1, bodyLength: 100, linkCount: 3 },
    duplicates: [
      { path: "B/주제.md", title: "주제 사본", similarity: 0.95, bodyLength: 20, linkCount: 0 },
    ],
    reason: "same-title" as const,
  };

  it("중복 후보를 경로와 유사도와 함께 적는다", () => {
    const block = buildCanonicalBlock(cluster);

    expect(block).toContain("[[주제 사본]]");
    expect(block).toContain("B/주제.md");
    expect(block).toContain("95.0%");
  });

  it("직접 판단하라고 안내한다(자동 병합하지 않는다)", () => {
    // 오병합은 되돌리기 가장 어려운 손실이므로 제안까지만 한다.
    expect(buildCanonicalBlock(cluster)).toContain("직접 합치거나");
  });
});

describe("mergeAliases", () => {
  const cluster = {
    canonical: { path: "a.md", title: "주제", similarity: 1, bodyLength: 10, linkCount: 0 },
    duplicates: [
      { path: "b.md", title: "주제 사본", similarity: 0.95, bodyLength: 5, linkCount: 0 },
      { path: "c.md", title: "다른 이름", similarity: 0.93, bodyLength: 5, linkCount: 0 },
    ],
    reason: "same-title" as const,
  };

  it("중복 노트 제목을 별칭으로 모은다", () => {
    expect(mergeAliases(undefined, cluster)).toEqual(["주제 사본", "다른 이름"]);
  });

  it("기존 별칭을 보존한다", () => {
    // 사용자가 직접 넣은 별칭을 덮어써선 안 된다.
    expect(mergeAliases(["기존 별칭"], cluster)).toEqual([
      "기존 별칭",
      "주제 사본",
      "다른 이름",
    ]);
  });

  it("문자열 하나로 저장된 기존 별칭도 받는다", () => {
    expect(mergeAliases("하나", cluster)[0]).toBe("하나");
  });

  it("중복과 대소문자 차이를 합친다", () => {
    expect(mergeAliases(["주제 사본"], cluster)).toEqual(["주제 사본", "다른 이름"]);
    expect(mergeAliases(["주제 사본".toUpperCase()], cluster)).toHaveLength(2);
  });

  it("정본 자신의 제목은 별칭에 넣지 않는다", () => {
    const selfTitled = {
      ...cluster,
      duplicates: [
        { path: "b.md", title: "주제", similarity: 0.95, bodyLength: 5, linkCount: 0 },
      ],
    };

    expect(mergeAliases(undefined, selfTitled)).toEqual([]);
  });

  it("문자열이 아닌 기존 값은 무시한다", () => {
    expect(mergeAliases({ not: "a list" }, cluster)).toEqual(["주제 사본", "다른 이름"]);
    expect(mergeAliases([1, null, "쓸모있음"], cluster)[0]).toBe("쓸모있음");
  });
});
