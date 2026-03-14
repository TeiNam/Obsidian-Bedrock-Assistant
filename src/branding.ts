// ============================================
// 브랜딩 설정 (브랜치별로 이 파일만 다르게 유지)
// ============================================
// .gitattributes에서 merge=ours로 설정되어 있어
// 머지 시 각 브랜치의 브랜딩이 자동으로 보존됩니다.
//
// AI 백엔드 통합: getBranding() / updateBranding()으로
// 백엔드에 따라 displayName, icon, settingsTitle을 동적 전환합니다.
// pluginId, viewType, files는 백엔드와 무관하게 고정됩니다.

/** 브랜딩 설정 타입 (플러그인 전체에서 사용) */
export interface BrandingConfig {
  pluginId: string;
  displayName: string;
  viewType: string;
  files: {
    index: string;
    chatHistory: string;
    sessions: string;
    sessionsBackup: string;
  };
  icon: {
    id: string;
    svg: string | null;
  };
  settingsTitle: {
    en: string;
    ko: string;
    ja: string;
  };
}

/** 백엔드별 전환 가능한 브랜딩 필드 (displayName, icon, settingsTitle) */
type SwitchableBranding = Pick<BrandingConfig, "displayName" | "icon" | "settingsTitle">;

/** Bedrock 백엔드 브랜딩 (Kiro 아이콘 유지) */
const BEDROCK_BRANDING: SwitchableBranding = {
  displayName: "Assistant Kiro",
  icon: {
    id: "kiro-assistant",
    /** 커스텀 Kiro SVG 아이콘 */
    svg: `<svg viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="m" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#m)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="currentColor"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="currentColor"/></g></svg>`,
  },
  settingsTitle: {
    en: "Assistant Kiro Settings",
    ko: "Assistant Kiro 설정",
    ja: "Assistant Kiro 設定",
  },
};

/** Gemini 백엔드 브랜딩 (Gemini 스파크 아이콘) */
const GEMINI_BRANDING: SwitchableBranding = {
  displayName: "Assistant Kiro (Gemini)",
  icon: {
    id: "gemini-assistant",
    /** google-gemini-icon.svg 기반 Gemini 스파크 아이콘 */
    svg: `<svg viewBox="0 0 65 65" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z" fill="currentColor"/></svg>`,
  },
  settingsTitle: {
    en: "Assistant Kiro Settings (Gemini)",
    ko: "Assistant Kiro 설정 (Gemini)",
    ja: "Assistant Kiro 設定 (Gemini)",
  },
};

// ============================================
// 백엔드에 따라 브랜딩을 반환하는 함수
// ============================================

/**
 * 지정된 AI 백엔드에 해당하는 브랜딩(displayName, icon, settingsTitle)을 반환한다.
 * pluginId, viewType, files는 포함하지 않음 (고정값이므로).
 */
export function getBranding(aiBackend: "bedrock" | "gemini"): SwitchableBranding {
  return aiBackend === "bedrock" ? BEDROCK_BRANDING : GEMINI_BRANDING;
}

// ============================================
// BRANDING: 기본 내보내기 (초기값 Bedrock, updateBranding으로 전환)
// ============================================
// let으로 선언하되 참조 자체는 변경하지 않고 Object.assign으로 내부 값만 갱신
// → 기존 import 코드가 깨지지 않음

export let BRANDING: BrandingConfig = {
  /** 플러그인 ID (폴더명, MCP clientInfo 등) — 고정값 */
  pluginId: "assistant-kiro",

  /** UI에 표시되는 플러그인 이름 */
  displayName: "Assistant Kiro",

  /** 옵시디언 뷰 타입 식별자 — 고정값 */
  viewType: "assistant-kiro-view",

  /** 볼트 내 데이터 파일 경로 — 고정값 */
  files: {
    index: ".assistant-kiro-index.json",
    chatHistory: ".assistant-kiro-chat.json",
    sessions: ".assistant-kiro-sessions.json",
    sessionsBackup: ".assistant-kiro-sessions.json.bak",
  },

  /** 아이콘 설정 */
  icon: { ...BEDROCK_BRANDING.icon },

  /** 설정 탭 타이틀 (I18N) */
  settingsTitle: { ...BEDROCK_BRANDING.settingsTitle },
};

// ============================================
// updateBranding: BRANDING 객체의 전환 가능한 필드만 갱신
// ============================================

/**
 * BRANDING 객체의 displayName, icon, settingsTitle을 지정된 백엔드에 맞게 갱신한다.
 * pluginId, viewType, files는 변경하지 않음 (고정값).
 * Object.assign으로 내부 값만 갱신하므로 기존 import 참조가 유지된다.
 */
export function updateBranding(aiBackend: "bedrock" | "gemini"): void {
  const brand = getBranding(aiBackend);
  Object.assign(BRANDING, {
    displayName: brand.displayName,
    icon: { ...brand.icon },
    settingsTitle: { ...brand.settingsTitle },
  });
}