/** Bases 대시보드가 관리하는 투영 노트 전용 폴더명. */
export const DASHBOARD_ITEMS_FOLDER_NAME = "Agent LLMs Dashboard Items";

/** 생성된 대시보드 투영 노트인지 경로만으로 판정한다. */
export function isDashboardItemPath(path: string): boolean {
  return path.split("/").includes(DASHBOARD_ITEMS_FOLDER_NAME);
}
