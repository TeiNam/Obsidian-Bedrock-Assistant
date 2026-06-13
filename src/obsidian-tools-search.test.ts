import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ToolExecutor } from "./obsidian-tools";
import type { VaultIndexer, GraphRagResult, GraphRagSearchItem } from "./vault-indexer";

/**
 * Graph_RAG_Search 결과 렌더링 속성 테스트
 *
 * searchVault()는 private 이므로 공개 API execute("search_vault", ...)를 통해 구동한다.
 * VaultIndexer.search()가 생성된 GraphRagResult를 반환하도록 가짜 인덱서를 주입한다.
 *
 * Validates: Requirements 7.2, 7.3, 7.4
 */

// 영숫자 문자열 생성기 — 렌더링 포맷(라벨/구두점)과의 충돌을 피하기 위해
// 제목/경로/발췌를 영숫자로 제한하여 substring 단언을 견고하게 한다.
const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

function alnum(minLength: number, maxLength: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...ALNUM), { minLength, maxLength })
    .map((chars) => chars.join(""));
}

// 단일 GraphRagSearchItem 생성기 (시드/이웃 혼합 생성)
const itemArb: fc.Arbitrary<GraphRagSearchItem> = fc
  .record({
    path: alnum(1, 20).map((s) => `folder/${s}.md`),
    title: alnum(1, 20),
    // 발췌는 500자 초과 케이스도 포함하도록 최대 600자까지 생성
    excerpt: alnum(0, 600),
    combinedScore: fc.double({ min: 0, max: 1, noNaN: true }),
    vectorScore: fc.double({ min: 0, max: 1, noNaN: true }),
    isSeed: fc.boolean(),
    neighborHop: fc.integer({ min: 1, max: 10 }),
    seedTitle: alnum(1, 20),
    seedPath: alnum(1, 20).map((s) => `folder/${s}.md`),
  })
  .map((r): GraphRagSearchItem => {
    if (r.isSeed) {
      return {
        path: r.path,
        title: r.title,
        excerpt: r.excerpt,
        combinedScore: r.combinedScore,
        vectorScore: r.vectorScore,
        hop: 0,
        isSeed: true,
        seedPath: null,
        seedTitle: null,
      };
    }
    // 이웃 결과는 연결된 시드 식별 정보(제목/경로)와 hop 수를 포함한다 (Req 7.4)
    return {
      path: r.path,
      title: r.title,
      excerpt: r.excerpt,
      combinedScore: r.combinedScore,
      vectorScore: r.vectorScore,
      hop: r.neighborHop,
      isSeed: false,
      seedPath: r.seedPath,
      seedTitle: r.seedTitle,
    };
  });

// search()가 반환할 GraphRagResult 생성기 (항목 1개 이상 보장)
const resultArb: fc.Arbitrary<GraphRagResult> = fc
  .array(itemArb, { minLength: 1, maxLength: 8 })
  .map((items) => ({ items }));

// 주입할 가짜 인덱서: 생성된 결과를 그대로 반환한다.
function makeExecutor(result: GraphRagResult): ToolExecutor {
  const fakeIndexer = { search: async () => result } as unknown as VaultIndexer;
  return new ToolExecutor({} as any, fakeIndexer, () => "templates");
}

