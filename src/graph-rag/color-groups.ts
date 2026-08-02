// 코어 그래프 색상 그룹 (colorGroups) — 순수 모듈
// ================================================
// Obsidian 기본 그래프 뷰의 "색상 그룹" 설정을 우리가 생성해 PARA 폴더 분류를 얹는다.
// mermaid 그래프 4종과 축이 다르다 — 그쪽은 *쿼리 범위 한정* 또는 *계산된 지표* 뷰이고
// 이것은 *볼트 전역 구조* 뷰다. 그래서 이 파일은 추가이고 대체가 아니다.
//
// 이 파일은 전부 순수 함수다. Obsidian API·파일 IO·i18n 호출이 0회이며, 그래서
// vault 없이 테스트된다. 실제 주입(비공개 API + 파일 폴백)은 apply-color-groups.ts 에 있다.
//
// === 왜 D3 자체 뷰가 아니라 이것인가 ===
//
// 코어 그래프는 pixi.js-legacy v7.2.4 WebGL 렌더러 + 메타데이터 Web Worker 로 돌고,
// 그 렌더러는 플러그인에 노출되지 않는다(obsidian.d.ts 에 "graph" 2회 전부 무관).
// 자체 SVG 뷰를 만들면 사용자가 이미 쓰고 있는 그래프의 '더 느린 모조품'이 된다.
// colorGroups 는 사용자가 손으로 조율한 물리 파라미터(repelStrength·linkDistance·scale)가
// 그대로 살아있는 실제 코어 그래프에 색 분류만 얹으며, 번들 증가가 0kb 다.
//
// === 코어 내부 계약 (obsidian.asar 직접 판독, 추측 아님) ===
//
// 1) 직렬화 — getColoredQueries():
//      e.push({ query: i.query.getValue(), color: { a: 1, rgb: i.color.getValueInt() } })
//    → rgb 는 hex 문자열도 {r,g,b} 객체도 아니고 **평평한 24비트 정수**다.
//      getValueInt(){ return parseInt(this.getValue().slice(1), 16) }
//
// 2) color 를 빠뜨리면 색칠이 아니라 '필터'가 된다 — setQuery():
//      a.color || (this.hasFilter = !0)
//    color 가 falsy 면 그 쿼리는 필터로 취급되어 **매칭 안 되는 노드를 그래프에서 제거**한다.
//    의도와 정반대이므로 color 는 절대 생략·null 금지다.
//
// 3) a 는 장식이 아니라 실제 알파다 — 렌더:
//      var i = this.getFillColor(); t.alpha = i.a, t.tint = i.rgb
//    a=0 이면 노드가 투명해져 보이지 않는다. 항상 1 이어야 한다.
//
// 4) 순서 = 우선순위 — setQuery 는 **첫 매칭이 승리하고 break** 한다. 그래서
//    mergeColorGroups 는 사용자 수동 그룹을 반드시 배열 '앞쪽'에 보존한다. 우리 그룹을
//    앞에 끼우면 사용자가 손으로 만든 색이 우리 색에 가려진다.
//
// 5) path: 는 비용이 0 이다 — requiredInputs 가 {} 라 파일을 열지 않는다. 반대로 tag: 는
//    {content:true} 라 모든 md 에 vault.cachedRead 를 돌린다. 그래서 path: 만 쓴다.

/**
 * 코어 graph.json 의 colorGroups 배열 요소.
 *
 * 이 형태는 Obsidian 이 문서화하지 않은 내부 포맷이다(obsidian.d.ts 에 없음).
 * 바이너리 판독으로 확정했으며, 업데이트로 깨질 수 있으므로 apply 쪽에서 스키마를
 * 검증한 뒤에만 쓴다.
 */
export interface GraphColorGroup {
  /** Obsidian 검색 문법 원문. 사용자가 색상 그룹 입력창에서 그대로 보고 편집한다. */
  query: string;
  /** a=알파(1 고정), rgb=24비트 0xRRGGBB 정수. */
  color: { a: number; rgb: number };
}

/**
 * 우리 소유 쿼리를 식별하는 접두사.
 *
 * 사용자 수동 그룹과 우리 그룹을 구별할 방법이 없으면 재실행 시 사용자 것을 지운다.
 * 되돌릴 수 없는 유일한 손실이므로 소유 식별은 투기적 장치가 아니라 필수다.
 *
 * 쿼리 문자열 자체가 소유 표식이다 — graph.json 의 colorGroups 요소에는 이름·id 필드가
 * 없어서(query·color 뿐) 별도 라벨을 붙일 자리가 없다. 대신 우리가 생성하는 쿼리 형태를
 * managedQueriesOf() 로 정확히 재현할 수 있으므로 그 목록과의 일치로 소유를 판정한다.
 */
