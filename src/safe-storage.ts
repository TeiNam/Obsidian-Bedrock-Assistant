/**
 * Electron safeStorage 래퍼 모듈
 *
 * OS 키체인(macOS Keychain, Windows DPAPI, Linux libsecret)을 활용하여
 * 민감한 문자열을 암복호화합니다.
 * 암호화된 데이터는 Base64 문자열로 로컬 전용 파일에 저장됩니다.
 *
 * safeStorage를 사용할 수 없는 환경에서는 평문 그대로 반환합니다 (graceful fallback).
 *
 * --- iCloud 동기화 대응 ---
 * 민감한 키(Access Key, Secret Key, API Key)는 볼트 내 data.json이 아닌
 * Electron userData 경로(로컬 전용, iCloud 동기화 안 됨)에 별도 저장합니다.
 * 이렇게 하면 기기별 키체인으로 암호화된 값이 다른 기기로 전파되지 않습니다.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
declare const require: (id: string) => any;
declare class Buffer {
  static from(data: string, encoding: string): Buffer;
  toString(encoding: string): string;
}

// 암호화된 값 식별 접두사
const ENCRYPTED_PREFIX = "enc:";

// 로컬 전용 자격증명 파일명
const CREDENTIALS_FILE = "bedrock-assistant-credentials.json";

// Node.js 모듈 (Obsidian/Electron 런타임에서 사용 가능)
const nodeFs: any = (() => { try { return require("fs"); } catch { return null; } })();
const nodePath: any = (() => { try { return require("path"); } catch { return null; } })();

/** 암호화할 설정 필드 목록 (Gemini + Bedrock 자격증명) */
export const SENSITIVE_FIELDS = [
  "geminiApiKey",
  "awsAccessKeyId",
  "awsSecretAccessKey",
] as const;

/**
 * Electron safeStorage 모듈 가져오기 (런타임에서만 사용 가능)
 * 옵시디언 환경이 아니거나 safeStorage를 지원하지 않으면 null 반환
 */
function getSafeStorage(): { encryptString: (s: string) => Buffer; decryptString: (b: Buffer) => string; isEncryptionAvailable: () => boolean } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron");
    const ss = electron?.remote?.safeStorage ?? electron?.safeStorage;
    if (ss && typeof ss.isEncryptionAvailable === "function" && ss.isEncryptionAvailable()) {
      return ss;
    }
  } catch {
    // Electron 없는 환경 (테스트 등)
  }
  return null;
}

/**
 * Electron app.getPath('userData') 경로 가져오기
 * iCloud 동기화 대상이 아닌 로컬 전용 경로
 * 예: macOS → ~/Library/Application Support/obsidian
 */
function getLocalStoragePath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron");
    const app = electron?.remote?.app ?? electron?.app;
    if (app && typeof app.getPath === "function") {
      return app.getPath("userData");
    }
  } catch {
    // Electron 없는 환경
  }
  return null;
}

/**
 * 로컬 전용 자격증명 파일의 전체 경로 반환
 */
function getCredentialsFilePath(): string | null {
  const dir = getLocalStoragePath();
  if (!dir || !nodePath) return null;
  return nodePath.join(dir, CREDENTIALS_FILE);
}

/**
 * 값이 이미 암호화되어 있는지 판별
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * 문자열을 암호화하여 "enc:..." 형태의 Base64 문자열로 반환
 * safeStorage를 사용할 수 없으면 원본 그대로 반환
 * 빈 문자열이면 그대로 반환 (암호화 불필요)
 */
export function encryptValue(plaintext: string): string {
  if (!plaintext || isEncrypted(plaintext)) return plaintext;
  const ss = getSafeStorage();
  if (!ss) return plaintext;
  try {
    const encrypted = ss.encryptString(plaintext);
    return ENCRYPTED_PREFIX + encrypted.toString("base64");
  } catch {
    return plaintext;
  }
}

