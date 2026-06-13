// ============================================
// 회고 서비스 공통 모듈
// ============================================
// 기존 RetrospectiveModal의 회고 생성 로직을 추출하여
// 모달과 채팅 양쪽에서 재사용할 수 있도록 공통화한 모듈.
// 헬퍼 함수들은 개별 export하여 property 테스트가 가능하다.

import { normalizePath, TFile } from "obsidian";
import type { App } from "obsidian";
import type { GeminiAssistantSettings, IAiClient } from "./types";
import { buildTodoDocPath } from "./planner-paths";

// ============================================
// 인터페이스 정의
// ============================================

/** 회고 생성 결과 타입 */
export interface RetrospectiveResult {
  /** 회고 생성 성공 여부 */
  success: boolean;
  /** 생성된 회고 텍스트 (성공 시) */
  text?: string;
  /** 안내/오류 메시지 (실패 시) */
  message?: string;
}

/** 회고 생성에 필요한 의존성 */
export interface RetrospectiveDeps {
  app: App;
  settings: GeminiAssistantSettings;
  aiClient: IAiClient;
}

// ============================================
// 헬퍼 함수: To-Do 경로 생성
// ============================================

/**
 * 오늘자 To-Do 파일 경로를 생성한다.
 * 형식: {todoFolder}/YYYY-MM-DD.md
 * 월/일은 항상 2자리 zero-padded.
 *
 * @param todoFolder - To-Do 폴더 경로 (기본값: "ToDo")
 * @param date - 대상 날짜 (기본값: 현재 날짜)
 * @returns normalizePath 적용된 To-Do 파일 경로
 */
export function buildTodoPath(todoFolder: string, date?: Date): string {
  const folder = todoFolder || "ToDo";
  const d = date ?? new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return normalizePath(`${folder}/${year}-${month}-${day}.md`);
}


// ============================================
// 헬퍼 함수: 오늘자 To-Do 파일 해석 (새 구조 우선, Legacy 폴백)
// ============================================

/**
 * 오늘자 To-Do 파일을 평면 신규 구조 우선, Legacy 평면 구조 폴백으로 해석한다.
 *
 * 처리 순서:
 * 1) 평면 신규 `buildTodoDocPath(folder, date)`(= `{folder}/YYYY-MM-DD To-Do.md`)가 TFile로 존재하면 반환
 * 2) 없으면 Legacy `buildTodoPath(legacyFolder, date)`(= `{folder}/YYYY-MM-DD.md`)가 TFile로 존재하면 반환
 * 3) 둘 다 없으면 null 반환 (호출부에서 사용자 알림)
 *
 * @param app - Obsidian App 인스턴스 (볼트 접근용)
 * @param todoFolder - 평면 신규 To-Do 폴더 경로
 * @param legacyFolder - Legacy 평면 구조 To-Do 폴더 경로
 * @param date - 대상 날짜 (오늘)
 * @returns 해석된 To-Do 파일(TFile) 또는 null
 */
export function resolveTodayTodoFile(
  app: App,
  todoFolder: string,
  legacyFolder: string,
  date: Date,
): TFile | null {
  // 1. 평면 신규 구조 우선 탐색
  const newPath = buildTodoDocPath(todoFolder, date);
  const newFile = app.vault.getAbstractFileByPath(newPath);
  if (newFile instanceof TFile) return newFile;

  // 2. Legacy 평면 구조 폴백
  const legacyPath = buildTodoPath(legacyFolder, date);
  const legacyFile = app.vault.getAbstractFileByPath(legacyPath);
  if (legacyFile instanceof TFile) return legacyFile;

  // 3. 둘 다 없음
  return null;
}


// ============================================
// 헬퍼 함수: 날짜 문자열 생성
// ============================================

/**
 * Date 객체에서 YYYY-MM-DD 형식의 문자열을 생성한다.
 *
 * @param date - 대상 날짜
 * @returns YYYY-MM-DD 형식 문자열
 */
