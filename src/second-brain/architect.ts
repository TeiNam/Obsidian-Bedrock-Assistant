// 코드베이스 아키텍트 순수 모듈 (Second Brain Layer)
// ==================================================
// 파일 경로 목록에서 폴더/모듈 구조와 진입점을 추출하고(scanModuleTree),
// 그 트리를 아키텍처 노트 섹션(overview/모듈/결정)으로 렌더한다(buildArchitectureSections).
//
// 설계 원칙:
//  - 부수효과 없는 순수 함수 (fast-check 기반 속성 테스트 가능)
//  - 무손실 커버리지: scanModuleTree 가 반환한 트리의 리프(파일) 경로 집합은
//    입력 경로 집합과 동일하다(누락·중복 없음) — Property 13
//  - 결정론: 동일 입력은 입력 순서와 무관하게 동일한 트리/섹션을 만든다
//  - 플러그인 이름/ID 하드코딩 금지(이 모듈은 구조 정보만 다루므로 브랜딩 무관)
//
// ⚠️ 도구 핸들러/runArchitect(실행 래퍼)는 Task 9.4 로 분리한다. 본 파일은 순수 함수만 둔다.

// ============================================
// 타입
// ============================================

export interface ModuleNode {
  /** 디렉터리/파일 경로. 파일 리프는 입력 경로 문자열을 그대로 보존한다. */
  path: string;
  /** 노드 종류 */
  kind: "dir" | "file";
  /** 자식 노드(디렉터리에만 존재). 결정론을 위해 (kind, path) 기준 정렬된다. */
  children?: ModuleNode[];
  /** 진입점 파일 표시(예: main.ts / index.ts) */
  isEntryPoint?: boolean;
}

// ============================================
// 상수
// ============================================

/**
 * 진입점으로 간주하는 파일 basename 집합(소문자 비교).
 * 휴리스틱은 결정론적이며 언어별 관용 진입점만 포함한다.
 */
const ENTRY_POINT_BASENAMES: ReadonlySet<string> = new Set([
  "main.ts",
  "main.js",
  "main.tsx",
  "main.jsx",
  "index.ts",
  "index.js",
  "index.tsx",
  "index.jsx",
  "main.py",
  "__main__.py",
  "main.rs",
  "lib.rs",
  "mod.rs",
  "main.go",
]);

/** 아키텍처 노트 섹션(= Sentinel_Block Block_Key) 목록. */
export const ARCHITECTURE_SECTION_KEYS = ["overview", "modules", "decisions"] as const;

// ============================================
// 내부 헬퍼
// ============================================

/** 경로의 마지막 세그먼트(파일/폴더 이름)를 반환한다. */
function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** basename 이 진입점 관용 이름인지 판정한다(결정론적, 대소문자 무시). */
function isEntryPointName(name: string): boolean {
  return ENTRY_POINT_BASENAMES.has(name.toLowerCase());
}

/**
 * 트리 빌드용 내부 가변 노드. 자식은 `${kind}:${name}` 키 맵으로 관리하여
 * 동일 이름의 파일과 디렉터리가 충돌 없이 공존하게 한다(무손실 커버리지 보장).
 */
interface BuildNode {
  path: string;
  kind: "dir" | "file";
  isEntryPoint?: boolean;
  childMap: Map<string, BuildNode>;
}

/** 새 빌드 노드를 만든다. */
function makeBuildNode(path: string, kind: "dir" | "file"): BuildNode {
  return { path, kind, childMap: new Map() };
}

/**
 * 단일 입력 경로를 트리에 삽입한다.
 *  - 중간 세그먼트는 디렉터리 노드로, 마지막 세그먼트는 파일 노드로 만든다.
 *  - 파일 리프의 path 는 입력 문자열을 그대로 보존한다(Property 13 핵심).
 *  - 파일/디렉터리는 별도 키(`file:`/`dir:`)로 구분하여 같은 이름이어도 둘 다 보존한다.
 *  - 동일 입력 경로 중복은 같은 파일 키로 수렴하여 한 리프로 dedupe 된다.
 */
