import { describe, it, expect } from "vitest";
import {
  loadProfileCredentials,
  parseIni,
  pickSsoToken,
  resolveProfile,
  type AwsCredentials,
  type ProfileDeps,
} from "./aws-profile";

// ============================================
// parseIni
// ============================================
describe("parseIni: AWS ini 파싱", () => {
  it("섹션과 키-값을 파싱하고 공백을 제거한다", () => {
    const ini = `
[default]
aws_access_key_id = AKIA123
aws_secret_access_key=secret456
`;
    expect(parseIni(ini)).toEqual({
      default: { aws_access_key_id: "AKIA123", aws_secret_access_key: "secret456" },
    });
  });

  it("주석(#, ;)과 빈 줄을 무시한다", () => {
    const ini = `
# 주석
; 다른 주석
[dev]
region = us-west-2
`;
    expect(parseIni(ini)).toEqual({ dev: { region: "us-west-2" } });
  });

  it("profile 접두사가 붙은 섹션명을 그대로 보존한다", () => {
    expect(parseIni("[profile work]\nregion = ap-northeast-2")).toEqual({
      "profile work": { region: "ap-northeast-2" },
    });
  });

  it("섹션 밖의 키는 버린다", () => {
    expect(parseIni("orphan = 1\n[a]\nb = 2")).toEqual({ a: { b: "2" } });
  });

  it("같은 섹션이 반복되면 키를 병합한다", () => {
    expect(parseIni("[a]\nx = 1\n[a]\ny = 2")).toEqual({ a: { x: "1", y: "2" } });
  });

  it("빈 입력은 빈 객체다", () => {
    expect(parseIni("")).toEqual({});
  });

  it("공백이 선행하는 인라인 주석을 값에서 제거한다", () => {
    // AWS CLI는 ` #` / ` ;` 부터를 주석으로 본다
    expect(parseIni("[a]\naws_access_key_id = AKIA123 # work key")).toEqual({
      a: { aws_access_key_id: "AKIA123" },
    });
    expect(parseIni("[a]\nregion = us-east-1 ; 주석")).toEqual({ a: { region: "us-east-1" } });
  });

  it("공백 없이 붙은 #은 값의 일부로 보존한다", () => {
    // 시크릿에 #이 포함될 수 있으므로 잘라내면 인증이 깨진다
    expect(parseIni("[a]\naws_secret_access_key = abc#def")).toEqual({
      a: { aws_secret_access_key: "abc#def" },
    });
  });

  it("인용된 섹션명의 따옴표를 제거하고 공백을 정규화한다", () => {
    expect(parseIni('[sso-session "team session"]\nsso_region = us-east-1')).toEqual({
      "sso-session team session": { sso_region: "us-east-1" },
    });
    expect(parseIni('[profile   "my  profile"]\nregion = x')).toEqual({
      "profile my profile": { region: "x" },
    });
  });
});

