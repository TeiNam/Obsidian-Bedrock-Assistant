/**
 * aws-profile.ts
 *
 * `~/.aws/config` · `~/.aws/credentials` 프로필을 읽어 Bedrock 호출용 자격증명을
 * 해석한다. AWS SDK의 fromIni 자격증명 공급자를 번들에 넣으면 최소화 기준
 * 232KB가 늘어나므로(현재 번들 516KB), 필요한 두 경로만 직접 구현한다.
 *
 *  1) 정적 자격증명 프로필 — credentials/config 파일의 aws_access_key_id 등
 *  2) SSO 프로필 — 사용자가 터미널에서 `aws sso login`을 이미 수행해
 *     `~/.aws/sso/cache`에 유효한 액세스 토큰이 있는 경우, SSO portal의
 *     GetRoleCredentials를 호출해 임시 자격증명을 받는다.
 *
 * 플러그인 안에서 SSO 디바이스 인증 플로우(브라우저 로그인)를 진행하지는 않는다.
 * 토큰이 없거나 만료됐으면 `aws sso login`을 다시 실행하도록 안내한다.
 *
 * 파싱 로직은 순수 함수로 분리해 단위 테스트하고, 파일 읽기/네트워크는
 * 주입받는 의존성(ProfileDeps)으로 격리한다.
 */

// === ini 파싱 ===

/** ini 파일의 한 섹션(키-값 쌍). */
export type IniSection = Record<string, string>;
/** ini 파일 전체(섹션명 → 섹션). */
export type IniFile = Record<string, IniSection>;

/**
 * AWS ini 형식 텍스트를 파싱한다.
 * `#`/`;` 주석과 빈 줄은 무시하고, 섹션명·키·값의 앞뒤 공백을 제거한다.
 * 중첩 속성(예: `[services]` 하위 블록)은 이 플러그인에서 사용하지 않으므로
 * 들여쓰기 여부를 구분하지 않고 같은 섹션의 평면 키로 취급한다.
 *
 * AWS CLI 호환을 위해 두 가지를 함께 처리한다.
 *  - 인라인 주석: 값 뒤의 ` #`/` ;`(앞에 공백이 있는 경우)부터는 주석으로 버린다.
 *    공백 없이 붙은 `#`은 값의 일부다(시크릿에 등장할 수 있으므로 보존).
 *  - 인용된 섹션명: `[sso-session "team session"]`의 따옴표를 제거해 정규화한다.
 */
export function parseIni(text: string): IniFile {
  const result: IniFile = {};
  let current: IniSection | null = null;

  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    // 주석 제거: 줄 시작이 #/; 이면 전체를 건너뛴다.
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const sectionMatch = /^\[([^\]]+)\]/.exec(line);
    if (sectionMatch) {
      const name = normalizeSectionName(sectionMatch[1]);
      // 같은 섹션이 두 번 등장하면 뒤의 키가 앞의 값을 덮어쓴다(AWS CLI 동작).
      current = result[name] ?? {};
      result[name] = current;
      continue;
    }

    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = stripInlineComment(line.slice(eq + 1)).trim();
    if (key) current[key] = value;
  }

  return result;
}

/**
 * 섹션명을 정규화한다.
 * `profile "my profile"` / `sso-session "team session"`처럼 인용된 이름의 따옴표를
 * 제거하고 내부 공백을 하나로 줄여, 조회 시 사용하는 키 형식과 일치시킨다.
 */
function normalizeSectionName(raw: string): string {
  return raw
    .trim()
    .replace(/"([^"]*)"|'([^']*)'/g, (_m, dq, sq) => dq ?? sq)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 값에서 인라인 주석을 제거한다.
 * AWS CLI는 공백이 선행하는 `#`/`;`부터를 주석으로 본다. 공백 없이 붙은 경우는
 * 값의 일부이므로(base64 시크릿 등) 남긴다.
 */
