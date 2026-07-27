import { describe, it, expect } from "vitest";
import {
  buildGenerationParams,
  chatModelRank,
  clampEffort,
  compareModelVersion,
  effortLevels,
  inferProviderName,
  supportsEffort,
  supportsTemperature,
} from "./provider-utils";

// Bedrock 추론 프로파일 ID는 `global.<vendor>.<model>` 형태다.
const OPUS_4 = "global.anthropic.claude-opus-4-8";
const OPUS_5 = "global.anthropic.claude-opus-5";
const OPUS_10 = "global.anthropic.claude-opus-10";
const SONNET_5 = "global.anthropic.claude-sonnet-5";
const SONNET_4 = "global.anthropic.claude-sonnet-4-5";
const HAIKU_4 = "global.anthropic.claude-haiku-4-5";
const HAIKU_5 = "global.anthropic.claude-haiku-5";
const GPT_SOL = "global.openai.gpt-5.6-sol";
const GPT_TERRA = "global.openai.gpt-5.6-terra";
const GPT_LUNA = "global.openai.gpt-5.6-luna";

// ============================================
// supportsEffort / supportsTemperature
// ============================================
describe("supportsEffort: effort 기반 추론 모델 판별", () => {
  it("Anthropic opus-4 이상은 effort 기반이다", () => {
    expect(supportsEffort(OPUS_4)).toBe(true);
    expect(supportsEffort(OPUS_5)).toBe(true);
    // 두 자리 버전도 낮은 버전으로 오판하지 않는다
    expect(supportsEffort(OPUS_10)).toBe(true);
  });

  it("Anthropic sonnet-5 / haiku-5 이상은 effort 기반이다", () => {
    expect(supportsEffort(SONNET_5)).toBe(true);
    expect(supportsEffort(HAIKU_5)).toBe(true);
  });

  it("구버전 Anthropic 모델은 effort 미지원이다", () => {
    expect(supportsEffort(SONNET_4)).toBe(false);
    expect(supportsEffort(HAIKU_4)).toBe(false);
    expect(supportsEffort("global.anthropic.claude-opus-3")).toBe(false);
  });

  it("GPT-5 이상 계열(sol/terra/luna)은 effort 기반이다", () => {
    expect(supportsEffort(GPT_SOL)).toBe(true);
    expect(supportsEffort(GPT_TERRA)).toBe(true);
    expect(supportsEffort(GPT_LUNA)).toBe(true);
  });

  it("effort 미지원 모델(임베딩 등)은 false다", () => {
    expect(supportsEffort("amazon.titan-embed-text-v2:0")).toBe(false);
    expect(supportsEffort("")).toBe(false);
  });

  it("temperature 지원 여부는 effort 지원과 배타적이다", () => {
    for (const id of [OPUS_5, SONNET_5, GPT_SOL, SONNET_4, HAIKU_4, ""]) {
      expect(supportsTemperature(id)).toBe(!supportsEffort(id));
    }
  });
});

