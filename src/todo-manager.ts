// To-Do 관련 유틸리티 함수 (chat-view.ts에서 분리)
// createTodoNote, getUnfinishedTasks, injectCarryOverTasks 등 To-Do 생성/관리 로직

import { TFile, Notice, normalizePath } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import type GeminiAssistantPlugin from "./main";
import type { ViewLang } from "./chat-view-i18n";
import {
  parseLegacyBasename,
  buildDateStr,
  buildTodoDocPath,
  substituteDate,
  localizeTemplateLinks,
} from "./planner-paths";

/**
 * 오늘 날짜로 To-Do 노트를 생성합니다. (평면 폴더 구조 — To-Do 전용 생성)
 *
 * 흐름:
 * 1. To-Do 루트 폴더(`{todoFolder}`)를 준비한다(없으면 생성).
 * 2. `{todoFolder}/YYYY-MM-DD To-Do.md`가 이미 존재하면 덮어쓰지 않고 열기만 한 뒤 반환한다.
 * 3. 템플릿을 읽어 `{{date}}` 치환 + 일반 위키 링크를 per-date 링크로 지역화한다.
 * 4. 직전(오늘 이전) To-Do 후보 1건을 골라 그 내용에서 미완료 항목을 이월하고,
 *    메모 섹션의 오늘 이후 날짜 항목을 승계한다(평면 + Legacy 동시 인식).
 * 5. 새 To-Do 문서를 생성·열고 완료 알림을 표시한 뒤 오래된 항목을 아카이브한다.
 *
 * 오류가 발생하면 작업을 중단하고 기존 파일을 변경하지 않으며 실패 원인을 알림으로 표시한다.
 */