function stripInlineComment(rawValue: string): string {
  const match = /\s[#;]/.exec(rawValue);
  return match ? rawValue.slice(0, match.index) : rawValue;
}

// === 프로필 해석 ===

/** 정적 자격증명 프로필 해석 결과. */
export interface StaticProfile {
  kind: "static";
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** SSO 프로필 해석 결과(토큰 조회에 필요한 정보). */
export interface SsoProfile {
  kind: "sso";
  startUrl: string;
  ssoRegion: string;
  accountId: string;
  roleName: string;
}

/** 지원하지 않는 프로필(예: credential_process, role_arn 체이닝). */
export interface UnsupportedProfile {
  kind: "unsupported";
  /** 사용자에게 보여줄 이유. */
  reason: string;
}

export type ResolvedProfile = StaticProfile | SsoProfile | UnsupportedProfile;

/** config 파일에서 해당 프로필의 섹션명을 구한다(default는 접두사 없음). */
function configSectionName(profileName: string): string {
  const name = normalizeSectionName(profileName);
  return name === "default" ? "default" : `profile ${name}`;
}

/**
 * 프로필 이름으로 자격증명 획득 방식을 판별한다.
 * credentials 파일이 config 파일보다 우선한다(AWS CLI와 동일한 우선순위).
 * SSO 프로필은 `sso_session` 간접 참조(`[sso-session <name>]`)와
 * 레거시 인라인 형식(프로필에 sso_start_url 직접 기재) 모두를 지원한다.
 */
export function resolveProfile(
  profileName: string,
  config: IniFile,
  credentials: IniFile
): ResolvedProfile {
  const name = (profileName || "").trim() || "default";
  const fromCreds = credentials[name] ?? {};
  const fromConfig = config[configSectionName(name)] ?? {};
  // 같은 키가 양쪽에 있으면 credentials 파일 값을 사용한다.
  const merged: IniSection = { ...fromConfig, ...fromCreds };

  if (Object.keys(merged).length === 0) {
    return { kind: "unsupported", reason: `프로필 '${name}'을 찾을 수 없습니다` };
  }

  if (merged.aws_access_key_id && merged.aws_secret_access_key) {
    return {
      kind: "static",
      accessKeyId: merged.aws_access_key_id,
      secretAccessKey: merged.aws_secret_access_key,
      ...(merged.aws_session_token ? { sessionToken: merged.aws_session_token } : {}),
    };
  }

  // SSO: sso_session 간접 참조가 있으면 해당 섹션에서 start URL/리전을 읽는다.
  // 세션 이름도 섹션명과 같은 규칙으로 정규화해(따옴표·중복 공백 제거) 조회 키를 맞춘다.
  const sessionName = merged.sso_session ? normalizeSectionName(merged.sso_session) : "";
  const session = sessionName ? config[`sso-session ${sessionName}`] ?? {} : {};
  const startUrl = merged.sso_start_url || session.sso_start_url || "";
  const ssoRegion = merged.sso_region || session.sso_region || "";
  if (startUrl && merged.sso_account_id && merged.sso_role_name) {
    if (!ssoRegion) {
      return { kind: "unsupported", reason: `프로필 '${name}'에 sso_region이 없습니다` };
    }
    return {
      kind: "sso",
      startUrl,
      ssoRegion,
      accountId: merged.sso_account_id,
      roleName: merged.sso_role_name,
    };
  }

  if (merged.credential_process) {
    // ponytail: 외부 프로세스 실행은 지원하지 않는다. 필요해지면 child_process로 확장.
    return { kind: "unsupported", reason: `프로필 '${name}'의 credential_process는 지원하지 않습니다` };
  }
  if (merged.role_arn) {
    return { kind: "unsupported", reason: `프로필 '${name}'의 role_arn(역할 위임)은 지원하지 않습니다` };
  }

  return { kind: "unsupported", reason: `프로필 '${name}'에서 자격증명을 찾을 수 없습니다` };
}

// === SSO 캐시 토큰 선택 ===

/** `~/.aws/sso/cache`의 캐시 파일 하나(파싱된 JSON). */
export interface SsoCacheEntry {
  startUrl?: string;
  accessToken?: string;
  expiresAt?: string;
  region?: string;
}

/** 선택된 SSO 액세스 토큰. */
export interface SsoToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * SSO 캐시 항목 중 대상 start URL과 일치하고 아직 만료되지 않은 토큰을 고른다.
 * 캐시 파일명은 세션명/start URL의 SHA-1 해시라서 규칙이 버전마다 다르므로,
 * 해시를 재현하지 않고 내용의 startUrl로 매칭한다.
 * 여러 개가 유효하면 만료가 가장 늦은(가장 최근에 갱신된) 토큰을 사용한다.
 */
export function pickSsoToken(
  entries: readonly SsoCacheEntry[],
  startUrl: string,
  nowMs: number
): SsoToken | null {
  let best: SsoToken | null = null;
  for (const entry of entries) {
    if (!entry?.accessToken || entry.startUrl !== startUrl) continue;
    const expiresAtMs = Date.parse(entry.expiresAt ?? "");
    // 만료 시각이 없거나(파싱 실패) 이미 지난 토큰은 사용하지 않는다.
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) continue;
    if (!best || expiresAtMs > best.expiresAtMs) {
      best = { accessToken: entry.accessToken, expiresAtMs };
    }
  }
  return best;
}

// === 자격증명 해석 (파일/네트워크 의존성 주입) ===

/** SDK에 전달할 자격증명 형태. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** 임시 자격증명 만료 시각. SDK가 갱신 시점을 판단하는 데 사용한다. */
  expiration?: Date;
}

