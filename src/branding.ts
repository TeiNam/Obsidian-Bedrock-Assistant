// ============================================
// 브랜딩 설정 (브랜치별로 이 파일만 다르게 유지)
// ============================================
// .gitattributes에서 merge=ours로 설정되어 있어
// 머지 시 각 브랜치의 브랜딩이 자동으로 보존됩니다.

export const BRANDING = {
  /** 플러그인 ID (폴더명, MCP clientInfo 등) */
  pluginId: "assistant-gemini",

  /** UI에 표시되는 플러그인 이름 */
  displayName: "Gemini Assistant",

  /** 옵시디언 뷰 타입 식별자 */
  viewType: "assistant-gemini-view",

  /** 볼트 내 데이터 파일 경로 */
  files: {
    index: ".assistant-gemini-index.json",
    chatHistory: ".assistant-gemini-chat.json",
    sessions: ".assistant-gemini-sessions.json",
    sessionsBackup: ".assistant-gemini-sessions.json.bak",
  },

  /** 아이콘 설정 */
  icon: {
    /** 아이콘 등록 ID */
    id: "gemini-assistant",
    /** 커스텀 SVG (null이면 옵시디언 내장 아이콘 사용) — Gemini 스파크 아이콘 */
    svg: `<svg viewBox="0 0 65 65" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z" fill="currentColor"/></svg>`,
  },

  /** 설정 탭 타이틀 (I18N) */
  settingsTitle: {
    en: "Gemini Assistant Settings",
    ko: "Gemini Assistant 설정",
    ja: "Gemini Assistant 設定",
  },
} as const;
