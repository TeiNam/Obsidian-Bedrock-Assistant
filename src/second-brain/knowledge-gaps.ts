// 지식 공백 리포트 (Knowledge Gaps) — 순수 모듈
// ================================================
// "무엇을 아는가"는 검색으로 알 수 있지만 "무엇을 모르는가"는 알 수 없다.
// 인덱스에 이미 있는 outlinks/backlinks/chunks로 구조적 공백을 계산한다.
//
// 이 모듈은 전부 순수 함수이며 LLM·임베딩 호출이 0회다. 볼트가 1000노트여도
// 비용은 로컬 O(V+E) 계산뿐이다. LLM 서술은 호출부가 선택적으로 붙인다.
//
// 중요: 인덱스는 "볼트에 존재하는 링크만" 보존한다(graph-extractor). 따라서
// 깨진 링크(아직 만들지 않은 노트)는 이 인덱스로 알 수 없고,
// metadataCache.unresolvedLinks를 별도로 넘겨받아야 한다.
//
// 원칙: 자동 수정은 하지 않는다. 단방향 링크는 의도적일 수 있고, 짧은 노트가
// 항상 미완성인 것도 아니다. 이 모듈은 "볼 곳"만 제시한다.

import { normalizePath, TFile } from "obsidian";
import type { App } from "obsidian";
import type { VaultIndexEntry } from "../types";
import { upsertGeneratedBlock } from "./sentinel-blocks";
import { processIfChanged } from "./vault-write";
import { formatNoteLink, pathWithoutExtension } from "./wiki-link";
import { toolI18n } from "../tool-result-i18n";
import type { Locale } from "../types";

/** 스텁(내용 부족) 판정 기준 본문 길이. 이보다 짧으면 후보가 된다. */
export const STUB_MAX_CHARS = 200;

/** 리포트에 담을 최대 후보 수. 상한이 없으면 대형 볼트에서 리포트가 노트를 압도한다. */
export const GAP_REPORT_LIMIT = 20;

/** 공백 후보의 종류. */
export type GapKind = "orphan" | "stub" | "one-way" | "missing";

/** 공백 후보 1건. */
export interface GapCandidate {
  kind: GapKind;
  /** 대상 노트 경로(missing은 아직 존재하지 않는 링크 대상 이름) */
  path: string;
  /** 사용자에게 보일 근거. "왜 이게 공백인가"를 숫자로 설명한다. */
  detail: string;
  /** 정렬 가중치. 클수록 먼저 보여준다. */
  weight: number;
}

/**
 * 경로가 생성물(위키 폴더 하위)인지 판별한다.
 * 생성 노트가 통계를 오염시키면 사용자가 손대야 할 대상이 뒤로 밀린다.
 */
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
 * 고아 노트: outlinks와 backlinks가 모두 비어 어떤 노트와도 연결되지 않은 노트.
 * 검색으로는 찾을 수 있지만 그래프 순회로는 절대 도달하지 않으므로, RAG의
 * 이웃 확장 혜택을 전혀 받지 못한다.
 */
export function findOrphanNotes(
  entries: VaultIndexEntry[],
  wikiFolder?: string,
): GapCandidate[] {
  const gaps: GapCandidate[] = [];
  for (const entry of entries) {
    if (isGenerated(entry.path, wikiFolder)) continue;
    const out = entry.outlinks?.length ?? 0;
    const back = entry.backlinks?.length ?? 0;
    if (out === 0 && back === 0) {
      gaps.push({
        kind: "orphan",
        path: entry.path,
        detail: "들어오는 링크도 나가는 링크도 없습니다(그래프 순회로 도달 불가).",
        // 본문이 길수록 연결 안 된 손실이 크다. 1000자당 1점.
        weight: 1 + Math.min(bodyLength(entry) / 1000, 5),
      });
    }
  }
  return gaps;
}

/**
 * 스텁 노트: 백링크는 있는데 본문이 거의 없는 노트.
 * 여러 곳에서 참조하는데 내용이 없다는 것은 "채워야 할 자리"가 명확하다는 뜻이다.
 * 백링크가 없는 짧은 노트는 그냥 메모이므로 제외한다.
 */
