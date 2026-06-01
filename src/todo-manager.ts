// To-Do 관련 유틸리티 함수 (chat-view.ts에서 분리)
// createTodoNote, getUnfinishedTasks, injectCarryOverTasks 등 To-Do 생성/관리 로직

import { TFile, Notice, normalizePath } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import type GeminiAssistantPlugin from "./main";
import type { ViewLang } from "./chat-view-i18n";
import {
  parseDateFolder,
  parseLegacyBasename,
  buildTodoDocBasename,
  buildDateStr,
  buildDateFolder,
  buildTodoDocPath,
  buildTimeboxDocPath,
  buildTimeboxLink,
  substituteDate,
  localizeTemplateLinks,
  ensureCrossLink,
} from "./planner-paths";

/**
 * 오늘 날짜로 To-Do 노트를 생성합니다. (설계 2.3 — 날짜 폴더 + To-Do 전용 생성)
 *
 * 흐름:
 * 1. Planner_Folder 루트와 `{Planner_Folder}/YYYY-MM-DD` 날짜 폴더를 준비한다(없으면 생성, 있으면 재사용).
 * 2. `YYYY-MM-DD To-Do.md`가 이미 존재하면 덮어쓰지 않고 열기만 한 뒤 반환한다.
 * 3. 템플릿을 읽어 `{{date}}` 치환 + 일반 위키 링크를 per-date 링크로 지역화한다.
 * 4. 직전(오늘 이전) To-Do 후보 1건을 골라 그 내용에서 미완료 항목을 이월하고,
 *    메모 섹션의 오늘 이후 날짜 항목을 승계한다(새 구조 + Legacy 동시 인식).
 * 5. 새 To-Do 문서를 생성·열고 완료 알림을 표시한 뒤 오래된 항목을 아카이브한다.
 *
 * 같은 동작에서 TimeBox 문서는 생성하지 않는다(Req 1.4).
 * 오류가 발생하면 작업을 중단하고 기존 파일을 변경하지 않으며 실패 원인을 알림으로 표시한다(Req 1.9).
 */
export async function createTodoNote(
  app: App,
  plugin: GeminiAssistantPlugin,
  t: ViewLang
): Promise<void> {
  try {
    const plannerFolder = normalizePath(plugin.settings.plannerFolder || "Daily Planner");
    // Legacy 평면 구조 폴더(이월/메모 승계 후보 + 아카이브 대상)
    const legacyFolder = normalizePath(plugin.settings.todoFolder || "ToDo");

    // 오늘 날짜 (시간 성분 제거 → 날짜 단위 비교)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 1. 날짜 폴더 준비 (Req 1.1~1.3): 없으면 생성, 있으면 재사용
    const dateFolder = buildDateFolder(plannerFolder, today);
    // 날짜 폴더의 상위(Planner_Folder 루트)가 없으면 먼저 생성
    if (!app.vault.getAbstractFileByPath(plannerFolder)) {
      await app.vault.createFolder(plannerFolder);
    }
    if (!app.vault.getAbstractFileByPath(dateFolder)) {
      await app.vault.createFolder(dateFolder);
    }

    // 2. To-Do 문서가 이미 존재하면 덮어쓰지 않고 열기만 (Req 1.8)
    const todoPath = buildTodoDocPath(plannerFolder, today);
    const existing = app.vault.getAbstractFileByPath(todoPath);
    if (existing && existing instanceof TFile) {
      await app.workspace.getLeaf(false).openFile(existing);
      new Notice(t.todoExists(todoPath));
      return;
    }

    // 3. 템플릿 읽기 → {{date}}/{{prevDate}} 치환 → 링크 지역화 (Req 1.5, 2.5)
    const templateFolder = normalizePath(plugin.settings.templateFolder || "Templates");
    const todoTemplateName = plugin.settings.todoTemplateName || "Daily To-Do";
    const timeboxTemplateName = plugin.settings.timeboxTemplateName || "TimeBox Daily";
    const templatePath = `${templateFolder}/${todoTemplateName}.md`;
    let template = `# 📋 {{date}}\n\n## To-Do\n\n- [ ] \n\n## Notes\n\n`;
    const templateFile = app.vault.getAbstractFileByPath(templatePath);
    if (templateFile && templateFile instanceof TFile) {
      template = await app.vault.cachedRead(templateFile);
    }

    // 이전 날짜 문자열({{prevDate}} 치환용)
    const prevDate = new Date(today);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = buildDateStr(prevDate);

    let content = substituteDate(template, today).replace(/\{\{prevDate\}\}/g, prevDateStr);
    content = localizeTemplateLinks(content, today, todoTemplateName, timeboxTemplateName);

    // 4. 직전(오늘 이전) To-Do 후보 1건을 선택하여 이월/메모 승계 (Req 5, 6)
    const candidates = await collectTodoCandidates(app, plannerFolder, legacyFolder);
    const prev = selectMostRecentBefore(candidates, today);
    if (prev) {
      const prevContent = await app.vault.cachedRead(prev.file);

      // 미완료 이월: 직전 문서에 ### 서브섹션이 2개 이상이면 섹션별로, 아니면 플랫으로 이월
      const tasksBySection = extractUnfinishedTasksBySection(prevContent);
      if (tasksBySection.size >= 2) {
        // 섹션별 미완료 항목을 원래 서브섹션 구조에 맞게 이월 (AI 분류 불필요)
        for (const [section, sectionTasks] of tasksBySection) {
          if (sectionTasks.length > 0) {
            content = injectTasksIntoSubSection(content, section, sectionTasks);
          }
        }
      } else {
        // 서브섹션이 부족하면 기존 플랫 방식으로 이월
        const carryOver = extractUnfinishedTasks(prevContent);
        if (carryOver.length > 0) {
          content = injectCarryOverTasks(content, carryOver);
        }
      }

      // 메모 섹션의 오늘 이후(오늘 포함) 날짜 항목을 메모에 승계
      const datedNotes = extractDatedNotesFromContent(prevContent, today);
      if (datedNotes.length > 0) {
        const noteLines = datedNotes.map((n) => n.raw);
        content = injectNotesIntoMemoSection(content, noteLines);
      }
    }

    // 5. 새 To-Do 문서 생성 → 열기 → 완료 알림 (Req 1.4, 1.7)
    const file = await app.vault.create(todoPath, content);
    await app.workspace.getLeaf(false).openFile(file);
    new Notice(t.todoCreated(todoPath));

    // 오래된 플래너 항목 아카이브 (날짜 폴더 + Legacy 평면 파일 모두 대상) (Req 7)
    await archiveOldTodos(app, plugin, t, legacyFolder, now);
  } catch (error) {
    // 오류 시 작업 중단 + 실패 원인 알림 (기존 파일은 변경하지 않음) (Req 1.9)
    new Notice(t.todoError((error as Error).message));
  }
}

/**
 * 콘텐츠 문자열에서 최상위 미완료 항목과 그 하위 들여쓰기 항목을 평면(flat)으로 추출합니다. (순수 함수)
 *
 * 추출 규칙:
 * - 최상위 미완료 항목은 `- [ ] ` 마커로 시작하고 마커 뒤에 비어 있지 않은 텍스트가 있어야 한다.
 * - 완료 항목(`- [x]`/`- [X]`)과 텍스트 없는 빈 체크박스(템플릿 플레이스홀더)는 제외한다.
 * - 각 최상위 항목 직후, 들여쓰기(탭 또는 공백)된 비어 있지 않은 하위 줄을
 *   첫 번째 비들여쓰기 줄 또는 빈 줄을 만나기 전까지 함께 수집한다.
 *
 * 부수효과가 없으며 동일 입력에 항상 동일 결과를 반환한다(속성 테스트 대상).
 */
