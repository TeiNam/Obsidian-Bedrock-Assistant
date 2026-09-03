import { describe, it, expect, vi } from "vitest";
import { VaultIndexer } from "./vault-indexer";
import { TFile } from "obsidian";
import type { MetadataSource } from "./graph-rag/graph-extractor";

// ============================================
// 인덱스 수명주기 회귀 테스트 (교차 리뷰 2차)
// ============================================
// Codex 리뷰에서 확인된 두 결함을 고정한다.
//  1) 런타임 임베딩 모델 변경 시 기존 벡터가 계속 사용되고, 다음 저장에서 새 시그니처로
//     기록되어 재시작 후에도 감지되지 않는다(같은 차원의 다른 모델이면 조용한 오답).
//  2) buildEntry(임베딩 호출 포함) 진행 중 삭제·이동된 노트가 완료 시점의 index.set으로
//     부활해, 지운 민감 내용이 검색에 다시 남는다.

function makeTFile(path: string, mtime = 1000): TFile {
  const file = new TFile();
  file.path = path;
  file.basename = path.replace(/\.md$/, "");
  file.stat = { mtime, ctime: mtime, size: 100 } as unknown as TFile["stat"];
  return file;
}

function makeApp(files: TFile[], contents: Map<string, string>) {
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (f: TFile) => contents.get(f.path) ?? "",
      getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null,
    },
  } as unknown as ConstructorParameters<typeof VaultIndexer>[0];
}

function makeClient(dimension = 3) {
  return {
    getEmbedding: vi.fn(async () => new Array(dimension).fill(0.5)),
  } as unknown as ConstructorParameters<typeof VaultIndexer>[1];
}

