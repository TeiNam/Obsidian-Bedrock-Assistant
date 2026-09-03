import { describe, it, expect } from "vitest";
import {
  representativeEmbedding,
  suggestLinksForNote,
  suggestLinks,
  buildRelatedLinksBlock,
  groupBySource,
  MIN_LINK_SIMILARITY,
  RELATED_LINKS_BLOCK_KEY,
} from "./link-suggestions";
import { upsertGeneratedBlock } from "./sentinel-blocks";
import type { VaultIndexEntry } from "../types";

/** 대표 임베딩을 지정해 엔트리를 만든다. */
function entry(
  path: string,
  embedding: number[],
  overrides: Partial<VaultIndexEntry> = {}
): VaultIndexEntry {
  return {
    path,
    embedding: [],
    lastModified: 1000,
    title: path.replace(/\.md$/, "").split("/").pop() ?? path,
    excerpt: "",
    chunks: [{ index: 0, text: "", embedding }],
    ...overrides,
  };
}

/** 코사인 1.0 → 정규화 1.0이므로 임계값을 확실히 넘는다. */
const SAME = [1, 0, 0];
/** 코사인 0 → 정규화 0.5이므로 임계값 미달이다. */
const ORTHOGONAL = [0, 1, 0];

describe("representativeEmbedding", () => {
  it("첫 유효 청크 임베딩을 쓴다", () => {
    const e = entry("a.md", [1, 2, 3]);
    expect(representativeEmbedding(e)).toEqual([1, 2, 3]);
  });

  it("빈 청크 임베딩은 건너뛴다", () => {
    const e = entry("a.md", [], {
      chunks: [
        { index: 0, text: "", embedding: [] },
        { index: 1, text: "", embedding: [4, 5, 6] },
      ],
    });
    expect(representativeEmbedding(e)).toEqual([4, 5, 6]);
  });

  it("청크가 없으면 노트 단위 임베딩으로 폴백한다", () => {
    // 레거시 인덱스 호환 경로다.
    const e = entry("a.md", [], { chunks: undefined, embedding: [7, 8, 9] });
    expect(representativeEmbedding(e)).toEqual([7, 8, 9]);
  });

  it("아무 임베딩도 없으면 null이다", () => {
    const e = entry("a.md", [], { chunks: [], embedding: [] });
    expect(representativeEmbedding(e)).toBeNull();
  });
});

describe("suggestLinksForNote", () => {
  const orphan = entry("orphan.md", SAME);

  it("의미가 가까운 노트를 제안한다", () => {
    const all = [orphan, entry("close.md", SAME), entry("far.md", ORTHOGONAL)];

    const out = suggestLinksForNote(orphan, all);

    expect(out.map((s) => s.targetPath)).toEqual(["close.md"]);
    expect(out[0].similarity).toBeGreaterThanOrEqual(MIN_LINK_SIMILARITY);
    expect(out[0].targetTitle).toBe("close");
  });

  it("자기 자신은 제안하지 않는다", () => {
    const out = suggestLinksForNote(orphan, [orphan]);
    expect(out).toEqual([]);
  });

  it("이미 연결된 노트는 다시 제안하지 않는다", () => {
    const linked = entry("orphan.md", SAME, { outlinks: ["close.md"] });
    const all = [linked, entry("close.md", SAME), entry("other.md", SAME)];

    expect(suggestLinksForNote(linked, all).map((s) => s.targetPath)).toEqual(["other.md"]);
  });

  it("백링크로 연결된 노트도 제외한다", () => {
    const linked = entry("orphan.md", SAME, { backlinks: ["close.md"] });
    const all = [linked, entry("close.md", SAME)];

    expect(suggestLinksForNote(linked, all)).toEqual([]);
  });

  it("생성물(위키 폴더 하위)은 후보에서 제외한다", () => {
    const all = [orphan, entry("Second Brain/entities/x.md", SAME), entry("real.md", SAME)];

    const out = suggestLinksForNote(orphan, all, { wikiFolder: "Second Brain" });
    expect(out.map((s) => s.targetPath)).toEqual(["real.md"]);
  });

  it("임계값 미달은 제안하지 않는다", () => {
    const all = [orphan, entry("far.md", ORTHOGONAL)];
    expect(suggestLinksForNote(orphan, all)).toEqual([]);
  });

  it("차원이 다른 노트는 유사도 0이 아니라 비교 불가로 제외한다", () => {
    // 0으로 취급하면 재인덱싱 중인 노트가 조용히 후보에 섞인다.
    const all = [orphan, entry("mismatched.md", [1, 0])];
    expect(suggestLinksForNote(orphan, all)).toEqual([]);
  });

  it("임베딩이 없는 노트는 제외한다", () => {
    const all = [orphan, entry("noembed.md", [], { chunks: [], embedding: [] })];
    expect(suggestLinksForNote(orphan, all)).toEqual([]);
  });

  it("소스에 임베딩이 없으면 빈 목록이다", () => {
    const bare = entry("bare.md", [], { chunks: [], embedding: [] });
    expect(suggestLinksForNote(bare, [bare, entry("x.md", SAME)])).toEqual([]);
  });

  it("노트당 최대 개수를 넘기지 않는다", () => {
    const all = [orphan, ...["a", "b", "c", "d", "e"].map((n) => entry(`${n}.md`, SAME))];

    expect(suggestLinksForNote(orphan, all)).toHaveLength(3);
    expect(suggestLinksForNote(orphan, all, { maxPerNote: 2 })).toHaveLength(2);
  });

  it("동점은 경로 오름차순으로 깨서 결정적이다", () => {
    const all = [orphan, entry("z.md", SAME), entry("a.md", SAME), entry("m.md", SAME)];

    expect(suggestLinksForNote(orphan, all).map((s) => s.targetPath)).toEqual([
      "a.md",
      "m.md",
      "z.md",
    ]);
  });

  it("임계값을 낮추면 더 많이 제안한다", () => {
    const all = [orphan, entry("far.md", ORTHOGONAL)];

    expect(suggestLinksForNote(orphan, all, { minSimilarity: 0.4 })).toHaveLength(1);
  });
});