export function extractUnfinishedTasks(content: string): string[] {
  // 미완료 체크박스 항목 추출 (계층 구조 유지)
  const lines = content.split("\n");
  const unfinished: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 최상위 미완료 항목 (들여쓰기 없음)
    if (/^- \[ \]\s+.+/.test(line)) {
      unfinished.push(line);
      // 하위 들여쓰기 항목도 함께 수집
      let j = i + 1;
      while (j < lines.length && /^[\t ]+/.test(lines[j]) && lines[j].trim().length > 0) {
        unfinished.push(lines[j]);
        j++;
      }
      i = j - 1;
    }
  }
  return unfinished;
}

/**
 * 전일자(또는 가장 최근) To-Do 파일에서 미완료 항목을 추출합니다.
 * 후보 수집(부수효과)만 담당하고, 실제 추출은 순수 함수 `extractUnfinishedTasks`에 위임합니다.
 */
export async function getUnfinishedTasks(app: App, todoFolder: string, today: Date): Promise<string[]> {
  const folder = app.vault.getAbstractFileByPath(todoFolder);
  if (!folder) return [];

  const children = (folder as any).children || [];
  // YYYY-MM-DD.md 형식 파일만 필터링하고 날짜순 정렬 (내림차순)
  const dated: { file: TFile; date: Date }[] = [];
  for (const child of children) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    const match = child.basename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) continue;
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    // 오늘 이전 파일만
    if (d < today) {
      dated.push({ file: child, date: d });
    }
  }

  if (dated.length === 0) return [];

  // 가장 최근 파일
  dated.sort((a, b) => b.date.getTime() - a.date.getTime());
  const latest = dated[0].file;

  const content = await app.vault.cachedRead(latest);
  // 순수 추출 헬퍼에 위임
  return extractUnfinishedTasks(content);
}

/**
 * 콘텐츠 문자열에서 `### ` 서브섹션별 미완료 항목을 구조를 보존하여 추출합니다. (순수 함수)
 *
 * 추출 규칙:
 * - `## 오늘의 할 일`/`## 할 일`/`## To-Do`/`## Tasks` 섹션 내부만 대상으로 한다.
 * - 그 안의 `### ` 서브섹션 헤딩을 키로, 해당 서브섹션에 속한 미완료 항목 목록을 값으로 매핑한다.
 * - 각 항목은 원본에서 자신이 속해 있던 서브섹션 키에만 매핑된다(서브섹션 간 이동 없음).
 * - 미완료 항목 판별 및 하위 들여쓰기 항목 수집 규칙은 `extractUnfinishedTasks`와 동일하다.
 * - 다음 `## ` 섹션을 만나면 추출을 종료한다.
 *
 * 부수효과가 없으며 동일 입력에 항상 동일 결과를 반환한다(속성 테스트 대상).
 */
export function extractUnfinishedTasksBySection(content: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const lines = content.split("\n");

  let inTodoSection = false;
  let currentSubSection: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ## 오늘의 할 일 / To-Do 섹션 시작 감지
    if (/^##\s+.*(?:오늘의 할 일|할 일|to.?do|tasks)/i.test(line)) {
      inTodoSection = true;
      continue;
    }
    // 다음 ## 섹션이 나오면 종료 (### 제외)
    if (inTodoSection && /^##\s+/.test(line) && !/^###/.test(line)) {
      break;
    }

    if (!inTodoSection) continue;

    // ### 서브섹션 감지 (이모지 포함 가능)
    const subMatch = line.match(/^###\s+(.+)/);
    if (subMatch) {
      currentSubSection = subMatch[1].trim();
      if (!result.has(currentSubSection)) {
        result.set(currentSubSection, []);
      }
      continue;
    }

    // 미완료 체크박스 항목 수집 (현재 서브섹션에 귀속)
    if (currentSubSection && /^- \[ \]\s+.+/.test(line)) {
      const tasks = result.get(currentSubSection) || [];
      tasks.push(line);
      // 하위 들여쓰기 항목도 함께 수집
      let j = i + 1;
      while (j < lines.length && /^[\t ]+/.test(lines[j]) && lines[j].trim().length > 0) {
        tasks.push(lines[j]);
        j++;
      }
      result.set(currentSubSection, tasks);
      i = j - 1;
    }
  }

  return result;
}

/**
 * 전일자 To-Do에서 미완료 항목을 섹션별로 추출합니다.
 * ### 서브섹션 구조를 보존하여 원래 섹션에 그대로 이월할 수 있도록 합니다.
 * AI 분류 없이 원본 섹션 매핑을 유지하므로 분류 오류가 발생하지 않습니다.
 *
 * 후보 수집(부수효과)만 담당하고, 실제 추출은 순수 함수 `extractUnfinishedTasksBySection`에 위임합니다.
 */
export async function getUnfinishedTasksBySection(
  app: App,
  todoFolder: string,
  today: Date
): Promise<Map<string, string[]>> {
  const folder = app.vault.getAbstractFileByPath(todoFolder);
  if (!folder) return new Map<string, string[]>();

  const children = (folder as any).children || [];
  const dated: { file: TFile; date: Date }[] = [];
  for (const child of children) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    const match = child.basename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) continue;
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (d < today) dated.push({ file: child, date: d });
  }
  if (dated.length === 0) return new Map<string, string[]>();

  dated.sort((a, b) => b.date.getTime() - a.date.getTime());
  const latest = dated[0].file;
  const content = await app.vault.cachedRead(latest);

  // 순수 추출 헬퍼에 위임
  return extractUnfinishedTasksBySection(content);
}

/**
 * 후보 목록에서 `today` 이전(< today) 중 날짜가 가장 큰(가장 최근) 항목 1건을 선택합니다. (순수 함수)
 *
 * 선택 규칙:
 * - `date.getTime() < today.getTime()`(엄격한 미만)을 만족하는 후보만 대상으로 한다.
 * - 그중 날짜가 가장 큰 항목을 반환한다.
 * - 동일한 최대 날짜가 여러 개면 가장 먼저 등장한 항목을 반환한다.
 * - 조건을 만족하는 후보가 없으면 `null`을 반환한다.
 *
 * 부수효과가 없으며 입력 배열을 변경하지 않는다(속성 테스트 대상).
 */
export function selectMostRecentBefore<T extends { date: Date }>(
  candidates: T[],
  today: Date
): T | null {
  const todayTime = today.getTime();
  let best: T | null = null;
  for (const candidate of candidates) {
    const t = candidate.date.getTime();
    // today 이전(엄격한 미만)만 후보로 인정
    if (t < todayTime) {
      // 더 최근(더 큰 날짜)일 때만 갱신 → 동률이면 먼저 등장한 항목 유지
      if (best === null || t > best.date.getTime()) {
        best = candidate;
      }
    }
  }
  return best;
}

/**
 * 후보 목록에서 `cutoff` 미만(< cutoff) 날짜 항목을 아카이브 대상으로 선별합니다. (순수 함수)
 *
 * 선별 규칙:
 * - `date.getTime() < cutoff.getTime()`(엄격한 미만)인 항목만 반환한다.
 * - `date >= cutoff`인 항목은 결과에 포함하지 않는다.
 * - 입력 순서를 보존한다.
 *
 * 부수효과가 없으며 입력 배열을 변경하지 않는다(속성 테스트 대상).
 */
export function selectEntriesToArchive<T extends { date: Date }>(
  candidates: T[],
  cutoff: Date
): T[] {
  const cutoffTime = cutoff.getTime();
  return candidates.filter((candidate) => candidate.date.getTime() < cutoffTime);
}