// ============================================
// effortLevels / clampEffort
// ============================================
describe("effortLevels: 모델별 허용 effort 목록", () => {
  it("Anthropic은 low~max를 허용하고 minimal은 제외한다", () => {
    expect(effortLevels(OPUS_5)).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("OpenAI는 minimal~high를 허용하고 xhigh/max는 제외한다", () => {
    expect(effortLevels(GPT_SOL)).toEqual(["minimal", "low", "medium", "high"]);
  });

  it("effort 미지원 모델은 빈 배열이다", () => {
    expect(effortLevels(SONNET_4)).toEqual([]);
  });
});

describe("clampEffort: 모델 전환 시 effort 보정", () => {
  it("허용 값은 그대로 유지한다", () => {
    expect(clampEffort(OPUS_5, "high")).toBe("high");
    expect(clampEffort(GPT_SOL, "minimal")).toBe("minimal");
  });

  it("Anthropic 전용 값(max)은 OpenAI에서 가장 가까운 high로 내려간다", () => {
    expect(clampEffort(GPT_SOL, "max")).toBe("high");
    expect(clampEffort(GPT_SOL, "xhigh")).toBe("high");
  });

  it("OpenAI 전용 값(minimal)은 Anthropic에서 가장 가까운 low로 올라간다", () => {
    expect(clampEffort(OPUS_5, "minimal")).toBe("low");
  });

  it("effort 미지원 모델에서는 값을 바꾸지 않는다", () => {
    // temperature를 쓰는 모델에서는 effort 값이 전송되지 않으므로 보존해도 무해하다.
    expect(clampEffort(SONNET_4, "max")).toBe("max");
  });

  it("알 수 없는 값은 medium(없으면 첫 허용 값)으로 폴백한다", () => {
    expect(clampEffort(OPUS_5, "bogus" as never)).toBe("medium");
  });
});

// ============================================
// buildGenerationParams
// ============================================
describe("buildGenerationParams: temperature와 effort는 동시에 실리지 않는다", () => {
  it("Anthropic effort는 output_config로 중첩 전달하고 temperature를 생략한다", () => {
    // 평면 `effort`는 Anthropic API에서 validation 오류가 발생한다.
    const params = buildGenerationParams(OPUS_5, { temperature: 0.7, effort: "high" });
    expect(params.inferenceConfig).toEqual({});
    expect(params.additionalModelRequestFields).toEqual({ output_config: { effort: "high" } });
  });

  it("Anthropic은 xhigh/max도 그대로 전달한다", () => {
    expect(
      buildGenerationParams(OPUS_5, { temperature: 0, effort: "xhigh" })
        .additionalModelRequestFields
    ).toEqual({ output_config: { effort: "xhigh" } });
    expect(
      buildGenerationParams(SONNET_5, { temperature: 0, effort: "max" })
        .additionalModelRequestFields
    ).toEqual({ output_config: { effort: "max" } });
  });

  it("OpenAI 계열은 reasoning_effort 필드명을 사용한다", () => {
    const params = buildGenerationParams(GPT_TERRA, { temperature: 0.7, effort: "medium" });
    expect(params.additionalModelRequestFields).toEqual({ reasoning_effort: "medium" });
  });

  it("OpenAI 계열에서 허용 밖 effort는 보정되어 전달된다", () => {
    const params = buildGenerationParams(GPT_LUNA, { temperature: 0, effort: "max" });
    expect(params.additionalModelRequestFields).toEqual({ reasoning_effort: "high" });
  });

  it("구형 모델은 temperature만 전달하고 effort 필드는 없다", () => {
    const params = buildGenerationParams(SONNET_4, { temperature: 0.3, effort: "high" });
    expect(params.inferenceConfig).toEqual({ temperature: 0.3 });
    expect(params.additionalModelRequestFields).toBeUndefined();
  });

  it("어떤 모델이든 두 파라미터가 함께 실리지 않는다", () => {
    for (const id of [OPUS_5, SONNET_5, GPT_SOL, SONNET_4, HAIKU_4, HAIKU_5]) {
      const params = buildGenerationParams(id, { temperature: 0.5, effort: "medium" });
      const hasTemp = params.inferenceConfig.temperature !== undefined;
      const hasEffort = params.additionalModelRequestFields !== undefined;
      expect(hasTemp && hasEffort).toBe(false);
      // 최소 하나는 반드시 전달된다(둘 다 빠지면 모델 기본값에 의존하게 된다).
      expect(hasTemp || hasEffort).toBe(true);
    }
  });

  it("effort 필드에 temperature 키가 섞이지 않는다", () => {
    // additionalModelRequestFields로 temperature가 새면 API가 거부한다.
    for (const id of [OPUS_5, GPT_SOL]) {
      const fields = buildGenerationParams(id, { temperature: 0.9, effort: "low" })
        .additionalModelRequestFields;
      expect(JSON.stringify(fields)).not.toContain("temperature");
    }
  });
});

// ============================================
// chatModelRank
// ============================================
describe("chatModelRank: 채팅 모델 계열 판별과 우선순위", () => {
  it("Claude 계열은 opus > sonnet > haiku 순이다", () => {
    expect(chatModelRank(OPUS_5)).toBe(0);
    expect(chatModelRank(SONNET_5)).toBe(1);
    expect(chatModelRank(HAIKU_5)).toBe(2);
  });

  it("GPT variant(sol/terra/luna)는 서로 다른 계열로 취급한다", () => {
    const sol = chatModelRank(GPT_SOL);
    const terra = chatModelRank(GPT_TERRA);
    const luna = chatModelRank(GPT_LUNA);
    expect(new Set([sol, terra, luna]).size).toBe(3);
    // GPT 계열은 Claude 계열보다 뒤에 표시된다
    expect(Math.min(sol!, terra!, luna!)).toBeGreaterThan(chatModelRank(HAIKU_5)!);
  });

  it("채팅 모델이 아닌 ID는 null이다", () => {
    expect(chatModelRank("amazon.titan-embed-text-v2:0")).toBeNull();
    expect(chatModelRank("cohere.embed-english-v3")).toBeNull();
    expect(chatModelRank("")).toBeNull();
  });
});

// ============================================
// compareModelVersion
// ============================================
describe("compareModelVersion: 버전 자연 정렬", () => {
  it("두 자리 버전을 한 자리보다 높게 판정한다", () => {
    // 문자열 비교라면 "claude-opus-10" < "claude-opus-4" 로 잘못 판정된다
    expect(compareModelVersion(OPUS_10, OPUS_4)).toBeGreaterThan(0);
  });

  it("동일 메이저에서 마이너가 큰 쪽이 최신이다", () => {
    expect(
      compareModelVersion("global.anthropic.claude-opus-4-8", "global.anthropic.claude-opus-4-1")
    ).toBeGreaterThan(0);
  });

  it("숫자 그룹이 없는 쪽은 있는 쪽보다 낮다", () => {
    expect(compareModelVersion(OPUS_5, "global.anthropic.claude-opus")).toBeGreaterThan(0);
  });

  it("같은 ID는 0이다", () => {
    expect(compareModelVersion(OPUS_5, OPUS_5)).toBe(0);
  });
});

// ============================================
// inferProviderName
// ============================================
describe("inferProviderName: 표시용 공급자 이름", () => {
  it("Claude ID는 Anthropic이다", () => {
    expect(inferProviderName(OPUS_5)).toBe("Anthropic");
  });

  it("GPT ID는 OpenAI다", () => {
    expect(inferProviderName(GPT_SOL)).toBe("OpenAI");
  });

  it("알려지지 않은 벤더는 ID의 벤더 세그먼트를 사용한다", () => {
    expect(inferProviderName("global.meta.llama4-instruct")).toBe("Meta");
  });

  it("빈 ID는 Unknown이다", () => {
    expect(inferProviderName("")).toBe("Unknown");
  });
});
