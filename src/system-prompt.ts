import type { GeminiAssistantSettings } from "./types";
import { buildSkillsPrompt } from "./skills";

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
 * 최종 시스템 프롬프트를 구성한다.
 *  - 내장 기본 프롬프트(BASE_SYSTEM_PROMPT)는 항상 포함된다.
 *  - 설정의 systemPrompt 값이 비어 있지 않으면 "추가 지침"으로 뒤에 덧붙인다.
 *  - 활성화된 Obsidian 스킬 지식(buildSkillsPrompt)을 마지막에 덧붙인다(기존 동작 유지).
 *  - Second Brain 이 켜져 있으면 second-brain 스킬을 자동 주입한다(아래 주석 참고).
 */
export function buildSystemPrompt(settings: GeminiAssistantSettings): string {
  const custom = (settings.systemPrompt ?? "").trim();

  // Second Brain 을 켠 사용자는 SB 도구 8개를 쓰게 되는데, 그 규약(AI-first 노트 규격·
  // wikilink 규약·비파괴 원칙)은 second-brain 스킬에만 들어 있다. 설정 화면에서 스킬
  // 토글을 따로 찾아 켜지 않으면 LLM 이 규약을 모른 채 도구를 호출하므로 여기서 합집합으로
  // 채워 넣는다. settings.enabledSkills 를 직접 변형하면 저장 시 항목이 박혀 SB 를 껐을 때도
  // 스킬이 남으므로, 반드시 새 배열을 만든다(수동 토글 경로는 그대로 유지).
  const enabledSkills = settings.enabledSkills || [];
  const skillIds =
    settings.secondBrain?.enabled && !enabledSkills.includes("second-brain")
      ? [...enabledSkills, "second-brain"]
      : enabledSkills;

  const skills = buildSkillsPrompt(skillIds, settings.customSkills || []);

  let prompt = BASE_SYSTEM_PROMPT;
  if (custom) {
    // 사용자 추가 지침은 기본 프롬프트를 대체하지 않고 보강한다.
    prompt += `\n\n## Additional instructions from the user\n${custom}`;
  }
  // buildSkillsPrompt는 활성 스킬이 없으면 ""를 반환하므로 그대로 이어붙인다.
  prompt += skills;
  return prompt;
}
