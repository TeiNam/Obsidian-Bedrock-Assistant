import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { VaultIndexer } from "./vault-indexer";
import { TFile } from "obsidian";

// TFile 인스턴스를 생성하는 헬퍼
function makeTFile(path: string, mtime = 1000): TFile {
  const file = new TFile();
  file.path = path;
  file.basename = path.replace(/\.md$/, "");
  file.stat = { mtime, ctime: mtime, size: 100 } as unknown as TFile["stat"];
  return file;
}

// 단일 노트를 가진 최소 App 모킹 (cachedRead는 비어 있지 않은 본문 반환)
function makeApp(file: TFile): ConstructorParameters<typeof VaultIndexer>[0] {
  return {
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => "# 노트\n본문 내용",
      getAbstractFileByPath: (p: string) => (p === file.path ? file : null),
    },
  } as unknown as ConstructorParameters<typeof VaultIndexer>[0];
}

// 고정 임베딩 벡터를 반환하는 가짜 IAiClient.
// getEmbedding은 vi.fn 스파이로 만들어 호출 여부를 검증한다.
function makeClient(): { getEmbedding: ReturnType<typeof vi.fn> } & ConstructorParameters<typeof VaultIndexer>[1] {
  return {
    getEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
  } as unknown as { getEmbedding: ReturnType<typeof vi.fn> } & ConstructorParameters<typeof VaultIndexer>[1];
}

// 공백 전용(빈 문자열 포함) 문자열 생성기.
// 스페이스/탭/개행/캐리지리턴 문자만으로 구성하며 minLength 기본값(0)으로 빈 문자열도 포함한다.
const whitespaceOnlyArb = fc.stringOf(
  fc.constantFrom(" ", "\t", "\n", "\r"),
  { maxLength: 10 }
);

