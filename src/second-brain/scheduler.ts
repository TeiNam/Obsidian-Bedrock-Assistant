// 스케줄러 + 백그라운드 에이전트 (Scheduler)
// ============================================
// Second Brain Layer의 비파괴 정리 파이프라인(Cleanup_Pipeline)을 수동 명령 또는
// 앱 시작 시 자동으로 실행하는 컴포넌트다. 트리거 판정(shouldRunScheduled)은 순수
// 함수로 분리하여 속성 기반 테스트가 가능하게 하고, 실제 파이프라인 실행은 Vault/AI
// 접근이 필요하므로 SecondBrainScheduler 클래스의 실행 래퍼로 격리한다(graph-rag 모듈과
// 동일한 "순수 코어 + 얇은 I/O 래퍼" 패턴).
//
// 핵심 보장:
// - 트리거 판정은 now >= lastRun + interval (Req 11.2), lastRun 미기록이면 항상 true (Req 11.3)
// - 자동 트리거는 schedulerEnabled가 true일 때만 동작 (Req 11.1)
// - 옵트인 격리: enabled가 false이면 어떤 동작도 하지 않는다 (Req 1.6)
// - 비파괴 작업(카탈로그 갱신/활동 로그)만 자동 수행, 노트 덮어쓰기 없음 (Req 11.4)
// - 동시 실행 가드로 중복 트리거 무시 (Req 11.5)
// - 파이프라인 단계 실패는 기록 후 나머지 단계 계속 (Req 11.7)
// - 완료 시 lastScheduledRun 갱신·영속화 (Req 11.6)

import { App } from "obsidian";
import type { IAiClient, SecondBrainSettings } from "../types";
import type { VaultIndexer } from "../vault-indexer";
import {
  ensureWikiFolders,
  writeIndexCatalog,
  appendActivityLog,
  buildIndexCatalog,
  WIKI_CATEGORIES,
  type CatalogEntry,
} from "./wiki-structure";
import { collectGaps, buildGapReport, writeGapReport } from "./knowledge-gaps";
import type { Locale } from "../types";
import { refreshBasesDashboard } from "./bases-dashboard";

/**
 * Second Brain 실행 컨텍스트 (실행 래퍼에 주입).
 *
 * synthesize/reconcile/thinking/architect/scheduler 등 모든 실행 래퍼가 공유하는
 * 단일 컨텍스트 객체다. 후속 와이어링(Task 11.2)이 main.ts에서 이 객체를 구성하여
 * 주입하므로 여기서 정의·export 하여 단일 출처로 둔다.
 *
 * 영속화 규약 (Req 11.6): `settings`는 플러그인의 `this.settings.secondBrain`을 가리키는
 * 동일 참조여야 한다(복사본 아님). 스케줄러가 `ctx.settings.lastScheduledRun = now`로 갱신한
 * 값이 `this.settings`에 반영되고, 이어서 `await ctx.persist()`(= `this.saveSettings()`)가
 * 디스크에 기록한다.
 */
export interface SecondBrainContext {
  /** Obsidian 앱 인스턴스 (Vault 접근용) */
  app: App;
  /** 기존 Graph RAG 인덱서 — search/getEntries 재사용 */
  indexer: VaultIndexer;
  /** 기존 백엔드 AI 클라이언트 (백엔드 무관) */
  aiClient: IAiClient;
  /** Second Brain 설정 — this.settings.secondBrain의 동일 참조 (Req 11.6) */
  settings: SecondBrainSettings;
  /** 정규화된 Wiki_Folder 경로 (settings.wikiFolder) */
  wikiFolder: string;
  /**
   * 표시 언어. 도구가 돌려주는 문자열은 화면에 그대로 뜨므로 사용자 언어를 따른다.
   *
   * `settings`는 SecondBrainSettings(Second Brain 전용)라 language를 갖지 않는다.
   * 미지정 시 en으로 폴백한다.
   */
  locale?: Locale;
  /**
   * settings 변경(lastScheduledRun 등)을 디스크에 영속화하는 콜백 (Req 11.6).
   * main.ts에서 `() => this.saveSettings()`를 주입하여 기존 저장 경로를 재사용한다.
   */
  persist: () => Promise<void>;
}

