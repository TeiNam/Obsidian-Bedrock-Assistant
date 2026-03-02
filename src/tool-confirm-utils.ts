// 파괴적 도구 확인 로직 유틸리티
// chat-view.ts에서 사용하는 도구 확인 관련 상수와 헬퍼 함수

/** 파괴적 도구 목록: 실행 전 사용자 확인이 필요한 도구들 */
export const DESTRUCTIVE_TOOLS = ['edit_note', 'create_note', 'delete_file', 'move_file'];

/**
 * 도구 실행 전 사용자 확인이 필요한지 판단하는 헬퍼 함수
 * @param toolName - 실행할 도구 이름
 * @param confirmToolExecution - 확인 모달 설정 활성화 여부
 * @returns 확인이 필요하면 true, 아니면 false
 */
export function needsToolConfirmation(toolName: string, confirmToolExecution: boolean): boolean {
  return confirmToolExecution && DESTRUCTIVE_TOOLS.includes(toolName);
}
