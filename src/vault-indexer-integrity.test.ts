import { describe, it, expect, vi } from "vitest";
import { VaultIndexer } from "./vault-indexer";
import { TFile } from "obsidian";
import { selectRecentNotes } from "./second-brain/thinking-tools";

// ============================================
// 인덱스 정합성 회귀 테스트
// ============================================
// 리뷰에서 확인된 결함들을 고정한다.
//  1) 노트를 비우면 이전 본문·임베딩이 인덱스에 영구 잔존해 계속 검색된다
//  2) 임베딩 API 실패가 '성공'으로 확정 저장되어 mtime 스킵으로 영구 재시도 제외
//  3) lastModified를 임베딩 완료 후 캡처해 인덱싱 중 편집분이 유실된다(TOCTOU)
//  4) rename/create 이벤트가 없어 구 경로 엔트리가 잔존한다
//  5) 임베딩 모델 변경(시그니처 불일치) 시 낡은 벡터를 그대로 사용한다

/** TFile 인스턴스 생성 헬퍼. */
function makeTFile(path: string, mtime = 1000): TFile {
  const file = new TFile();
  file.path = path;
  file.basename = path.replace(/\.md$/, "");
  file.stat = { mtime, ctime: mtime, size: 100 } as unknown as TFile["stat"];
  return file;
}

/** 파일별 본문을 제어할 수 있는 App 모킹. */
function makeApp(files: TFile[], contents: Map<string, string>) {
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (f: TFile) => contents.get(f.path) ?? "",
      getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null,
    },
  } as unknown as ConstructorParameters<typeof VaultIndexer>[0];
}

/** 임베딩 클라이언트 모킹. dimension과 실패 동작을 제어한다. */
function makeClient(opts: { dimension?: number; failAfter?: number } = {}) {
  const dimension = opts.dimension ?? 3;
  let calls = 0;
  return {
    getEmbedding: vi.fn(async () => {
      calls++;
      // failAfter 이후 호출은 실패시킨다(첫 호출은 프리플라이트 "test"에 소비됨).
      if (opts.failAfter !== undefined && calls > opts.failAfter) {
        throw new Error("ThrottlingException");
      }
      return new Array(dimension).fill(0.5);
    }),
  } as unknown as ConstructorParameters<typeof VaultIndexer>[1];
}