/** 1시간을 밀리초로 환산한 상수 (트리거 주기 계산용). */
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * 전 단계가 실패한 직후 다음 자동 시도까지의 최소 간격.
 *
 * lastScheduledRun은 한 단계라도 성공했을 때만 갱신된다(Req 11.6) — 전멸한 실행은
 * 시각을 남기지 않아 다음 트리거에서 곧바로 재시도된다. 앱 시작 시에만 트리거될 때는
 * 합리적이었지만, 주기 tick이 붙은 뒤로는 원인이 지속되는 실패(잘못된 API 키, 만료된
 * 자격증명)에서 tick마다 영원히 재시도하게 된다.
 *
 * 이 냉각 시간은 의도적으로 영속화하지 않는다. 프로세스 생명주기만 기억하면 되고,
 * 사용자가 설정을 고쳐 재시작했을 때는 즉시 다시 시도하는 쪽이 맞다.
 */
const FAILED_RUN_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * 스케줄 트리거 판정 — 순수 함수 (Req 11.2, 11.3, Property 12).
 *
 * 현재 시각(now)이 (마지막 실행 시각 + 주기) 이상이면 true, 아니면 false를 반환한다.
 * 마지막 실행 시각이 미기록(undefined 또는 0)이면 최초 실행으로 보고 항상 true를 반환한다.
 *
 * @param lastRun 마지막 Cleanup_Pipeline 실행 시각 (epoch ms). 미기록이면 0/undefined.
 * @param intervalHours 트리거 주기 (시간 단위). 비정상 값은 1 이상으로 보정한다.
 * @param now 현재 시각 (epoch ms). 테스트 가능성을 위해 주입한다.
 */
export function shouldRunScheduled(
  lastRun: number | undefined,
  intervalHours: number,
  now: number,
): boolean {
  // 마지막 실행 시각 미기록(최초 실행) → 항상 true (Req 11.3)
  if (lastRun === undefined || lastRun === 0) return true;

  // 주기를 1 이상 정수로 보정한다(설정 정규화와 동일 규약, 방어적 보정).
  const safeHours = Number.isFinite(intervalHours)
    ? Math.max(1, Math.round(intervalHours))
    : 1;
  const intervalMs = safeHours * MS_PER_HOUR;

  // now >= lastRun + interval 과 정확히 일치 (Req 11.2)
  return now >= lastRun + intervalMs;
}

/**
 * Cleanup_Pipeline 단계 — 컨텍스트를 받아 비파괴 작업을 수행하는 비동기 함수.
 * 각 단계는 독립적으로 try/catch로 감싸여 실행되므로, 한 단계가 실패해도 나머지 단계가
 * 계속된다(Req 11.7).
 */
interface PipelineStep {
  /** 로깅·진단용 단계 이름 */
  name: string;
  /** 단계 실행 본체 */
  run: (ctx: SecondBrainContext, now: number) => Promise<void>;
}

/**
 * 인덱스 항목 경로에서 Wiki_Folder 기준 카테고리를 추론한다.
 * 예: "Second Brain/entities/foo.md" → "entities". 카테고리 폴더가 없으면 빈 문자열을
 * 반환하여 buildIndexCatalog가 "기타"로 분류하게 한다 (Req 4.6).
 */
function inferCategory(path: string, wikiFolder: string): string {
  const prefix = `${wikiFolder}/`;
  if (!path.startsWith(prefix)) return "";
  const rest = path.slice(prefix.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex < 0) return ""; // Wiki_Folder 루트 직속 노트 → 미분류
  const category = rest.slice(0, slashIndex);
  return (WIKI_CATEGORIES as readonly string[]).includes(category) ? category : "";
}

/**
 * 비파괴 Cleanup_Pipeline 단계 정의 (Req 11.4).
 *
 * 노트 덮어쓰기성 작업(synthesize/reconcile 반영 등)은 사용자 확인을 유지해야 하므로
 * 자동 파이프라인에서 제외한다. 여기서는 다음 비파괴 작업만 수행한다.
 * 1) ensure-folders: Wiki_Folder/카테고리 폴더 보장(없으면 생성, 있으면 유지)
 * 2) update-catalog: 인덱스의 Wiki_Folder 노트로 카탈로그를 빌드하여 index.md 갱신
 *    (catalog Sentinel_Block만 교체 → 사용자 메모 보존)
 * 3) knowledge-gaps: 구조적 공백(깨진 링크·스텁·고아·단방향)을 계산해 리포트 갱신
 *    (LLM 호출 없음, sentinel 블록만 교체 → 사용자 메모 보존)
 * 4) bases-dashboard: 결정·미해결 질문·오래된 지식·복습 큐 Base 갱신
 * 5) activity-log: 스케줄 실행 이력을 log.md에 한 줄 append(기존 로그 불변)
 */
