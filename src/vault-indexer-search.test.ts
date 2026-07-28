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
