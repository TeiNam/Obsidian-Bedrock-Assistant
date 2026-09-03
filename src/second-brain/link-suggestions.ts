// ============================================
// 의미 기반 링크 제안 — 순수 함수
// ============================================
// 지식 공백 리포트는 고아 노트("어떤 노트와도 연결되지 않음")를 찾아내지만, 그래서
// 무엇에 연결해야 하는지는 말해주지 않는다. 사용자는 목록만 받고 직접 후보를 찾아야 한다.
//
// 이 모듈은 인덱스에 이미 있는 임베딩으로 후보를 계산한다. LLM 호출이 없다 —
// "이 노트와 의미가 가까운 다른 노트"는 벡터 비교로 답할 수 있는 질문이다.
//
// 링크는 그래프를 영구히 바꾼다. 잘못된 링크는 RAG 이웃 확장을 오염시켜 이후 모든
// 검색에 영향을 주므로, 임계값을 높게 두고 사용자 승인 없이는 적용하지 않는다.

import type { VaultIndexEntry } from "../types";
import { compareVectors } from "../graph-rag/vector-search";
import {
  formatNoteLink,
  parseNoteLinks,
  pathWithoutExtension,
  type ParsedNoteLink,
} from "./wiki-link";

/** 링크 제안 1건. */
export interface LinkSuggestion {
  /** 링크를 추가할 노트(고아·스텁). */
  sourcePath: string;
  /** 링크 대상 후보. */
  targetPath: string;
  /** 대상 노트 제목 — 위키링크 표기와 화면 표시에 쓴다. */
  targetTitle: string;
  /** 코사인 유사도(0.0~1.0으로 정규화). 승인 판단의 근거로 화면에 보인다. */
  similarity: number;
}

/**
 * 링크로 인정할 최소 유사도(정규화 후).
 *
 * 높게 잡은 이유: 링크는 그래프를 영구히 바꾸고 이후 모든 검색의 이웃 확장에 영향을
 * 준다. 놓친 링크는 사용자가 나중에 직접 추가할 수 있지만, 잘못 추가된 링크는 그래프
 * 오염으로 남아 무관한 노트가 계속 결과에 끼어든다. 비대칭이 큰 만큼 보수적으로 둔다.
 */
export const MIN_LINK_SIMILARITY = 0.82;

/** 노트 하나당 제안할 최대 후보 수. 너무 많으면 승인 화면이 판단 불가능해진다. */
export const MAX_SUGGESTIONS_PER_NOTE = 3;

/** 코사인 유사도(-1~1)를 0~1로 정규화한다. score-combiner와 같은 규약이다. */
function normalize(cosine: number): number {
  return (cosine + 1) / 2;
}

/**
 * 노트를 대표하는 임베딩 하나를 고른다.
 *
 * 청크 전부를 서로 비교하면 (고아 수 × 전체 노트 수 × 청크² ) 번의 벡터 연산이 되어
 * 대형 볼트에서 명령이 몇 분씩 걸린다. 첫 청크는 노트의 도입부라 주제를 가장 잘
 * 대표하므로 이것으로 근사한다.
 *
 * ponytail: 노트당 대표 벡터 1개로 근사. 정밀도가 문제가 되면 청크 단위 최대 유사도로
 * 올리되, 그때는 후보 풀을 먼저 좁히는 단계가 함께 필요하다.
 */
export function representativeEmbedding(entry: VaultIndexEntry): number[] | null {
  for (const chunk of entry.chunks ?? []) {
    if (chunk.embedding && chunk.embedding.length > 0) return chunk.embedding;
  }
  // 청크가 없는 레거시 엔트리는 노트 단위 임베딩으로 폴백한다.
  if (entry.embedding && entry.embedding.length > 0) return entry.embedding;
  return null;
}

/** 이미 연결된 경로 집합(아웃링크 ∪ 백링크). 다시 제안하지 않기 위함이다. */
function linkedPaths(entry: VaultIndexEntry): Set<string> {
  return new Set([...(entry.outlinks ?? []), ...(entry.backlinks ?? [])]);
}

