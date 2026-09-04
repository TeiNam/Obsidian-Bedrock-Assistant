// ============================================
// 엔티티·개념 정규화 — 순수 함수
// ============================================
// 같은 인물·개념을 다룬 노트가 여러 개로 흩어지면 검색이 근거를 나눠 찾고, 어느 노트에
// 써야 할지도 매번 흔들린다. 이 모듈은 정본 후보와 흡수 대상을 제안한다.
//
// 제안만 한다. 노트를 지우거나 합치지 않는다 — 오병합은 되돌리기 가장 어려운 손실이다.
// 적용 단계는 정본 노트에 별칭과 후보 목록을 기록하는 것까지다.

import type { VaultIndexEntry } from "../types";
import { maxEmbeddingSimilarity } from "./link-suggestions";
import { formatNoteLink, pathWithoutExtension } from "./wiki-link";

/** 군집 구성원 1건. */
export interface DuplicateMember {
  path: string;
  title: string;
  /** 정본 후보와의 정규화 유사도. 정본 자신은 1이다. */
  similarity: number;
  /** 본문 길이. 정본 선정 근거로 화면에 보인다. */
  bodyLength: number;
  /** 아웃링크 + 백링크 수. 정본 선정의 1순위 근거다. */
  linkCount: number;
}

/** 왜 이 노트들이 후보로 묶였는지. */
export type ClusterReason = "same-title" | "similar-title";

/** 중복 후보 군집 1건. */
export interface DuplicateCluster {
  /** 정본 후보 — 가장 잘 발달된 노트. */
  canonical: DuplicateMember;
  /** 정본으로 흡수하거나 별칭으로 등록할 후보들. */
  duplicates: DuplicateMember[];
  reason: ClusterReason;
}

/**
 * 중복으로 인정할 최소 유사도(정규화 후).
 *
 * 링크 제안(0.82)보다 높다. 링크는 "관련 있다"는 약한 주장이지만 중복 판정은 "같은
 * 것이다"라는 강한 주장이고, 사용자가 이를 받아 노트를 합치면 되돌리기 어렵다.
 */
export const MIN_DUPLICATE_SIMILARITY = 0.9;

/** 제목 토큰으로 인정할 최소 길이. 1자 토큰은 아무 노트와도 겹쳐 버킷이 무의미해진다. */
const MIN_TOKEN_LENGTH = 2;

/** 한 군집의 최대 크기. 지나치게 큰 군집은 버킷이 잘못 잡힌 신호다. */
const MAX_CLUSTER_SIZE = 8;

/** 확장자를 뗀 파일명. */
function basename(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "");
}

/** 제목 비교용 정규화 — 소문자, 구두점 제거, 공백 정리. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 정규화 제목에서 의미 있는 토큰을 뽑는다. */
export function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(" ")
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
}

/** Kubernetes↔K8s, Machine Learning↔ML 같은 보수적 약어 키. */
function abbreviationKeys(title: string): string[] {
  const tokens = titleTokens(title);
  const keys = new Set<string>();
  if (tokens.length >= 2) {
    const initials = tokens.map((token) => token[0]).join("");
    if (/^[a-z0-9]{2,10}$/.test(initials)) keys.add(initials);
  }
  if (tokens.length === 1) {
    const token = tokens[0];
    if (/^[a-z]\d+[a-z]$/.test(token) || /^[a-z]{2,6}$/.test(token)) keys.add(token);
    if (/^[a-z]{4,}$/.test(token)) {
      keys.add(`${token[0]}${token.length - 2}${token[token.length - 1]}`);
    }
  }
  return [...keys];
}

/** 엔트리의 링크 수(아웃 + 백). */
function linkCount(entry: VaultIndexEntry): number {
  return (entry.outlinks?.length ?? 0) + (entry.backlinks?.length ?? 0);
}

/** 엔트리의 본문 길이 근사 — 청크 길이 합, 없으면 발췌 길이. */
function bodyLength(entry: VaultIndexEntry): number {
  const chunks = entry.chunks;
  if (chunks && chunks.length > 0) {
    return chunks.reduce((sum, c) => sum + c.text.length, 0);
  }
  return entry.excerpt.length;
}

/** 경로가 생성물(위키 폴더 하위)인지. knowledge-gaps의 같은 규약이다. */
function isGenerated(path: string, wikiFolder?: string): boolean {
  if (!wikiFolder) return false;
  return path === wikiFolder || path.startsWith(`${wikiFolder}/`);
}

export interface CanonicalizeOptions {
  wikiFolder?: string;
  minSimilarity?: number;
}

