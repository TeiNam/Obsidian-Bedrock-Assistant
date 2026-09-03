// 모순해결(reconcile) 비파괴 단위 테스트 (Reconcile — Unit Tests)
// ====================================================================
// 모킹한 Vault + IAiClient 스텁으로 다음을 검증한다.
// - runReconcile은 어떤 노트도 생성·수정·삭제하지 않는다(비파괴, Req 8.2)
// - 모순 0건이면 "모순 없음" 안내 문구를 반환한다(Req 8.5)
// - parseContradictionReport는 파싱 실패 시 예외 없이 빈 배열을 반환한다(Req 8.3)
//
// LLM 호출은 고정 응답 스텁(converseLight → { text })으로 대체하고, Vault 쓰기 API는
// vi.fn() 스파이로 감싸 "호출되지 않음"을 단언한다. 검색은 items가 있는 GraphRagResult를
// 반환하는 인덱서 스텁으로 대체하여 LLM 호출 경로까지 진입하게 한다.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import {
  parseContradictionReport,
  runReconcile,
  runReconcileDetailed,
  applyReconciliation,
  type Contradiction,
} from "./reconcile";
import { buildAiFirstNote, parseAiFirstNote } from "./ai-first-format";
import type { SecondBrainContext } from "./scheduler";
import type {
  GraphRagResult,
  GraphRagSearchItem,
  VaultIndexer,
} from "../vault-indexer";
import type { IAiClient } from "../types";

// --- 테스트 더블 구성 헬퍼 ----------------------------------------------------

/** 검색 히트(GraphRagSearchItem) 생성 헬퍼 — second-brain이 쓰지 않는 필드도 채운다. */
function makeItem(overrides: Partial<GraphRagSearchItem> = {}): GraphRagSearchItem {
  return {
    path: "Notes/example.md",
    title: "예시 노트",
    excerpt: "이것은 발췌입니다.",
    combinedScore: 0.9,
    vectorScore: 0.8,
    hop: 0,
    isSeed: true,
    seedPath: null,
    seedTitle: null,
    ...overrides,
  };
}

/** create/modify/delete를 vi.fn() 스파이로 감싼 모킹 Vault. */
function makeMockVault() {
  return {
    // 쓰기성 API — runReconcile은 이들 중 무엇도 호출하면 안 된다(비파괴).
    create: vi.fn(async () => undefined),
    modify: vi.fn(async () => undefined),
    // processIfChanged가 쓰는 원자적 쓰기. 단일 스레드 테스트에서는 읽기-변환-쓰기를
    // 이어붙이면 관찰 가능한 동작이 같다.
    process: vi.fn(async (f: any, fn: (data: string) => string) => {
      const next = fn(f.content ?? "");
      f.content = next;
      return next;
    }),
    delete: vi.fn(async () => undefined),
    createFolder: vi.fn(async () => undefined),
    // 읽기성 API(혹시 모를 접근 대비) — 호출돼도 무해
    getMarkdownFiles: vi.fn(() => []),
    cachedRead: vi.fn(async () => ""),
    getAbstractFileByPath: vi.fn(() => null),
  };
}

/**
 * SecondBrainContext 테스트 더블 구성.
 * @param searchResult indexer.search가 반환할 결과
 * @param llmText converseLight가 반환할 고정 텍스트
 */
function makeContext(searchResult: GraphRagResult, llmText: string) {
  const vault = makeMockVault();

  const indexer = {
    search: vi.fn(async () => searchResult),
  } as unknown as VaultIndexer;

  const converseLight = vi.fn(async () => ({ text: llmText }));
  const aiClient = { converseLight } as unknown as IAiClient;

  const ctx: SecondBrainContext = {
    app: { vault } as unknown as SecondBrainContext["app"],
    indexer,
    aiClient,
    settings: {
      enabled: true,
      wikiFolder: "Second Brain",
      schedulerEnabled: false,
      schedulerIntervalHours: 24,
      lastScheduledRun: 0,
    },
    wikiFolder: "Second Brain",
    persist: vi.fn(async () => undefined),
  };

  return { ctx, vault, converseLight, indexer };
}

