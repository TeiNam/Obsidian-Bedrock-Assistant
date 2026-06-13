import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, CURRENT_INDEX_SCHEMA_VERSION } from "./types";

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
  it("현재 인덱스 스키마 버전은 1이다", () => {
    expect(CURRENT_INDEX_SCHEMA_VERSION).toBe(1);
  });
});