describe("Graph_RAG_Search 결과 렌더링 (Property 22)", () => {
  // Feature: graph-rag-knowledge-base, Property 22: 검색 결과 렌더링은 필수 정보와 관계 정보를 포함한다
  it("렌더링 출력은 각 결과의 제목/경로/통합 점수(백분율)/발췌와 Seed/Neighbor 구분을 포함하며, 이웃은 연결 시드와 hop을 포함한다", async () => {
    await fc.assert(
      fc.asyncProperty(resultArb, async (result) => {
        const executor = makeExecutor(result);
        const rendered = await executor.execute("search_vault", { query: "x" });

        for (const item of result.items) {
          // 제목 포함 (Req 7.2)
          expect(rendered).toContain(item.title);
          // 볼트 상대 경로 포함 (Req 7.2)
          expect(rendered).toContain(item.path);
          // 통합 점수가 0.0~1.0 → 백분율로 렌더링됨 (Req 7.2)
          const scorePercent = `${(item.combinedScore * 100).toFixed(1)}%`;
          expect(rendered).toContain(scorePercent);
          // 발췌는 최대 500자 (Req 7.2)
          expect(rendered).toContain(item.excerpt.slice(0, 500));

          if (item.isSeed) {
            // Seed/Neighbor 구분 — 시드 라벨 (Req 7.3)
            expect(rendered).toContain("[Seed]");
          } else {
            // 이웃 결과는 연결된 시드 식별 정보와 hop 수를 포함 (Req 7.4)
            expect(rendered).toContain("[Neighbor");
            const seedRef = item.seedTitle || item.seedPath || "";
            expect(rendered).toContain(seedRef);
            expect(rendered).toContain(`${item.hop} hop`);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Graph_RAG_Search 빈 결과/실패 메시지 단위 테스트 (예시 기반)
 *
 * Property 22와 동일하게 공개 API execute("search_vault", ...)를 통해 구동하며,
 * 가짜 VaultIndexer를 주입해 빈 결과/실패/유효하지 않은 쿼리 경로를 검증한다.
 *
 * Validates: Requirements 7.5, 7.6
 */

// 임의의 search 구현을 받아 ToolExecutor를 생성하는 헬퍼
function makeExecutorWith(search: VaultIndexer["search"]): ToolExecutor {
  const fakeIndexer = { search } as unknown as VaultIndexer;
  return new ToolExecutor({} as any, fakeIndexer, () => "templates");
}

describe("Graph_RAG_Search 빈 결과/실패 메시지 (단위)", () => {
  // Req 7.5: 결과가 비어 있으면 인덱싱 안내 메시지를 반환한다.
  it("indexer.search가 빈 결과({ items: [] })를 반환하면 빈 결과 안내 메시지를 반환한다", async () => {
    const executor = makeExecutorWith(async () => ({ items: [] }));

    const rendered = await executor.execute("search_vault", { query: "안녕" });

    // 결과가 없음을 명확히 안내하고, 인덱싱이 필요할 수 있음을 알린다.
    expect(rendered).toContain("검색 결과가 없습니다");
    expect(rendered).toContain("인덱싱");
  });

  // Req 7.6: 검색 자체가 실패(throw)하면 빈/부분 결과를 정상으로 위장하지 않고
  // 명확한 "검색 실패" 오류 메시지를 반환한다.
  it("indexer.search가 Error를 throw하면 검색 실패 오류 메시지를 반환한다", async () => {
    const executor = makeExecutorWith(async () => {
      throw new Error("boom");
    });

    const rendered = await executor.execute("search_vault", { query: "안녕" });

    // 검색 실패 메시지와 원본 오류 메시지를 포함한다.
    expect(rendered).toContain("검색 실패");
    expect(rendered).toContain("boom");
    // 빈 결과 안내 메시지를 성공인 것처럼 반환하지 않는다.
    expect(rendered).not.toContain("검색 결과가 없습니다");
  });

  // Req 4.7: 빈/공백 쿼리로 검색을 수행하지 않은 경우 안내 메시지를 반환한다.
  it("invalidQuery=true 결과면 쿼리 입력 안내 메시지를 반환한다", async () => {
    const executor = makeExecutorWith(async () => ({ items: [], invalidQuery: true }));

    const rendered = await executor.execute("search_vault", { query: "   " });

    // 빈 쿼리 안내 — 빈 결과 안내가 아닌 쿼리 입력 안내를 우선한다.
    expect(rendered).toContain("검색 쿼리가 비어 있습니다");
    expect(rendered).not.toContain("검색 결과가 없습니다");
  });
});
