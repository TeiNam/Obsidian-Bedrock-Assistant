import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, type GeminiAssistantSettings } from "./types";
import { buildSystemPrompt } from "./system-prompt";
import { TOOLS, SECOND_BRAIN_TOOLS, getEnabledTools } from "./obsidian-tools";
import { VIEW_I18N } from "./chat-view-i18n";

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

// --- Property 4: 명령 팔레트 레이블 i18n ---
//
// main.ts 의 addCommand({ name }) 13개가 한국어로 하드코딩돼 있었다. 그중 11개는
// Second Brain 기능이고 대응 버튼이 UI 에 없어 명령 팔레트가 유일한 진입점이다.
// README 를 en/ko/ja 3종으로 배포하는 플러그인에서 그 11개는 비한국어 사용자에게
// 사실상 미출시 상태였다. 아래 테스트는 세 언어가 같은 키 집합을 갖는지, ko 값이
// 기존 리터럴과 글자 그대로 같은지(핫키를 걸어둔 기존 사용자의 검색 습관 보존),
// 그리고 어떤 언어에도 undefined 가 새지 않는지를 고정한다.

/**
 * 명령 팔레트 레이블 13키 + 비활성 안내 1키.
 *
 * `indexVault` 는 채팅 뷰 상단 인덱싱 버튼 툴팁으로 이미 en/ko/ja 3개 언어가
 * 완비돼 있고 값도 명령 이름과 완전히 같으므로 새 키를 만들지 않고 재사용한다.
 */
const COMMAND_LABEL_KEYS = [
  "cmdOpenAssistant",
  "indexVault",
  "cmdCreateWikiNote",
  "cmdUpdateIndex",
  "cmdSynthesize",
  "cmdReconcile",
  "cmdChallenge",
  "cmdConnect",
  "cmdEmerge",
  "cmdArchitect",
  "cmdKnowledgeGaps",
  "cmdReviewQueue",
  "cmdRunScheduler",
  "sbDisabled",
] as const;

/**
 * 명령 팔레트에서 모달로 이어지는 입력 UI 문자열(제출 버튼·필드 레이블·플레이스홀더).
 * SecondBrainInputModal 은 title/submitLabel/field.label 을 옵션으로 받으므로 모달
 * 코드는 그대로 두고 같은 테이블에서 값만 주입한다.
 */
const MODAL_LABEL_KEYS = [
  "sbSubmitCreate",
  "sbSubmitSynthesize",
  "sbSubmitReconcile",
  "sbSubmitChallenge",
  "sbSubmitConnect",
  "sbSubmitEmerge",
  "sbSubmitArchitect",
  "sbFieldTitle",
  "sbFieldBody",
  "sbFieldTopic",
  "sbFieldClaim",
  "sbFieldTopicA",
  "sbFieldTopicB",
  "sbFieldDays",
  "sbFieldPath",
  "sbPhTitle",
  "sbPhBody",
  "sbPhSynthesizeTopic",
  "sbPhReconcileTopic",
  "sbPhClaim",
  "sbPhTopicA",
  "sbPhTopicB",
  "sbPhPath",
] as const;

