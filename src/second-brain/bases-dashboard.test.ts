import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import type { VaultIndexEntry } from "../types";
import type { VaultIndexer } from "../vault-indexer";
import { DASHBOARD_ITEMS_FOLDER_NAME } from "../dashboard-artifacts";
import {
  DASHBOARD_BASE_FILE,
  buildBasesDashboard,
  refreshBasesDashboard,
} from "./bases-dashboard";
import {
  DECISION_BLOCK_KEY,
  DECISION_LEDGER_FILE,
  formatLedger,
  type DecisionEntry,
} from "./decisions";
import { upsertGeneratedBlock } from "./sentinel-blocks";
import {
  buildSynthesisProvenance,
  upsertSynthesisProvenance,
} from "./synthesis-provenance";

const WIKI = "Second Brain";
const NOW = Date.UTC(2026, 8, 4);

function makeFile(path: string, content: string): TFile & { content: string } {
  const file = new TFile() as TFile & { content: string };
  file.path = path;
  file.name = path.split("/").pop() ?? path;
  file.basename = file.name.replace(/\.[^.]+$/, "");
  file.extension = file.name.split(".").pop() ?? "";
  file.stat = {
    ctime: NOW,
    mtime: NOW,
    size: content.length,
  } as TFile["stat"];
  file.content = content;
  return file;
}

function reviewEntry(): VaultIndexEntry {
  return {
    path: "Notes/review.md",
    title: "다시 볼 노트",
    excerpt: "x".repeat(300),
    embedding: [],
    lastModified: NOW - 60 * 24 * 60 * 60 * 1000,
    chunks: [{ index: 0, text: "x".repeat(300), embedding: [] }],
    outlinks: ["Notes/linked.md"],
    backlinks: [],
  };
}

function makeHarness() {
  const decision: DecisionEntry = {
    decision: "PostgreSQL을 사용한다",
    rationale: "트랜잭션이 필요하다",
    sources: ["Meetings/decision.md"],
    decidedOn: "",
    owner: "Teinam",
    due: "2026-09-30",
    status: "open",
    supersededBy: "",
  };
  const ledger = upsertGeneratedBlock(
    "",
    DECISION_BLOCK_KEY,
    formatLedger([decision]),
  );
  const staleProvenance = {
    ...buildSynthesisProvenance(
      "검색",
      [
        {
          path: "Notes/source.md",
          title: "Source",
          excerpt: "이전 근거",
          chunkHash: "0123456789abcdef",
        },
      ],
      "2026-09-01T00:00:00.000Z",
    ),
    changedPaths: ["Notes/source.md"],
  };
  const stale = upsertSynthesisProvenance(
    upsertGeneratedBlock("", "synthesis", "종합"),
    staleProvenance,
    "ko",
  );
  const obsolete = [
    "---",
    "agent_llms_dashboard: true",
    "dashboard_active: true",
    'dashboard_type: "review"',
    'title: "옛 항목"',
    "---",
    "",
  ].join("\n");

  const files = new Map<string, TFile & { content: string }>([
    [`${WIKI}/${DECISION_LEDGER_FILE}`, makeFile(`${WIKI}/${DECISION_LEDGER_FILE}`, ledger)],
    [`${WIKI}/검색.md`, makeFile(`${WIKI}/검색.md`, stale)],
    [
      `${WIKI}/${DASHBOARD_ITEMS_FOLDER_NAME}/review-obsolete.md`,
      makeFile(`${WIKI}/${DASHBOARD_ITEMS_FOLDER_NAME}/review-obsolete.md`, obsolete),
    ],
  ]);
  const folders = new Map<string, TFolder>();

  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? folders.get(path) ?? null),
    createFolder: vi.fn(async (path: string) => {
      const folder = new TFolder();
      folder.path = path;
      folder.name = path.split("/").pop() ?? path;
      folders.set(path, folder);
      return folder;
    }),
    create: vi.fn(async (path: string, content: string) => {
      const file = makeFile(path, content);
      files.set(path, file);
      return file;
    }),
    cachedRead: vi.fn(async (file: TFile & { content?: string }) => file.content ?? ""),
    read: vi.fn(async (file: TFile & { content?: string }) => file.content ?? ""),
    process: vi.fn(async (
      file: TFile & { content?: string },
      transform: (content: string) => string,
    ) => {
      file.content = transform(file.content ?? "");
      return file.content;
    }),
    getFiles: vi.fn(() => [...files.values()]),
    getMarkdownFiles: vi.fn(() =>
      [...files.values()].filter((file) => file.extension === "md")
    ),
  };
  const indexer = {
    getEntries: vi.fn(() => [reviewEntry()]),
  } as unknown as VaultIndexer;
  const ctx = {
    app: {
      vault,
      metadataCache: {
        unresolvedLinks: {
          "Notes/a.md": { "아직 없는 질문": 2 },
        },
      },
    },
    indexer,
    settings: {
      enabled: true,
      wikiFolder: WIKI,
      schedulerEnabled: true,
      schedulerIntervalHours: 24,
      lastScheduledRun: 0,
      accessLog: {},
      reviewSurfaced: {},
    },
    wikiFolder: WIKI,
    locale: "ko" as const,
  };
  return { ctx, files, vault };
}

describe("Bases 대시보드", () => {
  it("공식 Bases YAML 구조로 4개 뷰를 만든다", () => {
    const base = buildBasesDashboard(WIKI, "ko");
    expect(base).toContain(`file.inFolder(\\\"${WIKI}/${DASHBOARD_ITEMS_FOLDER_NAME}\\\")`);
    expect(base.match(/  - type: table/g)).toHaveLength(4);
    for (const name of ["결정 원장", "미해결 질문", "오래된 지식", "복습 큐"]) {
      expect(base).toContain(`name: "${name}"`);
    }
  });

  it("결정·미해결 질문·오래된 지식·복습 큐를 투영하고 옛 항목은 비활성화한다", async () => {
    const { ctx, files } = makeHarness();

    const result = await refreshBasesDashboard(ctx as never, NOW);

    expect(result.basePath).toBe(`${WIKI}/${DASHBOARD_BASE_FILE}`);
    expect(result.itemCount).toBe(4);
    const base = files.get(result.basePath)?.content ?? "";
    expect(base).toContain('name: "결정 원장"');
    expect(base).toContain('name: "미해결 질문"');
    expect(base).toContain('name: "오래된 지식"');
    expect(base).toContain('name: "복습 큐"');

    const activeItems = [...files.values()].filter(
      (file) =>
        file.path.includes(`/${DASHBOARD_ITEMS_FOLDER_NAME}/`) &&
        file.content.includes("dashboard_active: true"),
    );
    expect(activeItems).toHaveLength(4);
    expect(activeItems.map((file) => file.content).join("\n")).toContain(
      'dashboard_type: "decision"',
    );
    expect(activeItems.map((file) => file.content).join("\n")).toContain(
      'dashboard_type: "question"',
    );
    expect(activeItems.map((file) => file.content).join("\n")).toContain(
      'dashboard_type: "stale"',
    );
    expect(activeItems.map((file) => file.content).join("\n")).toContain(
      'dashboard_type: "review"',
    );
    expect(
      files.get(`${WIKI}/${DASHBOARD_ITEMS_FOLDER_NAME}/review-obsolete.md`)?.content,
    ).toContain("dashboard_active: false");
  });
});
