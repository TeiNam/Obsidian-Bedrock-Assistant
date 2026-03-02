import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * BedrockClient 리팩토링 테스트
 *
 * Property 1: Fault Condition - 공통 헬퍼 메서드를 통한 중복 제거 확인
 *   buildClientConfig()가 세 가지 credential 모드에서 올바른 설정 반환 확인
 *   createClient()와 createControlClient()가 동일한 헬퍼를 사용하는지 확인
 *
 * Property 2: Preservation - 세 가지 credential 모드 동작 보존
 *   manual 모드: accessKeyId, secretAccessKey, region 설정 확인
 *   apikey 모드: API key 미들웨어 주입 확인
 *   env 모드: 환경 변수 기반 credential 확인
 *
 * Validates: Requirements 2.4, 3.5
 */

// --- AWS SDK 모킹 ---

// BedrockRuntimeClient 생성자에 전달된 설정을 캡처
let runtimeClientConfigs: any[] = [];
// BedrockControlClient(BedrockClient) 생성자에 전달된 설정을 캡처
let controlClientConfigs: any[] = [];
// 미들웨어 스택에 추가된 핸들러를 캡처
let runtimeMiddlewares: any[] = [];
let controlMiddlewares: any[] = [];

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  // new 키워드로 호출 가능하도록 function 사용
  function MockBedrockRuntimeClient(this: any, config: any) {
    runtimeClientConfigs.push(config);
    const middlewares: any[] = [];
    runtimeMiddlewares.push(middlewares);
    this.middlewareStack = {
      add: vi.fn((handler: any, options: any) => {
        middlewares.push({ handler, options });
      }),
    };
    this.send = vi.fn();
  }
  return {
    BedrockRuntimeClient: MockBedrockRuntimeClient,
    ConverseCommand: vi.fn(),
    ConverseStreamCommand: vi.fn(),
    InvokeModelCommand: vi.fn(),
  };
});

vi.mock("@aws-sdk/client-bedrock", () => {
  function MockBedrockControlClient(this: any, config: any) {
    controlClientConfigs.push(config);
    const middlewares: any[] = [];
    controlMiddlewares.push(middlewares);
    this.middlewareStack = {
      add: vi.fn((handler: any, options: any) => {
        middlewares.push({ handler, options });
      }),
    };
    this.send = vi.fn().mockResolvedValue({ inferenceProfileSummaries: [] });
  }
  return {
    BedrockClient: MockBedrockControlClient,
    ListInferenceProfilesCommand: vi.fn(),
  };
});

vi.mock("./skills", () => ({
  buildSkillsPrompt: vi.fn().mockReturnValue(""),
}));

import { BedrockClient } from "./bedrock-client";
import { DEFAULT_SETTINGS, type BedrockAssistantSettings } from "./types";

// 테스트용 설정 헬퍼 함수
function makeSettings(
  overrides: Partial<BedrockAssistantSettings> = {}
): BedrockAssistantSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

beforeEach(() => {
  // 캡처 배열 초기화
  runtimeClientConfigs = [];
  controlClientConfigs = [];
  runtimeMiddlewares = [];
  controlMiddlewares = [];
  vi.clearAllMocks();
});


// --- Property 1: Fault Condition - 공통 헬퍼 메서드를 통한 중복 제거 확인 ---

