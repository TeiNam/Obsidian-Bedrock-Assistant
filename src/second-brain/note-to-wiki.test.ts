import { describe, it, expect } from "vitest";

import { buildNoteWikiPrompt, WIKI_SOURCE_LINK_PREFIX, appendSourceLink } from "./note-to-wiki";

// ============================================
// 현재 노트 → 위키 노트 프롬프트 구성 테스트
// ============================================
// 배경: create_wiki_note 에는 생성(generation) 경로가 없었다. 본문을 사람이 타이핑해야 했고,
// LLM 이 본문을 쓰는 경로는 synthesize(주제 검색 기반)·architect(폴더 스캔)·harvest(저장된
// 세션)뿐이라 "지금 보는 이 노트를 지식으로 승격"이 비어 있었다.

describe("buildNoteWikiPrompt", () => {
  it("제목과 본문을 모두 포함한다", () => {
    const prompt = buildNoteWikiPrompt("벡터 검색", "코사인 유사도를 쓴다.");
    expect(prompt).toContain("벡터 검색");
    expect(prompt).toContain("코사인 유사도를 쓴다.");
  });

  it("본문만 출력하고 프론트매터는 쓰지 말라고 지시한다", () => {
    // buildAiFirstNote 가 프론트매터를 직렬화하므로 LLM 이 또 쓰면 중복된다.
    const prompt = buildNoteWikiPrompt("주제", "본문");
    expect(prompt).toContain("프론트매터");
  });

  it("위키링크 규약을 지시한다", () => {
    const prompt = buildNoteWikiPrompt("주제", "본문");
    expect(prompt).toContain("[[");
  });

  it("근거 없는 단정을 금지한다", () => {
    // 원문에 없는 내용을 LLM 이 만들어내면 지식 베이스가 오염된다.
    const prompt = buildNoteWikiPrompt("주제", "본문");
    expect(prompt).toContain("근거");
  });

  it("본문이 비어도 안전하게 프롬프트를 만든다", () => {
    const prompt = buildNoteWikiPrompt("제목만 있는 노트", "");
    expect(prompt).toContain("제목만 있는 노트");
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("appendSourceLink", () => {
  it("본문 끝에 원본 노트 위키링크를 붙인다", () => {
    // 링크가 없으면 생성된 위키 노트가 outlink 0 으로 findOrphanNotes 에 고아로 잡혀
    // 플러그인이 자기 지식 공백 리포트를 채운다.
    const body = appendSourceLink("종합된 본문", "회의록 2026-08-02");
    expect(body).toContain("[[회의록 2026-08-02]]");
    expect(body.startsWith("종합된 본문")).toBe(true);
  });

  it("이미 원본 링크가 있으면 중복해서 붙이지 않는다", () => {
    // LLM 이 지침을 따라 스스로 출처를 적는 경우가 있다.
    const withLink = `본문\n\n${WIKI_SOURCE_LINK_PREFIX} [[원본]]`;
    expect(appendSourceLink(withLink, "원본")).toBe(withLink);
  });

  it("다른 노트를 가리키는 링크가 있으면 원본 링크를 따로 붙인다", () => {
    const body = appendSourceLink("본문 [[다른 노트]] 참조", "원본");
    expect(body).toContain("[[원본]]");
    expect(body).toContain("[[다른 노트]]");
  });

  it("본문 끝 공백을 정리해 링크가 붙는다", () => {
    const body = appendSourceLink("본문\n\n\n", "원본");
    expect(body).toBe(`본문\n\n${WIKI_SOURCE_LINK_PREFIX} [[원본]]`);
  });

  it("본문이 비어도 링크만 남긴다", () => {
    expect(appendSourceLink("", "원본")).toBe(`${WIKI_SOURCE_LINK_PREFIX} [[원본]]`);
  });
});
