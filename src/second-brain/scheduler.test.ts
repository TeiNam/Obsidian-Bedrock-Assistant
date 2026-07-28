// 스케줄러(scheduler) 속성 기반 테스트 (fast-check 기반)
// =====================================================
// 순수 함수 `shouldRunScheduled`의 설계 Correctness Properties를 검증한다.
// 이 파일은 task 10.2(Property 12)가 생성하며, task 10.3(동시 실행/실패 격리
// 단위 테스트)이 이후 같은 파일에 append 한다.
// 현재 파일에는 Property 12(스케줄 트리거 판정 주기 경계)만 포함한다.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { shouldRunScheduled } from "./scheduler";

// 1시간을 밀리초로 환산한 상수 (구현과 동일한 경계 계산을 독립적으로 재현하기 위함).
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * 주기(intervalHours) 보정을 구현과 독립적으로 재현한 참조 함수.
 * 구현(`shouldRunScheduled` 내부)과 동일한 규칙:
 *  - 유한수가 아니면(NaN/±Infinity) 1로 보정
 *  - 가장 가까운 정수로 반올림, 1 미만은 1로 올림 (max(1, round(n)))
 * 테스트는 이 참조값으로 기대 경계를 산출하여 교차검증한다.
 */
function referenceIntervalMs(intervalHours: number): number {
  const safeHours = Number.isFinite(intervalHours)
    ? Math.max(1, Math.round(intervalHours))
    : 1;
  return safeHours * MS_PER_HOUR;
}

/**
 * lastRun(마지막 실행 시각) 제너레이터.
 * 미기록 신호(0/undefined)와 양수 timestamp(과거~먼 미래)를 모두 포함한다.
 */
function lastRunArb(): fc.Arbitrary<number | undefined> {
  return fc.oneof(
    fc.constant<undefined>(undefined), // 미기록
    fc.constant(0), // 미기록(0)
    fc.integer({ min: 1, max: 8.64e15 }), // 양수 timestamp
  );
}

/**
 * 주기(intervalHours) 제너레이터.
 * 정상 정수·비정수(소수)·1 미만·음수·특수값(NaN/±Infinity)을 모두 포함하여
 * 보정 로직(max(1, round(n)))을 폭넓게 자극한다.
 */
function intervalArb(): fc.Arbitrary<number> {
  return fc.oneof(
    fc.integer({ min: 1, max: 1000 }), // 정상 정수
    fc.integer({ min: -100, max: 100 }), // 0·음수·소규모 정수
    fc.double({ min: -5, max: 5, noNaN: true }), // 비정수(<1 포함)
    fc.constantFrom(NaN, Infinity, -Infinity, 0, -0, 0.4, 0.5, 1.49, 23.5, 24), // 경계 특수값
  );
}

/** 현재 시각(now) 제너레이터 — 임의 timestamp(음수 과거 ~ 먼 미래). */
function nowArb(): fc.Arbitrary<number> {
  return fc.integer({ min: -8.64e15, max: 8.64e15 });
}