// ============================================
// resolveProfile
// ============================================
describe("resolveProfile: 프로필 자격증명 방식 판별", () => {
  it("credentials 파일의 정적 자격증명을 인식한다", () => {
    const creds = parseIni("[default]\naws_access_key_id=AK\naws_secret_access_key=SK");
    expect(resolveProfile("default", {}, creds)).toEqual({
      kind: "static",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
  });

  it("세션 토큰이 있으면 함께 반환한다", () => {
    const creds = parseIni(
      "[tmp]\naws_access_key_id=AK\naws_secret_access_key=SK\naws_session_token=TOKEN"
    );
    expect(resolveProfile("tmp", {}, creds)).toEqual({
      kind: "static",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      sessionToken: "TOKEN",
    });
  });

  it("config 파일의 정적 자격증명도 인식한다 (profile 접두사 처리)", () => {
    const config = parseIni("[profile work]\naws_access_key_id=AK\naws_secret_access_key=SK");
    const result = resolveProfile("work", config, {});
    expect(result.kind).toBe("static");
  });

  it("credentials 파일이 config 파일보다 우선한다", () => {
    const config = parseIni("[profile p]\naws_access_key_id=CONFIG\naws_secret_access_key=S1");
    const creds = parseIni("[p]\naws_access_key_id=CREDS\naws_secret_access_key=S2");
    expect(resolveProfile("p", config, creds)).toMatchObject({ accessKeyId: "CREDS" });
  });

  it("sso_session 간접 참조 프로필을 인식한다", () => {
    const config = parseIni(`
[profile sso-dev]
sso_session = my-sso
sso_account_id = 111122223333
sso_role_name = PowerUser

[sso-session my-sso]
sso_start_url = https://example.awsapps.com/start
sso_region = us-east-1
`);
    expect(resolveProfile("sso-dev", config, {})).toEqual({
      kind: "sso",
      startUrl: "https://example.awsapps.com/start",
      ssoRegion: "us-east-1",
      accountId: "111122223333",
      roleName: "PowerUser",
    });
  });

  it("레거시 인라인 SSO 프로필도 인식한다", () => {
    const config = parseIni(`
[profile legacy]
sso_start_url = https://legacy.awsapps.com/start
sso_region = ap-northeast-2
sso_account_id = 999988887777
sso_role_name = ReadOnly
`);
    expect(resolveProfile("legacy", config, {})).toMatchObject({
      kind: "sso",
      ssoRegion: "ap-northeast-2",
    });
  });

  it("SSO 프로필에 sso_region이 없으면 미지원으로 처리한다", () => {
    const config = parseIni(`
[profile broken]
sso_start_url = https://x.awsapps.com/start
sso_account_id = 1
sso_role_name = R
`);
    expect(resolveProfile("broken", config, {})).toMatchObject({ kind: "unsupported" });
  });

  it("존재하지 않는 프로필은 미지원 + 이유를 반환한다", () => {
    const result = resolveProfile("ghost", {}, {});
    expect(result.kind).toBe("unsupported");
    expect((result as { reason: string }).reason).toContain("ghost");
  });

  it("credential_process / role_arn 프로필은 미지원임을 명시한다", () => {
    const cp = resolveProfile("a", parseIni("[profile a]\ncredential_process = /bin/x"), {});
    expect(cp).toMatchObject({ kind: "unsupported" });
    const ra = resolveProfile("b", parseIni("[profile b]\nrole_arn = arn:aws:iam::1:role/R"), {});
    expect(ra).toMatchObject({ kind: "unsupported" });
  });

  it("공백이 포함된 인용 프로필명도 해석한다", () => {
    const config = parseIni(`
[profile "my work"]
sso_session = "team session"
sso_account_id = 42
sso_role_name = Dev

[sso-session "team session"]
sso_start_url = https://q.awsapps.com/start
sso_region = eu-west-1
`);
    expect(resolveProfile("my work", config, {})).toEqual({
      kind: "sso",
      startUrl: "https://q.awsapps.com/start",
      ssoRegion: "eu-west-1",
      accountId: "42",
      roleName: "Dev",
    });
  });

  it("빈 프로필 이름은 default로 해석한다", () => {
    const creds = parseIni("[default]\naws_access_key_id=AK\naws_secret_access_key=SK");
    expect(resolveProfile("", {}, creds).kind).toBe("static");
  });
});

// ============================================
// pickSsoToken
// ============================================
describe("pickSsoToken: SSO 캐시 토큰 선택", () => {
  const NOW = 1_700_000_000_000;
  const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
  const START = "https://example.awsapps.com/start";

  it("start URL이 일치하고 만료되지 않은 토큰을 고른다", () => {
    const token = pickSsoToken(
      [{ startUrl: START, accessToken: "T1", expiresAt: iso(60_000) }],
      START,
      NOW
    );
    expect(token?.accessToken).toBe("T1");
  });

  it("만료된 토큰은 선택하지 않는다", () => {
    expect(
      pickSsoToken([{ startUrl: START, accessToken: "OLD", expiresAt: iso(-1000) }], START, NOW)
    ).toBeNull();
  });

  it("start URL이 다른 토큰은 선택하지 않는다", () => {
    expect(
      pickSsoToken(
        [{ startUrl: "https://other/start", accessToken: "X", expiresAt: iso(60_000) }],
        START,
        NOW
      )
    ).toBeNull();
  });

  it("유효한 토큰이 여러 개면 만료가 가장 늦은 것을 고른다", () => {
    const token = pickSsoToken(
      [
        { startUrl: START, accessToken: "EARLY", expiresAt: iso(60_000) },
        { startUrl: START, accessToken: "LATE", expiresAt: iso(600_000) },
      ],
      START,
      NOW
    );
    expect(token?.accessToken).toBe("LATE");
  });

  it("expiresAt이 없거나 파싱 불가한 항목은 무시한다", () => {
    expect(
      pickSsoToken(
        [
          { startUrl: START, accessToken: "NO_EXP" },
          { startUrl: START, accessToken: "BAD", expiresAt: "not-a-date" },
        ],
        START,
        NOW
      )
    ).toBeNull();
  });

  it("accessToken이 없는 항목은 무시한다", () => {
    expect(pickSsoToken([{ startUrl: START, expiresAt: iso(60_000) }], START, NOW)).toBeNull();
  });

  it("빈 목록은 null이다", () => {
    expect(pickSsoToken([], START, NOW)).toBeNull();
  });
});

// ============================================
// loadProfileCredentials (의존성 주입)
// ============================================
/** 테스트용 ProfileDeps 생성. files는 절대경로 → 내용 맵. */
function makeDeps(
  files: Record<string, string>,
  overrides: Partial<ProfileDeps> = {}
): ProfileDeps {
  return {
    readTextFile: (p) => files[p] ?? null,
    listFiles: (dir) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`)),
    joinPath: (...parts) => parts.join("/"),
    homeDir: () => "/home/u",
    getRoleCredentials: async () => {
      throw new Error("호출되지 않아야 함");
    },
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe("loadProfileCredentials: 프로필 → 자격증명 해석", () => {
  it("정적 프로필은 파일 내용을 그대로 반환한다", async () => {
    const deps = makeDeps({
      "/home/u/.aws/credentials": "[default]\naws_access_key_id=AK\naws_secret_access_key=SK",
    });
    await expect(loadProfileCredentials("default", deps)).resolves.toEqual({
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
  });

  it("설정 파일이 모두 없으면 명확한 오류를 던진다", async () => {
    await expect(loadProfileCredentials("default", makeDeps({}))).rejects.toThrow(/\.aws/);
  });

  it("SSO 프로필은 캐시 토큰으로 임시 자격증명을 발급받는다", async () => {
    const expected: AwsCredentials = {
      accessKeyId: "ASIA",
      secretAccessKey: "TMP",
      sessionToken: "TOK",
    };
    let receivedToken = "";
    const deps = makeDeps(
      {
        "/home/u/.aws/config":
          "[profile sso]\nsso_start_url=https://x/start\nsso_region=us-east-1\nsso_account_id=1\nsso_role_name=R",
        "/home/u/.aws/sso/cache/a.json": JSON.stringify({
          startUrl: "https://x/start",
          accessToken: "CACHED",
          expiresAt: new Date(1_700_000_600_000).toISOString(),
        }),
      },
      {
        getRoleCredentials: async ({ accessToken }) => {
          receivedToken = accessToken;
          return expected;
        },
      }
    );

    await expect(loadProfileCredentials("sso", deps)).resolves.toEqual(expected);
    expect(receivedToken).toBe("CACHED");
  });

  it("SSO 토큰이 만료되면 aws sso login 안내 오류를 던진다", async () => {
    const deps = makeDeps({
      "/home/u/.aws/config":
        "[profile sso]\nsso_start_url=https://x/start\nsso_region=us-east-1\nsso_account_id=1\nsso_role_name=R",
      "/home/u/.aws/sso/cache/a.json": JSON.stringify({
        startUrl: "https://x/start",
        accessToken: "OLD",
        expiresAt: new Date(1_600_000_000_000).toISOString(),
      }),
    });
    await expect(loadProfileCredentials("sso", deps)).rejects.toThrow(/aws sso login/);
  });

  it("손상된 캐시 파일은 건너뛰고 나머지에서 토큰을 찾는다", async () => {
    const deps = makeDeps(
      {
        "/home/u/.aws/config":
          "[profile sso]\nsso_start_url=https://x/start\nsso_region=us-east-1\nsso_account_id=1\nsso_role_name=R",
        "/home/u/.aws/sso/cache/broken.json": "{ not json",
        "/home/u/.aws/sso/cache/good.json": JSON.stringify({
          startUrl: "https://x/start",
          accessToken: "GOOD",
          expiresAt: new Date(1_700_000_600_000).toISOString(),
        }),
      },
      {
        getRoleCredentials: async ({ accessToken }) => ({
          accessKeyId: accessToken,
          secretAccessKey: "S",
        }),
      }
    );
    await expect(loadProfileCredentials("sso", deps)).resolves.toMatchObject({
      accessKeyId: "GOOD",
    });
  });

  it("미지원 프로필은 이유를 담아 오류를 던진다", async () => {
    const deps = makeDeps({
      "/home/u/.aws/config": "[profile x]\nrole_arn=arn:aws:iam::1:role/R",
    });
    await expect(loadProfileCredentials("x", deps)).rejects.toThrow(/role_arn/);
  });
});