export interface SuggestOptions {
  /** 생성물 폴더. 위키 생성 노트는 후보에서 제외한다. */
  wikiFolder?: string;
  /** 최소 유사도. 기본 MIN_LINK_SIMILARITY. */
  minSimilarity?: number;
  /** 노트당 최대 제안 수. 기본 MAX_SUGGESTIONS_PER_NOTE. */
  maxPerNote?: number;
}

/** 경로가 생성물(위키 폴더 하위)인지. knowledge-gaps의 같은 규약을 따른다. */
function isGenerated(path: string, wikiFolder?: string): boolean {
  if (!wikiFolder) return false;
  return path === wikiFolder || path.startsWith(`${wikiFolder}/`);
}

/**
 * 한 노트에 대한 링크 후보를 유사도 내림차순으로 계산한다.
 *
 * 제외 대상: 자기 자신, 이미 연결된 노트, 생성물, 임베딩이 없는 노트,
 * 임베딩 차원이 다른 노트(비교 불가 — 유사도 0으로 취급하지 않는다).
 *
 * 동점은 경로 오름차순으로 깨서 같은 인덱스에 항상 같은 결과가 나오게 한다.
 */
export function suggestLinksForNote(
  source: VaultIndexEntry,
  allEntries: readonly VaultIndexEntry[],
  options: SuggestOptions = {}
): LinkSuggestion[] {
  const minSimilarity = options.minSimilarity ?? MIN_LINK_SIMILARITY;
  const maxPerNote = options.maxPerNote ?? MAX_SUGGESTIONS_PER_NOTE;

  const sourceVec = representativeEmbedding(source);
  if (sourceVec === null) return [];

  const alreadyLinked = linkedPaths(source);
  const scored: LinkSuggestion[] = [];

  for (const candidate of allEntries) {
    if (candidate.path === source.path) continue;
    if (alreadyLinked.has(candidate.path)) continue;
    if (isGenerated(candidate.path, options.wikiFolder)) continue;

    const vec = representativeEmbedding(candidate);
    if (vec === null) continue;

    const cosine = compareVectors(sourceVec, vec);
    // null은 "비교 불가"(차원 불일치)다. 0으로 취급하면 재인덱싱 중인 노트가
    // 조용히 후보 목록에 섞인다.
    if (cosine === null) continue;

    const similarity = normalize(cosine);
    if (similarity < minSimilarity) continue;

    scored.push({
      sourcePath: source.path,
      targetPath: candidate.path,
      targetTitle: candidate.title || candidate.path,
      similarity,
    });
  }

  scored.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return a.targetPath < b.targetPath ? -1 : a.targetPath > b.targetPath ? 1 : 0;
  });

  return scored.slice(0, maxPerNote);
}

/**
 * 여러 노트에 대한 링크 제안을 모은다.
 *
 * 결과는 source 경로 오름차순, 그 안에서 유사도 내림차순이다. 후보가 없는 노트는
 * 결과에 나타나지 않는다 — 승인 화면에 빈 항목을 보여줄 이유가 없다.
 */
export function suggestLinks(
  sources: readonly VaultIndexEntry[],
  allEntries: readonly VaultIndexEntry[],
  options: SuggestOptions = {}
): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];

  const ordered = [...sources].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  );
  for (const source of ordered) {
    out.push(...suggestLinksForNote(source, allEntries, options));
  }

  return out;
}

/** 링크 제안을 적용할 Sentinel_Block 키. reconcile·synthesize와 같은 비파괴 규약이다. */
export const RELATED_LINKS_BLOCK_KEY = "related-links";


/**
 * 제안 1건이 노트에 기록될 위키링크 표기.
 *
 * 승인 화면이 이 함수를 쓴다. 화면이 표기를 따로 만들면 사용자가 본 것과 기록되는 것이
 * 달라진다 — 실제로 화면은 `[[제목]]`을, 쓰기는 `[[경로|제목]]`을 쓰고 있었다.
 */
