import { describe, it, expect, vi, beforeEach } from "vitest";
import { VaultIndexer } from "./vault-indexer";
import { TFile } from "obsidian";

// TFile 인스턴스를 생성하는 헬퍼
function makeTFile(path: string, mtime = Date.now()): TFile {
  const file = new TFile();
  file.path = path;
  file.basename = path.replace(/\.md$/, "");
  file.stat = { mtime, ctime: mtime, size: 100 } as any;
  return file;
}

// 최소한의 App 모킹
function makeApp(files: TFile[] = []): any {
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: vi.fn().mockResolvedValue("# 테스트\n본문 내용"),
      getAbstractFileByPath: (path: string) =>
        files.find((f) => f.path === path) ?? null,
    },
  };
}

// 최소한의 BedrockClient 모킹
function makeClient(): any {
  return {
    getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  };
}

describe("VaultIndexer 동시성 보호", () => {
  let app: any;
  let client: any;
  let indexer: VaultIndexer;

  beforeEach(() => {
    app = makeApp([]);
    client = makeClient();
    indexer = new VaultIndexer(app, client);
  });

  it("인덱싱 중이 아닐 때 indexFile()은 정상 실행된다", async () => {
    const file = makeTFile("note.md");
    await indexer.indexFile(file);
    expect(indexer.size).toBe(1);
  });

  it("인덱싱 중일 때 indexFile() 호출 시 큐잉되고 즉시 리턴한다", async () => {
    const fileA = makeTFile("a.md");
    const fileB = makeTFile("b.md");
    app = makeApp([fileA]);

    // 첫 임베딩 호출을 수동 제어하여 인덱싱 중 상태 유지
    let resolveEmbedding: ((v: number[]) => void) | null = null;
    client.getEmbedding = vi.fn().mockImplementationOnce(
      () => new Promise<number[]>((resolve) => { resolveEmbedding = resolve; })
    ).mockResolvedValue([0.1, 0.2]);
    indexer = new VaultIndexer(app, client);

    // indexVault 시작 (임베딩 테스트에서 블로킹됨)
    const vaultPromise = indexer.indexVault();
    await new Promise((r) => setTimeout(r, 0));
    expect(indexer.isIndexing).toBe(true);

    // 인덱싱 중 파일 변경 시뮬레이션
    await indexer.indexFile(fileB);

    // 큐잉되었으므로 인덱스에 아직 추가되지 않아야 함
    expect(indexer.size).toBe(0);

    // 임베딩 resolve하여 indexVault 진행
    resolveEmbedding!([0.1, 0.2]);
    await vaultPromise;

    expect(indexer.isIndexing).toBe(false);
  });

  it("indexVault() 완료 후 큐잉된 파일이 순차 처리된다", async () => {
    const fileA = makeTFile("a.md");
    const fileC = makeTFile("c.md");

    // indexVault 대상은 fileA만, getAbstractFileByPath는 fileC도 반환
    app = makeApp([fileA]);
    const allFiles = [fileA, fileC];
    app.vault.getAbstractFileByPath = (path: string) =>
      allFiles.find((f) => f.path === path) ?? null;

    // 첫 임베딩 호출을 수동 제어
    let resolveFirst: ((v: number[]) => void) | null = null;
    client.getEmbedding = vi.fn().mockImplementationOnce(
      () => new Promise<number[]>((resolve) => { resolveFirst = resolve; })
    ).mockResolvedValue([0.1, 0.2]);
    indexer = new VaultIndexer(app, client);

    const vaultPromise = indexer.indexVault();
    await new Promise((r) => setTimeout(r, 0));

    expect(indexer.isIndexing).toBe(true);
    await indexer.indexFile(fileC);

    // 첫 임베딩 resolve → indexVault 진행 → processPendingFiles 실행
    resolveFirst!([0.1, 0.2]);
    await vaultPromise;

    // fileA(indexVault) + fileC(pending) 모두 인덱스에 포함
    expect(indexer.size).toBe(2);
    expect(indexer.isIndexing).toBe(false);
  });

  it("인덱싱 중 동일 파일이 여러 번 변경되어도 Set이므로 한 번만 처리된다", async () => {
    const fileA = makeTFile("a.md");
    app = makeApp([fileA]);

    let resolveFirst: ((v: number[]) => void) | null = null;
    client.getEmbedding = vi.fn().mockImplementationOnce(
      () => new Promise<number[]>((resolve) => { resolveFirst = resolve; })
    ).mockResolvedValue([0.1, 0.2]);
    indexer = new VaultIndexer(app, client);

    const vaultPromise = indexer.indexVault();
    await new Promise((r) => setTimeout(r, 0));

    // 동일 파일에 대해 여러 번 indexFile 호출
    await indexer.indexFile(fileA);
    await indexer.indexFile(fileA);
    await indexer.indexFile(fileA);

    resolveFirst!([0.1, 0.2]);
    await vaultPromise;

    // 에러 없이 정상 완료
    expect(indexer.isIndexing).toBe(false);
  });

  it("인덱싱 중이 아닐 때는 큐잉 없이 바로 인덱싱한다", async () => {
    const file = makeTFile("direct.md");

    expect(indexer.isIndexing).toBe(false);
    await indexer.indexFile(file);

    // 바로 인덱스에 추가됨
    expect(indexer.size).toBe(1);
  });
});
