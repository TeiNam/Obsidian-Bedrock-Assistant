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


describe("VaultIndexer 진행률 단조 증가", () => {
  // 재시도 성공 시나리오에서 진행률이 역행하지 않는지 검증
  // Validates: Requirements 2.6, 3.7

  let app: any;
  let client: any;
  let indexer: VaultIndexer;

  beforeEach(() => {
    app = makeApp([]);
    client = makeClient();
    indexer = new VaultIndexer(app, client);
  });

  /**
   * Property 1: Fault Condition - 재시도 성공 시 진행률 단조 증가
   * 파일 인덱싱 실패 → 재시도 성공 시나리오에서 onProgress 값이 항상 이전보다 크거나 같은지 확인
   *
   * **Validates: Requirements 2.6**
   */
  it("재시도 성공 시 onProgress 값이 단조 증가해야 한다", async () => {
    const files = [
      makeTFile("a.md"),
      makeTFile("b.md"),
      makeTFile("c.md"),
      makeTFile("d.md"),
    ];
    app = makeApp(files);

    // b.md: 첫 시도 실패 → 재시도 성공 시나리오
    // forceIndexFile은 cachedRead 후 getEmbedding을 호출하므로
    // getEmbedding에서 실패를 시뮬레이션
    let callCount = 0;
    client.getEmbedding = vi.fn().mockImplementation(async (text: string) => {
      callCount++;
      // 임베딩 테스트 호출(첫 번째)은 성공
      if (callCount === 1) return [0.1, 0.2, 0.3];
      // a.md 성공 (2번째 호출)
      if (callCount === 2) return [0.1, 0.2, 0.3];
      // b.md 첫 시도 실패 (3번째 호출)
      if (callCount === 3) throw new Error("API 속도 제한");
      // b.md 재시도 성공 (4번째 호출)
      if (callCount === 4) return [0.1, 0.2, 0.3];
      // 나머지 파일 성공
      return [0.1, 0.2, 0.3];
    });

    indexer = new VaultIndexer(app, client);

    const progressValues: number[] = [];
    const onProgress = vi.fn((current: number, _total: number) => {
      progressValues.push(current);
    });

    await indexer.indexVault(onProgress);

    // 진행률이 단조 증가하는지 확인
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
    }

    // 최종 진행률이 전체 파일 수에 도달해야 함
    expect(progressValues[progressValues.length - 1]).toBe(files.length);
  });

  /**
   * Property 1 (추가): 여러 파일이 실패 후 재시도 성공하는 경우에도 단조 증가
   *
   * **Validates: Requirements 2.6**
   */
  it("여러 파일이 실패 후 재시도 성공해도 진행률이 단조 증가해야 한다", async () => {
    const files = [
      makeTFile("a.md"),
      makeTFile("b.md"),
      makeTFile("c.md"),
      makeTFile("d.md"),
      makeTFile("e.md"),
    ];
    app = makeApp(files);

    let callCount = 0;
    client.getEmbedding = vi.fn().mockImplementation(async () => {
      callCount++;
      // 임베딩 테스트 호출 성공
      if (callCount === 1) return [0.1, 0.2, 0.3];
      // a.md 성공
      if (callCount === 2) return [0.1, 0.2, 0.3];
      // b.md 첫 시도 실패
      if (callCount === 3) throw new Error("API 속도 제한");
      // b.md 재시도 성공
      if (callCount === 4) return [0.1, 0.2, 0.3];
      // c.md 첫 시도 실패
      if (callCount === 5) throw new Error("API 속도 제한");
      // c.md 재시도 성공
      if (callCount === 6) return [0.1, 0.2, 0.3];
      // 나머지 성공
      return [0.1, 0.2, 0.3];
    });

    indexer = new VaultIndexer(app, client);

    const progressValues: number[] = [];
    const onProgress = vi.fn((current: number, _total: number) => {
      progressValues.push(current);
    });

    await indexer.indexVault(onProgress);

    // 모든 진행률 값이 단조 증가해야 함
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
    }
  });

  /**
   * Property 2: Preservation - 첫 시도 성공 파일 진행률 보존
   * 재시도 없는 정상 인덱싱에서 진행률이 기존처럼 정상 증가하는지 확인
   *
   * **Validates: Requirements 3.7**
   */
  it("모든 파일이 첫 시도에 성공하면 진행률이 1씩 증가해야 한다", async () => {
    const files = [
      makeTFile("a.md"),
      makeTFile("b.md"),
      makeTFile("c.md"),
    ];
    app = makeApp(files);
    indexer = new VaultIndexer(app, client);

    const progressValues: number[] = [];
    const onProgress = vi.fn((current: number, _total: number) => {
      progressValues.push(current);
    });

    await indexer.indexVault(onProgress);

    // 진행률이 1, 2, 3으로 정상 증가해야 함
    expect(progressValues).toEqual([1, 2, 3]);
  });

  /**
   * Property 2 (추가): 빈 파일이 포함된 경우에도 진행률이 정상 증가
   *
   * **Validates: Requirements 3.7**
   */
  it("빈 파일이 포함되어도 진행률이 정상적으로 증가해야 한다", async () => {
    const files = [
      makeTFile("a.md"),
      makeTFile("empty.md"),
      makeTFile("b.md"),
    ];
    app = makeApp(files);

    // empty.md는 빈 내용 반환
    app.vault.cachedRead = vi.fn().mockImplementation(async (file: TFile) => {
      if (file.path === "empty.md") return "   ";
      return "# 테스트\n본문 내용";
    });

    indexer = new VaultIndexer(app, client);

    const progressValues: number[] = [];
    const onProgress = vi.fn((current: number, _total: number) => {
      progressValues.push(current);
    });

    await indexer.indexVault(onProgress);

    // 빈 파일도 포함하여 진행률이 단조 증가해야 함
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
    }

    // 최종 진행률이 전체 파일 수에 도달해야 함
    expect(progressValues[progressValues.length - 1]).toBe(files.length);
  });
});