export function formatSuggestionLink(suggestion: LinkSuggestion): string {
  return formatNoteLink(pathWithoutExtension(suggestion.targetPath), suggestion.targetTitle.trim());
}

/**
 * 이미 기록된 관련 노트 블록에서 링크를 되읽는다.
 *
 * upsertGeneratedBlock은 블록 전체를 교체하므로, 새 승인분만으로 블록을 만들면 이전에
 * 승인한 링크가 사라진다. 사용자가 명시적으로 승인한 것을 다음 승인이 지우는 것은
 * 조용한 손실이다 — 기존 블록을 읽어 합집합으로 다시 쓴다.
 *
 * 별칭까지 함께 읽는다. 대상만 읽으면 같은 링크를 다시 승인할 때 `[[경로|제목]]`이
 * `[[경로]]`로 바뀌어 재실행이 멱등하지 않다.
 */
function parseRelatedLinks(block: string | null): ParsedNoteLink[] {
  if (block === null) return [];
  // 위키링크와 마크다운 링크를 모두 읽는다. formatNoteLink가 경로에 따라 둘 중 하나를
  // 쓰므로 한 형태만 읽으면 다음 병합에서 이전에 승인한 링크가 사라진다.
  return parseNoteLinks(block);
}

/** 기록된 블록의 링크 **대상 경로** 목록. */
export function parseRelatedLinksBlock(block: string | null): string[] {
  return parseRelatedLinks(block).map((link) => link.target);
}

/**
 * 기존 블록의 링크와 새로 승인한 링크를 합쳐 블록 본문을 만든다.
 *
 * 삽입 위치를 추측하지 않는다. Sentinel_Block으로 문서 끝에 병합하면 Generated_Region만
 * 교체되므로 사람이 쓴 부분이 보존되고, 다시 실행해도 블록이 중복되지 않는다.
 *
 * **링크 대상은 경로다.** `targetTitle`은 인덱서가 뽑은 첫 H1이지 파일명이 아니다 —
 * `Notes/2026-09-03.md`가 `# 회의`로 시작하면 `[[회의]]`는 그 파일을 가리키지 않고,
 * "회의"라는 다른 노트가 있으면 엉뚱한 곳을 가리킨다. 확장자를 뗀 경로로 링크하고
 * 제목은 표시용 별칭(`[[경로|제목]]`)으로 붙인다.
 *
 * 기존 링크를 먼저 두어 순서를 안정시킨다. 대소문자만 다른 중복은 하나로 합친다.
 */
export function mergeRelatedLinksBlock(
  existingBlock: string | null,
  suggestions: readonly LinkSuggestion[]
): string {
  /** 중복 판정용 소문자 키. 표시에는 쓰지 않는다 — 경로 대소문자를 보존해야 한다. */
  const seen = new Set<string>();
  const links: Array<{ target: string; alias: string }> = [];

  const add = (target: string, alias: string): void => {
    const t = target.trim();
    if (t === "") return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    // 별칭이 대상과 같으면 표기를 늘릴 이유가 없다.
    const a = alias.trim();
    links.push({ target: t, alias: a === t ? "" : a });
  };

  for (const { target, alias } of parseRelatedLinks(existingBlock)) add(target, alias);
  for (const s of suggestions) add(pathWithoutExtension(s.targetPath), s.targetTitle);

  if (links.length === 0) return "";

  const lines = ["## 관련 노트", ""];
  for (const { target, alias } of links) {
    lines.push(`- ${formatNoteLink(target, alias)}`);
  }
  return lines.join("\n");
}

/** 제안들을 source 경로별로 묶는다. 승인 화면과 적용 단계가 노트 단위로 돈다. */
export function groupBySource(
  suggestions: readonly LinkSuggestion[]
): Map<string, LinkSuggestion[]> {
  const grouped = new Map<string, LinkSuggestion[]>();
  for (const s of suggestions) {
    const list = grouped.get(s.sourcePath);
    if (list) list.push(s);
    else grouped.set(s.sourcePath, [s]);
  }
  return grouped;
}