describe("빈 노트: 이전 내용이 인덱스에 남지 않는다", () => {
  it("노트를 비우면 인덱스 엔트리가 제거된다(indexFile 경로)", async () => {
    const file = makeTFile("secret.md", 1000);
    const contents = new Map([["secret.md", "# 비밀\n민감한 내용"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    await indexer.indexFile(file);
    expect(indexer.size).toBe(1);

    // 사용자가 내용을 지우고 저장한다(mtime 갱신)
    contents.set("secret.md", "   \n\n");
    file.stat = { ...file.stat, mtime: 2000 } as TFile["stat"];
    await indexer.indexFile(file);

    // 핵심: 이전 본문과 임베딩이 검색에 남아 있으면 안 된다
    expect(indexer.size).toBe(0);
  });

  it("노트를 비우면 인덱스 엔트리가 제거된다(indexVault 경로)", async () => {
    const file = makeTFile("secret.md", 1000);
    const contents = new Map([["secret.md", "# 비밀\n민감한 내용"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    await indexer.indexVault();
    expect(indexer.size).toBe(1);

    contents.set("secret.md", "");
    file.stat = { ...file.stat, mtime: 2000 } as TFile["stat"];
    await indexer.indexVault();

    expect(indexer.size).toBe(0);
  });
});

describe("임베딩 실패: 영구 누락되지 않고 재시도 대상으로 남는다", () => {
  it("모든 청크 임베딩이 실패하면 needsReindex로 표시해 다음 인덱싱에서 재시도한다", async () => {
    const file = makeTFile("note.md", 5000);
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    // 프리플라이트("test") 1회만 성공 → 실제 청크 임베딩은 모두 실패
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient({ failAfter: 1 }));

    await indexer.indexVault();

    const entry = indexer.getEntries()[0];
    expect(entry).toBeDefined();
    // 핵심: 재시도 표시가 없으면 mtime 스킵으로 영구히 재시도되지 않는다.
    // lastModified는 실제 수정 시각을 유지해야 한다(최근 노트 선별이 이 값을 읽는다).
    expect(entry.needsReindex).toBe(true);
    expect(entry.lastModified).toBe(5000);
    expect(entry.chunks?.every((c) => c.embedFailed)).toBe(true);
  });

  it("임베딩이 성공하면 정상 mtime을 저장한다", async () => {
    const file = makeTFile("note.md", 5000);
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    await indexer.indexVault();

    expect(indexer.getEntries()[0].lastModified).toBe(5000);
  });
});

describe("TOCTOU: 읽은 시점의 mtime을 저장한다", () => {
  it("임베딩 도중 파일이 수정되어도 읽은 시점 mtime을 기록한다", async () => {
    const file = makeTFile("note.md", 1000);
    const contents = new Map([["note.md", "버전 1"]]);

    // 임베딩 호출 중에 파일이 수정되는 상황을 시뮬레이션한다.
    const client = {
      getEmbedding: vi.fn(async () => {
        file.stat = { ...file.stat, mtime: 9999 } as TFile["stat"];
        return [0.1, 0.2, 0.3];
      }),
    } as unknown as ConstructorParameters<typeof VaultIndexer>[1];

    const indexer = new VaultIndexer(makeApp([file], contents), client);
    await indexer.indexFile(file);

    const entry = indexer.getEntries()[0];
    // 읽은 시점(1000)을 기록해야 한다. 9999를 기록하면 이후 편집분이 스킵된다.
    expect(entry.lastModified).toBe(1000);
  });
});

describe("rename: 구 경로 엔트리가 잔존하지 않는다", () => {
  it("renameFile은 구 경로를 제거하고 새 경로를 인덱싱한다", async () => {
    const oldFile = makeTFile("old.md", 1000);
    const contents = new Map([["old.md", "# 내용\n본문"]]);
    const indexer = new VaultIndexer(makeApp([oldFile], contents), makeClient());

    await indexer.indexFile(oldFile);
    expect(indexer.getEntries().map((e) => e.path)).toEqual(["old.md"]);

    // 이름 변경: 새 경로로 파일이 이동한다
    const newFile = makeTFile("new.md", 1000);
    contents.set("new.md", "# 내용\n본문");
    const indexer2 = indexer;
    await indexer2.renameFile("old.md", newFile);

    const paths = indexer2.getEntries().map((e) => e.path);
    // 핵심: 존재하지 않는 old.md가 검색 결과에 남아서는 안 된다
    expect(paths).toEqual(["new.md"]);
  });
});

describe("임베딩 시그니처: 모델 변경 시 낡은 벡터를 폐기한다", () => {
  it("시그니처가 다르면 벡터를 비우고 재인덱싱 대상으로 표시한다", async () => {
    const file = makeTFile("note.md", 1000);
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    indexer.setEmbeddingSignature("bedrock:titan-v2");
    await indexer.indexFile(file);
    const saved = indexer.serialize();

    // 다른 임베딩 모델로 전환한 새 인덱서에 같은 데이터를 로드한다
    const reloaded = new VaultIndexer(makeApp([file], contents), makeClient());
    reloaded.setEmbeddingSignature("openai:text-embedding-3-large");
    reloaded.deserialize(saved);

    expect(reloaded.hasStaleEmbeddings).toBe(true);
    const entry = reloaded.getEntries()[0];
    // 벡터를 폐기해 무의미한 유사도 계산을 막는다
    expect(entry.embedding).toEqual([]);
    expect(entry.chunks?.every((c) => c.embedding.length === 0)).toBe(true);
    // 재인덱싱 대상으로 표시하되 실제 수정 시각은 보존한다
    expect(entry.needsReindex).toBe(true);
    expect(entry.lastModified).toBe(1000);
  });

  it("시그니처가 같으면 벡터를 그대로 유지한다", async () => {
    const file = makeTFile("note.md", 1000);
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    indexer.setEmbeddingSignature("bedrock:titan-v2");
    await indexer.indexFile(file);
    const saved = indexer.serialize();

    const reloaded = new VaultIndexer(makeApp([file], contents), makeClient());
    reloaded.setEmbeddingSignature("bedrock:titan-v2");
    reloaded.deserialize(saved);

    expect(reloaded.hasStaleEmbeddings).toBe(false);
    expect(reloaded.getEntries()[0].chunks?.[0].embedding.length).toBeGreaterThan(0);
  });

  it("차원 불일치 인덱스로 검색하면 키워드 폴백 + stale 표시를 반환한다", async () => {
    const file = makeTFile("note.md", 1000);
    const contents = new Map([["note.md", "# 노트\n검색어 포함 본문"]]);
    // 3차원으로 인덱싱
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient({ dimension: 3 }));
    await indexer.indexFile(file);

    // 쿼리 임베딩만 512차원으로 바뀐 상황(모델 교체)
    indexer.client = makeClient({ dimension: 512 });
    const result = await indexer.search("검색어", 10);

    // 핵심: 전 노트 0.5점 동점 결과가 아니라 폴백 + 경고여야 한다
    expect(result.staleEmbeddings).toBe(true);
    expect(result.usedKeywordFallback).toBe(true);
  });
});

describe("indexing 플래그: 예외가 증분 인덱싱을 영구 정지시키지 않는다", () => {
  it("indexVault가 예외로 중단되어도 이후 indexFile이 동작한다", async () => {
    const file = makeTFile("note.md", 1000);
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const app = makeApp([file], contents);
    // getMarkdownFiles가 throw → indexVault 본문이 예외로 중단된다
    const broken = {
      vault: {
        ...(app as any).vault,
        getMarkdownFiles: () => {
          throw new Error("의도적 실패");
        },
      },
    } as unknown as ConstructorParameters<typeof VaultIndexer>[0];

    const indexer = new VaultIndexer(broken, makeClient());
    await expect(indexer.indexVault()).rejects.toThrow("의도적 실패");

    // 플래그가 해제되어야 한다. 켜진 채면 이후 모든 indexFile이 대기열로만 흘러간다.
    expect(indexer.isIndexing).toBe(false);
  });
});

describe("needsReindex: 재인덱싱 표시가 최근 노트 선별을 망치지 않는다", () => {
  it("임베딩 무효화 후에도 최근 노트 선별(emerge)에 노트가 남는다", async () => {
    const now = 10_000_000;
    const file = makeTFile("note.md", now - 1000); // 방금 수정된 노트
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient());

    indexer.setEmbeddingSignature("bedrock:titan-v2");
    await indexer.indexFile(file);
    // 임베딩 모델 변경 → 벡터 폐기 + 재인덱싱 표시
    indexer.setEmbeddingSignature("openai:text-embedding-3-large");

    const recent = selectRecentNotes(indexer.getEntries(), 7, now);
    // 핵심: 재인덱싱 표시 때문에 최근 노트가 사라지면 emerge가 항상 "없습니다"를 반환한다
    expect(recent.map((e) => e.path)).toEqual(["note.md"]);
  });

  it("needsReindex 엔트리는 mtime이 같아도 indexVault에서 재처리된다", async () => {
    const file = makeTFile("note.md", 5000);
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    // 1회차: 프리플라이트만 성공 → 모든 청크 임베딩 실패
    const failing = makeClient({ failAfter: 1 });
    const indexer = new VaultIndexer(makeApp([file], contents), failing);
    await indexer.indexVault();
    expect(indexer.getEntries()[0].needsReindex).toBe(true);

    // 2회차: 정상 클라이언트로 교체. mtime은 그대로지만 재처리돼야 한다.
    indexer.client = makeClient();
    const result = await indexer.indexVault();

    expect(result.processed).toBe(1);
    const entry = indexer.getEntries()[0];
    expect(entry.needsReindex).toBeUndefined();
    expect(entry.chunks?.[0].embedding.length).toBeGreaterThan(0);
  });
});

describe("needsReindex: 임베딩 없이 인덱싱된 엔트리도 재시도 대상이다", () => {
  it("임베딩 비활성 상태에서 인덱싱된 노트는 needsReindex로 남는다", async () => {
    // 임베딩 모델 접근이 안 되는 상황(프리플라이트 실패) → useEmbeddings=false
    const file = makeTFile("note.md", 5000);
    const contents = new Map([["note.md", "# 노트\n본문"]]);
    const indexer = new VaultIndexer(makeApp([file], contents), makeClient({ failAfter: 0 }));

    await indexer.indexVault();

    const entry = indexer.getEntries()[0];
    // 벡터가 없으므로, 접근이 복구된 뒤 반드시 다시 인덱싱돼야 한다.
    // 표시가 없으면 mtime 스킵 때문에 이 노트만 영구히 벡터를 갖지 못한다.
    expect(entry.embedding).toEqual([]);
    expect(entry.needsReindex).toBe(true);

    // 접근 복구 후 재인덱싱하면 벡터가 채워진다.
    indexer.client = makeClient();
    await indexer.indexVault();
    expect(indexer.getEntries()[0].needsReindex).toBeUndefined();
    expect(indexer.getEntries()[0].embedding.length).toBeGreaterThan(0);
  });
});