describe("suggestLinks", () => {
  it("소스 경로 오름차순으로 모은다", () => {
    const b = entry("b.md", SAME);
    const a = entry("a.md", SAME);
    const target = entry("t.md", SAME);

    const out = suggestLinks([b, a], [a, b, target]);

    expect(out.map((s) => s.sourcePath)).toEqual(["a.md", "a.md", "b.md", "b.md"]);
  });

  it("후보가 없는 노트는 결과에 나타나지 않는다", () => {
    const lonely = entry("lonely.md", ORTHOGONAL);
    const other = entry("other.md", SAME);

    const out = suggestLinks([lonely], [lonely, other]);
    expect(out).toEqual([]);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const sources = [entry("b.md", SAME), entry("a.md", SAME)];
    const before = sources.map((s) => s.path);

    suggestLinks(sources, sources);

    expect(sources.map((s) => s.path)).toEqual(before);
  });
});

describe("buildRelatedLinksBlock", () => {
  const suggestions = [
    { sourcePath: "o.md", targetPath: "Notes/Alpha.md", targetTitle: "Alpha", similarity: 0.9 },
    { sourcePath: "o.md", targetPath: "Notes/Beta.md", targetTitle: "Beta", similarity: 0.85 },
  ];

  it("제목 기반 위키링크 목록을 만든다", () => {
    const block = buildRelatedLinksBlock(suggestions);

    // 경로가 아니라 제목으로 링크해야 노트를 옮겨도 깨지지 않는다.
    expect(block).toContain("- [[Alpha]]");
    expect(block).toContain("- [[Beta]]");
    expect(block).not.toContain("Notes/Alpha.md");
  });

  it("빈 목록은 빈 문자열이다", () => {
    expect(buildRelatedLinksBlock([])).toBe("");
  });

  it("Sentinel_Block으로 병합하면 사용자 텍스트가 보존되고 재실행이 멱등이다", () => {
    const original = "# 내 노트\n\n직접 쓴 내용입니다.\n";
    const block = buildRelatedLinksBlock(suggestions);

    const once = upsertGeneratedBlock(original, RELATED_LINKS_BLOCK_KEY, block);
    const twice = upsertGeneratedBlock(once, RELATED_LINKS_BLOCK_KEY, block);

    expect(once).toContain("직접 쓴 내용입니다.");
    expect(once).toContain("- [[Alpha]]");
    // 두 번 적용해도 블록이 중복되지 않는다.
    expect(twice).toBe(once);
  });
});

describe("groupBySource", () => {
  it("source 경로별로 묶고 순서를 유지한다", () => {
    const grouped = groupBySource([
      { sourcePath: "a.md", targetPath: "x.md", targetTitle: "x", similarity: 0.9 },
      { sourcePath: "b.md", targetPath: "y.md", targetTitle: "y", similarity: 0.9 },
      { sourcePath: "a.md", targetPath: "z.md", targetTitle: "z", similarity: 0.85 },
    ]);

    expect([...grouped.keys()]).toEqual(["a.md", "b.md"]);
    expect(grouped.get("a.md")?.map((s) => s.targetPath)).toEqual(["x.md", "z.md"]);
  });

  it("빈 입력은 빈 Map이다", () => {
    expect(groupBySource([]).size).toBe(0);
  });
});
