// 사고 도구(thinking-tools) 속성 기반 테스트 (fast-check 기반)
// ===========================================================
// 순수 함수 모듈 `thinking-tools.ts`의 설계 Correctness Properties를 검증한다.
// 이 파일은 task 8.2(Property 11)와 task 8.4(단위 테스트 추가)가 공유한다.
// 현재 파일에는 Property 11(최근 노트 선별 경계)만 포함한다.

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

import {
  selectRecentNotes,
  runChallenge,
  runConnect,
  runEmerge,
} from "./thinking-tools";
import { SECOND_BRAIN_SYSTEM_PROMPT } from "./search-adapter";
import type { SecondBrainContext } from "./scheduler";
import type { VaultIndexEntry } from "../types";
import type { GraphRagResult } from "../vault-indexer";
import { TOOL_I18N } from "../tool-result-i18n";

// 하루를 밀리초로 환산한 상수 (구현과 동일한 경계 계산을 독립적으로 재현하기 위함).
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 일수(N) 보정을 구현과 독립적으로 재현한 참조 함수.
 * 구현(`normalizeDays`)과 동일한 규칙:
 *  - 유한수가 아니면(NaN/±Infinity) 1로 보정
 *  - 가장 가까운 정수로 반올림, 1 미만은 1로 올림
 * 테스트는 이 참조값으로 기대 cutoff를 산출하여 교차검증한다.
 */
function referenceNormalizeDays(days: number): number {
  if (!Number.isFinite(days)) return 1;
  const rounded = Math.round(days);
  return rounded < 1 ? 1 : rounded;
}

/**
 * 최소 VaultIndexEntry를 생성하는 제너레이터.
 * Property 11은 `lastModified`만 사용하므로 나머지 필수 필드는 결정론적 더미값으로 채운다.
 * (path는 순번으로 유일하게 만들어 결과 비교 시 항목을 구분 가능하게 한다.)
 */
function entryArb(): fc.Arbitrary<Omit<VaultIndexEntry, "path">> {
  return fc.record({
    embedding: fc.constant<number[]>([]),
    // lastModified는 경계 검증의 핵심이므로 넓은 정수 범위(음수~매우 큰 미래 시각)에서 생성
    lastModified: fc.integer({ min: -8.64e15, max: 8.64e15 }),
    title: fc.string(),
    excerpt: fc.string(),
  });
}

/** 항목 배열 제너레이터 — 각 항목에 유일한 path를 부여한다. */
function entriesArb(): fc.Arbitrary<VaultIndexEntry[]> {
  return fc
    .array(entryArb(), { maxLength: 30 })
    .map((partials) =>
      partials.map((p, i): VaultIndexEntry => ({ path: `note-${i}.md`, ...p })),
    );
}

/**
 * 일수(N) 제너레이터.
 * 0·음수·비정수·매우 큰 값·특수값(NaN/±Infinity)을 모두 포함하여 보정 로직을 폭넓게 자극한다.
 */
function daysArb(): fc.Arbitrary<number> {
  return fc.oneof(
    fc.integer({ min: -100, max: 100 }), // 0·음수·소규모 정수
    fc.integer({ min: 1, max: 1_000_000 }), // 대규모 정수
    fc.double({ min: -10, max: 10, noNaN: true }), // 비정수(소수)
    fc.constantFrom(NaN, Infinity, -Infinity, 0, -0, 0.4, 0.5, 1.49), // 경계 특수값
  );
}