/**
 * 이월/아카이브 후보 한 건.
 * - file: 읽을 To-Do 문서 (dated는 날짜 폴더 안의 "<date> To-Do.md", legacy는 루트의 "<date>.md")
 * - date: 문서 날짜
 * - layout: 새 날짜 폴더 구조("dated") 또는 기존 평면 구조("legacy")
 */
export interface TodoCandidate {
  file: TFile;
  date: Date;
  layout: "dated" | "legacy";
}

/**
 * Planner_Folder 루트를 1회 스캔하여 이월/메모 승계 후보를 모읍니다. (부수효과 계층)
 *
 * 수집 규칙:
 * - "dated": Planner_Folder 직속 하위 폴더명이 `YYYY-MM-DD`이고, 그 안에
 *   `<date> To-Do.md` 파일이 실제로 존재하는 경우 그 To-Do 파일을 후보로 추가한다.
 * - "legacy": Planner_Folder 루트 직속 `.md` 파일의 basename이 `YYYY-MM-DD`인 경우.
 * - 추가로 `legacyFolder`(settings.todoFolder)가 Planner_Folder와 다르면, 그 폴더의
 *   루트 직속 `YYYY-MM-DD.md` legacy 파일도 후보로 포함한다.
 *
 * Req 5·6·8의 "새 구조 + Legacy 동시 인식"을 단일 경로로 처리한다.
 * 폴더가 없으면 해당 스캔을 건너뛰며(Planner_Folder가 없어도 legacyFolder가 다르면 검사),
 * 동일 파일 경로의 중복은 제거한다.
 */
export async function collectTodoCandidates(
  app: App,
  plannerFolder: string,
  legacyFolder: string
): Promise<TodoCandidate[]> {
  const candidates: TodoCandidate[] = [];
  // 동일 파일 경로 중복 추가 방지
  const seen = new Set<string>();

  /** 후보 추가 헬퍼: 이미 추가된 파일 경로면 건너뜀 */
  const addCandidate = (file: TFile, date: Date, layout: "dated" | "legacy") => {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    candidates.push({ file, date, layout });
  };

  /** 특정 폴더의 루트 직속 `YYYY-MM-DD.md` legacy 파일을 후보로 수집 */
  const collectLegacyInFolder = (folderPath: string) => {
    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (!folder) return;
    const children = (folder as any).children || [];
    for (const child of children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      const date = parseLegacyBasename(child.basename);
      if (!date) continue;
      addCandidate(child, date, "legacy");
    }
  };

  // 1) Planner_Folder 루트 1회 스캔 (dated 폴더 + legacy 평면 파일)
  const normalizedPlanner = normalizePath(plannerFolder);
  const plannerRoot = app.vault.getAbstractFileByPath(normalizedPlanner);
  if (plannerRoot) {
    const children = (plannerRoot as any).children || [];
    for (const child of children) {
      if (child instanceof TFile) {
        // legacy: 루트 직속 YYYY-MM-DD.md
        if (child.extension !== "md") continue;
        const date = parseLegacyBasename(child.basename);
        if (!date) continue;
        addCandidate(child, date, "legacy");
      } else {
        // dated: 직속 하위 폴더명이 YYYY-MM-DD 이고 그 안에 "<date> To-Do.md"가 존재
        const date = parseDateFolder(child.name);
        if (!date) continue;
        const todoPath = normalizePath(`${child.path}/${buildTodoDocBasename(date)}.md`);
        const todoFile = app.vault.getAbstractFileByPath(todoPath);
        if (todoFile instanceof TFile) {
          addCandidate(todoFile, date, "dated");
        }
      }
    }
  }

  // 2) legacyFolder(구 폴더)가 Planner_Folder와 다르면 그 폴더의 legacy 파일도 포함
  const normalizedLegacy = normalizePath(legacyFolder);
  if (normalizedLegacy !== normalizedPlanner) {
    collectLegacyInFolder(normalizedLegacy);
  }

  return candidates;
}

/**
 * 미완료 항목을 템플릿 콘텐츠에 주입합니다.
 */
