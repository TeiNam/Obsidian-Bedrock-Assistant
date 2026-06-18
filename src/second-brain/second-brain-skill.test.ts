// Second_Brain_Skill 프롬프트 주입 단위 테스트
// =================================================
// buildSkillsPrompt가 활성 스킬 ID에 "second-brain"이 포함되면 스킬 본문을 포함하고,
// 포함되지 않으면 제외함을 검증한다(Req 5.2, 5.3). 또한 SECOND_BRAIN_SKILL 본문이
// 백엔드별 표시 이름("Bedrock Assistant"/"Gemini Assistant" 등)을 정적으로 보간하지
// 않는 "브랜딩 무관" 규약을 지키는지 검증한다(Req 5.4).
//
// 주의: SECOND_BRAIN_SKILL 상수는 export 되지 않으므로 SKILLS 배열에서
// id === "second-brain" 항목으로 접근한다.

import { describe, it, expect } from "vitest";
import { SKILLS, buildSkillsPrompt, type Skill } from "../skills";

// SKILLS 배열에서 second-brain 스킬 항목을 찾는다.
const secondBrain: Skill | undefined = SKILLS.find((s) => s.id === "second-brain");

// 다른 스킬에는 등장하지 않는, second-brain 스킬 본문만의 distinctive 구절.
// (스킬 본문 헤더 + AI-first 안내 문구에서 유래)
const DISTINCTIVE_PHRASES = [
  "# Second Brain (LLM Wiki)",
  "능동적으로 정리·진화시키는",
  '"## For future AI" 프리앰블',
] as const;

// (Req 5.4) 본문에 정적으로 보간되어서는 안 되는 백엔드/에디션 표시 이름.
const FORBIDDEN_BRANDING_TERMS = [
  "Bedrock Assistant",
  "Gemini Assistant",
  "Assistant Kiro",
  "Bedrock",
  "Gemini",
  "OpenAI",
  "Ollama",
  "Anthropic",
] as const;

describe("Second_Brain_Skill 등록", () => {
  it("SKILLS 목록에 비-내장(builtin:false) second-brain 스킬이 존재한다 (Req 5.1)", () => {
    expect(secondBrain).toBeDefined();
    expect(secondBrain?.builtin).toBe(false);
    // 본문에 핵심 규약 구절이 담겨 있다.
    expect(secondBrain?.content).toContain("AI-first");
    expect(secondBrain?.content).toContain("wikilink");
  });
});

describe("buildSkillsPrompt 포함/제외 (Req 5.2, 5.3)", () => {
  it("활성 ID에 'second-brain'이 포함되면 스킬 본문을 포함한다 (Req 5.2)", () => {
    expect(secondBrain).toBeDefined();
    const prompt = buildSkillsPrompt(["second-brain"]);

    // 스킬 래퍼 태그와 본문 전체가 그대로 포함되어야 한다.
    expect(prompt).toContain('<skill name="second-brain">');
    expect(prompt).toContain(secondBrain!.content);
    for (const phrase of DISTINCTIVE_PHRASES) {
      expect(prompt).toContain(phrase);
    }
  });

  it("활성 ID에 'second-brain'이 없으면 스킬 본문을 제외한다 (Req 5.3)", () => {
    // builtin 스킬은 항상 포함되지만 second-brain은 builtin:false 이므로 제외되어야 한다.
    const prompt = buildSkillsPrompt([]);

    expect(prompt).not.toContain('<skill name="second-brain">');
    for (const phrase of DISTINCTIVE_PHRASES) {
      expect(prompt).not.toContain(phrase);
    }
  });

  it("다른 비-내장 스킬만 활성화해도 second-brain 본문은 제외된다 (Req 5.3)", () => {
    // korean-writing(비-내장)만 활성화 — second-brain은 여전히 제외되어야 한다.
    const prompt = buildSkillsPrompt(["korean-writing"]);

    expect(prompt).not.toContain('<skill name="second-brain">');
    for (const phrase of DISTINCTIVE_PHRASES) {
      expect(prompt).not.toContain(phrase);
    }
  });
});

describe("Second_Brain_Skill 브랜딩 무관 (Req 5.4)", () => {
  it("스킬 본문에 백엔드/에디션 표시 이름이 정적으로 보간되어 있지 않다", () => {
    expect(secondBrain).toBeDefined();
    const content = secondBrain!.content;

    for (const term of FORBIDDEN_BRANDING_TERMS) {
      expect(content).not.toContain(term);
    }
  });

  it("백엔드 무관한 표현('이 플러그인의 Second Brain 기능')을 사용한다", () => {
    expect(secondBrain).toBeDefined();
    // 특정 백엔드 이름 대신 중립적 주체 표현을 쓰는지 확인한다.
    expect(secondBrain!.content).toContain("이 플러그인의 Second Brain 기능");
  });
});