/** Vault 쓰기 스파이가 하나도 호출되지 않았음을 단언한다(비파괴 검증). */
function expectNoVaultWrites(vault: ReturnType<typeof makeMockVault>) {
  expect(vault.create).not.toHaveBeenCalled();
  expect(vault.modify).not.toHaveBeenCalled();
  expect(vault.delete).not.toHaveBeenCalled();
  expect(vault.createFolder).not.toHaveBeenCalled();
}

// --- runReconcile: 비파괴 (Req 8.2) ------------------------------------------

describe("runReconcile — 비파괴 (Req 8.2)", () => {
  it("모순이 있어도 어떤 노트도 생성·수정·삭제하지 않는다", async () => {
    const searchResult: GraphRagResult = {
      items: [
        makeItem({ path: "A.md", title: "노트 A", excerpt: "X는 참이다." }),
        makeItem({ path: "B.md", title: "노트 B", excerpt: "X는 거짓이다." }),
      ],
    };
    const llmText = JSON.stringify([
      {
        notePaths: ["A.md", "B.md"],
        statements: ["X는 참이다.", "X는 거짓이다."],
        suggestion: "두 노트의 진위를 재확인하십시오.",
      },
    ]);
    const { ctx, vault, converseLight } = makeContext(searchResult, llmText);

    const report = await runReconcile(ctx, "주제 X");

    // LLM 호출 경로에 진입했음을 확인(검색 결과가 있어 프롬프트를 구성)
    expect(converseLight).toHaveBeenCalledTimes(1);
    // 모순 리포트를 반환하되, 노트는 일절 변경하지 않는다
    expect(report).toContain("모순 리포트");
    expectNoVaultWrites(vault);
  });

  it("모순이 0건이어도 노트를 변경하지 않는다", async () => {
    const searchResult: GraphRagResult = {
      items: [makeItem({ path: "A.md", title: "노트 A" })],
    };
    // 빈 배열 → 모순 없음
    const { ctx, vault } = makeContext(searchResult, "[]");

    await runReconcile(ctx, "주제 X");

    expectNoVaultWrites(vault);
  });

  it("관련 노트가 없으면 LLM 호출 없이 노트를 변경하지 않는다", async () => {
    const searchResult: GraphRagResult = { items: [] };
    const { ctx, vault, converseLight } = makeContext(searchResult, "[]");

    const message = await runReconcile(ctx, "없는 주제");

    expect(converseLight).not.toHaveBeenCalled();
    expect(message).toContain("점검할 모순이 없습니다");
    expectNoVaultWrites(vault);
  });
});

// --- runReconcile: 모순 0건 안내 (Req 8.5) -----------------------------------