describe("VaultIndexer 빈/공백 쿼리 검증", () => {
  // Feature: graph-rag-knowledge-base, Property 13: 빈 또는 공백 전용 쿼리는 무효 표시와 함께 빈 결과를 반환한다
  // **Validates: Requirements 4.7**
  it("공백 전용(빈 문자열 포함) 쿼리는 invalidQuery 표시와 빈 결과를 반환하고 getEmbedding을 호출하지 않는다", async () => {
    await fc.assert(
      fc.asyncProperty(whitespaceOnlyArb, async (query) => {
        const file = makeTFile("note.md");
        const client = makeClient();
        const indexer = new VaultIndexer(makeApp(file), client);

        // 임베딩을 가진 노트로 인덱스를 채운다.
        // → 빈 결과가 "무효 쿼리" 때문임을 명확히 하기 위함(빈 인덱스가 원인이 아님).
        await indexer.indexFile(file);
        expect(indexer.size).toBe(1);

        // 인덱싱 단계에서 발생한 getEmbedding 호출 기록을 초기화한다.
        // 이후 search 호출 동안 getEmbedding이 호출되지 않는지만 검증한다.
        client.getEmbedding.mockClear();

        const result = await indexer.search(query);

        // 무효 쿼리 → 빈 결과 + invalidQuery 표시
        expect(result.items).toEqual([]);
        expect(result.invalidQuery).toBe(true);

        // 벡터 검색을 수행하지 않으므로 search 동안 getEmbedding 미호출
        expect(client.getEmbedding).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});

// N개의 노트를 가진 App 모킹.
// 각 파일은 비어 있지 않은 본문을 반환하므로 indexFile이 청크 임베딩을 생성한다.
function makeMultiApp(files: TFile[]): ConstructorParameters<typeof VaultIndexer>[0] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async () => "# 노트\n본문 내용",
      getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
    },
  } as unknown as ConstructorParameters<typeof VaultIndexer>[0];
}

// N개의 임베딩 보유 노트로 인덱서를 채우고, depth=0(시드만, 그래프 순회 비활성)으로 설정한다.
// depth=0이면 후보 = 시드 = min(10, N)으로 결정적이다(이웃 확장 없음).
async function buildPopulatedIndexer(n: number): Promise<VaultIndexer> {
  const files = Array.from({ length: n }, (_, i) => makeTFile(`note-${i}.md`, 1000 + i));
  const indexer = new VaultIndexer(makeMultiApp(files), makeClient());
  // 시드만 후보로 사용하도록 그래프 순회를 끈다 → 후보 개수 = min(10, N)
  indexer.setSearchOptions({ depth: 0 });
  for (const file of files) {
    await indexer.indexFile(file);
  }
  return indexer;
}

describe("VaultIndexer limit 검증 및 결과 개수 제한", () => {
  // Feature: graph-rag-knowledge-base, Property 21: limit은 결과 개수를 제한하고 범위를 벗어나면 거부한다
  // **Validates: Requirements 6.5, 6.7**

  // Part 1: 유효한 limit([1,100])이면 결과 개수는 min(candidateCount, limit)이다.
  // depth=0이므로 candidateCount = min(10, N)이고, 따라서 items.length === min(min(10, N), limit).
  it("유효한 limit([1,100])에서 결과 개수는 min(candidateCount, limit)이다", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: 1, max: 100 }),
        async (n, limit) => {
          const indexer = await buildPopulatedIndexer(n);
          // 임베딩 보유 노트 N개 → 벡터 검색 경로 사용, depth=0이므로 후보는 시드뿐이다.
          // 시드 수는 max(10, min(limit, N))이므로 후보 = min(N, max(10, limit)).
          // (과거에는 시드가 10으로 고정돼 limit>10이 무의미했다.)
          const candidateCount = Math.min(n, Math.max(10, limit));

          const result = await indexer.search("쿼리 텍스트", limit);

          // 결과 개수는 후보 수와 limit 중 작은 값으로 제한된다 (Req 6.5)
          expect(result.items.length).toBe(Math.min(candidateCount, limit));
          // 유효 쿼리이므로 무효 표시는 없어야 한다
          expect(result.invalidQuery).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  // Part 2: 범위를 벗어난 limit(<1 또는 >100)이면 검색은 오류를 던지고 결과를 반환하지 않는다 (Req 6.7).
  it("범위를 벗어난 limit(<1 또는 >100)은 오류를 던지고 결과를 반환하지 않는다", async () => {
    // 범위 밖 정수 생성기: 1 미만(0 이하) 또는 100 초과
    const invalidLimitArb = fc.oneof(
      fc.integer({ min: -1000, max: 0 }),
      fc.integer({ min: 101, max: 1000 })
    );

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 15 }),
        invalidLimitArb,
        async (n, invalidLimit) => {
          const indexer = await buildPopulatedIndexer(n);

          // 범위 밖 limit → 오류 throw, 결과 미반환 (Req 6.7)
          await expect(indexer.search("쿼리 텍스트", invalidLimit)).rejects.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// 폴백/엣지 단위 테스트 (task 8.7) — 예시 기반(example-based) 단위 테스트
// 임베딩 0개 → 키워드 폴백 + 표시, limit 미지정 시 기본 10,
// 후보 0개 빈 결과, 빈 그래프/청크 엔트리 검색 무예외
// ============================================================================

// 임베딩이 0개인 인덱스를 deserialize로 로드하기 위한 직렬화 페이로드 헬퍼.
// 모든 엔트리의 embedding=[] 이고 chunks도 비어 있어 hasEmbeddings()가 false가 된다.
// → deserialize가 useEmbeddings=false로 설정하므로 search는 키워드 폴백 경로를 탄다 (Req 4.6).
function makeEmbeddingLessPayload(
  entries: Array<{ path: string; title: string; searchText: string }>
): string {
  return JSON.stringify({
    schemaVersion: 1,
    entries: entries.map((e) => ({
      path: e.path,
      embedding: [],
      lastModified: 1000,
      title: e.title,
      excerpt: "발췌 텍스트",
      searchText: e.searchText,
      chunks: [],
      outlinks: [],
      backlinks: [],
      tags: [],
      frontmatter: {},
    })),
  });
}

describe("VaultIndexer 키워드 폴백 검증 (임베딩 0개)", () => {
  // 임베딩이 하나도 없는 인덱스 → 키워드 검색으로 폴백하고 폴백 표시를 반환한다 (Req 4.6).
  it("임베딩 0개 인덱스에서 검색하면 usedKeywordFallback=true와 키워드 매치 결과를 반환한다", async () => {
    const client = makeClient();
    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), client);

    // 임베딩 없는 엔트리들을 로드(searchText에 "키워드" 포함 → 키워드 검색이 매치)
    indexer.deserialize(
      makeEmbeddingLessPayload([
        { path: "a.md", title: "노트 A", searchText: "노트 a\n키워드 본문 내용" },
        { path: "b.md", title: "노트 B", searchText: "노트 b\n다른 본문" },
      ])
    );
    expect(indexer.size).toBe(2);

    // 인덱싱 시점 호출 기록 초기화 후, 폴백 경로가 벡터 임베딩을 사용하지 않는지도 검증
    client.getEmbedding.mockClear();

    const result = await indexer.search("키워드");

    // 임베딩 0개 → 키워드 폴백 표시 (Req 4.6)
    expect(result.usedKeywordFallback).toBe(true);
    // "키워드"가 포함된 a.md만 매치되어 결과에 포함된다
    expect(result.items.length).toBe(1);
    expect(result.items[0].path).toBe("a.md");
    // 폴백 결과는 모두 시드(hop 0)로 표시된다
    expect(result.items[0].isSeed).toBe(true);
    expect(result.items[0].hop).toBe(0);
    // 키워드 폴백은 벡터 임베딩 생성을 수행하지 않는다
    expect(client.getEmbedding).not.toHaveBeenCalled();
  });

  // 키워드 폴백이지만 매치되는 항목이 없으면 빈 결과 + 폴백 표시를 반환한다 (Req 4.6, 6.9).
  it("임베딩 0개 + 매치 없는 쿼리는 빈 결과와 usedKeywordFallback=true를 반환한다", async () => {
    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), makeClient());
    indexer.deserialize(
      makeEmbeddingLessPayload([
        { path: "a.md", title: "노트 A", searchText: "노트 a\n본문 내용" },
      ])
    );

    const result = await indexer.search("존재하지않는단어xyz");

    expect(result.usedKeywordFallback).toBe(true);
    expect(result.items).toEqual([]);
  });
});

// ============================================
// 필터 통과 후보 기준 임베딩 판정
// ============================================
/**
 * 임베딩 유무는 **필터를 통과한 후보** 기준으로 봐야 한다. 인덱스 전체를 보면
 * "임베딩 있는 노트가 어딘가에 있다"는 이유로 벡터 검색에 들어가고, 후보 중에는 비교
 * 가능한 벡터가 없어 빈 결과가 나온다. 그 상황에서 필요한 건 키워드 폴백이다.
 */
// ============================================
// 어휘 후보 풀은 limit보다 작아지면 안 된다
// ============================================
/**
 * 어휘 후보를 30개로 고정하면 limit=40 요청에서 어휘 31위 이후는 융합에 아예 참여하지
 * 못한다. dense가 임계값으로 걸러낸 노트를 어휘가 되살릴 수 있는데, 그 통로가 상위
 * 30개로 막혀 있으면 결과에 들어올 방법이 없다.
 */
// ============================================
// 적중 청크 본문을 결과에 싣는다
// ============================================
/**
 * excerpt는 노트 맨 앞 500자로 고정이다. 검색이 뒤쪽 청크로 노트를 찾아냈을 때 그
 * 사실을 결과가 전달하지 않으면, LLM은 "찾긴 찾았는데 근거는 못 본" 상태로 답한다.
 */
describe("VaultIndexer 적중 청크 본문", () => {
  /** 도입부와 뒤쪽 문단이 서로 다른 벡터를 갖는 노트. */
  function makeTwoChunkPayload(): string {
    return JSON.stringify({
      schemaVersion: 2,
      entries: [
        {
          path: "long.md",
          embedding: [1, 0, 0],
          lastModified: 1000,
          title: "긴 노트",
          excerpt: "도입부 문장입니다",
          searchText: "도입부 문장입니다 뒤쪽 결정 문단입니다",
          chunks: [
            { index: 0, text: "도입부 문장입니다", embedding: [1, 0, 0], charStart: 0 },
            {
              index: 1,
              text: "뒤쪽 결정 문단입니다",
              embedding: [0, 1, 0],
              charStart: 100,
              heading: "결정",
            },
          ],
          outlinks: [],
          backlinks: [],
          tags: [],
          frontmatter: {},
        },
      ],
    });
  }

  it("질의와 맞은 청크의 본문을 matchedText로 싣는다", async () => {
    // 쿼리 벡터를 두 번째 청크에 맞춘다.
    const client = {
      getEmbedding: vi.fn(async () => [0, 1, 0]),
    } as unknown as ConstructorParameters<typeof VaultIndexer>[1];

    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), client);
    indexer.deserialize(makeTwoChunkPayload());

    const result = await indexer.search("결정");

    expect(result.items[0].matchedText).toBe("뒤쪽 결정 문단입니다");
    // 헤딩도 그 청크에서 온다.
    expect(result.items[0].heading).toBe("결정");
    // excerpt는 도입부 그대로 남는다 — 소비자가 무엇을 쓸지 고를 수 있어야 한다.
    expect(result.items[0].excerpt).toBe("도입부 문장입니다");
  });

  it("적중 본문에 상한을 둔다", async () => {
    // 청크 크기는 사용자 설정이고 상한이 100만 자다. 적중 본문은 그대로 프롬프트에
    // 들어가므로 경계가 없으면 설정 하나로 프롬프트가 무제한 커진다.
    const huge = "가".repeat(5000);
    const payload = JSON.stringify({
      schemaVersion: 2,
      entries: [
        {
          path: "huge.md",
          embedding: [1, 0, 0],
          lastModified: 1000,
          title: "큰 노트",
          excerpt: "도입부",
          searchText: huge,
          chunks: [{ index: 0, text: huge, embedding: [1, 0, 0], charStart: 0 }],
          outlinks: [],
          backlinks: [],
          tags: [],
          frontmatter: {},
        },
      ],
    });

    const client = {
      getEmbedding: vi.fn(async () => [1, 0, 0]),
    } as unknown as ConstructorParameters<typeof VaultIndexer>[1];
    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), client);
    indexer.deserialize(payload);

    const result = await indexer.search("가");

    expect(result.items[0].matchedText?.length).toBe(2000);
  });

  it("도입부가 맞으면 도입부 본문을 싣는다", async () => {
    const client = {
      getEmbedding: vi.fn(async () => [1, 0, 0]),
    } as unknown as ConstructorParameters<typeof VaultIndexer>[1];

    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), client);
    indexer.deserialize(makeTwoChunkPayload());

    const result = await indexer.search("도입부");

    expect(result.items[0].matchedText).toBe("도입부 문장입니다");
    // 도입부 청크에는 헤딩이 없다.
    expect(result.items[0].heading).toBeNull();
  });
});

