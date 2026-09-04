// ============================================
// 검색 후보 필터 — 순수 함수
// ============================================
// search_vault가 받는 folder/tags/날짜 범위 조건을 인덱스 엔트리에 적용한다.
// 임베딩 비교 전에 후보를 줄이는 프리필터로 쓰이므로 결과 정확도와 속도를 함께 얻는다.
//
// Vault I/O도 LLM 호출도 하지 않는다. 판정 규칙만 담아 테스트 가능하게 둔다.

import type { VaultIndexEntry } from "../types";

/** search_vault의 선택적 필터 조건. 모든 필드가 optional이며 AND로 결합된다. */
export interface SearchFilter {
  /** 이 폴더와 그 하위만. 경로 경계로 비교하므로 "Note"가 "Notes/x.md"를 잡지 않는다. */
  folder?: string;
  /** 이 태그 중 **하나라도** 가진 노트만(OR). 선행 #과 대소문자는 무시한다. */
  tags?: string[];
  /** 이 날짜 00:00(로컬) 이후에 수정된 노트만. "YYYY-MM-DD". */
  modifiedAfter?: string;
  /** 이 날짜 23:59:59.999(로컬)까지 수정된 노트만. "YYYY-MM-DD". */
  modifiedBefore?: string;
  /** 프론트매터 속성 조건. 모든 조건은 AND로 결합된다. */
  properties?: PropertyFilter[];
}

export type PropertyOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "~";

export interface PropertyFilter {
  /** 프론트매터 키. 점 표기법으로 중첩 키를 찾을 수 있다. */
  key: string;
  /** =, !=, 숫자 비교, 부분 포함(~). */
  operator: PropertyOperator;
  /** 비교할 스칼라 값. */
  value: string | number | boolean | null;
}

/** "YYYY-MM-DD" 형식 검사. 월/일 범위까지 본다. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PROPERTY_PATTERN = /^(.+?)\s*(>=|<=|!=|=|>|<|~)\s*(.+)$/;

/**
 * "YYYY-MM-DD"를 **로컬 시간** 기준 하루의 시작(00:00:00.000) 밀리초로 바꾼다.
 *
 * `new Date("2026-09-01")`은 UTC 자정으로 해석되어 KST에서는 9월 1일 09:00이 된다.
 * 그러면 9월 1일 새벽에 쓴 노트가 "9월 1일 이후" 조건에서 빠진다. 인덱스의
 * lastModified는 로컬 파일 시각이고 buildDateStr도 로컬 기준이므로 여기서도 맞춘다.
 *
 * @returns 유효하지 않으면 null
 */
export function parseLocalDayStart(value: string): number | null {
  const m = DATE_PATTERN.exec(value.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  // 2026-02-30처럼 존재하지 않는 날짜는 Date가 다음 달로 넘겨버린다. 되돌려 확인한다.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d.getTime();
}

/** 하루의 끝(23:59:59.999). modifiedBefore를 그 날짜 **포함**으로 해석하기 위한 값이다. */
export function parseLocalDayEnd(value: string): number | null {
  const start = parseLocalDayStart(value);
  if (start === null) return null;
  const d = new Date(start);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 태그 비교용 정규화 — 선행 #과 공백 제거 후 소문자. */
function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "").toLowerCase();
}

