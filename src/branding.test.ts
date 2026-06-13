import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getBranding, updateBranding, BRANDING, BrandingConfig } from "./branding";

// ============================================
// 단위 테스트: getBranding / updateBranding
// ============================================

describe("getBranding", () => {
  it("'bedrock' 전달 시 Bedrock 브랜딩을 반환한다", () => {
    const brand = getBranding("bedrock");

    expect(brand.displayName).toBe("Bedrock Assistant");
    expect(brand.icon.id).toBe("bedrock-assistant");
    expect(brand.icon.svg).toBeTruthy();
    expect(brand.settingsTitle.en).toBe("Bedrock Assistant Settings");
    expect(brand.settingsTitle.ko).toBe("Bedrock Assistant 설정");
    expect(brand.settingsTitle.ja).toBe("Bedrock Assistant 設定");
  });

  it("'gemini' 전달 시 Gemini 브랜딩을 반환한다", () => {
    const brand = getBranding("gemini");

    expect(brand.displayName).toBe("Gemini Assistant");
    expect(brand.icon.id).toBe("gemini-assistant");
    expect(brand.icon.svg).toBeTruthy();
    expect(brand.settingsTitle.en).toBe("Gemini Assistant Settings");
    expect(brand.settingsTitle.ko).toBe("Gemini Assistant 설정");
    expect(brand.settingsTitle.ja).toBe("Gemini Assistant 設定");
  });
});

describe("updateBranding", () => {
  // 각 테스트 전에 BRANDING을 기본 상태(bedrock)로 복원
  beforeEach(() => {
    updateBranding("bedrock");
  });

  it("'bedrock'로 호출 시 BRANDING.displayName이 변경된다", () => {
    expect(BRANDING.displayName).toBe("Bedrock Assistant");

    updateBranding("bedrock");

    expect(BRANDING.displayName).toBe("Bedrock Assistant");
  });

  it("'gemini'로 호출 시 BRANDING.displayName이 변경된다", () => {
    expect(BRANDING.displayName).toBe("Bedrock Assistant");

    updateBranding("gemini");

    expect(BRANDING.displayName).toBe("Gemini Assistant");
  });

  it("updateBranding 후 pluginId가 변경되지 않는다", () => {
    const originalPluginId = BRANDING.pluginId;

    updateBranding("bedrock");
    expect(BRANDING.pluginId).toBe(originalPluginId);

    updateBranding("gemini");
    expect(BRANDING.pluginId).toBe(originalPluginId);
  });

  it("updateBranding 후 viewType이 변경되지 않는다", () => {
    const originalViewType = BRANDING.viewType;

    updateBranding("bedrock");
    expect(BRANDING.viewType).toBe(originalViewType);

    updateBranding("gemini");
    expect(BRANDING.viewType).toBe(originalViewType);
  });
});

// ============================================
// Property 6: BRANDING 구조 안정성 및 식별자 고정
// ============================================

/**
 * Property 6: BRANDING 구조 안정성 및 식별자 고정
 *
 * 임의의 유효한 aiBackend 값에 대해, updateBranding(aiBackend)를 호출한 후
 * BRANDING 객체는 pluginId, displayName, viewType, files, icon, settingsTitle
 * 필드를 모두 가져야 하며, pluginId와 viewType은 호출 전과 동일한 값이어야 한다.
 *
 * Validates: Requirements 8.1, 9.1
 */

// aiBackend 값을 생성하는 arbitrary
const aiBackendArb = fc.constantFrom("bedrock" as const, "gemini" as const);