const CLEANUP_PIPELINE: PipelineStep[] = [
  {
    name: "ensure-folders",
    run: async (ctx) => {
      await ensureWikiFolders(ctx.app, ctx.wikiFolder);
    },
  },
  {
    name: "update-catalog",
    run: async (ctx) => {
      // 인덱싱된 전체 항목 중 Wiki_Folder 하위 노트만 카탈로그 대상으로 수집한다.
      const prefix = `${ctx.wikiFolder}/`;
      const catalogEntries: CatalogEntry[] = ctx.indexer
        .getEntries()
        .filter((entry) => entry.path.startsWith(prefix) && /\.md$/i.test(entry.path))
        .map((entry) => ({
          path: entry.path,
          title: entry.title,
          category: inferCategory(entry.path, ctx.wikiFolder),
        }));

      const catalog = buildIndexCatalog(catalogEntries, ctx.locale);
      // 카탈로그 본문은 catalog Sentinel_Block으로만 교체된다(User_Region 보존, Req 4.4).
      await writeIndexCatalog(ctx.app, ctx.wikiFolder, catalog);
    },
  },
  {
    name: "knowledge-gaps",
    run: async (ctx) => {
      // 구조적 공백을 로컬 계산한다(LLM 호출 0회). 인덱스는 존재하는 링크만
      // 보존하므로 깨진 링크는 metadataCache에서 따로 가져온다.
      // metadataCache가 없거나 아직 채워지지 않은 환경(초기 로드·테스트 스텁)에서도
      // 이 단계가 실패하지 않아야 한다. 깨진 링크 정보만 비어 있을 뿐, 나머지 세
      // 지표(스텁·고아·단방향)는 인덱스만으로 계산된다.
      const unresolved =
        (ctx.app.metadataCache as
          | { unresolvedLinks?: Record<string, Record<string, number>> }
          | undefined)?.unresolvedLinks ?? {};
      const gaps = collectGaps(ctx.indexer.getEntries(), unresolved, ctx.wikiFolder);
      await writeGapReport(ctx.app, ctx.wikiFolder, buildGapReport(gaps, ctx.locale));
    },
  },
  {
    name: "bases-dashboard",
    run: async (ctx, now) => {
      await refreshBasesDashboard(ctx, now);
    },
  },
  {
    name: "activity-log",
    run: async (ctx) => {
      await appendActivityLog(
        ctx.app,
        ctx.wikiFolder,
        "스케줄 정리 실행(catalog·공백 리포트·Bases 대시보드 갱신)"
      );
    },
  },
];

/**
 * Second Brain 스케줄러 — 비파괴 Cleanup_Pipeline 실행 래퍼 (Req 11.4~11.7).
 *
 * 동시 실행 가드(running 플래그)로 중복 트리거를 무시하고, 각 파이프라인 단계를 개별
 * try/catch로 감싸 실패 격리한다. 완료 시 lastScheduledRun을 갱신하고 영속화한다.
 */
/** Cleanup_Pipeline 실행 결과. 호출부가 성공/실패를 사용자에게 정확히 알리는 데 사용한다. */
export interface CleanupRunResult {
  /** 실제로 실행되었는지(동시 실행 가드로 무시된 경우 false) */
  ran: boolean;
  /** 성공한 단계 수 */
  succeeded: number;
  /** 실패한 단계 수 */
  failed: number;
  /** 실패한 단계 이름 목록 */
  failedSteps: string[];
}

export class SecondBrainScheduler {
  /** 동시 실행 가드 (Req 11.5). 파이프라인 실행 중이면 true. */
  private running = false;

  /**
   * 전 단계가 실패한 마지막 자동 시도 시각. 0이면 그런 실패가 없었다는 뜻이다.
   * 영속화하지 않는다(FAILED_RUN_COOLDOWN_MS 주석 참고).
   */
  private lastFailedAttemptAt = 0;

