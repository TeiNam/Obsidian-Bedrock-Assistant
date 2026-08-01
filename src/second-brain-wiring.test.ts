import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, type GeminiAssistantSettings } from "./types";
import { buildSystemPrompt } from "./system-prompt";
import { TOOLS, SECOND_BRAIN_TOOLS, getEnabledTools } from "./obsidian-tools";

/**
 * Second Brain 배선(wiring) 테스트
 *
 * Second Brain 은 "도구 8개"와 "second-brain 스킬(규약 문서)" 두 자산으로 이뤄지는데,
 * 이 둘이 secondBrain.enabled 스위치에 연결돼 있지 않아 다음 두 문제가 있었다.
 *
 *   (a) SB 를 켠 사용자도 설정 화면에서 second-brain 스킬 토글을 따로 켜지 않으면
 *       LLM 이 AI-first 노트 규격·wikilink 규약·비파괴 원칙을 모른 채 SB 도구를 호출한다.
 *   (b) SB 를 끈 사용자도 매 요청마다 SB 도구 스키마 8개를 실어 보내고,
 *       LLM 이 호출하면 "비활성화되어 있습니다" 거부 문자열만 돌아온다.
 *
 * Property 1: Activation — SB 켜짐 → 스킬 자동 주입 + 도구 노출
 * Property 2: Isolation — SB 꺼짐 → 스킬 미주입 + 도구 미노출
 * Property 3: Immutability — 자동 주입이 저장된 설정(enabledSkills)을 변형하지 않는다
 */

// second-brain 스킬 본문에만 등장하는 표지 문구.
// 스킬이 실제로 프롬프트에 실렸는지 확인하는 데 쓴다.
const SKILL_TAG = '<skill name="second-brain">';
const SKILL_MARKER = "wikilink 규약";

function settingsWith(overrides: Partial<GeminiAssistantSettings>): GeminiAssistantSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// --- SECOND_BRAIN_TOOLS 상수 검증 ---

describe("SECOND_BRAIN_TOOLS 상수", () => {
  it("Second Brain 전용 도구 8개가 정의되어 있다", () => {
    expect(SECOND_BRAIN_TOOLS).toHaveLength(8);
  });

  it("8개 이름이 모두 실제 TOOLS 정의에 존재한다", () => {
    // 상수에 오타가 있으면 필터가 아무 도구도 걸러내지 못하고 조용히 통과한다.
    const toolNames = TOOLS.map((t) => t.name);
    for (const name of SECOND_BRAIN_TOOLS) {
      expect(toolNames).toContain(name);
    }
  });

  it("쓰기 도구 4개와 읽기 전용 사고 도구 4개를 모두 포함한다", () => {
    for (const name of [
      "create_wiki_note",
      "update_index",
      "synthesize_topic",
      "reconcile_topic",
      "architect",
      "challenge",
      "connect",
      "emerge",
    ]) {
      expect(SECOND_BRAIN_TOOLS).toContain(name);
    }
  });
});

// --- Property 1: Activation ---

describe("buildSystemPrompt - Second Brain 켜짐 (Property 1)", () => {
  it("SB 켜짐 → second-brain 스킬이 프롬프트에 자동 주입된다", () => {
    const prompt = buildSystemPrompt(
      settingsWith({ secondBrain: { ...DEFAULT_SETTINGS.secondBrain, enabled: true } })
    );

    expect(prompt).toContain(SKILL_TAG);
    expect(prompt).toContain(SKILL_MARKER);
  });

  it("SB 켜짐 + enabledSkills 에 이미 second-brain 이 있어도 중복 주입되지 않는다", () => {
    const prompt = buildSystemPrompt(
      settingsWith({
        enabledSkills: ["second-brain"],
        secondBrain: { ...DEFAULT_SETTINGS.secondBrain, enabled: true },
      })
    );

    const occurrences = prompt.split(SKILL_TAG).length - 1;
    expect(occurrences).toBe(1);
  });

  it("SB 켜짐 → 기존 enabledSkills 스킬도 함께 유지된다", () => {
    const prompt = buildSystemPrompt(
      settingsWith({
        enabledSkills: ["korean-writing"],
        secondBrain: { ...DEFAULT_SETTINGS.secondBrain, enabled: true },
      })
    );

    expect(prompt).toContain('<skill name="korean-writing">');
    expect(prompt).toContain(SKILL_TAG);
  });
});