/** 폴더 비교용 정규화 — 앞뒤 슬래시와 공백 제거. */
function normalizeFolder(folder: string): string {
  return folder.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

/** 속성 조건 문자열의 값을 가능한 경우 JSON 스칼라로 바꾼다. */
function parsePropertyValue(raw: string): string | number | boolean | null {
  const value = raw.trim();
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    return Number(value);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** `status=active`, `confidence>=0.8` 형식의 속성 조건을 파싱한다. */
export function parsePropertyFilter(raw: string): PropertyFilter | null {
  const match = PROPERTY_PATTERN.exec(raw.trim());
  if (!match) return null;
  const key = match[1].trim();
  if (key === "") return null;
  return {
    key,
    operator: match[2] as PropertyOperator,
    value: parsePropertyValue(match[3]),
  };
}

/**
 * 도구 입력(신뢰할 수 없는 값)에서 SearchFilter를 만든다.
 *
 * 잘못된 값은 조용히 버리지 않고 문제를 모아 돌려준다 — 모델이 `modifiedAfter: "지난달"`
 * 처럼 넘겼을 때 필터가 무시된 채 전체 검색 결과를 받으면, 모델도 사용자도
 * 조건이 적용되지 않았다는 사실을 모른다.
 */
export function normalizeSearchFilter(raw: Record<string, unknown>): {
  filter: SearchFilter;
  problems: string[];
} {
  const filter: SearchFilter = {};
  const problems: string[] = [];

  // 값을 조용히 버리지 않는다. 버리면 필터가 비어 **볼트 전체**를 검색하게 되고, 모델은
  // 범위를 좁혀 물었는데 범위 밖 노트로 답하게 된다. 날짜 필터와 같은 규약으로 오류를 낸다.
  if (raw.folder !== undefined) {
    if (typeof raw.folder !== "string") {
      problems.push(`folder는 문자열이어야 합니다: ${JSON.stringify(raw.folder)}`);
    } else if (raw.folder.trim() !== "") {
      const folder = normalizeFolder(raw.folder);
      if (folder === "") problems.push(`folder를 해석할 수 없습니다: ${raw.folder}`);
      else filter.folder = folder;
    }
  }

  if (raw.tags !== undefined) {
    if (Array.isArray(raw.tags)) {
      const nonStrings = raw.tags.filter((t) => typeof t !== "string");
      if (nonStrings.length > 0) {
        problems.push(`tags의 원소는 문자열이어야 합니다: ${JSON.stringify(nonStrings)}`);
      }
      const tags = raw.tags
        .filter((t): t is string => typeof t === "string")
        .map(normalizeTag)
        .filter((t) => t !== "");
      if (tags.length > 0) filter.tags = Array.from(new Set(tags));
      else if (raw.tags.length > 0 && nonStrings.length === 0) {
        problems.push(`tags를 해석할 수 없습니다: ${JSON.stringify(raw.tags)}`);
      }
    } else if (typeof raw.tags === "string") {
      // 단일 문자열도 받아준다. 모델이 배열 대신 문자열을 넘기는 일이 잦다.
      if (raw.tags.trim() !== "") {
        const one = normalizeTag(raw.tags);
        if (one === "") problems.push(`tags를 해석할 수 없습니다: ${raw.tags}`);
        else filter.tags = [one];
      }
    } else {
      problems.push(`tags는 문자열 또는 문자열 배열이어야 합니다: ${JSON.stringify(raw.tags)}`);
    }
  }

  if (raw.properties !== undefined) {
    const values =
      typeof raw.properties === "string"
        ? [raw.properties]
        : Array.isArray(raw.properties)
          ? raw.properties
          : null;
    if (values === null) {
      problems.push(
        `properties는 조건 문자열 또는 문자열 배열이어야 합니다: ${JSON.stringify(raw.properties)}`
      );
    } else {
      const parsed: PropertyFilter[] = [];
      for (const value of values) {
        if (typeof value !== "string") {
          problems.push(`properties의 원소는 문자열이어야 합니다: ${JSON.stringify(value)}`);
          continue;
        }
        if (value.trim() === "") continue;
        const condition = parsePropertyFilter(value);
        if (!condition) {
          problems.push(
            `속성 조건은 "키=값" 형식이어야 합니다: ${value} (지원: =, !=, >, >=, <, <=, ~)`
          );
          continue;
        }
        parsed.push(condition);
      }
      if (parsed.length > 0) filter.properties = parsed;
    }
  }

  for (const key of ["modifiedAfter", "modifiedBefore"] as const) {
    const value = raw[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || parseLocalDayStart(value) === null) {
      problems.push(`${key}는 "YYYY-MM-DD" 형식이어야 합니다 (받은 값: ${String(value)}).`);
      continue;
    }
    filter[key] = value.trim();
  }

  // 범위가 뒤집혀 있으면 어떤 노트도 통과하지 못한다. 조용한 0건보다 알려주는 게 낫다.
  if (filter.modifiedAfter && filter.modifiedBefore) {
    const after = parseLocalDayStart(filter.modifiedAfter);
    const before = parseLocalDayEnd(filter.modifiedBefore);
    if (after !== null && before !== null && after > before) {
      problems.push(
        `modifiedAfter(${filter.modifiedAfter})가 modifiedBefore(${filter.modifiedBefore})보다 뒤입니다.`
      );
    }
  }

  return { filter, problems };
}

/**
 * 적용된 조건을 사람이 읽을 한 줄로 만든다. 검색 결과 헤더와 0건 안내에 쓴다.
 * 모델이 넘긴 조건을 되비쳐 주면, 의도와 다른 필터가 걸렸을 때 스스로 고칠 수 있다.
 *
 * @returns 조건이 없으면 빈 문자열
 */
export function describeFilter(filter: SearchFilter): string {
  const parts: string[] = [];
  if (filter.folder !== undefined) parts.push(`폴더 "${filter.folder}"`);
  if (filter.tags !== undefined && filter.tags.length > 0) {
    parts.push(`태그 ${filter.tags.map((t) => `#${t}`).join(" 또는 ")}`);
  }
  if (filter.modifiedAfter !== undefined && filter.modifiedBefore !== undefined) {
    parts.push(`수정일 ${filter.modifiedAfter} ~ ${filter.modifiedBefore}`);
  } else if (filter.modifiedAfter !== undefined) {
    parts.push(`수정일 ${filter.modifiedAfter} 이후`);
  } else if (filter.modifiedBefore !== undefined) {
    parts.push(`수정일 ${filter.modifiedBefore} 까지`);
  }
  if (filter.properties !== undefined && filter.properties.length > 0) {
    parts.push(
      `속성 ${filter.properties
        .map((p) => `${p.key}${p.operator}${String(p.value)}`)
        .join(" 그리고 ")}`
    );
  }
  return parts.join(", ");
}

/** 적용할 조건이 하나도 없는 필터인지. 프리필터 자체를 건너뛰는 판정에 쓴다. */
export function isFilterEmpty(filter: SearchFilter): boolean {
  return (
    filter.folder === undefined &&
    (filter.tags === undefined || filter.tags.length === 0) &&
    filter.modifiedAfter === undefined &&
    filter.modifiedBefore === undefined &&
    (filter.properties === undefined || filter.properties.length === 0)
  );
}

/** 엔트리가 폴더 조건을 만족하는지. 경로 경계(`/`)로 비교한다. */
function matchesFolder(path: string, folder: string): boolean {
  // 빈 폴더는 볼트 루트를 뜻하므로 전체 통과.
  if (folder === "") return true;
  return path === folder || path.startsWith(`${folder}/`);
}

const MISSING = Symbol("missing-frontmatter-property");

/** 대소문자를 무시해 프론트매터 키를 찾고, 점 표기법으로 중첩 객체를 순회한다. */
function getPropertyValue(
  frontmatter: Record<string, unknown> | undefined,
  path: string
): unknown | typeof MISSING {
  let current: unknown = frontmatter;
  for (const segment of path.split(".").map((part) => part.trim())) {
    if (!current || typeof current !== "object" || Array.isArray(current) || segment === "") {
      return MISSING;
    }
    const object = current as Record<string, unknown>;
    const key = Object.keys(object).find(
      (candidate) => candidate.toLowerCase() === segment.toLowerCase()
    );
    if (key === undefined) return MISSING;
    current = object[key];
  }
  return current;
}

function equalsPropertyValue(actual: unknown, expected: PropertyFilter["value"]): boolean {
  if (typeof actual === "string" && typeof expected === "string") {
    return actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  return actual === expected;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  ) {
    return Number(value);
  }
  return null;
}

function matchesPropertyValue(actual: unknown, filter: PropertyFilter): boolean {
  const values = Array.isArray(actual) ? actual : [actual];
  if (filter.operator === "=") {
    return values.some((value) => equalsPropertyValue(value, filter.value));
  }
  if (filter.operator === "!=") {
    return values.every((value) => !equalsPropertyValue(value, filter.value));
  }
  if (filter.operator === "~") {
    const expected = String(filter.value).toLowerCase();
    return values.some((value) => String(value).toLowerCase().includes(expected));
  }

  const expected = numericValue(filter.value);
  if (expected === null) return false;
  return values.some((value) => {
    const actualNumber = numericValue(value);
    if (actualNumber === null) return false;
    if (filter.operator === ">") return actualNumber > expected;
    if (filter.operator === ">=") return actualNumber >= expected;
    if (filter.operator === "<") return actualNumber < expected;
    return actualNumber <= expected;
  });
}

/** 엔트리가 필터를 통과하는지 판정한다. 모든 조건은 AND, tags 내부만 OR이다. */
export function matchesFilter(entry: VaultIndexEntry, filter: SearchFilter): boolean {
  if (filter.folder !== undefined && !matchesFolder(entry.path, filter.folder)) {
    return false;
  }

  if (filter.tags !== undefined && filter.tags.length > 0) {
    const entryTags = new Set((entry.tags ?? []).map(normalizeTag));
    if (!filter.tags.some((t) => entryTags.has(t))) return false;
  }

  if (filter.modifiedAfter !== undefined) {
    const after = parseLocalDayStart(filter.modifiedAfter);
    if (after !== null && entry.lastModified < after) return false;
  }

  if (filter.modifiedBefore !== undefined) {
    const before = parseLocalDayEnd(filter.modifiedBefore);
    if (before !== null && entry.lastModified > before) return false;
  }

  for (const property of filter.properties ?? []) {
    const actual = getPropertyValue(entry.frontmatter, property.key);
    if (actual === MISSING || !matchesPropertyValue(actual, property)) return false;
  }

  return true;
}

/**
 * 인덱스에서 필터를 통과한 엔트리만 담은 새 Map을 만든다.
 *
 * 원본 Map을 변형하지 않는다. 반환된 Map은 시드 벡터 검색과 그래프 순회 양쪽에
 * 쓰이므로, 필터에서 빠진 노트는 이웃으로도 등장하지 않는다 — 필터를 걸었으면
 * 그 밖의 노트는 어떤 경로로도 결과에 들어오지 않아야 한다.
 */
export function filterIndex(
  index: Map<string, VaultIndexEntry>,
  filter: SearchFilter
): Map<string, VaultIndexEntry> {
  if (isFilterEmpty(filter)) return index;

  const out = new Map<string, VaultIndexEntry>();
  for (const [path, entry] of index) {
    if (matchesFilter(entry, filter)) out.set(path, entry);
  }
  return out;
}
