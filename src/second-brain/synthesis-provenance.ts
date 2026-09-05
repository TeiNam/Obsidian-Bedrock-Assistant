import { normalizePath, type App } from "obsidian";
import type { Locale, VaultIndexEntry } from "../types";
import type { VaultIndexer } from "../vault-indexer";
import { contentHash } from "../content-hash";
import type { SearchHit } from "./search-adapter";
import { formatAnchorLink, formatNoteLink, pathWithoutExtension } from "./wiki-link";
import { getGeneratedBlock, upsertGeneratedBlock } from "./sentinel-blocks";
import { processIfChanged } from "./vault-write";

export const SYNTHESIS_PROVENANCE_BLOCK_KEY = "synthesis-provenance";
const RECORD_PREFIX = "<!-- agent-llms-synthesis-provenance:";
const RECORD_SUFFIX = " -->";

export interface SynthesisSource {
  path: string;
  heading?: string;
  hash: string;
}

export interface SynthesisProvenance {
  version: 1;
  topic: string;
  generatedAt: string;
  sources: SynthesisSource[];
  changedPaths?: string[];
}

export const PROVENANCE_I18N = {
  en: {
    current: (count: number) => `Source check: current (${count} source chunk(s))`,
    stale: "Outdated synthesis",
    changed: "Changed source chunks:",
    refresh: "Run Synthesize topic again to regenerate it and review the diff.",
  },
  ko: {
    current: (count: number) => `출처 상태: 최신 (${count}개 출처 청크)`,
    stale: "오래된 종합 노트",
    changed: "변경된 출처 청크:",
    refresh: "주제 종합을 다시 실행하면 재생성 결과와 diff를 확인할 수 있습니다.",
  },
  ja: {
    current: (count: number) => `出典状態: 最新 (${count}件の出典チャンク)`,
    stale: "古くなった統合ノート",
    changed: "変更された出典チャンク:",
    refresh: "トピック統合を再実行すると、再生成結果と diff を確認できます。",
  },
} as const;

function labels(locale?: Locale) {
  return PROVENANCE_I18N[locale ?? "en"] ?? PROVENANCE_I18N.en;
}

/** 검색에 실제 사용한 청크를 출처 레코드로 만든다. */
export function buildSynthesisProvenance(
  topic: string,
  hits: readonly SearchHit[],
  generatedAt = new Date().toISOString(),
): SynthesisProvenance {
  return {
    version: 1,
    topic,
    generatedAt,
    sources: hits.map((hit) => ({
      path: normalizePath(hit.path),
      ...(hit.heading ? { heading: hit.heading } : {}),
      hash: hit.chunkHash ?? contentHash(hit.excerpt),
    })),
  };
}

function sourceLink(source: SynthesisSource): string {
  const target = pathWithoutExtension(source.path);
  if (source.heading) {
    const anchored = formatAnchorLink(target, source.heading);
    if (anchored) return anchored;
  }
  return formatNoteLink(target);
}

/** 사람이 보는 상태와 기계가 읽는 레코드를 한 블록으로 직렬화한다. */
export function formatSynthesisProvenance(
  provenance: SynthesisProvenance,
  locale?: Locale,
): string {
  const t = labels(locale);
  const changed = provenance.changedPaths ?? [];
  const lines: string[] = [];

  if (changed.length === 0) {
    lines.push(`> [!info] ${t.current(provenance.sources.length)}`);
  } else {
    lines.push(`> [!warning] ${t.stale}`);
    lines.push(`> ${t.changed}`);
    for (const path of changed) {
      const source = provenance.sources.find((item) => item.path === path);
      lines.push(`> - ${source ? sourceLink(source) : path}`);
    }
    lines.push(`> ${t.refresh}`);
  }

  const encoded = encodeURIComponent(JSON.stringify(provenance));
  lines.push(`${RECORD_PREFIX}${encoded}${RECORD_SUFFIX}`);
  return lines.join("\n");
}

/** 손상된 블록은 예외 없이 무시한다. */
export function parseSynthesisProvenance(block: string | null): SynthesisProvenance | null {
  if (!block) return null;
  const start = block.indexOf(RECORD_PREFIX);
  if (start < 0) return null;
  const encodedStart = start + RECORD_PREFIX.length;
  const end = block.indexOf(RECORD_SUFFIX, encodedStart);
  if (end < 0) return null;

  try {
    const raw = JSON.parse(decodeURIComponent(block.slice(encodedStart, end))) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (record.version !== 1 || typeof record.topic !== "string") return null;
    if (typeof record.generatedAt !== "string" || !Array.isArray(record.sources)) return null;

    const sources: SynthesisSource[] = [];
    for (const source of record.sources) {
      if (!source || typeof source !== "object" || Array.isArray(source)) return null;
      const item = source as Record<string, unknown>;
      if (typeof item.path !== "string" || item.path === "") return null;
      if (typeof item.hash !== "string" || !/^[0-9a-f]{16}$/i.test(item.hash)) return null;
      if (item.heading !== undefined && typeof item.heading !== "string") return null;
      sources.push({
        path: normalizePath(item.path),
        hash: item.hash.toLowerCase(),
        ...(typeof item.heading === "string" && item.heading !== ""
          ? { heading: item.heading }
          : {}),
      });
    }

    const changedPaths = Array.isArray(record.changedPaths)
      ? record.changedPaths
          .filter((value): value is string => typeof value === "string" && value !== "")
          .map(normalizePath)
      : [];
    return {
      version: 1,
      topic: record.topic,
      generatedAt: record.generatedAt,
      sources,
      ...(changedPaths.length > 0 ? { changedPaths: [...new Set(changedPaths)] } : {}),
    };
  } catch {
    return null;
  }
}

