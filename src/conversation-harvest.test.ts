import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import {
  buildHarvestPrompt,
  buildHarvestNote,
  harvestSession,
  buildHarvestNotePath,
  sanitizeTitleForFilename,
  serializeConversation,
  HARVEST_MAX_CHARS,
  HARVEST_SUBFOLDER,
} from "./conversation-harvest";
import type { ChatSession } from "./types";

// ============================================
// 대화 결론 수확 (Conversation Harvest) 테스트
// ============================================
// 배경(2-way 리뷰에서 근거 정정):
//  - 대화를 볼트로 내보내는 수단은 이미 있다(chat-view.ts exportChat). 다만 그것은
//    원문 전량 덤프라 잡담·시행착오·중간 오류까지 인덱싱되어 RAG 근거가 된다.
//  - 실제 손실은 main.ts의 `if (sessions.length > 50) sessions.length = 50;`이다.
//    51번째 세션이 저장되면 가장 오래된 세션이 조용히 소멸하고, 내보내기를 누르지
//    않았다면 그 대화의 결론은 영구 손실된다.
//
// 따라서 이 기능은 "내보내기"가 아니라 "결론만 추출"이어야 한다.

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1700000000000",
    title: "Bedrock 인증 방식 결정",
    createdAt: 1700000000000,
    updatedAt: 1700000600000,
    messages: [
      { role: "user", content: "Bedrock 인증을 어떻게 할까?", timestamp: 1700000000000 },
      { role: "assistant", content: "액세스 키, API 키, 프로필 셋을 지원하자.", timestamp: 1700000100000 },
    ],
    ...overrides,
  };
}

describe("sanitizeTitleForFilename: 파일명 안전화", () => {
  it("경로 구분자와 금지 문자를 제거한다", () => {
    // 제목이 LLM/사용자 입력에서 오므로 경로 탈출·금지 문자를 막아야 한다.
    expect(sanitizeTitleForFilename("a/b\\c")).toBe("a-b-c");
    expect(sanitizeTitleForFilename('제목:"*?<>|')).toBe("제목");
  });

  it("상위 경로 참조를 무해화한다", () => {
    const result = sanitizeTitleForFilename("../../etc/passwd");
    expect(result).not.toContain("..");
    expect(result).not.toContain("/");
  });

  it("앞뒤 공백과 점을 제거한다", () => {
    // 끝의 점은 Windows에서 파일 생성이 실패한다.
    expect(sanitizeTitleForFilename("  제목...  ")).toBe("제목");
  });

  it("비어 있거나 전부 금지 문자면 대체 이름을 반환한다", () => {
    expect(sanitizeTitleForFilename("")).toBe("Untitled");
    expect(sanitizeTitleForFilename("///")).toBe("Untitled");
    expect(sanitizeTitleForFilename("   ")).toBe("Untitled");
  });

  it("긴 제목을 잘라낸다", () => {
    const result = sanitizeTitleForFilename("가".repeat(200));
    expect(result.length).toBeLessThanOrEqual(80);
  });
});

describe("buildHarvestNotePath: 저장 경로", () => {
  it("위키 폴더 하위 Conversations 폴더에 날짜+제목으로 저장한다", () => {
    const path = buildHarvestNotePath("Second Brain", "Bedrock 인증", new Date(2026, 6, 28));
    expect(path).toBe(`Second Brain/${HARVEST_SUBFOLDER}/2026-07-28 Bedrock 인증.md`);
  });

  it("제목의 경로 구분자가 폴더를 만들지 않는다", () => {
    const path = buildHarvestNotePath("Second Brain", "a/b", new Date(2026, 6, 28));
    // Conversations 아래 단일 파일이어야 한다(하위 폴더 생성 금지).
    const rel = path.slice(`Second Brain/${HARVEST_SUBFOLDER}/`.length);
    expect(rel).not.toContain("/");
  });

  it("볼트 이탈을 시도하는 제목도 위키 폴더 안에 머문다", () => {
    const path = buildHarvestNotePath("Second Brain", "../../../evil", new Date(2026, 6, 28));
    expect(path.startsWith("Second Brain/")).toBe(true);
    expect(path).not.toContain("..");
  });
});

describe("serializeConversation: LLM 입력 직렬화", () => {
  it("역할 라벨과 함께 순서대로 직렬화한다", () => {
    const result = serializeConversation(makeSession().messages);
    expect(result).toContain("User: Bedrock 인증을 어떻게 할까?");
    expect(result).toContain("Assistant: 액세스 키, API 키, 프로필 셋을 지원하자.");
    // 순서가 뒤바뀌면 대화 맥락이 깨진다.
    expect(result.indexOf("User:")).toBeLessThan(result.indexOf("Assistant:"));
  });

  it("상한을 넘는 대화는 뒤쪽(최신)을 남기고 앞을 잘라낸다", () => {
    // 결론은 대화 끝에 나오므로 앞을 버려야 한다.
    const messages = Array.from({ length: 200 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `메시지 ${i} ${"가".repeat(200)}`,
      timestamp: 1700000000000 + i,
    }));

    const result = serializeConversation(messages);
    expect(result.length).toBeLessThanOrEqual(HARVEST_MAX_CHARS);
    // 마지막 메시지는 반드시 남아야 한다.
    expect(result).toContain("메시지 199");
    expect(result).not.toContain("메시지 0 ");
  });

  it("빈 메시지 목록은 빈 문자열을 반환한다", () => {
    expect(serializeConversation([])).toBe("");
  });
});

