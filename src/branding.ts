// ============================================
// 브랜딩 설정 (브랜치별로 이 파일만 다르게 유지)
// ============================================
// .gitattributes에서 merge=ours로 설정되어 있어
// 머지 시 각 브랜치의 브랜딩이 자동으로 보존됩니다.

export const BRANDING = {
  /** 플러그인 ID (폴더명, MCP clientInfo 등) */
  pluginId: "bedrock-assistant",

  /** UI에 표시되는 플러그인 이름 */
  displayName: "Bedrock Assistant",

  /** 옵시디언 뷰 타입 식별자 */
  viewType: "bedrock-assistant-view",

  /** 볼트 내 데이터 파일 경로 */
  files: {
    index: ".bedrock-assistant-index.json",
    chatHistory: ".bedrock-assistant-chat.json",
    sessions: ".bedrock-assistant-sessions.json",
    sessionsBackup: ".bedrock-assistant-sessions.json.bak",
  },

  /** 아이콘 설정 */
  icon: {
    /** 아이콘 등록 ID (내장 아이콘 사용) */
    id: "bot",
    /** 커스텀 SVG (null이면 옵시디언 내장 아이콘 사용) */
    svg: null as string | null,
  },

  /** 설정 탭 타이틀 (I18N) */
  settingsTitle: {
    en: "Bedrock Assistant Settings",
    ko: "Bedrock Assistant 설정",
  },
} as const;
