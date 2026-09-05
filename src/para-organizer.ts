// P.A.R.A 환경 설정 — 볼트를 P.A.R.A 구조로 정리하는 모듈

import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "./main";
import { getErrorMessage } from "./error-utils";

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

/**
 * 호출이 연속으로 예외를 던지는 것을 허용하는 횟수.
 * 자격증명 오류·네트워크 단절이면 남은 파일도 전부 실패하므로, 상한까지 호출을
 * 소진하지 말고 즉시 중단해 비용과 시간을 아낀다.
 *
 * 주의: "형식 불일치(분류 불가)"는 여기에 세지 않는다. 특정 노트가 항상 분류
 * 불가여도 그건 그 노트의 문제이므로, 중단하면 정렬상 뒤에 있는 정상 노트가
 * 매 실행마다 처리되지 않는다(굶주림).
 */
const MAX_CONSECUTIVE_ERRORS = 10;

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
function shouldSkip(path: string, configDir: string): boolean {
  // P.A.R.A 폴더 내부 파일은 이미 분류됨
  for (const folder of PARA_FOLDERS) {
    if (path.startsWith(folder + "/")) return true;
  }
  // 설정 폴더(기본 ".obsidian", 사용자가 바꿀 수 있음) 하위는 제외한다.
  if (path.startsWith(configDir + "/")) return true;
  // 루트의 폴더 자체는 건너뜀 (파일만 이동)
  return false;
}

/**
 * LLM 응답에서 P.A.R.A 카테고리를 추출한다 — 순수 함수.
 *
 * 프롬프트는 카테고리 한 단어만 요구하지만, 추론 모델은 서두나 설명을 붙이는 경우가
 * 있어 마지막 줄을 우선 확인한다. 단순 `includes` 매칭은 위험하다 —
 * "cannot choose projects, areas, resources, or archives" 같은 **실패 응답**도
 * 첫 카테고리로 오판해 노트를 임의 폴더로 옮기기 때문이다.
 * 따라서 카테고리 단어가 단독(또는 최소한의 구두점과 함께) 등장할 때만 인정한다.
 *
 * @returns 판별된 카테고리, 판별 불가 시 null(호출부가 건너뛴다)
 */
export function parseCategory(responseText: string): ParaCategory | null {
  const text = String(responseText ?? "").toLowerCase();
  // 마지막 비어있지 않은 줄을 최종 답으로 본다(사고 과정 뒤 결론을 쓰는 패턴 대응).
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 뒤에서부터 훑되, 실제 내용이 있는 첫 줄에서 판정을 끝낸다. 계속 거슬러 올라가면
  // "projects\nCorrection: I cannot classify this note." 처럼 마지막에 철회한 응답에서
  // 앞선 후보를 채택해 노트를 잘못 옮긴다. 구분선(`---`)처럼 글자가 없는 줄만 건너뛴다.
  for (let i = lines.length - 1; i >= 0; i--) {
    // 구두점·따옴표·마크다운 강조를 제거한 순수 토큰만 남긴다.
    const token = lines[i].replace(/[^a-z]/g, "");
    if (token === "") continue;
    return PARA_CATEGORIES.find((c) => c === token) ?? null;
  }

  // 어느 줄도 단독 카테고리가 아니면 분류 실패로 본다.
  return null;
}