function insertPath(root: BuildNode, originalPath: string): void {
  const segments = originalPath.split("/");
  let current = root;
  let prefix = "";

  for (let i = 0; i < segments.length; i++) {
    const name = segments[i];
    prefix = i === 0 ? name : `${prefix}/${name}`;
    const isLast = i === segments.length - 1;

    if (isLast) {
      // 파일 리프: 입력 경로 문자열을 그대로 path 로 보존한다.
      const key = `file:${name}`;
      if (!current.childMap.has(key)) {
        const fileNode = makeBuildNode(originalPath, "file");
        if (isEntryPointName(name)) fileNode.isEntryPoint = true;
        current.childMap.set(key, fileNode);
      }
      // 이미 존재하면 동일 경로 중복이므로 무시(dedupe).
    } else {
      // 중간 디렉터리: 없으면 누적 경로로 생성하고 진입한다.
      const key = `dir:${name}`;
      let dir = current.childMap.get(key);
      if (dir === undefined) {
        dir = makeBuildNode(prefix, "dir");
        current.childMap.set(key, dir);
      }
      current = dir;
    }
  }
}

/**
 * 빌드 노드를 공개 ModuleNode 로 변환한다.
 * 자식은 결정론을 위해 (kind, path) 사전순으로 정렬한다(디렉터리가 파일보다 앞).
 */
function finalizeNode(node: BuildNode): ModuleNode {
  const result: ModuleNode = { path: node.path, kind: node.kind };
  if (node.isEntryPoint === true) result.isEntryPoint = true;

  if (node.kind === "dir") {
    const children = Array.from(node.childMap.values())
      .map(finalizeNode)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1; // "dir" < "file"
        return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
      });
    result.children = children;
  }
  return result;
}

/** 트리를 순회하며 모든 파일 리프 노드를 수집한다. */
function collectFiles(node: ModuleNode): ModuleNode[] {
  if (node.kind === "file") return [node];
  const files: ModuleNode[] = [];
  for (const child of node.children ?? []) {
    files.push(...collectFiles(child));
  }
  return files;
}

/** 루트를 제외한 모든 디렉터리 노드를 수집한다. */
function collectDirs(node: ModuleNode, isRoot = true): ModuleNode[] {
  const dirs: ModuleNode[] = [];
  if (node.kind === "dir" && !isRoot) dirs.push(node);
  for (const child of node.children ?? []) {
    dirs.push(...collectDirs(child, false));
  }
  return dirs;
}

/** 모듈 트리를 중첩 마크다운 불릿 목록 라인으로 렌더한다(결정론적). */
function renderModuleLines(node: ModuleNode, depth: number): string[] {
  const lines: string[] = [];
  for (const child of node.children ?? []) {
    const indent = "  ".repeat(depth);
    const name = basename(child.path);
    if (child.kind === "dir") {
      lines.push(`${indent}- ${name}/`);
      lines.push(...renderModuleLines(child, depth + 1));
    } else {
      const mark = child.isEntryPoint === true ? " (진입점)" : "";
      lines.push(`${indent}- ${name}${mark}`);
    }
  }
  return lines;
}

// ============================================
// 공개 API
// ============================================

/**
 * 파일 경로 목록에서 모듈 구조·진입점을 추출하여 순수 함수로 트리를 반환한다 (Req 10.2).
 *
 * - 반환 트리의 루트는 빈 경로("")를 가진 디렉터리 노드이며, 입력 경로의 세그먼트를
 *   기준으로 하위 디렉터리/파일 노드를 구성한다.
 * - 파일 리프 노드의 path 는 입력 문자열을 그대로 보존하므로, 리프 경로 집합은
 *   (중복 제거된) 입력 경로 집합과 정확히 일치한다 — Property 13.
 * - main.ts/index.ts 등 관용 진입점 파일은 isEntryPoint 로 표시한다(결정론적 휴리스틱).
 */
export function scanModuleTree(paths: string[]): ModuleNode {
  const root = makeBuildNode("", "dir");
  for (const path of paths) {
    insertPath(root, path);
  }
  return finalizeNode(root);
}