/**
 * 후보 버킷을 만든다.
 *
 * 왜 버킷을 쓰는가: 전체 노트를 서로 비교하면 O(n²) 벡터 연산이 되어 수천 개 볼트에서
 * 명령이 수십 초~수 분 걸린다. 같은 개념의 중복 노트는 제목이 겹치는 경우가 압도적으로
 * 많으므로, 제목으로 후보를 좁히고 임베딩으로 확증하는 쪽이 실용적이다.
 *
 * @returns 버킷 키 → 경로 목록 (2개 이상인 버킷만)
 */
export function buildTitleBuckets(entries: readonly VaultIndexEntry[]): Map<string, string[]> {
  const buckets = new Map<string, Set<string>>();
  const add = (key: string, path: string): void => {
    const paths = buckets.get(key) ?? new Set<string>();
    paths.add(path);
    buckets.set(key, paths);
  };

  for (const entry of entries) {
    const title = entry.title || basename(entry.path);
    const names = [title, ...normalizeAliases(entry.frontmatter?.aliases)];
    for (const name of names) {
      const normalized = normalizeTitle(name);
      if (normalized === "") continue;

      // 1) 제목·기존 별칭이 완전히 같은 노트들 — 가장 강한 신호다.
      add(`title:${normalized}`, entry.path);
      // 2) 토큰을 공유하는 노트들.
      for (const token of new Set(titleTokens(name))) add(`token:${token}`, entry.path);
      // 3) 안전하게 계산 가능한 약어·numeronym.
      for (const abbreviation of abbreviationKeys(name)) {
        add(`abbr:${abbreviation}`, entry.path);
      }
    }
  }

  const out = new Map<string, string[]>();
  for (const [key, pathSet] of buckets) {
    const paths = [...pathSet];
    // 1개짜리 버킷은 비교할 상대가 없다. 과대 버킷("정리", "노트" 같은 흔한 토큰)은
    // 사실상 전체 스캔이 되므로 버린다.
    if (paths.length < 2 || paths.length > MAX_CLUSTER_SIZE) continue;
    out.set(key, paths);
  }
  return out;
}

/**
 * 후보들을 "임계값을 넘는 유사도"로 연결한 연결 요소로 나눈다.
 *
 * 모든 쌍을 비교한다. 한 노트를 기준으로 삼으면 그 노트가 무관할 때 나머지가 서로 비교되지
 * 않아 군집을 놓치고, 그 노트에 임베딩이 없으면 버킷 전체를 잃는다.
 *
 * 임베딩이 없거나 차원이 다른 노트는 아무와도 연결되지 않는다 — 유사도 0으로 취급하면
 * 재인덱싱 중인 노트가 조용히 섞이고, 1로 취급하면 무관한 노트를 중복이라 제안한다.
 *
 * 결과는 경로 오름차순으로 정렬된 그룹들이며, 그룹 자체도 첫 경로 순이다(결정성).
 */
function connectedGroups(
  paths: readonly string[],
  byPath: ReadonlyMap<string, VaultIndexEntry>,
  minSimilarity: number
): VaultIndexEntry[][] {
  const entries = paths
    .map((path) => byPath.get(path))
    .filter((entry): entry is VaultIndexEntry => entry !== undefined);

  // 인접 목록. i < j만 채우고 양방향으로 쓴다.
  const neighbors = entries.map(() => new Set<number>());
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const cosine = maxEmbeddingSimilarity(entries[i], entries[j]);
      if (cosine === null) continue;
      if ((cosine + 1) / 2 < minSimilarity) continue;
      neighbors[i].add(j);
      neighbors[j].add(i);
    }
  }

  const seen = new Set<number>();
  const groups: VaultIndexEntry[][] = [];
  for (let i = 0; i < entries.length; i++) {
    if (seen.has(i)) continue;
    const stack = [i];
    const component: number[] = [];
    seen.add(i);
    while (stack.length > 0) {
      const at = stack.pop()!;
      component.push(at);
      for (const next of neighbors[at]) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    if (component.length < 2) continue;
    groups.push(component.sort((a, b) => a - b).map((idx) => entries[idx]));
  }

  return groups;
}

/**
 * 정본 기준으로 유사도를 다시 잰다.
 *
 * 유사도는 버킷 시드(경로 순 첫 노트) 기준으로 재지만 정본은 링크 수·본문 길이로 고른다.
 * 둘이 다르면 화면에 보이는 "유사도 95%"가 정본과의 유사도가 아니고, 임계값도 정본이
 * 아닌 노트를 기준으로 걸러진 상태가 된다 — 정본과는 먼 노트가 흡수 대상으로 올라온다.
 *
 * 정본 기준으로 임계값에 미달하는 구성원은 군집에서 빠진다. 남은 수가 2 미만이면
 * 호출자가 군집 자체를 버린다.
 */
