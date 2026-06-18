// 종합(synthesize) 속성 테스트 (Synthesize — Property-Based Tests)
// ====================================================================
// buildSynthesisPrompt가 임의의 주제와 검색 히트 목록에 대해 모든 히트의 제목을
// 출력에 포함하는지 fast-check 속성 테스트로 검증한다(Property 14, Req 7.3).
// (runSynthesize 실행 단위 테스트는 Task 6.3에서 본 파일에 추가된다.)

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { buildSynthesisPrompt, runSynthesize } from "./synthesize";
import type { SearchHit } from "./search-adapter";
import type { SecondBrainContext } from "./scheduler";
import type { GraphRagResult, GraphRagSearchItem, VaultIndexer } from "../vault-indexer";
import type { IAiClient } from "../types";

// 임의의 SearchHit 제너레이터 — path/title/excerpt를 자유 문자열로 채워
// 다양한 입력(빈 문자열, 유니코드, 특수문자 등)에서 제목 포함 보장을 자극한다.
const hitArb: fc.Arbitrary<SearchHit> = fc.record({
  path: fc.string(),
  title: fc.string(),
  excerpt: fc.string(),
});

// SearchHit 목록 제너레이터 (빈 목록 포함, 입력 공간을 합리적 크기로 제한).
const hitsArb: fc.Arbitrary<SearchHit[]> = fc.array(hitArb, { maxLength: 30 });