/**
 * 모듈 트리를 아키텍처 노트 섹션(overview/modules/decisions)으로 렌더한다 — 순수 함수.
 *
 * 반환 객체의 키는 ARCHITECTURE_SECTION_KEYS(= Sentinel_Block Block_Key)이며,
 * 각 값은 해당 섹션의 마크다운 본문이다. runArchitect(9.4)는 이 본문을
 * upsertGeneratedBlock(key, content)으로 노트에 기록한다.
 */
export function buildArchitectureSections(tree: ModuleNode): Record<string, string> {
  const files = collectFiles(tree);
  const dirs = collectDirs(tree);
  const entryPoints = files
    .filter((f) => f.isEntryPoint === true)
    .map((f) => f.path)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // --- overview 섹션 ---
  const entryPointLabel =
    entryPoints.length > 0 ? entryPoints.map((p) => `\`${p}\``).join(", ") : "없음";
  const overview = [
    "## 개요",
    "",
    `- 총 파일 수: ${files.length}`,
    `- 총 디렉터리 수: ${dirs.length}`,
    `- 진입점: ${entryPointLabel}`,
  ].join("\n");

  // --- modules 섹션 ---
  // 모든 파일을 한 줄씩 렌더하므로 대형 볼트에서 골격이 무한정 커진다. 프롬프트에
  // 들어가는 크기를 제한하고, 잘라낸 분량을 명시해 LLM이 부분 정보임을 알게 한다.
  const allModuleLines = renderModuleLines(tree, 0);
  const moduleLines = allModuleLines.slice(0, MAX_MODULE_LINES);
  const omittedLines = allModuleLines.length - moduleLines.length;
  const modules = [
    "## 모듈 구조",
    "",
    ...(moduleLines.length > 0 ? moduleLines : ["_모듈이 없습니다._"]),
    ...(omittedLines > 0 ? ["", `_... 외 ${omittedLines}개 항목 생략_`] : []),
  ].join("\n");

  // --- decisions 섹션 ---
  // 순수 함수는 구조적 골격만 렌더한다(세부 결정은 9.4 실행 래퍼의 LLM 요약이 채운다).
  const decisionLines =
    entryPoints.length > 0
      ? entryPoints.map((p) => `- \`${p}\``)
      : ["- 없음"];
  const decisions = [
    "## 설계 결정",
    "",
    "검토 대상 진입점:",
    ...decisionLines,
    "",
    "_각 진입점과 모듈 경계에 대한 설계 결정과 근거를 여기에 기록합니다._",
  ].join("\n");

  return { overview, modules, decisions };
}

// ============================================
// 실행 래퍼 (Task 9.4) — Vault/LLM 접근이 필요한 I/O 계층
// ============================================
// 위 순수 함수(scanModuleTree/buildArchitectureSections)와 달리, runArchitect 는
// Vault 파일 열거·LLM 요약·노트 쓰기를 수행하는 얇은 실행 래퍼다. 핵심 보장:
//  - 스캔 → 섹션별 LLM 요약 → 각 섹션을 upsertGeneratedBlock(key)으로 갱신하여
//    재실행 시 사용자 메모(User_Region)를 보존한다 (Req 10.3, 10.4).
//  - 볼트 밖 경로는 읽기 전용·경로 검증으로 거부한다 (Req 10.5).
//  - LLM 호출은 IAiClient.converseLight(단발 요약)만 사용한다(백엔드 무관).
//  - 플러그인 이름/ID 하드코딩 금지(브랜딩 무관).

import { TFile, normalizePath } from "obsidian";
import type { SecondBrainContext } from "./scheduler";
import { SECOND_BRAIN_SYSTEM_PROMPT } from "./search-adapter";
import { buildAiFirstNote, type AiFirstMeta } from "./ai-first-format";
import { upsertGeneratedBlock } from "./sentinel-blocks";
import { processIfChanged } from "./vault-write";
import { ensureWikiFolders } from "./wiki-structure";
import { toolI18n } from "../tool-result-i18n";

/** 아키텍처 노트 파일명(Wiki_Folder 루트에 작성). */
const ARCHITECTURE_NOTE_NAME = "Architecture.md";