function rescoreAgainstCanonical(
  members: readonly DuplicateMember[],
  canonicalPath: string,
  byPath: ReadonlyMap<string, VaultIndexEntry>,
  minSimilarity: number
): DuplicateMember[] {
  const canonicalEntry = byPath.get(canonicalPath);
  if (!canonicalEntry) return [...members];

  const out: DuplicateMember[] = [];
  for (const member of members) {
    if (member.path === canonicalPath) {
      out.push({ ...member, similarity: 1 });
      continue;
    }

    const entry = byPath.get(member.path);
    if (!entry) continue;
    const cosine = maxEmbeddingSimilarity(canonicalEntry, entry);
    if (cosine === null) continue;

    const similarity = (cosine + 1) / 2;
    if (similarity < minSimilarity) continue;

    out.push({ ...member, similarity });
  }
  return out;
}

/** 정본을 고른다: 링크 많은 순 → 본문 긴 순 → 경로 짧은 순(결정적). */
function pickCanonical(members: DuplicateMember[]): DuplicateMember {
  return [...members].sort((a, b) => {
    if (b.linkCount !== a.linkCount) return b.linkCount - a.linkCount;
    if (b.bodyLength !== a.bodyLength) return b.bodyLength - a.bodyLength;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  })[0];
}

/**
 * 중복 후보 군집을 찾는다.
 *
 * 제목 버킷으로 후보를 좁힌 뒤 임베딩 유사도로 확증한다. 임베딩이 없거나 차원이 다른
 * 노트는 제외한다 — 제목만 비슷한 무관한 노트를 중복이라고 제안하면 신뢰를 잃는다.
 *
 * 같은 노트가 여러 군집에 들어가지 않는다. 한 노트를 두 정본에 배정하면 사용자가 어느
 * 쪽을 승인해도 나머지가 어긋난다.
 */
export function findDuplicateClusters(
  entries: readonly VaultIndexEntry[],
  options: CanonicalizeOptions = {}
): DuplicateCluster[] {
  const minSimilarity = options.minSimilarity ?? MIN_DUPLICATE_SIMILARITY;

  const usable = entries.filter(
    (e) => /\.md$/i.test(e.path) && !isGenerated(e.path, options.wikiFolder)
  );
  const byPath = new Map(usable.map((e) => [e.path, e]));
  const buckets = buildTitleBuckets(usable);

  const claimed = new Set<string>();
  const clusters: DuplicateCluster[] = [];

  // 완전 동일 제목을 토큰·약어보다 먼저 처리한다. 같은 인덱스에는 항상 같은 순서다.
  const bucketRank = (key: string): number =>
    key.startsWith("title:") ? 0 : key.startsWith("token:") ? 1 : 2;
  const bucketKeys = [...buckets.keys()].sort(
    (a, b) => bucketRank(a) - bucketRank(b) || a.localeCompare(b)
  );
  for (const key of bucketKeys) {
    const paths = buckets.get(key)!;
    const fresh = [...paths.filter((p) => !claimed.has(p))].sort();
    if (fresh.length < 2) continue;

    // 버킷의 **모든 쌍**을 비교해 연결 요소를 찾는다.
    //
    // 경로순 첫 노트만 기준으로 재면 그 노트가 무관할 때 군집을 통째로 놓친다 —
    // `Alpha Project`가 무관하고 `Beta Project`·`Gamma Project`만 같은 대상이면 B·C는
    // 서로 비교되지 않는다. 첫 노트에 임베딩이 없으면 버킷 전체를 잃기까지 했다.
    //
    // 버킷 크기가 MAX_CLUSTER_SIZE(8)로 제한되므로 쌍은 최대 28개다.
    for (const group of connectedGroups(fresh, byPath, minSimilarity)) {
      if (group.length < 2) continue;

      const members: DuplicateMember[] = group.map((entry) => ({
        path: entry.path,
        title: entry.title || basename(entry.path),
        // 정본을 고른 뒤 그 기준으로 다시 잰다(rescoreAgainstCanonical).
        similarity: 1,
        bodyLength: bodyLength(entry),
        linkCount: linkCount(entry),
      }));

      const seedCanonical = pickCanonical(members);
      const rescored = rescoreAgainstCanonical(members, seedCanonical.path, byPath, minSimilarity);
      // 정본 기준으로 다시 재면 남는 것이 정본 하나뿐일 수 있다. 그러면 군집이 아니다.
      if (rescored.length < 2) continue;

      const canonical = rescored.find((m) => m.path === seedCanonical.path) ?? seedCanonical;
      const duplicates = rescored
        .filter((m) => m.path !== canonical.path)
        .sort((a, b) => {
          // 유사도 동점은 경로로 깬다. 같은 임베딩을 가진 노트들이 흔하므로(템플릿에서
          // 만든 노트 등) 동점 처리를 빼면 결과가 입력 순서에 따라 흔들린다.
          if (b.similarity !== a.similarity) return b.similarity - a.similarity;
          return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
        });

      // 군집에서 빠진 노트는 claim하지 않는다 — 다른 버킷에서 제대로 묶일 수 있다.
      for (const m of rescored) claimed.add(m.path);
      clusters.push({
        canonical,
        duplicates,
        reason: key.startsWith("title:") ? "same-title" : "similar-title",
      });
    }
  }

  // 흡수 대상이 많은 군집이 먼저 오도록 정렬하되, 동수는 정본 경로로 깬다.
  return clusters.sort((a, b) => {
    if (b.duplicates.length !== a.duplicates.length) {
      return b.duplicates.length - a.duplicates.length;
    }
    return a.canonical.path < b.canonical.path ? -1 : 1;
  });
}