/** aws-profile 모듈이 필요로 하는 외부 의존성(테스트에서 대체 가능). */
export interface ProfileDeps {
  /** 파일 내용을 읽는다. 없으면 null. */
  readTextFile(path: string): string | null;
  /** 디렉터리의 파일 경로 목록을 반환한다. 없으면 빈 배열. */
  listFiles(dir: string): string[];
  /** 경로 결합(플랫폼 구분자 사용). */
  joinPath(...parts: string[]): string;
  /** 사용자 홈 디렉터리. */
  homeDir(): string;
  /** SSO portal GetRoleCredentials 호출. */
  getRoleCredentials(args: {
    ssoRegion: string;
    accessToken: string;
    accountId: string;
    roleName: string;
  }): Promise<AwsCredentials>;
  /** 현재 시각(ms). 만료 판정에 사용. */
  now(): number;
}

/**
 * 프로필 이름으로 자격증명을 해석한다.
 * 정적 자격증명은 즉시 반환하고, SSO 프로필은 캐시된 액세스 토큰으로
 * 임시 자격증명을 발급받는다. 실패 사유는 사용자가 조치할 수 있는 문구로 던진다.
 */
export async function loadProfileCredentials(
  profileName: string,
  deps: ProfileDeps
): Promise<AwsCredentials> {
  const home = deps.homeDir();
  const configText = deps.readTextFile(deps.joinPath(home, ".aws", "config")) ?? "";
  const credentialsText = deps.readTextFile(deps.joinPath(home, ".aws", "credentials")) ?? "";
  if (!configText && !credentialsText) {
    throw new Error("~/.aws/config 또는 ~/.aws/credentials 파일을 찾을 수 없습니다");
  }

  const resolved = resolveProfile(profileName, parseIni(configText), parseIni(credentialsText));

  if (resolved.kind === "unsupported") throw new Error(resolved.reason);
  if (resolved.kind === "static") {
    return {
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
      ...(resolved.sessionToken ? { sessionToken: resolved.sessionToken } : {}),
    };
  }

  // SSO: 캐시 디렉터리의 모든 항목을 읽어 start URL이 일치하는 유효 토큰을 찾는다.
  const cacheDir = deps.joinPath(home, ".aws", "sso", "cache");
  const entries: SsoCacheEntry[] = [];
  for (const file of deps.listFiles(cacheDir)) {
    if (!file.endsWith(".json")) continue;
    const text = deps.readTextFile(file);
    if (!text) continue;
    try {
      entries.push(JSON.parse(text) as SsoCacheEntry);
    } catch {
      // 손상된 캐시 파일은 건너뛴다.
    }
  }

  const token = pickSsoToken(entries, resolved.startUrl, deps.now());
  if (!token) {
    throw new Error(
      `SSO 토큰이 없거나 만료됐습니다. 터미널에서 'aws sso login --profile ${profileName}'을 실행하세요`
    );
  }

  return deps.getRoleCredentials({
    ssoRegion: resolved.ssoRegion,
    accessToken: token.accessToken,
    accountId: resolved.accountId,
    roleName: resolved.roleName,
  });
}
