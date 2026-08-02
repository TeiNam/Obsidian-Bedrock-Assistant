// 코어 그래프 색상 그룹 주입 — 얇은 I/O 래퍼
// ==========================================
// color-groups.ts 가 만든 순수 배열을 실제 Obsidian 코어 그래프에 반영한다. 판단은
// 전부 순수 모듈에 있고 여기는 "어디에 쓸지"만 결정한다.
//
// === 왜 파일이 아니라 in-memory 가 주 채널인가 (실측 근거) ===
//
// 코어는 in-memory options 를 source of truth 로 들고 있다. 결정적인 두 조각:
//
//  1) GraphView.onOptionsChange:
//       instance.options = this.dataEngine.getOptions(); instance.saveOptions()
//     그리고 getOptions() 는 `var e = {}` 로 시작해 등록된 리스너 값으로 채운다 —
//     **merge 가 아니라 전체 교체**다.
//
//  2) engine.load 안의 2초 폴러:
//       setInterval(function(){ if (renderer.targetScale !== a) { a = ...; onOptionsChange() } }, 2000)
//     즉 그래프가 열려 있고 사용자가 **휠만 굴려도** 2초 안에 전체 저장이 터진다.
//
// 파일만 쓰면 이 폴러가 뷰의 (우리 색이 없는) 구 메모리를 flush 해 우리 쓰기를 확실히
// 이긴다. 그래서 경로는 2단이고, 파일은 **전혀 쓰지 않는다**:
//
//   a. instance.options.colorGroups 갱신 → instance.saveOptions()   (코어 정식 저장 경로)
//   b. 열린 graph leaf 마다 dataEngine.setOptions({colorGroups})     (뷰 메모리 동기화)
//
// (b)를 빼면 저장은 되지만 열린 뷰가 곧 우리 색을 지운다. setOptions 는
// `for (var n in e)` 로 존재하는 키의 리스너만 호출하므로 {colorGroups} 부분 객체가
// 안전하다(전체 options 를 넘기면 사용자의 현재 줌·필터를 밀어버린다).
//
// === 왜 파일 쓰기 폴백조차 없는가 (확정 정책) ===
//
// 볼트가 SynologyDrive 위에 있고 .obsidian/ 에 이미 "workspace.json 2.json",
// "workspace.json 3.json" 동기화 충돌 사본이 존재한다. graph.json 에 우리가 쓰면 같은
// 충돌 사본이 생겨 사용자 그래프 설정이 갈라진다. 비공개 API 가 없는 버전에서는
// 아무것도 하지 않고 안내만 한다 — 되돌릴 수 없는 손실보다 "동작 안 함"이 낫다.
//
// === 안전 계약 ===
//
// internalPlugins·dataEngine 은 obsidian.d.ts 에 없는 **비공개 API** 다. 언제든 사라질 수
// 있으므로 전 구간 optional chaining + try/catch 로 감싸고, 실패는 결과 객체로만 보고한다.
// 예외를 던져 명령 전체를 죽이지 않는다.
//
// 쓰기 전 게이트 2개(commit 참조)를 반드시 통과해야 한다:
//  - options 가 빈 객체면 중단 (코어가 파싱 실패 시 {} 를 넣으므로 손상과 구분 불가)
//  - colorGroups 스키마가 인식 불가면 중단 (덮어쓰면 사용자 그룹이 전부 사라진다)

import {
  mergeColorGroups,
  removeManagedGroups,
  type GraphColorGroup,
} from "./color-groups";

/** graph.json 파일명. 코어의 getConfigFile(id) = configDir + "/" + id + ".json" 과 같다. */
const GRAPH_CONFIG_FILE = "graph.json";

/** 코어의 직렬화 포맷. writeConfigJson 이 JSON.stringify(t, void 0, 2) 를 쓴다. */
const JSON_INDENT = 2;

/** 코어 그래프 내부 플러그인 id. */
const GRAPH_PLUGIN_ID = "graph";

/** 글로벌 그래프 뷰 타입. localgraph 는 graph.json 을 읽지 않으므로 대상이 아니다. */
const GRAPH_VIEW_TYPE = "graph";

/**
 * 우리가 실제로 만지는 앱 표면만 좁게 선언한 구조 타입.
 *
 * App 전체를 받지 않는 이유: internalPlugins·dataEngine 이 공개 타입에 없어서 App 을
 * 쓰면 캐스팅이 호출부로 번지고, 테스트가 App 전체를 목킹해야 한다. 필요한 모양만
 * 받으면 목이 20줄로 끝난다.
 */
export interface GraphAppLike {
  internalPlugins?: {
    getPluginById?: (id: string) => { instance?: GraphPluginInstance } | undefined;
  };
  workspace?: {
    getLeavesOfType?: (type: string) => { view?: { dataEngine?: GraphDataEngine } }[];
  };
  vault?: {
    configDir?: string;
    adapter?: {
      exists: (path: string) => Promise<boolean>;
      read: (path: string) => Promise<string>;
      write: (path: string, data: string) => Promise<void>;
    };
  };
}

