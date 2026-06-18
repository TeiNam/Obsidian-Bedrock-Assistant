// 위키 구조 및 카탈로그 모듈 (Wiki Structure)
// ============================================
// Second Brain Layer가 생성·관리하는 위키 폴더의 인덱스 카탈로그(index.md)와
// 활동 로그(log.md)에 사용되는 순수 함수 + Vault I/O 래퍼를 제공한다.
//
// 이 파일의 순수 함수(buildIndexCatalog/formatLogEntry)는 외부 의존성이 없어
// fast-check 기반 속성 테스트가 가능하도록 분리되어 있다. Vault 접근이 필요한
// I/O 래퍼(ensureWikiFolders/writeIndexCatalog/appendActivityLog)는 파일 하단에
// 모아 두며, 테스트는 가짜 Vault를 주입하여 검증한다(graph-rag 모듈과 동일한
// "순수 코어 + 얇은 I/O 래퍼" 패턴).
//
// 핵심 보장:
// - 카테고리별 그룹핑 + 그룹 내 제목 오름차순(동일 시 경로 오름차순) 정렬 (Req 4.2)
// - 입력 순서에 무관하게 동일한 출력(정렬·그룹핑 안정성) (Req 4.3, Property 10)
// - 알 수 없는/미분류 카테고리는 "기타" 그룹으로 분류 (Req 4.6)
// - 빈 목록은 안내 문구를 가진 유효한 마크다운 반환 (Req 4.7)
// - 활동 로그는 타임스탬프 + 설명 한 줄 (Req 4.5)
// - 위키 폴더는 없으면 생성/있으면 유지 (Req 4.1)
// - 카탈로그 갱신 시 사용자 메모(User_Region) 보존 (Req 4.4)

import { App, TFile, normalizePath } from "obsidian";
import { upsertGeneratedBlock } from "./sentinel-blocks";

/** Wiki_Folder 하위에 두는 기본 카테고리 폴더 목록. 이 목록에 없는 카테고리는 "기타"로 분류된다. */
export const WIKI_CATEGORIES = ["entities", "concepts", "projects"] as const;

/** 알 수 없거나 미분류 노트를 모으는 그룹 이름 (Req 4.6). */
const UNCATEGORIZED = "기타";

/** Index_Catalog의 한 항목 — 노트의 경로·제목·카테고리. */
export interface CatalogEntry {
  /** 볼트 루트 기준 노트 경로 */
  path: string;
  /** 노트 제목 */
  title: string;
  /** 카테고리. WIKI_CATEGORIES에 없으면 "기타"로 분류된다 (Req 4.6). */
  category: string;
}

/**
 * 두 카탈로그 항목을 제목 오름차순(동일 제목 시 경로 오름차순)으로 비교한다.
 * 환경에 무관하게 결정적인 코드 유닛 비교를 사용하여 출력 안정성을 보장한다 (Req 4.3, Property 10).
 */
function compareEntries(a: CatalogEntry, b: CatalogEntry): number {
  if (a.title < b.title) return -1;
  if (a.title > b.title) return 1;
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/**
 * 항목의 카테고리를 정규화한다. WIKI_CATEGORIES에 속하면 그대로,
 * 아니면(빈 값·공백·미상 포함) "기타"로 분류한다 (Req 4.6).
 */
function resolveCategory(category: string): string {
  const trimmed = (category ?? "").trim();
  return (WIKI_CATEGORIES as readonly string[]).includes(trimmed)
    ? trimmed
    : UNCATEGORIZED;
}

/**
 * Index_Catalog 마크다운 문자열을 생성한다 (Req 4.2, 4.3, 4.6, 4.7).
 * - 카테고리별로 그룹핑하고, 그룹 순서는 WIKI_CATEGORIES 순서 + 마지막에 "기타"로 고정한다.
 * - 각 그룹 내 항목은 제목 오름차순(동일 시 경로 오름차순)으로 정렬한다.
 * - 입력 순서가 달라도 동일 원소면 동일 출력을 보장한다(안정성, Property 10).
 * - 항목이 없으면 빈 카탈로그 안내 문구를 가진 유효한 마크다운을 반환한다 (Req 4.7).
 */
export function buildIndexCatalog(entries: CatalogEntry[]): string {
  const heading = "# 📚 Index";

  // 빈 목록 → 안내 문구 (Req 4.7)
  if (!entries || entries.length === 0) {
    return `${heading}\n\n_아직 위키 노트가 없습니다._\n`;
  }

  // 카테고리별 그룹핑 (미상 카테고리는 "기타"로 분류, Req 4.6)
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const category = resolveCategory(entry.category);
    const bucket = groups.get(category);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(category, [entry]);
    }
  }

  // 그룹 출력 순서 고정: WIKI_CATEGORIES 순서 → "기타" (Req 4.3, Property 10)
  const orderedCategories: string[] = [...WIKI_CATEGORIES, UNCATEGORIZED];

  const sections: string[] = [];
  for (const category of orderedCategories) {
    const bucket = groups.get(category);
    if (!bucket || bucket.length === 0) continue;

    // 그룹 내 항목을 제목 오름차순(동일 시 경로)으로 정렬 (Req 4.2)
    const sorted = [...bucket].sort(compareEntries);
    const lines = sorted.map((e) => `- [[${e.path}|${e.title}]]`);
    sections.push(`## ${category}\n${lines.join("\n")}`);
  }

  return `${heading}\n\n${sections.join("\n\n")}\n`;
}