describe("VaultIndexer 어휘 후보 풀과 limit", () => {
  /** 쿼리와 정렬된 벡터를 돌려주는 클라이언트. */
  function makeAlignedClient() {
    return {
      getEmbedding: vi.fn(async () => [1, 0, 0]),
    } as unknown as ConstructorParameters<typeof VaultIndexer>[1];
  }

  /**
   * dense 상위 32개 + dense가 버리는 1개.
   *
   * 어휘 점수는 전부 동점("키워드" 2회, 제목 매치 없음)이라 순위는 경로 오름차순으로
   * 정해진다 → 대상 노트(zzz.md)는 어휘 33위다.
   */
  function makeWidePayload(): string {
    const body = "키워드 그리고 키워드";
    const dense = Array.from({ length: 32 }, (_, i) => ({
      path: `n${String(i).padStart(2, "0")}.md`,
      // 쿼리와 정렬 → 코사인 1
      embedding: [1, 0, 0],
      lastModified: 1000,
      title: `노트 ${i}`,
      excerpt: "발췌",
      searchText: body,
      chunks: [{ index: 0, text: body, embedding: [1, 0, 0] }],
      outlinks: [],
      backlinks: [],
      tags: [],
      frontmatter: {},
    }));

    return JSON.stringify({
      schemaVersion: 1,
      entries: [
        ...dense,
        {
          path: "zzz.md",
          // 쿼리와 직교 → 정규화 0.5로 최소 관련성 임계값에 못 미쳐 dense가 버린다.
          embedding: [0, 1, 0],
          lastModified: 1000,
          title: "어휘로만 잡히는 노트",
          excerpt: "발췌",
          searchText: body,
          chunks: [{ index: 0, text: body, embedding: [0, 1, 0] }],
          outlinks: [],
          backlinks: [],
          tags: [],
          frontmatter: {},
        },
      ],
    });
  }

  it("limit이 기본 풀보다 크면 어휘 31위 이후도 융합에 참여한다", async () => {
    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), makeAlignedClient());
    indexer.deserialize(makeWidePayload());

    const result = await indexer.search("키워드", 40);

    // 어휘 33위 노트다. 풀이 30으로 고정돼 있으면 결과에 들어올 통로가 없다.
    expect(result.items.map((i) => i.path)).toContain("zzz.md");
  });

  it("limit이 기본 풀보다 작으면 기본 풀을 유지한다", async () => {
    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), makeAlignedClient());
    indexer.deserialize(makeWidePayload());

    // limit=5여도 어휘는 넉넉히 뽑아야 융합에 쓸 재료가 생긴다.
    const result = await indexer.search("키워드", 5);

    expect(result.items).toHaveLength(5);
  });
});

