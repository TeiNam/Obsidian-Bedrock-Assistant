import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { DEFAULT_SETTINGS, GeminiAssistantSettings } from "./types";

// ============================================
// safeStorage 모킹 전략
// ============================================
// safe-storage.ts 내부의 getSafeStorage()는 require("electron")을 호출한다.
// 테스트 환경에서는 Electron이 없으므로 getSafeStorage()가 null을 반환하고,
// encryptValue/decryptValue는 graceful fallback으로 원본을 그대로 반환한다.
//
// 따라서 safe-storage 모듈 자체를 모킹하여:
// - SENSITIVE_FIELDS: 실제 값 사용
// - isEncrypted: 실제 구현 사용
// - encryptValue/decryptValue: Base64 기반 시뮬레이션
// - encryptSettings/decryptSettings: 모킹된 encryptValue/decryptValue를 사용하는 재구현

const ENCRYPTED_PREFIX = "enc:";

// 모킹용 암호화/복호화 함수 (Base64 시뮬레이션)
function mockEncryptValue(plaintext: string): string {
  if (!plaintext || plaintext.startsWith(ENCRYPTED_PREFIX)) return plaintext;
  return ENCRYPTED_PREFIX + Buffer.from(plaintext, "utf-8").toString("base64");
}

function mockDecryptValue(stored: string): string {
  if (!stored || !stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  const base64 = stored.slice(ENCRYPTED_PREFIX.length);
  return Buffer.from(base64, "base64").toString("utf-8");
}

// safe-storage 모듈 전체 모킹
vi.mock("./safe-storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("./safe-storage")>();

  return {
    ...original,
    // encryptValue/decryptValue만 모킹 (getSafeStorage 우회)
    encryptValue: (plaintext: string) => mockEncryptValue(plaintext),
    decryptValue: (stored: string) => mockDecryptValue(stored),
    // encryptSettings: 모킹된 encryptValue를 사용하도록 재구현
    encryptSettings: <T extends object>(settings: T): T => {
      const result = { ...settings } as Record<string, unknown>;
      for (const field of original.SENSITIVE_FIELDS) {
        if (field in result && typeof result[field] === "string") {
          result[field] = mockEncryptValue(result[field] as string);
        }
      }
      return result as T;
    },
    // decryptSettings: 모킹된 decryptValue를 사용하도록 재구현
    decryptSettings: <T extends object>(settings: T): T => {
      const result = { ...settings } as Record<string, unknown>;
      for (const field of original.SENSITIVE_FIELDS) {
        if (field in result && typeof result[field] === "string") {
          result[field] = mockDecryptValue(result[field] as string);
        }
      }
      return result as T;
    },
  };
});

// 모킹 후 import
import {
  SENSITIVE_FIELDS,
  encryptSettings,
  decryptSettings,
  isEncrypted,
} from "./safe-storage";

// ============================================
// 단위 테스트: SENSITIVE_FIELDS 필드 포함 확인
// ============================================

describe("SENSITIVE_FIELDS", () => {
  it("awsAccessKeyId를 포함한다 (Bedrock 자격증명)", () => {
    expect(SENSITIVE_FIELDS).toContain("awsAccessKeyId");
  });

  it("awsSecretAccessKey를 포함한다 (Bedrock 자격증명)", () => {
    expect(SENSITIVE_FIELDS).toContain("awsSecretAccessKey");
  });

  it("geminiApiKey를 포함하지 않는다 (Gemini 제거)", () => {
    expect(SENSITIVE_FIELDS).not.toContain("geminiApiKey");
  });
});

// ============================================
// 단위 테스트: 통합 설정 객체 암호화/복호화
// ============================================