/**
 * modules 섹션 골격에 포함할 최대 라인 수.
 * 파일 하나가 한 줄이므로 상한이 없으면 볼트 크기에 비례해 프롬프트가 커진다.
 * 400줄이면 구조 파악에 충분하고 토큰도 안전한 범위다.
 */
const MAX_MODULE_LINES = 400;

/**
 * 섹션별 LLM 요약 호출의 최대 토큰 수.
 * 각 섹션은 단발 요약이므로 종합(synthesize)보다 작게 둔다(설계 §LLM 호출 규약).
 */
const ARCHITECT_MAX_TOKENS = 1500;

/** 섹션(Block_Key)별 LLM 작성 지침. ARCHITECTURE_SECTION_KEYS 와 키가 일치한다. */
const SECTION_GUIDANCE: Record<string, string> = {
  overview: "코드베이스의 목적과 전체 구조를 2~4문장으로 요약하십시오.",
  modules: "주요 모듈/디렉터리의 역할과 책임을 간결한 목록으로 설명하십시오.",
  decisions: "구조에서 드러나는 설계 결정과 그 근거를 추정하여 정리하고, 추정은 추정임을 밝히십시오.",
};

/**
 * 스캔 대상 경로를 검증·정규화한다 (Req 10.5).
 *
 * 플러그인은 Vault 파일 시스템에만 접근하므로 볼트 밖 경로(절대 경로·드라이브 경로·
 * `..` 상위 탈출)는 거부한다. 미지정/빈 값은 볼트 루트 전체 스캔을 의미한다.
 *
 * @returns 성공 시 정규화된 볼트 상대 경로(루트는 ""), 실패 시 거부 메시지.
 */
function resolveScanPath(
  scanPath?: string,
): { ok: true; path: string } | { ok: false; message: string } {
  if (scanPath === undefined || scanPath === null) {
    return { ok: true, path: "" };
  }
  const raw = String(scanPath).trim();
  if (raw === "") {
    return { ok: true, path: "" };
  }
  // 볼트 밖 접근 거부: 절대 경로(`/`로 시작), 윈도우 드라이브(`C:`), 상위 탈출(`..`).
  const segments = raw.split(/[\\/]+/);
  const escapesVault =
    raw.startsWith("/") || /^[A-Za-z]:/.test(raw) || segments.some((s) => s === "..");
  if (escapesVault) {
    return {
      ok: false,
      message: `볼트 밖 경로는 스캔할 수 없습니다(읽기 전용·권한 범위 밖): ${scanPath}`,
    };
  }
  return { ok: true, path: normalizePath(raw) };
}

/** 단일 섹션의 LLM 요약 프롬프트를 구성한다(순수, 내부 헬퍼). */
function buildArchitectSectionPrompt(
  sectionKey: string,
  skeleton: string,
  scanLabel: string,
): string {
  return [
    `# 아키텍처 노트 작성 — ${sectionKey} 섹션`,
    "",
    `다음은 코드베이스(${scanLabel}) 스캔으로 추출한 구조 정보입니다.`,
    "",
    skeleton,
    "",
    "## 작성 지침",
    `- ${SECTION_GUIDANCE[sectionKey] ?? "이 섹션 내용을 마크다운으로 작성하십시오."}`,
    "- 제공된 구조 정보만 근거로 작성하고, 근거 없는 단정은 피하십시오.",
    "- 마크다운 본문만 출력하십시오(프론트매터·코드펜스 불필요).",
  ].join("\n");
}