export function injectCarryOverTasks(content: string, tasks: string[]): string {
  const taskBlock = tasks.join("\n");

  // "이전 미완료" 관련 섹션 헤더를 찾아서 그 아래에 삽입
  const sectionPattern = /^(##\s+.*(?:이전 미완료|미완료 업무|carry.?over|unfinished).*)/im;
  const match = content.match(sectionPattern);

  if (match && match.index !== undefined) {
    // 섹션 헤더 다음 줄에 삽입
    const insertPos = match.index + match[0].length;
    const after = content.substring(insertPos);
    const nextContentMatch = after.match(/\n(- \[[ x]\]|\n##)/);
    if (nextContentMatch && nextContentMatch.index !== undefined) {
      const pos = insertPos + nextContentMatch.index;
      return content.substring(0, pos) + "\n" + taskBlock + content.substring(pos);
    }
    // 섹션 끝에 추가
    return content.substring(0, insertPos) + "\n" + taskBlock + "\n" + content.substring(insertPos);
  }

  // 섹션을 못 찾으면 문서 끝에 추가
  return content + "\n\n## 🔄 Carry Over\n\n" + taskBlock + "\n";
}

/**
 * 템플릿의 "오늘의 할 일" / "To-Do" 섹션 내 ### 서브섹션 이름을 추출합니다.
 */
export function extractTodoSubSections(content: string): string[] {
  const lines = content.split("\n");
  const subSections: string[] = [];
  let inTodoSection = false;

  for (const line of lines) {
    // ## 오늘의 할 일 / To-Do 섹션 시작 감지
    if (/^##\s+.*(?:오늘의 할 일|할 일|to.?do|tasks)/i.test(line)) {
      inTodoSection = true;
      continue;
    }
    // 다음 ## 섹션이 나오면 종료 (### 제외)
    if (inTodoSection && /^##\s+/.test(line) && !/^###/.test(line)) {
      break;
    }
    // ### 서브섹션 수집
    if (inTodoSection) {
      const m = line.match(/^###\s+(.+)/);
      if (m) subSections.push(m[1].trim());
    }
  }
  return subSections;
}

/**
 * AI를 사용해 미완료 태스크를 지정된 서브섹션별로 분류합니다.
 */
export async function classifyTasksForSections(
  plugin: GeminiAssistantPlugin,
  sections: string[],
  tasks: string[]
): Promise<Map<string, string[]>> {
  const lang = plugin.settings.language === "ko" ? "ko" : "en";
  const prompt = lang === "ko"
    ? `다음은 미완료 To-Do 항목들과 분류할 카테고리입니다.
각 항목을 가장 적절한 카테고리에 분류해주세요.

카테고리:
${sections.map((s, i) => `${i + 1}. ${s}`).join("\n")}

미완료 항목:
${tasks.map((t, i) => `${i + 1}. ${t.replace(/^\s*-\s*\[ \]\s*/, "").replace(/^\t/, "")}`).join("\n")}

JSON 형식으로만 응답하세요. 키는 카테고리 이름(위 목록과 정확히 동일), 값은 항목 번호 배열입니다.
예시: {"${sections[0]}": [1, 3], "${sections[1] || sections[0]}": [2]}
모든 항목을 반드시 분류하세요.`
    : `Classify these unfinished To-Do items into the given categories.

Categories:
${sections.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Items:
${tasks.map((t, i) => `${i + 1}. ${t.replace(/^\s*-\s*\[ \]\s*/, "").replace(/^\t/, "")}`).join("\n")}

Respond ONLY in JSON. Keys must exactly match category names above, values are arrays of item numbers.
Example: {"${sections[0]}": [1, 3], "${sections[1] || sections[0]}": [2]}
Classify ALL items.`;

  try {
    const result = await plugin.aiClient.converseLight(
      prompt,
      "You are a task classifier. Respond only in JSON."
    );

    let jsonStr = result.text.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    const classification = JSON.parse(jsonStr) as Record<string, number[]>;
    const classified = new Map<string, string[]>();

    for (const [section, indices] of Object.entries(classification)) {
      const sectionTasks: string[] = [];
      for (const idx of indices) {
        if (idx >= 1 && idx <= tasks.length) {
          sectionTasks.push(tasks[idx - 1]);
        }
      }
      if (sectionTasks.length > 0) {
        classified.set(section, sectionTasks);
      }
    }

    // 분류되지 않은 항목은 첫 번째 섹션에 추가
    const classifiedIndices = new Set(Object.values(classification).flat());
    const unclassified: string[] = [];
    for (let i = 0; i < tasks.length; i++) {
      if (!classifiedIndices.has(i + 1)) {
        unclassified.push(tasks[i]);
      }
    }
    if (unclassified.length > 0) {
      const firstSection = sections[0];
      const existing = classified.get(firstSection) || [];
      classified.set(firstSection, [...existing, ...unclassified]);
    }

    return classified;
  } catch (e) {
    console.error("AI 태스크 분류 실패, 첫 번째 섹션에 전부 넣기:", e);
    const result = new Map<string, string[]>();
    result.set(sections[0], tasks);
    return result;
  }
}

/**
 * 템플릿의 특정 ### 서브섹션 내 빈 체크박스(- [ ] ) 자리에 태스크를 주입합니다.
 */
export function injectTasksIntoSubSection(
  content: string,
  sectionName: string,
  tasks: string[]
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let found = false;
  let injected = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ### 서브섹션 헤더 매칭
    if (!injected && line.match(new RegExp("^###\\s+" + sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))) {
      found = true;
      result.push(line);
      continue;
    }
    // 해당 섹션 내 빈 체크박스를 찾으면 태스크로 교체
    if (found && !injected && /^\s*- \[ \]\s*$/.test(line)) {
      for (const task of tasks) {
        result.push(task);
      }
      injected = true;
      continue;
    }
    // 다음 ### 또는 ## 섹션이 나오면 해당 섹션 종료
    if (found && !injected && /^#{2,3}\s+/.test(line)) {
      for (const task of tasks) {
        result.push(task);
      }
      injected = true;
    }
    result.push(line);
  }

  // 끝까지 못 찾았으면 마지막에 추가
  if (found && !injected) {
    for (const task of tasks) {
      result.push(task);
    }
  }

  return result.join("\n");
}

/**
 * 콘텐츠 문자열의 메모 섹션에서 오늘 이후(오늘 포함) 날짜 항목을 추출합니다. (순수 함수)
 *
 * 추출 규칙:
 * - 헤딩에 "메모"/"노트"/"notes"/"memo"를 포함하는 `##` 섹션 내부만 대상으로 한다.
 * - 다음 `## ` 섹션을 만나면 추출을 종료한다.
 * - 각 줄을 `parseDateFromNoteLine`으로 해석하여 날짜가 오늘 이상이면 승계 대상에 포함한다.
 *
 * 부수효과가 없으며 동일 입력에 항상 동일 결과를 반환한다.
 */
export function extractDatedNotesFromContent(
  content: string,
  today: Date
): Array<{ date: string; text: string; time: string | null; raw: string }> {
  const results: Array<{ date: string; text: string; time: string | null; raw: string }> = [];
  const todayStr = buildDateStr(today);

  const lines = content.split("\n");
  let inMemo = false;

  for (const line of lines) {
    if (/^##\s+.*(?:메모|노트|notes|memo)/i.test(line)) {
      inMemo = true;
      continue;
    }
    if (inMemo && /^##\s+/.test(line) && !/^###/.test(line)) break;

    if (inMemo) {
      const parsed = parseDateFromNoteLine(line, today);
      if (parsed) {
        // 오늘 이후(오늘 포함)만 승계
        if (parsed.dateStr >= todayStr) {
          results.push({ date: parsed.dateStr, text: parsed.text, time: parsed.time, raw: line });
        }
      }
    }
  }
  return results;
}

/**
 * 이전 투두의 메모 섹션에서 날짜가 포함된 항목을 추출합니다.
 * 날짜가 오늘 이후(오늘 포함)인 항목만 반환합니다.
 *
 * 후보 수집(부수효과)만 담당하고, 실제 추출은 순수 함수 `extractDatedNotesFromContent`에 위임합니다.
 */
export async function getDatedNotesFromPrevTodo(
  app: App,
  todoFolder: string,
  today: Date
): Promise<Array<{ date: string; text: string; time: string | null; raw: string }>> {
  const folder = app.vault.getAbstractFileByPath(todoFolder);
  if (!folder) return [];

  const children = (folder as any).children || [];
  const dated: { file: TFile; date: Date }[] = [];
  for (const child of children) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    const match = child.basename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) continue;
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (d < today) dated.push({ file: child, date: d });
  }
  if (dated.length === 0) return [];

  dated.sort((a, b) => b.date.getTime() - a.date.getTime());
  const latest = dated[0].file;
  const content = await app.vault.cachedRead(latest);

  // 순수 추출 헬퍼에 위임
  return extractDatedNotesFromContent(content, today);
}

/**
 * 메모 줄에서 다양한 날짜 형식을 파싱합니다.
 * 지원 형식: 2026-03-01, 03/01, 3/1, 3월 1일, 3/3(화)
 */
export function parseDateFromNoteLine(
  line: string,
  refDate: Date
): { dateStr: string; text: string; time: string | null } | null {
  // 리스트 항목이 아니면 스킵
  if (!/^-\s+/.test(line)) return null;
  const content = line.replace(/^-\s+/, "");

  const year = refDate.getFullYear();

  // 줄 전체에서 날짜 패턴을 탐색 (이모지, 볼드, 기호 등 무시)
  // 마크다운 서식 제거: **, *, 📌 등
  const cleaned = content.replace(/\*\*/g, "").replace(/\*/g, "").trim();

  let month = 0;
  let day = 0;
  let dateYear = year;
  let timeStr: string | null = null;
  let textPart = "";

  // 1) YYYY-MM-DD
  const m1 = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  // 2) M/D 또는 MM/DD (요일 옵션)
  const m2 = !m1 ? cleaned.match(/(\d{1,2})\/(\d{1,2})(?:\([^\)]*\))?/) : null;
  // 3) N월 N일
  const m3 = (!m1 && !m2) ? cleaned.match(/(\d{1,2})월\s*(\d{1,2})일/) : null;

  if (m1) {
    dateYear = Number(m1[1]);
    month = Number(m1[2]);
    day = Number(m1[3]);
  } else if (m2) {
    month = Number(m2[1]);
    day = Number(m2[2]);
  } else if (m3) {
    month = Number(m3[1]);
    day = Number(m3[2]);
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const dateStr = `${dateYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // 시간 추출: HH:MM 패턴 (날짜 매치 이후 부분에서만)
  const datePattern = m1 || m2 || m3;
  let afterDateRaw = "";
  if (datePattern && datePattern.index !== undefined) {
    afterDateRaw = cleaned.substring(datePattern.index + datePattern[0].length).trim();
    // 요일 괄호 제거: (화), (월) 등
    afterDateRaw = afterDateRaw.replace(/^\([^\)]*\)\s*/, "").trim();
  }

  const timeMatchInAfter = afterDateRaw.match(/^(\d{1,2}:\d{2})/);
  if (timeMatchInAfter) {
    timeStr = timeMatchInAfter[1].replace(/^(\d):/, "0$1:");
  } else {
    const timeMatch2 = afterDateRaw.match(/^(\d{1,2})시/);
    if (timeMatch2) {
      timeStr = `${timeMatch2[1].padStart(2, "0")}:00`;
    }
  }

  // 텍스트 추출: 날짜/시간/부가설명 이후의 의미 있는 텍스트
  if (datePattern && datePattern.index !== undefined) {
    let afterDate = afterDateRaw;
    // 시간 패턴 제거 (HH:MM)
    afterDate = afterDate.replace(/^\d{1,2}:\d{2}/, "").trim();
    // N시 패턴 제거
    afterDate = afterDate.replace(/^\d{1,2}시/, "").trim();
    // "예정" 같은 부가 설명 제거
    afterDate = afterDate.replace(/^예정\s*/, "").trim();
    // 구분자 콜론/대시 제거
    afterDate = afterDate.replace(/^[:\-–—]\s*/, "").trim();
    textPart = afterDate;
  }

  if (!textPart) return null;

  return { dateStr, text: textPart, time: timeStr };
}

/**
 * 메모 섹션에 항목을 주입합니다.
 */
export function injectNotesIntoMemoSection(content: string, notes: string[]): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inMemo = false;
  let injected = false;

  for (const line of lines) {
    if (/^##\s+.*(?:메모|노트|notes|memo)/i.test(line)) {
      inMemo = true;
      result.push(line);
      continue;
    }
    // 메모 섹션 내 빈 항목(- ) 또는 첫 번째 빈 줄에 주입
    if (inMemo && !injected && /^-\s*$/.test(line)) {
      for (const note of notes) {
        result.push(note);
      }
      injected = true;
      continue;
    }
    // 다음 ## 섹션이면 메모 종료, 아직 주입 안 했으면 여기서
    if (inMemo && !injected && /^##\s+/.test(line) && !/^###/.test(line)) {
      for (const note of notes) {
        result.push(note);
      }
      result.push("");
      injected = true;
    }
    result.push(line);
  }

  if (!injected) {
    for (const note of notes) {
      result.push(note);
    }
  }

  return result.join("\n");
}

/**
 * 아카이브 대상 후보 한 건.
 * - date: 항목의 날짜 (cutoff 비교 기준)
 * - entry: 실제로 이동할 Vault 객체 (날짜 폴더는 TFolder, Legacy는 TFile)
 */
interface ArchiveCandidate {
  date: Date;
  entry: TAbstractFile;
}

/**
 * 기준 일수를 초과한 오래된 플래너 항목을 아카이브 폴더로 이동합니다. (설계 2.3 step 7 — Req 7)
 *
 * 두 가지 레이아웃을 모두 대상으로 한다.
 * - "dated": Planner_Folder 직속 하위 폴더명이 `YYYY-MM-DD`인 날짜 폴더 → 폴더 단위로 이동.
 * - "legacy": `YYYY-MM-DD.md` 형식의 평면 파일(legacyFolder 및 Planner_Folder 루트 직속).
 *
 * 흐름:
 * 1. cutoff = now - archiveDays(시/분/초 0으로 정규화)를 기준으로 후보를 모은다.
 * 2. `selectEntriesToArchive(candidates, cutoff)`로 cutoff 미만(< cutoff) 항목만 선별한다.
 *    (오늘/활성 날짜 폴더는 date >= cutoff 이므로 자연히 제외된다.)
 * 3. 아카이브 폴더가 없으면 생성한다(Req 7.3).
 * 4. dest(`{archiveFolder}/{name}`)에 같은 이름이 이미 있으면 해당 항목 이동을 건너뛴다(Req 7.4).
 * 5. 실제로 이동된 항목 수만 집계하여 알림으로 표시한다(Req 7.5).
 *
 * 시그니처는 기존 호출부(`archiveOldTodos(app, plugin, t, legacyFolder, now)`)와 호환을 유지하며,
 * Planner_Folder는 `plugin.settings.plannerFolder` 설정에서 가져온다.
 *
 * @param legacyFolder - 기존 평면 구조 폴더(settings.todoFolder 기반). Legacy 파일 수집 대상.
 */
export async function archiveOldTodos(
  app: App,
  plugin: GeminiAssistantPlugin,
  t: ViewLang,
  legacyFolder: string,
  now: Date
): Promise<void> {
  const archiveFolder = normalizePath(plugin.settings.todoArchiveFolder || "ToDo/Archive");
  const plannerFolder = normalizePath(plugin.settings.plannerFolder || "Daily Planner");
  const archiveDays = plugin.settings.todoArchiveDays || 7;

  // cutoff = now - archiveDays (날짜 단위 비교를 위해 시/분/초 0으로 정규화)
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - archiveDays);
  cutoff.setHours(0, 0, 0, 0);

  // 1. 두 레이아웃의 아카이브 후보 수집
  const candidates: ArchiveCandidate[] = [];
  // 동일 Vault 경로 중복 추가 방지
  const seen = new Set<string>();

  /** 후보 추가 헬퍼: 이미 추가된 경로면 건너뜀 */
  const addCandidate = (entry: TAbstractFile, date: Date) => {
    if (seen.has(entry.path)) return;
    seen.add(entry.path);
    candidates.push({ date, entry });
  };

  /** 특정 폴더의 루트 직속 `YYYY-MM-DD.md` legacy 파일을 후보로 수집 */
  const collectLegacyFilesInFolder = (folderPath: string) => {
    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (!folder) return;
    const children = ((folder as any).children || []) as TAbstractFile[];
    for (const child of children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      const date = parseLegacyBasename(child.basename);
      if (!date) continue;
      addCandidate(child, date);
    }
  };

  // 1-a. Planner_Folder 루트 1회 스캔: dated 날짜 폴더 + 루트 직속 legacy 파일
  const plannerRoot = app.vault.getAbstractFileByPath(plannerFolder);
  if (plannerRoot) {
    const children = ((plannerRoot as any).children || []) as TAbstractFile[];
    for (const child of children) {
      if (child instanceof TFile) {
        // legacy: 루트 직속 YYYY-MM-DD.md
        if (child.extension !== "md") continue;
        const date = parseLegacyBasename(child.basename);
        if (!date) continue;
        addCandidate(child, date);
      } else {
        // dated: 직속 하위 폴더명이 YYYY-MM-DD → 폴더 자체를 이동 대상으로 삼는다
        const date = parseDateFolder(child.name);
        if (!date) continue;
        addCandidate(child, date);
      }
    }
  }

  // 1-b. legacyFolder(구 폴더)가 Planner_Folder와 다르면 그 폴더의 legacy 파일도 포함
  const normalizedLegacy = normalizePath(legacyFolder);
  if (normalizedLegacy !== plannerFolder) {
    collectLegacyFilesInFolder(normalizedLegacy);
  }

  // 2. cutoff 미만 항목만 아카이브 대상으로 선별 (순수 함수)
  const toArchive = selectEntriesToArchive(candidates, cutoff);
  if (toArchive.length === 0) return;

  // 3. 아카이브 폴더가 없으면 생성 (Req 7.3)
  if (!app.vault.getAbstractFileByPath(archiveFolder)) {
    await app.vault.createFolder(archiveFolder);
  }

  // 4~5. 실제 이동 + 이름 충돌 시 건너뜀, 이동된 개수만 집계 (Req 7.2, 7.4, 7.5)
  let movedCount = 0;
  for (const { entry } of toArchive) {
    const dest = normalizePath(`${archiveFolder}/${entry.name}`);
    // 이동 대상에 이미 같은 이름의 항목이 있으면 건너뜀 (Req 7.4)
    if (app.vault.getAbstractFileByPath(dest)) continue;
    await app.vault.rename(entry, dest);
    movedCount++;
  }

  // 실제로 이동된 항목 수만 알림 (Req 7.5)
  if (movedCount > 0) {
    new Notice(t.todoArchived(movedCount));
  }
}

// ============================================
// TimeBox AI 드래프팅 헬퍼 (순수 함수)
// ============================================
// TimeBox 문서를 AI 보조로 생성하기 위한 순수 헬퍼 모음.
// - buildTimeboxPrompt: To-Do 내용 → JSON 전용 응답을 요구하는 프롬프트 구성
// - parseTimeboxDraft: AI 응답(JSON, 코드펜스 허용) → TimeboxDraft | null
// - mergeTimeboxDraft: 템플릿 본문에 draft를 병합(섹션/시간 라인 구조 보존)
// 모두 부수효과가 없으며 동일 입력에 항상 동일 결과를 반환한다(속성 테스트 대상).

/**
 * AI_Timebox_Drafting의 중간 표현.
 * - topPriorities: 핵심 우선순위(최대 3개 권장)
 * - goals: 오늘의 목표(체크박스 항목)
 * - schedule: 시간별 할 일 ("HH:00" → 작업)
 */
export interface TimeboxDraft {
  topPriorities: string[];
  goals: string[];
  schedule: { time: string; task: string }[];
}

/** TimeBox 드래프팅용 시스템 프롬프트 (JSON 전용 구조화 출력 지시) */
export const TIMEBOX_SYSTEM_PROMPT =
  "You are a daily timeboxing assistant. " +
  "You read the user's To-Do items and draft a time-blocked daily plan. " +
  "Respond ONLY with a single valid JSON object and nothing else. " +
  "Do not include explanations, comments, or prose outside the JSON.";

/**
 * mergeTimeboxDraft가 대상으로 삼는 Schedule "시간 라인" 정규식.
 *
 * 매칭 형식: `(선택)체크박스 + **HH:MM** + em/en-dash 또는 하이픈` 으로 시작하는 한 줄.
 *   예) "- [ ] **05:00** — "  ·  "- [ ] **22:00** —"  ·  "**09:00** -"
 * - group 1: 구분선(—/–/-)까지의 라인 앞부분 (체크박스·볼드 시간 포함)
 * - group 2: "HH:MM" 시간 문자열
 *
 * 이 정규식에 매칭되는 라인만 뒤 텍스트가 채워지며, group 1을 그대로 보존하므로
 * 채운 뒤에도 동일 정규식에 다시 매칭된다 → 시간 라인의 "개수"가 불변으로 유지된다.
 * (속성 테스트 Property 12와 정렬되는 정규식)
 */
export const TIMEBOX_TIME_LINE_RE =
  /^(\s*(?:-\s*\[[ xX]\]\s*)?\*\*(\d{1,2}:\d{2})\*\*\s*[—–-])\s*.*$/;

/**
 * 콘텐츠에서 핵심 항목(체크박스 항목, 번호 목록 항목)의 텍스트를 추출한다. (내부용 순수)
 * 마커/마크다운 볼드 기호를 제거하고, 비어 있지 않은 의미 있는 텍스트만 반환한다.
 */
function extractTodoHighlights(content: string): string[] {
  const lines = content.split("\n");
  const items: string[] = [];
  for (const line of lines) {
    // 체크박스 항목: - [ ] / - [x] / - [X]
    const checkbox = line.match(/^\s*-\s*\[[ xX]\]\s*(.+)$/);
    // 번호 목록 항목: 1. 텍스트
    const numbered = !checkbox ? line.match(/^\s*\d+\.\s+(.+)$/) : null;
    const raw = checkbox ? checkbox[1] : numbered ? numbered[1] : null;
    if (raw === null) continue;
    // 볼드/이탤릭 기호 제거 후 정리
    const text = raw.replace(/\*\*/g, "").replace(/\*/g, "").trim();
    if (text.length === 0) continue;
    items.push(text);
  }
  return items;
}

/** 언어별 작성 지시 문구 (buildTimeboxPrompt 내부용) */
const TIMEBOX_LANG_INSTRUCTION: Record<string, string> = {
  ko: "모든 값은 한국어로 작성하세요.",
  ja: "すべての値は日本語で記入してください。",
  en: "Write all values in English.",
};

/**
 * To-Do 콘텐츠에서 핵심 우선순위/할 일을 추출하여, AI에 JSON 전용 응답을 요구하는
 * TimeBox 드래프팅 프롬프트를 구성한다. (순수 함수)
 *
 * classifyTasksForSections와 동일하게, AI가 코드펜스(```json ... ```) 또는 순수 JSON으로
 * 응답한다고 가정하고 parseTimeboxDraft에서 코드펜스를 제거한 뒤 JSON.parse 한다.
 *
 * @param todoContent - 같은 날짜 To-Do 문서 내용
 * @param date - "YYYY-MM-DD" 날짜 문자열
 * @param lang - 언어 코드 ("ko" | "ja" | "en")
 */
export function buildTimeboxPrompt(todoContent: string, date: string, lang: string): string {
  const langInstruction = TIMEBOX_LANG_INSTRUCTION[lang] || TIMEBOX_LANG_INSTRUCTION.en;

  const highlights = extractTodoHighlights(todoContent);
  const itemsText =
    highlights.length > 0
      ? highlights.map((it, i) => `${i + 1}. ${it}`).join("\n")
      : "(no explicit to-do items found)";

  return `Draft a time-blocked daily plan ("TimeBox") for ${date} based on the user's To-Do.

## To-Do items
${itemsText}

## Output rules
- Respond ONLY with a JSON object. No prose, no markdown fences are required.
- The JSON MUST have exactly this shape:
{"topPriorities": string[], "goals": string[], "schedule": [{"time": "HH:00", "task": string}]}
- topPriorities: the 1~3 most important items for the day.
- goals: actionable goals derived from the To-Do items (checkbox-style goals).
- schedule: assign tasks to hourly slots. "time" MUST be 24-hour "HH:00" format (e.g. "09:00", "14:00"). "task" is a short description.
- Only include realistic waking-hour slots; you may leave gaps. Do not invent unrelated tasks.
- ${langInstruction}

Example:
{"topPriorities": ["Finish report"], "goals": ["Review PR"], "schedule": [{"time": "09:00", "task": "Write report"}]}`;
}

/** 임의 값을 문자열 배열로 강제 변환한다. 배열이 아니면 null. (내부용) */
function coerceStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * 임의 값을 schedule 배열({time, task})로 강제 변환한다. 배열이 아니면 null.
 * 각 원소는 time/task가 모두 문자열인 것만 채택하고, 그 외는 버린다(coerce). (내부용)
 */
function coerceSchedule(value: unknown): { time: string; task: string }[] | null {
  if (!Array.isArray(value)) return null;
  const result: { time: string; task: string }[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.time === "string" && typeof obj.task === "string") {
      result.push({ time: obj.time, task: obj.task });
    }
  }
  return result;
}

/**
 * AI 응답(JSON, 코드펜스 허용)을 TimeboxDraft로 파싱한다. (순수 함수)
 *
 * 처리:
 * 1) 코드펜스(```json ... ```)가 있으면 내부 JSON만 추출(classifyTasksForSections와 동일 관례)
 * 2) JSON.parse 시도, 실패하면 null
 * 3) 최소 형태 검증: topPriorities/goals는 배열, schedule은 {time, task} 배열.
 *    하나라도 배열이 아니면 null. 배열 내부 비정상 원소는 버린다(coerce).
 *
 * @returns 파싱·검증된 TimeboxDraft, 실패 시 null
 */
export function parseTimeboxDraft(aiText: string): TimeboxDraft | null {
  if (typeof aiText !== "string") return null;

  let jsonStr = aiText.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const topPriorities = coerceStringArray(obj.topPriorities);
  const goals = coerceStringArray(obj.goals);
  const schedule = coerceSchedule(obj.schedule);

  // 세 필드 중 하나라도 배열 형태가 아니면 malformed → null
  if (topPriorities === null || goals === null || schedule === null) return null;

  return { topPriorities, goals, schedule };
}

/**
 * "HH:MM" 형태 시간 문자열을 비교용 정규 키로 변환한다. (내부용)
 * 시(hour)를 2자리로 zero-pad 하여 "9:00" 과 "09:00" 을 동일하게 취급한다.
 * 형식을 인식하지 못하면 trim한 원본을 반환한다.
 */
function normalizeTimeKey(time: string): string {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return time.trim();
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * TimeBox 템플릿 본문에 draft를 병합한다. (순수 함수, 멱등 아님)
 *
 * 규칙:
 * - 먼저 모든 `{{date}}` 토큰을 date 문자열로 치환한다(치환 완전성 보장).
 * - 섹션 헤딩을 추적하여 영역별로 채운다:
 *   · Top Priorities: 빈 번호 목록 항목("N.")을 draft.topPriorities로 순서대로 채움.
 *   · Goals of the Day: 빈 체크박스("- [ ]")를 draft.goals로 순서대로 채움.
 *   · Schedule: TIMEBOX_TIME_LINE_RE에 매칭되는 시간 라인만 대상으로, draft.schedule의
 *     동일 시간(정규화 비교)을 찾아 구분선 뒤 텍스트를 채운다. 템플릿에 없는 시간은 무시.
 * - 시간 라인의 "집합/개수"는 변하지 않는다(추가·삭제 없음). 네 섹션 헤딩도 보존한다.
 *
 * @param template - TimeBox 템플릿 본문(이미 링크 지역화 등이 적용된 baseBody)
 * @param draft - 병합할 TimeboxDraft
 * @param date - "YYYY-MM-DD" 날짜 문자열
 */
export function mergeTimeboxDraft(template: string, draft: TimeboxDraft, date: string): string {
  // 1) {{date}} 전체 치환 (Property 11/12: 결과에 {{date}} 토큰이 남지 않도록)
  const substituted = template.replace(/\{\{date\}\}/g, date);

  // 2) 시간 → 작업 매핑 (정규화 키 사용, 먼저 나온 항목 우선)
  const scheduleMap = new Map<string, string>();
  for (const slot of draft.schedule) {
    const key = normalizeTimeKey(slot.time);
    if (!scheduleMap.has(key)) {
      // 줄바꿈을 공백으로 치환하여 시간 라인이 여러 줄로 쪼개지지 않도록 한다(개수 불변 보장)
      const task = slot.task.replace(/\r?\n/g, " ").trim();
      scheduleMap.set(key, task);
    }
  }

  type SectionType = "priorities" | "goals" | "schedule" | "notes" | "other";

  /** 헤딩 텍스트로부터 섹션 종류를 판별한다. */
  const detectSection = (headingText: string): SectionType => {
    const lower = headingText.toLowerCase();
    if (lower.includes("priorit") || headingText.includes("우선순위")) return "priorities";
    if (lower.includes("goal") || headingText.includes("목표")) return "goals";
    if (lower.includes("schedule") || headingText.includes("일정") || headingText.includes("스케줄")) {
      return "schedule";
    }
    if (lower.includes("note") || headingText.includes("메모") || headingText.includes("노트")) {
      return "notes";
    }
    return "other";
  };

  const lines = substituted.split("\n");
  const out: string[] = [];

  let section: SectionType = "other";
  let priorityIdx = 0; // 소비한 topPriorities 개수
  let goalIdx = 0; // 소비한 goals 개수

  for (const line of lines) {
    // 섹션 헤딩 감지 (## ~ 등 모든 헤딩 레벨)
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      section = detectSection(heading[1]);
      out.push(line);
      continue;
    }

    if (section === "priorities") {
      // 빈 번호 목록 항목 "N." 을 우선순위로 채움
      const numbered = line.match(/^(\s*)(\d+)\.\s*$/);
      if (numbered && priorityIdx < draft.topPriorities.length) {
        const indent = numbered[1];
        const num = numbered[2];
        const text = draft.topPriorities[priorityIdx].replace(/\r?\n/g, " ").trim();
        priorityIdx++;
        out.push(`${indent}${num}. ${text}`);
        continue;
      }
    } else if (section === "goals") {
      // 빈 체크박스 "- [ ]" 를 목표로 채움
      const emptyCheckbox = line.match(/^(\s*)-\s*\[ \]\s*$/);
      if (emptyCheckbox && goalIdx < draft.goals.length) {
        const indent = emptyCheckbox[1];
        const text = draft.goals[goalIdx].replace(/\r?\n/g, " ").trim();
        goalIdx++;
        out.push(`${indent}- [ ] ${text}`);
        continue;
      }
    } else if (section === "schedule") {
      // 시간 라인이면 동일 시간의 작업으로 뒤 텍스트를 채움 (없으면 원본 유지)
      const timeLine = line.match(TIMEBOX_TIME_LINE_RE);
      if (timeLine) {
        const prefix = timeLine[1]; // 구분선까지의 앞부분 (보존 → 개수 불변)
        const key = normalizeTimeKey(timeLine[2]);
        const task = scheduleMap.get(key);
        if (task !== undefined && task.length > 0) {
          out.push(`${prefix} ${task}`);
          continue;
        }
      }
    }

    out.push(line);
  }

  return out.join("\n");
}

// ============================================
// TimeBox 문서 생성 오케스트레이션 (설계 2.4 — Create_Timebox_Action)
// ============================================

/**
 * 템플릿 파일과 AI 생성 결과를 모두 사용할 수 없을 때 사용하는 내장 기본 TimeBox 본문. (순수)
 *
 * 설계 Error Handling(Req 3.9)에 따라 시간 배치 Schedule을 포함하고, 네 섹션
 * (Top Priorities / Goals of the Day / Schedule / Notes)을 모두 갖춘다.
 * `{{date}}` 토큰과 일반 To-Do 위키 링크 토큰(`[[<todoTemplateName>]]`)을 포함하므로,
 * 호출부에서 substituteDate + localizeTemplateLinks를 적용하면 per-date 링크/날짜로 치환된다.
 * Schedule의 시간 라인은 `mergeTimeboxDraft`가 채울 수 있도록 `- [ ] **HH:00** — ` 형식을 따른다.
 *
 * @param todoTemplateName - To-Do 템플릿명(일반 위키 링크 토큰 생성용, 예: "Daily To-Do")
 */
function buildDefaultTimeboxBody(todoTemplateName: string): string {
  // 05:00 ~ 22:00 시간대 Schedule 라인 생성 (TIMEBOX_TIME_LINE_RE와 동일 형식)
  const scheduleLines: string[] = [];
  for (let hour = 5; hour <= 22; hour++) {
    const hh = String(hour).padStart(2, "0");
    scheduleLines.push(`- [ ] **${hh}:00** — `);
  }

  return [
    "---",
    "date: {{date}}",
    "tags: [daily, timebox]",
    "---",
    "",
    "# 🗓️ TimeBox Daily — {{date}}",
    "",
    "## 📌 Top Priorities",
    "",
    `> [!tip] 할 일 목록은 👉 [[${todoTemplateName}]] 에서 가져오기`,
    "",
    "1. ",
    "2. ",
    "3. ",
    "",
    "## 🎯 Goals of the Day",
    "",
    "- [ ] ",
    "- [ ] ",
    "- [ ] ",
    "",
    "## 🕐 Schedule",
    "",
    ...scheduleLines,
    "",
    "## 📝 Notes",
    "",
    "> [!note]",
    "> ",
    "",
  ].join("\n");
}

/**
 * 오늘 날짜로 TimeBox 노트를 AI 보조로 생성합니다. (설계 2.4 — Create_Timebox_Action)
 *
 * 흐름:
 * 1. 오늘 날짜의 To-Do/TimeBox 경로를 계산한다.
 * 2. Todo_Prerequisite: 같은 날짜 To-Do 문서가 없으면 TimeBox를 만들지 않고 안내 알림 후 반환한다(Req 3.2, 3.3).
 * 3. TimeBox 문서가 이미 존재하면 덮어쓰지 않고 열기만 한 뒤 반환한다(Req 3.4, 멱등).
 * 4. TimeBox 템플릿을 읽어 `{{date}}` 치환 + 링크 지역화로 baseBody를 만든다.
 *    템플릿이 없으면 시간 Schedule을 포함한 내장 기본 본문을 사용한다(Req 3.9).
 * 5. AI_Timebox_Drafting: To-Do 내용으로 프롬프트를 만들어 converseLight를 호출하고,
 *    응답을 parseTimeboxDraft → mergeTimeboxDraft로 baseBody에 병합한다.
 *    오류/중지/파싱 실패 시 baseBody를 그대로 쓰고 폴백 알림을 표시한다(Req 3.6, 3.7, 3.8).
 * 6. TimeBox 문서를 생성·열고 완료 알림을 표시한다(Req 3.5, 3.10).
 * 7. 생성에 성공한 뒤, To-Do 문서에 TimeBox로 향하는 Cross_Link가 없으면 추가한다(Req 2.2).
 *
 * Req 3.11 대응 — 순서 결정:
 *   설계 2.4의 절차상 순서는 ensureCrossLink(6) → create(7)이지만,
 *   Req 3.11은 "TimeBox 생성 중 파일시스템 오류가 발생하면 To-Do 문서를 변경하지 않는다"를 요구한다.
 *   따라서 본 구현은 **TimeBox 파일을 먼저 생성(create)한 뒤, 성공한 경우에만 To-Do에
 *   Cross_Link를 추가(modify)**하도록 순서를 뒤집었다. create가 예외를 던지면 To-Do는
 *   전혀 수정되지 않으므로 Req 3.11을 만족한다. (Req 2.2의 상호 링크 보장은 생성 성공 후 수행)
 *
 * 파일시스템 오류 발생 시 작업을 중단하고 실패 원인을 알림으로 표시한다(Req 3.11).
 */
export async function createTimeboxNote(
  app: App,
  plugin: GeminiAssistantPlugin,
  t: ViewLang
): Promise<void> {
  try {
    const plannerFolder = normalizePath(plugin.settings.plannerFolder || "Daily Planner");

    // 오늘 날짜 (시간 성분 제거 → 날짜 단위 비교)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateStr = buildDateStr(today);

    // 1. 경로 계산
    const todoPath = buildTodoDocPath(plannerFolder, today);
    const timeboxPath = buildTimeboxDocPath(plannerFolder, today);

    // 2. Todo_Prerequisite: 같은 날짜 To-Do가 없으면 TimeBox 미생성 (Req 3.2, 3.3)
    const todoAbstract = app.vault.getAbstractFileByPath(todoPath);
    if (!(todoAbstract instanceof TFile)) {
      new Notice(t.timeboxNoTodo);
      return;
    }
    const todoFile = todoAbstract;

    // 3. TimeBox가 이미 존재하면 덮어쓰지 않고 열기만 (Req 3.4 멱등)
    const existingTimebox = app.vault.getAbstractFileByPath(timeboxPath);
    if (existingTimebox instanceof TFile) {
      await app.workspace.getLeaf(false).openFile(existingTimebox);
      new Notice(t.timeboxExists(timeboxPath));
      return;
    }

    // 4. TimeBox 템플릿 읽기 → {{date}} 치환 → 링크 지역화 → baseBody (Req 3.7, 3.9)
    const templateFolder = normalizePath(plugin.settings.templateFolder || "Templates");
    const todoTemplateName = plugin.settings.todoTemplateName || "Daily To-Do";
    const timeboxTemplateName = plugin.settings.timeboxTemplateName || "TimeBox Daily";
    const templatePath = `${templateFolder}/${timeboxTemplateName}.md`;

    // 템플릿이 없으면 내장 기본 본문 사용 (시간 Schedule 포함, Req 3.9)
    let rawTemplate = buildDefaultTimeboxBody(todoTemplateName);
    const templateFile = app.vault.getAbstractFileByPath(templatePath);
    if (templateFile instanceof TFile) {
      rawTemplate = await app.vault.cachedRead(templateFile);
    }

    // {{date}} 치환 + 일반 위키 링크를 per-date 링크로 지역화
    // (템플릿의 [[TimeBox Daily]] → [[YYYY-MM-DD TimeBox]], [[Daily To-Do]] → [[YYYY-MM-DD To-Do]])
    let baseBody = substituteDate(rawTemplate, today);
    baseBody = localizeTemplateLinks(baseBody, today, todoTemplateName, timeboxTemplateName);

    // To-Do 내용 읽기 (AI 프롬프트 입력 + 이후 Cross_Link 보장에 재사용)
    const todoContent = await app.vault.cachedRead(todoFile);

    // 5. AI_Timebox_Drafting: 성공 시 병합, 실패/중지/파싱오류 시 baseBody 폴백 (Req 3.6, 3.8)
    let finalBody = baseBody;
    try {
      const prompt = buildTimeboxPrompt(todoContent, dateStr, plugin.settings.language);
      const result = await plugin.aiClient.converseLight(
        prompt,
        TIMEBOX_SYSTEM_PROMPT,
        plugin.settings.maxTokens
      );
      const draft = parseTimeboxDraft(result.text);
      if (draft) {
        finalBody = mergeTimeboxDraft(baseBody, draft, dateStr);
      } else {
        // 파싱 실패 → 템플릿 기반 비-AI 초안으로 폴백 (Req 3.8)
        new Notice(t.timeboxFallback);
      }
    } catch (aiError) {
      // AI 오류/중지 → 템플릿 기반 비-AI 초안으로 폴백 (Req 3.8)
      console.error("TimeBox AI 드래프팅 실패, 템플릿 폴백:", aiError);
      new Notice(t.timeboxFallback);
    }

    // 6. TimeBox 문서 생성 → 열기 → 완료 알림 (Req 3.5, 3.10)
    //    Req 3.11: create가 실패하면 아래 ensureCrossLink(modify)에 도달하지 않으므로 To-Do는 미변경.
    const timeboxFile = await app.vault.create(timeboxPath, finalBody);
    await app.workspace.getLeaf(false).openFile(timeboxFile);
    new Notice(t.timeboxCreated(timeboxPath));

    // 7. 생성 성공 후 To-Do에 TimeBox Cross_Link 보장 (없으면 추가) (Req 2.2)
    const linkedTodo = ensureCrossLink(todoContent, buildTimeboxLink(today));
    if (linkedTodo !== todoContent) {
      await app.vault.modify(todoFile, linkedTodo);
    }
  } catch (error) {
    // 파일시스템 오류 시 작업 중단 + 실패 원인 알림 (To-Do 미변경) (Req 3.11)
    new Notice(t.timeboxError((error as Error).message));
  }
}
