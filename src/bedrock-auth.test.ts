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
import { DEFAULT_SETTINGS, type GeminiAssistantSettings } from "./types";
import type { ProfileDeps } from "./aws-profile";

function makeSettings(overrides: Partial<GeminiAssistantSettings> = {}): GeminiAssistantSettings {
  return { ...DEFAULT_SETTINGS, aiBackend: "bedrock", awsRegion: "us-east-1", ...overrides };
}

/** 프로필 자격증명을 즉시 반환하는 테스트용 의존성. */
const stubDeps: ProfileDeps = {
  readTextFile: () => "[default]\naws_access_key_id=AK\naws_secret_access_key=SK",
  listFiles: () => [],
  joinPath: (...parts) => parts.join("/"),
  homeDir: () => "/home/u",
  getRoleCredentials: async () => ({ accessKeyId: "A", secretAccessKey: "S" }),
  now: () => 0,
};

describe("buildBedrockClientConfig: 인증 방식별 설정", () => {
  it("리전은 항상 설정된다", () => {
    expect(buildBedrockClientConfig(makeSettings({ awsRegion: "ap-northeast-2" })).region).toBe(
      "ap-northeast-2"
    );
  });

  it("accessKey: 입력된 키를 credentials로 전달한다", () => {
    const config = buildBedrockClientConfig(
      makeSettings({
        awsAuthMethod: "accessKey",
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
      })
    );
    expect(config.credentials).toEqual({ accessKeyId: "AKID", secretAccessKey: "SECRET" });
    // SigV4를 사용하므로 베어러 토큰 설정은 없다
    expect(config.token).toBeUndefined();
    expect(config.authSchemePreference).toBeUndefined();
  });

  it("accessKey: 키가 비어 있으면 fail-closed로 거부한다(기본 체인 폴백 금지)", async () => {
    // 과거에는 config.credentials를 비워 SDK 기본 자격증명 체인에 위임했다.
    // 그러면 ~/.aws/credentials의 [default] 프로필이나 환경변수·IAM 역할이
    // 집혀, 사용자가 선택하지 않은 AWS 계정으로 노트 내용이 전송되고 과금된다.
    // 특히 볼트 인덱싱은 자동으로 대량 호출하므로 눈치채기 전에 번진다.
    const config = buildBedrockClientConfig(
      makeSettings({ awsAuthMethod: "accessKey", awsAccessKeyId: "" })
    );
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).rejects.toThrow(
      /자격증명/
    );
  });

  it("accessKey: Access Key ID만 있고 Secret이 비어 있으면 fail-closed로 거부한다", async () => {
    // 한쪽만 채운 상태로 서명하면 InvalidSignatureException이 나는데, 그 오류만
    // 보고는 원인을 알기 어렵다. 설정 단계에서 명확히 막는다.
    const config = buildBedrockClientConfig(
      makeSettings({ awsAuthMethod: "accessKey", awsAccessKeyId: "AKID", awsSecretAccessKey: "" })
    );
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).rejects.toThrow(
      /자격증명/
    );
  });

  it("awsAuthMethod가 없는 구버전 설정도 키가 비면 fail-closed다", async () => {
    // DEFAULT_SETTINGS의 awsAuthMethod는 "accessKey"이므로 구버전 data.json을
    // 병합한 사용자가 이 분기에 놓인다. 여기서 폴백하면 조용히 남의 계정을 쓴다.
    const settings = makeSettings({ awsAccessKeyId: "" });
    delete (settings as Record<string, unknown>).awsAuthMethod;
    const config = buildBedrockClientConfig(settings);
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).rejects.toThrow(
      /자격증명/
    );
  });

  it("apiKey: 베어러 토큰과 httpBearerAuth 우선순위를 설정한다", () => {
    const config = buildBedrockClientConfig(
      makeSettings({ awsAuthMethod: "apiKey", bedrockApiKey: "  KEY123  " })
    );
    // 앞뒤 공백은 제거된다
    expect(config.token).toEqual({ token: "KEY123" });
    expect(config.authSchemePreference).toEqual(["httpBearerAuth"]);
    expect(config.credentials).toBeUndefined();
  });

  it("apiKey: 키가 비어 있으면 fail-closed로 거부한다(기본 체인 폴백 금지)", async () => {
    const config = buildBedrockClientConfig(
      makeSettings({ awsAuthMethod: "apiKey", bedrockApiKey: "" })
    );
    // 기본 자격증명 체인으로 새면 사용자가 선택하지 않은 계정으로 과금될 수 있다
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).rejects.toThrow(/API 키/);
    expect(config.token).toBeUndefined();
  });

  it("profile: 지정된 프로필로 자격증명을 해석하는 공급자를 전달한다", async () => {
    const config = buildBedrockClientConfig(
      makeSettings({ awsAuthMethod: "profile", awsProfile: "default" }),
      stubDeps
    );
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).resolves.toEqual({
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
  });

  it("profile: 프로필이 비어 있으면 fail-closed로 거부한다", async () => {
    const config = buildBedrockClientConfig(
      makeSettings({ awsAuthMethod: "profile", awsProfile: "" }),
      stubDeps
    );
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).rejects.toThrow(/프로필/);
  });

  it("어떤 인증 방식에서도 비밀값이 설정 객체에 중복 노출되지 않는다", () => {
    // 액세스 키 방식에서 token(베어러) 경로로 키가 새지 않는지 확인
    const config = buildBedrockClientConfig(
      makeSettings({
        awsAuthMethod: "accessKey",
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
        bedrockApiKey: "SHOULD-NOT-APPEAR",
      })
    );
    expect(JSON.stringify(config)).not.toContain("SHOULD-NOT-APPEAR");
  });
});