/**
 * 코드베이스 아키텍트 실행 래퍼 (Req 10.1, 10.3, 10.4, 10.5).
 *
 * 파이프라인:
 * 1. scanPath 를 검증·정규화한다(볼트 밖 경로 거부, Req 10.5).
 * 2. Vault 파일을 열거하여 scanPath 하위 경로만 모은다(읽기 전용).
 * 3. scanModuleTree → buildArchitectureSections 로 섹션 골격을 만든다(순수, Req 10.2).
 * 4. 각 섹션을 IAiClient.converseLight 로 요약한다(단발 호출, 백엔드 무관).
 * 5. 각 섹션을 Block_Key(overview/modules/decisions)별 Sentinel_Block 으로 기록한다.
 *    - 기존 노트: 현재 내용을 읽어 각 섹션 블록만 upsert → 사용자 메모(User_Region) 보존 (Req 10.4).
 *    - 신규 노트: buildAiFirstNote 본문에 섹션 블록을 담아 Wiki_Folder 에 생성한다 (Req 10.3).
 *
 * @param ctx Second Brain 실행 컨텍스트
 * @param scanPath 스캔 대상 볼트 상대 경로(미지정 시 볼트 전체)
 */
export async function runArchitect(ctx: SecondBrainContext, scanPath?: string): Promise<string> {
  // 1) 스캔 경로 검증 (Req 10.5)
  const resolved = resolveScanPath(scanPath);
  if (!resolved.ok) {
    return resolved.message;
  }
  const scanRoot = resolved.path;
  const scanLabel = scanRoot === "" ? "볼트 전체" : scanRoot;

  // 아키텍처 노트 경로(Wiki_Folder 루트). 스캔 시 자기 출력은 제외한다.
  const wikiFolder = normalizePath(ctx.wikiFolder);
  const notePath = normalizePath(`${wikiFolder}/${ARCHITECTURE_NOTE_NAME}`);

  // 2) Vault 파일 열거(읽기 전용) — scanPath 하위 경로만 수집한다.
  const paths = ctx.app.vault
    .getFiles()
    .map((file) => file.path)
    .filter((p) => p !== notePath)
    .filter((p) => scanRoot === "" || p === scanRoot || p.startsWith(`${scanRoot}/`));

  if (paths.length === 0) {
    return toolI18n(ctx.locale).architectNoFiles(scanLabel);
  }

  // 3) 모듈 트리 → 섹션 골격(순수, Req 10.2)
  const tree = scanModuleTree(paths);
  const sections = buildArchitectureSections(tree);

  // 4) 섹션별 LLM 요약(단발 호출, 백엔드 무관). 골격이 없는 섹션은 빈 문자열로 둔다.
  const summaries: Record<string, string> = {};
  for (const key of ARCHITECTURE_SECTION_KEYS) {
    const skeleton = sections[key] ?? "";
    const prompt = buildArchitectSectionPrompt(key, skeleton, scanLabel);
    const response = await ctx.aiClient.converseLight(
      prompt,
      SECOND_BRAIN_SYSTEM_PROMPT,
      ARCHITECT_MAX_TOKENS,
    );
    summaries[key] = response.text;
  }

  // 5) 섹션을 Block_Key별 Sentinel_Block 으로 기록 — User_Region 보존 (Req 10.3, 10.4)
  const existing = ctx.app.vault.getAbstractFileByPath(notePath);
  if (existing instanceof TFile) {
    // 기존 노트: 각 섹션 블록만 교체하여 프론트매터·프리앰블·사용자 메모를 보존한다.
    await processIfChanged(ctx.app, existing, (content) => {
      let updated = content;
      for (const key of ARCHITECTURE_SECTION_KEYS) {
        updated = upsertGeneratedBlock(updated, key, summaries[key]);
      }
      return updated;
    });
    return toolI18n(ctx.locale).architectUpdated(notePath);
  }

  // 신규 노트: AI_First_Note 본문에 섹션 블록을 담아 생성한다.
  let body = "";
  for (const key of ARCHITECTURE_SECTION_KEYS) {
    body = upsertGeneratedBlock(body, key, summaries[key]);
  }
  const meta: AiFirstMeta = {
    title: "Architecture",
    recency: "dated",
    confidence: "medium",
    source: "architect",
  };
  const noteContent = buildAiFirstNote({ meta, body });

  // Wiki_Folder 구조를 보장한 뒤 노트를 생성한다(부모 폴더 보장).
  await ensureWikiFolders(ctx.app, ctx.wikiFolder);
  await ctx.app.vault.create(notePath, noteContent);
  return toolI18n(ctx.locale).architectCreated(notePath);
}