describe("VaultIndexer 필터 후 임베딩 0개 → 키워드 폴백", () => {
  /** 임베딩 있는 노트와 없는 노트를 폴더로 나눠 담은 페이로드. */
  function makeMixedPayload(): string {
    return JSON.stringify({
      schemaVersion: 1,
      entries: [
        {
          path: "Dense/a.md",
          embedding: [0.1, 0.2, 0.3],
          lastModified: 1000,
          title: "벡터 있는 노트",
          excerpt: "발췌",
          searchText: "키워드 본문",
          chunks: [{ index: 0, text: "키워드 본문", embedding: [0.1, 0.2, 0.3] }],
          outlinks: [],
          backlinks: [],
          tags: [],
          frontmatter: {},
        },
        {
          path: "Sparse/b.md",
          embedding: [],
          lastModified: 1000,
          title: "벡터 없는 노트",
          excerpt: "발췌",
          searchText: "키워드 본문",
          chunks: [],
          outlinks: [],
          backlinks: [],
          tags: [],
          frontmatter: {},
        },
      ],
    });
  }

  it("필터가 미색인 노트만 남기면 키워드 폴백으로 결과를 낸다", async () => {
    const client = makeClient();
    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), client);
    indexer.deserialize(makeMixedPayload());

    client.getEmbedding.mockClear();

    const result = await indexer.search("키워드", 10, { folder: "Sparse" });

    // 빈 결과가 아니라 키워드로 찾아야 한다.
    expect(result.usedKeywordFallback).toBe(true);
    expect(result.items.map((i) => i.path)).toEqual(["Sparse/b.md"]);
    // 폴백 경로는 쿼리 임베딩을 만들지 않는다.
    expect(client.getEmbedding).not.toHaveBeenCalled();
  });

  it("필터가 색인된 노트를 남기면 벡터 경로를 그대로 쓴다", async () => {
    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), makeClient());
    indexer.deserialize(makeMixedPayload());

    const result = await indexer.search("키워드", 10, { folder: "Dense" });

    expect(result.usedKeywordFallback).toBeUndefined();
    expect(result.items.map((i) => i.path)).toEqual(["Dense/a.md"]);
  });
});

