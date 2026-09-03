import type { GeminiAssistantSettings } from "./types";
import { buildSkillsPrompt } from "./skills";
import { buildDateStr } from "./planner-paths";

/**
 * 항상 사용되는 내장 기본 시스템 프롬프트 (Obsidian PKM 보정본).
 * 사용자가 설정에서 입력한 시스템 프롬프트는 이 기본 프롬프트를 대체하지 않고,
 * "추가 지침"으로 뒤에 덧붙여진다(buildSystemPrompt 참고).
 */
export const BASE_SYSTEM_PROMPT =
  "You are an AI assistant embedded in Obsidian, acting as the user's personal knowledge companion. The user's vault holds their personal records, work logs, technical notes, travel journals, and memos.\n\nKnowledge base first: Treat the vault as the primary source of truth. When the user asks about information, past events, decisions, people, or anything that may be recorded in their notes, FIRST use `search_vault` (semantic search backed by the vault index and Graph RAG) to find relevant notes, and `read_note` to read full content before answering. Ground your answers in the user's own notes rather than relying on general knowledge.\n\nCite sources: When you answer using the vault, reference the note paths you used so the user can open and verify them.\n\nBe honest about gaps: If the vault has no relevant information, say so clearly. You may then answer from general knowledge, but make that distinction explicit.\n\nRespect the user's structure: Follow the existing folder organization, naming conventions, tags, and frontmatter when creating or editing notes. Keep edits minimal and consistent with the surrounding note's style.\n\nRespond in the same language the user uses.\n\nWhen writing code blocks, always specify the programming language (e.g. ```python, ```javascript, ```sql) so that syntax highlighting and the Code Styler plugin can render them properly.";

/**
 * 과거에 DEFAULT_SETTINGS.systemPrompt 기본값으로 저장됐던 프롬프트 문자열 목록.
 * 기존 사용자의 저장된 systemPrompt가 이 중 하나와 동일하면(직접 커스터마이징한 적 없음)
 * 마이그레이션 시 빈 문자열로 초기화하여 기본 프롬프트가 중복 적용되지 않도록 한다.
 */
export const LEGACY_DEFAULT_SYSTEM_PROMPTS: string[] = [
  // v0.2.x 이전 원본 기본 프롬프트
  "You are a helpful assistant embedded in Obsidian. You can help with note-taking, searching the vault, and answering questions based on the user's notes. Respond in the same language the user uses. When writing code blocks, always specify the programming language (e.g. ```python, ```javascript, ```sql) so that syntax highlighting and Code Styler plugin can render them properly.",
  // 기본값으로 잠시 저장됐을 수 있는 PKM 보정 프롬프트(= 현재 BASE_SYSTEM_PROMPT)
  BASE_SYSTEM_PROMPT,
];

/**
 * 현재 시각을 알려주는 블록을 만든다.
 *
 * 모델은 자기가 언제 실행되는지 모른다. 학습 시점을 "오늘"로 착각해 "어제 노트",
 * "이번 주 금요일" 같은 상대 표현을 엉뚱한 날짜로 풀어버린다. time MCP 서버를
 * 붙이는 것이 흔한 해법이지만, 이 플러그인은 사용자 기기에서 도니 로컬 시계가
 * 곧 사용자의 시계다 — 외부 프로세스가 필요 없다.
 *
 * 요일과 타임존까지 넣는 이유는 날짜만으로는 상대 표현을 풀 수 없기 때문이다.
 * 날짜 포맷은 planner-paths의 buildDateStr을 그대로 쓴다 — To-Do·회고 노트 경로가
 * 같은 YYYY-MM-DD를 쓰므로, 모델이 경로 포맷을 추측하지 않게 된다.
 *
 * 로케일을 "en-US"로 고정하고 toTimeString을 쓰는 것은 의도된 선택이다. 사용자가
 * 읽을 문구가 아니라 모델이 파싱할 문구이므로, 기기 로케일에 따라 표기가 흔들리지
 * 않는 쪽이 낫다.
 */
