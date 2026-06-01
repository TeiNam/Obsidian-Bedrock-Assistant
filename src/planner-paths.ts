// Daily Planner 경로·명명·위키링크 순수 모듈
// ============================================
// 날짜 문자열, 날짜 폴더 경로, To-Do/TimeBox 문서명, 위키 링크의
// 생성과 파싱을 담당하는 순수 함수 모음.
// Obsidian 의존성은 normalizePath 하나만 사용하며, 모든 함수는 부수효과가 없다.
// (fast-check 기반 속성 테스트가 가능하도록 부수효과 계층과 분리)

import { normalizePath } from "obsidian";

// ============================================
// 내부 헬퍼
// ============================================

/** 정규식 특수문자를 이스케이프한다 (동적 RegExp 구성용). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * "YYYY-MM-DD" 문자열을 파싱하여 Date를 복원한다.
 * 형식(정규식)과 달력 유효성(예: 2026-02-30 거부)을 모두 검증하며,
 * 무효한 경우 null을 반환한다.
 */
function parseDateString(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // 월(1~12), 일(1~31) 범위 1차 검증
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Date 재구성으로 실제 달력 유효성 검증
  // (예: 2월 30일은 3월 2일로 넘어가므로 getMonth/getDate가 어긋나 null 처리됨)
  const d = new Date(year, month - 1, day);
  // 0~99년도에 1900을 더하는 JS Date 동작 보정
  d.setFullYear(year);

  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

// ============================================
// 날짜 문자열 / 경로 생성
// ============================================

/**
 * Date → "YYYY-MM-DD" 문자열 (월/일 2자리 zero-pad).
 */
export function buildDateStr(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 날짜 폴더 경로: "{plannerFolder}/YYYY-MM-DD" (normalizePath 적용).
 */
export function buildDateFolder(plannerFolder: string, date: Date): string {
  return normalizePath(`${plannerFolder}/${buildDateStr(date)}`);
}

/** To-Do 문서 basename: "YYYY-MM-DD To-Do" */
export function buildTodoDocBasename(date: Date): string {
  return `${buildDateStr(date)} To-Do`;
}

/** TimeBox 문서 basename: "YYYY-MM-DD TimeBox" */
export function buildTimeboxDocBasename(date: Date): string {
  return `${buildDateStr(date)} TimeBox`;
}

/**
 * To-Do 문서 경로: "{plannerFolder}/YYYY-MM-DD/YYYY-MM-DD To-Do.md".
 */
export function buildTodoDocPath(plannerFolder: string, date: Date): string {
  const dateStr = buildDateStr(date);
  return normalizePath(`${plannerFolder}/${dateStr}/${buildTodoDocBasename(date)}.md`);
}

/**
 * TimeBox 문서 경로: "{plannerFolder}/YYYY-MM-DD/YYYY-MM-DD TimeBox.md".
 */
export function buildTimeboxDocPath(plannerFolder: string, date: Date): string {
  const dateStr = buildDateStr(date);
  return normalizePath(`${plannerFolder}/${dateStr}/${buildTimeboxDocBasename(date)}.md`);
}

// ============================================
// 날짜 파싱 (폴더명 / Legacy 파일명)
// ============================================

/**
 * 날짜 폴더명("YYYY-MM-DD") → Date | null.
 * 형식·범위 및 달력 유효성을 검증하며, 무효 시 null을 반환한다.
 */
export function parseDateFolder(folderName: string): Date | null {
  return parseDateString(folderName);
}

/**
 * Legacy 평면 파일 basename("YYYY-MM-DD") → Date | null.
 * parseDateFolder와 동일한 검증 규칙을 사용한다.
 */
export function parseLegacyBasename(basename: string): Date | null {
  return parseDateString(basename);
}

// ============================================
// 위키 링크 생성 / 파싱
// ============================================

/** To-Do를 가리키는 위키 링크: "[[YYYY-MM-DD To-Do]]" */
export function buildTodoLink(date: Date): string {
  return `[[${buildTodoDocBasename(date)}]]`;
}

/** TimeBox를 가리키는 위키 링크: "[[YYYY-MM-DD TimeBox]]" */
export function buildTimeboxLink(date: Date): string {
  return `[[${buildTimeboxDocBasename(date)}]]`;
}

/**
 * "[[target]]" 또는 "[[target|alias]]" → target 문자열.
 * 유효한 위키 링크가 아니면 null을 반환한다.
 */
export function parseWikiLinkTarget(link: string): string | null {
  const trimmed = link.trim();
  // target 부분은 ']' 와 '|' 를 포함하지 않으며 최소 1자 이상이어야 한다.
  const match = trimmed.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  if (!match) return null;
  const target = match[1].trim();
  return target.length > 0 ? target : null;
}

/**
 * content 내 모든 위키 링크의 target 집합을 추출한다 (내부용).
 */
function collectWikiLinkTargets(content: string): Set<string> {
  const targets = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const target = m[1].trim();
    if (target.length > 0) targets.add(target);
  }
  return targets;
}

// ============================================
// 템플릿 변환 (링크 지역화 / 상호링크 보장 / 날짜 치환)
// ============================================

/**
 * 템플릿의 일반(generic) 위키 링크 토큰을 같은 날짜의 per-date 링크로 치환한다.
 *   "[[TimeBox Daily]]" → "[[YYYY-MM-DD TimeBox]]"
 *   "[[Daily To-Do]]"   → "[[YYYY-MM-DD To-Do]]"
 * 별칭(alias)이 있으면 보존한다: "[[TimeBox Daily|시간표]]" → "[[YYYY-MM-DD TimeBox|시간표]]".
 * 이미 per-date 링크이거나 일반 토큰이 없으면 원본을 그대로 반환한다(멱등).
 */
export function localizeTemplateLinks(
  content: string,
  date: Date,
  todoTemplateName: string,
  timeboxTemplateName: string
): string {
  let result = content;

  // (일반 템플릿명 → per-date basename) 매핑 목록
  const mappings: Array<{ templateName: string; perDate: string }> = [
    { templateName: timeboxTemplateName, perDate: buildTimeboxDocBasename(date) },
    { templateName: todoTemplateName, perDate: buildTodoDocBasename(date) },
  ];

  for (const { templateName, perDate } of mappings) {
    // 빈/공백 템플릿명은 건너뜀 (잘못된 정규식 구성 방지)
    if (!templateName || templateName.trim().length === 0) continue;

    const escaped = escapeRegExp(templateName);
    // [[<templateName>]] 또는 [[<templateName>|alias]] 형태만 매칭
    // ']]' 로 닫히는 토큰만 매칭하므로 per-date 링크와는 충돌하지 않는다(멱등).
    const re = new RegExp(`\\[\\[${escaped}(\\|[^\\]]*)?\\]\\]`, "g");
    result = result.replace(re, (_match, alias) => `[[${perDate}${alias ?? ""}]]`);
  }

  return result;
}

/**
 * content 안에 targetLink와 동일한 대상의 위키 링크가 없으면 문서 끝에 추가한다.
 * 이미 같은 대상의 링크가 존재하면 원본을 그대로 반환한다(멱등, 중복 추가 없음).
 */
export function ensureCrossLink(content: string, targetLink: string): string {
  const targetName = parseWikiLinkTarget(targetLink);

  if (targetName === null) {
    // 유효한 위키 링크가 아니면 리터럴 포함 여부로 멱등 처리
    return content.includes(targetLink) ? content : appendLink(content, targetLink);
  }

  // 같은 대상(target)을 가리키는 링크가 이미 있으면 추가하지 않음
  const existing = collectWikiLinkTargets(content);
  if (existing.has(targetName)) {
    return content;
  }

  return appendLink(content, targetLink);
}

/** 문서 끝에 링크 한 줄을 추가한다 (내부용). */
function appendLink(content: string, link: string): string {
  if (content.length === 0) return link;
  const needsNewline = !content.endsWith("\n");
  return content + (needsNewline ? "\n" : "") + link + "\n";
}

/**
 * content 내 모든 "{{date}}" 토큰을 해당 날짜의 "YYYY-MM-DD" 문자열로 치환한다.
 */
export function substituteDate(content: string, date: Date): string {
  return content.replace(/\{\{date\}\}/g, buildDateStr(date));
}
