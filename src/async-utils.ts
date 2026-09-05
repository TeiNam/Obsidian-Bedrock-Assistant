/**
 * 비동기 함수를 void 반환 콜백으로 감싸는 어댑터.
 *
 * `addEventListener`나 모달의 `onSelect` 같은 자리는 void 반환을 기대한다. async
 * 함수를 그대로 넘기면 반환된 Promise 를 아무도 들고 있지 않아 거부(rejection)가
 * 조용히 사라진다 — 버튼을 눌렀는데 아무 일도 안 일어나고 원인도 남지 않는다.
 */

import { getErrorMessage } from "./error-utils";

/**
 * async 핸들러를 동기 콜백으로 바꾼다. 거부는 콘솔에 남긴다.
 *
 * 사용자에게 보여줄 메시지가 있는 실패는 핸들러 안에서 Notice 로 처리해야 한다.
 * 여기서 잡는 것은 "예상하지 못한" 실패의 마지막 그물이다.
 */
export function voidAsync<A extends unknown[]>(
  handler: (...args: A) => Promise<void>
): (...args: A) => void {
  return (...args: A) => {
    handler(...args).catch((error: unknown) => {
      console.error(`비동기 핸들러 실패: ${getErrorMessage(error)}`, error);
    });
  };
}