describe("VIEW_I18N 명령 팔레트 레이블 (Property 4)", () => {
  it("en/ko/ja 모두 명령 레이블 13키와 sbDisabled 를 비어 있지 않은 문자열로 보유한다", () => {
    for (const lang of ["en", "ko", "ja"] as const) {
      const t = VIEW_I18N[lang] as Record<string, unknown>;
      expect(t, `VIEW_I18N[${lang}] 존재`).toBeTruthy();
      for (const key of COMMAND_LABEL_KEYS) {
        expect(typeof t[key], `VIEW_I18N[${lang}].${key} 타입`).toBe("string");
        expect((t[key] as string).trim().length, `VIEW_I18N[${lang}].${key} 비어있지 않음`)
          .toBeGreaterThan(0);
      }
    }
  });

  it("en/ko/ja 모두 모달 입력 UI 키를 비어 있지 않은 문자열로 보유한다", () => {
    for (const lang of ["en", "ko", "ja"] as const) {
      const t = VIEW_I18N[lang] as Record<string, unknown>;
      for (const key of MODAL_LABEL_KEYS) {
        expect(typeof t[key], `VIEW_I18N[${lang}].${key} 타입`).toBe("string");
        expect((t[key] as string).trim().length, `VIEW_I18N[${lang}].${key} 비어있지 않음`)
          .toBeGreaterThan(0);
      }
    }
  });

  it("ko 레이블이 기존 하드코딩 리터럴과 글자 그대로 일치한다(기존 사용자 회귀 방지)", () => {
    // 기존 main.ts 의 addCommand({ name }) 값을 그대로 하드코딩해 둔다. 명령 ID 는
    // 핫키에 묶여 있고 이름은 사용자가 팔레트에서 외워 검색하므로 둘 다 불변이어야 한다.
    const ko = VIEW_I18N.ko as Record<string, string>;
    expect(ko.cmdOpenAssistant).toBe("어시스턴트 열기");
    expect(ko.indexVault).toBe("볼트 인덱싱");
    expect(ko.cmdCreateWikiNote).toBe("위키 노트 생성");
    expect(ko.cmdUpdateIndex).toBe("위키 인덱스 갱신");
    expect(ko.cmdSynthesize).toBe("주제 종합 (synthesize)");
    expect(ko.cmdReconcile).toBe("모순 점검 (reconcile)");
    expect(ko.cmdChallenge).toBe("주장 반박 (challenge)");
    expect(ko.cmdConnect).toBe("두 주제 연결 (connect)");
    expect(ko.cmdEmerge).toBe("최근 패턴 발견 (emerge)");
    expect(ko.cmdArchitect).toBe("코드베이스 아키텍트 (architect)");
    expect(ko.cmdKnowledgeGaps).toBe("지식 공백 리포트 갱신");
    expect(ko.cmdReviewQueue).toBe("복습 큐 (다시 볼 노트)");
    expect(ko.cmdRunScheduler).toBe("Second Brain 정리 실행 (스케줄러)");
    // 3곳에 중복돼 있던 비활성 안내를 한 키로 통일한다. 문장은 기존 그대로 유지한다.
    expect(ko.sbDisabled).toBe(
      "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요."
    );
  });

  it("ko 모달 리터럴이 기존 하드코딩 값과 글자 그대로 일치한다", () => {
    const ko = VIEW_I18N.ko as Record<string, string>;
    expect(ko.sbSubmitCreate).toBe("생성");
    expect(ko.sbSubmitSynthesize).toBe("종합");
    expect(ko.sbSubmitReconcile).toBe("점검");
    expect(ko.sbSubmitChallenge).toBe("반박");
    expect(ko.sbSubmitConnect).toBe("연결");
    expect(ko.sbSubmitEmerge).toBe("발견");
    expect(ko.sbSubmitArchitect).toBe("분석");
    expect(ko.sbFieldTitle).toBe("제목");
    expect(ko.sbFieldBody).toBe("본문");
    expect(ko.sbFieldTopic).toBe("주제");
    expect(ko.sbFieldClaim).toBe("주장");
    expect(ko.sbFieldTopicA).toBe("주제 A");
    expect(ko.sbFieldTopicB).toBe("주제 B");
    expect(ko.sbFieldDays).toBe("최근 일수");
    expect(ko.sbFieldPath).toBe("스캔 경로 (비우면 볼트 전체)");
    expect(ko.sbPhTitle).toBe("노트 제목");
    expect(ko.sbPhBody).toBe("노트 본문");
    expect(ko.sbPhSynthesizeTopic).toBe("종합할 주제/태그");
    expect(ko.sbPhReconcileTopic).toBe("모순을 점검할 주제");
    expect(ko.sbPhClaim).toBe("검토(반박)할 주장");
    expect(ko.sbPhTopicA).toBe("첫 번째 주제");
    expect(ko.sbPhTopicB).toBe("두 번째 주제");
    expect(ko.sbPhPath).toBe("예: src");
  });

  it("en 레이블은 도구명을 그대로 노출한다(문서에서 본 이름으로 검색 가능)", () => {
    // README/문서가 쓰는 도구명과 팔레트 레이블이 어긋나면 검색으로 찾지 못한다.
    const en = VIEW_I18N.en as Record<string, string>;
    expect(en.cmdOpenAssistant).toBe("Open assistant");
    expect(en.indexVault).toBe("Index vault");
    expect(en.cmdCreateWikiNote).toBe("Create wiki note");
    expect(en.cmdUpdateIndex).toBe("Update wiki index");
    expect(en.cmdSynthesize).toBe("Synthesize topic");
    expect(en.cmdReconcile).toBe("Reconcile contradictions");
    expect(en.cmdChallenge).toBe("Challenge a claim");
    expect(en.cmdConnect).toBe("Connect two topics");
    expect(en.cmdEmerge).toBe("Emerge recent patterns");
    expect(en.cmdArchitect).toBe("Codebase architect");
    expect(en.cmdKnowledgeGaps).toBe("Knowledge gap report");
    expect(en.cmdReviewQueue).toBe("Review queue");
    expect(en.cmdRunScheduler).toBe("Run Second Brain cleanup");
  });

  it("세 언어의 어떤 키에도 undefined 가 없다(팔레트에 undefined 노출 방지)", () => {
    // 세 블록을 손으로 채우다 한 언어를 빠뜨리면 Obsidian 팔레트에 "undefined"가
    // 그대로 뜬다. en 을 키 정본으로 삼아 ko/ja 의 누락을 전수 검사한다.
    const enKeys = Object.keys(VIEW_I18N.en);
    for (const lang of ["en", "ko", "ja"] as const) {
      const t = VIEW_I18N[lang] as Record<string, unknown>;
      for (const key of enKeys) {
        expect(t[key], `VIEW_I18N[${lang}].${key} 정의됨`).toBeDefined();
      }
    }
  });
});
