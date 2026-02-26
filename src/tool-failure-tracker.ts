/**
 * 도구 실행 연속 실패 추적기 (REQ-4)
 *
 * 도구 실행 결과를 분석하여 연속 실패 횟수를 추적하고,
 * 임계값 초과 시 루프 중단 여부를 판단합니다.
 */

// 도구 실행 에러로 판별하는 접두사 목록
const ERROR_PREFIXES = [
  "Tool execution error:",
  "도구 실행 오류:",
];

/**
 * 도구 실행 결과가 에러인지 판별
 * @param result - 도구 실행 결과 문자열
 * @returns 에러 여부
 */
export function isToolError(result: string): boolean {
  return ERROR_PREFIXES.some((prefix) => result.startsWith(prefix));
}

/**
 * 연속 실패 카운터를 업데이트하고 중단 여부를 반환
 * @param currentCount - 현재 연속 실패 횟수
 * @param toolResult - 도구 실행 결과 문자열
 * @param maxFailures - 최대 허용 연속 실패 횟수 (기본값: 3)
 * @returns { count: 업데이트된 카운터, shouldStop: 중단 여부 }
 */
export function updateFailureCount(
  currentCount: number,
  toolResult: string,
  maxFailures = 3
): { count: number; shouldStop: boolean } {
  if (isToolError(toolResult)) {
    const newCount = currentCount + 1;
    return { count: newCount, shouldStop: newCount >= maxFailures };
  }
  // 성공 시 카운터 리셋
  return { count: 0, shouldStop: false };
}