describe("buildHarvestPrompt: 결론 추출 프롬프트", () => {
  it("결론·결정·근거·미해결 질문을 요구한다", () => {
    const prompt = buildHarvestPrompt(makeSession(), "ko");
    // 이 네 항목이 원문 덤프와 수확을 구분하는 핵심이다.
    expect(prompt).toContain("Conclusions");
    expect(prompt).toContain("Decisions");
    expect(prompt).toContain("Open questions");
  });

  it("대화 본문을 포함한다", () => {
    const prompt = buildHarvestPrompt(makeSession(), "ko");
    expect(prompt).toContain("Bedrock 인증을 어떻게 할까?");
  });

  it("근거 없는 내용을 만들지 말라고 지시한다", () => {
    // 수확 노트는 RAG 근거가 되므로 날조가 들어가면 오염이 전파된다.
    const prompt = buildHarvestPrompt(makeSession(), "ko").toLowerCase();
    expect(prompt).toContain("do not invent");
  });

  it("결론이 없는 대화는 그렇다고 말하도록 지시한다", () => {
    // 잡담 세션에서 억지 결론을 만들면 볼트가 오염된다.
    const prompt = buildHarvestPrompt(makeSession(), "ko");
    expect(prompt).toContain("no substantive conclusion");
  });

  it("언어 설정을 반영한다", () => {
    expect(buildHarvestPrompt(makeSession(), "ko")).toContain("한국어");
    expect(buildHarvestPrompt(makeSession(), "en")).toContain("English");
    expect(buildHarvestPrompt(makeSession(), "ja")).toContain("日本語");
  });

  it("알 수 없는 언어는 영어로 폴백한다", () => {
    expect(buildHarvestPrompt(makeSession(), "xx")).toContain("English");
  });
});

// ============================================
// harvestSession 실행 래퍼 테스트
// ============================================

const WIKI = "Second Brain";
const NOW = new Date(2026, 6, 28);

function makeHarvestEnv(opts: { existing?: string[]; respond?: () => string } = {}) {
  const existing = new Set(opts.existing ?? []);
  const created: Array<{ path: string; content: string }> = [];
  const folders: string[] = [];

  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => {
        if (!existing.has(p)) return null;
        const f = new TFile();
        f.path = p;
        return f;
      },
      create: vi.fn(async (path: string, content: string) => {
        created.push({ path, content });
        existing.add(path);
      }),
      createFolder: vi.fn(async (path: string) => {
        folders.push(path);
        existing.add(path);
      }),
    },
  } as never;

  const aiClient = {
    converseLight: vi.fn(async () => ({
      text: opts.respond ? opts.respond() : "### Conclusions\n- 인증은 셋을 지원한다.",
    })),
  } as never;

  return { app, aiClient, created, folders };
}

