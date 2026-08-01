import { describe, it, expect, vi } from "vitest";

// AWS SDK 모듈은 이 테스트에서 인스턴스화하지 않지만, import 시점 부수효과를 피하기 위해 모킹한다.
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

import { buildBedrockClientConfig } from "./bedrock-client";
import {
  DEFAULT_SETTINGS,
  type GeminiAssistantSettings,
} from "./types";

function makeSettings(overrides: Partial<GeminiAssistantSettings> = {}): GeminiAssistantSettings {
  return { ...DEFAULT_SETTINGS, aiBackend: "bedrock", awsRegion: "us-east-1", ...overrides };
}

describe("buildBedrockClientConfig: 인증 방식별 설정", () => {
  it("리전은 항상 설정된다", () => {
    expect(buildBedrockClientConfig(makeSettings({ awsRegion: "ap-northeast-2" })).region).toBe(
      "ap-northeast-2"
    );
  });


  it("베어러 토큰과 httpBearerAuth 우선순위를 설정한다", () => {
    const config = buildBedrockClientConfig(
      makeSettings({ bedrockApiKey: "  KEY123  " })
    );
    // 앞뒤 공백은 제거된다
    expect(config.token).toEqual({ token: "KEY123" });
    expect(config.authSchemePreference).toEqual(["httpBearerAuth"]);
    expect(config.credentials).toBeUndefined();
  });

  it("키가 비어 있으면 fail-closed로 거부한다(기본 체인 폴백 금지)", async () => {
    const config = buildBedrockClientConfig(
      makeSettings({ bedrockApiKey: "" })
    );
    // 기본 자격증명 체인으로 새면 사용자가 선택하지 않은 계정으로 과금될 수 있다
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).rejects.toThrow(/API 키/);
    expect(config.token).toBeUndefined();
  });

  it("키가 비어 fail-closed일 때도 authSchemePreference를 sigv4로 고정한다", () => {
    // 거부 공급자를 넣어도 스킴을 고정하지 않으면 ambient 베어러 토큰이 우회한다.
    const config = buildBedrockClientConfig(makeSettings({ bedrockApiKey: "" }));
    expect(config.authSchemePreference).toEqual(["aws.auth#sigv4"]);
  });

  it("비밀값이 의도하지 않은 경로로 노출되지 않는다", () => {
    // token 경로는 의도된 노출이므로 허용. credentials 경로로는 새지 않는지 확인
    const config = buildBedrockClientConfig(
      makeSettings({ bedrockApiKey: "KEY123" })
    );
    expect(config.token).toEqual({ token: "KEY123" });
    expect(config.credentials).toBeUndefined();
  });

  it("빈 키 config도 ambient 폴백 형태를 포함하지 않는다", async () => {
    // credentials가 undefined면 SDK가 자체 기본 체인으로 폴백한다
    const config = buildBedrockClientConfig(makeSettings({ bedrockApiKey: "" }));
    expect(typeof config.credentials).toBe("function");
    expect(config.token).toBeUndefined();
  });
});