export function findStubNotes(
  entries: VaultIndexEntry[],
  wikiFolder?: string,
): GapCandidate[] {
  const gaps: GapCandidate[] = [];
  for (const entry of entries) {
    if (isGenerated(entry.path, wikiFolder)) continue;
    const back = entry.backlinks?.length ?? 0;
    if (back === 0) continue;

    const len = bodyLength(entry);
    if (len >= STUB_MAX_CHARS) continue;

    gaps.push({
      kind: "stub",
      path: entry.path,
      detail: `백링크 ${back}개인데 본문이 ${len}자뿐입니다.`,
      // 참조가 많을수록 시급하다.
      weight: 2 + back,
    });
  }
  return gaps;
}

/**
 * 단방향 링크: A가 B를 링크하는데 B의 백링크에 A가 없는 경우.
 *
 * 인덱스의 outlinks/backlinks가 서로 어긋난 상태를 뜻하며, 보통 B가 A를
 * 되돌아보지 않아 맥락이 한 방향으로만 흐른다는 신호다. 의도적인 경우도 많으므로
 * 가중치를 낮게 두고 자동 수정은 하지 않는다.
 *
 * 인덱스에 없는 대상(깨진 링크)은 여기서 다루지 않는다 — findUnresolvedLinkTargets 담당.
 */
export function findOneWayLinks(
  entries: VaultIndexEntry[],
  wikiFolder?: string,
): GapCandidate[] {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const gaps: GapCandidate[] = [];

  for (const entry of entries) {
    if (isGenerated(entry.path, wikiFolder)) continue;
    for (const target of entry.outlinks ?? []) {
      const targetEntry = byPath.get(target);
      // 존재하지 않는 대상은 깨진 링크이므로 건너뛴다.
      if (!targetEntry) continue;
      if (isGenerated(target, wikiFolder)) continue;
      if ((targetEntry.backlinks ?? []).includes(entry.path)) continue;

      gaps.push({
        kind: "one-way",
        path: entry.path,
        detail: `${target}를 링크하지만 되돌아오는 참조가 없습니다.`,
        weight: 1,
      });
    }
  }
  return gaps;
}

/**
 * 깨진 링크 대상: 여러 노트가 참조하지만 아직 만들어지지 않은 노트.
 *
 * 인덱스는 존재하는 링크만 보존하므로 이 정보는 Obsidian의
 * `metadataCache.unresolvedLinks`(소스 경로 → { 대상 이름: 횟수 })에서 온다.
 * 여러 곳에서 찾는 대상일수록 실제로 필요한 노트다.
 */
export function findUnresolvedLinkTargets(
  unresolvedLinks: Record<string, Record<string, number>>,
  wikiFolder?: string,
): GapCandidate[] {
  // 대상별 총 참조 횟수와 참조 출처 수를 집계한다.
  const counts = new Map<string, { total: number; sources: number }>();

  for (const [source, targets] of Object.entries(unresolvedLinks ?? {})) {
    // 생성 노트가 만든 링크는 통계에서 뺀다.
    if (isGenerated(source, wikiFolder)) continue;
    for (const [target, count] of Object.entries(targets ?? {})) {
      if (!Number.isFinite(count) || count <= 0) continue;
      const prev = counts.get(target) ?? { total: 0, sources: 0 };
      counts.set(target, { total: prev.total + count, sources: prev.sources + 1 });
    }
  }

  const gaps: GapCandidate[] = [];
  for (const [target, { total, sources }] of counts) {
    gaps.push({
      kind: "missing",
      path: target,
      detail: `${sources}개 노트에서 총 ${total}번 참조하지만 아직 없습니다.`,
      // 여러 출처에서 찾는 대상을 앞세운다.
      weight: 3 + total,
    });
  }
  return gaps;
}

