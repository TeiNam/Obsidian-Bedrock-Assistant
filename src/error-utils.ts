/**
 * 예외 메시지 추출 유틸.
 *
 * `catch (e: unknown)` 에서 `e.message` 를 바로 읽을 수는 없고, `String(e)` 는
 * 일반 객체에서 `[object Object]` 가 되어 사용자에게 아무 정보도 주지 않는다.
 * 좁히는 규칙을 한곳에 모아 모든 호출부가 같은 결과를 내게 한다.
 */

/** 알 수 없는 예외에서 사람이 읽을 수 있는 메시지를 뽑는다. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error;
    if (typeof message === "string") return message;
  }
  return String(error);
}