describe("harvestSession: 저장과 방어", () => {
  it("결론을 추출해 Conversations 폴더에 노트를 만든다", async () => {
    const env = makeHarvestEnv();
    const result = await harvestSession(
      { app: env.app, aiClient: env.aiClient, wikiFolder: WIKI, language: "ko", now: NOW },
      makeSession()
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe(`${WIKI}/Conversations/2026-07-28 Bedrock 인증 방식 결정.md`);
    expect(env.created).toHaveLength(1);
    expect(env.created[0].content).toContain("인증은 셋을 지원한다.");
  });

  it("원본 대화를 노트에 넣지 않는다", async () => {
    // 원문을 인덱싱하면 잡담·시행착오가 RAG 근거가 된다.
    const env = makeHarvestEnv();
    await harvestSession(
      { app: env.app, aiClient: env.aiClient, wikiFolder: WIKI, language: "ko", now: NOW },
      makeSession()
    );
    expect(env.created[0].content).not.toContain("Bedrock 인증을 어떻게 할까?");
  });

  it("추적용 frontmatter에 원본 세션 ID를 남긴다", async () => {
    const env = makeHarvestEnv();
    await harvestSession(
      { app: env.app, aiClient: env.aiClient, wikiFolder: WIKI, language: "ko", now: NOW },
      makeSession()
    );
    expect(env.created[0].content).toContain("source_session: session-1700000000000");
    expect(env.created[0].content).toContain("type: conversation-harvest");
  });

  it("같은 경로에 노트가 이미 있으면 덮어쓰지 않는다", async () => {
    // 사용자가 손으로 덧붙였을 수 있으므로 조용히 지워서는 안 된다.
    const path = `${WIKI}/Conversations/2026-07-28 Bedrock 인증 방식 결정.md`;
    const env = makeHarvestEnv({ existing: [path] });

    const result = await harvestSession(
      { app: env.app, aiClient: env.aiClient, wikiFolder: WIKI, language: "ko", now: NOW },
      makeSession()
    );

    expect(result.success).toBe(false);
    expect(env.created).toHaveLength(0);
    // 중복 판정은 LLM 호출 전에 해야 비용이 낭비되지 않는다.
    expect(env.aiClient.converseLight).not.toHaveBeenCalled();
  });

  it("빈 세션은 LLM을 호출하지 않는다", async () => {
    const env = makeHarvestEnv();
    const result = await harvestSession(
      { app: env.app, aiClient: env.aiClient, wikiFolder: WIKI, language: "ko", now: NOW },
      makeSession({ messages: [] })
    );

    expect(result.success).toBe(false);
    expect(env.aiClient.converseLight).not.toHaveBeenCalled();
  });

  it("LLM 응답이 비면 노트를 만들지 않는다", async () => {
    // 빈 노트는 인덱스에 잡음만 늘린다.
    const env = makeHarvestEnv({ respond: () => "   " });
    const result = await harvestSession(
      { app: env.app, aiClient: env.aiClient, wikiFolder: WIKI, language: "ko", now: NOW },
      makeSession()
    );

    expect(result.success).toBe(false);
    expect(env.created).toHaveLength(0);
  });

  it("LLM 호출 실패를 메시지로 보고한다", async () => {
    const env = makeHarvestEnv();
    env.aiClient.converseLight = vi.fn(async () => {
      throw new Error("ThrottlingException");
    });

    const result = await harvestSession(
      { app: env.app, aiClient: env.aiClient, wikiFolder: WIKI, language: "ko", now: NOW },
      makeSession()
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("ThrottlingException");
    expect(env.created).toHaveLength(0);
  });

  it("부모 폴더가 없으면 만들고 저장한다", async () => {
    const env = makeHarvestEnv();
    await harvestSession(
      { app: env.app, aiClient: env.aiClient, wikiFolder: WIKI, language: "ko", now: NOW },
      makeSession()
    );
    expect(env.folders).toContain(WIKI);
    expect(env.folders).toContain(`${WIKI}/Conversations`);
  });

  it("볼트 이탈을 노리는 제목도 위키 폴더 안에 저장된다", async () => {
    const env = makeHarvestEnv();
    const result = await harvestSession(
      { app: env.app, aiClient: env.aiClient, wikiFolder: WIKI, language: "ko", now: NOW },
      makeSession({ title: "../../../../etc/passwd" })
    );

    expect(result.success).toBe(true);
    expect(result.path!.startsWith(`${WIKI}/Conversations/`)).toBe(true);
    expect(result.path).not.toContain("..");
  });
});

describe("buildHarvestNote: 노트 본문", () => {
  it("대화 날짜와 수확 날짜를 구분해 기록한다", () => {
    // 오래된 대화를 나중에 수확할 수 있으므로 두 날짜가 다르다.
    const session = makeSession({ updatedAt: new Date(2026, 0, 15).getTime() });
    const note = buildHarvestNote(session, "### Conclusions\n- x", NOW);

    expect(note).toContain("harvested: 2026-07-28");
    expect(note).toContain("conversation_date: 2026-01-15");
  });

  it("세션 제목을 h1으로 넣는다", () => {
    const note = buildHarvestNote(makeSession(), "### Conclusions\n- x", NOW);
    expect(note).toContain("# Bedrock 인증 방식 결정");
  });
});

describe("harvestSession: Second Brain 옵트인 격리", () => {
  it("기능이 비활성이면 LLM을 호출하지도, 노트를 만들지도 않는다", async () => {
    // 위키 폴더에 쓰는 다른 기능들과 동일한 격리를 따른다(Req 12.4).
    const env = makeHarvestEnv();
    const result = await harvestSession(
      {
        app: env.app,
        aiClient: env.aiClient,
        wikiFolder: WIKI,
        language: "ko",
        now: NOW,
        enabled: false,
      },
      makeSession()
    );

    expect(result.success).toBe(false);
    expect(env.aiClient.converseLight).not.toHaveBeenCalled();
    expect(env.created).toHaveLength(0);
    expect(env.folders).toHaveLength(0);
  });

  it("enabled를 생략하면 동작한다(호출부가 이미 확인한 경우)", async () => {
    const env = makeHarvestEnv();
    const result = await harvestSession(
      { app: env.app, aiClient: env.aiClient, wikiFolder: WIKI, language: "ko", now: NOW },
      makeSession()
    );
    expect(result.success).toBe(true);
  });
});
