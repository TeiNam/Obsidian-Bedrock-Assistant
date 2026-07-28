// VaultIndexer 직렬화/역직렬화 속성 테스트
// tasks 8.9 / 8.10 / 8.11이 이 파일을 공유한다. (현재 파일에는 Property 23만 구현)
import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { VaultIndexer } from "./vault-indexer";
import { CURRENT_INDEX_SCHEMA_VERSION } from "./types";
import type { VaultIndexEntry, IndexChunk } from "./types";

// serialize/deserialize는 app/client를 사용하지 않으므로 생성자 충족용 최소 스텁만 제공한다.
function makeApp(): ConstructorParameters<typeof VaultIndexer>[0] {
  return {
    vault: {
      getMarkdownFiles: () => [],
      cachedRead: async () => "",
      getAbstractFileByPath: () => null,
    },
  } as unknown as ConstructorParameters<typeof VaultIndexer>[0];
}

function makeClient(): ConstructorParameters<typeof VaultIndexer>[1] {
  return {
    getEmbedding: async () => [0.1, 0.2, 0.3],
  } as unknown as ConstructorParameters<typeof VaultIndexer>[1];
}

function makeIndexer(): VaultIndexer {
  return new VaultIndexer(makeApp(), makeClient());
}

// === 생성기 ===

// JSON 라운드트립이 무손실인 유한 실수 (NaN/Infinity 제외 → JSON.stringify가 null로 바꾸지 않음)
//
// -0도 제외한다. JSON에는 부호 있는 0이 없어 `JSON.stringify(-0) === "0"`이므로
// -0은 +0으로 돌아온다. 즉 -0은 이 생성기가 약속하는 "무손실" 값이 아니다.
// (`v === 0`은 -0에도 true이므로 이 한 줄로 두 0을 +0으로 정규화한다.)
const finiteNumberArb = fc
  .double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true })
  .map((v) => (v === 0 ? 0 : v));

// 임베딩 벡터 (숫자 배열, 빈 배열 허용)
const embeddingArb = fc.array(finiteNumberArb, { maxLength: 4 });

// 단일 청크 생성기 (embedFailed는 선택적)
const chunkArb: fc.Arbitrary<IndexChunk> = fc
  .record({
    index: fc.nat({ max: 50 }),
    text: fc.string({ maxLength: 30 }),
    embedding: embeddingArb,
    embedFailed: fc.option(fc.boolean(), { nil: undefined }),
  })
  .map(({ index, text, embedding, embedFailed }) => {
    const chunk: IndexChunk = { index, text, embedding };
    // buildEntry와 동일하게 실패한 경우에만 embedFailed 플래그를 기록한다.
    if (embedFailed) chunk.embedFailed = true;
    return chunk;
  });

// 링크 경로 생성기 (비어 있지 않은 문자열 + .md)
const linkPathArb = fc.string({ minLength: 1, maxLength: 10 }).map((s) => `${s}.md`);

// 프론트매터 값 생성기 (JSON 직렬화 가능한 단순 값)
const frontmatterValueArb = fc.oneof(
  fc.string({ maxLength: 20 }),
  fc.integer(),
  fc.boolean()
);

// VaultIndexEntry 생성기 (신규 필드를 모두 포함하여 정규화로 변형되지 않도록 함)
const entryArb: fc.Arbitrary<VaultIndexEntry> = fc.record({
  path: linkPathArb,
  embedding: embeddingArb,
  lastModified: fc.nat(),
  title: fc.string({ maxLength: 20 }),
  excerpt: fc.string({ maxLength: 30 }),
  searchText: fc.string({ maxLength: 30 }),
  chunks: fc.array(chunkArb, { maxLength: 3 }),
  outlinks: fc.uniqueArray(linkPathArb, { maxLength: 4 }),
  backlinks: fc.uniqueArray(linkPathArb, { maxLength: 4 }),
  tags: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 4 }),
  frontmatter: fc.dictionary(fc.string({ maxLength: 10 }), frontmatterValueArb, { maxKeys: 4 }),
});

