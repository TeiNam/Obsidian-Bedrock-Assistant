// ============================================
// 브랜딩 설정 (브랜치별로 이 파일만 다르게 유지)
// ============================================
// .gitattributes에서 merge=ours로 설정되어 있어
// 머지 시 각 브랜치의 브랜딩이 자동으로 보존됩니다.
//
// AI 백엔드 통합: getBranding() / updateBranding()으로
// 백엔드에 따라 displayName, icon, settingsTitle을 동적 전환합니다.
// pluginId, viewType, files는 백엔드와 무관하게 고정됩니다.

// aiBackend union(4값)을 단일 출처에서 참조하기 위해 타입 전용 import 사용
// (types.ts는 branding을 import하지 않으므로 순환 의존 없음)
import type { GeminiAssistantSettings } from "./types";

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

/** OpenAI 백엔드 브랜딩 (AI 두뇌 회로 아이콘) */
const OPENAI_BRANDING: SwitchableBranding = {
  displayName: "OpenAI Assistant",
  icon: {
    id: "openai-assistant",
    /** OpenAI 공식 로고 (blossom 매듭) — currentColor 단색 fill 인라인 SVG */
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.985 5.985 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
  },
  settingsTitle: {
    en: "OpenAI Assistant Settings",
    ko: "OpenAI Assistant 설정",
    ja: "OpenAI Assistant 設定",
  },
};

/** Ollama 백엔드 브랜딩 (로컬/셀프호스트 서버 아이콘) */
const OLLAMA_BRANDING: SwitchableBranding = {
  displayName: "Ollama Assistant",
  icon: {
    id: "ollama-assistant",
    /** Ollama 알파카(라마) 라인 아이콘 — currentColor 인라인 SVG */
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6.5C8.3 5.2 8.1 3.8 8.6 2.7c1 .2 1.8 1.3 2.1 2.7"/><path d="M15 6.5c.7-1.3.9-2.7.4-3.8-1 .2-1.8 1.3-2.1 2.7"/><path d="M10.7 5.4C8.4 5.7 6.7 7.7 6.7 10.1v.6c-.9.6-1.2 1.9-1.2 3.4 0 2.2.1 4.4.6 5.7.3.8.9 1.3 1.6 1.3"/><path d="M13.3 5.4c2.3.3 4 2.3 4 4.7v.6c.9.6 1.2 1.9 1.2 3.4 0 2.2-.1 4.4-.6 5.7-.3.8-.9 1.3-1.6 1.3"/><path d="M8.5 21.1h7"/><circle cx="10" cy="10" r=".6" fill="currentColor" stroke="none"/><circle cx="14" cy="10" r=".6" fill="currentColor" stroke="none"/><path d="M9.8 12.5c0-1.2 1-2 2.2-2s2.2.8 2.2 2-1 2.3-2.2 2.3-2.2-1.1-2.2-2.3z"/><path d="M12 12.6v1"/><path d="M11.3 12.2c.4.3 1 .3 1.4 0"/></svg>`,
  },
  settingsTitle: {
    en: "Ollama Assistant Settings",
    ko: "Ollama Assistant 설정",
    ja: "Ollama Assistant 設定",
  },
};

// ============================================
// 백엔드에 따라 브랜딩을 반환하는 함수
// ============================================

/**
 * 지정된 AI 백엔드에 해당하는 브랜딩(displayName, icon, settingsTitle)을 반환한다.
 * pluginId, viewType, files는 포함하지 않음 (고정값이므로).
 * aiBackend는 4값 union("bedrock" | "gemini" | "openai" | "ollama")이며,
 * 정의되지 않은 값은 Gemini 브랜딩으로 폴백한다(factory 폴백 정책과 일관).
 */
export function getBranding(aiBackend: GeminiAssistantSettings["aiBackend"]): SwitchableBranding {
  switch (aiBackend) {
    case "bedrock":
      return BEDROCK_BRANDING;
    case "openai":
      return OPENAI_BRANDING;
    case "ollama":
      return OLLAMA_BRANDING;
    case "gemini":
    default:
      return GEMINI_BRANDING;
  }
}

// ============================================
// BRANDING: 기본 내보내기 (초기값 Bedrock, updateBranding으로 전환)
// ============================================
// let으로 선언하되 참조 자체는 변경하지 않고 Object.assign으로 내부 값만 갱신
// → 기존 import 코드가 깨지지 않음

export let BRANDING: BrandingConfig = {
  /** 플러그인 ID (폴더명, MCP clientInfo 등) — 고정값 */
  pluginId: "obsidian-ai-assistant",

  /** UI에 표시되는 플러그인 이름 (백엔드에 따라 updateBranding으로 전환됨) */
  displayName: "Bedrock Assistant",

  /** 옵시디언 뷰 타입 식별자 — 고정값 */
  viewType: "obsidian-ai-assistant-view",

  /** 볼트 내 데이터 파일 경로 — 고정값 */
  files: {
    index: ".obsidian-ai-assistant-index.json",
    chatHistory: ".obsidian-ai-assistant-chat.json",
    sessions: ".obsidian-ai-assistant-sessions.json",
    sessionsBackup: ".obsidian-ai-assistant-sessions.json.bak",
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
export function updateBranding(aiBackend: GeminiAssistantSettings["aiBackend"]): void {
  const brand = getBranding(aiBackend);
  Object.assign(BRANDING, {
    displayName: brand.displayName,
    icon: { ...brand.icon },
    settingsTitle: { ...brand.settingsTitle },
  });
}