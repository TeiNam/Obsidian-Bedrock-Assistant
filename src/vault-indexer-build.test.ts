import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { VaultIndexer } from "./vault-indexer";
import { TFile } from "obsidian";
import type { MetadataSource } from "./graph-rag/graph-extractor";
import type { VaultIndexEntry } from "./types";

// 테스트 대상 노트 경로 (단일 노트를 반복 재인덱싱하여 링크 교체를 검증)
const NOTE_PATH = "note.md";

// TFile 인스턴스를 생성하는 헬퍼 (mtime 지정 가능)
function makeTFile(path: string, mtime: number): TFile {
  const file = new TFile();
  file.path = path;
  file.basename = path.replace(/\.md$/, "");
  file.stat = { mtime, ctime: mtime, size: 100 } as unknown as TFile["stat"];
  return file;
}

// 단일 노트만 가진 최소 App 모킹 (cachedRead는 비어 있지 않은 본문 반환)
function makeApp(file: TFile): App_ {
  return {
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => "# 노트\n본문 내용",
      getAbstractFileByPath: (p: string) => (p === file.path ? file : null),
    },
  };
}
type App_ = ConstructorParameters<typeof VaultIndexer>[0];

// 고정 벡터를 반환하는 가짜 IAiClient (동기적으로 빠르게 resolve)
function makeClient(): ConstructorParameters<typeof VaultIndexer>[1] {
  return {
    getEmbedding: async () => [0.1, 0.2, 0.3],
  } as unknown as ConstructorParameters<typeof VaultIndexer>[1];
}

// 메타데이터 상태(아웃링크/백링크 집합)를 표현하는 타입
interface MetaState {
  outlinks: string[];
  backlinks: string[];
}

// 현재 상태를 반영하는 MetadataSource 어댑터를 생성한다.
// - resolvedLinks[NOTE_PATH]의 키 = 아웃링크 대상
// - getBacklinks(NOTE_PATH) = 백링크 목록
// - fileExists는 항상 true → 모든 아웃링크 대상이 볼트 내 존재한다고 간주(dangling 제외 없음)
// - getFileCache는 null → 프론트매터/태그 없음(링크 교체 검증에 무관)
function makeMetadataSource(state: MetaState): MetadataSource {
  return {
    resolvedLinks: {
      [NOTE_PATH]: Object.fromEntries(state.outlinks.map((o) => [o, 1])),
    },
    getBacklinks: (p: string) => (p === NOTE_PATH ? state.backlinks : []),
    getFileCache: () => null,
    fileExists: () => true,
  };
}

// serialize() 출력에서 특정 경로의 Index_Entry를 추출한다.
// (현재 serialize는 배열을 반환하지만, 향후 { schemaVersion, entries } 형태도 안전하게 처리)
function getEntry(indexer: VaultIndexer, path: string): VaultIndexEntry | undefined {
  const parsed = JSON.parse(indexer.serialize());
  const entries: VaultIndexEntry[] = Array.isArray(parsed) ? parsed : parsed.entries;
  return entries.find((e) => e.path === path);
}

// 링크 경로 생성기: 비어 있지 않은 짧은 문자열에 .md 확장자를 붙인다.
const linkPathArb = fc.string({ minLength: 1, maxLength: 10 }).map((s) => `${s}.md`);

// 메타데이터 상태 생성기: 임의의 아웃링크/백링크 목록(중복 포함 가능)
const metaStateArb: fc.Arbitrary<MetaState> = fc.record({
  outlinks: fc.array(linkPathArb, { maxLength: 12 }),
  backlinks: fc.array(linkPathArb, { maxLength: 12 }),
});