function buildDateTimeContext(now: Date): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  // toTimeString() → "08:45:12 GMT+0900 (...)". 앞 5자가 HH:MM이다.
  const time = now.toTimeString().slice(0, 5);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return [
    "\n\n## Current date and time",
    `${buildDateStr(now)} (${weekday}) ${time} — ${timeZone}`,
    "This is the user's local time, refreshed on every message. Resolve relative dates" +
      ' ("today", "yesterday", "this Friday", "last month") against it instead of guessing,' +
      " then pass the computed YYYY-MM-DD to `search_vault`'s modifiedAfter/modifiedBefore" +
      " rather than searching the whole vault. To-do and retrospective note paths use the" +
      " same YYYY-MM-DD format.",
  ].join("\n");
}

/**
 * 시스템 프롬프트를 캐시 가능성 기준으로 두 조각으로 나눈 형태.
 *
 * 프롬프트 캐싱은 "접두어가 바이트 단위로 같을 때"만 적중한다. 시각은 분마다 변하므로
 * 안정 조각과 같은 블록에 두면 매 요청 캐시가 깨진다. 두 조각을 따로 넘길 수 있는
 * 백엔드(Bedrock)는 그 사이에 캐시 경계를 끼운다.
 */
export interface SystemPromptSegments {
  /** 설정이 바뀔 때만 변하는 부분 — 기본 프롬프트 + 사용자 추가 지침 + 스킬. */
  stable: string;
  /** 매 요청 변하는 부분 — 현재 시각 블록. 캐시 경계 뒤에 와야 한다. */
  volatile: string;
}

/**
 * 시스템 프롬프트를 안정/변동 조각으로 나눠 구성한다.
 *
 *  - 내장 기본 프롬프트(BASE_SYSTEM_PROMPT)는 항상 포함된다.
 *  - 설정의 systemPrompt 값이 비어 있지 않으면 "추가 지침"으로 뒤에 덧붙인다.
 *  - 활성화된 Obsidian 스킬 지식(buildSkillsPrompt)을 덧붙인다(기존 동작 유지).
 *  - 현재 시각 블록은 volatile로 분리한다.
 *
 * 두 조각을 이어붙이면 buildSystemPrompt와 완전히 같은 문자열이 된다 — 캐시 경계를
 * 지원하지 않는 백엔드는 그냥 이어붙여 쓰면 되므로 동작 차이가 없다.
 *
 * @param now 현재 시각. 테스트에서 고정하기 위한 파라미터이며, 실제 호출은 생략한다.
 *   기본값을 호출 시점에 평가하므로 세션이 자정을 넘겨도 값이 굳지 않는다.
 */
export function buildSystemPromptSegments(
  settings: GeminiAssistantSettings,
  now: Date = new Date()
): SystemPromptSegments {
  const custom = (settings.systemPrompt ?? "").trim();
  const skills = buildSkillsPrompt(settings.enabledSkills || [], settings.customSkills || []);

  let stable = BASE_SYSTEM_PROMPT;
  if (custom) {
    // 사용자 추가 지침은 기본 프롬프트를 대체하지 않고 보강한다.
    stable += `\n\n## Additional instructions from the user\n${custom}`;
  }
  // buildSkillsPrompt는 활성 스킬이 없으면 ""를 반환하므로 그대로 이어붙인다.
  stable += skills;

  return { stable, volatile: buildDateTimeContext(now) };
}

/**
 * 최종 시스템 프롬프트 문자열. 캐시 경계가 필요 없는 호출부용이다.
 *
 * 시각 블록이 맨 끝인 이유: 앞의 조각들은 설정이 바뀔 때만 변하는데 시각은 매 요청
 * 변한다. 앞에 두면 프롬프트 캐싱의 안정 접두어가 매번 깨진다.
 */
export function buildSystemPrompt(
  settings: GeminiAssistantSettings,
  now: Date = new Date()
): string {
  const { stable, volatile } = buildSystemPromptSegments(settings, now);
  return stable + volatile;
}