describe("shouldRunScheduled — Property 12 (스케줄 트리거 판정 주기 경계)", () => {
  // Feature: second-brain-layer, Property 12: 스케줄 트리거 판정은 주기 경계를 지킨다
  // Validates: Requirements 11.2, 11.3
  it("반환값은 now >= lastRun + interval과 정확히 일치하고, lastRun 미기록(0/undefined)이면 항상 true이다", () => {
    fc.assert(
      fc.property(lastRunArb(), intervalArb(), nowArb(), (lastRun, intervalHours, now) => {
        const actual = shouldRunScheduled(lastRun, intervalHours, now);

        // 반환 타입은 항상 boolean이어야 한다.
        expect(typeof actual).toBe("boolean");

        if (lastRun === undefined || lastRun === 0) {
          // (1) lastRun 미기록 → 항상 true (Req 11.3)
          expect(actual).toBe(true);
        } else {
          // (2) 기록된 경우 → now >= lastRun + (보정된 주기)와 정확히 일치 (Req 11.2)
          const intervalMs = referenceIntervalMs(intervalHours);
          const expected = now >= lastRun + intervalMs;
          expect(actual).toBe(expected);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// =====================================================
// Task 10.3 — 동시 실행/실패 격리 단위 테스트 (append)
// =====================================================
// SecondBrainScheduler 실행 래퍼의 부수효과 계층 보장을 검증한다.
// - 동시 실행 가드: 실행 중 두 번째 트리거는 무시된다 (Req 11.5)
// - 단계 실패 격리: 한 단계가 throw 해도 나머지 단계가 계속되고
//   lastScheduledRun 갱신 + persist 호출이 보장된다 (Req 11.7, 11.6)
// - 옵트인 격리: enabled=false이면 startup 트리거가 파이프라인을 실행하지 않는다 (Req 1.6)
//
// 파이프라인은 직접 주입할 수 없으므로(CLEANUP_PIPELINE은 모듈 내부 상수),
// 가짜 Vault/Indexer 메서드를 통해 단계 동작을 관찰·제어한다.
// - 동시성: 첫 createFolder 호출을 제어 가능한 deferred로 만들어 파이프라인을
//   중간에 멈춘 상태에서 두 번째 트리거를 시도한다(running 가드 검증).
// - 실패 격리: indexer.getEntries가 throw 하도록 만들어 2단계(update-catalog)만
//   실패시키고, 그 뒤 단계(activity-log)의 vault.create가 여전히 호출되는지 본다.

import { vi } from "vitest";
import { SecondBrainScheduler, type SecondBrainContext } from "./scheduler";
import { DEFAULT_SECOND_BRAIN_SETTINGS, type SecondBrainSettings } from "../types";

/** 제어 가능한 Promise(deferred) — 외부에서 resolve 시점을 제어한다. */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolveFn!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn };
}

/** 테스트용 가짜 Vault 메서드 묶음 — 호출을 spy로 추적한다. */
interface MockVault {
  getAbstractFileByPath: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  modify: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
}

/** 테스트 컨텍스트 구성 결과 — 검증에 필요한 spy/핸들을 함께 노출한다. */
interface TestHarness {
  ctx: SecondBrainContext;
  vault: MockVault;
  persist: ReturnType<typeof vi.fn>;
  getEntries: ReturnType<typeof vi.fn>;
  settings: SecondBrainSettings;
}

/**
 * SecondBrainContext를 가짜 의존성으로 구성한다.
 *
 * @param overrides.firstCreateFolderDeferred 첫 createFolder 호출을 이 deferred로 묶어
 *   파이프라인을 중간에 멈춘다(동시성 테스트용). 이후 호출은 즉시 resolve된다.
 * @param overrides.getEntriesThrows true면 indexer.getEntries가 throw 한다(실패 격리 테스트용).
 * @param overrides.settings settings 일부를 덮어쓴다.
 */
function buildHarness(overrides: {
  firstCreateFolderDeferred?: { promise: Promise<void>; resolve: () => void };
  getEntriesThrows?: boolean;
  /** true면 모든 Vault 쓰기가 throw 하여 파이프라인 전 단계가 실패한다. */
  allStepsThrow?: boolean;
  settings?: Partial<SecondBrainSettings>;
} = {}): TestHarness {
  const settings: SecondBrainSettings = {
    ...DEFAULT_SECOND_BRAIN_SETTINGS,
    enabled: true,
    schedulerEnabled: true,
    schedulerIntervalHours: 24,
    lastScheduledRun: 0,
    ...overrides.settings,
  };

  // 모든 경로 조회는 null을 반환 → 폴더/파일 생성 경로(create/createFolder)를 타게 한다.
  const getAbstractFileByPath = vi.fn(() => null);

  // createFolder: 첫 호출만 제어 가능한 deferred로 묶고, 나머지는 즉시 완료.
  let createFolderCalls = 0;
  const createFolder = vi.fn(() => {
    createFolderCalls += 1;
    if (overrides.allStepsThrow) {
      return Promise.reject(new Error("의도적 단계 실패: createFolder"));
    }
    if (createFolderCalls === 1 && overrides.firstCreateFolderDeferred) {
      return overrides.firstCreateFolderDeferred.promise;
    }
    return Promise.resolve();
  });

  /** allStepsThrow가 켜지면 모든 쓰기 호출이 실패해 전 단계가 실패한다. */
  const failIfRequested = async (label: string): Promise<undefined> => {
    if (overrides.allStepsThrow) throw new Error(`의도적 단계 실패: ${label}`);
    return undefined;
  };

  const create = vi.fn(() => failIfRequested("create"));
  const modify = vi.fn(() => failIfRequested("modify"));
  const read = vi.fn(async () => "");

  const vault: MockVault = {
    getAbstractFileByPath,
    createFolder,
    create,
    modify,
    read,
  };

  // indexer.getEntries: 기본은 빈 배열, 옵션 시 throw로 2단계(update-catalog)를 실패시킨다.
  const getEntries = vi.fn(() => {
    if (overrides.getEntriesThrows || overrides.allStepsThrow) {
      throw new Error("의도적 단계 실패: getEntries");
    }
    return [];
  });

  const persist = vi.fn(async () => undefined);

  const ctx = {
    app: { vault } as unknown as SecondBrainContext["app"],
    indexer: { getEntries } as unknown as SecondBrainContext["indexer"],
    aiClient: {} as unknown as SecondBrainContext["aiClient"],
    settings,
    wikiFolder: settings.wikiFolder,
    persist,
  } as SecondBrainContext;

  return { ctx, vault, persist, getEntries, settings };
}

describe("SecondBrainScheduler — 동시 실행 가드 (Req 11.5)", () => {
  // Validates: Requirements 11.5
  it("파이프라인 실행 중 두 번째 runCleanupPipeline 트리거는 무시된다", async () => {
    const deferred = createDeferred();
    const { ctx, vault, persist } = buildHarness({
      firstCreateFolderDeferred: deferred,
    });
    const scheduler = new SecondBrainScheduler();
    const now = 1_000_000;

    // 첫 트리거 — await 하지 않는다. 첫 createFolder의 deferred에서 멈춘다.
    const first = scheduler.runCleanupPipeline(ctx, now);

    // 동기 실행이 첫 await(createFolder)까지 진행되어 running 가드가 켜져 있어야 한다.
    expect(scheduler.isRunning).toBe(true);

    // 두 번째 트리거 — running 가드로 즉시 무시되어야 한다(중복 실행 방지).
    await scheduler.runCleanupPipeline(ctx, now + 5);

    // 두 번째 호출이 무시되었으므로 첫 파이프라인은 아직 진행 중이고 persist는 미호출.
    expect(scheduler.isRunning).toBe(true);
    expect(persist).not.toHaveBeenCalled();

    // 멈춰 둔 단계를 풀어 첫 파이프라인을 끝까지 진행시킨다.
    deferred.resolve();
    await first;

    // 가드 해제 + persist는 단 한 번만(두 번째 트리거는 무시됨) 호출.
    expect(scheduler.isRunning).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    // 완료 시각으로 lastScheduledRun 갱신 (첫 트리거의 now).
    expect(ctx.settings.lastScheduledRun).toBe(now);
    // 첫 createFolder가 deferred였으므로 createFolder는 여러 번 호출되었다(파이프라인 진행 증거).
    expect(vault.createFolder).toHaveBeenCalled();
  });
});

describe("SecondBrainScheduler — 단계 실패 격리 (Req 11.7, 11.6)", () => {
  // Validates: Requirements 11.7, 11.6
  it("한 단계가 throw 해도 나머지 단계가 계속되고 lastScheduledRun 갱신 + persist 호출", async () => {
    // getEntries가 throw → 2단계(update-catalog)만 실패. 1·3단계는 정상 수행되어야 한다.
    const { ctx, vault, persist, getEntries } = buildHarness({
      getEntriesThrows: true,
    });
    const scheduler = new SecondBrainScheduler();
    const now = 2_000_000;

    // 단계 실패가 전체 실행을 중단시키지 않으므로 reject 없이 정상 완료해야 한다.
    // 반환값은 성공/실패 집계이며, 호출부가 이를 사용자에게 정확히 보고한다.
    const result = await scheduler.runCleanupPipeline(ctx, now);
    expect(result.ran).toBe(true);
    // 1·3단계 성공, 2단계(update-catalog) 실패가 집계에 반영되어야 한다.
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBeGreaterThan(0);
    expect(result.failedSteps).toContain("update-catalog");

    // 실패 단계(update-catalog)가 실제로 트리거되었는지 확인.
    expect(getEntries).toHaveBeenCalled();

    // 1단계(ensure-folders)는 실패 단계 이전이라 수행됨.
    expect(vault.createFolder).toHaveBeenCalled();

    // 3단계(activity-log)는 실패 단계 이후지만 계속 수행되어 log.md를 생성해야 한다(격리 증거).
    const createPaths = vault.create.mock.calls.map((call) => String(call[0]));
    expect(createPaths.some((p) => p.endsWith("log.md"))).toBe(true);

    // 일부 단계가 성공했으므로 완료 시각을 갱신하고 영속화한다 (Req 11.6).
    expect(ctx.settings.lastScheduledRun).toBe(now);
    expect(persist).toHaveBeenCalledTimes(1);

    // 가드는 finally에서 해제됨.
    expect(scheduler.isRunning).toBe(false);
  });

  it("모든 단계가 실패하면 lastScheduledRun을 갱신하지 않는다(다음 트리거에서 재시도)", async () => {
    // 전 단계 실패 시에도 완료 시각을 갱신하면 다음 주기(기본 24시간)까지 재시도가
    // 막혀 실패가 조용히 은닉된다.
    const { ctx, persist } = buildHarness({ allStepsThrow: true });
    const scheduler = new SecondBrainScheduler();
    const before = ctx.settings.lastScheduledRun;

    const result = await scheduler.runCleanupPipeline(ctx, 5_000_000);

    expect(result.ran).toBe(true);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBeGreaterThan(0);
    // 시각 유지 + 영속화 생략 → 다음 트리거에서 곧바로 재시도된다.
    expect(ctx.settings.lastScheduledRun).toBe(before);
    expect(persist).not.toHaveBeenCalled();
    expect(scheduler.isRunning).toBe(false);
  });
});

describe("SecondBrainScheduler — 옵트인 격리 (Req 1.6)", () => {
  // Validates: Requirements 1.6
  it("enabled=false이면 maybeRunOnStartup이 파이프라인을 실행하지 않는다(쓰기/persist 없음)", async () => {
    // enabled=false 외 조건은 모두 트리거 충족(schedulerEnabled=true, lastScheduledRun=0).
    const { ctx, vault, persist } = buildHarness({
      settings: { enabled: false, schedulerEnabled: true, lastScheduledRun: 0 },
    });
    const scheduler = new SecondBrainScheduler();
    const now = 3_000_000;

    await scheduler.maybeRunOnStartup(ctx, now);

    // 어떤 Vault 쓰기도, 영속화도 발생하지 않아야 한다.
    expect(vault.createFolder).not.toHaveBeenCalled();
    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.modify).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();

    // lastScheduledRun도 변경되지 않아야 한다(초기값 유지).
    expect(ctx.settings.lastScheduledRun).toBe(0);
    expect(scheduler.isRunning).toBe(false);
  });
});
