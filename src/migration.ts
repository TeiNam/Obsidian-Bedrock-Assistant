/**
 * 플러그인 ID 변경에 따른 데이터 마이그레이션 계획 계산 모듈.
 *
 * pluginId가 바뀌면 볼트 루트 데이터 파일, MCP 설정, 로컬 자격증명 파일의
 * 경로가 모두 달라진다. 이 모듈은 "무엇을 어디로 복사할지"만 계산하는 순수
 * 함수를 제공하고, 실제 파일 조작은 호출부(main.ts)가 담당한다.
 *
 * 복사(copy)이지 이동(move)이 아니다. 사용자가 구 버전으로 되돌려도 계속
 * 동작해야 하므로 원본을 남긴다.
 */

/** 단일 복사 작업. from을 to로 복사한다. */
export interface MigrationTask {
  from: string;
  to: string;
}

/** 볼트 루트 데이터 파일의 접미사 4종. branding.ts의 files 필드와 대응한다. */
const DATA_SUFFIXES = [
  "-index.json",
  "-chat.json",
  "-sessions.json",
  "-sessions.json.bak",
] as const;

/**
 * 플러그인 폴더(`{configDir}/plugins/{id}/`) 안에서 옮겨야 하는 파일들.
 *
 * - `data.json`: Plugin.loadData()/saveData()가 쓰는 설정 파일. 이것을 잃으면
 *   사용자의 모든 설정이 기본값으로 초기화된다. 가장 중요한 대상이다.
 * - `mcp.json`: MCP 서버 설정. main.ts의 MCP_CONFIG_FILE과 같은 값이다.
 */
const PLUGIN_FOLDER_FILES = ["data.json", "mcp.json"] as const;

/** 자격증명 파일명 접미사. safe-storage.ts의 CREDENTIALS_FILE 규칙과 대응한다. */
const CREDENTIALS_SUFFIX = "-credentials.json";

/**
 * 주어진 플러그인 ID에 대응하는 볼트 루트 데이터 파일명 4개를 반환한다.
 * 볼트 루트의 숨김 파일이므로 앞에 점이 붙는다.
 */
export function legacyDataFileNames(pluginId: string): string[] {
  return DATA_SUFFIXES.map((suffix) => `.${pluginId}${suffix}`);
}

/** 플러그인 폴더 안 파일의 볼트 상대 경로를 만든다. */
function pluginFolderPath(configDir: string, pluginId: string, fileName: string): string {
  return `${configDir}/plugins/${pluginId}/${fileName}`;
}

/**
 * 레거시 ID들의 볼트 내 파일을 신 ID 경로로 복사하는 작업 목록을 계산한다.
 *
 * 규칙:
 *  - 대상(to)이 이미 존재하면 건너뛴다 → 재실행해도 안전하고, 사용자가 새로
 *    만든 데이터를 덮어쓰지 않는다.
 *  - 같은 대상에 여러 레거시 ID가 후보로 걸리면 legacyIds 배열의 앞선 것을
 *    택한다. 호출부가 정본 계보를 앞에 둔다.
 *  - 레거시 ID가 신 ID와 같으면 자기 자신 복사가 되므로 제외한다.
 *
 * @param legacyIds 우선순위 순서의 레거시 플러그인 ID 목록
 * @param newId 새 플러그인 ID
 * @param exists 볼트 상대 경로의 존재 여부를 판정하는 함수
 * @param configDir 옵시디언 설정 디렉터리 (보통 ".obsidian")
 */
export function planMigrations(
  legacyIds: readonly string[],
  newId: string,
  exists: (path: string) => boolean,
  configDir: string
): MigrationTask[] {
  const tasks: MigrationTask[] = [];
  // 이미 작업이 등록된 대상. 앞선 레거시 ID가 이겼음을 기록한다.
  const claimed = new Set<string>();

  for (const legacyId of legacyIds) {
    // 자기 자신으로의 복사는 의미가 없다.
    if (legacyId === newId) continue;

    const pairs: MigrationTask[] = [
      // 볼트 루트 데이터 4종
      ...DATA_SUFFIXES.map((suffix) => ({
        from: `.${legacyId}${suffix}`,
        to: `.${newId}${suffix}`,
      })),
      // 플러그인 폴더 파일 2종 (data.json, mcp.json)
      ...PLUGIN_FOLDER_FILES.map((fileName) => ({
        from: pluginFolderPath(configDir, legacyId, fileName),
        to: pluginFolderPath(configDir, newId, fileName),
      })),
    ];

    for (const pair of pairs) {
      // 앞선 레거시 ID가 이미 이 대상을 차지했다.
      if (claimed.has(pair.to)) continue;
      // 원본이 없으면 복사할 것이 없다.
      if (!exists(pair.from)) continue;
      // 대상이 이미 있으면 보존한다(덮어쓰기 금지).
      if (exists(pair.to)) {
        claimed.add(pair.to);
        continue;
      }
      tasks.push(pair);
      claimed.add(pair.to);
    }
  }

  return tasks;
}

/**
 * 로컬 자격증명 파일의 복사 계획을 계산한다.
 *
 * 자격증명은 볼트가 아닌 Electron userData 경로에 있어 vault.adapter로
 * 접근할 수 없다. 따라서 이 함수는 파일명만 다루고, 디렉터리 결합과 실제
 * 파일 조작은 호출부가 Node fs로 수행한다.
 *
 * @param legacyIds 우선순위 순서의 레거시 플러그인 ID 목록
 * @param newId 새 플러그인 ID
 * @param exists 파일명(디렉터리 제외)의 존재 여부를 판정하는 함수
 * @returns 복사할 작업, 또는 복사가 불필요하면 null
 */
export function planCredentialMigration(
  legacyIds: readonly string[],
  newId: string,
  exists: (fileName: string) => boolean
): MigrationTask | null {
  const target = `${newId}${CREDENTIALS_SUFFIX}`;
  // 대상이 이미 있으면 덮어쓰지 않는다.
  if (exists(target)) return null;

  for (const legacyId of legacyIds) {
    if (legacyId === newId) continue;
    const source = `${legacyId}${CREDENTIALS_SUFFIX}`;
    if (exists(source)) {
      return { from: source, to: target };
    }
  }

  return null;
}
