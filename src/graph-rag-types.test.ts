import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, CURRENT_INDEX_SCHEMA_VERSION } from "./types";
import type { IndexChunk } from "./types";

// ============================================
// graph-rag-knowledge-base 타입/설정 기본값 단위 테스트
// ============================================
// 이 파일은 Graph RAG 기능의 설정 기본값과 인덱스 스키마 버전 상수를 검증한다.
// _Requirements: 9.1, 9.3_

describe("DEFAULT_SETTINGS Graph RAG 기본값 (Req 9.1, 9.3)", () => {
  it("graphTraversalDepth 기본값은 1이다", () => {
    expect(DEFAULT_SETTINGS.graphTraversalDepth).toBe(1);
  });

  it("chunkMaxSize 기본값은 2000이다", () => {
    expect(DEFAULT_SETTINGS.chunkMaxSize).toBe(2000);
  });

  it("chunkOverlap 기본값은 200이다", () => {
    expect(DEFAULT_SETTINGS.chunkOverlap).toBe(200);
  });
});

describe("CURRENT_INDEX_SCHEMA_VERSION 상수 (Req 8.1)", () => {
  it("현재 인덱스 스키마 버전은 2이다", () => {
    // v2: IndexChunk에 heading/charStart 추가. 두 필드가 optional이므로 v1 인덱스는
    // 재인덱싱 없이 로드되고 출처 기능만 해당 청크에서 비활성된다.
    expect(CURRENT_INDEX_SCHEMA_VERSION).toBe(2);
  });

  it("버전을 올릴 때 optional 필드만 추가했는지 확인한다", () => {
    // 필수 필드를 추가하면 v1 인덱스 로드가 깨지고 전체 재임베딩(= 볼트 크기만큼의
    // API 비용)이 강제된다. v1 모양의 청크가 여전히 유효한 IndexChunk여야 한다.
    const v1Chunk: IndexChunk = { index: 0, text: "본문", embedding: [0.1] };

    expect(v1Chunk.heading).toBeUndefined();
    expect(v1Chunk.charStart).toBeUndefined();
  });
});