export const MANAGED_QUERY_PREFIX = "path:";

/**
 * PARA 폴더 → 색상 정의.
 *
 * 폴더 이름은 para-organizer.ts 의 PARA_FOLDERS 와 같은 실제 볼트 구조다. 그쪽 상수를
 * import 하지 않는 이유: para-organizer 는 obsidian(TFile·Notice)을 import 하는 I/O
 * 모듈이라 여기서 끌어오면 순수 코어가 vault 에 묶여 테스트가 앱을 요구하게 된다.
 *
 * 색은 PARA 의 의미에 맞춰 고른다(장식이 아니라 semantic):
 *  - Projects  주황: 지금 굴러가는 것 = 가장 뜨겁다
 *  - Areas     노랑: 계속 유지하는 것
 *  - Resources 파랑: 참고 자료 = 차갑고 중립
 *  - Archives  회색: 끝난 것 = 눈에 덜 걸려야 한다
 */
export const PARA_COLOR_GROUPS: readonly { folder: string; hex: string }[] = [
  { folder: "01. Projects", hex: "#e8543f" },
  { folder: "02. Areas", hex: "#e0a341" },
  { folder: "03. Resources", hex: "#4a9eff" },
  { folder: "04. Archives", hex: "#7d8590" },
] as const;

/** hex 형식 검증. #RRGGBB 6자리만 허용한다(#RGB 3자리는 코어가 못 읽는다). */
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** rgb 정수 상한. 0xffffff = 16777215. */
const RGB_MAX = 0xffffff;

/**
 * "#RRGGBB" → 24비트 정수. 코어의 getValueInt 와 동일한 연산이다.
 *
 * 잘못된 입력에 0(검정)으로 폴백하지 않고 예외를 던진다 — 폴백하면 사용자는 "왜 전부
 * 검정인가"를 영구히 모른다. 호출부(apply)는 이 예외를 잡아 Notice 로만 알린다.
 */
export function hexToRgbInt(hex: string): number {
  if (!HEX_PATTERN.test(hex)) {
    throw new Error(`잘못된 색상 형식입니다(#RRGGBB 6자리 필요): ${hex}`);
  }
  const value = parseInt(hex.slice(1), 16);
  // 정규식을 통과했으면 논리적으로 범위 안이지만, 코어에 넣는 값이므로 단정해 둔다.
  if (!Number.isInteger(value) || value < 0 || value > RGB_MAX) {
    throw new Error(`색상 정수가 범위를 벗어났습니다: ${hex}`);
  }
  return value;
}

/** 24비트 정수 → "#RRGGBB". 코어의 setValueInt 와 동일하다(왕복 검증용). */
export function rgbIntToHex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

/**
 * PARA 폴더 정의 → 코어가 그대로 먹는 colorGroups 배열.
 *
 * 매 호출마다 새 배열·새 객체를 만든다. 반환값이 코어의 in-memory options 로 들어가
 * 코어가 그것을 변형할 수 있으므로, 모듈 상수를 공유하면 다음 호출이 오염된다.
 */
export function buildParaColorGroups(): GraphColorGroup[] {
  return PARA_COLOR_GROUPS.map((def) => ({
    query: `${MANAGED_QUERY_PREFIX}"${def.folder}"`,
    // a=1 고정: 0 이면 노드가 투명해진다(위 계약 3).
    color: { a: 1, rgb: hexToRgbInt(def.hex) },
  }));
}

/**
 * 우리가 생성할 수 있는 PARA 쿼리 목록.
 *
 * 주의: 이것은 "우리 소유" 목록이 **아니다.** 소유 판정은 addedQueriesOf 가 만든 기록으로
 * 한다 — 사용자가 같은 쿼리를 손수 만들어 뒀을 수 있기 때문이다. 이 함수는 쿼리 형태가
 * 정본과 일치하는지 확인하는 용도로만 쓴다.
 */
export function managedQueriesOf(): string[] {
  return buildParaColorGroups().map((g) => g.query);
}

/** 태그 그룹의 기본 최대 개수. tag: 는 볼트 전체를 읽으므로 적게 유지한다. */
export const TAG_GROUP_LIMIT = 5;

/** 태그 그룹에 포함할 최소 사용 횟수. 1~2회짜리는 그래프에 점 하나만 남기고 비용만 든다. */
export const TAG_MIN_COUNT = 3;

/**
 * 태그 색상 팔레트.
 *
 * PARA 색(주황·노랑·파랑·회색)과 겹치지 않는 계열을 골라, 두 축을 함께 켰을 때 폴더
 * 분류와 주제 분류가 눈으로 구분되게 한다.
 */