export async function createTodoNote(
  app: App,
  plugin: GeminiAssistantPlugin,
  t: ViewLang
): Promise<void> {
  try {
    // To-Do 루트 폴더 (평면 구조: 날짜 하위폴더 없음)
    const todoFolder = normalizePath(plugin.settings.todoFolder || "ToDo");

    // 오늘 날짜 (시간 성분 제거 → 날짜 단위 비교)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 1. To-Do 폴더 준비: 없으면 생성, 있으면 재사용
    if (!app.vault.getAbstractFileByPath(todoFolder)) {
      await app.vault.createFolder(todoFolder);
    }

    // 2. To-Do 문서가 이미 존재하면 덮어쓰지 않고 열기만
    const todoPath = buildTodoDocPath(todoFolder, today);
    const existing = app.vault.getAbstractFileByPath(todoPath);
    if (existing && existing instanceof TFile) {
      await app.workspace.getLeaf(false).openFile(existing);
      new Notice(t.todoExists(todoPath));
      return;
    }

    // 3. 템플릿 읽기 → {{date}}/{{prevDate}} 치환 → 링크 지역화
    const templateFolder = normalizePath(plugin.settings.templateFolder || "Templates");
    const todoTemplateName = plugin.settings.todoTemplateName || "Daily To-Do";
    const templatePath = `${templateFolder}/${todoTemplateName}.md`;
    // 템플릿 파일이 없을 때 사용할 내장 기본 본문 (확정 To-Do 템플릿)
    // - frontmatter(date/tags/aliases) + 단일 할 일 목록 + 시간 표기 일정 + 메모/회고
    // - 미완료 이월(extractUnfinishedTasks)·메모 날짜 승계와 연동된다.
    let template =
      '---\ndate: "{{date}}"\ntags:\n  - 일일업무\n  - To-Do\naliases:\n  - "{{date}} 할일"\n---\n\n' +
      "# 📋 {{date}} To-Do\n\n" +
      "## 🎯 오늘의 핵심 (Top 3)\n\n" +
      "> 가장 중요한 일 3가지만. 나머지는 아래에서 관리.\n\n" +
      "- [ ] \n- [ ] \n- [ ] \n\n" +
      "## ✅ 할 일\n\n- [ ] \n\n" +
      "## 🕘 일정\n\n- **09:00** ~ \n- **13:00** ~ \n- **18:00** ~ \n\n" +
      "## 📝 메모\n\n- \n\n" +
      "## 📊 오늘의 회고\n\n" +
      "> [!tip] 하루 마무리\n" +
      "> - **완료한 일**: \n" +
      "> - **내일로 넘길 일**: \n" +
      "> - **특이사항**: \n";
    const templateFile = app.vault.getAbstractFileByPath(templatePath);
    if (templateFile && templateFile instanceof TFile) {
      template = await app.vault.cachedRead(templateFile);
    }

    // 이전 날짜 문자열({{prevDate}} 치환용)
    const prevDate = new Date(today);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = buildDateStr(prevDate);

    let content = substituteDate(template, today).replace(/\{\{prevDate\}\}/g, prevDateStr);
    content = localizeTemplateLinks(content, today, todoTemplateName);

    // 4. 직전(오늘 이전) To-Do 후보 1건을 선택하여 이월/메모 승계
    const candidates = await collectTodoCandidates(app, todoFolder);
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

    // 5. 새 To-Do 문서 생성 → 열기 → 완료 알림
    const file = await app.vault.create(todoPath, content);
    await app.workspace.getLeaf(false).openFile(file);
    new Notice(t.todoCreated(todoPath));

    // 오래된 To-Do 항목 아카이브 (평면 파일 대상)
    await archiveOldTodos(app, plugin, t, todoFolder, now);
  } catch (error) {
    // 오류 시 작업 중단 + 실패 원인 알림 (기존 파일은 변경하지 않음)
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
 * - file: 읽을 To-Do 문서 (평면 `<date> To-Do.md` 또는 legacy `<date>.md`)
 * - date: 문서 날짜
 * - layout: 평면 To-Do 파일("flat") 또는 기존 평면 legacy 파일("legacy")
 */
export interface TodoCandidate {
  file: TFile;
  date: Date;
  layout: "flat" | "legacy";
}

/**
 * 평면 To-Do 파일 basename에서 날짜를 파싱합니다. (순수 함수)
 *
 * 인식 형식:
 * - 평면 신규: "YYYY-MM-DD To-Do" → 해당 날짜
 * - legacy 평면: "YYYY-MM-DD" → 해당 날짜
 * 그 외 형식은 null을 반환한다.
 *
 * @returns { date, layout } 또는 null
 */
export function parseTodoBasename(
  basename: string
): { date: Date; layout: "flat" | "legacy" } | null {
  // 1) 평면 신규: "YYYY-MM-DD To-Do"
  const flat = basename.match(/^(\d{4}-\d{2}-\d{2}) To-Do$/);
  if (flat) {
    const date = parseLegacyBasename(flat[1]);
    if (date) return { date, layout: "flat" };
    return null;
  }
  // 2) legacy 평면: "YYYY-MM-DD"
  const legacyDate = parseLegacyBasename(basename);
  if (legacyDate) return { date: legacyDate, layout: "legacy" };
  return null;
}

/**
 * To-Do 폴더를 1회 스캔하여 이월/메모 승계 후보를 모읍니다. (부수효과 계층)
 *
 * 수집 규칙(평면 구조 전용):
 * - 폴더 직속 `.md` 파일의 basename이 `YYYY-MM-DD To-Do`이면 후보로 추가한다("flat").
 * - 폴더 직속 `.md` 파일의 basename이 `YYYY-MM-DD`이면 legacy 후보로 추가한다("legacy").
 *
 * 평면 신규 파일 + Legacy 평면 파일을 동시에 인식한다.
 * 폴더가 없으면 빈 배열을 반환하며, 동일 파일 경로의 중복은 제거한다.
 */
export async function collectTodoCandidates(
  app: App,
  todoFolder: string
): Promise<TodoCandidate[]> {
  const candidates: TodoCandidate[] = [];
  // 동일 파일 경로 중복 추가 방지
  const seen = new Set<string>();

  const folder = app.vault.getAbstractFileByPath(normalizePath(todoFolder));
  if (!folder) return candidates;

  const children = (folder as any).children || [];
  for (const child of children) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    const parsed = parseTodoBasename(child.basename);
    if (!parsed) continue;
    if (seen.has(child.path)) continue;
    seen.add(child.path);
    candidates.push({ file: child, date: parsed.date, layout: parsed.layout });
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
 * - entry: 실제로 이동할 To-Do 파일(TFile)
 */
interface ArchiveCandidate {
  date: Date;
  entry: TAbstractFile;
}

/**
 * 기준 일수를 초과한 오래된 To-Do 파일을 아카이브 폴더로 이동합니다.
 *
 * 평면 구조 전용. `todoFolder` 직속의 다음 파일만 대상으로 한다.
 * - 평면 신규: `YYYY-MM-DD To-Do.md`
 * - legacy 평면: `YYYY-MM-DD.md`
 *
 * 흐름:
 * 1. cutoff = now - archiveDays(시/분/초 0으로 정규화)를 기준으로 후보를 모은다.
 * 2. `selectEntriesToArchive(candidates, cutoff)`로 cutoff 미만(< cutoff) 항목만 선별한다.
 * 3. 아카이브 폴더가 없으면 생성한다.
 * 4. dest(`{archiveFolder}/{name}`)에 같은 이름이 이미 있으면 해당 항목 이동을 건너뛴다.
 * 5. 실제로 이동된 항목 수만 집계하여 알림으로 표시한다.
 *
 * @param todoFolder - To-Do 평면 폴더 경로(아카이브 대상 파일 수집 대상).
 */
export async function archiveOldTodos(
  app: App,
  plugin: GeminiAssistantPlugin,
  t: ViewLang,
  todoFolder: string,
  now: Date
): Promise<void> {
  const archiveFolder = normalizePath(plugin.settings.todoArchiveFolder || "ToDo/Archive");
  const archiveDays = plugin.settings.todoArchiveDays || 7;

  // cutoff = now - archiveDays (날짜 단위 비교를 위해 시/분/초 0으로 정규화)
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - archiveDays);
  cutoff.setHours(0, 0, 0, 0);

  // 1. 아카이브 후보 수집 (평면 To-Do + legacy 평면 파일)
  const candidates: ArchiveCandidate[] = [];
  const seen = new Set<string>();

  const folder = app.vault.getAbstractFileByPath(normalizePath(todoFolder));
  if (folder) {
    const children = ((folder as any).children || []) as TAbstractFile[];
    for (const child of children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      const parsed = parseTodoBasename(child.basename);
      if (!parsed) continue;
      if (seen.has(child.path)) continue;
      seen.add(child.path);
      candidates.push({ date: parsed.date, entry: child });
    }
  }

  // 2. cutoff 미만 항목만 아카이브 대상으로 선별 (순수 함수)
  const toArchive = selectEntriesToArchive(candidates, cutoff);
  if (toArchive.length === 0) return;

  // 3. 아카이브 폴더가 없으면 생성
  if (!app.vault.getAbstractFileByPath(archiveFolder)) {
    await app.vault.createFolder(archiveFolder);
  }

  // 4~5. 실제 이동 + 이름 충돌 시 건너뜀, 이동된 개수만 집계
  let movedCount = 0;
  for (const { entry } of toArchive) {
    const dest = normalizePath(`${archiveFolder}/${entry.name}`);
    // 이동 대상에 이미 같은 이름의 항목이 있으면 건너뜀
    if (app.vault.getAbstractFileByPath(dest)) continue;
    await app.fileManager.renameFile(entry, dest);
    movedCount++;
  }

  // 실제로 이동된 항목 수만 알림
  if (movedCount > 0) {
    new Notice(t.todoArchived(movedCount));
  }
}
