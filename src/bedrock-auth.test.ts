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
  filterStaleCredentials,
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

  it("문자열이 아닌 키에서도 예외를 던지지 않고 fail-closed로 처리한다", async () => {
    // 손상된 data.json에 숫자·객체가 들어오면 .trim()이 TypeError를 던지고,
    // 이 함수가 BedrockClient 생성자에서 호출되므로 onload 전체가 죽는다.
    // 플러그인이 뜨지 않으면 사용자가 설정을 고칠 수도 없다.
    for (const bad of [42, {}, [], true]) {
      const config = buildBedrockClientConfig(
        makeSettings({ bedrockApiKey: bad as unknown as string })
      );
      expect(config.token).toBeUndefined();
      expect(typeof config.credentials).toBe("function");
      await expect((config.credentials as () => Promise<unknown>)()).rejects.toThrow(/API 키/);
      expect(config.authSchemePreference).toEqual(["aws.auth#sigv4"]);
    }
  });
});

// ============================================
// 구 프로필 사용자의 잔존 API 키 차단
// ============================================

describe("filterStaleCredentials: 구 사용자 보호", () => {
  // 0.3.0 이전 인증 방식 전체. accessKey가 기본값이었으므로 profile만 막으면
  // 가장 흔한 경우가 그대로 통과한다.
  for (const method of ["profile", "accessKey", "unknown-value"]) {
    it(`구 설정이 ${method}이면 로컬에 남은 bedrockApiKey를 적용하지 않는다`, () => {
      const filtered = filterStaleCredentials(
        { awsAuthMethod: method },
        { bedrockApiKey: "STALE_KEY_ACCOUNT_A", geminiApiKey: "GEMINI_KEY" }
      );

      expect(filtered.bedrockApiKey).toBeUndefined();
      // 다른 프로바이더 키는 Bedrock 인증 방식과 무관하므로 보존한다.
      expect(filtered.geminiApiKey).toBe("GEMINI_KEY");
    });
  }

  it("구 설정이 apiKey면 로컬 키를 그대로 적용한다", () => {
    const filtered = filterStaleCredentials(
      { awsAuthMethod: "apiKey" },
      { bedrockApiKey: "USER_CHOSE_THIS" }
    );

    expect(filtered.bedrockApiKey).toBe("USER_CHOSE_THIS");
  });

  it("awsAuthMethod가 없는 신규 설치는 로컬 키를 그대로 적용한다", () => {
    const filtered = filterStaleCredentials({}, { bedrockApiKey: "KEY" });

    expect(filtered.bedrockApiKey).toBe("KEY");
  });

  it("판정 후 폐기된 인증 방식 키를 raw에서 제거한다", () => {
    // 남기면 매 실행마다 같은 판정이 반복되어, 사용자가 새 키를 입력해도
    // 다음 실행에서 또 차단되는 영구 루프에 빠진다.
    const raw: { awsAuthMethod?: string; awsProfile?: string } = {
      awsAuthMethod: "profile",
      awsProfile: "my-profile",
    };

    filterStaleCredentials(raw, { bedrockApiKey: "STALE" });

    expect("awsAuthMethod" in raw).toBe(false);
    expect("awsProfile" in raw).toBe(false);
  });

  it("두 번째 실행에서는 사용자가 입력한 키가 살아남는다", () => {
    // 1회차: 구 설정으로 차단 → raw에서 키 제거 → 저장 시 data.json에서도 사라진다.
    const raw: { awsAuthMethod?: string; awsProfile?: string } = { awsAuthMethod: "profile" };
    expect(filterStaleCredentials(raw, { bedrockApiKey: "STALE" }).bedrockApiKey).toBeUndefined();

    // 2회차: 정리된 설정을 다시 읽으면 사용자가 입력한 새 키가 적용된다.
    expect(filterStaleCredentials(raw, { bedrockApiKey: "USER_ENTERED" }).bedrockApiKey).toBe(
      "USER_ENTERED"
    );
  });

  it("원본 credentials 객체를 변경하지 않는다", () => {
    const credentials = { bedrockApiKey: "KEY" };
    filterStaleCredentials({ awsAuthMethod: "profile" }, credentials);

    expect(credentials.bedrockApiKey).toBe("KEY");
  });
});
