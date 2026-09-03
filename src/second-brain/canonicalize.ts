// ============================================
// 엔티티·개념 정규화 — 순수 함수
// ============================================
// 같은 인물·개념을 다룬 노트가 여러 개로 흩어지면 검색이 근거를 나눠 찾고, 어느 노트에
// 써야 할지도 매번 흔들린다. 이 모듈은 정본 후보와 흡수 대상을 제안한다.
//
// 제안만 한다. 노트를 지우거나 합치지 않는다 — 오병합은 되돌리기 가장 어려운 손실이다.
// 적용 단계는 정본 노트에 별칭과 후보 목록을 기록하는 것까지다.

import type { VaultIndexEntry } from "../types";
import { compareVectors } from "../graph-rag/vector-search";
import { representativeEmbedding } from "./link-suggestions";

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
 * ponytail: 제목이 전혀 다른 중복(예: "Kubernetes" vs "K8s")은 잡지 못한다. 잡으려면
 * 전체 임베딩 군집화가 필요하고, 그때는 차원 축소나 근사 최근접(ANN) 색인이 선행돼야 한다.
 *
 * @returns 버킷 키 → 경로 목록 (2개 이상인 버킷만)
 */
export function buildTitleBuckets(entries: readonly VaultIndexEntry[]): Map<string, string[]> {
  const exact = new Map<string, string[]>();
  const byToken = new Map<string, string[]>();

  for (const entry of entries) {
    const title = entry.title || basename(entry.path);
    const normalized = normalizeTitle(title);
    if (normalized === "") continue;

    // 1) 정규화 제목이 완전히 같은 노트들 — 가장 강한 신호다.
    const sameKey = `title:${normalized}`;
    (exact.get(sameKey) ?? exact.set(sameKey, []).get(sameKey)!).push(entry.path);

    // 2) 토큰을 공유하는 노트들.
    for (const token of new Set(titleTokens(title))) {
      const key = `token:${token}`;
      (byToken.get(key) ?? byToken.set(key, []).get(key)!).push(entry.path);
    }
  }

  const out = new Map<string, string[]>();
  for (const [key, paths] of [...exact, ...byToken]) {
    // 1개짜리 버킷은 비교할 상대가 없다. 과대 버킷("정리", "노트" 같은 흔한 토큰)은
    // 사실상 전체 스캔이 되므로 버린다.
    if (paths.length < 2 || paths.length > MAX_CLUSTER_SIZE) continue;
    out.set(key, paths);
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

  const usable = entries.filter((e) => !isGenerated(e.path, options.wikiFolder));
  const byPath = new Map(usable.map((e) => [e.path, e]));
  const buckets = buildTitleBuckets(usable);

  const claimed = new Set<string>();
  const clusters: DuplicateCluster[] = [];

  // 버킷 키를 정렬해 순회 순서를 고정한다 — 같은 인덱스에 항상 같은 군집이 나와야 한다.
  for (const key of [...buckets.keys()].sort()) {
    const paths = buckets.get(key)!;
    const fresh = paths.filter((p) => !claimed.has(p));
    if (fresh.length < 2) continue;

    // 버킷 안에서 첫 노트를 기준으로 유사도를 재고 임계값을 넘는 것만 남긴다.
    const seedPath = [...fresh].sort()[0];
    const seed = byPath.get(seedPath);
    const seedVec = seed ? representativeEmbedding(seed) : null;
    if (!seed || seedVec === null) continue;

    const members: DuplicateMember[] = [
      {
        path: seed.path,
        title: seed.title || basename(seed.path),
        similarity: 1,
        bodyLength: bodyLength(seed),
        linkCount: linkCount(seed),
      },
    ];

    // 경로 순으로 돌아 동점 시 순서가 입력 순서에 좌우되지 않게 한다.
    for (const path of [...fresh].sort()) {
      if (path === seedPath) continue;
      const entry = byPath.get(path);
      if (!entry) continue;

      const vec = representativeEmbedding(entry);
      if (vec === null) continue;
      const cosine = compareVectors(seedVec, vec);
      // null은 차원 불일치(비교 불가)다. 유사도 0으로 취급하면 재인덱싱 중인 노트가
      // 조용히 섞이고, 1로 취급하면 무관한 노트를 중복이라 제안한다.
      if (cosine === null) continue;

      const similarity = (cosine + 1) / 2;
      if (similarity < minSimilarity) continue;

      members.push({
        path: entry.path,
        title: entry.title || basename(entry.path),
        similarity,
        bodyLength: bodyLength(entry),
        linkCount: linkCount(entry),
      });
    }

    if (members.length < 2) continue;

    const canonical = pickCanonical(members);
    const duplicates = members
      .filter((m) => m.path !== canonical.path)
      .sort((a, b) => {
        // 유사도 동점은 경로로 깬다. 같은 임베딩을 가진 노트들이 흔하므로(템플릿에서
        // 만든 노트 등) 동점 처리를 빼면 결과가 입력 순서에 따라 흔들린다.
        if (b.similarity !== a.similarity) return b.similarity - a.similarity;
        return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
      });

    for (const m of members) claimed.add(m.path);
    clusters.push({
      canonical,
      duplicates,
      reason: key.startsWith("title:") ? "same-title" : "similar-title",
    });
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
    lines.push(`- [[${d.title}]] — \`${d.path}\` (유사도 ${(d.similarity * 100).toFixed(1)}%)`);
  }
  lines.push("", "확인 후 직접 합치거나, 필요 없으면 이 블록을 지우세요.");
  return lines.join("\n");
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

  // 기존 값은 문자열 하나이거나 배열이다. 둘 다 받는다.
  if (typeof existing === "string") add(existing);
  else if (Array.isArray(existing)) {
    for (const v of existing) if (typeof v === "string") add(v);
  }

  // 정본 자신의 제목은 별칭이 아니다.
  seen.add(cluster.canonical.title.trim().toLowerCase());
  for (const d of cluster.duplicates) add(d.title);

  return out;
}
