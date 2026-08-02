import { describe, it, expect } from "vitest";
import { ToolExecutor } from "../obsidian-tools";
import type { VaultIndexer, GraphRagResult } from "../vault-indexer";

/**
 * search_vault → 검색 근거 그래프 전달 경로 테스트
 *
 * chat-view 는 `execute()` 의 **문자열**만 받는데 그래프는 GraphRagResult 가 필요하다.
 * 재검색은 답이 아니다 — indexer.search 는 쿼리 임베딩 API 를 호출하므로 그래프를
 * 그리려고 검색을 한 번 더 하면 요금과 지연이 두 배가 된다.
 *
 * 그래서 실행한 검색 결과를 executor 가 마지막 1건만 들고 있게 하고 뷰가 가져간다.
 * 이 테스트는 그 인수인계 계약을 고정한다 — 특히 **소비 후 비우기**가 중요하다.
 * 남겨두면 다음 턴의 다른 도구 호출에 지난 검색 그래프가 따라붙는다.
 */

function makeExecutor(result: GraphRagResult | Error): ToolExecutor {
  const fakeIndexer = {
    search: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as VaultIndexer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ToolExecutor({} as any, fakeIndexer, () => "templates");
}

const withNeighbor: GraphRagResult = {
  items: [
    {
      path: "a.md",
      title: "시드",
      excerpt: "본문",
      combinedScore: 0.9,
      vectorScore: 0.9,
      hop: 0,
      isSeed: true,
      seedPath: null,
    },
    {
      path: "n.md",
      title: "이웃",
      excerpt: "본문",
      combinedScore: 0.5,
      vectorScore: 0.4,
      hop: 1,
      isSeed: false,
      seedPath: "a.md",
      seedTitle: "시드",
    },
  ],
};

describe("takeLastSearchResult — 인수인계", () => {
  it("검색 전에는 null 이다", () => {
    expect(makeExecutor(withNeighbor).takeLastSearchResult()).toBeNull();
  });

  it("search_vault 실행 후 그 결과를 그대로 돌려준다", async () => {
    const executor = makeExecutor(withNeighbor);
    await executor.execute("search_vault", { query: "x" });
    const taken = executor.takeLastSearchResult();
    expect(taken?.items).toHaveLength(2);
    expect(taken?.items[1].seedPath).toBe("a.md");
  });

  it("한 번 가져가면 비워진다 — 다음 도구 호출에 지난 그래프가 따라붙지 않는다", async () => {
    const executor = makeExecutor(withNeighbor);
    await executor.execute("search_vault", { query: "x" });
    expect(executor.takeLastSearchResult()).not.toBeNull();
    // 두 번째 조회는 null 이어야 한다. 아니면 read_note 같은 무관한 도구 뒤에도
    // 검색 그래프가 붙는다.
    expect(executor.takeLastSearchResult()).toBeNull();
  });

  it("검색을 두 번 하면 마지막 결과만 남는다", async () => {
    const executor = makeExecutor(withNeighbor);
    await executor.execute("search_vault", { query: "첫번째" });
    await executor.execute("search_vault", { query: "두번째" });
    expect(executor.takeLastSearchResult()).not.toBeNull();
    expect(executor.takeLastSearchResult()).toBeNull();
  });

  it("검색 실패 시에는 결과를 남기지 않는다", async () => {
    const executor = makeExecutor(new Error("임베딩 실패"));
    const rendered = await executor.execute("search_vault", { query: "x" });
    expect(rendered).toContain("검색 실패");
    // 실패했는데 그래프가 붙으면 사용자가 실패를 성공으로 오독한다.
    expect(executor.takeLastSearchResult()).toBeNull();
  });

  it("빈 쿼리(invalidQuery)는 결과를 남기지 않는다", async () => {
    const executor = makeExecutor({ items: [], invalidQuery: true });
    await executor.execute("search_vault", { query: "  " });
    expect(executor.takeLastSearchResult()).toBeNull();
  });

  it("검색 결과 0건이면 결과를 남기지 않는다", async () => {
    const executor = makeExecutor({ items: [] });
    await executor.execute("search_vault", { query: "x" });
    // 빈 mermaid 블록은 파스 에러다. 애초에 뷰에 넘기지 않는다.
    expect(executor.takeLastSearchResult()).toBeNull();
  });

  it("검색이 아닌 도구는 결과를 남기지 않는다", async () => {
    const executor = makeExecutor(withNeighbor);
    await executor.execute("read_note", { path: "없는파일.md" });
    expect(executor.takeLastSearchResult()).toBeNull();
  });

  it("기존 렌더 문자열 동작을 바꾸지 않는다", async () => {
    // 인수인계를 추가하면서 도구 결과 문자열이 달라지면 LLM 이 받는 내용이 바뀐다.
    const executor = makeExecutor(withNeighbor);
    const rendered = await executor.execute("search_vault", { query: "x" });
    expect(rendered).toContain("검색 결과 (Graph RAG)");
    expect(rendered).toContain("[Seed]");
    expect(rendered).toContain("[Neighbor");
    // 그래프 마크다운이 LLM 에게 가는 문자열에 섞이면 토큰만 낭비한다.
    expect(rendered).not.toContain("```mermaid");
  });
});
