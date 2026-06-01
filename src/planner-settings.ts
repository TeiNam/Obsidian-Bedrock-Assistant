// Daily Planner 설정 정규화·마이그레이션 순수 모듈
// ============================================
// 설정 값 정규화(빈/공백 입력 → 기본값)와 Legacy 설정 마이그레이션
// (plannerFolder 누락 시 todoFolder 승계)을 담당하는 순수 함수 모음.
// Obsidian 의존성이 없으며 모든 함수는 부수효과가 없다.
// (fast-check 기반 속성 테스트가 가능하도록 부수효과 계층과 분리)

/**
 * 설정 폴더/템플릿명 입력을 정규화한다.
 * - 입력이 빈 문자열이거나 공백 문자로만 구성되면(또는 null/undefined) 기본값을 반환한다.
 * - 그 외에는 앞뒤 공백을 제거한(trim) 입력 값을 반환한다.
 *
 * @param value 사용자가 입력한 원본 값
 * @param defaultValue 빈/공백 입력 시 적용할 기본값
 */
export function normalizePlannerSetting(value: string | null | undefined, defaultValue: string): string {
  if (value === null || value === undefined) return defaultValue;
  const trimmed = value.trim();
  return trimmed.length === 0 ? defaultValue : trimmed;
}

/**
 * Legacy 설정 마이그레이션.
 *
 * 저장된 설정 데이터에 `plannerFolder` 키가 없고(또는 undefined/null) `todoFolder`가
 * 비어 있지 않으면, 기존 `todoFolder` 값을 `plannerFolder`로 승계한다.
 * 이미 `plannerFolder` 값이 존재하면 변경하지 않는다.
 *
 * 주의: 반드시 DEFAULT_SETTINGS와 병합하기 "전"의 원본 로드 데이터에 적용해야 한다.
 * 병합 이후에는 항상 plannerFolder 기본값이 채워져 마이그레이션 조건이 성립하지 않는다.
 *
 * @param merged 원본 로드 설정 객체 (병합 전)
 * @returns 마이그레이션이 적용된(혹은 변경 없는) 동일 객체
 */
export function migratePlannerSettings<T extends Record<string, unknown>>(merged: T): T {
  // plannerFolder 키가 실제로 존재하고 값이 있는지 확인
  const hasPlannerFolder =
    Object.prototype.hasOwnProperty.call(merged, "plannerFolder") &&
    merged.plannerFolder !== undefined &&
    merged.plannerFolder !== null;

  const todoFolder = merged.todoFolder;
  const hasTodoFolder = typeof todoFolder === "string" && todoFolder.length > 0;

  // plannerFolder가 없고 todoFolder가 비어있지 않으면 todoFolder 값을 승계
  if (!hasPlannerFolder && hasTodoFolder) {
    (merged as Record<string, unknown>).plannerFolder = todoFolder;
  }

  return merged;
}
