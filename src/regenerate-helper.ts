import type { ChatMessage } from "./types";

/**
 * 마지막 어시스턴트 메시지를 제거하여 재생성을 준비합니다.
 * 원본 배열을 변경하지 않고 새 배열을 반환합니다.
 *
 * @param messages - 현재 대화 메시지 배열
 * @returns 마지막 어시스턴트 메시지가 제거된 새 배열, 또는 제거할 메시지가 없으면 null
 */
export function prepareRegeneration(messages: ChatMessage[]): ChatMessage[] | null {
  // 메시지가 없으면 재생성 불가
  if (messages.length === 0) return null;

  // 마지막 메시지가 어시스턴트가 아니면 재생성 불가
  if (messages[messages.length - 1].role !== "assistant") return null;

  // 마지막 어시스턴트 메시지를 제거한 새 배열 반환
  return messages.slice(0, -1);
}