const TAG_PALETTE = ["#a855f7", "#10b981", "#f472b6", "#22d3ee", "#facc15"] as const;

/** buildTagColorGroups 입력. 볼트 스캔 결과(태그 → 사용 횟수). */
export interface TagUsage {
  tag: string;
  count: number;
}

/**
 * 자주 쓰는 태그 → 색상 그룹.
 *
 * PARA 는 폴더 축이고 태그는 주제 축이다. 둘을 함께 쓰면 "어느 PARA 에 있는 무슨 주제"가
 * 한 그래프에서 보인다.
 *
 * ⚠️ 비용 주의: tag: 쿼리는 코어의 requiredInputs 가 {content:true} 라 **모든 md 에
 * vault.cachedRead** 를 돌린다(path: 는 파일을 열지 않는다). 그래서 개수를 상한으로
 * 묶는다 — 고유 태그를 전부 넣으면 그래프가 눈에 보이게 느려진다.
 *
 * @param usages 태그 사용 횟수 목록. 변형하지 않는다.
 * @param limit 최대 그룹 수.
 */
export function buildTagColorGroups(
  usages: readonly TagUsage[],
  limit: number = TAG_GROUP_LIMIT,
): GraphColorGroup[] {
  // 정렬 전에 복사한다 — sort 는 제자리 변형이라 호출부 배열이 뒤바뀐다.
  const ranked = [...usages]
    .filter((u) => u.count >= TAG_MIN_COUNT && u.tag.trim() !== "")
    // 빈도 내림차순, 동점은 태그 이름 오름차순으로 결정론을 보장한다(테스트 가능성).
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, Math.max(0, Math.min(limit, TAG_PALETTE.length)));

  return ranked.map((u, i) => ({
    // 태그는 인용하지 않는다 — 코어의 tag: 는 값에 공백이 없는 것을 전제하고,
    // 인용하면 사용자가 색상 그룹 입력창에서 본 형태와 달라져 편집이 혼란스러워진다.
    query: `tag:#${u.tag}`,
    color: { a: 1, rgb: hexToRgbInt(TAG_PALETTE[i]) },
  }));
}

/**
 * 우리가 **실제로 새로 추가하게 될** 쿼리 목록.
 *
 * 이 목록이 곧 되돌리기 대상이고, 그래서 소유 판정의 유일한 근거다.
 *
 * 왜 managedQueriesOf() 로는 안 되는가 — 이게 이 파일에서 가장 중요한 구분이다.
 * 볼트 최상단에는 "01. Projects/"~"04. Archives/" 폴더가 실제로 존재한다. PARA 를 쓰는
 * 사용자가 기본 그래프의 색상 그룹으로 이 폴더들을 손수 색칠해 뒀다면, 그 query 문자열은
 * 우리가 생성하는 것과 **한 글자도 다르지 않다.** 즉 문자열 일치로 소유를 판정하면:
 *  - 우리 명령을 한 번도 쓴 적 없는 사용자의 되돌리기가 자기가 만든 그룹을 지운다.
 *  - 적용이 사용자가 고른 색을 우리 색으로 덮어쓴다.
 * 둘 다 되돌릴 수 없는 손실이다.
 *
 * 그래서 소유는 추측하지 않는다. "적용 시점에 없었던 쿼리"만 우리 것이고, 호출부가 이
 * 목록을 플러그인 설정에 기록해 되돌리기에서 그대로 쓴다.
 */
export function addedQueriesOf(
  existing: readonly GraphColorGroup[],
  ours: readonly GraphColorGroup[],
): string[] {
  const present = new Set(existing.map((g) => g.query));
  return ours.filter((g) => !present.has(g.query)).map((g) => g.query);
}

/**
 * 기존 colorGroups 에 우리 그룹을 병합한다.
 *
 * 규칙:
 *  1. 사용자 수동 그룹은 하나도 지우지 않고 **원래 순서대로 앞쪽**에 남긴다
 *     (setQuery 는 첫 매칭 승리라 순서가 곧 우선순위다).
 *  2. **같은 쿼리가 이미 있으면 손대지 않는다.** 사용자가 이미 그 폴더를 분류해 뒀다는
 *     뜻이므로 우리 색을 강요할 이유가 없다. 없는 것만 뒤에 추가한다.
 *  3. 멱등: 몇 번 실행해도 결과와 길이가 같다(중복 생성 없음).
 *
 * @param existing 메모리에서 읽은 현재 배열. 변형하지 않는다.
 * @param ours 주입할 우리 그룹.
 * @param managedQueries 이전 적용에서 우리가 추가한 것으로 기록된 쿼리 목록. 그 항목은
 *   우리 것이 확실하므로 값을 갱신한다. 비어 있으면 기존 그룹을 전부 사용자 것으로 본다.
 */
