// 코드베이스 아키텍트 순수 모듈 속성 기반 테스트 (fast-check 기반)
// ====================================================================
// 순수 함수 모듈 `architect.ts`의 설계 Correctness Properties를 검증한다.
// 각 속성 테스트는 최소 100회 반복(numRuns >= 100)으로 실행한다.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { scanModuleTree, ModuleNode } from "./architect";

/**
 * 경로 세그먼트 생성기.
 * "/"를 포함하지 않는 비어 있지 않은 현실적인 식별자/파일명 조각을 만든다.
 * (예: "src", "a", "b.ts", "main.ts")
 */
const segment: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9_.-]+$/)
  .filter((s) => s.length > 0 && s !== "." && s !== "..");

/**
 * 경로 생성기.
 * 1~5개의 세그먼트를 "/"로 이어 "src/a/b.ts"·"main.ts" 같은 현실적인 경로를 만든다.
 */
const filePath: fc.Arbitrary<string> = fc
  .array(segment, { minLength: 1, maxLength: 5 })
  .map((segments) => segments.join("/"));

/** 경로 목록 생성기. 0~30개의 경로를 만든다. */
const filePaths: fc.Arbitrary<string[]> = fc.array(filePath, {
  minLength: 0,
  maxLength: 30,
});

/** 트리를 순회하며 모든 파일 리프 노드의 path 를 수집한다. */
function collectLeafPaths(node: ModuleNode): string[] {
  if (node.kind === "file") return [node.path];
  const paths: string[] = [];
  for (const child of node.children ?? []) {
    paths.push(...collectLeafPaths(child));
  }
  return paths;
}

describe("scanModuleTree - Property 13", () => {
  // Feature: second-brain-layer, Property 13: 모듈 트리 스캔은 모든 입력 경로를 커버한다
  it("반환된 트리의 리프(파일) 경로 집합은 (중복 제거된) 입력 경로 집합과 정확히 일치한다", () => {
    fc.assert(
      fc.property(filePaths, (paths) => {
        const tree = scanModuleTree(paths);
        const leafPaths = collectLeafPaths(tree);

        // 입력 경로 집합(중복 제거) — 동일 입력 경로는 한 리프로 수렴한다.
        const inputSet = new Set(paths);
        const leafSet = new Set(leafPaths);

        // 누락·추가 없이 집합이 동일해야 한다.
        expect(leafSet).toEqual(inputSet);

        // 리프 경로에는 중복이 없어야 한다(집합 크기 = 배열 길이).
        expect(leafPaths.length).toBe(leafSet.size);
      }),
      { numRuns: 100 }
    );
  });
});

// ====================================================================
// runArchitect 재실행 보존 단위 테스트 (예시 기반) — Task 9.3
// ====================================================================
// 기존 Architecture.md에 사용자 메모(User_Region: Generated_Region 블록 밖 텍스트)가
// 있을 때, runArchitect를 재실행하면 Generated_Region 섹션 블록(overview/modules/decisions)만
// 갱신되고 사용자 메모는 그대로 보존되어야 한다 (Req 10.4).
//
// 순수 함수(scanModuleTree/buildArchitectureSections)·블록 병합(sentinel-blocks)은 각
// 모듈 테스트에서 다루므로, 여기서는 "재실행 시 비파괴 갱신"(I/O 래퍼 와이어링)에 집중한다.

import { vi } from "vitest";
import { TFile } from "obsidian";
import { runArchitect, ARCHITECTURE_SECTION_KEYS } from "./architect";
import { upsertGeneratedBlock, getGeneratedBlock } from "./sentinel-blocks";
import type { SecondBrainContext } from "./scheduler";

const ARCH_WIKI = "Second Brain";
const ARCH_NOTE_PATH = `${ARCH_WIKI}/Architecture.md`;

/** instanceof TFile 분기를 통과하는 모킹 TFile을 만든다(경로·내용 보유). */
function makeArchFile(path: string, content = ""): any {
  const f: any = new TFile();
  f.path = path;
  f.content = content;
  return f;
}

/** getFiles가 반환할 가짜 파일 엔트리(경로만 필요). */
function makeScanFile(path: string): any {
  return { path };
}

/**
 * 섹션별로 구분되는 canned 텍스트를 반환하는 aiClient 스텁.
 * runArchitect는 프롬프트 헤더 `# 아키텍처 노트 작성 — <key> 섹션`로 섹션을 식별할 수 있으므로,
 * 프롬프트에서 섹션 키를 파싱하여 `NEW::<key>` 형태의 새 본문을 돌려준다.
 * 반환 형식은 IAiClient.converseLight 규약과 동일한 `{ text }`.
 */
