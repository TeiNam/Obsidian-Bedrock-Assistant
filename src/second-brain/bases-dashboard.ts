import { TFile, TFolder, normalizePath, type App } from "obsidian";
import type { Locale, SecondBrainSettings } from "../types";
import type { VaultIndexer } from "../vault-indexer";
import { contentHash } from "../content-hash";
import { DASHBOARD_ITEMS_FOLDER_NAME, isDashboardItemPath } from "../dashboard-artifacts";
import {
  DECISION_BLOCK_KEY,
  DECISION_LEDGER_FILE,
  decisionKey,
  parseLedger,
  type DecisionEntry,
} from "./decisions";
import { collectGaps, type GapCandidate } from "./knowledge-gaps";
import {
  normalizeAccessLog,
  selectReviewQueue,
  type ReviewItem,
} from "./review-queue";
import {
  parseSynthesisProvenance,
  SYNTHESIS_PROVENANCE_BLOCK_KEY,
  type SynthesisProvenance,
} from "./synthesis-provenance";
import { getGeneratedBlock } from "./sentinel-blocks";
import { formatNoteLink, pathWithoutExtension } from "./wiki-link";
import { processIfChanged } from "./vault-write";

export const DASHBOARD_BASE_FILE = "Agent LLMs Dashboard.base";
const BASE_MARKER = "# agent-llms-dashboard: managed";

type DashboardType = "decision" | "question" | "stale" | "review";
type PropertyValue = string | number | boolean | string[];

interface DashboardItem {
  id: string;
  type: DashboardType;
  title: string;
  properties: Record<string, PropertyValue>;
  body: string;
}

interface DashboardContext {
  app: App;
  indexer: VaultIndexer;
  settings: SecondBrainSettings;
  wikiFolder: string;
  locale?: Locale;
}

export interface DashboardRefreshResult {
  basePath: string;
  itemCount: number;
}

export const DASHBOARD_I18N = {
  en: {
    generated: "This file is generated for the Agent LLMs Bases dashboard.",
    errors: {
      folderIsFile: (path: string) =>
        `The dashboard folder path collides with an existing file: ${path}`,
      fileIsFolder: (path: string) =>
        `The dashboard file path collides with an existing folder: ${path}`,
      userFileConflict: (path: string) =>
        `Not overwritten — an existing file of yours is in the way: ${path}`,
    },
    views: {
      decision: "Decision ledger",
      question: "Open questions",
      stale: "Outdated knowledge",
      review: "Review queue",
    },
    props: {
      title: "Title",
      status: "Status",
      owner: "Owner",
      due: "Due",
      sources: "Sources",
      detail: "Detail",
      weight: "Priority",
      changed: "Changed sources",
      score: "Score",
      age: "Days elapsed",
      links: "Links",
    },
  },
  ko: {
    generated: "Agent LLMs Bases 대시보드를 위해 자동 생성된 파일입니다.",
    errors: {
      folderIsFile: (path: string) => `대시보드 폴더 경로가 파일과 충돌합니다: ${path}`,
      fileIsFolder: (path: string) => `대시보드 파일 경로가 폴더와 충돌합니다: ${path}`,
      userFileConflict: (path: string) =>
        `기존 사용자 파일과 충돌해 덮어쓰지 않았습니다: ${path}`,
    },
    views: {
      decision: "결정 원장",
      question: "미해결 질문",
      stale: "오래된 지식",
      review: "복습 큐",
    },
    props: {
      title: "제목",
      status: "상태",
      owner: "담당",
      due: "기한",
      sources: "출처",
      detail: "상세",
      weight: "우선순위",
      changed: "변경된 출처",
      score: "점수",
      age: "경과일",
      links: "링크 수",
    },
  },
  ja: {
    generated: "Agent LLMs Bases ダッシュボード用に自動生成されたファイルです。",
    errors: {
      folderIsFile: (path: string) =>
        `ダッシュボードのフォルダパスが既存のファイルと衝突しています: ${path}`,
      fileIsFolder: (path: string) =>
        `ダッシュボードのファイルパスが既存のフォルダと衝突しています: ${path}`,
      userFileConflict: (path: string) =>
        `既存のユーザーファイルと衝突するため上書きしませんでした: ${path}`,
    },
    views: {
      decision: "意思決定台帳",
      question: "未解決の質問",
      stale: "古くなった知識",
      review: "復習キュー",
    },
    props: {
      title: "タイトル",
      status: "状態",
      owner: "担当",
      due: "期限",
      sources: "出典",
      detail: "詳細",
      weight: "優先度",
      changed: "変更された出典",
      score: "スコア",
      age: "経過日数",
      links: "リンク数",
    },
  },
} as const;

function labels(locale?: Locale) {
  return DASHBOARD_I18N[locale ?? "en"] ?? DASHBOARD_I18N.en;
}

function link(path: string): string {
  return formatNoteLink(pathWithoutExtension(path));
}

