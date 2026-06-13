import { describe, it, expect, beforeEach } from "vitest";
import { getBranding, updateBranding, BRANDING } from "./branding";

// ============================================
// 단위 테스트: getBranding / updateBranding (Bedrock 단일)
// ============================================

describe("getBranding", () => {
  it("Bedrock(Assistant Kiro) 브랜딩을 반환한다", () => {
    const brand = getBranding();

    expect(brand.displayName).toBe("Assistant Kiro");
    expect(brand.icon.id).toBe("kiro-assistant");
    expect(brand.icon.svg).toBeTruthy();
    expect(brand.settingsTitle.en).toBe("Assistant Kiro Settings");
    expect(brand.settingsTitle.ko).toBe("Assistant Kiro 설정");
    expect(brand.settingsTitle.ja).toBe("Assistant Kiro 設定");
  });
});

describe("updateBranding", () => {
  beforeEach(() => {
    updateBranding();
  });

  it("호출 시 BRANDING.displayName이 Bedrock 브랜딩으로 유지된다", () => {
    expect(BRANDING.displayName).toBe("Assistant Kiro");

    updateBranding();

    expect(BRANDING.displayName).toBe("Assistant Kiro");
  });

  it("updateBranding 후 pluginId가 변경되지 않는다", () => {
    const originalPluginId = BRANDING.pluginId;

    updateBranding();
    expect(BRANDING.pluginId).toBe(originalPluginId);
  });

  it("updateBranding 후 viewType이 변경되지 않는다", () => {
    const originalViewType = BRANDING.viewType;

    updateBranding();
    expect(BRANDING.viewType).toBe(originalViewType);
  });
});

// ============================================
// BRANDING 구조 안정성 및 식별자 고정
// ============================================

describe("BRANDING 구조 안정성 및 식별자 고정", () => {
  beforeEach(() => {
    updateBranding();
  });

  it("updateBranding 호출 후 BRANDING은 모든 필수 필드를 가진다", () => {
    updateBranding();

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
  });

  it("updateBranding을 여러 번 호출해도 pluginId와 viewType은 고정값이다", () => {
    const originalPluginId = BRANDING.pluginId;
    const originalViewType = BRANDING.viewType;

    for (let i = 0; i < 5; i++) {
      updateBranding();
      expect(BRANDING.pluginId).toBe(originalPluginId);
      expect(BRANDING.viewType).toBe(originalViewType);
    }
  });

  it("updateBranding 후 displayName/icon/settingsTitle은 Bedrock 브랜딩과 일치한다", () => {
    updateBranding();

    const expectedBrand = getBranding();
    expect(BRANDING.displayName).toBe(expectedBrand.displayName);
    expect(BRANDING.icon.id).toBe(expectedBrand.icon.id);
    expect(BRANDING.settingsTitle).toEqual(expectedBrand.settingsTitle);
  });
});
