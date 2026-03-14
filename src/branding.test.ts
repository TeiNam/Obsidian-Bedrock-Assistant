import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { getBranding, updateBranding, BRANDING, BrandingConfig } from "./branding";

// ============================================
// 단위 테스트: getBranding / updateBranding
// ============================================

describe("getBranding", () => {
  it("'bedrock' 전달 시 Bedrock 브랜딩을 반환한다", () => {
    const brand = getBranding("bedrock");

    expect(brand.displayName).toBe("Assistant Kiro");
    expect(brand.icon.id).toBe("kiro-assistant");
    expect(brand.icon.svg).toBeTruthy();
    expect(brand.settingsTitle.en).toBe("Assistant Kiro Settings");
    expect(brand.settingsTitle.ko).toBe("Assistant Kiro 설정");
    expect(brand.settingsTitle.ja).toBe("Assistant Kiro 設定");
  });

  it("'gemini' 전달 시 Gemini 브랜딩을 반환한다", () => {
    const brand = getBranding("gemini");

    expect(brand.displayName).toBe("Assistant Gemini");
    expect(brand.icon.id).toBe("gemini-assistant");
    expect(brand.icon.svg).toBeTruthy();
    expect(brand.settingsTitle.en).toBe("Assistant Gemini Settings");
    expect(brand.settingsTitle.ko).toBe("Assistant Gemini 설정");
    expect(brand.settingsTitle.ja).toBe("Assistant Gemini 設定");
  });
});

describe("updateBranding", () => {
  // 각 테스트 전에 BRANDING을 기본 상태(bedrock)로 복원
  beforeEach(() => {
    updateBranding("bedrock");
  });

  it("'bedrock'로 호출 시 BRANDING.displayName이 변경된다", () => {
    expect(BRANDING.displayName).toBe("Assistant Kiro");

    updateBranding("bedrock");

    expect(BRANDING.displayName).toBe("Assistant Kiro");
  });

  it("'gemini'로 호출 시 BRANDING.displayName이 변경된다", () => {
    expect(BRANDING.displayName).toBe("Assistant Kiro");

    updateBranding("gemini");

    expect(BRANDING.displayName).toBe("Assistant Gemini");
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