describe("runReconcile — 모순 0건 안내 (Req 8.5)", () => {
  it("LLM이 빈 배열을 반환하면 '모순 없음' 안내를 반환한다", async () => {
    const searchResult: GraphRagResult = { items: [makeItem()] };
    const { ctx } = makeContext(searchResult, "[]");

    const message = await runReconcile(ctx, "주제 X");

    expect(message).toBe("발견된 모순이 없습니다. 어떤 노트도 변경하지 않았습니다.");
  });

  it("LLM 응답이 파싱 불가면 '모순 없음'이 아니라 해석 실패를 보고한다", async () => {
    const searchResult: GraphRagResult = { items: [makeItem()] };
    // 손상된 JSON → 파싱 실패. 이를 "모순 없음"으로 보고하면 거짓 음성이 된다.
    const { ctx } = makeContext(searchResult, "이건 JSON이 아닙니다");

    const message = await runReconcile(ctx, "주제 X");

    expect(message).toContain("해석할 수 없었습니다");
    // 모순이 없다는 잘못된 결론을 내리지 않아야 한다
    expect(message).not.toContain("발견된 모순이 없습니다");
    // 어떤 노트도 변경하지 않았음은 유지된다
    expect(message).toContain("변경하지 않았습니다");
  });

  it("LLM이 빈 배열([])을 반환하면 '모순 없음'으로 보고한다", async () => {
    const searchResult: GraphRagResult = { items: [makeItem()] };
    const { ctx } = makeContext(searchResult, "[]");

    const message = await runReconcile(ctx, "주제 X");

    expect(message).toBe("발견된 모순이 없습니다. 어떤 노트도 변경하지 않았습니다.");
  });

  it("빈 topic이면 안내 문구를 반환하고 검색하지 않는다", async () => {
    const searchResult: GraphRagResult = { items: [makeItem()] };
    const { ctx, indexer } = makeContext(searchResult, "[]");

    const message = await runReconcile(ctx, "   ");

    expect(message).toContain("주제");
    expect((indexer.search as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

// --- parseContradictionReport: 견고성 (Req 8.3) ------------------------------

describe("parseContradictionReport — 견고성 (Req 8.3)", () => {
  it("유효한 JSON 배열을 Contradiction 목록으로 파싱한다", () => {
    const text = JSON.stringify([
      {
        notePaths: ["A.md", "B.md"],
        statements: ["참", "거짓"],
        suggestion: "정정안",
      },
    ]);

    const result = parseContradictionReport(text);

    expect(result).toEqual([
      {
        notePaths: ["A.md", "B.md"],
        statements: ["참", "거짓"],
        suggestion: "정정안",
      },
    ]);
  });

  it("코드펜스로 감싼 JSON 배열도 추출하여 파싱한다", () => {
    const text =
      "다음은 결과입니다:\n```json\n[{\"notePaths\":[\"A.md\"],\"statements\":[\"진술\"],\"suggestion\":\"정정\"}]\n```";

    const result = parseContradictionReport(text);

    expect(result).toHaveLength(1);
    expect(result[0].notePaths).toEqual(["A.md"]);
  });

  it("손상된(malformed) JSON이면 예외 없이 빈 배열을 반환한다", () => {
    expect(parseContradictionReport("[{ notePaths: }")).toEqual([]);
    expect(parseContradictionReport("[1, 2, 3")).toEqual([]);
  });

  it("JSON이지만 배열이 아니면 빈 배열을 반환한다", () => {
    expect(parseContradictionReport('{"notePaths":["A.md"]}')).toEqual([]);
    expect(parseContradictionReport('"문자열"')).toEqual([]);
  });

  it("빈/공백 입력이면 빈 배열을 반환한다", () => {
    expect(parseContradictionReport("")).toEqual([]);
    expect(parseContradictionReport("   ")).toEqual([]);
  });

  it("빈 JSON 배열([])이면 빈 배열을 반환한다(모순 없음)", () => {
    expect(parseContradictionReport("[]")).toEqual([]);
  });

  it("배열 안의 완전히 빈 항목은 제거한다", () => {
    const text = JSON.stringify([
      { notePaths: [], statements: [], suggestion: "" },
      { notePaths: ["A.md"], statements: [], suggestion: "" },
    ]);

    const result = parseContradictionReport(text);

    expect(result).toEqual([{ notePaths: ["A.md"], statements: [], suggestion: "" }]);
  });

  it("문자열이 아닌 입력도 예외 없이 빈 배열을 반환한다", () => {
    // 런타임 견고성: 타입을 우회한 비정상 입력도 throw하지 않는다.
    expect(parseContradictionReport(null as unknown as string)).toEqual([]);
    expect(parseContradictionReport(undefined as unknown as string)).toEqual([]);
    expect(parseContradictionReport(123 as unknown as string)).toEqual([]);
  });
});

// --- applyReconciliation: 승인 후 반영 (Req 8.4) ------------------------------
// 승인된 Contradiction의 대상 노트만 갱신하고(learned_at + 정정안 본문), 승인되지 않은
// 노트는 일절 건드리지 않으며, 자동(스케줄러) 경로는 이 함수를 절대 호출하지 않음을 검증한다.

/** 모킹 TFile 생성 — instanceof TFile 분기를 통과하고 내용을 보유한다. */
function makeFile(path: string, content = ""): TFile {
  const f = new TFile();
  f.path = path;
  // 내용은 테스트 편의상 파일 객체에 함께 보관한다(실제 Obsidian은 Vault가 관리).
  (f as unknown as { content: string }).content = content;
  return f;
}

/**
 * applyReconciliation용 Vault 더블. 경로→파일 맵으로 getAbstractFileByPath/read/modify를 제공한다.
 * create/delete/createFolder는 호출되면 안 되므로(생성하지 않음) 스파이로 감싸 단언에 사용한다.
 */
function makeApplyVault(files: TFile[]) {
  const map = new Map<string, TFile>();
  for (const f of files) map.set(f.path, f);

  return {
    getAbstractFileByPath: vi.fn((p: string) => map.get(p) ?? null),
    read: vi.fn(async (f: TFile) => (f as unknown as { content: string }).content ?? ""),
    modify: vi.fn(async (f: TFile, content: string) => {
      (f as unknown as { content: string }).content = content;
    }),
    // processIfChanged가 쓰는 원자적 쓰기. 단일 스레드 테스트에서는 읽기-변환-쓰기를
    // 이어붙이면 관찰 가능한 동작이 같다.
    process: vi.fn(async (f: TFile, fn: (data: string) => string) => {
      const holder = f as unknown as { content: string };
      const next = fn(holder.content ?? "");
      holder.content = next;
      return next;
    }),
    create: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    createFolder: vi.fn(async () => undefined),
    _map: map,
  };
}

/** applyReconciliation 실행용 컨텍스트 더블. */
function makeApplyContext(files: TFile[]) {
  const vault = makeApplyVault(files);
  const ctx: SecondBrainContext = {
    app: { vault } as unknown as SecondBrainContext["app"],
    indexer: { search: vi.fn() } as unknown as SecondBrainContext["indexer"],
    aiClient: { converseLight: vi.fn() } as unknown as SecondBrainContext["aiClient"],
    settings: {
      enabled: true,
      wikiFolder: "Second Brain",
      schedulerEnabled: false,
      schedulerIntervalHours: 24,
      lastScheduledRun: 0,
    },
    wikiFolder: "Second Brain",
    persist: vi.fn(async () => undefined),
  };
  return { ctx, vault };
}

/** 파일의 현재 내용을 읽는다(modify가 반영한 최신 값). */
function contentOf(f: TFile): string {
  return (f as unknown as { content: string }).content ?? "";
}

describe("applyReconciliation — 승인 후 반영 (Req 8.4)", () => {
  it("승인된 AI-first 노트의 learned_at을 now로 갱신하고 정정안을 병합한다", async () => {
    // 기존 learned_at이 과거인 AI-first 노트를 만든다.
    const original = buildAiFirstNote(
      {
        meta: { title: "노트 A", recency: "evergreen", confidence: "high", learnedAt: "2020-01-01" },
        body: "원래 본문입니다.",
      },
      "2020-01-01",
    );
    const fileA = makeFile("Second Brain/A.md", original);
    const { ctx, vault } = makeApplyContext([fileA]);

    const approved: Contradiction = {
      notePaths: ["Second Brain/A.md"],
      statements: ["X는 참", "X는 거짓"],
      suggestion: "X는 조건부로 참이다.",
    };

    const summary = await applyReconciliation(ctx, approved, "2024-06-15");

    // 승인 노트만 1회 갱신. 원자적 쓰기(process)를 써야 한다 — read→modify 왕복은
    // 읽은 뒤 쓰기 전에 들어온 사용자 편집을 덮어쓴다.
    expect(vault.process).toHaveBeenCalledTimes(1);
    expect(vault.modify).not.toHaveBeenCalled();
    expect(vault.create).not.toHaveBeenCalled();

    const updated = contentOf(fileA);
    const parsed = parseAiFirstNote(updated);
    // learned_at이 now로 갱신됨 (Bi_Temporal)
    expect(parsed.meta.learnedAt).toBe("2024-06-15");
    // 정정안이 본문에 병합됨
    expect(updated).toContain("X는 조건부로 참이다.");
    // 기존 사용자 본문(User_Region) 보존
    expect(updated).toContain("원래 본문입니다.");
    expect(summary).toContain("Second Brain/A.md");
  });

  it("승인되지 않은 노트는 변경하지 않는다", async () => {
    const original = buildAiFirstNote(
      { meta: { title: "A", recency: "evergreen", confidence: "medium", learnedAt: "2020-01-01" }, body: "A 본문" },
      "2020-01-01",
    );
    const fileA = makeFile("Second Brain/A.md", original);
    const fileB = makeFile("Second Brain/B.md", "건드리면 안 되는 B 노트");
    const { ctx, vault } = makeApplyContext([fileA, fileB]);

    // approved에는 A.md만 포함된다.
    const approved: Contradiction = {
      notePaths: ["Second Brain/A.md"],
      statements: ["s"],
      suggestion: "정정안",
    };

    await applyReconciliation(ctx, approved, "2024-06-15");

    // B.md는 읽기/쓰기 어느 것도 호출되지 않아야 한다.
    expect(vault.read).toHaveBeenCalledTimes(1);
    expect(vault.read).toHaveBeenCalledWith(fileA);
    expect(vault.process).toHaveBeenCalledTimes(1);
    expect(vault.process).toHaveBeenCalledWith(fileA, expect.any(Function));
    // B 노트 내용 불변
    expect(contentOf(fileB)).toBe("건드리면 안 되는 B 노트");
  });

  it("존재하지 않는 경로는 생성하지 않고 건너뛴다", async () => {
    const { ctx, vault } = makeApplyContext([]); // 어떤 노트도 없음

    const approved: Contradiction = {
      notePaths: ["Second Brain/없는노트.md"],
      statements: ["s"],
      suggestion: "정정안",
    };

    const summary = await applyReconciliation(ctx, approved, "2024-06-15");

    expect(vault.process).not.toHaveBeenCalled();
    expect(vault.modify).not.toHaveBeenCalled();
    expect(vault.create).not.toHaveBeenCalled();
    expect(summary).toContain("건너뜀");
  });

  it("비 AI-first 노트는 프론트매터 learned_at만 최소 갱신하고 본문(User_Region)을 보존한다", async () => {
    // 프론트매터가 없는 일반 노트
    const fileA = makeFile("Second Brain/plain.md", "# 일반 노트\n\n사용자가 직접 쓴 내용");
    const { ctx, vault } = makeApplyContext([fileA]);

    const approved: Contradiction = {
      notePaths: ["Second Brain/plain.md"],
      statements: ["s"],
      suggestion: "정정 제안",
    };

    await applyReconciliation(ctx, approved, "2024-06-15");

    expect(vault.process).toHaveBeenCalledTimes(1);
    const updated = contentOf(fileA);
    // 최소 프론트매터로 learned_at이 추가됨
    expect(updated).toContain("learned_at: 2024-06-15");
    // 기존 사용자 본문 보존
    expect(updated).toContain("사용자가 직접 쓴 내용");
    // 정정안이 Sentinel_Block으로 병합됨
    expect(updated).toContain("정정 제안");
  });

  it("notePaths가 비어 있으면 아무 노트도 변경하지 않는다", async () => {
    const fileA = makeFile("Second Brain/A.md", "내용");
    const { ctx, vault } = makeApplyContext([fileA]);

    const summary = await applyReconciliation(
      ctx,
      { notePaths: [], statements: [], suggestion: "x" },
      "2024-06-15",
    );

    expect(vault.process).not.toHaveBeenCalled();
    expect(vault.modify).not.toHaveBeenCalled();
    expect(summary).toContain("대상 노트가 없습니다");
  });

  it("자동(스케줄러) 경로는 applyReconciliation을 호출하지 않는다", () => {
    // Req 8.4/11.4: 덮어쓰기성 반영은 명시적 사용자 승인 경로 전용이므로, 스케줄러 모듈은
    // applyReconciliation을 절대 참조하지 않아야 한다. 소스 정적 검사로 분리됨을 단언한다.
    const schedulerSource = readFileSync(
      resolve(process.cwd(), "src/second-brain/scheduler.ts"),
      "utf-8",
    );
    expect(schedulerSource).not.toContain("applyReconciliation");

    // 또한 runReconcile 본문에서도 호출되지 않는다(비파괴 리포트 전용).
    const reconcileSource = readFileSync(
      resolve(process.cwd(), "src/second-brain/reconcile.ts"),
      "utf-8",
    );
    const runReconcileBody = reconcileSource.slice(
      reconcileSource.indexOf("export async function runReconcile"),
      reconcileSource.indexOf("export async function applyReconciliation"),
    );
    expect(runReconcileBody).not.toContain("applyReconciliation(");
  });
});

// ============================================
// runReconcileDetailed — 구조화된 결과 (승인 UI용)
// ============================================
/**
 * 승인 화면은 모순 목록을 구조화된 형태로 받아야 한다. 문자열 리포트만 돌려주면
 * 화면이 그것을 다시 파싱해야 하는데, LLM 응답을 이미 한 번 파싱해 놓고 그 결과를
 * 버리고 사람이 읽을 문장을 재파싱하는 것은 되돌릴 이유가 없는 정보 손실이다.
 */
describe("runReconcileDetailed — 구조화된 결과", () => {
  const TWO = JSON.stringify([
    {
      notePaths: ["A.md", "B.md"],
      statements: ["A는 X라고 한다", "B는 Y라고 한다"],
      suggestion: "최신 근거인 B를 채택하고 A에 단서를 추가한다",
    },
    {
      notePaths: ["C.md"],
      statements: ["C는 Z를 두 번 다르게 적었다"],
      suggestion: "Z의 정의를 하나로 통일한다",
    },
  ]);

  it("리포트와 모순 목록을 함께 돌려준다", async () => {
    const { ctx, vault } = makeContext({ items: [makeItem()] }, TWO);

    const outcome = await runReconcileDetailed(ctx, "주제 X");

    expect(outcome.contradictions).toHaveLength(2);
    expect(outcome.contradictions[0].notePaths).toEqual(["A.md", "B.md"]);
    expect(outcome.contradictions[1].suggestion).toContain("통일");
    expect(outcome.report).not.toBe("");
    // 여전히 비파괴다 — 반영은 별도 단계(applyReconciliation)의 책임이다.
    expectNoVaultWrites(vault);
  });

  it("runReconcile은 같은 리포트 문자열을 돌려준다(래퍼)", async () => {
    const a = await runReconcileDetailed(
      makeContext({ items: [makeItem()] }, TWO).ctx,
      "주제 X"
    );
    const b = await runReconcile(makeContext({ items: [makeItem()] }, TWO).ctx, "주제 X");

    expect(b).toBe(a.report);
  });

  it("주제가 비면 빈 목록이다", async () => {
    const { ctx } = makeContext({ items: [makeItem()] }, TWO);

    expect((await runReconcileDetailed(ctx, "   ")).contradictions).toEqual([]);
  });

  it("관련 노트가 없으면 빈 목록이다", async () => {
    const { ctx } = makeContext({ items: [] }, TWO);

    expect((await runReconcileDetailed(ctx, "없는 주제")).contradictions).toEqual([]);
  });

  it("모순 0건이면 빈 목록이다", async () => {
    const { ctx } = makeContext({ items: [makeItem()] }, "[]");

    const outcome = await runReconcileDetailed(ctx, "주제 X");
    expect(outcome.contradictions).toEqual([]);
    expect(outcome.report).toContain("발견된 모순이 없습니다");
  });

  it("응답 해석에 실패하면 빈 목록이고 '모순 없음'으로 오보고하지 않는다", async () => {
    // 승인 화면이 빈 목록을 "깨끗함"으로 오해하면 안 되므로 리포트가 실패를 명시한다.
    const { ctx } = makeContext({ items: [makeItem()] }, "JSON이 아닌 응답");

    const outcome = await runReconcileDetailed(ctx, "주제 X");
    expect(outcome.contradictions).toEqual([]);
    expect(outcome.report).toContain("해석할 수 없었습니다");
    expect(outcome.report).not.toContain("발견된 모순이 없습니다");
  });
});