describe("Property 6: BRANDING 구조 안정성 및 식별자 고정", () => {
  // 각 테스트 전에 BRANDING을 기본 상태로 복원
  beforeEach(() => {
    updateBranding("bedrock");
  });

  it("임의의 aiBackend로 updateBranding 호출 후 BRANDING은 모든 필수 필드를 가진다", () => {
    fc.assert(
      fc.property(aiBackendArb, (aiBackend) => {
        updateBranding(aiBackend);

        // BrandingConfig의 모든 최상위 필드 존재 확인
        expect(BRANDING).toHaveProperty("pluginId");
        expect(BRANDING).toHaveProperty("displayName");
        expect(BRANDING).toHaveProperty("viewType");
        expect(BRANDING).toHaveProperty("files");
        expect(BRANDING).toHaveProperty("icon");
        expect(BRANDING).toHaveProperty("settingsTitle");

        // 각 필드의 타입 검증
        expect(typeof BRANDING.pluginId).toBe("string");
        expect(typeof BRANDING.displayName).toBe("string");
        expect(typeof BRANDING.viewType).toBe("string");
        expect(typeof BRANDING.files).toBe("object");
        expect(typeof BRANDING.icon).toBe("object");
        expect(typeof BRANDING.settingsTitle).toBe("object");

        // files 하위 필드 존재 확인
        expect(BRANDING.files).toHaveProperty("index");
        expect(BRANDING.files).toHaveProperty("chatHistory");
        expect(BRANDING.files).toHaveProperty("sessions");
        expect(BRANDING.files).toHaveProperty("sessionsBackup");

        // icon 하위 필드 존재 확인
        expect(BRANDING.icon).toHaveProperty("id");
        expect(BRANDING.icon).toHaveProperty("svg");

        // settingsTitle 하위 필드 존재 확인
        expect(BRANDING.settingsTitle).toHaveProperty("en");
        expect(BRANDING.settingsTitle).toHaveProperty("ko");
        expect(BRANDING.settingsTitle).toHaveProperty("ja");
      }),
      { numRuns: 100 },
    );
  });

  it("임의의 aiBackend로 updateBranding 호출 후 pluginId와 viewType은 고정값이다", () => {
    fc.assert(
      fc.property(aiBackendArb, (aiBackend) => {
        // 호출 전 값 저장
        const pluginIdBefore = BRANDING.pluginId;
        const viewTypeBefore = BRANDING.viewType;

        updateBranding(aiBackend);

        // pluginId와 viewType은 변경되지 않아야 함
        expect(BRANDING.pluginId).toBe(pluginIdBefore);
        expect(BRANDING.viewType).toBe(viewTypeBefore);
      }),
      { numRuns: 100 },
    );
  });

  it("연속적인 백엔드 전환에서도 pluginId와 viewType은 고정값이다", () => {
    fc.assert(
      fc.property(
        fc.array(aiBackendArb, { minLength: 2, maxLength: 10 }),
        (backends) => {
          // 초기 고정값 저장
          const originalPluginId = BRANDING.pluginId;
          const originalViewType = BRANDING.viewType;

          // 연속적으로 백엔드를 전환
          for (const backend of backends) {
            updateBranding(backend);

            expect(BRANDING.pluginId).toBe(originalPluginId);
            expect(BRANDING.viewType).toBe(originalViewType);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("updateBranding 후 displayName은 해당 백엔드의 브랜딩과 일치한다", () => {
    fc.assert(
      fc.property(aiBackendArb, (aiBackend) => {
        updateBranding(aiBackend);

        const expectedBrand = getBranding(aiBackend);
        expect(BRANDING.displayName).toBe(expectedBrand.displayName);
        expect(BRANDING.icon.id).toBe(expectedBrand.icon.id);
        expect(BRANDING.settingsTitle).toEqual(expectedBrand.settingsTitle);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================
// Property 12: 브랜딩 전환 및 고정 필드 불변
// ============================================

/**
 * Property 12: 브랜딩 전환 및 고정 필드 불변
 *
 * 임의의 aiBackend 값(4값: "bedrock"/"gemini"/"openai"/"ollama")에 대해,
 * getBranding은 비어 있지 않은 displayName/icon/settingsTitle(en/ko/ja 모두)을
 * 반환하고, updateBranding 호출 후에도 BRANDING의 고정 필드
 * (pluginId, viewType, files)는 변경되지 않는다.
 *
 * Validates: Requirements 11.1, 11.2, 11.3
 */

// Feature: multi-provider-ai-backends, Property 12: 브랜딩 전환 및 고정 필드 불변

// 4값 전체 union을 포함하는 aiBackend arbitrary
const aiBackend4Arb = fc.constantFrom(
  "bedrock" as const,
  "gemini" as const,
  "openai" as const,
  "ollama" as const,
);

describe("Property 12: 브랜딩 전환 및 고정 필드 불변", () => {
  // 각 테스트 전에 BRANDING을 기본 상태(bedrock)로 복원
  beforeEach(() => {
    updateBranding("bedrock");
  });

  it("4값 모든 aiBackend에 대해 getBranding은 비어 있지 않은 displayName/icon/settingsTitle(en/ko/ja)을 반환한다", () => {
    fc.assert(
      fc.property(aiBackend4Arb, (aiBackend) => {
        const brand = getBranding(aiBackend);

        // displayName 비어 있지 않음
        expect(typeof brand.displayName).toBe("string");
        expect(brand.displayName.length).toBeGreaterThan(0);

        // icon: id와 svg 모두 비어 있지 않음
        expect(typeof brand.icon.id).toBe("string");
        expect(brand.icon.id.length).toBeGreaterThan(0);
        expect(brand.icon.svg).toBeTruthy();
        expect((brand.icon.svg ?? "").length).toBeGreaterThan(0);

        // settingsTitle: en/ko/ja 모두 비어 있지 않음
        for (const lang of ["en", "ko", "ja"] as const) {
          expect(typeof brand.settingsTitle[lang]).toBe("string");
          expect(brand.settingsTitle[lang].length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("4값 모든 aiBackend로 updateBranding 호출 후 BRANDING 고정 필드(pluginId/viewType/files)는 불변이다", () => {
    fc.assert(
      fc.property(aiBackend4Arb, (aiBackend) => {
        // 호출 전 고정 필드 값을 캡처 (files는 깊은 비교를 위해 복사)
        const pluginIdBefore = BRANDING.pluginId;
        const viewTypeBefore = BRANDING.viewType;
        const filesBefore = { ...BRANDING.files };

        updateBranding(aiBackend);

        // 고정 필드는 호출 전과 동일해야 함
        expect(BRANDING.pluginId).toBe(pluginIdBefore);
        expect(BRANDING.viewType).toBe(viewTypeBefore);
        expect(BRANDING.files).toEqual(filesBefore);
      }),
      { numRuns: 100 },
    );
  });

  it("4값 임의 전환 시퀀스에서도 고정 필드(pluginId/viewType/files)는 불변이다", () => {
    fc.assert(
      fc.property(
        fc.array(aiBackend4Arb, { minLength: 2, maxLength: 12 }),
        (backends) => {
          // 초기 고정 필드 캡처
          const pluginIdBefore = BRANDING.pluginId;
          const viewTypeBefore = BRANDING.viewType;
          const filesBefore = { ...BRANDING.files };

          // 연속적으로 4값 백엔드를 전환하며 매 전환마다 고정 필드 불변 검증
          for (const backend of backends) {
            updateBranding(backend);

            expect(BRANDING.pluginId).toBe(pluginIdBefore);
            expect(BRANDING.viewType).toBe(viewTypeBefore);
            expect(BRANDING.files).toEqual(filesBefore);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================
// 단위 테스트(예시): OpenAI/Ollama settingsTitle i18n 키 완전성
// ============================================

/**
 * Task 7.3 — 브랜딩 i18n/불변 예시 단위 테스트
 *
 * OpenAI/Ollama 백엔드의 settingsTitle이 en/ko/ja 세 언어 키를 모두
 * 정의하고 각 값이 비어 있지 않은지 구체적인 예시로 검증한다.
 *
 * Validates: Requirements 11.2
 */
describe("OpenAI/Ollama settingsTitle i18n 키 완전성 (예시)", () => {
  it("'openai' settingsTitle은 en/ko/ja 키를 모두 가지며 기대값과 일치한다", () => {
    const brand = getBranding("openai");

    // 세 언어 키가 모두 존재하는지 확인
    expect(brand.settingsTitle).toHaveProperty("en");
    expect(brand.settingsTitle).toHaveProperty("ko");
    expect(brand.settingsTitle).toHaveProperty("ja");

    // 각 언어별 기대 문자열 검증
    expect(brand.settingsTitle.en).toBe("OpenAI Assistant Settings");
    expect(brand.settingsTitle.ko).toBe("OpenAI Assistant 설정");
    expect(brand.settingsTitle.ja).toBe("OpenAI Assistant 設定");
  });

  it("'ollama' settingsTitle은 en/ko/ja 키를 모두 가지며 기대값과 일치한다", () => {
    const brand = getBranding("ollama");

    // 세 언어 키가 모두 존재하는지 확인
    expect(brand.settingsTitle).toHaveProperty("en");
    expect(brand.settingsTitle).toHaveProperty("ko");
    expect(brand.settingsTitle).toHaveProperty("ja");

    // 각 언어별 기대 문자열 검증
    expect(brand.settingsTitle.en).toBe("Ollama Assistant Settings");
    expect(brand.settingsTitle.ko).toBe("Ollama Assistant 설정");
    expect(brand.settingsTitle.ja).toBe("Ollama Assistant 設定");
  });

  it("'openai'/'ollama' settingsTitle의 모든 언어 값은 비어 있지 않다", () => {
    // 두 백엔드 × 세 언어 조합에 대해 비어 있지 않은 문자열인지 단언
    for (const backend of ["openai", "ollama"] as const) {
      const { settingsTitle } = getBranding(backend);
      for (const lang of ["en", "ko", "ja"] as const) {
        expect(typeof settingsTitle[lang]).toBe("string");
        expect(settingsTitle[lang].length).toBeGreaterThan(0);
      }
    }
  });

  it("updateBranding('openai'/'ollama') 후 BRANDING.settingsTitle도 en/ko/ja를 모두 가진다", () => {
    for (const backend of ["openai", "ollama"] as const) {
      updateBranding(backend);

      // updateBranding 적용 후 BRANDING의 settingsTitle 키 완전성 확인
      expect(BRANDING.settingsTitle).toHaveProperty("en");
      expect(BRANDING.settingsTitle).toHaveProperty("ko");
      expect(BRANDING.settingsTitle).toHaveProperty("ja");

      // getBranding 결과와 동일해야 함
      expect(BRANDING.settingsTitle).toEqual(getBranding(backend).settingsTitle);
    }

    // 후속 테스트에 영향을 주지 않도록 기본값(bedrock)으로 복원
    updateBranding("bedrock");
  });
});

// ============================================
// 정적 검증(예시): branding.ts는 manifest/package/README를 참조하지 않음
// ============================================

/**
 * Task 7.3 — branding.ts 소스 정적 참조 금지 검증
 *
 * branding.ts 소스 파일을 문자열로 읽어, 브랜치 고유 브랜딩 파일
 * (manifest.json, package.json, README)에 대한 참조 문자열이 포함되어
 * 있지 않음을 정적으로 단언한다. 이는 브랜딩 모듈이 해당 파일들을
 * 변경/참조하지 않는다는 요구사항을 코드 수준에서 보장한다.
 *
 * Validates: Requirements 11.4
 */
describe("branding.ts 정적 참조 금지 검증 (예시)", () => {
  // branding.ts 소스 내용을 한 번 읽어 재사용 (테스트 파일과 동일 디렉터리)
  const brandingSource = readFileSync(resolve(__dirname, "branding.ts"), "utf-8");
  // 대소문자 무시 비교를 위해 소문자 버전도 준비
  const brandingSourceLower = brandingSource.toLowerCase();

  it("branding.ts 소스에 'manifest' 참조가 없다", () => {
    expect(brandingSourceLower).not.toContain("manifest");
  });

  it("branding.ts 소스에 'package.json' 참조가 없다", () => {
    expect(brandingSourceLower).not.toContain("package.json");
  });

  it("branding.ts 소스에 'README' 참조가 없다", () => {
    expect(brandingSourceLower).not.toContain("readme");
  });
});