describe("VaultIndexer 재인덱싱 링크 교체", () => {
  // Feature: graph-rag-knowledge-base, Property 2: 재인덱싱은 링크 목록을 새 상태로 전체 교체한다
  // **Validates: Requirements 1.4**
  it("재인덱싱하면 outlinks/backlinks가 새 상태로 완전히 교체되고 이전 상태 항목이 잔존하지 않는다", async () => {
    await fc.assert(
      fc.asyncProperty(metaStateArb, metaStateArb, async (stateA, stateB) => {
        const file = makeTFile(NOTE_PATH, 1000);
        const indexer = new VaultIndexer(makeApp(file), makeClient());

        // 1) 초기 메타데이터 상태 A로 인덱싱
        indexer.setMetadataSource(makeMetadataSource(stateA));
        file.stat.mtime = 1000;
        await indexer.indexFile(file);

        // 2) 새 메타데이터 상태 B로 재인덱싱 (mtime 증가로 스킵 방지)
        indexer.setMetadataSource(makeMetadataSource(stateB));
        file.stat.mtime = 2000;
        await indexer.indexFile(file);

        const entry = getEntry(indexer, NOTE_PATH);
        expect(entry).toBeDefined();

        // extractMetadata는 중복을 제거하므로 집합으로 비교한다.
        const expectedOut = new Set(stateB.outlinks);
        const expectedBack = new Set(stateB.backlinks);
        const actualOut = new Set(entry!.outlinks ?? []);
        const actualBack = new Set(entry!.backlinks ?? []);

        // 새 상태 B와 정확히 일치한다.
        expect(actualOut).toEqual(expectedOut);
        expect(actualBack).toEqual(expectedBack);

        // 이전 상태 A에만 존재하던 항목(B에 없는 것)은 잔존하지 않는다.
        for (const item of stateA.outlinks) {
          if (!expectedOut.has(item)) {
            expect(actualOut.has(item)).toBe(false);
          }
        }
        for (const item of stateA.backlinks) {
          if (!expectedBack.has(item)) {
            expect(actualBack.has(item)).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("VaultIndexer 키워드 검색 텍스트 태그 포함", () => {
  // extractMetadata의 태그 정규화를 동일하게 재현한다.
  // (선행 '#' 일괄 제거 → 좌우 공백 제거 → 빈 값 제거 → 순서 유지 중복 제거)
  function normalizeTags(raw: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const t of raw.map((s) => s.replace(/^#+/, "").trim()).filter((s) => s.length > 0)) {
      if (!seen.has(t)) {
        seen.add(t);
        result.push(t);
      }
    }
    return result;
  }

  // 인라인 태그를 getFileCache로 노출하는 MetadataSource (링크/프론트매터 없음).
  // fileExists는 의미 없으므로 true, resolvedLinks/backlinks는 비워 태그 경로만 검증한다.
  function makeTagMetadataSource(inlineTags: string[]): MetadataSource {
    return {
      resolvedLinks: {},
      getBacklinks: () => [],
      getFileCache: (p: string) => (p === NOTE_PATH ? { tags: inlineTags } : null),
      fileExists: () => true,
    };
  }

  // 태그 본문 문자 집합: 소/대문자 영문, 숫자, 일부 기호, 한글.
  // toLowerCase가 길이를 바꾸지 않는 안전한 문자만 사용한다('#'는 prefix로만 부여).
  const tagBodyChars = "abcdefABCDEF0123_-가나다".split("");
  const tagBodyArb = fc
    .array(fc.constantFrom(...tagBodyChars), { minLength: 1, maxLength: 8 })
    .map((chars) => chars.join(""));
  // 선행 '#' 0~2개 + 본문 → stripTagHash 경로와 중복 정규화를 함께 자극한다.
  const rawTagArb = fc.tuple(fc.constantFrom("", "#", "##"), tagBodyArb).map(([h, b]) => h + b);
  const rawTagsArb = fc.array(rawTagArb, { maxLength: 12 });

  // Feature: graph-rag-knowledge-base, Property 5: 키워드 검색 텍스트는 모든 태그를 공백으로 구분해 포함한다
  // **Validates: Requirements 2.3**
  it("생성된 searchText는 정규화된 모든 태그를 단일 공백으로 구분해 포함한다", async () => {
    await fc.assert(
      fc.asyncProperty(rawTagsArb, async (rawTags) => {
        const file = makeTFile(NOTE_PATH, 1000);
        const indexer = new VaultIndexer(makeApp(file), makeClient());
        indexer.setMetadataSource(makeTagMetadataSource(rawTags));

        await indexer.indexFile(file);

        const entry = getEntry(indexer, NOTE_PATH);
        expect(entry).toBeDefined();
        const searchText = entry!.searchText;
        expect(searchText).toBeDefined();

        // extractMetadata와 동일한 정규화 결과가 buildEntry의 태그 목록이 된다.
        const expected = normalizeTags(rawTags);

        // searchText는 buildEntry에서 소문자로 정규화되어 저장된다.
        // 태그가 하나라도 있으면, 공백으로 연결된 태그 묶음이 그대로 포함되어야 한다(Req 2.3).
        if (expected.length > 0) {
          const joined = expected.join(" ").toLowerCase();
          expect(searchText!).toContain(joined);

          // 각 태그(소문자)도 개별적으로 포함된다.
          for (const tag of expected) {
            expect(searchText!).toContain(tag.toLowerCase());
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