/** 문서에 최신 출처 상태 블록을 기록한다. */
export function upsertSynthesisProvenance(
  content: string,
  provenance: SynthesisProvenance,
  locale?: Locale,
): string {
  return upsertGeneratedBlock(
    content,
    SYNTHESIS_PROVENANCE_BLOCK_KEY,
    formatSynthesisProvenance(provenance, locale),
  );
}

function entryHashes(entry: VaultIndexEntry | undefined): Set<string> {
  if (!entry) return new Set();
  const hashes = new Set((entry.chunks ?? []).map((chunk) => contentHash(chunk.text)));
  hashes.add(contentHash(entry.excerpt));
  return hashes;
}

function evaluateProvenance(
  provenance: SynthesisProvenance,
  byPath: ReadonlyMap<string, VaultIndexEntry>,
  sourcePath?: string,
): SynthesisProvenance {
  const changed = new Set(provenance.changedPaths ?? []);
  const targets = sourcePath
    ? provenance.sources.filter((source) => source.path === sourcePath)
    : provenance.sources;

  for (const source of targets) {
    if (entryHashes(byPath.get(source.path)).has(source.hash)) changed.delete(source.path);
    else changed.add(source.path);
  }

  return {
    ...provenance,
    ...(changed.size > 0 ? { changedPaths: [...changed].sort() } : { changedPaths: undefined }),
  };
}

/**
 * 종합 노트의 출처 해시를 현재 인덱스와 비교해 상태 블록을 갱신한다.
 * sourcePath를 주면 그 출처를 참조하는 노트만 판정한다.
 */
async function refreshSynthesisProvenance(
  app: App,
  indexer: VaultIndexer,
  wikiFolder: string,
  locale?: Locale,
  sourcePath?: string,
): Promise<number> {
  // ponytail: 변경마다 위키 폴더를 선형 스캔한다. 종합 노트 수가 실제 병목이 될 때만
  // sourcePath → synthesisPath 역색인을 추가한다.
  const folder = normalizePath(wikiFolder);
  const prefix = folder === "" ? "" : `${folder}/`;
  const normalizedSource = sourcePath ? normalizePath(sourcePath) : undefined;
  const byPath = new Map(indexer.getEntries().map((entry) => [entry.path, entry]));
  let updated = 0;

  for (const file of app.vault.getMarkdownFiles()) {
    if (prefix !== "" && !file.path.startsWith(prefix)) continue;
    const current = await app.vault.cachedRead(file);
    const parsed = parseSynthesisProvenance(
      getGeneratedBlock(current, SYNTHESIS_PROVENANCE_BLOCK_KEY),
    );
    if (!parsed) continue;
    if (
      normalizedSource &&
      !parsed.sources.some((source) => source.path === normalizedSource)
    ) {
      continue;
    }

    const next = evaluateProvenance(parsed, byPath, normalizedSource);
    const wrote = await processIfChanged(app, file, (content) =>
      upsertSynthesisProvenance(content, next, locale)
    );
    if (wrote) updated++;
  }

  return updated;
}

export function refreshSynthesisProvenanceForSource(
  app: App,
  indexer: VaultIndexer,
  sourcePath: string,
  wikiFolder: string,
  locale?: Locale,
): Promise<number> {
  return refreshSynthesisProvenance(app, indexer, wikiFolder, locale, sourcePath);
}

export function refreshAllSynthesisProvenance(
  app: App,
  indexer: VaultIndexer,
  wikiFolder: string,
  locale?: Locale,
): Promise<number> {
  return refreshSynthesisProvenance(app, indexer, wikiFolder, locale);
}

/** 재생성 전후의 한 덩어리 변경 구간을 읽기 쉬운 diff로 만든다. */
export function buildSynthesisDiff(before: string, after: string, maxLines = 40): string {
  if (before === after) return "";
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  // ponytail: 단일 변경 창 diff다. 여러 산발 변경의 정밀 정렬이 필요해질 때 LCS로 교체한다.
  const lines = [
    ...oldLines.slice(start, oldEnd).map((line) => `- ${line}`),
    ...newLines.slice(start, newEnd).map((line) => `+ ${line}`),
  ];
  if (lines.length > maxLines) {
    return [...lines.slice(0, maxLines), `… ${lines.length - maxLines} lines omitted`].join("\n");
  }
  return lines.join("\n");
}
