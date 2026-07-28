// 복습 큐 (Review Queue) — 순수 모듈
// ====================================
// 볼트가 커지면 검색어를 떠올리지 못한 지식은 영구히 묻힌다. 오래 열지 않았지만
// 연결 가치가 높은 노트를 매일 소수만 재노출한다.
//
// 설계 제약:
//  - LLM·임베딩 호출 0회. 점수는 인덱스 데이터 + 접근 이력만으로 계산한다.
//  - 노트에 SRS 등급 필드를 심지 않는다. 전통적 간격 반복은 노트마다 메타데이터를
//    요구해 볼트를 오염시키고, Obsidian에는 이미 전용 플러그인이 있다. 여기서는
//    "재노출"만 하고 상태는 전부 플러그인 저장소에 둔다.
//  - 접근 이력이 없는 도입 초기에는 lastModified로 폴백한다. 그러지 않으면 전부
//    동점이 되어 큐가 무의미해진다.

import type { VaultIndexEntry } from "../types";

/** 하루(ms). */
const DAY = 24 * 60 * 60 * 1000;

/** 한 번에 제시할 복습 노트 수. 많이 주면 아무것도 보지 않는다. */
export const REVIEW_QUEUE_SIZE = 5;

/** 같은 노트를 다시 제시하지 않는 최소 간격(일). */
export const REVIEW_COOLDOWN_DAYS = 7;

/** 복습 대상이 되기 위한 최소 본문 길이. 빈 노트 복습은 의미가 없다. */
export const MIN_BODY_CHARS = 200;

/** 접근 이력에 보관할 최대 항목 수. 무한히 자라면 data.json이 비대해진다. */
const ACCESS_LOG_MAX_ENTRIES = 2000;

/** 경과 일수 점수의 상한. 오래됨만으로 무한히 앞서지 않게 한다. */
const MAX_AGE_SCORE = 10;

/** 연결 점수의 상한. */
const MAX_LINK_SCORE = 5;

/** 경로 → 마지막 접근 시각(epoch ms). */
export type AccessLog = Record<string, number>;

/** 복습 큐 항목. */
export interface ReviewItem {
  path: string;
  title: string;
  score: number;
  /** 왜 이 노트가 뽑혔는지. 이유 없이 던지면 사용자가 볼 이유를 모른다. */
  reason: string;
}

/** 경로가 생성물(위키 폴더 하위)인지 판별한다. */
function isGenerated(path: string, wikiFolder?: string): boolean {
  if (!wikiFolder) return false;
  return path === wikiFolder || path.startsWith(`${wikiFolder}/`);
}

/** 엔트리의 본문 총 길이(청크 텍스트 합). */
function bodyLength(entry: VaultIndexEntry): number {
  let total = 0;
  for (const chunk of entry.chunks ?? []) {
    total += chunk.text.length;
  }
  return total;
}

/**
 * 마지막으로 "본" 시각을 구한다.
 * 접근 이력이 있으면 그것을, 없으면 lastModified를 쓴다(도입 초기 폴백).
 */
function lastSeenAt(entry: VaultIndexEntry, log: AccessLog): number {
  const recorded = log[entry.path];
  if (typeof recorded === "number" && Number.isFinite(recorded)) return recorded;
  return Number.isFinite(entry.lastModified) ? entry.lastModified : 0;
}

/**
 * 재노출 점수를 계산한다 — 순수 함수.
 *
 * 점수 = 경과 일수 점수(상한 10) + 연결 점수(상한 5).
 * 다음 경우는 0점(후보 제외):
 *  - 본문이 MIN_BODY_CHARS 미만 (빈 노트 복습은 무의미 — 지식 공백 리포트가 다룬다)
 *  - 쿨다운 기간 내에 이미 재노출됨 (며칠 연속 같은 노트가 나오면 큐를 신뢰하지 않는다)
 *
 * @param entry 인덱스 엔트리
 * @param log 경로 → 마지막 접근 시각
 * @param now 기준 시각
 * @param surfaced 경로 → 마지막 재노출 시각(쿨다운 판정용)
 */
