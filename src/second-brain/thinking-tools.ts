// 사고 도구 순수 모듈 (Second Brain Layer — thinking-tools)
// ==========================================================
// challenge/connect용 LLM 컨텍스트를 구성하는 순수 함수와, emerge용 최근 노트
// 선별 순수 함수를 제공한다. 부수효과·I/O·LLM 호출이 없어 fast-check 기반
// 속성 테스트가 가능하다.
//
// 설계 원칙:
//  - 순수 함수: 동일 입력 → 동일 출력, 외부 상태 변경 없음
//  - 백엔드/브랜딩 무관: 플러그인 이름/ID나 백엔드 표시 이름을 하드코딩하지 않는다
//  - 경계 보정: selectRecentNotes는 일수(N)를 1 이상 정수로 보정한다 (Req 9.4, 9.5)
//
// run* 실행 래퍼(runChallenge/runConnect/runEmerge)는 위 순수 함수 + 검색/LLM I/O를
// 묶는 얇은 계층이다(Task 8.3). 도구 정의/핸들러는 obsidian-tools.ts에 등록한다.
// 모든 단발 LLM 호출은 IAiClient.converseLight(prompt, SECOND_BRAIN_SYSTEM_PROMPT, maxTokens)만
// 사용하며(백엔드 무관), 기본적으로 노트를 생성·수정하지 않는다(읽기 전용, Req 9.2).

import {
  toSearchHits,
  hasNoHits,
  SECOND_BRAIN_SYSTEM_PROMPT,
  type SearchHit,
} from "./search-adapter";
// VaultIndexEntry는 types.ts가 단일 출처이며 vault-indexer.ts도 여기서 import한다.
import type { VaultIndexEntry } from "../types";
// 실행 컨텍스트(app/indexer/aiClient/settings/wikiFolder/persist)는 scheduler.ts가 단일 출처다.
import type { SecondBrainContext } from "./scheduler";

// ============================================
// 내부 헬퍼
// ============================================

/** 하루를 밀리초로 환산한 상수 (최근 N일 경계 계산용). */
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 검색 히트 목록을 LLM 프롬프트용 마크다운 블록으로 렌더한다(결정론적).
 * 각 히트는 "제목 + 경로 + 발췌"를 한 항목으로 표현하며, 입력 순서를 보존한다.
 * 히트가 없으면 근거 부재를 명시하는 안내 문구를 반환한다.
 */
function renderHits(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return "_관련 노트를 찾지 못했습니다._";
  }
  return hits
    .map((hit, i) => {
      // 발췌는 노트 본문 일부이므로 그대로 보존한다(가공하지 않음).
      return [`### ${i + 1}. ${hit.title}`, `경로: ${hit.path}`, "", hit.excerpt].join("\n");
    })
    .join("\n\n");
}

/**
 * 일수(N)를 유효 범위(1 이상 정수)로 보정한다 (Req 9.5).
 *  - 유한수가 아니면(NaN/Infinity) 1로 보정한다.
 *  - 가장 가까운 정수로 반올림한 뒤, 1 미만이면 1로 올린다.
 */
function normalizeDays(days: number): number {
  if (!Number.isFinite(days)) return 1;
  const rounded = Math.round(days);
  return rounded < 1 ? 1 : rounded;
}

// ============================================
// 공개 API
// ============================================

/**
 * challenge용 컨텍스트를 구성한다 — 순수 함수 (Req 9.2).
 *
 * 사용자의 현재 주장(claim)과, 그 주장을 검증할 근거가 되는 과거 노트 발췌(hits)를
 * 하나의 프롬프트 문자열로 묶는다. 실제 LLM 호출은 8.3의 runChallenge가 담당한다.
 */
export function buildChallengeContext(claim: string, hits: SearchHit[]): string {
  return [
    "## 현재 주장",
    "",
    claim,
    "",
    "## 볼트에서 찾은 관련 노트",
    "",
    renderHits(hits),
    "",
    "## 요청",
    "",
    "위 노트들을 근거로 현재 주장의 허점·반례·전제를 비판적으로 검토하고 반론을 제시하십시오.",
  ].join("\n");
}

/**
 * connect용 컨텍스트를 구성한다 — 순수 함수 (Req 9.3).
 *
 * 두 주제(topicA/topicB) 각각으로 검색한 노트 집합(hitsA/hitsB)을 교차 컨텍스트로
 * 묶어, 두 주제를 잇는 아이디어를 끌어내도록 프롬프트를 구성한다.
 */
export function buildConnectContext(
  topicA: string,
  topicB: string,
  hitsA: SearchHit[],
  hitsB: SearchHit[],
): string {
  return [
    `## 주제 A: ${topicA}`,
    "",
    renderHits(hitsA),
    "",
    `## 주제 B: ${topicB}`,
    "",
    renderHits(hitsB),
    "",
    "## 요청",
    "",
    "두 주제의 노트들을 교차하여 공통점·긴장·연결 가능한 아이디어를 도출하십시오.",
  ].join("\n");
}