/**
 * 후보를 가중치 내림차순으로 정렬하고 상한을 적용한다 — 순수 함수.
 *
 * 동일 가중치는 종류 → 경로 오름차순으로 결정적 순서를 유지한다. 매 실행마다
 * 순서가 바뀌면 sentinel 블록이 계속 변경돼 볼트 diff가 시끄러워진다.
 */
export function rankGaps(candidates: GapCandidate[]): GapCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    })
    .slice(0, GAP_REPORT_LIMIT);
}

/** 종류별 사람이 읽는 제목. */
const KIND_HEADINGS: Record<GapKind, string> = {
  missing: "참조되지만 없는 노트",
  stub: "참조는 받는데 내용이 부족한 노트",
  orphan: "어디에도 연결되지 않은 노트",
  "one-way": "한 방향으로만 연결된 노트",
};

/** 리포트 렌더 순서(중요도 순). */
const KIND_ORDER: GapKind[] = ["missing", "stub", "orphan", "one-way"];

/**
 * 공백 후보를 마크다운으로 렌더한다 — 순수 함수(결정론).
 *
 * 노트 경로는 위키링크로 표기해 클릭 이동이 되게 한다. 아직 없는 노트(missing)도
 * 위키링크로 두면 클릭해서 바로 만들 수 있다.
 */
export function buildGapReport(candidates: GapCandidate[], locale?: Locale): string {
  if (candidates.length === 0) {
    return toolI18n(locale).gapsNone;
  }

  const lines: string[] = [];
  for (const kind of KIND_ORDER) {
    const group = candidates.filter((c) => c.kind === kind);
    if (group.length === 0) continue;

    lines.push(`### ${KIND_HEADINGS[kind]}`);
    lines.push("");
    for (const gap of group) {
      // 링크는 확장자 없는 경로를 쓴다. 경로에 `#`·`|`가 있으면 위키링크로 쓸 수 없어
      // formatNoteLink가 마크다운 링크로 물러난다.
      lines.push(`- ${formatNoteLink(pathWithoutExtension(gap.path))} — ${gap.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ============================================
// 실행 계층 (I/O) — LLM 호출 없음
// ============================================

/** 공백 리포트 노트의 위키 폴더 기준 상대 경로. */
export const GAP_REPORT_FILE = "Knowledge Gaps.md";

/** 리포트 본문을 담는 sentinel 블록 키. */
export const GAP_BLOCK_KEY = "knowledge-gaps";

/**
 * 인덱스 엔트리와 미해결 링크로부터 공백 후보 전체를 계산한다 — 순수 함수.
 * 네 종류를 모두 모아 rankGaps로 상위만 남긴다.
 */
export function collectGaps(
  entries: VaultIndexEntry[],
  unresolvedLinks: Record<string, Record<string, number>>,
  wikiFolder?: string,
): GapCandidate[] {
  return rankGaps([
    ...findUnresolvedLinkTargets(unresolvedLinks, wikiFolder),
    ...findStubNotes(entries, wikiFolder),
    ...findOrphanNotes(entries, wikiFolder),
    ...findOneWayLinks(entries, wikiFolder),
  ]);
}

/**
 * 공백 리포트를 `{wikiFolder}/Knowledge Gaps.md`에 기록한다.
 *
 * sentinel 블록만 교체하므로 사용자가 같은 노트에 적어둔 메모는 보존된다.
 * 내용이 이전과 같으면 쓰지 않는다(멱등) — 매 주기마다 mtime이 바뀌면 그 노트가
 * "방금 수정된 노트"로 잡혀 최근 노트 선별 등을 오염시킨다.
 */
export async function writeGapReport(
  app: App,
  wikiFolder: string,
  report: string,
): Promise<void> {
  const path = normalizePath(`${wikiFolder}/${GAP_REPORT_FILE}`);
  const existing = app.vault.getAbstractFileByPath(path);

  if (existing instanceof TFile) {
    await processIfChanged(app, existing, (content) =>
      upsertGeneratedBlock(content, GAP_BLOCK_KEY, report)
    );
    return;
  }

  await app.vault.create(path, upsertGeneratedBlock("", GAP_BLOCK_KEY, report));
}