/**
 * Activity_Log 한 줄을 포맷한다 — 타임스탬프 + 동작 설명 (Req 4.5).
 * 타임스탬프는 ISO 8601 형식으로 직렬화하여 결정적으로 만든다.
 * 반환 문자열에는 줄바꿈을 포함하지 않으며, append 래퍼가 줄 단위로 추가한다.
 */
export function formatLogEntry(timestamp: number, message: string): string {
  const iso = new Date(timestamp).toISOString();
  return `- [${iso}] ${message}`;
}

// ============================================
// Vault I/O 래퍼 (부수효과 계층 — 테스트는 가짜 Vault 주입)
// ============================================
// 아래 래퍼들은 Obsidian Vault에 접근하므로 순수하지 않다. 위 순수 함수와 sentinel
// 병합 유틸을 조합하여 "비파괴 쓰기"(Generated_Region만 교체, User_Region 보존)와
// "옵트인 폴더 구조"(없으면 생성/있으면 유지)를 구현한다.

/** Wiki_Folder 내 인덱스 카탈로그 파일명. */
const INDEX_FILE = "index.md";
/** Wiki_Folder 내 활동 로그 파일명. */
const LOG_FILE = "log.md";
/** 카탈로그 본문을 감싸는 Sentinel_Block 키 (Req 4.4). */
const CATALOG_BLOCK_KEY = "catalog";

/**
 * 폴더가 없으면 생성하고, 이미 존재하면 그대로 둔다.
 * 기존 obsidian-tools/todo-manager의 폴더 보장 패턴(getAbstractFileByPath → createFolder)을 따른다.
 */
async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath);
  // 이미 존재하면(파일이든 폴더든) 새로 만들지 않는다 — 멱등성 보장 (Req 4.1).
  if (app.vault.getAbstractFileByPath(normalized)) return;
  await app.vault.createFolder(normalized);
}

/**
 * Wiki_Folder와 그 하위 카테고리 폴더(entities/concepts/projects)를 보장한다 (Req 4.1).
 * 없는 폴더만 생성하고, 이미 존재하는 폴더는 변경하지 않는다(멱등).
 */
export async function ensureWikiFolders(app: App, wikiFolder: string): Promise<void> {
  // 루트 Wiki_Folder를 먼저 만든 뒤 카테고리 하위 폴더를 만든다(부모 우선).
  await ensureFolder(app, wikiFolder);
  for (const category of WIKI_CATEGORIES) {
    await ensureFolder(app, `${wikiFolder}/${category}`);
  }
}

/**
 * Index_Catalog 마크다운을 index.md에 기록한다 (Req 4.4).
 * - 카탈로그 본문은 Block_Key `catalog`의 Sentinel_Block으로 관리한다.
 * - 기존 index.md가 있으면 현재 내용을 읽어 해당 블록만 교체(upsert)하므로,
 *   사용자가 직접 추가한 메모(User_Region)는 그대로 보존된다.
 * - 없으면 빈 문서에 카탈로그 블록을 추가하여 새로 생성한다.
 *
 * 주의: 인자 `catalog`는 buildIndexCatalog가 만든 카탈로그 마크다운 본문이며,
 * 이 함수는 그것을 sentinel 블록으로 감싸 파일에 반영하는 역할만 한다.
 */
export async function writeIndexCatalog(
  app: App,
  wikiFolder: string,
  catalog: string,
): Promise<void> {
  const indexPath = normalizePath(`${wikiFolder}/${INDEX_FILE}`);
  const existing = app.vault.getAbstractFileByPath(indexPath);

  if (existing instanceof TFile) {
    // 기존 문서: 현재 내용을 읽어 catalog 블록만 교체(User_Region 보존, Req 4.4).
    const current = await app.vault.read(existing);
    const updated = upsertGeneratedBlock(current, CATALOG_BLOCK_KEY, catalog);
    // 내용이 동일하면 불필요한 쓰기를 피한다(멱등).
    if (updated !== current) {
      await app.vault.modify(existing, updated);
    }
    return;
  }

  // 신규 문서: 빈 문서에 catalog 블록을 추가하여 생성한다.
  const content = upsertGeneratedBlock("", CATALOG_BLOCK_KEY, catalog);
  await app.vault.create(indexPath, content);
}

/**
 * Activity_Log(log.md)에 동작 한 줄을 append한다 (Req 4.5).
 * - 기존 로그 항목은 한 글자도 변경하지 않고, 새 줄만 끝에 덧붙인다.
 * - log.md가 없으면 새로 생성하고 첫 줄로 기록한다.
 * 타임스탬프는 호출 시점(Date.now())을 formatLogEntry로 직렬화한다.
 */
export async function appendActivityLog(
  app: App,
  wikiFolder: string,
  message: string,
): Promise<void> {
  const logPath = normalizePath(`${wikiFolder}/${LOG_FILE}`);
  const line = formatLogEntry(Date.now(), message);
  const existing = app.vault.getAbstractFileByPath(logPath);

  if (existing instanceof TFile) {
    // 기존 로그를 읽어 끝에 새 줄만 덧붙인다(기존 항목 불변, Req 4.5).
    const current = await app.vault.read(existing);
    const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
    await app.vault.modify(existing, `${current}${separator}${line}\n`);
    return;
  }

  // 신규 로그 파일: 첫 줄로 기록한다.
  await app.vault.create(logPath, `${line}\n`);
}