function yamlValue(value: PropertyValue): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function itemContent(item: DashboardItem, locale?: Locale): string {
  const properties: Record<string, PropertyValue> = {
    agent_llms_dashboard: true,
    dashboard_active: true,
    dashboard_type: item.type,
    title: item.title,
    ...item.properties,
  };
  const frontmatter = Object.entries(properties)
    .filter(([, value]) => value !== "" && (!Array.isArray(value) || value.length > 0))
    .map(([key, value]) => `${key}: ${yamlValue(value)}`)
    .join("\n");
  const heading = item.title.replace(/\r?\n/g, " ").trim();
  return [
    "---",
    frontmatter,
    "---",
    "",
    `# ${heading}`,
    "",
    `> [!note] ${labels(locale).generated}`,
    "",
    item.body,
    "",
  ].join("\n");
}

function decisionItem(entry: DecisionEntry): DashboardItem {
  return {
    id: `decision-${contentHash(decisionKey(entry.decision))}`,
    type: "decision",
    title: entry.decision,
    properties: {
      status: entry.status,
      owner: entry.owner,
      due: entry.due,
      detail: entry.rationale,
      sources: entry.sources.map(link),
    },
    body: [
      entry.rationale ? `## 이유\n\n${entry.rationale}` : "",
      `## 출처\n\n${entry.sources.map((path) => `- ${link(path)}`).join("\n")}`,
    ].filter(Boolean).join("\n\n"),
  };
}

function questionItem(gap: GapCandidate): DashboardItem {
  return {
    id: `question-${contentHash(`${gap.kind}:${gap.path}`)}`,
    type: "question",
    title: gap.path,
    properties: {
      status: "open",
      detail: gap.detail,
      weight: gap.weight,
      sources: [link(gap.path)],
    },
    body: `${link(gap.path)}\n\n${gap.detail}`,
  };
}

function staleItem(path: string, provenance: SynthesisProvenance): DashboardItem {
  const changed = provenance.changedPaths ?? [];
  return {
    id: `stale-${contentHash(path)}`,
    type: "stale",
    title: provenance.topic,
    properties: {
      status: "stale",
      sources: [link(path)],
      changed_sources: changed.map(link),
    },
    body: [
      `## 종합 노트\n\n${link(path)}`,
      `## 변경된 출처\n\n${changed.map((source) => `- ${link(source)}`).join("\n")}`,
    ].join("\n\n"),
  };
}

function reviewItem(item: ReviewItem): DashboardItem {
  return {
    id: `review-${contentHash(item.path)}`,
    type: "review",
    title: item.title,
    properties: {
      status: "review",
      score: Number(item.score.toFixed(2)),
      elapsed_days: item.elapsedDays,
      links: item.links,
      sources: [link(item.path)],
    },
    body: link(item.path),
  };
}

/** Obsidian Bases 공식 YAML 스키마에 맞는 4개 표 뷰를 만든다. */
export function buildBasesDashboard(wikiFolder: string, locale?: Locale): string {
  const t = labels(locale);
  const itemsFolder = normalizePath(`${wikiFolder}/${DASHBOARD_ITEMS_FOLDER_NAME}`);
  const filter = (type: DashboardType) => JSON.stringify(`dashboard_type == "${type}"`);
  const display = (name: string) => `    displayName: ${JSON.stringify(name)}`;
  const view = (type: DashboardType, order: string[]) => [
    "  - type: table",
    `    name: ${JSON.stringify(t.views[type])}`,
    "    filters:",
    "      and:",
    `        - ${filter(type)}`,
    "    order:",
    ...order.map((property) => `      - ${property}`),
  ].join("\n");

  return [
    BASE_MARKER,
    "filters:",
    "  and:",
    `    - ${JSON.stringify(`file.inFolder(${JSON.stringify(itemsFolder)})`)}`,
    '    - "agent_llms_dashboard == true"',
    '    - "dashboard_active == true"',
    "properties:",
    "  title:",
    display(t.props.title),
    "  status:",
    display(t.props.status),
    "  owner:",
    display(t.props.owner),
    "  due:",
    display(t.props.due),
    "  sources:",
    display(t.props.sources),
    "  detail:",
    display(t.props.detail),
    "  weight:",
    display(t.props.weight),
    "  changed_sources:",
    display(t.props.changed),
    "  score:",
    display(t.props.score),
    "  elapsed_days:",
    display(t.props.age),
    "  links:",
    display(t.props.links),
    "views:",
    view("decision", [
      "file.name",
      "note.status",
      "note.owner",
      "note.due",
      "note.sources",
      "note.detail",
    ]),
    view("question", [
      "file.name",
      "note.weight",
      "note.sources",
      "note.detail",
    ]),
    view("stale", [
      "file.name",
      "note.sources",
      "note.changed_sources",
    ]),
    view("review", [
      "file.name",
      "note.score",
      "note.elapsed_days",
      "note.links",
      "note.sources",
    ]),
    "",
  ].join("\n");
}

