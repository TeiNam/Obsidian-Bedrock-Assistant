// 대화 결론 수확 (Conversation Harvest) — 순수 모듈
// ==================================================
// 저장된 채팅 세션에서 "결론·결정·근거·미해결 질문"만 추출해 검색 가능한 볼트
// 노트로 만든다. 부수효과·I/O·LLM 호출이 없는 순수 함수만 두어 단위 테스트가
// 가능하게 한다(실행 래퍼는 호출부가 담당).
//
// 왜 필요한가:
//  - main.ts는 세션을 50개로 제한한다(`if (sessions.length > 50) sessions.length = 50`).
//    51번째가 저장되면 가장 오래된 세션이 조용히 소멸하고, 그 대화의 결론은
//    영구 손실된다.
//  - 원문 내보내기(chat-view.ts exportChat)는 이미 있지만 전량 덤프다. 그대로
//    인덱싱하면 잡담·시행착오·중간 오류까지 RAG 근거가 되어 검색 품질을 떨어뜨린다.
//
// 따라서 이 모듈은 "내보내기"가 아니라 "결론 추출"이다.

import { normalizePath, TFile } from "obsidian";
import type { App } from "obsidian";
import type { ChatMessage, ChatSession, IAiClient } from "./types";
import { ensureWithinFolder } from "./second-brain/vault-path-guard";

/** 수확 노트를 저장할 위키 폴더 하위 폴더명. */
export const HARVEST_SUBFOLDER = "Conversations";

/**
 * LLM에 넣을 대화 직렬화 최대 글자 수.
 * 긴 세션 전체를 넣으면 컨텍스트 한도를 넘고 비용도 커진다. 결론은 대화 끝에
 * 나오므로 초과분은 앞(오래된 쪽)에서 버린다.
 */
export const HARVEST_MAX_CHARS = 24000;

/** 파일명으로 쓸 제목의 최대 길이. */
const TITLE_MAX_LENGTH = 80;

/** 언어별 라벨 (프롬프트의 출력 언어 지정에 사용). */
const LANGUAGE_LABELS: Record<string, string> = {
  ko: "한국어",
  ja: "日本語",
  en: "English",
};

/**
 * 세션 제목을 파일명으로 안전한 문자열로 변환한다 — 순수 함수.
 *
 * 제목은 사용자 입력의 앞부분에서 오므로 경로 구분자·상위 경로 참조·OS 금지
 * 문자가 들어올 수 있다. 그대로 경로에 넣으면 의도치 않은 폴더가 생기거나
 * 볼트 밖으로 나갈 수 있다.
 *
 * @returns 안전한 파일명. 남는 글자가 없으면 "Untitled"
 */
