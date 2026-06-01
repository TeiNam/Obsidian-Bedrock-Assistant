// AI 생성 중지 제어 유틸리티
// 스트리밍 취소(AbortSignal) 또는 DOMException(AbortError)를 일반 오류와 구분한다.

/**
 * AbortSignal/DOMException(AbortError) 기반 취소 여부 판별
 * @param error - 검사할 오류 값 (catch로 받은 unknown)
 * @param signal - 선택적 AbortSignal (전달 시 aborted 여부 우선 확인)
 * @returns 신호가 중단되었거나 오류가 AbortError이면 true, 아니면 false
 */
export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}
