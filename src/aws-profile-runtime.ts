/**
 * aws-profile-runtime.ts
 *
 * aws-profile.ts가 요구하는 ProfileDeps의 실제(런타임) 구현.
 * Node.js fs/path/os와 Obsidian requestUrl에 의존하므로 순수 파싱 로직과 분리한다.
 */

import { requestUrl } from "obsidian";
import { splitCommand } from "./aws-profile";
import type { AwsCredentials, ProfileDeps } from "./aws-profile";

/* eslint-disable @typescript-eslint/no-var-requires */
declare const require: (id: string) => any;

const nodeFs: any = (() => {
  try {
    return require("fs");
  } catch {
    return null;
  }
})();
const nodePath: any = (() => {
  try {
    return require("path");
  } catch {
    return null;
  }
})();
const nodeOs: any = (() => {
  try {
    return require("os");
  } catch {
    return null;
  }
})();
const nodeChildProcess: any = (() => {
  try {
    return require("child_process");
  } catch {
    return null;
  }
})();

/**
 * SSO portal의 GetRoleCredentials를 호출해 임시 자격증명을 받는다.
 * 이 엔드포인트는 SigV4 서명이 아니라 SSO 액세스 토큰(Bearer 유사 헤더)으로
 * 인증하므로 SDK 없이 단순 GET 요청으로 처리할 수 있다.
 * requestUrl을 사용해 CORS 제약을 피한다.
 */
async function getRoleCredentials(args: {
  ssoRegion: string;
  accessToken: string;
  accountId: string;
  roleName: string;
}): Promise<AwsCredentials> {
  const url =
    `https://portal.sso.${encodeURIComponent(args.ssoRegion)}.amazonaws.com/federation/credentials` +
    `?account_id=${encodeURIComponent(args.accountId)}` +
    `&role_name=${encodeURIComponent(args.roleName)}`;

  const response = await requestUrl({
    url,
    method: "GET",
    headers: { "x-amz-sso_bearer_token": args.accessToken },
    // 4xx에서도 본문을 읽어 사용자에게 원인을 전달하기 위해 예외를 억제한다.
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `SSO 자격증명 발급 실패 (HTTP ${response.status}). 'aws sso login'을 다시 실행하거나 계정/역할 설정을 확인하세요`
    );
  }

  // requestUrl의 json 접근자는 본문이 JSON이 아니면 예외를 던지므로 감싼다.
  let creds: Record<string, unknown> | undefined;
  try {
    creds = (response.json as { roleCredentials?: Record<string, unknown> })?.roleCredentials;
  } catch {
    throw new Error("SSO 응답을 해석할 수 없습니다 (JSON 아님)");
  }
  if (typeof creds?.accessKeyId !== "string" || typeof creds?.secretAccessKey !== "string") {
    throw new Error("SSO 응답에 자격증명이 없습니다");
  }

  return {
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    ...(typeof creds.sessionToken === "string" ? { sessionToken: creds.sessionToken } : {}),
    // expiration은 epoch milliseconds로 내려온다.
    ...(typeof creds.expiration === "number" ? { expiration: new Date(creds.expiration) } : {}),
  };
}

/** 런타임 ProfileDeps 구현. Node 모듈이 없는 환경에서는 빈 결과를 반환한다. */
export const runtimeProfileDeps: ProfileDeps = {
  readTextFile(path: string): string | null {
    if (!nodeFs) return null;
    try {
      return nodeFs.readFileSync(path, "utf-8");
    } catch {
      return null;
    }
  },
  listFiles(dir: string): string[] {
    if (!nodeFs || !nodePath) return [];
    try {
      return (nodeFs.readdirSync(dir) as string[]).map((f) => nodePath.join(dir, f));
    } catch {
      return [];
    }
  },
  joinPath(...parts: string[]): string {
    return nodePath ? nodePath.join(...parts) : parts.join("/");
  },
  homeDir(): string {
    return nodeOs?.homedir?.() ?? "";
  },
  getRoleCredentials,
  runProcess(command: string): string {
    if (!nodeChildProcess) throw new Error("이 환경에서는 credential_process를 실행할 수 없습니다");
    const argv = splitCommand(command);
    if (argv.length === 0) throw new Error("credential_process 명령이 비어 있습니다");
    // 셸을 거치지 않는다(execFileSync) — 명령 문자열이 셸 확장·주입 대상이 되지 않는다.
    // 그래서 ~ 나 $HOME 은 확장되지 않으니 config에는 절대 경로를 적어야 한다.
    return nodeChildProcess.execFileSync(argv[0], argv.slice(1), {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    }) as string;
  },

  now(): number {
    return Date.now();
  },
};

/**
 * `~/.aws/config` · `~/.aws/credentials`에 정의된 프로필 이름 목록을 반환한다.
 * 설정 UI의 프로필 드롭다운을 채우는 데 사용한다. 읽기 실패 시 빈 배열.
 */
export function listProfileNames(deps: ProfileDeps = runtimeProfileDeps): string[] {
  const home = deps.homeDir();
  if (!home) return [];
  const names = new Set<string>();

  const configText = deps.readTextFile(deps.joinPath(home, ".aws", "config"));
  for (const match of (configText ?? "").matchAll(/^\[(?:profile\s+)?([^\]\s][^\]]*)\]/gm)) {
    const name = match[1].trim();
    // sso-session 섹션은 프로필이 아니다.
    if (name.startsWith("sso-session ")) continue;
    names.add(name);
  }

  const credentialsText = deps.readTextFile(deps.joinPath(home, ".aws", "credentials"));
  for (const match of (credentialsText ?? "").matchAll(/^\[([^\]\s][^\]]*)\]/gm)) {
    names.add(match[1].trim());
  }

  return Array.from(names).sort();
}