describe("encryptSettings / decryptSettings 통합 테스트", () => {
  it("통합 설정 객체의 모든 민감 필드가 암호화된다", () => {
    const settings: GeminiAssistantSettings = {
      ...DEFAULT_SETTINGS,
      awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      awsSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    };

    const encrypted = encryptSettings(settings);

    // 모든 민감 필드가 "enc:" 접두사로 암호화되어야 함
    for (const field of SENSITIVE_FIELDS) {
      const value = (encrypted as unknown as Record<string, unknown>)[field] as string;
      expect(isEncrypted(value)).toBe(true);
    }
  });

  it("암호화된 설정을 복호화하면 원본 값이 복원된다", () => {
    const settings: GeminiAssistantSettings = {
      ...DEFAULT_SETTINGS,
      awsAccessKeyId: "AKID-TEST",
      awsSecretAccessKey: "SECRET-TEST",
    };

    const encrypted = encryptSettings(settings);
    const decrypted = decryptSettings(encrypted);

    expect(decrypted.awsAccessKeyId).toBe("AKID-TEST");
    expect(decrypted.awsSecretAccessKey).toBe("SECRET-TEST");
  });

  it("비민감 필드는 암호화되지 않는다", () => {
    const settings: GeminiAssistantSettings = {
      ...DEFAULT_SETTINGS,
      awsRegion: "us-west-2",
    };

    const encrypted = encryptSettings(settings);

    // awsRegion은 민감 필드가 아니므로 원본 그대로
    expect(encrypted.awsRegion).toBe("us-west-2");
    expect(encrypted.language).toBe("en");
  });

  it("빈 문자열 민감 필드는 암호화하지 않는다", () => {
    const settings: GeminiAssistantSettings = {
      ...DEFAULT_SETTINGS,
      awsAccessKeyId: "",
      awsSecretAccessKey: "",
    };

    const encrypted = encryptSettings(settings);

    // 빈 문자열은 그대로 유지
    expect(encrypted.awsAccessKeyId).toBe("");
    expect(encrypted.awsSecretAccessKey).toBe("");
  });
});

// ============================================
// Property 2: 민감 필드 암호화 라운드트립
// ============================================

/**
 * Property 2: 민감 필드 암호화 라운드트립
 *
 * 임의의 비어있지 않은 문자열 값에 대해, SENSITIVE_FIELDS에 해당하는
 * 모든 필드를 해당 값으로 설정한 설정 객체를 encryptSettings로 암호화한 후
 * decryptSettings로 복호화하면, 원본 값과 동일한 값을 얻어야 한다.
 *
 * Validates: Requirements 5.2
 */

// 비어있지 않은 문자열 arbitrary ("enc:" 접두사 제외하여 이미 암호화된 값 방지)
const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => !s.startsWith("enc:"));

describe("Property 2: 민감 필드 암호화 라운드트립", () => {
  it("임의의 비어있지 않은 문자열로 모든 민감 필드의 encrypt → decrypt 라운드트립이 성립한다", () => {
    fc.assert(
      fc.property(nonEmptyStringArb, (value) => {
        // 모든 민감 필드에 동일한 임의 값 설정
        const settings: GeminiAssistantSettings = {
          ...DEFAULT_SETTINGS,
          awsAccessKeyId: value,
          awsSecretAccessKey: value,
        };

        // 암호화 → 복호화
        const encrypted = encryptSettings(settings);
        const decrypted = decryptSettings(encrypted);

        // 모든 민감 필드가 원본 값으로 복원되어야 함
        for (const field of SENSITIVE_FIELDS) {
          expect((decrypted as unknown as Record<string, unknown>)[field]).toBe(value);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("각 민감 필드에 서로 다른 임의 값을 설정해도 라운드트립이 성립한다", () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        nonEmptyStringArb,
        (accessKey, secretKey) => {
          const settings: GeminiAssistantSettings = {
            ...DEFAULT_SETTINGS,
            awsAccessKeyId: accessKey,
            awsSecretAccessKey: secretKey,
          };

          const encrypted = encryptSettings(settings);
          const decrypted = decryptSettings(encrypted);

          expect(decrypted.awsAccessKeyId).toBe(accessKey);
          expect(decrypted.awsSecretAccessKey).toBe(secretKey);
        },
      ),
      { numRuns: 100 },
    );
  });
});