/** 코어 graph 내부 플러그인 인스턴스(비공개). */
interface GraphPluginInstance {
  options?: Record<string, unknown>;
  saveOptions?: () => void;
}

/** 열린 그래프 뷰의 데이터 엔진(비공개). */
interface GraphDataEngine {
  setOptions?: (options: { colorGroups: GraphColorGroup[] }) => void;
}

/**
 * 주입 결과.
 *
 * `channel` 로 어느 경로가 성공했는지 구분한다 — 문구를 갈라야 하기 때문이다.
 * instance 경로는 즉시 반영이지만 file 경로는 그래프를 다시 열어야 보인다.
 */
export interface ApplyResult {
  ok: boolean;
  /** instance=비공개 API, file=파일 폴백, blocked=열린 뷰 때문에 중단, none=경로 없음 */
  channel: "instance" | "file" | "blocked" | "none";
  /** dataEngine.setOptions 를 실제로 반영한 열린 뷰 수. */
  viewsUpdated: number;
  /** 실패 이유(디버그·Notice 용). 성공 시 undefined. */
  reason?: string;
}

/**
 * 값이 colorGroups 배열 스키마를 만족하는지 검사한다.
 *
 * 우리가 못 읽는 형식을 우리 배열로 덮어쓰면 사용자 설정을 파괴한다. Obsidian 업데이트로
 * 스키마가 바뀌면 이 검증이 실패해 기능이 조용히 비활성되고, 그게 옳은 실패 방향이다.
 */
export function isColorGroupArray(value: unknown): value is GraphColorGroup[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const g = item as { query?: unknown; color?: unknown };
    if (typeof g.query !== "string") return false;
    if (!g.color || typeof g.color !== "object") return false;
    const c = g.color as { a?: unknown; rgb?: unknown };
    return typeof c.a === "number" && typeof c.rgb === "number";
  });
}

/** 비공개 API 로 그래프 플러그인 인스턴스를 얻는다. 없거나 던지면 undefined. */
function getInstance(app: GraphAppLike): GraphPluginInstance | undefined {
  try {
    return app.internalPlugins?.getPluginById?.(GRAPH_PLUGIN_ID)?.instance;
  } catch {
    // 비공개 API 가 사라졌거나 형태가 바뀐 경우. 폴백으로 넘어간다.
    return undefined;
  }
}

/**
 * 현재 적용된 colorGroups 를 읽는다(병합의 기준값).
 *
 * in-memory 를 읽는다 — 파일보다 최신이고, 열린 뷰의 상태와도 일치한다. 스키마가
 * 깨져 있으면 빈 배열을 돌려 병합이 "사용자 그룹 0개"로 진행되게 한다. 이 경우에도
 * 파일 경로는 별도로 스키마를 검증해 쓰기를 거부하므로 파괴가 일어나지 않는다.
 */
export function readExistingGroups(app: GraphAppLike): GraphColorGroup[] {
  const current = getInstance(app)?.options?.colorGroups;
  return isColorGroupArray(current) ? current : [];
}

/**
 * 열린 글로벌 그래프 뷰에 colorGroups 를 밀어넣는다.
 *
 * 이걸 빼면 2초 줌 폴러가 뷰의 구 메모리를 flush 해 우리 색을 날린다. leaf 하나가
 * 던져도 나머지는 계속 처리한다 — 한 뷰의 실패로 전체를 포기할 이유가 없다.
 *
 * @returns 실제로 반영된 뷰 수
 */
function pushToOpenViews(app: GraphAppLike, colorGroups: GraphColorGroup[]): number {
  let updated = 0;
  let leaves: { view?: { dataEngine?: GraphDataEngine } }[] = [];
  try {
    leaves = app.workspace?.getLeavesOfType?.(GRAPH_VIEW_TYPE) ?? [];
  } catch {
    return 0;
  }
  for (const leaf of leaves) {
    try {
      const engine = leaf?.view?.dataEngine;
      if (!engine?.setOptions) continue;
      // colorGroups 만 넘긴다 — 코어는 존재하는 키의 리스너만 호출하므로 부분 객체가
      // 안전하고, 전체 options 를 넘기면 사용자의 현재 줌·필터를 덮어쓴다.
      engine.setOptions({ colorGroups });
      updated += 1;
    } catch {
      // 이 뷰만 건너뛴다.
      continue;
    }
  }
  return updated;
}

/**
 * 그래프 설정의 "색상 그룹" 섹션을 펼친다.
 *
 * collapse-color-groups 가 true 면 색을 주입해도 설정 패널에서 섹션이 접혀 있어 사용자가
 * 결과를 보거나 편집할 수 없다. 색만 바뀌고 "어디서 바꾸는지"를 못 찾으면 기능을 이해할
 * 수 없으므로 함께 펼친다.
 *
 * 저장은 호출부의 saveOptions 에 맡긴다 — 여기서 또 부르면 저장이 두 번 일어난다.
 * 실패는 무시한다: 이건 편의 기능이라 실패해도 색 주입 자체는 유효하다.
 */