describe("VaultIndexer limit 기본값 검증", () => {
  // limit 인자를 생략하면 기본 10이 적용되어 결과는 최대 10개로 제한된다 (Req 6.6).
  it("limit 미지정 시 기본 10이 적용되어 후보가 10개를 초과해도 최대 10개만 반환한다", async () => {
    // 임베딩 보유 노트 15개, depth=0 → 시드 = min(10, 15) = 10 (벡터 검색 topK=10 상한)
    const indexer = await buildPopulatedIndexer(15);

    // limit 인자 없이 호출 → 기본값 10 적용
    const result = await indexer.search("쿼리 텍스트");

    expect(result.items.length).toBe(10);
    expect(result.items.length).toBeLessThanOrEqual(10);
    // 유효 쿼리이므로 무효/폴백 표시는 없어야 한다
    expect(result.invalidQuery).toBeUndefined();
    expect(result.usedKeywordFallback).toBeUndefined();
  });
});

describe("VaultIndexer 후보 0개 빈 결과 검증", () => {
  // 빈 인덱스에서 검색하면 후보가 0개이므로 빈 결과를 반환하고 예외를 던지지 않는다 (Req 6.9).
  it("빈 인덱스 검색은 예외 없이 빈 결과를 반환한다", async () => {
    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), makeClient());
    expect(indexer.size).toBe(0);

    const result = await indexer.search("아무 쿼리");

    expect(result.items).toEqual([]);
    // 빈 인덱스 경로는 무효 쿼리도 폴백도 아니다
    expect(result.invalidQuery).toBeUndefined();
    expect(result.usedKeywordFallback).toBeUndefined();
  });
});

