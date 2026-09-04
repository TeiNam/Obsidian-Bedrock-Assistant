import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { contentHash } from "../content-hash";
import type { VaultIndexEntry } from "../types";
import type { VaultIndexer } from "../vault-indexer";
import { getGeneratedBlock, upsertGeneratedBlock } from "./sentinel-blocks";
import {
  buildSynthesisDiff,
  buildSynthesisProvenance,
  parseSynthesisProvenance,
  refreshSynthesisProvenanceForSource,
  SYNTHESIS_PROVENANCE_BLOCK_KEY,
  upsertSynthesisProvenance,
} from "./synthesis-provenance";

function entry(path: string, chunks: string[]): VaultIndexEntry {
  return {
    path,
    title: path,
    excerpt: chunks[0] ?? "",
    embedding: [],
    lastModified: 1,
    chunks: chunks.map((text, index) => ({ index, text, embedding: [] })),
  };
}

describe("종합 노트 출처 변경 감지", () => {
  it("인용한 청크가 그대로면 다른 청크가 바뀌어도 오래됨으로 표시하지 않는다", async () => {
    const sourcePath = "Notes/source.md";
    const cited = "인용한 절";
    const provenance = buildSynthesisProvenance("주제", [
      {
        path: sourcePath,
        title: "Source",
        excerpt: cited,
        chunkHash: contentHash(cited),
      },
    ]);
    const synthesis = new TFile();
    synthesis.path = "Second Brain/주제.md";
    synthesis.basename = "주제";
    let content = upsertSynthesisProvenance(
      upsertGeneratedBlock("", "synthesis", "종합"),
      provenance,
      "ko",
    );
    const app = {
      vault: {
        getMarkdownFiles: () => [synthesis],
        cachedRead: vi.fn(async () => content),
        read: vi.fn(async () => content),
        process: vi.fn(async (_file: TFile, transform: (value: string) => string) => {
          content = transform(content);
        }),
      },
    };
    const indexer = {
      getEntries: () => [entry(sourcePath, [cited, "바뀐 다른 절"])],
    } as unknown as VaultIndexer;

    expect(
      await refreshSynthesisProvenanceForSource(
        app as never,
        indexer,
        sourcePath,
        "Second Brain",
        "ko",
      ),
    ).toBe(0);
    const parsed = parseSynthesisProvenance(
      getGeneratedBlock(content, SYNTHESIS_PROVENANCE_BLOCK_KEY),
    );
    expect(parsed?.changedPaths).toBeUndefined();
  });

  it("인용 청크가 바뀌거나 삭제되면 오래됨 callout을 기록한다", async () => {
    const sourcePath = "Notes/source.md";
    const provenance = buildSynthesisProvenance("주제", [
      {
        path: sourcePath,
        title: "Source",
        excerpt: "이전 절",
        chunkHash: contentHash("이전 절"),
      },
    ]);
    const synthesis = new TFile();
    synthesis.path = "Second Brain/주제.md";
    synthesis.basename = "주제";
    let content = upsertSynthesisProvenance("", provenance, "ko");
    const app = {
      vault: {
        getMarkdownFiles: () => [synthesis],
        cachedRead: vi.fn(async () => content),
        read: vi.fn(async () => content),
        process: vi.fn(async (_file: TFile, transform: (value: string) => string) => {
          content = transform(content);
        }),
      },
    };
    const indexer = {
      getEntries: () => [entry(sourcePath, ["새 절"])],
    } as unknown as VaultIndexer;

    await refreshSynthesisProvenanceForSource(
      app as never,
      indexer,
      sourcePath,
      "Second Brain",
      "ko",
    );

    expect(content).toContain("[!warning] 오래된 종합 노트");
    expect(
      parseSynthesisProvenance(
        getGeneratedBlock(content, SYNTHESIS_PROVENANCE_BLOCK_KEY),
      )?.changedPaths,
    ).toEqual([sourcePath]);
  });

  it("재생성 diff는 공통 앞뒤를 빼고 바뀐 줄만 표시한다", () => {
    expect(buildSynthesisDiff("같음\n이전\n끝", "같음\n새로\n끝")).toBe("- 이전\n+ 새로");
  });
});
