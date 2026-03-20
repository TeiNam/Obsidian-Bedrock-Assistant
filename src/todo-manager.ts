// To-Do 관련 유틸리티 함수 (chat-view.ts에서 분리)
// createTodoNote, getUnfinishedTasks, injectCarryOverTasks 등 To-Do 생성/관리 로직

import { TFile, Notice, normalizePath } from "obsidian";
import type { App } from "obsidian";
import type GeminiAssistantPlugin from "./main";
import type { ViewLang } from "./chat-view-i18n";

/**
 * 오늘 날짜로 To-Do 노트를 생성합니다.
 * 템플릿 기반으로 생성하며, 이전 To-Do에서 미완료 항목과 메모를 승계합니다.
 */
export async function createTodoNote(
  app: App,
  plugin: GeminiAssistantPlugin,
  t: ViewLang
): Promise<void> {
  try {
    const folder = normalizePath(plugin.settings.todoFolder || "ToDo");

    // 폴더가 없으면 생성
    const folderExists = app.vault.getAbstractFileByPath(folder);
    if (!folderExists) {
      await app.vault.createFolder(folder);
    }

    // 오늘 날짜 (YYYY-MM-DD)
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const path = `${folder}/${dateStr}.md`;

    // 이미 존재하면 열기만
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing && existing instanceof TFile) {
      await app.workspace.getLeaf(false).openFile(existing);
      new Notice(t.todoExists(path));
      return;
    }

    // 템플릿 파일에서 내용 읽기
    const templateFolder = normalizePath(plugin.settings.templateFolder || "Templates");
    const templateName = plugin.settings.todoTemplateName || "Daily To-Do";
    const templatePath = `${templateFolder}/${templateName}.md`;
    let template = `# 📋 {{date}}\n\n## To-Do\n\n- [ ] \n\n## Notes\n\n`;
    const templateFile = app.vault.getAbstractFileByPath(templatePath);
    if (templateFile && templateFile instanceof TFile) {
      template = await app.vault.cachedRead(templateFile);
    }

    // 이전 날짜 계산
    const prev = new Date(now);
    prev.setDate(prev.getDate() - 1);
    const prevDateStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
    let content = template
      .replace(/\{\{date\}\}/g, dateStr)
      .replace(/\{\{prevDate\}\}/g, prevDateStr);

    // 전일자(또는 가장 최근) To-Do에서 미완료 항목 가져오기
    const carryOver = await getUnfinishedTasks(app, folder, now);
    if (carryOver.length > 0) {
      // 템플릿에서 오늘의 할 일 섹션 내 ### 서브섹션 추출
      const subSections = extractTodoSubSections(content);

      if (subSections.length >= 2) {
        // AI로 서브섹션별 분류
        const classified = await classifyTasksForSections(plugin, subSections, carryOver);
        // 각 서브섹션의 빈 체크박스 자리에 분류된 항목 주입
        for (const [section, sectionTasks] of classified) {
          content = injectTasksIntoSubSection(content, section, sectionTasks);
        }
      } else {
        // 서브섹션이 없으면 기존 방식으로 주입
        content = injectCarryOverTasks(content, carryOver);
      }
    }

    // 이전 투두의 메모 섹션에서 오늘 이후(오늘 포함) 날짜 항목을 메모에 승계
    const datedNotes = await getDatedNotesFromPrevTodo(app, folder, now);
    if (datedNotes.length > 0) {
      const noteLines = datedNotes.map((n) => n.raw);
      content = injectNotesIntoMemoSection(content, noteLines);
    }

    const file = await app.vault.create(path, content);
    await app.workspace.getLeaf(false).openFile(file);
    new Notice(t.todoCreated(path));

    // 오래된 To-Do 파일 아카이브
    await archiveOldTodos(app, plugin, t, folder, now);
  } catch (error) {
    new Notice(t.todoError((error as Error).message));
  }
}

/**
 * 전일자(또는 가장 최근) To-Do 파일에서 미완료 항목을 추출합니다.
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
 * 이전 투두의 메모 섹션에서 날짜가 포함된 항목을 추출합니다.
 * 날짜가 오늘 이후(오늘 포함)인 항목만 반환합니다.
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

  const results: Array<{ date: string; text: string; time: string | null; raw: string }> = [];
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

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
 * 기준 일수를 초과한 To-Do 파일을 아카이브 폴더로 이동합니다.
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
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - archiveDays);
  cutoff.setHours(0, 0, 0, 0);

  // 아카이브 폴더가 없으면 생성
  if (!app.vault.getAbstractFileByPath(archiveFolder)) {
    await app.vault.createFolder(archiveFolder);
  }

  // To-Do 폴더 내 .md 파일 순회
  const folder = app.vault.getAbstractFileByPath(todoFolder);
  if (!folder) return;

  const filesToArchive: TFile[] = [];
  const children = (folder as any).children || [];
  for (const child of children) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    // 파일명에서 날짜 파싱 (YYYY-MM-DD.md)
    const match = child.basename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) continue;
    const fileDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (fileDate < cutoff) {
      filesToArchive.push(child);
    }
  }

  if (filesToArchive.length === 0) return;

  for (const f of filesToArchive) {
    const dest = `${archiveFolder}/${f.name}`;
    // 이동 대상에 이미 같은 이름이 있으면 건너뜀
    if (app.vault.getAbstractFileByPath(dest)) continue;
    await app.vault.rename(f, dest);
  }

  new Notice(t.todoArchived(filesToArchive.length));
}