function makeCannedAiClient(): any {
  const converseLight = vi.fn(async (prompt: string) => {
    const match = /아키텍처 노트 작성 — (\S+) 섹션/.exec(prompt);
    const key = match ? match[1] : "unknown";
    return { text: `NEW::${key}` };
  });
  return { converseLight };
}

/**
 * 기존 Architecture.md(사용자 메모 + 옛 섹션 블록)를 보유한 모킹 Vault와 컨텍스트를 구성한다.
 * getFiles는 스캔 대상 소스 파일 경로를 반환하고, getAbstractFileByPath는 기존 노트를 돌려준다.
 */
function setupExistingArchitecture(userMemo: string) {
  // 사용자 메모 + 각 섹션의 옛 Generated_Region 블록이 섞인 기존 노트 본문.
  let initial = `${userMemo}\n`;
  for (const key of ARCHITECTURE_SECTION_KEYS) {
    initial = upsertGeneratedBlock(initial, key, `OLD::${key}`);
  }

  const archFile = makeArchFile(ARCH_NOTE_PATH, initial);
  const map = new Map<string, any>([[ARCH_NOTE_PATH, archFile]]);

  const vault = {
    // 스캔 대상 소스 파일 + 자기 출력(Architecture.md) — 자기 출력은 스캔에서 제외되어야 함.
    getFiles: vi.fn(() => [
      makeScanFile("src/main.ts"),
      makeScanFile("src/second-brain/architect.ts"),
      makeScanFile("src/second-brain/scheduler.ts"),
      makeScanFile(ARCH_NOTE_PATH),
    ]),
    getAbstractFileByPath: vi.fn((p: string) => map.get(p) ?? null),
    read: vi.fn(async (f: any) => f.content ?? ""),
    modify: vi.fn(async (f: any, content: string) => {
      f.content = content;
    }),
    // 기존 노트 경로에서는 호출되지 않아야 하는 쓰기 API(호출 여부 검증용 spy).
    create: vi.fn(),
    createFolder: vi.fn(),
  };

  const ctx = {
    app: { vault } as any,
    indexer: {} as any,
    aiClient: makeCannedAiClient(),
    settings: {
      enabled: true,
      wikiFolder: ARCH_WIKI,
      schedulerEnabled: false,
      schedulerIntervalHours: 24,
      lastScheduledRun: 0,
    },
    wikiFolder: ARCH_WIKI,
    persist: vi.fn(async () => {}),
  } as unknown as SecondBrainContext;

  return { ctx, vault, archFile, initial };
}

describe("runArchitect — 재실행 보존 (Req 10.4)", () => {
  it("기존 Architecture.md의 사용자 메모를 보존하며 섹션 블록만 갱신한다", async () => {
    const userMemo = "## 내 메모\n직접 작성한 설계 노트 — 재실행 후에도 보존되어야 함";
    const { ctx, vault, archFile } = setupExistingArchitecture(userMemo);

    const result = await runArchitect(ctx);

    // 기존 노트는 새로 생성하지 않고 modify로 갱신한다(create/createFolder 미호출).
    expect(result).toContain("갱신");
    expect(vault.modify).toHaveBeenCalledTimes(1);
    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.createFolder).not.toHaveBeenCalled();

    const written = archFile.content as string;

    // (1) 사용자 메모(User_Region)는 한 글자도 손실 없이 보존된다.
    expect(written).toContain(userMemo);

    // (2) 모든 섹션 블록이 새 LLM 본문으로 교체되고 옛 본문은 사라진다.
    for (const key of ARCHITECTURE_SECTION_KEYS) {
      expect(getGeneratedBlock(written, key)).toBe(`NEW::${key}`);
      expect(written).not.toContain(`OLD::${key}`);
    }
  });

  it("자기 출력(Architecture.md)은 스캔 대상에서 제외하고 소스 파일만 분석한다", async () => {
    const { ctx, vault } = setupExistingArchitecture("## 메모\n보존 대상");

    await runArchitect(ctx);

    // 섹션 수(overview/modules/decisions)만큼 LLM 요약을 호출한다.
    expect(ctx.aiClient.converseLight).toHaveBeenCalledTimes(ARCHITECTURE_SECTION_KEYS.length);
    // 기존 노트를 한 번 읽어 사용자 메모를 보존한 채 병합한다.
    expect(vault.read).toHaveBeenCalledTimes(1);
  });
});