describe("getEnabledTools - Second Brain 켜짐 (Property 1)", () => {
  it("SB 켜짐 → 도구 목록에 SB 도구 8개가 모두 포함된다", () => {
    const names = getEnabledTools(true).map((t) => t.name);
    for (const name of SECOND_BRAIN_TOOLS) {
      expect(names).toContain(name);
    }
  });

  it("SB 켜짐 → TOOLS 전체와 개수가 같다", () => {
    expect(getEnabledTools(true)).toHaveLength(TOOLS.length);
  });
});

// --- Property 2: Isolation ---

describe("buildSystemPrompt - Second Brain 꺼짐 (Property 2)", () => {
  it("SB 꺼짐 → second-brain 스킬이 프롬프트에 포함되지 않는다", () => {
    const prompt = buildSystemPrompt(settingsWith({}));

    expect(prompt).not.toContain(SKILL_TAG);
  });

  it("SB 꺼짐 + 수동 토글로 켜둔 경우 → 강제 활성 경로는 그대로 유지된다", () => {
    // 설정 화면의 수동 토글은 SB 를 껐을 때도 스킬만 켜는 용도로 남아 있어야 한다.
    const prompt = buildSystemPrompt(settingsWith({ enabledSkills: ["second-brain"] }));

    expect(prompt).toContain(SKILL_TAG);
  });
});

describe("getEnabledTools - Second Brain 꺼짐 (Property 2)", () => {
  it("SB 꺼짐 → 도구 목록에서 SB 도구 8개가 모두 제외된다", () => {
    const names = getEnabledTools(false).map((t) => t.name);
    for (const name of SECOND_BRAIN_TOOLS) {
      expect(names).not.toContain(name);
    }
  });

  it("SB 꺼짐 → 기본 볼트 도구는 그대로 남는다", () => {
    const names = getEnabledTools(false).map((t) => t.name);
    for (const name of ["search_vault", "read_note", "create_note", "edit_note", "list_files"]) {
      expect(names).toContain(name);
    }
  });

  it("SB 꺼짐 → 정확히 8개만 줄어든다", () => {
    expect(getEnabledTools(false)).toHaveLength(TOOLS.length - 8);
  });
});

// --- Property 3: Immutability ---

describe("buildSystemPrompt - 설정 불변성 (Property 3)", () => {
  it("SB 켜짐 자동 주입이 settings.enabledSkills 원본 배열을 변형하지 않는다", () => {
    // 원본을 push 로 변형하면 설정이 저장될 때 second-brain 이 박혀,
    // 나중에 SB 를 껐을 때도 스킬이 남는다.
    const enabledSkills: string[] = [];
    const settings = settingsWith({
      enabledSkills,
      secondBrain: { ...DEFAULT_SETTINGS.secondBrain, enabled: true },
    });

    buildSystemPrompt(settings);

    expect(enabledSkills).toEqual([]);
    expect(settings.enabledSkills).toEqual([]);
  });

  it("기존 항목이 있는 enabledSkills 도 변형되지 않는다", () => {
    const enabledSkills = ["korean-writing"];
    const settings = settingsWith({
      enabledSkills,
      secondBrain: { ...DEFAULT_SETTINGS.secondBrain, enabled: true },
    });

    buildSystemPrompt(settings);

    expect(enabledSkills).toEqual(["korean-writing"]);
  });

  it("SB 켜짐 상태로 여러 번 호출해도 결과가 동일하다(누적 없음)", () => {
    const settings = settingsWith({
      secondBrain: { ...DEFAULT_SETTINGS.secondBrain, enabled: true },
    });

    expect(buildSystemPrompt(settings)).toBe(buildSystemPrompt(settings));
  });

  it("getEnabledTools 가 TOOLS 원본 배열을 변형하지 않는다", () => {
    const before = TOOLS.length;

    getEnabledTools(false);
    getEnabledTools(true);

    expect(TOOLS).toHaveLength(before);
  });
});