function formatDateStr(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ============================================
// 헬퍼 함수: Today_Files 수집
// ============================================

/** 수집된 파일 정보 */
interface CollectedFile {
  path: string;
  content: string;
}

/**
 * 오늘 생성된 마크다운 파일을 수집한다.
 * To-Do 파일 자체와 archiveCleanFolder 하위 파일은 제외한다.
 *
 * @param files - 볼트 내 전체 파일 목록
 * @param todoFilePath - 제외할 To-Do 파일 경로
 * @param archiveCleanFolder - 제외할 아카이브 폴더 경로
 * @param dateStr - 오늘 날짜 문자열 (YYYY-MM-DD)
 * @returns 필터링 조건을 통과한 파일 목록 (TFile[])
 */
export function collectTodayFiles(
  files: TFile[],
  todoFilePath: string,
  archiveCleanFolder: string,
  dateStr: string,
): TFile[] {
  const normalizedArchive = normalizePath(archiveCleanFolder || "ToDo/Archive");
  const todayStart = new Date(dateStr + "T00:00:00").getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;

  return files.filter((file) => {
    // 생성일이 오늘인 파일만
    if (file.stat.ctime < todayStart || file.stat.ctime >= todayEnd) return false;
    // To-Do 파일 자체 제외
    if (file.path === todoFilePath) return false;
    // 아카이브 폴더 하위 제외
    if (file.path.startsWith(normalizedArchive + "/")) return false;
    // 마크다운 파일만
    if (file.extension !== "md") return false;
    return true;
  });
}

// ============================================
// 헬퍼 함수: 콘텐츠 Truncation
// ============================================

/**
 * 콘텐츠가 maxLength를 초과하면 앞부분만 잘라내고 "..."을 붙인다.
 * maxLength 이하이면 원본을 그대로 반환한다.
 *
 * @param content - 원본 콘텐츠
 * @param maxLength - 최대 길이 (기본값: 2000)
 * @returns truncation 적용된 콘텐츠
 */
export function truncateContent(content: string, maxLength: number = 2000): string {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + "...";
}


// ============================================
// 헬퍼 함수: 프롬프트 생성
// ============================================

/** 언어별 라벨 매핑 */
const LANGUAGE_LABELS: Record<string, string> = {
  ko: "한국어",
  ja: "日本語",
  en: "English",
};

/** 언어별 회고 제목 매핑 */
const RETROSPECTIVE_HEADINGS: Record<string, string> = {
  ko: "📝 오늘의 회고",
  ja: "📝 今日の振り返り",
  en: "📝 Daily Retrospective",
};

/**
 * 회고 생성용 AI 프롬프트를 구성한다.
 * 언어 설정에 따라 적절한 라벨과 제목을 사용한다.
 *
 * @param todoContent - To-Do 문서 내용
 * @param todayFiles - 오늘 생성된 파일 목록 (경로 + 콘텐츠)
 * @param language - 언어 설정 ("en" | "ko" | "ja")
 * @returns 생성된 프롬프트 문자열
 */
export function buildRetrospectivePrompt(
  todoContent: string,
  todayFiles: CollectedFile[],
  language: string,
): string {
  const langLabel = LANGUAGE_LABELS[language] || "English";
  const heading = RETROSPECTIVE_HEADINGS[language] || RETROSPECTIVE_HEADINGS.en;

  const filesContext = todayFiles.length > 0
    ? todayFiles.map((f) => `### ${f.path}\n${f.content}`).join("\n\n")
    : "(No additional files created today)";

  return `You are a daily retrospective assistant. Analyze the following To-Do document and today's created files, then write a retrospective summary.

Language: Write in ${langLabel}.

## Today's To-Do
${todoContent}

## Files Created Today (${todayFiles.length} files)
${filesContext}

## Instructions
- Summarize what was accomplished today based on the To-Do items and created files
- Note any incomplete tasks and possible reasons
- Provide brief insights or suggestions for improvement
- Keep it concise (under 300 words)
- Use markdown format
- The heading MUST be exactly: ## ${heading}
- Use ## (h2) level heading only. Do NOT use # (h1).`;
}

// ============================================
// 헬퍼 함수: 기존 회고 섹션 감지 및 교체
// ============================================

/** AI가 생성하는 회고 헤딩 + 템플릿에 있는 회고 헤딩 */
const ALL_HEADINGS = [
  ...Object.values(RETROSPECTIVE_HEADINGS),
  // 템플릿에서 사용하는 회고 헤딩 (이모지가 다름: 📊 vs 📝)
  "📊 오늘의 회고",
  "📊 今日の振り返り",
  "📊 Daily Retrospective",
];

/**
 * To-Do 콘텐츠에서 기존 회고 섹션의 시작 인덱스를 찾는다.
 * AI 생성 헤딩(📝)과 템플릿 헤딩(📊) 모두 검색한다.
 * 현재 언어를 우선 검색한다.
 *
 * @param content - To-Do 문서 내용
 * @param language - 현재 언어 설정
 * @returns 회고 섹션 시작 인덱스 (-1이면 없음)
 */
export function findRetrospectiveSection(content: string, language: string): number {
  // 현재 언어의 AI 헤딩과 템플릿 헤딩을 먼저 검색
  const currentHeading = RETROSPECTIVE_HEADINGS[language] || RETROSPECTIVE_HEADINGS.en;
  const headings = [currentHeading, ...ALL_HEADINGS.filter((h) => h !== currentHeading)];

  for (const heading of headings) {
    const marker = `## ${heading}`;
    const idx = content.indexOf(marker);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * To-Do 콘텐츠에서 기존 회고 섹션을 제거한다.
 * AI 프롬프트에 이전 회고가 포함되지 않도록 하기 위해 사용.
 *
 * @param content - To-Do 문서 내용
 * @param language - 현재 언어 설정
 * @returns 회고 섹션이 제거된 콘텐츠
 */
export function removeExistingRetrospective(content: string, language: string): string {
  const idx = findRetrospectiveSection(content, language);
  if (idx === -1) return content;
  return content.substring(0, idx).trimEnd();
}

/**
 * 기존 회고 섹션이 있으면 교체하고, 없으면 끝에 추가한다.
 *
 * @param content - To-Do 문서 원본 내용
 * @param newRetrospective - 새로 생성된 회고 텍스트
 * @param language - 현재 언어 설정
 * @returns 회고가 교체/추가된 최종 콘텐츠
 */
export function replaceOrAppendRetrospective(
  content: string,
  newRetrospective: string,
  language: string,
): string {
  const idx = findRetrospectiveSection(content, language);
  if (idx !== -1) {
    // 기존 회고 섹션 이전 내용 + 새 회고로 교체
    const before = content.substring(0, idx).trimEnd();
    return before + "\n\n" + newRetrospective + "\n";
  }
  // 기존 회고 없음 → 끝에 추가
  return content.trimEnd() + "\n\n" + newRetrospective + "\n";
}

/** 시스템 프롬프트 (회고 생성용) */
const SYSTEM_PROMPT = "You are a helpful retrospective assistant. Write in markdown format.";


// ============================================
// 메인 함수: 회고 생성
// ============================================

/**
 * 오늘자 To-Do 문서를 기반으로 회고를 생성하고 문서에 추가한다.
 * 모달과 채팅 양쪽에서 호출 가능한 공통 함수.
 *
 * 처리 흐름:
 * 1. 오늘자 To-Do 파일 존재 확인
 * 2. To-Do 내용 읽기
 * 3. 오늘 생성된 파일 수집 및 콘텐츠 truncation
 * 4. AI 프롬프트 구성 및 converseLight() 호출
 * 5. 생성된 회고를 To-Do 문서 끝에 추가
 *
 * @param deps - 회고 생성에 필요한 의존성 (app, settings, aiClient)
 * @returns 회고 생성 결과
 */
export async function generateRetrospective(
  deps: RetrospectiveDeps,
): Promise<RetrospectiveResult> {
  const { app, settings, aiClient } = deps;

  // 1. 오늘자 To-Do 파일 해석 (평면 신규 우선, Legacy 평면 폴백)
  const now = new Date();
  const dateStr = formatDateStr(now);
  const todoFile = resolveTodayTodoFile(
    app,
    settings.todoFolder,
    settings.todoFolder,
    now,
  );

  if (!todoFile) {
    return { success: false };
  }

  // 해석된 파일의 실제 경로 (collectTodayFiles에서 To-Do 자체 제외용)
  const todoPath = todoFile.path;

  try {
    // 2. To-Do 내용 읽기
    const todoContent = await app.vault.read(todoFile);

    // 3. 오늘 생성된 파일 수집
    const allFiles = app.vault.getFiles();
    const filteredFiles = collectTodayFiles(
      allFiles,
      todoPath,
      settings.todoArchiveFolder,
      dateStr,
    );

    // 파일 콘텐츠 읽기 및 truncation 적용
    const todayFiles: CollectedFile[] = [];
    for (const file of filteredFiles) {
      try {
        const content = await app.vault.cachedRead(file);
        todayFiles.push({
          path: file.path,
          content: truncateContent(content),
        });
      } catch {
        // 읽기 실패 시 건너뜀 (기존 모달 동작과 동일)
      }
    }

    // 4. AI 프롬프트 구성 및 호출 (기존 회고 섹션은 프롬프트에서 제외)
    const contentForPrompt = removeExistingRetrospective(todoContent, settings.language);
    const prompt = buildRetrospectivePrompt(contentForPrompt, todayFiles, settings.language);
    const result = await aiClient.converseLight(prompt, SYSTEM_PROMPT, 2048);

    // 5. 기존 회고 섹션이 있으면 교체, 없으면 끝에 추가
    // (사용자가 명시적으로 요청한 회고 생성이므로 vault.modify 사용이 적절)
    const updatedContent = replaceOrAppendRetrospective(
      todoContent, result.text.trim(), settings.language,
    );
    await app.vault.modify(todoFile, updatedContent);

    return { success: true, text: result.text.trim() };
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
}
