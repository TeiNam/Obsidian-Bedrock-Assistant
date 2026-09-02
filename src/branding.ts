// ============================================
// 브랜딩 설정
// ============================================
// AI 백엔드 통합: getBranding() / updateBranding()으로
// 백엔드(Bedrock, Gemini, OpenAI, Ollama)에 따라 displayName, icon,
// settingsTitle을 런타임에 동적으로 전환합니다.
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
    /**
     * 커스텀 Kiro 마스코트 아이콘. 폐기된 kiro-edition에서 가져왔다(태그
     * kiro-edition-final). 보라 배경에 흰 마스코트라 currentColor를 쓰는 다른
     * 프로바이더 아이콘과 시각적으로 확실히 구분된다.
     *
     * mask id는 `kiro-mask`로 고유하게 둔다. 원본의 `m`처럼 짧은 id를 쓰면
     * addIcon이 SVG를 문서에 주입할 때 다른 아이콘·플러그인의 동명 id와
     * 충돌해 마스크가 엉뚱한 그래픽에 적용될 수 있다.
     */
    svg: `<svg viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="kiro-mask" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#kiro-mask)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="currentColor"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="currentColor"/></g></svg>`,
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
  /**
   * 플러그인 ID (폴더명, MCP clientInfo 등) — 고정값.
   * 플러그인 매니페스트의 `id`와 반드시 같아야 한다. 이 값으로 플러그인 폴더
   * 경로(`{configDir}/plugins/{pluginId}/`)를 계산하기 때문이다.
   */
  pluginId: "agent-llms",

  /** UI에 표시되는 플러그인 이름 (백엔드에 따라 updateBranding으로 전환됨) */
  displayName: "Bedrock Assistant",

  /** 옵시디언 뷰 타입 식별자 — 고정값 */
  viewType: "agent-llms-view",

  /**
   * 볼트 내 데이터 파일 경로 — 고정값.
   * `.{pluginId}{접미사}` 규칙을 지켜야 한다. migration.ts의
   * legacyDataFileNames가 같은 규칙으로 마이그레이션 대상 경로를 만들기 때문에,
   * 여기서 규칙을 깨면 레거시 데이터가 엉뚱한 곳으로 복사된다.
   */
  files: {
    index: ".agent-llms-index.json",
    chatHistory: ".agent-llms-chat.json",
    sessions: ".agent-llms-sessions.json",
    sessionsBackup: ".agent-llms-sessions.json.bak",
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