/**
 * "enc:..." 형태의 암호화된 문자열을 복호화하여 원본 반환
 * 암호화되지 않은 값이면 그대로 반환 (하위 호환)
 * safeStorage를 사용할 수 없으면 원본 그대로 반환
 */
export function decryptValue(stored: string): string {
  if (!stored || !isEncrypted(stored)) return stored;
  const ss = getSafeStorage();
  if (!ss) return stored;
  try {
    const base64 = stored.slice(ENCRYPTED_PREFIX.length);
    const buffer = Buffer.from(base64, "base64");
    return ss.decryptString(buffer);
  } catch {
    // 복호화 실패 시 원본 반환 (키체인 변경 등)
    return stored;
  }
}

/**
 * 설정 객체에서 민감한 필드를 제거하여 새 객체로 반환 (data.json 저장용)
 * iCloud로 동기화되는 data.json에는 키 정보가 포함되지 않도록 합니다.
 * 원본 객체를 변경하지 않습니다.
 */
export function stripSensitiveFields<T extends object>(settings: T): T {
  const result = { ...settings } as Record<string, unknown>;
  for (const field of SENSITIVE_FIELDS) {
    if (field in result) {
      result[field] = "";
    }
  }
  return result as T;
}

/**
 * 민감한 자격증명을 로컬 전용 파일에 암호화하여 저장
 * Electron userData 경로에 저장하므로 iCloud 동기화 대상이 아닙니다.
 */
export function saveCredentialsToLocal(settings: Record<string, unknown>): void {
  const filePath = getCredentialsFilePath();
  if (!filePath || !nodeFs) return;

  const credentials: Record<string, string> = {};
  for (const field of SENSITIVE_FIELDS) {
    const value = settings[field];
    if (typeof value === "string" && value) {
      credentials[field] = encryptValue(value);
    }
  }

  try {
    nodeFs.writeFileSync(filePath, JSON.stringify(credentials, null, 2), "utf-8");
  } catch (e) {
    console.error("자격증명 로컬 저장 실패:", e);
  }
}

/**
 * 로컬 전용 파일에서 자격증명을 읽어 복호화하여 반환
 * 파일이 없거나 읽기 실패 시 빈 객체 반환
 */
export function loadCredentialsFromLocal(): Record<string, string> {
  const filePath = getCredentialsFilePath();
  if (!filePath || !nodeFs) return {};

  try {
    if (!nodeFs.existsSync(filePath)) return {};
    const data = nodeFs.readFileSync(filePath, "utf-8");
    const credentials = JSON.parse(data) as Record<string, string>;

    // 복호화
    const result: Record<string, string> = {};
    for (const field of SENSITIVE_FIELDS) {
      if (credentials[field]) {
        result[field] = decryptValue(credentials[field]);
      }
    }
    return result;
  } catch (e) {
    console.error("자격증명 로컬 로드 실패:", e);
    return {};
  }
}

/**
 * 설정 객체의 민감한 필드들을 암호화하여 새 객체로 반환
 * 원본 객체를 변경하지 않습니다.
 * @deprecated data.json에 직접 저장하는 레거시 방식. 마이그레이션 호환용으로 유지.
 */
export function encryptSettings<T extends object>(settings: T): T {
  const result = { ...settings } as Record<string, unknown>;
  for (const field of SENSITIVE_FIELDS) {
    if (field in result && typeof result[field] === "string") {
      result[field] = encryptValue(result[field] as string);
    }
  }
  return result as T;
}

/**
 * 설정 객체의 민감한 필드들을 복호화하여 새 객체로 반환
 * 원본 객체를 변경하지 않습니다.
 * @deprecated data.json에서 직접 읽는 레거시 방식. 마이그레이션 호환용으로 유지.
 */
export function decryptSettings<T extends object>(settings: T): T {
  const result = { ...settings } as Record<string, unknown>;
  for (const field of SENSITIVE_FIELDS) {
    if (field in result && typeof result[field] === "string") {
      result[field] = decryptValue(result[field] as string);
    }
  }
  return result as T;
}