describe("BedrockClient - Fault Condition (Property 1)", () => {
  /**
   * Validates: Requirements 2.4
   * buildClientConfig()가 공통 헬퍼로 추출되어 createClient()와 createControlClient()가
   * 동일한 설정 로직을 사용하는지 확인
   */

  it("createClient()와 createControlClient()가 동일한 credential 설정을 받는다 (manual 모드)", () => {
    const settings = makeSettings({
      awsCredentialSource: "manual",
      awsAccessKeyId: "test-key-id",
      awsSecretAccessKey: "test-secret",
      awsRegion: "ap-northeast-2",
    });

    const client = new BedrockClient(settings);
    // constructor에서 createClient() 호출 → runtimeClientConfigs[0]
    // listModels()에서 createControlClient() 호출
    client.listModels();

    // 두 클라이언트 모두 동일한 설정을 받아야 함
    expect(runtimeClientConfigs).toHaveLength(1);
    expect(controlClientConfigs).toHaveLength(1);

    const runtimeConfig = runtimeClientConfigs[0];
    const controlConfig = controlClientConfigs[0];

    // 동일한 region
    expect(runtimeConfig.region).toBe(controlConfig.region);
    // 동일한 credentials
    expect(runtimeConfig.credentials).toEqual(controlConfig.credentials);
  });

  it("createClient()와 createControlClient()가 동일한 credential 설정을 받는다 (apikey 모드)", () => {
    const settings = makeSettings({
      awsCredentialSource: "apikey",
      bedrockApiKey: "test-api-key-123",
      awsRegion: "us-west-2",
    });

    const client = new BedrockClient(settings);
    client.listModels();

    const runtimeConfig = runtimeClientConfigs[0];
    const controlConfig = controlClientConfigs[0];

    // 두 클라이언트 모두 더미 credentials를 받아야 함
    expect(runtimeConfig.credentials).toEqual({
      accessKeyId: "apikey",
      secretAccessKey: "apikey",
    });
    expect(controlConfig.credentials).toEqual({
      accessKeyId: "apikey",
      secretAccessKey: "apikey",
    });
  });

  it("createClient()와 createControlClient()가 동일한 credential 설정을 받는다 (env 모드)", () => {
    const settings = makeSettings({
      awsCredentialSource: "env",
      awsRegion: "eu-west-1",
    });

    const client = new BedrockClient(settings);
    client.listModels();

    const runtimeConfig = runtimeClientConfigs[0];
    const controlConfig = controlClientConfigs[0];

    // env 모드: credentials 미지정 → undefined
    expect(runtimeConfig.credentials).toBeUndefined();
    expect(controlConfig.credentials).toBeUndefined();
    // 동일한 region
    expect(runtimeConfig.region).toBe("eu-west-1");
    expect(controlConfig.region).toBe("eu-west-1");
  });

  it("apikey 모드에서 두 클라이언트 모두 API key 미들웨어가 주입된다", () => {
    const settings = makeSettings({
      awsCredentialSource: "apikey",
      bedrockApiKey: "my-secret-key",
    });

    const client = new BedrockClient(settings);
    client.listModels();

    // 두 클라이언트 모두 미들웨어가 추가되어야 함
    expect(runtimeMiddlewares[0]).toHaveLength(1);
    expect(controlMiddlewares[0]).toHaveLength(1);

    // 미들웨어 옵션이 동일해야 함
    expect(runtimeMiddlewares[0][0].options).toEqual({
      step: "finalizeRequest",
      name: "bedrockApiKeyAuth",
      override: true,
    });
    expect(controlMiddlewares[0][0].options).toEqual({
      step: "finalizeRequest",
      name: "bedrockApiKeyAuth",
      override: true,
    });
  });
});


// --- Property 2: Preservation - 세 가지 credential 모드 동작 보존 ---