async function ensureFolder(app: App, path: string, locale: Locale | undefined): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) return;
  if (existing) throw new Error(labels(locale).errors.folderIsFile(path));
  await app.vault.createFolder(path);
}

async function writeManagedFile(
  app: App,
  path: string,
  content: string,
  marker: string,
  locale: Locale | undefined,
): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    const current = await app.vault.cachedRead(existing);
    if (!current.includes(marker)) {
      throw new Error(labels(locale).errors.userFileConflict(path));
    }
    await processIfChanged(app, existing, () => content);
    return;
  }
  if (existing) throw new Error(labels(locale).errors.fileIsFolder(path));
  await app.vault.create(path, content);
}

async function collectDashboardItems(
  ctx: DashboardContext,
  now: number,
): Promise<DashboardItem[]> {
  const entries = ctx.indexer.getEntries();
  const items: DashboardItem[] = [];

  const ledgerPath = normalizePath(`${ctx.wikiFolder}/${DECISION_LEDGER_FILE}`);
  const ledger = ctx.app.vault.getAbstractFileByPath(ledgerPath);
  if (ledger instanceof TFile) {
    const content = await ctx.app.vault.cachedRead(ledger);
    const block = getGeneratedBlock(content, DECISION_BLOCK_KEY) ?? "";
    items.push(...parseLedger(block).map(decisionItem));
  }

  const unresolved =
    (ctx.app.metadataCache as
      | { unresolvedLinks?: Record<string, Record<string, number>> }
      | undefined)?.unresolvedLinks ?? {};
  items.push(
    ...collectGaps(entries, unresolved, ctx.wikiFolder)
      .filter((gap) => gap.kind === "missing")
      .map(questionItem),
  );

  const prefix = `${normalizePath(ctx.wikiFolder)}/`;
  const vault = ctx.app.vault as typeof ctx.app.vault & {
    getMarkdownFiles?: () => TFile[];
    getFiles?: () => TFile[];
  };
  for (const file of vault.getMarkdownFiles?.() ?? []) {
    if (!file.path.startsWith(prefix) || isDashboardItemPath(file.path)) continue;
    const content = await ctx.app.vault.cachedRead(file);
    const provenance = parseSynthesisProvenance(
      getGeneratedBlock(content, SYNTHESIS_PROVENANCE_BLOCK_KEY),
    );
    if ((provenance?.changedPaths?.length ?? 0) > 0) {
      items.push(staleItem(file.path, provenance!));
    }
  }

  items.push(
    ...selectReviewQueue(
      entries,
      normalizeAccessLog(ctx.settings.accessLog),
      now,
      normalizeAccessLog(ctx.settings.reviewSurfaced),
      ctx.wikiFolder,
    ).map(reviewItem),
  );

  return items;
}

/** 결정·미해결 질문·오래된 종합·복습 큐를 투영하고 `.base` 대시보드를 갱신한다. */
export async function refreshBasesDashboard(
  ctx: DashboardContext,
  now = Date.now(),
): Promise<DashboardRefreshResult> {
  const wikiFolder = normalizePath(ctx.wikiFolder);
  const itemsFolder = normalizePath(`${wikiFolder}/${DASHBOARD_ITEMS_FOLDER_NAME}`);
  const basePath = normalizePath(`${wikiFolder}/${DASHBOARD_BASE_FILE}`);
  await ensureFolder(ctx.app, wikiFolder, ctx.locale);
  await ensureFolder(ctx.app, itemsFolder, ctx.locale);

  const items = await collectDashboardItems(ctx, now);
  const desiredPaths = new Set<string>();
  for (const item of items) {
    const path = normalizePath(`${itemsFolder}/${item.id}.md`);
    desiredPaths.add(path);
    await writeManagedFile(
      ctx.app,
      path,
      itemContent(item, ctx.locale),
      "agent_llms_dashboard: true",
      ctx.locale,
    );
  }

  // ponytail: 사라진 투영은 삭제하지 않고 비활성화한다. 생성 파일에 사용자가 메모를
  // 더했더라도 데이터가 사라지지 않는다. 폴더가 실제로 비대해질 때만 정리 정책을 추가한다.
  const vault = ctx.app.vault as typeof ctx.app.vault & {
    getFiles?: () => TFile[];
    getMarkdownFiles?: () => TFile[];
  };
  for (const file of vault.getFiles?.() ?? vault.getMarkdownFiles?.() ?? []) {
    if (!isDashboardItemPath(file.path) || desiredPaths.has(file.path)) continue;
    const content = await ctx.app.vault.cachedRead(file);
    if (!content.includes("agent_llms_dashboard: true")) continue;
    await processIfChanged(ctx.app, file, (current) =>
      current.replace(/^dashboard_active:\s*true\s*$/m, "dashboard_active: false")
    );
  }

  await writeManagedFile(
    ctx.app,
    basePath,
    buildBasesDashboard(wikiFolder, ctx.locale),
    BASE_MARKER,
    ctx.locale,
  );
  return { basePath, itemCount: items.length };
}