describe("VaultIndexer 빈 그래프/청크 엔트리 검색 무예외 검증", () => {
  // 레거시(버전 없는 배열) 인덱스 — chunks/outlinks/backlinks가 없는 항목.
  // 마이그레이션 후 빈 배열로 보정되며, 레거시 노트 단위 embedding으로 벡터 검색이 동작한다 (Req 8.2~8.4).
  it("레거시 배열 인덱스(빈 그래프/청크) 검색은 예외 없이 GraphRagResult를 반환한다", async () => {
    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), makeClient());

    // 최상위 배열(버전 없음) → 레거시 마이그레이션 경로.
    // 레거시 embedding이 존재하므로 useEmbeddings=true → 벡터 + 그래프 순회(depth 기본 1) 경로를 탄다.
    // outlinks/backlinks가 비어 있어도 그래프 순회가 예외 없이 빈 이웃을 반환해야 한다.
    const legacyPayload = JSON.stringify([
      { path: "a.md", embedding: [0.1, 0.2, 0.3], lastModified: 1000, title: "노트 A", excerpt: "발췌 A" },
      { path: "b.md", embedding: [0.4, 0.5, 0.6], lastModified: 1000, title: "노트 B", excerpt: "발췌 B" },
    ]);
    indexer.deserialize(legacyPayload);
    expect(indexer.size).toBe(2);

    // 검색이 예외 없이 완료되고 GraphRagResult(items 배열 보유)를 반환해야 한다
    const result = await indexer.search("쿼리 텍스트");

    expect(Array.isArray(result.items)).toBe(true);
    // 레거시 embedding 기반 벡터 검색이 동작하므로 후보가 산출된다
    expect(result.items.length).toBeGreaterThan(0);
    // 그래프 필드가 비어 있어도 모든 결과가 정상 형태를 갖는다
    for (const item of result.items) {
      expect(typeof item.path).toBe("string");
      expect(typeof item.combinedScore).toBe("number");
    }
  });

  // 버전 포함 객체 형태이지만 chunks/outlinks/backlinks가 빈 항목도 무예외로 처리되어야 한다.
  it("빈 청크/그래프 필드를 가진 버전 포함 인덱스 검색은 예외를 던지지 않는다", async () => {
    const indexer = new VaultIndexer(makeApp(makeTFile("note.md")), makeClient());

    // embedding 없음 + 빈 청크/그래프 → 키워드 폴백 경로지만, 어떤 경로든 예외 없이 결과를 반환해야 한다
    indexer.deserialize(
      makeEmbeddingLessPayload([
        { path: "a.md", title: "노트 A", searchText: "노트 a\n본문" },
      ])
    );

    await expect(indexer.search("노트")).resolves.toBeDefined();
  });
});

// ============================================
// 하이브리드 융합: dense가 놓친 정확 일치를 어휘가 살린다
// ============================================
/**
 * dense 검색의 알려진 실패를 인덱서 수준에서 재현한다.
 *
 * 시나리오: 질의 문자열이 그대로 들어 있는 노트가 딱 하나 있는데, 임베딩 유사도는
 * 낮아서 MIN_COMBINED_SCORE(0.55) 임계값에서 아예 탈락한다. 에러 코드·함수명처럼
 * 표기가 특이한 문자열에서 실제로 일어나는 일이다.
 *
 * 융합 전에는 이 노트가 결과에 없었다 — 어휘 검색은 "임베딩이 아예 없을 때"의
 * 폴백으로만 돌았기 때문이다.
 */