export function mergeColorGroups(
  existing: readonly GraphColorGroup[],
  ours: readonly GraphColorGroup[],
  managedQueries: readonly string[],
): GraphColorGroup[] {
  const managed = new Set(managedQueries);
  const copy = (g: GraphColorGroup): GraphColorGroup => ({
    query: g.query,
    color: { a: g.color.a, rgb: g.color.rgb },
  });

  const ourByQuery = new Map(ours.map((g) => [g.query, g]));
  // 기존 항목은 순서를 그대로 유지한다. 우리가 기록한 쿼리만 최신 값으로 갱신하고,
  // 그 밖은 사용자 것이므로 색까지 손대지 않는다.
  const kept = existing.map((g) => {
    const mine = managed.has(g.query) ? ourByQuery.get(g.query) : undefined;
    return copy(mine ?? g);
  });

  // 아직 없는 쿼리만 뒤에 붙인다. 뒤에 붙이는 이유는 사용자 그룹의 우선순위를 지키기 위함이다.
  const present = new Set(existing.map((g) => g.query));
  const added = ours.filter((g) => !present.has(g.query)).map(copy);

  return [...kept, ...added];
}

/**
 * 우리 그룹만 제거한다 — 되돌리기 경로.
 *
 * 색을 입혔는데 지울 방법이 없으면 사용자가 갇힌다. 사용자 수동 그룹은 순서까지
 * 그대로 남으므로, 적용 → 제거 왕복이 원래 상태로 정확히 복귀한다.
 */
export function removeManagedGroups(
  existing: readonly GraphColorGroup[],
  managedQueries: readonly string[],
): GraphColorGroup[] {
  const managed = new Set(managedQueries);
  return existing
    .filter((g) => !managed.has(g.query))
    .map((g) => ({ query: g.query, color: { a: g.color.a, rgb: g.color.rgb } }));
}

/** 정규식 특수문자 이스케이프. 코어도 같은 처리를 한 뒤 RegExp 를 만든다. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `path:"..."` 쿼리 1개가 특정 경로를 잡는지 판정한다 — 코어 동작 재현.
 *
 * 왜 필요한가: 코어의 path: 는 완전일치가 아니라 **정규식 부분문자열** 매칭이다
 * (이스케이프 후 RegExp(x, "gmi")). 그래서 path:"a.md" 가 Notes/banana.md 에도 걸린다.
 * 우리가 만든 쿼리가 의도한 집합만 잡는지 증명하려면 그 동작을 그대로 재현해야 한다.
 *
 * 이 함수는 테스트가 실제 볼트 경로 전수를 돌려 충돌 0건을 확인하는 데 쓴다. 실제
 * 매칭은 코어가 하며 우리는 관여하지 않는다. PARA 폴더의 숫자 접두사("01. ")가
 * 부분문자열 매칭의 footgun 을 실질적으로 막아준다.
 */
export function matchesQuery(query: string, path: string): boolean {
  const quoted = query.match(/^path:"(.*)"$/);
  if (!quoted) return false;
  return new RegExp(escapeRegExp(quoted[1]), "i").test(path);
}

/**
 * 인덱스 엔트리에서 태그 사용 횟수를 집계한다 — 순수 함수.
 *
 * 볼트를 다시 스캔하지 않는다. buildEntry 가 이미 extractMetadata 로 각 노트의 tags 를
 * 채워 뒀으므로(vault-indexer.ts:386) 인덱스만 훑으면 된다 — 파일 읽기 0회.
 *
 * 태그 앞의 "#" 는 제거해 저장한다. Obsidian metadataCache 는 구현·버전에 따라 "#tag"
 * 와 "tag" 를 섞어 주는데, 그대로 두면 같은 태그가 두 그룹으로 갈라진다.
 */
export function collectTagUsage(
  entries: readonly { tags?: readonly string[] }[],
): TagUsage[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    // 한 노트에 같은 태그가 여러 번 있어도 1회로 센다 — 노트 수가 곧 그래프의 노드 수다.
    const unique = new Set<string>();
    for (const raw of entry.tags ?? []) {
      if (typeof raw !== "string") continue;
      const tag = raw.replace(/^#+/, "").trim();
      if (tag !== "") unique.add(tag);
    }
    for (const tag of unique) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  // 결정론적 정렬: 빈도 내림차순, 동점은 이름 오름차순.
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