describe("런타임 임베딩 모델 변경", () => {
  it("시그니처가 런타임에 바뀌면 즉시 벡터를 폐기한다", async () => {
    const file = makeTFile("note.md");
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    indexer.setEmbeddingSignature("bedrock:titan-v2");
    await indexer.indexFile(file);
    expect(indexer.getEntries()[0].chunks?.[0].embedding.length).toBeGreaterThan(0);

    // 사용자가 설정에서 임베딩 모델을 바꾼다(차원은 우연히 같을 수 있다).
    indexer.setEmbeddingSignature("openai:text-embedding-3-large");

    // 핵심: 재시작을 기다리지 않고 즉시 무효화되어야 한다.
    expect(indexer.hasStaleEmbeddings).toBe(true);
    const entry = indexer.getEntries()[0];
    expect(entry.chunks?.every((c) => c.embedding.length === 0)).toBe(true);
    expect(entry.embedding).toEqual([]);
    expect(entry.needsReindex).toBe(true);
    // lastModified는 실제 수정 시각을 유지한다(emerge의 최근 노트 선별 보호).
    expect(entry.lastModified).toBe(1000);
  });

  it("같은 시그니처를 다시 주입하면 벡터를 유지한다", async () => {
    const file = makeTFile("note.md");
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    indexer.setEmbeddingSignature("bedrock:titan-v2");
    await indexer.indexFile(file);
    // 설정 저장마다 같은 값이 재주입되므로 무효화되면 안 된다.
    indexer.setEmbeddingSignature("bedrock:titan-v2");

    expect(indexer.hasStaleEmbeddings).toBe(false);
    expect(indexer.getEntries()[0].chunks?.[0].embedding.length).toBeGreaterThan(0);
  });

  it("최초 주입(이전 값 없음)은 무효화하지 않는다", async () => {
    const file = makeTFile("note.md");
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    await indexer.indexFile(file);
    indexer.setEmbeddingSignature("bedrock:titan-v2");

    expect(indexer.hasStaleEmbeddings).toBe(false);
    expect(indexer.getEntries()[0].chunks?.[0].embedding.length).toBeGreaterThan(0);
  });

  it("무효화 후 검색은 키워드 폴백 + stale 경고를 반환한다", async () => {
    const file = makeTFile("note.md");
    const contents = new Map([["note.md", "# 노트\n검색어 포함 본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    indexer.setEmbeddingSignature("bedrock:titan-v2");
    await indexer.indexFile(file);
    indexer.setEmbeddingSignature("gemini:text-embedding-004");

    const result = await indexer.search("검색어", 10);
    expect(result.usedKeywordFallback).toBe(true);
  });
});

describe("인덱싱 도중 삭제: 삭제된 노트가 부활하지 않는다", () => {
  it("buildEntry 진행 중 removeFile되면 완료 후에도 기록되지 않는다", async () => {
    const file = makeTFile("secret.md");
    const contents = new Map([["secret.md", "# 비밀\n민감한 내용"]]);

    // 임베딩 호출 중에 사용자가 노트를 삭제하는 상황을 시뮬레이션한다.
    let indexer!: VaultIndexer;
    const client = {
      getEmbedding: vi.fn(async () => {
        // 이 시점에 삭제 이벤트가 발생한다.
        indexer.removeFile("secret.md");
        return [0.1, 0.2, 0.3];
      }),
    } as unknown as ConstructorParameters<typeof VaultIndexer>[1];

    indexer = new VaultIndexer(makeApp([file], contents), client);
    await indexer.indexFile(file);

    // 핵심: 완료된 작업이 삭제된 경로를 되살리면 지운 민감 내용이 계속 검색된다.
    expect(indexer.size).toBe(0);
  });

  it("삭제 후 같은 경로로 복원하면 즉시 인덱싱된다", async () => {
    // 삭제 표식을 불린으로 두면 복원 후 첫 indexFile 결과까지 폐기되고, 그 노트는 다음
    // 수정이 있을 때까지 검색에서 사라진다. 삭제는 **이 작업이 시작된 뒤**에 일어났을
    // 때만 폐기 사유다.
    const file = makeTFile("note.md");
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    indexer.removeFile("note.md");
    await indexer.indexFile(file);

    expect(indexer.size).toBe(1);
  });

  it("인덱싱 도중 삭제되면 기록하지 않는다", async () => {
    // 삭제된 노트가 임베딩 완료 시점의 index.set으로 부활해 민감 내용이 검색에 남는 것을
    // 막는 것이 원래 목적이다. 그 보장은 유지돼야 한다.
    const file = makeTFile("note.md");
    const contents = new Map([["note.md", "# 노트\n본문"]]);

    let indexer: VaultIndexer;
    const client = {
      // buildEntry가 임베딩을 기다리는 사이에 삭제가 들어온 상황을 만든다.
      getEmbedding: vi.fn(async () => {
        indexer.removeFile("note.md");
        return [0.5, 0.5, 0.5];
      }),
    } as unknown as ConstructorParameters<typeof VaultIndexer>[1];

    indexer = new VaultIndexer(makeApp([file], contents), client);
    await indexer.indexFile(file);

    expect(indexer.size).toBe(0);
  });

  it("본문을 읽는 도중 삭제되면 기록하지 않는다", async () => {
    // 세대를 첫 await **뒤에** 잡으면 cachedRead 도중 삭제된 노트를 되살린다 — 삭제된
    // 민감 내용이 검색에 남는다. 임베딩 도중 삭제와 같은 보장이어야 한다.
    const file = makeTFile("note.md");

    let indexer: VaultIndexer;
    const app = {
      vault: {
        getMarkdownFiles: () => [file],
        cachedRead: async () => {
          indexer.removeFile("note.md");
          return "# 노트\n본문";
        },
        getAbstractFileByPath: (p: string) => (p === file.path ? file : null),
      },
    } as unknown as ConstructorParameters<typeof VaultIndexer>[0];

    indexer = new VaultIndexer(app, makeClient());
    await indexer.indexFile(file);

    expect(indexer.size).toBe(0);
  });

  it("복원 후 다시 삭제되면 그 작업도 취소된다", async () => {
    // 세대 번호가 누적되므로 두 번째 사이클도 같게 동작해야 한다.
    const file = makeTFile("note.md");
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    indexer.removeFile("note.md");
    await indexer.indexFile(file);
    expect(indexer.size).toBe(1);

    indexer.removeFile("note.md");
    expect(indexer.size).toBe(0);
    file.stat = { ...file.stat, mtime: 2000 } as TFile["stat"];
    await indexer.indexFile(file);
    expect(indexer.size).toBe(1);
  });
});

// ============================================
// 그래프 메타데이터만 갱신
// ============================================
/**
 * A에 `[[B]]`를 추가하면 B의 mtime은 바뀌지 않는다. `indexFile`은 `lastModified >= mtime`
 * 이면 즉시 반환하므로 B의 backlinks가 영구히 낡고, B에서 시작한 그래프 순회와 고아·스텁
 * 판정이 새 링크를 계속 못 본다. 그리고 B의 본문은 그대로이므로 재임베딩은 낭비다.
 */
describe("VaultIndexer.refreshGraphMetadata", () => {
  /** A → B 링크가 이미 해석된 MetadataSource. */
  function makeSource(): MetadataSource {
    return {
      resolvedLinks: { "A.md": { "B.md": 1 } },
      getBacklinks: (path: string) => (path === "B.md" ? ["A.md"] : []),
      getFileCache: () => ({ tags: ["#work"], frontmatter: { k: "v" } }),
      fileExists: () => true,
    } as unknown as MetadataSource;
  }

  /** 링크 정보가 비어 있는 기존 엔트리를 심는다. */
  function seed(indexer: VaultIndexer): void {
    indexer.deserialize(
      JSON.stringify({
        schemaVersion: 2,
        entries: [
          {
            path: "B.md",
            embedding: [1, 2, 3],
            lastModified: 5000,
            title: "B",
            excerpt: "발췌",
            searchText: "b 본문",
            chunks: [{ index: 0, text: "본문", embedding: [1, 2, 3], charStart: 0 }],
            outlinks: [],
            backlinks: [],
            tags: [],
            frontmatter: {},
          },
        ],
      })
    );
  }

  it("백링크·태그·프론트매터를 다시 뽑는다", () => {
    const indexer = new VaultIndexer(makeApp([], new Map()), makeClient());
    seed(indexer);
    indexer.setMetadataSource(makeSource());

    indexer.refreshGraphMetadata("B.md");

    const entry = indexer.getEntries().find((e) => e.path === "B.md");
    expect(entry?.backlinks).toEqual(["A.md"]);
    expect(entry?.tags).toEqual(["work"]);
    expect(entry?.frontmatter).toEqual({ k: "v" });
  });

  it("임베딩·청크·mtime은 건드리지 않는다", () => {
    // 본문이 그대로인 노트를 다시 임베딩하는 것은 순수한 비용이다.
    const indexer = new VaultIndexer(makeApp([], new Map()), makeClient());
    seed(indexer);
    indexer.setMetadataSource(makeSource());

    indexer.refreshGraphMetadata("B.md");

    const entry = indexer.getEntries().find((e) => e.path === "B.md");
    expect(entry?.embedding).toEqual([1, 2, 3]);
    expect(entry?.chunks?.[0].embedding).toEqual([1, 2, 3]);
    expect(entry?.lastModified).toBe(5000);
  });

  it("인덱스에 없는 노트는 만들지 않는다", () => {
    // 임베딩 없는 반쪽 엔트리를 만들면 검색에서 비교 불가 후보로 섞인다.
    const indexer = new VaultIndexer(makeApp([], new Map()), makeClient());
    indexer.setMetadataSource(makeSource());

    indexer.refreshGraphMetadata("없는노트.md");

    expect(indexer.size).toBe(0);
  });

  it("metadataSource가 없으면 아무것도 하지 않는다", () => {
    const indexer = new VaultIndexer(makeApp([], new Map()), makeClient());
    seed(indexer);

    indexer.refreshGraphMetadata("B.md");

    expect(indexer.getEntries()[0].backlinks).toEqual([]);
  });
});
