import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildSystemPromptSegments,
  BASE_SYSTEM_PROMPT,
} from "./system-prompt";
import type { GeminiAssistantSettings } from "./types";

/** 시각 블록만 보기 위한 최소 설정. 커스텀 프롬프트·스킬은 비운다. */
function settingsOf(overrides: Partial<GeminiAssistantSettings> = {}): GeminiAssistantSettings {
  return {
    systemPrompt: "",
    enabledSkills: [],
    customSkills: [],
    ...overrides,
  } as GeminiAssistantSettings;
}

describe("buildSystemPrompt 현재 시각 블록", () => {
  it("전달한 시각의 날짜·요일·시분을 담는다", () => {
    // 2026-09-03은 목요일이다. 로컬 타임존 기준으로 만들어야 buildDateStr과 일치한다.
    const now = new Date(2026, 8, 3, 14, 5);

    const prompt = buildSystemPrompt(settingsOf(), now);

    expect(prompt).toContain("2026-09-03");
    expect(prompt).toContain("Thursday");
    expect(prompt).toContain("14:05");
  });

  it("타임존 이름을 담는다", () => {
    const prompt = buildSystemPrompt(settingsOf(), new Date(2026, 8, 3));

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(prompt).toContain(timeZone);
  });

  it("자정을 넘긴 시각도 그 날짜로 계산한다", () => {
    // 로컬 자정 직후. UTC 변환을 거치면 전날로 밀리는 고전적 결함 지점이다.
    const prompt = buildSystemPrompt(settingsOf(), new Date(2026, 0, 1, 0, 30));

    expect(prompt).toContain("2026-01-01");
    expect(prompt).toContain("00:30");
  });

  /**
   * 시각은 매 요청마다 변하고 나머지 조각은 설정이 바뀔 때만 변한다.
   * 시각 블록이 앞에 오면 프롬프트 캐싱의 안정 접두어가 매번 깨지므로,
   * 반드시 맨 끝이어야 한다.
   */
  it("시각 블록이 기본 프롬프트·추가 지침·스킬보다 뒤에 온다", () => {
    const prompt = buildSystemPrompt(
      settingsOf({ systemPrompt: "언제나 한국어로 답한다." }),
      new Date(2026, 8, 3)
    );

    const timeAt = prompt.indexOf("## Current date and time");
    expect(timeAt).toBeGreaterThan(prompt.indexOf(BASE_SYSTEM_PROMPT));
    expect(timeAt).toBeGreaterThan(prompt.indexOf("언제나 한국어로 답한다."));
    // 시각 블록 뒤에는 다른 섹션이 붙지 않는다.
    expect(prompt.slice(timeAt)).not.toContain("## Additional instructions");
  });

  it("호출마다 시각을 다시 계산한다", () => {
    const first = buildSystemPrompt(settingsOf(), new Date(2026, 8, 3, 9, 0));
    const second = buildSystemPrompt(settingsOf(), new Date(2026, 8, 4, 9, 0));

    expect(first).not.toBe(second);
    expect(first).toContain("2026-09-03");
    expect(second).toContain("2026-09-04");
  });

  it("now를 생략하면 실제 현재 날짜를 쓴다(모듈 로드 시점에 굳지 않는다)", () => {
    const prompt = buildSystemPrompt(settingsOf());

    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
    expect(prompt).toContain(expected);
  });

  it("기존 조각(기본 프롬프트·추가 지침)을 그대로 유지한다", () => {
    const prompt = buildSystemPrompt(settingsOf({ systemPrompt: "  간결하게 답한다.  " }));

    expect(prompt).toContain(BASE_SYSTEM_PROMPT);
    expect(prompt).toContain("## Additional instructions from the user");
    // 앞뒤 공백은 잘라서 넣는다.
    expect(prompt).toContain("\n간결하게 답한다.");
  });
});

// ============================================
// buildSystemPromptSegments — 캐시 경계 분리
// ============================================
/**
 * 프롬프트 캐싱은 접두어가 바이트 단위로 같을 때만 적중한다. 시각은 분마다 변하므로
 * 안정 조각과 같은 블록에 두면 매 요청 캐시가 깨진다.
 */
describe("buildSystemPromptSegments", () => {
  it("두 조각을 이어붙이면 buildSystemPrompt와 같다", () => {
    // 캐시 경계를 지원하지 않는 백엔드는 이어붙여 쓰므로 동작 차이가 없어야 한다.
    const now = new Date(2026, 8, 3, 14, 5);
    const settings = settingsOf({ systemPrompt: "간결하게." });

    const { stable, volatile } = buildSystemPromptSegments(settings, now);

    expect(stable + volatile).toBe(buildSystemPrompt(settings, now));
  });

  it("시각은 volatile에만, 기본 프롬프트와 추가 지침은 stable에만 있다", () => {
    const now = new Date(2026, 8, 3, 14, 5);

    const { stable, volatile } = buildSystemPromptSegments(
      settingsOf({ systemPrompt: "언제나 한국어로." }),
      now
    );

    expect(stable).toContain(BASE_SYSTEM_PROMPT);
    expect(stable).toContain("언제나 한국어로.");
    expect(stable).not.toContain("2026-09-03");
    expect(stable).not.toContain("## Current date and time");

    expect(volatile).toContain("2026-09-03");
    expect(volatile).toContain("14:05");
  });

  it("시각이 달라도 stable은 바이트 단위로 동일하다", () => {
    // 이게 캐시 적중의 전제다. stable이 흔들리면 경계를 둬도 의미가 없다.
    const settings = settingsOf({ systemPrompt: "동일 설정" });

    const a = buildSystemPromptSegments(settings, new Date(2026, 8, 3, 9, 0));
    const b = buildSystemPromptSegments(settings, new Date(2026, 11, 25, 23, 59));

    expect(a.stable).toBe(b.stable);
    expect(a.volatile).not.toBe(b.volatile);
  });

  it("설정이 바뀌면 stable도 바뀐다", () => {
    const now = new Date(2026, 8, 3);

    const a = buildSystemPromptSegments(settingsOf({ systemPrompt: "A" }), now);
    const b = buildSystemPromptSegments(settingsOf({ systemPrompt: "B" }), now);

    expect(a.stable).not.toBe(b.stable);
  });
});
