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

/** Bedrock 백엔드 브랜딩 (AWS 아이콘) */
const BEDROCK_BRANDING: SwitchableBranding = {
  displayName: "Bedrock Assistant",
  icon: {
    id: "bedrock-assistant",
    /** Lucide bot-message-square 아이콘 (챗봇) */
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6V2H8"/><path d="m8 18-4 4V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2Z"/><path d="M2 12h2"/><path d="M9 11v2"/><path d="M15 11v2"/><path d="M20 12h2"/></svg>`,
  },
  settingsTitle: {
    en: "Bedrock Assistant Settings",
    ko: "Bedrock Assistant 설정",
    ja: "Bedrock Assistant 設定",
  },
};

/** Gemini 백엔드 브랜딩 (Gemini 스파크 아이콘) */
const GEMINI_BRANDING: SwitchableBranding = {
  displayName: "Gemini Assistant",
  icon: {
    id: "gemini-assistant",
    /** gemini-icon.svg 기반 Gemini 스파크 아이콘 */
    svg: `<svg fill="currentColor" fill-rule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"/></svg>`,
  },
  settingsTitle: {
    en: "Gemini Assistant Settings",
    ko: "Gemini Assistant 설정",
    ja: "Gemini Assistant 設定",
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
  pluginId: "bedrock-assistant",

  /** UI에 표시되는 플러그인 이름 */
  displayName: "Bedrock Assistant",

  /** 옵시디언 뷰 타입 식별자 — 고정값 */
  viewType: "bedrock-assistant-view",

  /** 볼트 내 데이터 파일 경로 — 고정값 */
  files: {
    index: ".bedrock-assistant-index.json",
    chatHistory: ".bedrock-assistant-chat.json",
    sessions: ".bedrock-assistant-sessions.json",
    sessionsBackup: ".bedrock-assistant-sessions.json.bak",
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