/**
 * LLM을 사용하여 노트를 P.A.R.A 카테고리로 분류.
 *
 * @returns 카테고리, 응답을 카테고리로 판별할 수 없으면 null
 * @throws 백엔드 호출이 실패하면 그대로 전파한다(호출부가 중단 여부를 판단)
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

  // 호출 예외는 삼키지 않고 그대로 던진다. 호출부가 "백엔드 장애(예외)"와
  // "응답 형식 불일치(null)"를 구분해야 한다 — 전자는 남은 파일도 전부 실패하므로
  // 중단이 맞고, 후자는 그 노트만의 문제이므로 계속 진행해야 한다.
  const result = await plugin.aiClient.converseLight(prompt, systemPrompt, CLASSIFY_MAX_TOKENS);
  return parseCategory(result.text);
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
  //    LLM "호출 수"에 상한을 적용한다(파일 수가 아니다). 호출 없이 건너뛴 파일이
  //    상한을 소진하면, 재실행 때마다 같은 파일들이 앞자리를 점거해 나머지가
  //    영구히 처리되지 않는다(굶주림).
  let calls = 0;
  let consecutiveErrors = 0;
  let deferred = 0;
  let aborted = false;

  for (let i = 0; i < rootFiles.length; i++) {
    const file = rootFiles[i];

    if (calls >= PARA_MAX_CLASSIFICATIONS || aborted) {
      deferred++;
      continue;
    }

    // 네 폴더 모두에 같은 이름이 있으면 어떤 분류가 나와도 이동할 수 없다.
    // 이런 파일에 호출을 쓰면, 매 실행마다 예산만 소진해 뒤쪽 파일이 영구히
    // 처리되지 않는다(굶주림). 호출 전에 걸러낸다.
    if (isUnmovable(app, file.name)) {
      result.skipped.push(file.path);
      continue;
    }

    onProgress?.(i + 1, rootFiles.length, file.name);

    try {
      // 파일 내용 일부 읽기 (분류용)
      const content = await app.vault.cachedRead(file);
      const excerpt = content.slice(0, 1000);
      const title = file.basename;

      // LLM 분류
      calls++;
      const category = await classifyNote(plugin, title, excerpt);
      // 분류 실패(응답 오류·형식 불일치)는 이동하지 않는다. 과거에는 무조건 resources로
      // 이동시켜 사용자 폴더 구조를 임의로 재배치했다.
      // "이름 중복으로 건너뜀"과 구분해 오류로 보고한다(조용한 실패 방지).
      if (category === null) {
        result.errors.push(`${file.path}: 분류 실패(응답 형식 불일치)`);
        continue;
      }

      const targetFolder = CATEGORY_FOLDER[category];
      const newPath = `${targetFolder}/${file.name}`;

      // 이미 같은 이름의 파일이 있으면 건너뜀
      if (app.vault.getAbstractFileByPath(newPath)) {
        result.skipped.push(file.path);
        continue;
      }

      const oldPath = file.path;
      await app.fileManager.renameFile(file, newPath);
      result.moved.push({ from: oldPath, to: newPath });
    } catch (e: unknown) {
      // 예외는 백엔드 장애 신호로 본다(자격증명·네트워크·쓰로틀링).
      consecutiveErrors++;
      result.errors.push(`${file.path}: ${getErrorMessage(e)}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        aborted = true;
        result.errors.push(
          `호출이 ${MAX_CONSECUTIVE_ERRORS}회 연속 실패해 중단했습니다. AI 백엔드 설정을 확인하세요.`
        );
      }
      continue;
    }
    consecutiveErrors = 0;
  }

  // 상한으로 처리하지 못한 파일을 사용자에게 알린다(조용한 누락 방지).
  if (deferred > 0 && !aborted) {
    result.errors.push(
      `LLM 호출 상한(${PARA_MAX_CLASSIFICATIONS}건)에 도달해 ${deferred}개 파일을 처리하지 않았습니다. 다시 실행하면 이어서 정리됩니다.`
    );
  } else if (deferred > 0) {
    result.errors.push(`중단으로 ${deferred}개 파일을 처리하지 않았습니다.`);
  }

  // 4) 비어있는 원래 폴더 정리 (P.A.R.A 폴더 제외)
  await cleanEmptyFolders(app, configDir);

  return result;
}

/**
 * 파일 이름이 네 P.A.R.A 폴더 모두에서 이미 사용 중인지 확인한다.
 * 그렇다면 어떤 분류 결과가 나와도 이동 대상이 충돌하므로 LLM 호출이 낭비다.
 */
function isUnmovable(app: App, fileName: string): boolean {
  // truthy 검사를 쓴다. `!== null`로 비교하면 undefined를 반환하는 구현에서
  // 모든 파일이 "충돌"로 판정되어 아무것도 정리되지 않는다.
  return PARA_FOLDERS.every((folder) => Boolean(app.vault.getAbstractFileByPath(`${folder}/${fileName}`)));
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
      try { await app.fileManager.trashFile(folder); } catch { /* 무시 */ }
    }
  }
}