describe("BedrockClient - Preservation (Property 2)", () => {
  /**
   * Validates: Requirements 3.5
   * 리팩토링 후에도 manual, apikey, env 세 가지 credential 모드가
   * 기존과 동일하게 동작하는지 확인
   */

  // --- manual 모드 ---

  it("manual 모드: accessKeyId, secretAccessKey, region이 올바르게 설정된다", () => {
    const settings = makeSettings({
      awsCredentialSource: "manual",
      awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      awsSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      awsRegion: "ap-northeast-2",
    });

    new BedrockClient(settings);

    const config = runtimeClientConfigs[0];
    expect(config.region).toBe("ap-northeast-2");
    expect(config.credentials).toEqual({
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });
  });

  it("manual 모드: API key 미들웨어가 주입되지 않는다", () => {
    const settings = makeSettings({
      awsCredentialSource: "manual",
      awsAccessKeyId: "test-key",
      awsSecretAccessKey: "test-secret",
    });

    new BedrockClient(settings);

    // 미들웨어가 추가되지 않아야 함
    expect(runtimeMiddlewares[0]).toHaveLength(0);
  });

  // --- apikey 모드 ---

  it("apikey 모드: 더미 credentials와 API key 미들웨어가 설정된다", () => {
    const settings = makeSettings({
      awsCredentialSource: "apikey",
      bedrockApiKey: "br-api-key-test",
      awsRegion: "us-east-1",
    });

    new BedrockClient(settings);

    const config = runtimeClientConfigs[0];
    // 더미 credentials
    expect(config.credentials).toEqual({
      accessKeyId: "apikey",
      secretAccessKey: "apikey",
    });
    // 미들웨어 주입 확인
    expect(runtimeMiddlewares[0]).toHaveLength(1);
    expect(runtimeMiddlewares[0][0].options.name).toBe("bedrockApiKeyAuth");
  });

  it("apikey 모드: 미들웨어가 Authorization 헤더를 Bearer 토큰으로 설정한다", async () => {
    const settings = makeSettings({
      awsCredentialSource: "apikey",
      bedrockApiKey: "my-api-key-value",
    });

    new BedrockClient(settings);

    // 미들웨어 핸들러를 직접 호출하여 동작 확인
    const middlewareHandler = runtimeMiddlewares[0][0].handler;
    const mockNext = vi.fn().mockResolvedValue({ response: {} });
    const mockArgs = {
      request: {
        headers: {
          "x-amz-date": "some-date",
          "x-amz-security-token": "some-token",
          "x-amz-content-sha256": "some-hash",
        },
      },
    };

    await middlewareHandler(mockNext)(mockArgs);

    // Bearer 토큰 설정 확인
    expect(mockArgs.request.headers["Authorization"]).toBe(
      "Bearer my-api-key-value"
    );
    // SigV4 헤더 제거 확인
    expect(mockArgs.request.headers["x-amz-date"]).toBeUndefined();
    expect(mockArgs.request.headers["x-amz-security-token"]).toBeUndefined();
    expect(mockArgs.request.headers["x-amz-content-sha256"]).toBeUndefined();
    // next가 호출되었는지 확인
    expect(mockNext).toHaveBeenCalledWith(mockArgs);
  });

  // --- env 모드 ---

  it("env 모드: credentials가 미지정되어 SDK 기본 체인을 사용한다", () => {
    const settings = makeSettings({
      awsCredentialSource: "env",
      awsRegion: "eu-central-1",
    });

    new BedrockClient(settings);

    const config = runtimeClientConfigs[0];
    expect(config.region).toBe("eu-central-1");
    // credentials가 설정되지 않아야 함 (SDK 기본 체인 사용)
    expect(config.credentials).toBeUndefined();
  });

  it("env 모드: API key 미들웨어가 주입되지 않는다", () => {
    const settings = makeSettings({
      awsCredentialSource: "env",
    });

    new BedrockClient(settings);

    expect(runtimeMiddlewares[0]).toHaveLength(0);
  });

  // --- updateSettings 후 클라이언트 재생성 ---

  it("updateSettings() 호출 시 새로운 설정으로 클라이언트가 재생성된다", () => {
    const initialSettings = makeSettings({
      awsCredentialSource: "manual",
      awsAccessKeyId: "old-key",
      awsSecretAccessKey: "old-secret",
      awsRegion: "us-east-1",
    });

    const client = new BedrockClient(initialSettings);
    expect(runtimeClientConfigs).toHaveLength(1);
    expect(runtimeClientConfigs[0].region).toBe("us-east-1");

    // 설정 변경
    const newSettings = makeSettings({
      awsCredentialSource: "env",
      awsRegion: "ap-southeast-1",
    });

    client.updateSettings(newSettings);
    expect(runtimeClientConfigs).toHaveLength(2);
    expect(runtimeClientConfigs[1].region).toBe("ap-southeast-1");
    expect(runtimeClientConfigs[1].credentials).toBeUndefined();
  });
});