/** 경로 오름차순 비교자 — 정렬 순서와 무관하게 집합 동일성을 비교할 때 사용한다. */
function byPathAsc(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

describe("selectRecentNotes — Property 11 (최근 노트 선별 경계)", () => {
  // Feature: second-brain-layer, Property 11: 최근 노트 선별은 N일 경계를 지킨다
  // Validates: Requirements 9.4, 9.5
  it("반환 항목은 보정된 N일 경계(lastModified >= now - N*day)를 지키고, 결과는 필터 집합과 동일하다", () => {
    fc.assert(
      fc.property(
        entriesArb(),
        daysArb(),
        // now는 임의 timestamp (음수 과거 ~ 먼 미래)
        fc.integer({ min: -8.64e15, max: 8.64e15 }),
        (entries, days, now) => {
          const corrected = referenceNormalizeDays(days);

          // 보정된 N은 1 이상 정수여야 한다 (Req 9.5)
          expect(Number.isInteger(corrected)).toBe(true);
          expect(corrected).toBeGreaterThanOrEqual(1);

          const cutoff = now - corrected * MILLIS_PER_DAY;
          const result = selectRecentNotes(entries, days, now);

          // (1) 반환된 모든 항목은 경계 이내(lastModified >= cutoff)여야 한다 (Req 9.4)
          for (const entry of result) {
            expect(entry.lastModified).toBeGreaterThanOrEqual(cutoff);
          }

          // (2) 결과는 cutoff 기준 필터 집합과 동일한 원소를 가져야 한다.
          //     포함되어야 할 항목이 누락되지 않고, 제외되어야 할 항목이 포함되지 않는다.
          //     단 순서는 입력 순서가 아니라 최신순이다(호출부가 개수를 제한할 때
          //     최신 노트가 남도록 보장하기 위한 계약).
          const expected = entries.filter((e) => e.lastModified >= cutoff);
          expect(result).toHaveLength(expected.length);
          expect([...result].sort(byPathAsc)).toEqual([...expected].sort(byPathAsc));

          // (2-1) 최신순(lastModified 내림차순) 정렬이 보장된다.
          for (let i = 1; i < result.length; i++) {
            expect(result[i - 1].lastModified).toBeGreaterThanOrEqual(result[i].lastModified);
          }

          // (3) 입력 배열을 변경하지 않는다(순수성).
          expect(result).not.toBe(entries);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ===========================================================================
// Task 8.4 — 사고 도구 실행 단위 테스트 (runChallenge / runConnect / runEmerge)
// ---------------------------------------------------------------------------
// 순수 함수(Property 11)와 달리 run* 래퍼는 검색/인덱서 열거/LLM 호출을 묶는 얇은
// I/O 계층이다. 여기서는 검색(search)·getEntries·converseLight를 모킹하여 다음을
// 검증한다.
//  - runChallenge: 검색한 노트를 근거(grounding)로 프롬프트에 포함하고, LLM 텍스트를
//    반환하며, 기본적으로 어떤 노트도 쓰지 않는다 (Req 9.2)
//  - runConnect: 두 주제 각각의 검색 결과로 교차 컨텍스트를 구성한다 (Req 9.3)
//  - runEmerge: 검색이 아니라 indexer.getEntries()로 후보 집합을 얻어 selectRecentNotes로
//    선별한다 (Req 9.6) — search는 호출되지 않아야 한다
// 모든 테스트는 Vault 쓰기(생성/수정/추가)가 발생하지 않음을 함께 단언한다.

/** GraphRagResult를 간단히 만드는 헬퍼 (점수·hop은 검증에 불필요하므로 더미값). */
function makeResult(
  items: Array<{ path: string; title: string; excerpt: string }>,
): GraphRagResult {
  return {
    items: items.map((it) => ({
      ...it,
      combinedScore: 1,
      vectorScore: 1,
      hop: 0,
      isSeed: true,
      seedPath: null,
    })),
  };
}

/** VaultIndexEntry를 간단히 만드는 헬퍼. */
function makeEntry(
  path: string,
  title: string,
  excerpt: string,
  lastModified: number,
): VaultIndexEntry {
  return { path, embedding: [], lastModified, title, excerpt };
}

/**
 * 테스트용 SecondBrainContext + 스파이 묶음을 만든다.
 *  - indexer.search: GraphRagResult를 반환하는 vi.fn (쿼리별 응답을 구성할 수 있게 구현 주입 가능)
 *  - indexer.getEntries: 인덱싱 스냅샷(VaultIndexEntry[])을 반환하는 vi.fn
 *  - aiClient.converseLight: 전달된 프롬프트/시스템 프롬프트를 캡처하고 고정 텍스트를 반환
 *  - app.vault.{create,modify,append,createFolder}: 쓰기 감지용 스파이 (호출되면 안 됨)
 */
function makeContext(opts: {
  searchImpl?: (query: string) => GraphRagResult;
  entries?: VaultIndexEntry[];
  llmText?: string;
}) {
  const search = vi.fn(async (query: string) =>
    opts.searchImpl ? opts.searchImpl(query) : makeResult([]),
  );
  const getEntries = vi.fn(() => opts.entries ?? []);
  const converseLight = vi.fn(async () => ({ text: opts.llmText ?? "LLM 응답" }));

  // Vault 쓰기 감지용 스파이 — run* 래퍼는 읽기 전용이므로 어느 것도 호출되면 안 된다.
  const create = vi.fn();
  const modify = vi.fn();
  const append = vi.fn();
  const createFolder = vi.fn();

  const ctx = {
    app: { vault: { create, modify, append, createFolder } },
    indexer: { search, getEntries },
    aiClient: { converseLight },
  } as unknown as SecondBrainContext;

  return { ctx, search, getEntries, converseLight, create, modify, append, createFolder };
}

/** 주어진 쓰기 스파이들이 모두 호출되지 않았음을 단언한다(읽기 전용 보장, Req 9.2). */
function expectNoVaultWrites(spies: {
  create: ReturnType<typeof vi.fn>;
  modify: ReturnType<typeof vi.fn>;
  append: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
}) {
  expect(spies.create).not.toHaveBeenCalled();
  expect(spies.modify).not.toHaveBeenCalled();
  expect(spies.append).not.toHaveBeenCalled();
  expect(spies.createFolder).not.toHaveBeenCalled();
}

describe("runChallenge — 실행 단위 테스트 (Req 9.2)", () => {
  it("검색한 노트를 근거로 프롬프트에 포함하고, LLM 텍스트를 반환하며, 노트를 쓰지 않는다", async () => {
    const t = makeContext({
      searchImpl: () =>
        makeResult([
          { path: "notes/cost.md", title: "비용 절감 메모", excerpt: "캐싱으로 비용이 줄었다." },
        ]),
      llmText: "이 주장에는 다음과 같은 허점이 있습니다.",
    });

    const result = await runChallenge(t.ctx, "캐싱은 항상 좋다");

    // 검색이 주장으로 수행되었다.
    expect(t.search).toHaveBeenCalledWith("캐싱은 항상 좋다");

    // converseLight가 한 번 호출되고, 프롬프트에 검색한 노트의 제목/발췌가 근거로 포함된다.
    expect(t.converseLight).toHaveBeenCalledTimes(1);
    const [prompt, systemPrompt] = t.converseLight.mock.calls[0];
    expect(prompt).toContain("비용 절감 메모");
    expect(prompt).toContain("캐싱으로 비용이 줄었다.");
    expect(prompt).toContain("캐싱은 항상 좋다"); // 현재 주장도 컨텍스트에 포함
    expect(systemPrompt).toBe(SECOND_BRAIN_SYSTEM_PROMPT);

    // LLM 응답 텍스트를 그대로 반환한다.
    expect(result).toBe("이 주장에는 다음과 같은 허점이 있습니다.");

    // 기본 읽기 전용: 어떤 노트도 쓰지 않는다 (Req 9.2).
    expectNoVaultWrites(t);
  });

  it("관련 노트가 없으면 LLM을 호출하지 않고 안내만 반환한다(읽기 전용)", async () => {
    const t = makeContext({ searchImpl: () => makeResult([]) });

    const result = await runChallenge(t.ctx, "근거 없는 주장");

    expect(t.search).toHaveBeenCalledWith("근거 없는 주장");
    expect(t.converseLight).not.toHaveBeenCalled();
    expect(result).toContain("근거 없는 주장");
    expectNoVaultWrites(t);
  });
});

describe("runConnect — 실행 단위 테스트 (Req 9.3)", () => {
  it("두 주제 각각의 검색 결과로 교차 컨텍스트를 구성한다", async () => {
    const t = makeContext({
      // 주제별로 서로 다른 노트를 반환하여 교차 컨텍스트 구성 여부를 검증한다.
      searchImpl: (query) => {
        if (query === "분산 시스템") {
          return makeResult([
            { path: "a.md", title: "합의 알고리즘", excerpt: "Raft와 Paxos 비교." },
          ]);
        }
        return makeResult([
          { path: "b.md", title: "생물 진화", excerpt: "자연선택과 적응." },
        ]);
      },
      llmText: "두 주제를 잇는 아이디어입니다.",
    });

    const result = await runConnect(t.ctx, "분산 시스템", "생물 진화");

    // 두 주제 각각으로 검색이 수행된다 (Req 9.3).
    expect(t.search).toHaveBeenCalledTimes(2);
    expect(t.search).toHaveBeenCalledWith("분산 시스템");
    expect(t.search).toHaveBeenCalledWith("생물 진화");

    // 교차 컨텍스트 프롬프트에 두 주제와 양쪽 검색 결과가 모두 포함된다.
    expect(t.converseLight).toHaveBeenCalledTimes(1);
    const [prompt] = t.converseLight.mock.calls[0];
    expect(prompt).toContain("분산 시스템");
    expect(prompt).toContain("생물 진화");
    expect(prompt).toContain("합의 알고리즘"); // 주제 A 검색 결과
    expect(prompt).toContain("Raft와 Paxos 비교.");
    expect(prompt).toContain("자연선택과 적응."); // 주제 B 검색 결과

    expect(result).toBe("두 주제를 잇는 아이디어입니다.");
    expectNoVaultWrites(t);
  });
});

describe("runEmerge — 실행 단위 테스트 (Req 9.6)", () => {
  it("검색이 아니라 getEntries()로 후보를 얻고 selectRecentNotes로 선별한다", async () => {
    const now = 1_000_000_000_000; // 고정 기준 시각
    const day = 24 * 60 * 60 * 1000;
    // 최근(2일 전)과 오래된(10일 전) 노트를 섞어 전체 스냅샷을 구성한다.
    const recent = makeEntry("recent.md", "최근 메모", "어제 떠오른 생각.", now - 2 * day);
    const old = makeEntry("old.md", "오래된 메모", "지난주 메모.", now - 10 * day);

    const t = makeContext({
      entries: [recent, old],
      llmText: "최근 노트에서 떠오르는 패턴입니다.",
    });

    const result = await runEmerge(t.ctx, 3, now); // 최근 3일

    // emerge는 인덱스 전체 스냅샷(getEntries)을 사용하고, 검색(search)은 사용하지 않는다 (Req 9.6).
    expect(t.getEntries).toHaveBeenCalledTimes(1);
    expect(t.search).not.toHaveBeenCalled();

    // selectRecentNotes(3일)로 최근 노트만 프롬프트에 포함되고, 오래된 노트는 제외된다.
    expect(t.converseLight).toHaveBeenCalledTimes(1);
    const [prompt, systemPrompt] = t.converseLight.mock.calls[0];
    expect(prompt).toContain("최근 메모");
    expect(prompt).toContain("어제 떠오른 생각.");
    expect(prompt).not.toContain("오래된 메모");
    expect(systemPrompt).toBe(SECOND_BRAIN_SYSTEM_PROMPT);

    expect(result).toBe("최근 노트에서 떠오르는 패턴입니다.");
    expectNoVaultWrites(t);
  });

  it("getEntries()가 반환한 전체 스냅샷이 emerge의 후보 집합으로 사용된다", async () => {
    const now = 2_000_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    // 모두 최근(N일 이내)인 세 항목 — 전체 스냅샷이 빠짐없이 프롬프트에 반영되는지 확인한다.
    const entries = [
      makeEntry("n1.md", "노트 하나", "내용 하나.", now - 1 * day),
      makeEntry("n2.md", "노트 둘", "내용 둘.", now - 2 * day),
      makeEntry("n3.md", "노트 셋", "내용 셋.", now - 3 * day),
    ];
    const t = makeContext({ entries, llmText: "패턴." });

    await runEmerge(t.ctx, 7, now); // 최근 7일 → 세 항목 모두 포함

    expect(t.getEntries).toHaveBeenCalledTimes(1);
    expect(t.search).not.toHaveBeenCalled();

    const [prompt] = t.converseLight.mock.calls[0];
    // getEntries 스냅샷의 모든 항목 제목이 프롬프트에 포함되어야 한다.
    for (const entry of entries) {
      expect(prompt).toContain(entry.title);
    }
    expectNoVaultWrites(t);
  });

  it("최근 N일 내 노트가 없으면 LLM을 호출하지 않고 안내만 반환한다", async () => {
    const now = 3_000_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    const t = makeContext({
      entries: [makeEntry("stale.md", "오래된 노트", "옛 내용.", now - 30 * day)],
    });

    const result = await runEmerge(t.ctx, 5, now);

    expect(t.getEntries).toHaveBeenCalledTimes(1);
    expect(t.search).not.toHaveBeenCalled();
    expect(t.converseLight).not.toHaveBeenCalled();
    expect(result).toBe(TOOL_I18N.en.emergeNoRecent(5));
    expectNoVaultWrites(t);
  });
});