export function expandColorGroupSection(app: GraphAppLike): void {
  try {
    const options = getInstance(app)?.options;
    if (options && options["collapse-color-groups"] === true) {
      options["collapse-color-groups"] = false;
    }
  } catch {
    // 편의 기능이므로 조용히 넘어간다.
  }
}

/**
 * colorGroups 변경을 실제 코어 그래프에 반영한다 — apply·remove 의 공통 몸통.
 *
 * @param transform 기존 그룹 → 새 그룹(순수). 사용자 그룹 보존 규칙은 이 함수 안이 아니라
 *   color-groups.ts 의 merge/remove 에 있다.
 */
async function commit(
  app: GraphAppLike,
  transform: (existing: GraphColorGroup[]) => GraphColorGroup[],
): Promise<ApplyResult> {
  const instance = getInstance(app);

  // 유일한 채널: in-memory + 코어 정식 저장. saveOptions 가 파일까지 써 주므로 우리가
  // adapter.write 를 겹쳐 부를 이유가 없다.
  //
  // 파일 직접 쓰기는 확정 정책으로 제거했다. 볼트가 SynologyDrive 위에 있고 .obsidian/ 에
  // 이미 "workspace.json 2.json" 같은 동기화 충돌 사본이 존재한다 — graph.json 에 우리가
  // 쓰면 같은 충돌이 생겨 사용자 그래프 설정이 갈라진다. 되돌릴 수 없는 손실 대신
  // "동작 안 함 + 안내"를 택한다.
  if (!instance?.options || typeof instance.saveOptions !== "function") {
    return {
      ok: false,
      channel: "none",
      viewsUpdated: 0,
      reason: "이 옵시디언 버전에서는 그래프 색상 그룹을 설정할 수 없습니다.",
    };
  }

  // 게이트 1: 빈 options 는 쓰지 않는다.
  // 코어는 graph.json 파싱 실패 시 `this.options = await loadData() || {}` 로 빈 객체를
  // 만든다. 즉 "설정이 아직 없음"과 "파일이 손상됨"을 구분할 수 없다. 이 상태에서
  // saveOptions 를 부르면 사용자 설정이 colorGroups 하나만 남고 통째로 사라진다.
  if (Object.keys(instance.options).length === 0) {
    return {
      ok: false,
      channel: "none",
      viewsUpdated: 0,
      reason: "그래프 설정을 읽을 수 없습니다. 그래프 뷰를 한 번 열어 주세요.",
    };
  }

  // 게이트 2: colorGroups 스키마가 우리가 아는 형태가 아니면 손대지 않는다.
  // 과거에는 이 검증이 파일 경로에만 있었다. Obsidian 업데이트로 color 가 hex 문자열이
  // 되면 여기 걸리는데, 검증이 없으면 사용자 그룹을 0개로 코어싱해 병합하므로 전부 삭제된다.
  const current = instance.options.colorGroups;
  if (current !== undefined && !isColorGroupArray(current)) {
    return {
      ok: false,
      channel: "none",
      viewsUpdated: 0,
      reason: "그래프의 색상 그룹 형식을 인식할 수 없습니다.",
    };
  }

  try {
    const next = transform(current ?? []);
    // options 객체 자체는 코어 소유다. 새 객체로 갈아끼우지 않고 colorGroups 키만
    // 대입한다 — 교체하면 코어가 들고 있는 참조와 갈라져 물리 파라미터가 유실된다.
    instance.options.colorGroups = next;
    instance.saveOptions();
    // 열린 뷰 동기화. 저장 뒤에 하는 이유는, setOptions 가 requestUpdateSearch 를
    // 돌려 곧바로 화면을 갱신하는데 그 시점에 저장이 이미 끝나 있어야 하기 때문이다.
    const viewsUpdated = pushToOpenViews(app, next);
    return { ok: true, channel: "instance", viewsUpdated };
  } catch (error) {
    return {
      ok: false,
      channel: "none",
      viewsUpdated: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 우리 색상 그룹을 코어 그래프에 적용한다.
 *
 * 사용자 수동 그룹은 mergeColorGroups 가 앞쪽에 보존하므로 우선순위까지 지켜진다.
 * 멱등하므로 몇 번 실행해도 그룹이 늘어나지 않는다.
 */
export function applyColorGroups(
  app: GraphAppLike,
  ours: readonly GraphColorGroup[],
  managedQueries: readonly string[],
): Promise<ApplyResult> {
  return commit(app, (existing) => mergeColorGroups(existing, ours, managedQueries));
}

/**
 * 우리 색상 그룹만 제거한다 — 되돌리기 경로.
 *
 * 색을 입혔는데 지울 방법이 없으면 사용자가 갇힌다. 사용자 수동 그룹은 순서까지 그대로
 * 남으므로 적용 → 제거 왕복이 원래 상태로 정확히 복귀한다.
 */
export function removeColorGroups(
  app: GraphAppLike,
  managedQueries: readonly string[],
): Promise<ApplyResult> {
  return commit(app, (existing) => removeManagedGroups(existing, managedQueries));
}
