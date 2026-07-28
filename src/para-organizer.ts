// P.A.R.A 환경 설정 — 볼트를 P.A.R.A 구조로 정리하는 모듈

import { TFile, TFolder, Notice } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "./main";

/** P.A.R.A 폴더 정의 */
const PARA_FOLDERS = [
  "01. Projects",
  "02. Areas",
  "03. Resources",
  "04. Archives",
] as const;

/** LLM 분류 결과 타입 */
type ParaCategory = "projects" | "areas" | "resources" | "archives";

/** 허용 카테고리 목록 (응답 검증용) */
const PARA_CATEGORIES: readonly ParaCategory[] = [
  "projects",
  "areas",
  "resources",
  "archives",
] as const;

/**
 * 분류 응답 최대 토큰.
 * 카테고리 한 단어만 필요하지만, 추론 모델은 사고 토큰을 함께 소비하므로
 * 20토큰으로는 응답이 잘려 분류가 실패한다. 여유를 둔다.
 */
const CLASSIFY_MAX_TOKENS = 256;

/**
 * 한 번의 P.A.R.A 정리에서 허용하는 최대 LLM 분류 호출 수.
 * 노트당 1회 호출이므로 상한이 없으면 대형 볼트에서 비용이 폭증한다.
 * 초과분은 건너뛰고 사용자에게 알려 다시 실행하도록 안내한다.
 */
export const PARA_MAX_CLASSIFICATIONS = 200;

/** 분류 결과 */
export interface ParaResult {
  created: string[];
  moved: { from: string; to: string }[];
  skipped: string[];
  errors: string[];
}

/**
 * P.A.R.A 폴더 4개를 볼트 루트에 생성
 */
async function ensureParaFolders(app: App): Promise<string[]> {
  const created: string[] = [];
  for (const folder of PARA_FOLDERS) {
    const existing = app.vault.getAbstractFileByPath(folder);
    if (!existing) {
      await app.vault.createFolder(folder);
      created.push(folder);
    }
  }
  return created;
}

/**
 * P.A.R.A 폴더 내부 또는 시스템 폴더에 속한 파일인지 확인
 */
function shouldSkip(path: string, pluginConfigDir: string): boolean {
  // P.A.R.A 폴더 내부 파일은 이미 분류됨
  for (const folder of PARA_FOLDERS) {
    if (path.startsWith(folder + "/")) return true;
  }
  // Obsidian 설정 폴더, 플러그인 폴더 등 시스템 경로 제외
  if (path.startsWith(pluginConfigDir + "/")) return true;
  if (path.startsWith(".obsidian/")) return true;
  // 루트의 폴더 자체는 건너뜀 (파일만 이동)
  return false;
}

/**
 * LLM을 사용하여 노트를 P.A.R.A 카테고리로 분류
 */
async function classifyNote(
  plugin: GeminiAssistantPlugin,
  title: string,
  excerpt: string
): Promise<ParaCategory | null> {
  const systemPrompt = `You are a note classifier. Classify the given note into exactly one P.A.R.A category.

P.A.R.A categories:
- projects: Active tasks or initiatives with a clear goal and deadline. Work-in-progress items.
- areas: Ongoing responsibilities or standards to maintain over time (health, finances, career, etc.)
- resources: Topics of interest, reference materials, useful information for future use.
- archives: Completed projects, inactive items, or anything no longer actively relevant.

Respond with ONLY one word: projects, areas, resources, or archives. No explanation.`;

  const prompt = `Title: ${title}\nContent preview: ${excerpt.slice(0, 500)}`;

  try {
    const result = await plugin.aiClient.converseLight(prompt, systemPrompt, CLASSIFY_MAX_TOKENS);
    // 응답에 설명이 섞여도 카테고리 단어를 찾아낸다(추론 모델은 서두를 붙이는 경우가 있다).
    const text = result.text.trim().toLowerCase();
    const matched = PARA_CATEGORIES.find((c) => text.includes(c));
    // 분류에 실패하면 임의 카테고리로 이동시키지 않고 null을 반환해 호출부가 건너뛰게 한다.
    return matched ?? null;
  } catch {
    return null;
  }
}

/** 카테고리 → 폴더 매핑 */
const CATEGORY_FOLDER: Record<ParaCategory, string> = {
  projects: "01. Projects",
  areas: "02. Areas",
  resources: "03. Resources",
  archives: "04. Archives",
};

