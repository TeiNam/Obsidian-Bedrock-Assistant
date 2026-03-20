// ============================================
// 회고 명령 감지 모듈
// ============================================
// 채팅 뷰에서 사용자 메시지가 회고 명령인지 판별하는 순수 함수.
// settings.language와 무관하게 한/영/일 모든 키워드를 동시 인식한다.

/**
 * 회고 명령 키워드 목록 (한/영/일 동시 인식)
 * 모든 키워드는 소문자로 저장하여 대소문자 무시 비교에 사용한다.
 */
export const RETROSPECTIVE_KEYWORDS: readonly string[] = [
  // 한국어
  "회고",
  "오늘의 회고",
  "오늘 회고",
  "회고 해줘",
  "회고해줘",
  // 영어
  "retrospective",
  "daily retrospective",
  // 일본어
  "振り返り",
  "今日の振り返り",
];

/**
 * 메시지가 회고 명령인지 판별한다.
 * trim 후 소문자 변환하여 키워드 목록과 정확 매칭(exact match)한다.
 * 부분 매칭은 허용하지 않는다.
 *
 * @param text - 사용자 입력 메시지
 * @returns 회고 명령이면 true, 아니면 false
 */
export function isRetrospectiveCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return RETROSPECTIVE_KEYWORDS.includes(normalized);
}