export function sanitizeTitleForFilename(title: string): string {
  const raw = String(title ?? "");

  const cleaned = raw
    // 경로 구분자와 OS 금지 문자를 하이픈으로 바꾼다(제거하면 단어가 붙어버린다).
    .replace(/[/\\:*?"<>|]/g, "-")
    // 상위 경로 참조를 무해화한다.
    .replace(/\.{2,}/g, "")
    // 제어문자 제거.
    // eslint-disable-next-line no-control-regex -- 파일명에서 제어문자를 걸러내는 것이 이 정규식의 목적이다
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // 연속 하이픈 축약.
    .replace(/-{2,}/g, "-")
    .trim()
    // 앞뒤의 점·하이픈 제거. 끝의 점은 Windows에서 파일 생성이 실패한다.
    .replace(/^[.\-\s]+|[.\-\s]+$/g, "");

  if (cleaned === "") return "Untitled";
  return cleaned.length > TITLE_MAX_LENGTH ? cleaned.slice(0, TITLE_MAX_LENGTH).trim() : cleaned;
}

/**
 * 수확 노트의 저장 경로를 만든다 — 순수 함수.
 * `{wikiFolder}/Conversations/YYYY-MM-DD {제목}.md`
 *
 * 제목은 sanitizeTitleForFilename을 거치므로 하위 폴더가 생기지 않고 볼트를
 * 이탈하지 않는다.
 */
export function buildHarvestNotePath(wikiFolder: string, title: string, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const safeTitle = sanitizeTitleForFilename(title);
  return normalizePath(`${wikiFolder}/${HARVEST_SUBFOLDER}/${year}-${month}-${day} ${safeTitle}.md`);
}

/**
 * 대화 메시지를 LLM 입력용 텍스트로 직렬화한다 — 순수 함수.
 *
 * HARVEST_MAX_CHARS를 넘으면 앞(오래된 메시지)에서 잘라낸다. 결론과 최종 결정은
 * 대화 끝에 나오므로, 뒤를 자르면 정작 필요한 부분을 버리게 된다.
 */
export function serializeConversation(messages: ChatMessage[]): string {
  if (!messages || messages.length === 0) return "";

  const lines = messages.map((m) => {
    const role = m.role === "user" ? "User" : "Assistant";
    return `${role}: ${m.content}`;
  });

  // 뒤에서부터 담아 상한에 걸리면 멈춘다(최신 대화 우선 보존).
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    // 구분 개행 1자를 함께 계산한다.
    const cost = line.length + 1;
    if (total + cost > HARVEST_MAX_CHARS) break;
    kept.unshift(line);
    total += cost;
  }

  // 상한이 한 줄보다 작아 아무것도 담지 못한 경우, 마지막 줄만 잘라서라도 남긴다.
  if (kept.length === 0) {
    return lines[lines.length - 1].slice(0, HARVEST_MAX_CHARS);
  }

  return kept.join("\n");
}

/**
 * 결론 추출 프롬프트를 구성한다 — 순수 함수.
 *
 * 원문 요약이 아니라 "재사용 가능한 지식"만 뽑도록 지시한다. 이 노트는 인덱싱되어
 * 이후 RAG 근거가 되므로, 날조가 들어가면 오염이 전파된다. 또한 잡담 세션에서
 * 억지 결론을 만들지 않도록 명시적으로 허용 출구를 준다.
 */
export function buildHarvestPrompt(session: ChatSession, language: string): string {
  const langLabel = LANGUAGE_LABELS[language] || LANGUAGE_LABELS.en;
  const conversation = serializeConversation(session.messages);

  return `You are extracting durable knowledge from a past conversation so it can be found later by search. This is not a transcript summary.

Language: Write in ${langLabel}.

## Conversation
${conversation}

## Output format
Write markdown with these sections, omitting any section that has no content:

### Conclusions
What was actually established. Each item must be a standalone statement that makes sense without the conversation.

### Decisions
Choices that were made, with the reason for each.

### Rationale
Constraints, trade-offs, or evidence that led to the above.

### Open questions
What remained unresolved.

## Instructions
- Do not invent anything that is not supported by the conversation above
- Write each item so it is understandable on its own, without the surrounding chat
- Omit greetings, tool output, retries, and dead ends
- If the conversation reached no substantive conclusion, write exactly one line saying there was no substantive conclusion and stop
- Use ### (h3) headings only. Do NOT use # or ##
- Be concise: prefer fewer, sharper items over exhaustive coverage`;
}

// ============================================
// 실행 래퍼 (I/O + LLM)
// ============================================

/** 수확 LLM 호출의 최대 토큰. 결론 목록은 장문이 아니므로 종합보다 작게 둔다. */
const HARVEST_MAX_TOKENS = 1500;

/** 수확 결과. */
export interface HarvestResult {
  success: boolean;
  /** 생성된 노트 경로(성공 시) */
  path?: string;
  /** 사용자에게 보일 메시지 */
  message?: string;
}

/** 수확 실행에 필요한 의존성. */
export interface HarvestDeps {
  app: App;
  aiClient: IAiClient;
  /** Second Brain 위키 폴더 경로 */
  wikiFolder: string;
  language: string;
  /** 기준 시각. 테스트 주입용(미지정 시 현재 시각) */
  now?: Date;
  /**
   * Second Brain 기능 활성 여부. false면 아무것도 하지 않는다.
   * 위키 폴더에 쓰는 다른 기능들과 동일한 옵트인 격리를 따른다(Req 12.4).
   * 생략하면 호출부가 이미 확인했다고 본다.
   */
  enabled?: boolean;
}

/**
 * 세션에서 결론을 추출해 볼트 노트로 저장한다.
 *
 * 파이프라인: buildHarvestPrompt → converseLight → 경로 가드 → 폴더 보장 → 저장.
 * 생성된 노트는 일반 마크다운이므로 기존 증분 인덱서가 자동으로 인덱싱하며,
 * 이후 Graph RAG 검색 근거가 된다.
 *
 * 같은 경로가 이미 있으면 덮어쓰지 않고 실패로 보고한다 — 사용자가 그 노트에
 * 손으로 덧붙였을 수 있으므로 조용히 지워서는 안 된다.
 */
export async function harvestSession(
  deps: HarvestDeps,
  session: ChatSession,
): Promise<HarvestResult> {
  const { app, aiClient, wikiFolder, language } = deps;
  const now = deps.now ?? new Date();

  // 옵트인 격리: 비활성이면 LLM 호출도 폴더 생성도 하지 않는다.
  if (deps.enabled === false) {
    return {
      success: false,
      message: "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.",
    };
  }

  if (!session || session.messages.length === 0) {
    return { success: false, message: "수확할 대화가 없습니다." };
  }

  const path = buildHarvestNotePath(wikiFolder, session.title, now);

  // 경로 가드: 위키 폴더를 벗어나면 쓰지 않는다(제목 정규화 이후의 이중 방어).
  const guard = ensureWithinFolder(path, wikiFolder);
  if (!guard.ok) {
    return { success: false, message: `저장 경로가 유효하지 않습니다: ${guard.reason}` };
  }

  // 기존 노트를 덮어쓰지 않는다.
  if (app.vault.getAbstractFileByPath(guard.path) instanceof TFile) {
    return { success: false, message: `이미 같은 이름의 수확 노트가 있습니다: ${guard.path}` };
  }

  let text: string;
  try {
    const prompt = buildHarvestPrompt(session, language);
    const response = await aiClient.converseLight(prompt, HARVEST_SYSTEM_PROMPT, HARVEST_MAX_TOKENS);
    text = (response.text ?? "").trim();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { success: false, message: `결론 추출 실패: ${reason}` };
  }

  if (text === "") {
    // 빈 응답으로 빈 노트를 만들면 인덱스에 잡음만 늘어난다.
    return { success: false, message: "추출된 결론이 없어 노트를 만들지 않았습니다." };
  }

  const note = buildHarvestNote(session, text, now);

  try {
    await ensureHarvestFolder(app, wikiFolder);
    await app.vault.create(guard.path, note);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { success: false, message: `노트 저장 실패: ${reason}` };
  }

  return { success: true, path: guard.path, message: `수확 노트를 만들었습니다: ${guard.path}` };
}

/** 수확 LLM 호출의 시스템 프롬프트. */
const HARVEST_SYSTEM_PROMPT = [
  "당신은 과거 대화에서 재사용 가능한 지식만 추출하는 보조자입니다.",
  "대화에 근거가 없는 내용은 절대 만들지 마십시오.",
  "요약이 아니라 '나중에 검색해서 쓸 수 있는 결론'을 씁니다.",
].join("\n");

/**
 * 수확 노트 본문을 구성한다 — 순수 함수.
 * 원본 대화는 넣지 않는다. 원문이 필요하면 기존 대화 내보내기를 쓰면 되고,
 * 원문을 인덱싱하면 잡담·시행착오가 RAG 근거가 된다.
 */
export function buildHarvestNote(session: ChatSession, extracted: string, now: Date): string {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const sessionDate = new Date(session.updatedAt);
  const sessionStamp = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`;

  return [
    "---",
    `harvested: ${stamp}`,
    `conversation_date: ${sessionStamp}`,
    `source_session: ${session.id}`,
    "type: conversation-harvest",
    "---",
    "",
    `# ${session.title}`,
    "",
    extracted,
    "",
  ].join("\n");
}

/** 수확 노트의 부모 폴더(`{wikiFolder}/Conversations`)를 보장한다. */
async function ensureHarvestFolder(app: App, wikiFolder: string): Promise<void> {
  for (const folder of [wikiFolder, `${wikiFolder}/${HARVEST_SUBFOLDER}`]) {
    const normalized = normalizePath(folder);
    if (app.vault.getAbstractFileByPath(normalized)) continue;
    await app.vault.createFolder(normalized);
  }
}