/**
 * P.A.R.A 환경 설정 실행
 * 1) 폴더 생성
 * 2) 루트에 있는 노트를 LLM으로 분류하여 이동
 */
export async function organizeVaultPara(
  app: App,
  plugin: GeminiAssistantPlugin,
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<ParaResult> {
  const result: ParaResult = { created: [], moved: [], skipped: [], errors: [] };

  // 1) P.A.R.A 폴더 생성
  result.created = await ensureParaFolders(app);

  // 2) 루트 레벨 마크다운 파일 수집
  const configDir = app.vault.configDir; // ".obsidian"
  const rootFiles: TFile[] = [];
  const allFiles = app.vault.getMarkdownFiles();
  for (const file of allFiles) {
    // 루트 또는 P.A.R.A 외부 폴더에 있는 파일만 대상
    if (!shouldSkip(file.path, configDir)) {
      rootFiles.push(file);
    }
  }

  if (rootFiles.length === 0) {
    return result;
  }

  // 3) 각 파일을 LLM으로 분류 후 이동
  //    호출 수 상한을 적용한다. 노트당 1회 LLM 호출이므로 상한이 없으면
  //    대형 볼트에서 비용과 소요 시간이 통제 불가로 커진다.
  const targets = rootFiles.slice(0, PARA_MAX_CLASSIFICATIONS);
  const deferred = rootFiles.length - targets.length;

  for (let i = 0; i < targets.length; i++) {
    const file = targets[i];
    onProgress?.(i + 1, targets.length, file.name);

    try {
      // 파일 내용 일부 읽기 (분류용)
      const content = await app.vault.cachedRead(file);
      const excerpt = content.slice(0, 1000);
      const title = file.basename;

      // LLM 분류
      const category = await classifyNote(plugin, title, excerpt);
      // 분류 실패(응답 오류·형식 불일치)는 건너뛴다. 과거에는 무조건 resources로
      // 이동시켜 사용자 폴더 구조를 임의로 재배치했다.
      if (category === null) {
        result.skipped.push(file.path);
        continue;
      }
      const targetFolder = CATEGORY_FOLDER[category];
      const newPath = `${targetFolder}/${file.name}`;

      // 이미 같은 이름의 파일이 있으면 건너뜀
      if (app.vault.getAbstractFileByPath(newPath)) {
        result.skipped.push(file.path);
        continue;
      }

      await app.vault.rename(file, newPath);
      result.moved.push({ from: file.path, to: newPath });
    } catch (e: any) {
      result.errors.push(`${file.path}: ${e?.message || String(e)}`);
    }
  }

  // 상한으로 처리하지 못한 파일을 사용자에게 알린다(조용한 누락 방지).
  if (deferred > 0) {
    result.errors.push(
      `LLM 호출 상한(${PARA_MAX_CLASSIFICATIONS}건)에 도달해 ${deferred}개 파일을 처리하지 않았습니다. 다시 실행하면 이어서 정리됩니다.`
    );
  }

  // 4) 비어있는 원래 폴더 정리 (P.A.R.A 폴더 제외)
  await cleanEmptyFolders(app, configDir);

  return result;
}

/**
 * 빈 폴더 재귀 삭제 (P.A.R.A 폴더와 시스템 폴더 제외)
 */
async function cleanEmptyFolders(app: App, configDir: string): Promise<void> {
  const folders = app.vault.getAllLoadedFiles().filter(
    (f): f is TFolder => f instanceof TFolder && f.path !== "/"
  );
  // 깊은 폴더부터 처리
  folders.sort((a, b) => b.path.length - a.path.length);

  for (const folder of folders) {
    if (folder.path.startsWith(configDir)) continue;
    // P.A.R.A 루트 폴더는 유지
    if ((PARA_FOLDERS as readonly string[]).includes(folder.path)) continue;
    // P.A.R.A 하위 폴더도 유지
    let insidePara = false;
    for (const pf of PARA_FOLDERS) {
      if (folder.path.startsWith(pf + "/")) { insidePara = true; break; }
    }
    if (insidePara) continue;

    if (folder.children.length === 0) {
      try { await app.vault.delete(folder); } catch { /* 무시 */ }
    }
  }
}