describe("buildSynthesisPrompt — Property 14", () => {
  // Feature: second-brain-layer, Property 14: 종합 프롬프트는 모든 검색 히트를 포함한다
  it("임의의 주제와 검색 히트에 대해 모든 히트의 제목을 출력에 포함한다", () => {
    fc.assert(
      fc.property(fc.string(), hitsArb, (topic, hits) => {
        const prompt = buildSynthesisPrompt(topic, hits);
        // 각 히트의 제목이 종합 프롬프트 출력에 그대로 포함되어야 한다.
        for (const hit of hits) {
          expect(prompt.includes(hit.title)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// runSynthesize 실행 단위 테스트 (Synthesize — Unit Tests, Task 6.3)
// ====================================================================
// 모킹한 search(GraphRagResult) + IAiClient(converseLight) + Vault 스파이로 다음을 검증한다.
// - 검색 히트가 있으면 vault.create로 AI_First_Note를 생성하며, 그 본문이 종합 결과를
//   Block_Key 'synthesis'의 Sentinel_Block으로 감싼다(Req 7.4). 또한 종합을 위해
//   indexer.search로 관련 노트를 모은다(Req 7.2).
// - 검색이 0건이면(hasNoHits) 노트를 생성하지 않고 안내 메시지만 반환한다(Req 7.6).
//
// LLM 호출은 고정 응답 스텁(converseLight → { text })으로 대체하고, Vault API는
// vi.fn() 스파이로 감싸 호출 여부와 전달 인자를 단언한다.

/** 종합 대상 노트 경로를 둘 Wiki_Folder (정규화 스텁은 경로를 그대로 반환). */
const WIKI = "Second Brain";

/** 검색 결과의 GraphRagSearchItem을 간단히 만드는 헬퍼(점수·hop은 검증에 불필요한 더미값). */
function makeItem(path: string, title: string, excerpt: string): GraphRagSearchItem {
  return {
    path,
    title,
    excerpt,
    combinedScore: 0.9,
    vectorScore: 0.9,
    hop: 0,
    isSeed: true,
    seedPath: null,
  };
}

/** create/modify/read/createFolder/getAbstractFileByPath를 vi.fn() 스파이로 감싼 모킹 Vault. */
function makeMockVault() {
  return {
    // 신규 노트 경로로 진입시키기 위해 기본적으로 대상 파일이 없다고 응답한다.
    getAbstractFileByPath: vi.fn(() => null),
    create: vi.fn(async () => undefined),
    modify: vi.fn(async () => undefined),
    read: vi.fn(async () => ""),
    createFolder: vi.fn(async () => undefined),
    getMarkdownFiles: vi.fn(() => []),
    cachedRead: vi.fn(async () => ""),
  };
}

/**
 * SecondBrainContext 테스트 더블 구성.
 * @param searchResult indexer.search가 반환할 GraphRagResult
 * @param llmText converseLight가 반환할 고정 종합 본문
 */
function makeContext(searchResult: GraphRagResult, llmText: string) {
  const vault = makeMockVault();

  const search = vi.fn(async () => searchResult);
  const indexer = { search } as unknown as VaultIndexer;

  const converseLight = vi.fn(async () => ({ text: llmText }));
  const aiClient = { converseLight } as unknown as IAiClient;

  const ctx: SecondBrainContext = {
    app: { vault } as unknown as SecondBrainContext["app"],
    indexer,
    aiClient,
    settings: { enabled: true } as unknown as SecondBrainContext["settings"],
    wikiFolder: WIKI,
    persist: vi.fn(async () => undefined),
  };

  return { ctx, vault, search, converseLight };
}

describe("runSynthesize — 실행 단위 테스트 (Req 7.2, 7.4, 7.6)", () => {
  it("검색 히트가 있으면 종합 본문을 synthesis 센티넬 블록으로 감싼 AI-first 노트를 생성한다 (Req 7.2, 7.4)", async () => {
    const searchResult: GraphRagResult = {
      items: [
        makeItem("Second Brain/concepts/Alpha.md", "Alpha", "알파에 대한 발췌"),
        makeItem("Second Brain/concepts/Beta.md", "Beta", "베타에 대한 발췌"),
      ],
    };
    const llmText = "종합 본문";
    const { ctx, vault, search, converseLight } = makeContext(searchResult, llmText);

    const message = await runSynthesize(ctx, "주제");

    // Req 7.2: 관련 노트 수집에 기존 indexer.search를 사용한다.
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("주제");

    // 단발 LLM 호출(converseLight)로 종합 결과를 받는다.
    expect(converseLight).toHaveBeenCalledTimes(1);

    // 신규 노트는 vault.create로 작성된다(modify 아님).
    expect(vault.create).toHaveBeenCalledTimes(1);
    expect(vault.modify).not.toHaveBeenCalled();

    const [createdPath, createdContent] = vault.create.mock.calls[0] as [string, string];
    expect(createdPath).toBe(`${WIKI}/주제.md`);

    // AI-first 규격: 프론트매터(title) + "## For future AI" 프리앰블을 포함한다.
    expect(createdContent).toContain('title: "주제"');
    expect(createdContent).toContain("## For future AI");

    // Req 7.4: 종합 본문이 Block_Key 'synthesis' 센티넬 블록으로 감싸진다.
    expect(createdContent).toContain("<!-- @generated:synthesis -->");
    expect(createdContent).toContain("<!-- @end:synthesis -->");
    expect(createdContent).toContain(llmText);

    // 종합 본문은 시작/종료 마커 사이에 위치한다(감싸기 검증).
    const startIdx = createdContent.indexOf("<!-- @generated:synthesis -->");
    const bodyIdx = createdContent.indexOf(llmText);
    const endIdx = createdContent.indexOf("<!-- @end:synthesis -->");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(endIdx);

    // 성공 시 생성 경로를 안내한다.
    expect(message).toContain(`${WIKI}/주제.md`);
  });

  it("검색 결과가 0건이면(hasNoHits) 노트를 생성하지 않고 안내 메시지만 반환한다 (Req 7.6)", async () => {
    const searchResult: GraphRagResult = { items: [] };
    const { ctx, vault, search, converseLight } = makeContext(searchResult, "종합 본문");

    const message = await runSynthesize(ctx, "없는 주제");

    // Req 7.2: 0건 판정을 위해서도 search는 사용된다.
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("없는 주제");

    // Req 7.6: LLM 호출도, 노트 생성/수정도 일어나지 않는다.
    expect(converseLight).not.toHaveBeenCalled();
    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.modify).not.toHaveBeenCalled();

    // 관련 노트가 없어 종합 노트를 만들지 않았음을 안내한다.
    expect(message).toContain("관련된 노트를 찾지 못해");
  });
});
