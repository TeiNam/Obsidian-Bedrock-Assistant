/**
 * 도구 실행 연속 실패 추적기 (REQ-4)
 *
 * 도구 실행 결과를 분석하여 연속 실패 횟수를 추적하고,
 * 임계값 초과 시 루프 중단 여부를 판단합니다.
 */

import { TOOL_I18N, toolI18n } from "./tool-result-i18n";
import type { Locale } from "./types";

/**
 * 도구 실행 에러로 판별하는 접두사 목록.
 *
 * **세 언어를 모두 담아야 한다.** 접두어는 화면에도 보이므로 사용자 언어를 따르는데,
 * 판별이 한 언어만 알면 언어를 바꾼 순간 실패가 성공으로 집계되고, 이전 언어로 저장된
 * 대화 히스토리를 복원할 때 실패 표시가 사라진다. 지난 버전의 접두어도 남겨둔다.
 */
const ERROR_PREFIXES = [
  TOOL_I18N.en.toolErrorPrefix,
  TOOL_I18N.ko.toolErrorPrefix,
  TOOL_I18N.ja.toolErrorPrefix,
];

/**
 * 도구 실패 문자열을 한 가지 계약으로 만든다.
 *
 * 접두어는 `isToolError`가 되읽는 표식이면서 동시에 사용자가 읽는 텍스트다
 * (chat-view가 도구 결과 문자열을 그대로 표시한다). 언어를 넘기지 않으면 en을 쓴다.
 */
export function formatToolError(message: string, locale?: Locale): string {
  return `${toolI18n(locale).toolErrorPrefix} ${message}`;
}

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