/**
 * emerge용 최근 노트 선별 — 순수 함수 (Req 9.4, 9.5).
 *
 * 인덱스 항목의 수정 시각(`VaultIndexEntry.lastModified`)을 기준으로, 기준 시각
 * `now`로부터 최근 N일 이내(`lastModified >= now - N일`)에 수정된 항목만 선별한다.
 * 일수 N은 normalizeDays로 1 이상 정수로 보정하여 적용한다(0 이하/비정수 방어).
 *
 * 입력 배열을 변경하지 않으며, 원래 순서를 보존한 새 배열을 반환한다.
 */
export function selectRecentNotes(
  entries: VaultIndexEntry[],
  days: number,
  now: number,
): VaultIndexEntry[] {
  const normalizedDays = normalizeDays(days);
  const cutoff = now - normalizedDays * MILLIS_PER_DAY;
  // 최신순으로 정렬해 반환한다. 호출부가 개수를 제한할 때 앞에서 잘라도 최신 노트가
  // 남도록 보장하기 위함이다(동일 시각은 경로 오름차순으로 결정적 순서를 유지).
  return entries
    .filter((entry) => entry.lastModified >= cutoff)
    .sort((a, b) => {
      if (b.lastModified !== a.lastModified) return b.lastModified - a.lastModified;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
}

// ============================================
// 실행 래퍼 (Task 8.3) — 검색/LLM 접근이 필요한 I/O 계층
// ============================================
// 위 순수 함수(buildChallengeContext/buildConnectContext/selectRecentNotes)와 달리,
// run* 래퍼는 VaultIndexer 검색/열거와 LLM 호출을 수행하는 얇은 실행 계층이다.
// 핵심 보장:
//  - challenge/connect: 기존 VaultIndexer.search → toSearchHits → 컨텍스트 → converseLight
//    (Req 9.2, 9.3). emerge: search가 아니라 indexer.getEntries() → selectRecentNotes → converseLight
//    (Req 9.6).
//  - 모든 LLM 호출은 단발 converseLight(백엔드 무관)이며 SECOND_BRAIN_SYSTEM_PROMPT를 공유한다.
//  - 기본 읽기 전용: 어떤 노트도 생성·수정하지 않고 LLM 응답 텍스트만 반환한다(쓰기는 선택적, Req 9.2).

/**
 * challenge LLM 호출의 최대 토큰 수.
 * 반론은 단발 응답이므로 종합(synthesize)보다 작게 둔다(설계 §LLM 호출 규약).
 */
const CHALLENGE_MAX_TOKENS = 1500;

/** connect LLM 호출의 최대 토큰 수(두 주제 교차 아이디어 — 단발 응답). */
const CONNECT_MAX_TOKENS = 1500;

/** emerge LLM 호출의 최대 토큰 수(최근 노트 전반의 패턴 발견 — 다소 넉넉히 둔다). */
const EMERGE_MAX_TOKENS = 2000;

/**
 * emerge 프롬프트에 포함할 최대 노트 수.
 * 노트당 최대 500자 발췌이므로 60건이면 약 30KB(≈8K 토큰) 규모다. 상한이 없으면
 * 최근 노트가 수천 건인 볼트에서 컨텍스트 한도를 초과한다.
 */
const EMERGE_MAX_NOTES = 60;

/**
 * 최근 노트 집합을 emerge LLM 프롬프트로 구성한다(순수, 내부 헬퍼).
 * 인덱스 항목을 가벼운 SearchHit로 투영하여 renderHits로 일관되게 렌더한다.
 */
function buildEmergeContext(days: number, recent: VaultIndexEntry[]): string {
  // VaultIndexEntry → SearchHit 투영(emerge는 점수·hop이 불필요하므로 path/title/excerpt만 사용).
  const hits: SearchHit[] = recent.map((entry) => ({
    path: entry.path,
    title: entry.title,
    excerpt: entry.excerpt,
  }));
  return [
    `## 최근 ${days}일 이내 수정된 노트`,
    "",
    renderHits(hits),
    "",
    "## 요청",
    "",
    "위 최근 노트들을 가로질러 아직 이름 붙지 않은(미명명) 떠오르는 패턴·주제·연결을 발견하여 제시하십시오.",
  ].join("\n");
}

/**
 * runChallenge — 과거 노트를 근거로 현재 주장을 반박한다 (Req 9.2).
 *
 * 파이프라인: search → toSearchHits → buildChallengeContext → converseLight.
 * 기본적으로 노트를 생성하지 않는다(읽기 전용). 근거가 될 관련 노트가 없으면 안내만 반환한다.
 *
 * @param ctx Second Brain 실행 컨텍스트
 * @param claim 검토할 사용자 주장
 */
export async function runChallenge(ctx: SecondBrainContext, claim: string): Promise<string> {
  const trimmedClaim = claim.trim();
  if (trimmedClaim === "") {
    return "검토할 주장(claim)이 필요합니다.";
  }

  // 기존 Graph RAG 검색 재사용 (Req 9.2)
  const result = await ctx.indexer.search(trimmedClaim);

  // 근거가 될 관련 노트가 없으면 반박 근거가 없으므로 안내만 반환한다(읽기 전용).
  if (hasNoHits(result)) {
    return `"${trimmedClaim}"을(를) 반박할 근거가 될 관련 노트를 찾지 못했습니다.`;
  }

  const hits = toSearchHits(result);
  const prompt = buildChallengeContext(trimmedClaim, hits);

  // 단발 LLM 호출(백엔드 무관) — 노트를 쓰지 않고 응답 텍스트만 반환한다.
  const response = await ctx.aiClient.converseLight(
    prompt,
    SECOND_BRAIN_SYSTEM_PROMPT,
    CHALLENGE_MAX_TOKENS,
  );
  return response.text;
}

/**
 * runConnect — 두 주제를 각각 검색해 교차 컨텍스트로 묶어 연결 아이디어를 도출한다 (Req 9.3).
 *
 * 파이프라인: search(A)·search(B) → toSearchHits → buildConnectContext → converseLight.
 * 기본적으로 노트를 생성하지 않는다(읽기 전용). 양쪽 모두 관련 노트가 없으면 안내만 반환한다.
 *
 * @param ctx Second Brain 실행 컨텍스트
 * @param topicA 주제 A
 * @param topicB 주제 B
 */
export async function runConnect(
  ctx: SecondBrainContext,
  topicA: string,
  topicB: string,
): Promise<string> {
  const trimmedA = topicA.trim();
  const trimmedB = topicB.trim();
  if (trimmedA === "" || trimmedB === "") {
    return "연결할 두 주제(topicA, topicB)가 모두 필요합니다.";
  }

  // 두 주제를 각각 검색한다(Req 9.3).
  const resultA = await ctx.indexer.search(trimmedA);
  const resultB = await ctx.indexer.search(trimmedB);

  // 양쪽 모두 관련 노트가 없으면 교차할 근거가 없으므로 안내만 반환한다(읽기 전용).
  if (hasNoHits(resultA) && hasNoHits(resultB)) {
    return `"${trimmedA}"와(과) "${trimmedB}" 모두에서 관련 노트를 찾지 못해 연결할 근거가 없습니다.`;
  }

  const hitsA = toSearchHits(resultA);
  const hitsB = toSearchHits(resultB);
  const prompt = buildConnectContext(trimmedA, trimmedB, hitsA, hitsB);

  const response = await ctx.aiClient.converseLight(
    prompt,
    SECOND_BRAIN_SYSTEM_PROMPT,
    CONNECT_MAX_TOKENS,
  );
  return response.text;
}

/**
 * runEmerge — 최근 N일 노트에서 미명명 패턴을 발견한다 (Req 9.4, 9.5, 9.6).
 *
 * 파이프라인: indexer.getEntries() → selectRecentNotes(entries, days, now) → converseLight.
 * 검색(search)이 아니라 인덱스 전체 항목 열거(getEntries)를 사용한다(Req 9.6).
 * 기본적으로 노트를 생성하지 않는다(읽기 전용). 최근 N일 내 노트가 없으면 안내만 반환한다.
 *
 * @param ctx Second Brain 실행 컨텍스트
 * @param days 최근 일수(0 이하/비정수는 selectRecentNotes가 1 이상 정수로 보정, Req 9.5)
 * @param now 기준 시각(epoch ms). 미지정 시 Date.now()를 사용한다(테스트 주입 가능).
 */
export async function runEmerge(
  ctx: SecondBrainContext,
  days: number,
  now: number = Date.now(),
): Promise<string> {
  // 일수 보정값을 안내 메시지/프롬프트에 일관되게 표기하기 위해 먼저 정규화한다(Req 9.5).
  const normalizedDays = normalizeDays(days);

  // 검색이 아니라 인덱스 전체 항목 스냅샷을 사용한다(Req 9.6).
  const entries = ctx.indexer.getEntries();
  const recent = selectRecentNotes(entries, normalizedDays, now);

  if (recent.length === 0) {
    return `최근 ${normalizedDays}일 이내에 수정된 노트가 없습니다.`;
  }

  // 프롬프트에 넣는 노트 수를 제한한다. 상한이 없으면 최근 노트가 수천 건일 때
  // 발췌 전량이 한 요청에 들어가 컨텍스트 한도를 초과한다.
  // selectRecentNotes가 최신순으로 정렬해 반환하므로 앞에서 잘라도 최신 노트가 남는다.
  const capped = recent.slice(0, EMERGE_MAX_NOTES);
  const omitted = recent.length - capped.length;

  const prompt = buildEmergeContext(normalizedDays, capped);
  const response = await ctx.aiClient.converseLight(
    prompt,
    SECOND_BRAIN_SYSTEM_PROMPT,
    EMERGE_MAX_TOKENS,
  );
  // 잘라낸 노트가 있으면 사용자에게 알린다(조용한 누락 방지).
  if (omitted > 0) {
    return `${response.text}\n\n---\n(최근 노트 ${recent.length}건 중 최신 ${capped.length}건만 분석했습니다. 기간을 좁히면 더 정확한 결과를 얻을 수 있습니다.)`;
  }
  return response.text;
}
