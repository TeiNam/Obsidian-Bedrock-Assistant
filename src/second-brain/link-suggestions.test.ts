import { describe, it, expect } from "vitest";
import {
  representativeEmbedding,
  maxEmbeddingSimilarity,
  suggestLinksForNote,
  suggestLinks,
  groupBySource,
  MIN_LINK_SIMILARITY,
  RELATED_LINKS_BLOCK_KEY,
  mergeRelatedLinksBlock,
  parseRelatedLinksBlock,
  formatSuggestionLink,
  type LinkSuggestion,
} from "./link-suggestions";
import { upsertGeneratedBlock, getGeneratedBlock } from "./sentinel-blocks";
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

describe("maxEmbeddingSimilarity", () => {
  it("첫 청크가 달라도 뒤쪽 청크가 같으면 최대 유사도를 사용한다", () => {
    const source = entry("source.md", ORTHOGONAL, {
      chunks: [
        { index: 0, text: "도입", embedding: ORTHOGONAL },
        { index: 1, text: "핵심", embedding: SAME },
      ],
    });
    const candidate = entry("candidate.md", SAME);

    expect(maxEmbeddingSimilarity(source, candidate)).toBeCloseTo(1);
    expect(suggestLinksForNote(source, [source, candidate]).map((s) => s.targetPath)).toEqual([
      "candidate.md",
    ]);
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

describe("mergeRelatedLinksBlock — 블록 생성", () => {
  const suggestions = [
    { sourcePath: "o.md", targetPath: "Notes/Alpha.md", targetTitle: "Alpha", similarity: 0.9 },
    { sourcePath: "o.md", targetPath: "Notes/Beta.md", targetTitle: "Beta", similarity: 0.85 },
  ];

  it("경로로 링크하고 제목은 별칭으로 붙인다", () => {
    const block = mergeRelatedLinksBlock(null, suggestions);

    // targetTitle은 인덱서가 뽑은 첫 H1이지 파일명이 아니다. 제목으로 링크하면
    // 대상 파일을 가리키지 않거나 같은 이름의 다른 노트를 가리킨다.
    expect(block).toContain("- [[Notes/Alpha|Alpha]]");
    expect(block).toContain("- [[Notes/Beta|Beta]]");
    // 확장자는 떼고 링크한다.
    expect(block).not.toContain("Notes/Alpha.md");
  });

  it("경로 대소문자를 보존한다", () => {
    // 중복 판정은 소문자로 하지만 표시는 원문이어야 한다 — 대소문자 구분
    // 파일시스템에서 소문자화된 경로는 링크가 깨진다.
    const block = mergeRelatedLinksBlock(null, [
      { sourcePath: "o.md", targetPath: "Notes/CamelCase.md", targetTitle: "제목", similarity: 0.9 },
    ]);

    expect(block).toContain("[[Notes/CamelCase|제목]]");
  });

  it("별칭이 대상과 같으면 별칭을 생략한다", () => {
    const block = mergeRelatedLinksBlock(null, [
      { sourcePath: "o.md", targetPath: "Alpha.md", targetTitle: "Alpha", similarity: 0.9 },
    ]);

    expect(block).toContain("- [[Alpha]]");
    expect(block).not.toContain("|");
  });

  it("빈 목록은 빈 문자열이다", () => {
    expect(mergeRelatedLinksBlock(null, [])).toBe("");
  });

  it("Sentinel_Block으로 병합하면 사용자 텍스트가 보존되고 재실행이 멱등이다", () => {
    const original = "# 내 노트\n\n직접 쓴 내용입니다.\n";
    const block = mergeRelatedLinksBlock(null, suggestions);

    const once = upsertGeneratedBlock(original, RELATED_LINKS_BLOCK_KEY, block);
    const twice = upsertGeneratedBlock(once, RELATED_LINKS_BLOCK_KEY, block);

    expect(once).toContain("직접 쓴 내용입니다.");
    expect(once).toContain("- [[Notes/Alpha|Alpha]]");
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

// ============================================
// 이전 승인분 보존 (누적)
// ============================================
/**
 * upsertGeneratedBlock은 블록 전체를 교체한다. 새 승인분만으로 블록을 만들면 이전에
 * 승인한 링크가 사라진다 — 사용자가 명시적으로 승인한 것을 다음 승인이 지우는 조용한
 * 손실이다. 리뷰에서 실제로 잡힌 결함이다.
 */
describe("mergeRelatedLinksBlock — 이전 승인분 보존", () => {
  const first: LinkSuggestion[] = [
    { sourcePath: "o.md", targetPath: "A.md", targetTitle: "알파", similarity: 0.9 },
  ];
  const second: LinkSuggestion[] = [
    { sourcePath: "o.md", targetPath: "B.md", targetTitle: "베타", similarity: 0.85 },
  ];

  it("두 번에 걸쳐 승인해도 첫 링크가 남는다", () => {
    const run1 = mergeRelatedLinksBlock(null, first);
    const run2 = mergeRelatedLinksBlock(run1, second);

    expect(run2).toContain("[[A|알파]]");
    expect(run2).toContain("[[B|베타]]");
  });

  it("기존 링크를 먼저 두어 순서를 안정시킨다", () => {
    const run2 = mergeRelatedLinksBlock(mergeRelatedLinksBlock(null, first), second);

    expect(run2.indexOf("A|알파")).toBeLessThan(run2.indexOf("B|베타"));
  });

  it("같은 링크를 다시 승인해도 중복되지 않는다", () => {
    const run1 = mergeRelatedLinksBlock(null, first);
    const run2 = mergeRelatedLinksBlock(run1, first);

    expect(run2).toBe(run1);
  });

  it("대소문자만 다른 중복을 합친다", () => {
    const upper: LinkSuggestion[] = [
      { sourcePath: "o.md", targetPath: "A.md", targetTitle: "알파", similarity: 0.9 },
      { sourcePath: "o.md", targetPath: "a.md", targetTitle: "ALPHA", similarity: 0.9 },
    ];
    const block = mergeRelatedLinksBlock(null, upper);

    // 대상 경로가 대소문자만 다르면 같은 노트로 보고 하나만 남긴다.
    expect(block.match(/- \[\[/g)).toHaveLength(1);
    expect(mergeRelatedLinksBlock(block, [
      { sourcePath: "o.md", targetPath: "A.md", targetTitle: "알파", similarity: 0.9 },
    ])).toBe(block);
  });

  it("별칭·헤딩이 붙은 기존 링크에서도 대상만 읽는다", () => {
    const existing = "## 관련 노트\n\n- [[Notes/알파|별칭]]\n- [[Notes/베타#섹션]]";

    expect(parseRelatedLinksBlock(existing)).toEqual(["Notes/알파", "Notes/베타"]);
  });

  it("블록이 없으면 새 승인분만으로 만든다", () => {
    expect(mergeRelatedLinksBlock(null, first)).toContain("[[A|알파]]");
  });

  it("아무것도 없으면 빈 문자열이다", () => {
    expect(mergeRelatedLinksBlock(null, [])).toBe("");
  });

  it("Sentinel_Block 왕복에서 링크가 누적된다", () => {
    // 실제 적용 경로와 같은 순서: 블록 읽기 → 병합 → upsert.
    let doc = "# 노트\n\n직접 쓴 내용.\n";

    doc = upsertGeneratedBlock(
      doc,
      RELATED_LINKS_BLOCK_KEY,
      mergeRelatedLinksBlock(getGeneratedBlock(doc, RELATED_LINKS_BLOCK_KEY), first)
    );
    doc = upsertGeneratedBlock(
      doc,
      RELATED_LINKS_BLOCK_KEY,
      mergeRelatedLinksBlock(getGeneratedBlock(doc, RELATED_LINKS_BLOCK_KEY), second)
    );

    expect(doc).toContain("직접 쓴 내용.");
    expect(doc).toContain("[[A|알파]]");
    expect(doc).toContain("[[B|베타]]");
  });
});

// ============================================
// 승인 화면과 쓰기의 표기 일치
// ============================================
/**
 * 승인 화면이 표기를 따로 만들면 사용자가 승인한 것과 노트에 들어가는 것이 달라진다.
 * 실제로 화면은 `[[제목]]`을 보여주고 쓰기는 `[[경로|제목]]`을 넣고 있었다.
 */
describe("formatSuggestionLink", () => {
  it("mergeRelatedLinksBlock이 쓰는 표기와 같다", () => {
    const cases: LinkSuggestion[] = [
      { sourcePath: "o.md", targetPath: "Notes/Alpha.md", targetTitle: "제목", similarity: 0.9 },
      // 제목이 대상과 같으면 별칭을 붙이지 않는다.
      { sourcePath: "o.md", targetPath: "Alpha.md", targetTitle: "Alpha", similarity: 0.9 },
      // 제목이 비면 경로만 쓴다.
      { sourcePath: "o.md", targetPath: "Notes/Beta.md", targetTitle: "", similarity: 0.9 },
    ];

    for (const s of cases) {
      expect(mergeRelatedLinksBlock(null, [s])).toContain(`- ${formatSuggestionLink(s)}`);
    }
  });

  it("확장자를 떼고 경로로 링크한다", () => {
    expect(
      formatSuggestionLink({
        sourcePath: "o.md",
        targetPath: "Notes/Alpha.md",
        targetTitle: "알파",
        similarity: 0.9,
      })
    ).toBe("[[Notes/Alpha|알파]]");
  });
});

describe("mergeRelatedLinksBlock — 별칭 속 파이프", () => {
  it("파이프가 든 제목을 잘라내지 않는다", () => {
    // 옵시디언은 첫 파이프만 구분자로 읽는다. split("|")로 쪼개면 별칭이 잘리고 다음
    // 병합에서 사용자가 승인한 표시 제목이 조용히 사라진다.
    const s1: LinkSuggestion = {
      sourcePath: "o.md",
      targetPath: "Notes/x.md",
      targetTitle: "A | B",
      similarity: 0.9,
    };

    const first = mergeRelatedLinksBlock(null, [s1]);
    expect(first).toContain("[[Notes/x|A | B]]");

    // 같은 대상을 다시 승인해도 별칭이 유지된다(멱등).
    expect(mergeRelatedLinksBlock(first, [s1])).toBe(first);
  });

  it("파이프가 든 별칭을 되읽어도 대상은 경로다", () => {
    expect(parseRelatedLinksBlock("## 관련 노트\n\n- [[Notes/x|A | B]]")).toEqual(["Notes/x"]);
  });
});

describe("formatSuggestionLink — 특수문자 경로", () => {
  it("경로에 #이 있으면 마크다운 링크로 쓴다", () => {
    // `[[Notes/foo#bar]]`는 `Notes/foo`의 `bar` 절로 해석된다 — 파일을 가리키지 않는다.
    const link = formatSuggestionLink({
      sourcePath: "o.md",
      targetPath: "Notes/foo#bar.md",
      targetTitle: "제목",
      similarity: 0.9,
    });

    expect(link).toBe("[제목](Notes/foo%23bar.md)");
    expect(link).not.toContain("[[");
  });

  it("공백도 인코딩한다", () => {
    const link = formatSuggestionLink({
      sourcePath: "o.md",
      targetPath: "Notes/a#b c.md",
      targetTitle: "제목",
      similarity: 0.9,
    });

    expect(link).toBe("[제목](Notes/a%23b%20c.md)");
  });

  it("제목이 없으면 경로를 표시로 쓴다", () => {
    const link = formatSuggestionLink({
      sourcePath: "o.md",
      targetPath: "Notes/foo#bar.md",
      targetTitle: "",
      similarity: 0.9,
    });

    expect(link).toBe("[Notes/foo#bar](Notes/foo%23bar.md)");
  });

  it("특수문자가 없으면 위키링크를 유지한다", () => {
    expect(
      formatSuggestionLink({
        sourcePath: "o.md",
        targetPath: "Notes/normal.md",
        targetTitle: "제목",
        similarity: 0.9,
      })
    ).toBe("[[Notes/normal|제목]]");
  });
});

describe("mergeRelatedLinksBlock — 마크다운 대체 링크 왕복", () => {
  const special: LinkSuggestion = {
    sourcePath: "o.md",
    targetPath: "Notes/foo#bar.md",
    targetTitle: "제목",
    similarity: 0.9,
  };

  it("`.md.md`를 만들지 않는다", () => {
    // 마크다운 대체 링크는 `.md`가 붙어 저장되고 parseNoteLinks가 그것을 보존한다.
    // 그대로 병합하면 formatNoteLink가 다시 붙인다.
    const first = mergeRelatedLinksBlock(null, [special]);
    const second = mergeRelatedLinksBlock(first, [special]);

    expect(second).not.toContain(".md.md");
    // 같은 링크를 다시 승인해도 중복되지 않는다.
    expect(second).toBe(first);
  });

  it("위키링크와 마크다운 링크가 섞여도 누적된다", () => {
    const normal: LinkSuggestion = {
      sourcePath: "o.md",
      targetPath: "Notes/normal.md",
      targetTitle: "보통",
      similarity: 0.85,
    };

    const block = mergeRelatedLinksBlock(mergeRelatedLinksBlock(null, [special]), [normal]);

    expect(block).toContain("Notes/foo%23bar.md");
    expect(block).toContain("[[Notes/normal|보통]]");
    expect(block).not.toContain(".md.md");
  });
});