  /** 실행 중 여부 (진단/테스트용 읽기 전용 노출). */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Cleanup_Pipeline을 실행한다 (Req 11.4~11.7).
   *
   * - 이미 실행 중이면(running) 즉시 반환하여 중복 실행을 막는다 (Req 11.5).
   * - 각 단계는 독립 try/catch로 감싸 실패해도 다음 단계를 계속한다 (Req 11.7).
   * - finally에서 lastScheduledRun을 완료 시점(now)으로 갱신하고 영속화한 뒤
   *   가드를 해제한다 (Req 11.6). now는 트리거 시점에 주입된 값이다.
   *
   * @param ctx Second Brain 실행 컨텍스트
   * @param now 트리거 시각 (epoch ms). lastScheduledRun 완료 시각으로 사용된다.
   */
  async runCleanupPipeline(ctx: SecondBrainContext, now: number): Promise<CleanupRunResult> {
    // 동시 실행 가드 — 두 번째 트리거는 무시한다 (Req 11.5)
    if (this.running) return { ran: false, succeeded: 0, failed: 0, failedSteps: [] };
    this.running = true;

    let succeeded = 0;
    const failedSteps: string[] = [];

    try {
      for (const step of CLEANUP_PIPELINE) {
        try {
          await step.run(ctx, now);
          succeeded++;
        } catch (error) {
          // 단계 실패는 기록만 하고 나머지 단계를 계속 수행한다 (Req 11.7).
          const reason = error instanceof Error ? error.message : String(error);
          failedSteps.push(step.name);
          console.error(`[SecondBrainScheduler] 파이프라인 단계 실패 (${step.name}): ${reason}`);
        }
      }
    } finally {
      // lastScheduledRun은 "한 단계라도 성공했을 때"만 완료 시각으로 갱신한다 (Req 11.6).
      //
      // 전 단계가 실패했는데도 갱신하면 다음 주기(기본 24시간)까지 재시도가 막혀
      // 실패가 조용히 은닉된다. 전부 실패한 경우 시각을 유지해 다음 트리거에서
      // 곧바로 재시도되게 한다.
      if (succeeded > 0) {
        // settings는 this.settings.secondBrain의 동일 참조이므로 이 갱신이 플러그인 설정에 반영된다.
        ctx.settings.lastScheduledRun = now;
        try {
          await ctx.persist();
        } catch (error) {
          // 영속화 실패도 가드 해제를 막지 않도록 기록만 한다.
          const reason = error instanceof Error ? error.message : String(error);
          console.error(`[SecondBrainScheduler] 설정 영속화 실패: ${reason}`);
        }
      }
      // 가드 해제 — 다음 트리거 허용
      this.running = false;
    }

    return {
      ran: true,
      succeeded,
      failed: failedSteps.length,
      failedSteps,
    };
  }

  /**
   * 자동 트리거 (Req 11.1). 앱 시작(onLayoutReady)과 주기 tick 양쪽에서 호출한다.
   *
   * 다음 조건을 모두 만족할 때만 Cleanup_Pipeline을 실행한다.
   * - 기능이 활성(enabled)일 것 — 옵트인 격리 (Req 1.6)
   * - 자동 스케줄러가 활성(schedulerEnabled)일 것 (Req 11.1)
   * - 트리거 조건(shouldRunScheduled)을 만족할 것 (Req 11.2, 11.3)
   * - 직전 실행이 전멸했다면 냉각 시간이 지났을 것
   *
   * 조건 검사를 전부 품고 있으므로 호출부는 무조건 불러도 안전하다. 주기 tick이
   * 자주 돌아도 대부분은 여기서 즉시 반환한다.
   *
   * @param ctx Second Brain 실행 컨텍스트
   * @param now 현재 시각 (epoch ms). main.ts에서 Date.now()를 주입한다.
   */
  async maybeRun(ctx: SecondBrainContext, now: number): Promise<CleanupRunResult> {
    const skipped: CleanupRunResult = { ran: false, succeeded: 0, failed: 0, failedSteps: [] };

    // 옵트인 격리: 기능 비활성 시 아무 동작도 하지 않는다 (Req 1.6)
    if (!ctx.settings.enabled) return skipped;

    // 자동 트리거는 schedulerEnabled가 true일 때만 동작한다 (Req 11.1)
    if (!ctx.settings.schedulerEnabled) return skipped;

    // 주기 경계 판정 (Req 11.2, 11.3)
    if (
      !shouldRunScheduled(
        ctx.settings.lastScheduledRun,
        ctx.settings.schedulerIntervalHours,
        now,
      )
    ) {
      return skipped;
    }

    // 전멸한 실행은 lastScheduledRun을 남기지 않으므로 위 주기 판정을 매번 통과한다.
    // 냉각 없이는 원인이 지속되는 실패에서 tick마다 재시도한다.
    if (
      this.lastFailedAttemptAt !== 0 &&
      now - this.lastFailedAttemptAt < FAILED_RUN_COOLDOWN_MS
    ) {
      return skipped;
    }

    const result = await this.runCleanupPipeline(ctx, now);

    // 실제로 돌았고 한 단계도 성공하지 못했으면 냉각을 건다. 성공이 섞였으면
    // lastScheduledRun이 갱신되어 주기 판정이 막아주므로 냉각은 해제한다.
    if (result.ran && result.succeeded === 0) {
      this.lastFailedAttemptAt = now;
    } else if (result.succeeded > 0) {
      this.lastFailedAttemptAt = 0;
    }

    return result;
  }
}