export function scoreForReview(
  entry: VaultIndexEntry,
  log: AccessLog,
  now: number,
  surfaced: AccessLog = {},
): number {
  if (bodyLength(entry) < MIN_BODY_CHARS) return 0;

  // 쿨다운: 최근에 이미 제시했으면 건너뛴다.
  const lastSurfaced = surfaced[entry.path];
  if (typeof lastSurfaced === "number" && Number.isFinite(lastSurfaced)) {
    if (now - lastSurfaced < REVIEW_COOLDOWN_DAYS * DAY) return 0;
  }

  // 경과 일수: 오래 안 볼수록 높다. 미래 시각(시계 오차)은 0으로 클램프한다.
  const elapsedDays = Math.max(0, (now - lastSeenAt(entry, log)) / DAY);
  const ageScore = Math.min(elapsedDays / 30, MAX_AGE_SCORE);

  // 연결: 링크가 많을수록 다시 볼 가치가 크다(다른 지식으로 이어진다).
  const links = (entry.backlinks?.length ?? 0) + (entry.outlinks?.length ?? 0);
  const linkScore = Math.min(links, MAX_LINK_SCORE);

  const score = ageScore + linkScore;
  return Number.isFinite(score) && score > 0 ? score : 0;
}

/** 선정 이유 문구를 만든다. */
function buildReason(entry: VaultIndexEntry, log: AccessLog, now: number): string {
  const elapsedDays = Math.floor(Math.max(0, (now - lastSeenAt(entry, log)) / DAY));
  const links = (entry.backlinks?.length ?? 0) + (entry.outlinks?.length ?? 0);
  const seen = log[entry.path] !== undefined ? "열지 않음" : "수정 없음";
  return `${elapsedDays}일간 ${seen}, 링크 ${links}개`;
}

/**
 * 복습 큐를 선정한다 — 순수 함수.
 *
 * 0점 후보는 넣지 않는다. 상한을 채우려고 무의미한 노트를 끼워넣으면 큐 전체의
 * 신뢰가 떨어진다. 동점은 경로 오름차순으로 결정적 순서를 유지한다.
 */
export function selectReviewQueue(
  entries: VaultIndexEntry[],
  log: AccessLog,
  now: number,
  surfaced: AccessLog = {},
  wikiFolder?: string,
): ReviewItem[] {
  const scored: ReviewItem[] = [];

  for (const entry of entries) {
    if (isGenerated(entry.path, wikiFolder)) continue;
    const score = scoreForReview(entry, log, now, surfaced);
    if (score <= 0) continue;
    scored.push({
      path: entry.path,
      title: entry.title,
      score,
      reason: buildReason(entry, log, now),
    });
  }

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    })
    .slice(0, REVIEW_QUEUE_SIZE);
}

/**
 * 저장된 접근 이력을 안전한 형태로 복원한다 — 순수 함수.
 *
 * data.json은 사용자가 편집할 수 있고 구버전 데이터도 들어올 수 있으므로,
 * 숫자가 아닌 값·음수·비유한 값을 걸러낸다. 항목이 상한을 넘으면 최근 것만 남긴다.
 */
export function normalizeAccessLog(raw: unknown): AccessLog {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const valid: Array<[string, number]> = [];
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "number") continue;
    if (!Number.isFinite(value) || value < 0) continue;
    if (path === "") continue;
    valid.push([path, value]);
  }

  // 상한 초과 시 최근 접근 순으로 남긴다.
  if (valid.length > ACCESS_LOG_MAX_ENTRIES) {
    valid.sort((a, b) => b[1] - a[1]);
    valid.length = ACCESS_LOG_MAX_ENTRIES;
  }

  const result: AccessLog = {};
  for (const [path, value] of valid) {
    result[path] = value;
  }
  return result;
}

/**
 * 접근 기록을 추가한 새 이력을 반환한다 — 순수 함수(불변).
 * 원본을 변경하지 않는다.
 */
export function recordAccess(log: AccessLog, path: string, now: number): AccessLog {
  if (!path) return log;
  return { ...log, [path]: now };
}

/**
 * 삭제·이동된 노트를 이력에서 제거한 새 객체를 반환한다 — 순수 함수(불변).
 *
 * 이력을 정리하지 않으면 삭제된 노트가 영구 잔존해 data.json이 계속 자란다.
 * 큐 자체는 인덱스를 기준으로 뽑으므로 결과에 나타나지는 않지만, 저장 용량과
 * 상한(ACCESS_LOG_MAX_ENTRIES) 경쟁에서 살아 있는 노트를 밀어낸다.
 *
 * 해당 경로가 없으면 원본을 그대로 반환한다(불필요한 복사 방지).
 */
export function forgetPath(log: AccessLog, path: string): AccessLog {
  if (!path) return log;
  if (!(path in log)) return log;
  const next = { ...log };
  delete next[path];
  return next;
}
