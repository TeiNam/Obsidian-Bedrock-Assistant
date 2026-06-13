import { describe, it, expect } from "vitest";
import { normalizeTraversalDepth } from "./graph-rag/graph-traversal";
import { normalizeChunkConfig } from "./graph-rag/chunker";

// ============================================
// settings-tab 설정 보정 단위 테스트 (Task 10.2)
// ============================================
// 설정 탭(settings-tab.ts)은 사용자가 입력한 Graph RAG 값을 저장하기 전에
// normalizeTraversalDepth / normalizeChunkConfig 로 보정한다.
// Obsidian Setting UI 전체를 테스트하는 것은 비현실적이므로,
// 설정 저장 경로가 의존하는 "보정 로직" 자체를 예제 기반 단위 테스트로 검증한다.
// (Req 9.4, 9.5, 9.6, 9.7)

// --------------------------------------------
// normalizeTraversalDepth — 탐색 깊이 보정 (Req 9.4, 9.5)
// --------------------------------------------
describe("normalizeTraversalDepth: 탐색 깊이 보정", () => {
  it("음수 입력은 0으로 보정한다 (Req 9.4)", () => {
    // 0 미만 → 0
    expect(normalizeTraversalDepth(-1)).toBe(0);
    expect(normalizeTraversalDepth(-5)).toBe(0);
    // -0 도 0 으로 정규화
    expect(Object.is(normalizeTraversalDepth(-0.4), 0)).toBe(true);
  });

  it("3을 초과하는 입력은 3으로 보정한다 (Req 9.5)", () => {
    // 3 초과 → 3
    expect(normalizeTraversalDepth(4)).toBe(3);
    expect(normalizeTraversalDepth(100)).toBe(3);
  });

  it("정수가 아닌 입력은 가장 가까운 정수로 반올림한다 (Req 9.5)", () => {
    // 비정수 → 반올림 후 0~3 범위 클램프
    expect(normalizeTraversalDepth(1.4)).toBe(1);
    expect(normalizeTraversalDepth(1.5)).toBe(2);
    expect(normalizeTraversalDepth(2.6)).toBe(3);
    // 반올림 결과가 범위를 벗어나면 클램프된다
    expect(normalizeTraversalDepth(3.4)).toBe(3);
    expect(normalizeTraversalDepth(-0.6)).toBe(0);
  });

  it("유효 범위(0~3 정수) 입력은 그대로 유지한다", () => {
    // 경계 및 내부 값 보존
    expect(normalizeTraversalDepth(0)).toBe(0);
    expect(normalizeTraversalDepth(1)).toBe(1);
    expect(normalizeTraversalDepth(2)).toBe(2);
    expect(normalizeTraversalDepth(3)).toBe(3);
  });

  it("유한하지 않은 값(NaN, Infinity)은 0으로 보정한다", () => {
    expect(normalizeTraversalDepth(NaN)).toBe(0);
    expect(normalizeTraversalDepth(Infinity)).toBe(0);
    expect(normalizeTraversalDepth(-Infinity)).toBe(0);
  });
});

// --------------------------------------------
// normalizeChunkConfig — 청크 설정 보정 (Req 9.6, 9.7)
// --------------------------------------------
describe("normalizeChunkConfig: 청크 설정 보정", () => {
  it("maxSize가 1 미만이면 1로 보정한다 (Req 9.7)", () => {
    // maxSize < 1 → 1
    expect(normalizeChunkConfig(0, 0).maxSize).toBe(1);
    expect(normalizeChunkConfig(-100, 0).maxSize).toBe(1);
    // maxSize가 1로 보정되면 overlap은 maxSize-1(=0) 이하로 유지된다
    const normalized = normalizeChunkConfig(0, 5);
    expect(normalized.maxSize).toBe(1);
    expect(normalized.overlap).toBe(0);
  });

  it("overlap이 maxSize 이상이면 maxSize-1로 보정한다 (Req 9.6)", () => {
    // overlap >= maxSize → maxSize - 1
    expect(normalizeChunkConfig(2000, 2000)).toEqual({ maxSize: 2000, overlap: 1999 });
    expect(normalizeChunkConfig(2000, 5000)).toEqual({ maxSize: 2000, overlap: 1999 });
    expect(normalizeChunkConfig(10, 10)).toEqual({ maxSize: 10, overlap: 9 });
  });

  it("음수 overlap은 0으로 보정한다", () => {
    // overlap < 0 → 0 (설계 불변식 0 <= overlap)
    expect(normalizeChunkConfig(2000, -1)).toEqual({ maxSize: 2000, overlap: 0 });
    expect(normalizeChunkConfig(2000, -999)).toEqual({ maxSize: 2000, overlap: 0 });
  });

  it("유효한 값은 그대로 유지한다", () => {
    // 0 <= overlap < maxSize 이고 maxSize >= 1 인 정상 입력은 보존
    expect(normalizeChunkConfig(2000, 200)).toEqual({ maxSize: 2000, overlap: 200 });
    expect(normalizeChunkConfig(1, 0)).toEqual({ maxSize: 1, overlap: 0 });
    expect(normalizeChunkConfig(100, 99)).toEqual({ maxSize: 100, overlap: 99 });
  });

  it("보정 결과는 항상 maxSize>=1 이고 0<=overlap<maxSize 불변식을 만족한다", () => {
    // 다양한 비정상 입력 조합에서 불변식 검증
    const inputs: Array<[number, number]> = [
      [0, 0],
      [-10, -10],
      [1, 5],
      [2000, 2000],
      [5, -3],
      [NaN, NaN],
      [Infinity, Infinity],
    ];
    for (const [maxSize, overlap] of inputs) {
      const cfg = normalizeChunkConfig(maxSize, overlap);
      expect(cfg.maxSize).toBeGreaterThanOrEqual(1);
      expect(cfg.overlap).toBeGreaterThanOrEqual(0);
      expect(cfg.overlap).toBeLessThan(cfg.maxSize);
    }
  });
});
