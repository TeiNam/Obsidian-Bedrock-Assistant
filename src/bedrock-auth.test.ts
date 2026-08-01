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
  migrateAwsAuthMethod,
  type GeminiAssistantSettings,
} from "./types";
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

  it("구 설정의 accessKey 인증 방식은 fail-closed로 거부한다", async () => {
    // 액세스 키 방식을 제거했지만, 구 data.json에는 "accessKey" 문자열이 남아있을 수 있다.
    // loadSettings의 마이그레이션이 "profile"로 바꾸지만, 만약 마이그레이션 전에
    // buildBedrockClientConfig가 호출되거나 다른 경로로 stale 값이 들어오면
    // SDK 기본 체인으로 새는 대신 명시적으로 거부해야 한다.
    const config = buildBedrockClientConfig(
      makeSettings({ awsAuthMethod: "accessKey" as any })
    );
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).rejects.toThrow(
      /지원하지 않는 인증 방식/
    );
  });

  it("알 수 없는 인증 방식은 fail-closed로 거부한다", async () => {
    // 임의의 문자열이 awsAuthMethod에 들어왔을 때 SDK 기본 체인으로 폴백하지 않는다.
    const config = buildBedrockClientConfig(
      makeSettings({ awsAuthMethod: "unknown-method" as any })
    );
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).rejects.toThrow(
      /지원하지 않는 인증 방식/
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

  it("profile 방식은 authSchemePreference를 sigv4로 고정한다", () => {
    // AWS SDK는 환경에 AWS_BEARER_TOKEN_BEDROCK이 있으면 authSchemePreference를
    // ["httpBearerAuth"]로 강제하고(@aws-sdk/core의 NODE_AUTH_SCHEME_PREFERENCE_OPTIONS),
    // 그러면 우리가 넣은 credentials 공급자를 아예 호출하지 않는다. 즉 프로필을
    // 명시해도 다른 계정의 ambient 토큰으로 요청이 나간다. 스킴을 고정해 막는다.
    const config = buildBedrockClientConfig(
      makeSettings({ awsAuthMethod: "profile", awsProfile: "default" }),
      stubDeps
    );
    expect(config.authSchemePreference).toEqual(["aws.auth#sigv4"]);
  });

  it("인증값이 비어 fail-closed일 때도 authSchemePreference를 sigv4로 고정한다", () => {
    // 거부 공급자를 넣어도 스킴을 고정하지 않으면 ambient 베어러 토큰이 우회한다.
    for (const settings of [
      makeSettings({ awsAuthMethod: "profile", awsProfile: "" }),
      makeSettings({ awsAuthMethod: "apiKey", bedrockApiKey: "" }),
      makeSettings({ awsAuthMethod: "accessKey" as any }),
    ]) {
      const config = buildBedrockClientConfig(settings, stubDeps);
      expect(config.authSchemePreference).toEqual(["aws.auth#sigv4"]);
    }
  });

  it("어떤 인증 방식에서도 비밀값이 의도하지 않은 경로로 노출되지 않는다", () => {
    // apiKey 방식: token 경로는 의도된 노출이므로 허용. credentials 경로로는 새지 않는지 확인
    const config = buildBedrockClientConfig(
      makeSettings({
        awsAuthMethod: "apiKey",
        bedrockApiKey: "KEY123",
      })
    );
    expect(config.token).toEqual({ token: "KEY123" });
    expect(config.credentials).toBeUndefined();
  });
});

describe("DEFAULT_SETTINGS: 기본 인증 방식", () => {
  it("기본 인증 방식은 profile이다", () => {
    expect(DEFAULT_SETTINGS.awsAuthMethod).toBe("profile");
  });
});

describe("migrateAwsAuthMethod: 구 설정 마이그레이션", () => {
  it("accessKey를 profile로 마이그레이션한다", () => {
    const raw = { awsAuthMethod: "accessKey" as any };
    const migrated = migrateAwsAuthMethod(raw);
    expect(migrated.awsAuthMethod).toBe("profile");
  });

  it("이미 profile이면 그대로 둔다", () => {
    const raw = { awsAuthMethod: "profile" as any, awsProfile: "my-profile" };
    const migrated = migrateAwsAuthMethod(raw);
    expect(migrated.awsAuthMethod).toBe("profile");
    expect(migrated.awsProfile).toBe("my-profile");
  });

  it("이미 apiKey이면 그대로 둔다", () => {
    const raw = { awsAuthMethod: "apiKey" as any, bedrockApiKey: "KEY" };
    const migrated = migrateAwsAuthMethod(raw);
    expect(migrated.awsAuthMethod).toBe("apiKey");
    expect(migrated.bedrockApiKey).toBe("KEY");
  });

  it("알 수 없는 인증 방식도 profile로 마이그레이션한다", () => {
    const raw = { awsAuthMethod: "unknown-method" as any };
    const migrated = migrateAwsAuthMethod(raw);
    expect(migrated.awsAuthMethod).toBe("profile");
  });
});