describe("VaultIndexer 하이브리드 융합", () => {
  const TERM = "CrashLoopBackOff";
  /** 이 표시가 있는 본문만 질의 벡터와 직교하는 임베딩을 받는다. */
  const FAR_MARKER = "쿠버네티스";

  const CONTENTS: Record<string, string> = {
    "ops/k8s.md": `# 운영\n${FAR_MARKER} 파드가 ${TERM} 상태로 재시작을 반복합니다.`,
    "misc/a.md": "# 메모 A\n일반적인 메모입니다.",
    "misc/b.md": "# 메모 B\n또 다른 메모입니다.",
    "misc/c.md": "# 메모 C\n세 번째 메모입니다.",
  };

  function makeMultiApp(): ConstructorParameters<typeof VaultIndexer>[0] {
    const files = Object.keys(CONTENTS).map((p) => makeTFile(p));
    return {
      vault: {
        getMarkdownFiles: () => files,
        cachedRead: async (f: TFile) => CONTENTS[f.path] ?? "",
        getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null,
      },
    } as unknown as ConstructorParameters<typeof VaultIndexer>[0];
  }

  /**
   * FAR_MARKER가 있는 본문은 [0,1], 나머지는 [1,0]을 준다.
   * 질의 "CrashLoopBackOff"에는 마커가 없으므로 [1,0] — 즉 정답 노트와 코사인 0이다.
   * 정규화하면 (0+1)/2 = 0.5로 MIN_COMBINED_SCORE(0.55) 아래라 dense에서 탈락한다.
   */
  function makeSplitClient(): ConstructorParameters<typeof VaultIndexer>[1] {
    return {
      getEmbedding: vi.fn(async (text: string) =>
        text.includes(FAR_MARKER) ? [0, 1] : [1, 0]
      ),
    } as unknown as ConstructorParameters<typeof VaultIndexer>[1];
  }

  async function buildIndexer(): Promise<VaultIndexer> {
    const indexer = new VaultIndexer(makeMultiApp(), makeSplitClient());
    for (const path of Object.keys(CONTENTS)) {
      const file = makeTFile(path);
      await indexer.indexFile(file);
    }
    expect(indexer.size).toBe(4);
    return indexer;
  }

  it("정확 일치 노트를 결과에 올리고 하이브리드를 표시한다", async () => {
    const indexer = await buildIndexer();

    const result = await indexer.search(TERM, 5);

    // 융합 전이라면 이 노트는 임계값 탈락으로 결과에 없었다.
    expect(result.items.map((i) => i.path)).toContain("ops/k8s.md");
    expect(result.usedHybrid).toBe(true);
    // 임베딩이 정상이므로 폴백 경로를 탄 것이 아니다.
    expect(result.usedKeywordFallback).toBeUndefined();
  });

  it("어휘로만 잡힌 노트는 시드로 표기되고 벡터 점수는 0이다", async () => {
    const indexer = await buildIndexer();

    const hit = (await indexer.search(TERM, 5)).items.find((i) => i.path === "ops/k8s.md");

    expect(hit).toBeDefined();
    expect(hit?.isSeed).toBe(true);
    expect(hit?.hop).toBe(0);
    expect(hit?.seedPath).toBeNull();
    expect(hit?.vectorScore).toBe(0);
  });

  it("combinedScore는 최고점을 1.0으로 정규화한다", async () => {
    const indexer = await buildIndexer();

    const items = (await indexer.search(TERM, 5)).items;

    // RRF 원점수(0.016 등)를 그대로 실으면 "관련도 1.6%"로 오해를 만든다.
    expect(items[0].combinedScore).toBeCloseTo(1);
    for (const item of items) {
      expect(item.combinedScore).toBeGreaterThan(0);
      expect(item.combinedScore).toBeLessThanOrEqual(1);
    }
    // 내림차순이 유지된다.
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].combinedScore).toBeGreaterThanOrEqual(items[i].combinedScore);
    }
  });

  it("어휘 일치가 없는 질의는 dense 결과와 순서가 같다(융합이 무해하다)", async () => {
    const indexer = await buildIndexer();

    // 어떤 노트에도 없는 단어 → 어휘 목록이 비고 융합은 통과 동작이 된다.
    const result = await indexer.search("존재하지않는단어xyz", 5);

    expect(result.usedHybrid).toBeUndefined();
  });

  it("limit을 초과해 반환하지 않는다", async () => {
    const indexer = await buildIndexer();

    expect((await indexer.search(TERM, 2)).items).toHaveLength(2);
  });
});
