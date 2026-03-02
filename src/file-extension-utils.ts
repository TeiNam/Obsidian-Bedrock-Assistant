// 파일 확장자 필터링 유틸리티
// addFileContext()에서 사용하는 허용 확장자 목록과 헬퍼 함수

/** 텍스트 기반 파일 확장자 허용 목록 */
export const ALLOWED_TEXT_EXTENSIONS: string[] = [
  'md', 'txt', 'json', 'yaml', 'yml', 'csv', 'xml', 'html', 'css', 'js', 'ts',
];

/**
 * 파일 확장자가 텍스트 기반인지 판단하는 헬퍼 함수
 * @param extension - 파일 확장자 (점 없이, 예: "md", "json")
 * @returns 허용된 텍스트 확장자이면 true, 아니면 false
 */
export function isAllowedTextExtension(extension: string): boolean {
  return ALLOWED_TEXT_EXTENSIONS.includes(extension);
}
