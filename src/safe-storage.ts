/**
 * Electron safeStorage 래퍼 모듈
 *
 * OS 키체인(macOS Keychain, Windows DPAPI, Linux libsecret)을 활용하여
 * 민감한 문자열을 암복호화합니다.
 * 암호화된 데이터는 Base64 문자열로 data.json에 저장됩니다.
 *
 * safeStorage를 사용할 수 없는 환경에서는 평문 그대로 반환합니다 (graceful fallback).
 */

// 암호화된 값 식별 접두사
const ENCRYPTED_PREFIX = "enc:";

/** 암호화할 설정 필드 목록 */
export const SENSITIVE_FIELDS = [
  "geminiApiKey",
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
 * 설정 객체의 민감한 필드들을 암호화하여 새 객체로 반환
 * 원본 객체를 변경하지 않습니다.
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