// 경로가 유일한 Index_Entry 집합 (Map은 path를 키로 사용하므로 중복 경로는 덮어써진다)
const entriesArb = fc.uniqueArray(entryArb, {
  maxLength: 6,
  selector: (e) => e.path,
});

describe("VaultIndexer 직렬화/역직렬화", () => {
  // Feature: graph-rag-knowledge-base, Property 23: 직렬화-역직렬화 라운드트립은 동등성을 보존한다
  it("Property 23: 직렬화-역직렬화 라운드트립은 동등성을 보존한다 (Validates: Requirements 8.1, 8.9)", () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        // 1) 생성한 entries를 버전 포함 형태로 indexerA에 적재한다.
        const payload = JSON.stringify({
          schemaVersion: CURRENT_INDEX_SCHEMA_VERSION,
          entries,
        });
        const indexerA = makeIndexer();
        indexerA.deserialize(payload);

        // 2) indexerA를 직렬화한 뒤 indexerB로 다시 적재한다 (라운드트립).
        const serialized = indexerA.serialize();
        const indexerB = makeIndexer();
        indexerB.deserialize(serialized);

        // 3) 라운드트립 안정성: 재직렬화 결과가 동일해야 한다.
        expect(indexerB.serialize()).toEqual(serialized);
        expect(indexerB.size).toBe(entries.length);

        // 4) schemaVersion 보존 검증 (Req 8.1)
        const parsed = JSON.parse(serialized) as {
          schemaVersion: number;
          entries: VaultIndexEntry[];
        };
        expect(parsed.schemaVersion).toBe(CURRENT_INDEX_SCHEMA_VERSION);

        // 5) 동등성: 각 원본 entry에 대해 chunks/outlinks/backlinks/tags/frontmatter가 일치한다.
        expect(parsed.entries.length).toBe(entries.length);
        for (const original of entries) {
          const restored = parsed.entries.find((e) => e.path === original.path);
          expect(restored).toBeDefined();
          expect(restored!.chunks).toEqual(original.chunks);
          expect(restored!.outlinks).toEqual(original.outlinks);
          expect(restored!.backlinks).toEqual(original.backlinks);
          expect(restored!.tags).toEqual(original.tags);
          expect(restored!.frontmatter).toEqual(original.frontmatter);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// === Property 24 생성기 (레거시 = 버전 없는 배열) ===

// 레거시 Index_Entry: 신규 optional 필드(chunks/outlinks/backlinks/tags/frontmatter)를
// 포함하지 않는다. 버전 없는 기존 직렬화 형식을 재현한다.
interface LegacyEntry {
  path: string;
  embedding: number[];
  lastModified: number;
  title: string;
  excerpt: string;
  searchText?: string;
}

// searchText는 선택적으로만 포함하여 레거시 데이터의 다양성을 표현한다.
const legacyEntryArb: fc.Arbitrary<LegacyEntry> = fc
  .record({
    path: linkPathArb,
    embedding: embeddingArb,
    lastModified: fc.nat(),
    title: fc.string({ maxLength: 20 }),
    excerpt: fc.string({ maxLength: 30 }),
    searchText: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  })
  .map(({ path, embedding, lastModified, title, excerpt, searchText }) => {
    const entry: LegacyEntry = { path, embedding, lastModified, title, excerpt };
    // searchText가 정의된 경우에만 포함하여 레거시 데이터의 필드 누락 패턴을 재현한다.
    if (searchText !== undefined) entry.searchText = searchText;
    return entry;
  });

// 경로가 유일한 레거시 Entry 집합 (Map은 path를 키로 사용하므로 중복 경로는 덮어써진다)
const legacyEntriesArb = fc.uniqueArray(legacyEntryArb, {
  maxLength: 6,
  selector: (e) => e.path,
});

describe("VaultIndexer 레거시 마이그레이션", () => {
  // Feature: graph-rag-knowledge-base, Property 24: 버전 없는 인덱스의 마이그레이션은 기존 값을 보존하고 누락 필드를 빈 값으로 초기화한다
  it("Property 24: 버전 없는 인덱스의 마이그레이션은 기존 값을 보존하고 누락 필드를 빈 값으로 초기화한다 (Validates: Requirements 8.2, 8.3, 8.4)", () => {
    fc.assert(
      fc.property(legacyEntriesArb, (legacyEntries) => {
        // 1) 레거시 형식: 최상위가 JSON 배열이며 { schemaVersion, entries } 래퍼가 없다.
        const legacyJson = JSON.stringify(legacyEntries);

        const indexer = makeIndexer();
        indexer.deserialize(legacyJson);

        // 2) 마이그레이션 후 재직렬화하여 결과를 검사한다.
        const serialized = indexer.serialize();
        const parsed = JSON.parse(serialized) as {
          schemaVersion: number;
          entries: VaultIndexEntry[];
        };

        // 3) schemaVersion이 현재 버전으로 설정된다 (Req 8.2)
        expect(parsed.schemaVersion).toBe(CURRENT_INDEX_SCHEMA_VERSION);
        expect(indexer.size).toBe(legacyEntries.length);
        expect(parsed.entries.length).toBe(legacyEntries.length);

        // 4) 각 레거시 entry에 대해 기존 값 보존 + 누락 필드 빈 값 초기화 검증
        for (const original of legacyEntries) {
          const migrated = parsed.entries.find((e) => e.path === original.path);
          expect(migrated).toBeDefined();

          // 기존 필드 보존 (Req 8.3)
          expect(migrated!.path).toBe(original.path);
          expect(migrated!.embedding).toEqual(original.embedding);
          expect(migrated!.lastModified).toBe(original.lastModified);
          expect(migrated!.title).toBe(original.title);
          expect(migrated!.excerpt).toBe(original.excerpt);
          if (original.searchText !== undefined) {
            expect(migrated!.searchText).toBe(original.searchText);
          }

          // 누락된 그래프/청크 필드는 빈 배열로 초기화 (Req 8.4)
          expect(migrated!.chunks).toEqual([]);
          expect(migrated!.outlinks).toEqual([]);
          expect(migrated!.backlinks).toEqual([]);
          expect(migrated!.tags).toEqual([]);
          // 누락된 frontmatter는 빈 객체로 초기화 (Req 8.4)
          expect(migrated!.frontmatter).toEqual({});
        }
      }),
      { numRuns: 100 }
    );
  });
});

// === task 8.11: 마이그레이션/손상 데이터 예제 기반 단위 테스트 ===
// 손상 JSON 입력 시 기존 인메모리 인덱스 비파괴 + 오류 로그(Req 8.5, 8.6),
// 마이그레이션된 빈 엔트리 검색 무예외(Req 8.7, 8.8)를 구체적인 예제로 검증한다.

// 임베딩을 포함한 유효 엔트리 1건을 담은 버전 포함 직렬화 페이로드 (검색 시 벡터 경로 사용 가능)
function validPayloadWithOneEntry(): string {
  const entry: VaultIndexEntry = {
    path: "notes/alpha.md",
    embedding: [0.1, 0.2, 0.3],
    lastModified: 1000,
    title: "Alpha",
    excerpt: "알파 노트 발췌",
    searchText: "alpha 알파 노트 발췌",
    chunks: [],
    outlinks: [],
    backlinks: [],
    tags: [],
    frontmatter: {},
  };
  return JSON.stringify({ schemaVersion: CURRENT_INDEX_SCHEMA_VERSION, entries: [entry] });
}

describe("VaultIndexer 손상 데이터 비파괴 보존 (단위 테스트)", () => {
  // Req 8.5, 8.6: 손상 JSON 입력 시 기존 인메모리 인덱스를 변경하지 않고 오류만 로그로 남긴다.
  it("손상 JSON 역직렬화는 기존 인메모리 인덱스를 비파괴 보존하고 오류를 로그한다 (Req 8.5, 8.6)", () => {
    const indexer = makeIndexer();

    // 1) 먼저 유효한 인덱스를 적재하고 적재 후 상태(size/serialize)를 기록한다.
    indexer.deserialize(validPayloadWithOneEntry());
    const sizeBefore = indexer.size;
    const serializedBefore = indexer.serialize();
    expect(sizeBefore).toBe(1);

    // 2) console.error 스파이를 설치한 뒤 손상 JSON으로 역직렬화를 시도한다.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      indexer.deserialize("이건 깨진 JSON {{{");

      // 3) 오류가 로그로 기록되어야 한다 (Req 8.5).
      expect(errorSpy).toHaveBeenCalled();

      // 4) 인메모리 인덱스는 변경되지 않아야 한다: size 동일 + serialize 출력 동일 (Req 8.6, 비파괴).
      expect(indexer.size).toBe(sizeBefore);
      expect(indexer.serialize()).toBe(serializedBefore);
    } finally {
      // 다른 테스트에 영향을 주지 않도록 스파이를 복원한다.
      errorSpy.mockRestore();
    }
  });
});

describe("VaultIndexer 마이그레이션 엔트리 검색 무예외 (단위 테스트)", () => {
  // Req 8.7, 8.8: 마이그레이션으로 chunks/graph 필드가 빈 값인 엔트리에 대해서도
  // 검색이 예외 없이 정상적으로 완료되어야 한다.

  // 임베딩을 가진 레거시 엔트리 → 검색 시 벡터 경로(레거시 폴백)로 무예외 완료
  it("임베딩 포함 레거시 엔트리(빈 chunks) 검색은 예외 없이 완료된다 (Req 8.7, 8.8)", async () => {
    const indexer = makeIndexer();
    // 레거시 배열 형식(버전 없음): chunks/outlinks/backlinks/tags/frontmatter 누락
    const legacyJson = JSON.stringify([
      {
        path: "legacy/with-embedding.md",
        embedding: [0.1, 0.2, 0.3],
        lastModified: 1,
        title: "Legacy A",
        excerpt: "레거시 발췌 A",
      },
    ]);
    indexer.deserialize(legacyJson);
    expect(indexer.size).toBe(1);

    // 마이그레이션된 엔트리는 chunks=[] 이지만 레거시 embedding으로 벡터 검색이 가능해야 한다.
    await expect(indexer.search("알파 검색어")).resolves.toBeDefined();
  });

  // 임베딩이 없는 레거시 엔트리 → useEmbeddings=false → 키워드 검색 폴백으로 무예외 완료
  it("임베딩 없는 레거시 엔트리 검색은 키워드 폴백으로 예외 없이 완료된다 (Req 8.7, 8.8)", async () => {
    const indexer = makeIndexer();
    const legacyJson = JSON.stringify([
      {
        path: "legacy/no-embedding.md",
        embedding: [],
        lastModified: 2,
        title: "Legacy B",
        excerpt: "레거시 발췌 B",
        searchText: "legacy b 레거시 발췌",
      },
    ]);
    indexer.deserialize(legacyJson);
    expect(indexer.size).toBe(1);

    // 임베딩이 0개이므로 키워드 검색으로 폴백하며, 어떤 경우에도 예외가 발생하지 않아야 한다.
    await expect(indexer.search("레거시")).resolves.toBeDefined();
  });
});

// ====================================================
// JSON 라운드트립 경계: 부호 있는 0
// ----------------------------------------------------
// 속성 테스트 생성기에서 -0을 제외했으므로, 그 이유를 명시적으로 고정한다.
// 제외를 문서 없이 두면 나중에 누군가 "왜 map이 붙어 있나" 하고 되돌린다.
describe("직렬화 경계: -0", () => {
  it("JSON에는 부호 있는 0이 없어 -0 임베딩은 +0으로 복원된다", () => {
    const indexer = makeIndexer();
    indexer.deserialize(
      JSON.stringify([
        {
          path: "zero.md",
          embedding: [-0, 0, -0.5],
          lastModified: 1,
          title: "Zero",
          excerpt: "",
        },
      ])
    );

    const entry = JSON.parse(indexer.serialize()).entries[0];
    // 값의 크기는 보존되지만 0의 부호는 소실된다(JSON 스펙상 불가피).
    expect(entry.embedding).toEqual([0, 0, -0.5]);
    expect(Object.is(entry.embedding[0], -0)).toBe(false);
    // 코사인 유사도 계산에서 +0과 -0은 동일하게 동작하므로 검색 결과에는 영향이 없다.
  });
});