/** 정규화 제안을 기록할 Sentinel_Block 키. */
export const CANONICAL_BLOCK_KEY = "canonical-candidates";

/**
 * 정본 노트에 기록할 블록 본문을 만든다.
 *
 * 노트를 지우거나 합치지 않는다. 무엇이 중복 후보인지 정본 노트에 남겨 사용자가 직접
 * 판단하게 한다 — 오병합은 되돌리기 가장 어려운 손실이다.
 */
export function buildCanonicalBlock(cluster: DuplicateCluster): string {
  const lines = ["## 중복 후보", "", "다음 노트가 이 노트와 같은 대상을 다루는 것으로 보입니다.", ""];
  for (const d of cluster.duplicates) {
    // 링크 대상은 경로다. title은 인덱서가 뽑은 첫 H1이라 `[[제목]]`이 그 파일을
    // 가리키지 않는다 — 같은 제목의 노트가 여러 개인 것이 바로 이 군집의 전제다.
    const link = formatNoteLink(pathWithoutExtension(d.path), d.title);
    lines.push(`- ${link} — \`${d.path}\` (유사도 ${(d.similarity * 100).toFixed(1)}%)`);
  }
  lines.push("", "확인 후 직접 합치거나, 필요 없으면 이 블록을 지우세요.");
  return lines.join("\n");
}

/**
 * 프론트매터의 기존 `aliases` 값을 문자열 목록으로 정규화한다.
 *
 * 값은 문자열 하나이거나 배열이고, 배열에는 숫자·null이 섞여 있을 수 있다. 중복과
 * 대소문자 차이도 합친다.
 *
 * 별도 함수로 두는 이유: 호출부가 "몇 개 늘었는지"를 세려면 **정규화 후** 개수를 기준으로
 * 비교해야 한다. 원시 배열 길이와 비교하면 `[1, null, "old"]`처럼 잡음이 섞인 값에서
 * 정규화 후 개수가 원시 길이보다 작아, 실제로 별칭이 늘었는데도 안 늘어난 것으로 보고
 * 쓰기를 건너뛴다.
 */
export function normalizeAliases(existing: unknown): string[] {
  const values = typeof existing === "string" ? [existing] : Array.isArray(existing) ? existing : [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed === "") continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * 정본 노트의 `aliases` 프론트매터에 넣을 값을 계산한다.
 *
 * 별칭을 등록하면 옵시디언이 중복 노트 제목으로 걸린 링크도 정본으로 해석한다. 기존
 * 별칭은 보존하고 중복 없이 합친다 — 사용자가 직접 넣은 별칭을 덮어써선 안 된다.
 */
export function mergeAliases(
  existing: unknown,
  cluster: DuplicateCluster
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  for (const alias of normalizeAliases(existing)) add(alias);

  // 정본 **파일명**만 제외한다. 옵시디언이 이미 파일명으로 링크를 풀기 때문에 같은 값을
  // 별칭에 넣어도 하는 일이 없다.
  //
  // 정본의 H1은 제외하지 않는다. 정본 `People/john-profile.md`의 H1이 "John"이고 중복
  // 노트가 `Inbox/John.md`인 경우, H1으로 막으면 별칭이 하나도 안 남아 중복 노트를 지운
  // 뒤 기존 `[[John]]` 링크가 정본으로 해석되지 않는다 — 별칭의 존재 이유가 바로 그것이다.
  seen.add(basename(cluster.canonical.path).trim().toLowerCase());

  // 제목과 파일명을 **둘 다** 넣는다. 옵시디언은 `[[이름]]`을 파일명으로 먼저 풀기
  // 때문에, 중복 노트를 지운 뒤 그 노트를 가리켰던 링크를 정본으로 살리는 것은 파일명
  // 별칭이다. 제목만 넣으면 같은 제목끼리 묶인 군집(same-title)에서는 정본 제목과
  // 겹쳐 전부 걸러지고 별칭이 하나도 남지 않는다.
  for (const d of cluster.duplicates) {
    add(d.title);
    add(basename(d.path));
  }

  return out;
}
