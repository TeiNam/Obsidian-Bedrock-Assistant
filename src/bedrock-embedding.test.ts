import { describe, it, expect, vi } from "vitest";

// AWS SDK는 import 시점 부수효과를 피하기 위해 모킹한다(이 테스트는 순수 함수만 검증).
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {},
  ConverseCommand: class {},
  ConverseStreamCommand: class {},
  InvokeModelCommand: class {},
}));
vi.mock("@aws-sdk/client-bedrock", () => ({
  BedrockClient: class {},
  ListInferenceProfilesCommand: class {},
  ListFoundationModelsCommand: class {},
}));
vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

import {
  buildEmbeddingRequest,
  extractEmbedding,
  isSupportedEmbeddingModel,
} from "./bedrock-client";

// ============================================
// Bedrock 임베딩 벤더별 스키마 회귀 테스트
// ============================================
// 배경(리뷰 확인 결함): 임베딩 모델 드롭다운은 Cohere·TwelveLabs까지 노출하지만
// getEmbedding은 Titan 형식(`inputText`/`dimensions`)을 하드코딩해 전송했다.
// Titan 외 모델을 선택하면 모든 임베딩 호출이 실패했다(실제 AWS 조회로 확인:
// ap-northeast-2에 cohere.embed-v4:0, twelvelabs.marengo-* 가 노출된다).

describe("isSupportedEmbeddingModel: 지원 모델만 허용", () => {
  it("Titan 임베딩 모델을 지원한다", () => {
    expect(isSupportedEmbeddingModel("amazon.titan-embed-text-v2:0")).toBe(true);
    expect(isSupportedEmbeddingModel("amazon.titan-embed-text-v1")).toBe(true);
  });

  it("Cohere 임베딩 모델을 지원한다", () => {
    expect(isSupportedEmbeddingModel("cohere.embed-v4:0")).toBe(true);
    expect(isSupportedEmbeddingModel("cohere.embed-english-v3")).toBe(true);
  });

  it("요청 스키마를 구현하지 않은 모델은 제외한다", () => {
    // 드롭다운에 노출하면 선택 시 모든 임베딩이 실패한다.
    expect(isSupportedEmbeddingModel("twelvelabs.marengo-embed-3-0-v1:0")).toBe(false);
    expect(isSupportedEmbeddingModel("")).toBe(false);
  });
});

describe("buildEmbeddingRequest: 벤더별 요청 본문", () => {
  it("Titan v2는 dimensions/normalize를 포함한다", () => {
    expect(buildEmbeddingRequest("amazon.titan-embed-text-v2:0", "텍스트")).toEqual({
      inputText: "텍스트",
      dimensions: 512,
      normalize: true,
    });
  });

  it("Titan v1은 dimensions를 보내지 않는다", () => {
    // v1에 dimensions를 전달하면 ValidationException이 발생한다.
    const body = buildEmbeddingRequest("amazon.titan-embed-text-v1", "텍스트");
    expect(body).toEqual({ inputText: "텍스트" });
    expect(body.dimensions).toBeUndefined();
  });

  it("Cohere는 texts 배열과 input_type을 사용한다", () => {
    expect(buildEmbeddingRequest("cohere.embed-v4:0", "텍스트")).toEqual({
      texts: ["텍스트"],
      input_type: "search_document",
    });
  });
});

describe("extractEmbedding: 벤더별 응답 파싱", () => {
  it("Titan 응답의 embedding을 읽는다", () => {
    expect(extractEmbedding("amazon.titan-embed-text-v2:0", { embedding: [1, 2, 3] })).toEqual([
      1, 2, 3,
    ]);
  });

  it("Cohere 응답의 embeddings 첫 벡터를 읽는다", () => {
    expect(extractEmbedding("cohere.embed-v4:0", { embeddings: [[4, 5, 6]] })).toEqual([4, 5, 6]);
  });

  it("Cohere의 중첩 float 형식도 읽는다", () => {
    expect(
      extractEmbedding("cohere.embed-v4:0", { embeddings: { float: [[7, 8]] } })
    ).toEqual([7, 8]);
  });

  it("해석할 수 없는 응답은 null을 반환한다", () => {
    // 호출부가 조용히 빈 벡터를 저장하지 않고 오류를 던지도록 한다.
    expect(extractEmbedding("amazon.titan-embed-text-v2:0", {})).toBeNull();
    expect(extractEmbedding("amazon.titan-embed-text-v2:0", null)).toBeNull();
    expect(extractEmbedding("cohere.embed-v4:0", { embeddings: [] })).toBeNull();
  });
});
