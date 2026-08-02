// 위키 폴더 구조 그래프 (Wiki Graph) — 순수 모듈
// ================================================
// Second Brain 위키 폴더의 노트를 카테고리별 mermaid subgraph 로 묶고, 위키 노트
// 사이의 링크를 엣지로 그린다. "위키가 실제로 얼마나 연결됐는지" 확인하는 용도다.
//
// 이 그래프의 존재 이유는 하나다: **위키 노트가 서로 전혀 연결되지 않았다면 그건
// 지식 베이스가 아니라 그냥 파일 더미다.** 그 사실이 그림에서 즉시 드러나야 한다.
// 그래서 엣지가 하나도 없는 노트는 전부 `isolated` 클래스(경고색 점선)로 칠한다.
// 링크가 0개인 위키는 "점선 상자만 늘어선 그림"이 되어 한눈에 문제가 보인다.
//
// 전부 순수 함수다. Vault·LLM·i18n 접근이 0회이며, 이미 메모리에 있는
// VaultIndexEntry 의 outlinks/backlinks 만 읽는다(읽기 전용). 안내 문구는 언어
// 테이블을 가진 호출부가 붙이고, 이 모듈은 숫자와 status 만 보고한다.
//
// 위키 밖으로 나가는 링크는 **그리지 않고 개수만 센다**(externalLinks). 전부 그리면
// 위키 노트 하나가 볼트 전체를 끌고 들어와 상한을 즉시 소진하고, 정작 알고 싶은
// "위키 내부 연결도"가 외부 노드에 묻힌다. 개수만 있으면 "위키가 볼트와 얼마나
// 닿아 있는가"는 알 수 있으므로 정보 손실도 없다.

import type { VaultIndexEntry } from "../types";
import { DEFAULT_SECOND_BRAIN_SETTINGS } from "../types";
import { WIKI_CATEGORIES } from "../second-brain/wiki-structure";
import {
  escapeLabel,
  resolveLabel,
  mermaidNodeId,
  MERMAID_MAX_NODES,
  MERMAID_MAX_EDGES,
} from "./mermaid-graph";

/**
 * 그래프 1개에 그릴 최대 노드 수. 공유 코어의 상한을 그대로 쓴다 — 4종 그래프가
 * 서로 다른 상한을 갖는 순간 "왜 이 그래프만 잘렸나"를 설명할 수 없게 된다.
 */
export const WIKI_GRAPH_MAX_NODES = MERMAID_MAX_NODES;

/** 최대 엣지 수. mermaid 기본 maxEdges 500 을 넘으면 파스 자체가 실패한다. */
export const WIKI_GRAPH_MAX_EDGES = MERMAID_MAX_EDGES;

/** 표준 카테고리에 속하지 않는 노트(위키 루트 직속 포함)를 모으는 그룹 이름. */
const UNCATEGORIZED = "기타";

/**
 * 위키 루트에 있는 생성물 파일명. 그래프에서 제외한다.
 *
 * index.md 는 카탈로그라서 모든 위키 노트를 링크한다. 노드로 넣으면 전 노트가
 * index 를 경유해 연결된 것처럼 보여 "위키가 잘 연결돼 있다"는 **거짓 신호**가 된다.
 * 이 그래프의 유일한 가치가 연결도 판정이므로 생성물은 반드시 빼야 한다.
 *
 * wiki-structure.ts 의 INDEX_FILE/LOG_FILE 과 같은 값이지만 그쪽은 모듈 private 이라
 * 여기서 다시 선언한다(그 파일을 수정하지 않기 위한 의도적 중복).
 */
const GENERATED_FILES: readonly string[] = ["index.md", "log.md"];

/** classDef 클래스명 — 다른 노트와 연결된 위키 노트. */
const CLASS_CONNECTED = "wiki";
/** classDef 클래스명 — 어떤 위키 노트와도 연결되지 않은 노트(이 그래프의 핵심 신호). */
const CLASS_ISOLATED = "isolated";

/**
 * 스타일 정의. 연결된 노트는 차분한 초록, 고립 노트는 경고색 + 점선으로 구분한다.
 *
 * 주의 1: mermaid 의 encodeEntities 가 `/classDef.*:\S*#.*;/g` 를 특별 처리해 끝
 * 세미콜론을 잘라먹으므로 세미콜론으로 끝내지 않는다.
 * 주의 2: stroke-dasharray 의 콤마는 `\,` 이스케이프가 필요하므로 공백 구분(`4 2`)으로
 * 회피한다 — 이게 더 안전하다.
 * 주의 3: Obsidian 테마 변수를 classDef 에서 쓸 수 없어 고정 색을 쓰되, 라이트/다크
 * 양쪽에서 읽히도록 밝은 fill + 진한 stroke 조합으로 대비를 확보한다.
 */
const CLASS_DEFS: Readonly<Record<string, string>> = {
  [CLASS_CONNECTED]: `classDef ${CLASS_CONNECTED} fill:#eef7ee,stroke:#5a8f5a`,
  [CLASS_ISOLATED]: `classDef ${CLASS_ISOLATED} fill:#fff4e6,stroke:#c98a3c,stroke-dasharray:4 2`,
};

/** buildWikiGraph 입력 옵션. 이 그래프만 Second Brain 기능이므로 enabled 를 받는다. */
export interface WikiGraphOptions {
  /** Wiki_Folder 루트 경로 (settings.secondBrain.wikiFolder). */
  wikiFolder: string;
  /** settings.secondBrain.enabled. false 면 그래프를 만들지 않는다. */
  enabled: boolean;
}

/**
 * 그래프 생성 결과 상태.
 * - `disabled`: Second Brain 비활성 → 호출부가 sbDisabled 안내 후 중단
 * - `empty`: 위키 노트가 0개 → 호출부가 "아직 위키 노트가 없습니다" 안내
 * - `ok`: 그래프를 그렸다
 */
export type WikiGraphStatus = "disabled" | "empty" | "ok";

/** 위키 구조 그래프 결과. 절단·고립 여부를 숫자로 보고해 호출부가 고지 문구를 만든다. */
export interface WikiGraph {
  /** 결과 상태. markdown 이 빈 이유를 호출부가 구분할 수 있게 한다. */
  status: WikiGraphStatus;
  /** 코드펜스를 포함한 마크다운. status 가 ok 가 아니면 빈 문자열. */
  markdown: string;
  /** 실제로 그린 노드 수 */
  shownNodes: number;
  /** 절단 전 전체 위키 노트 수 */
  totalNodes: number;
  /** 실제로 그린 엣지 수 */
  shownEdges: number;
  /** 절단 전 전체 위키 내부 엣지 수. 0 이면 "그냥 파일 더미"라는 뜻이다. */
  totalEdges: number;
  /** 어떤 위키 노트와도 연결되지 않은 노트 수(전체 기준). */
  isolatedNodes: number;
  /** 위키 밖을 가리키는 링크 수. 그래프에는 그리지 않고 개수만 보고한다. */
  externalLinks: number;
}

/** 그래프에 올릴 위키 노트 1건 (내부 표현). */
interface WikiNote {
  path: string;
  /** 정렬 기준으로 쓰는 원문 제목(빈 문자열일 수 있다). */
  title: string;
  /** 이스케이프 전 표시 라벨. 빈 라벨은 mermaid 파스 에러라 항상 비어 있지 않다. */
  label: string;
  /** 소속 그룹(표준 카테고리 또는 "기타"). */
  category: string;
}

/**
 * wikiFolder 를 방어적으로 정규화한다.
 * normalizeSecondBrainSettings 가 이미 공백/빈 값을 보정하지만, 이 순수 함수는
 * 설정을 거치지 않은 값(테스트·직접 호출)도 받을 수 있으므로 한 번 더 막는다.
 * 끝 슬래시를 떼는 이유: `"Wiki/"` 를 그대로 쓰면 접두사 비교가 `"Wiki//"` 가 되어
 * 모든 노트가 위키 밖으로 판정된다.
 */
function normalizeWikiFolder(raw: string): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "").trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_SECOND_BRAIN_SETTINGS.wikiFolder;
}

/**
 * 경로가 위키 폴더 하위인지 판정하고, 하위면 위키 루트 기준 상대 경로를 반환한다.
 *
 * 세그먼트 경계(`folder + "/"`)로 비교하므로 `"Second Brain2/x.md"` 같은 접두사만
 * 같은 폴더가 위키로 오인되지 않는다. 위키 폴더 자신(경로가 폴더와 동일)은 노트가
 * 아니므로 제외한다.
 */
function toWikiRelativePath(path: string, wikiFolder: string): string | null {
  const prefix = `${wikiFolder}/`;
  if (!path.startsWith(prefix)) return null;
  const relative = path.slice(prefix.length);
  return relative.length > 0 ? relative : null;
}

/**
 * 상대 경로의 **첫 세그먼트**로 카테고리를 판정한다.
 *
 * 문자열 포함(`path.includes("concepts")`)으로 판정하면 `"concepts note.md"` 나
 * `"entities-backup/x.md"` 가 오탐된다. indexOf("/") 로 첫 세그먼트를 정확히 끊어
 * 완전 일치로만 비교하므로 오탐이 구조적으로 불가능하다.
 * 슬래시가 없으면 위키 루트 직속 노트이며, 표준 카테고리가 아니므로 "기타"다
 * (obsidian-tools 의 create_wiki_note 도 비표준 카테고리를 루트에 만든다).
 */
function categoryOf(relativePath: string): string {
  const slash = relativePath.indexOf("/");
  if (slash < 0) return UNCATEGORIZED;
  const head = relativePath.slice(0, slash);
  return (WIKI_CATEGORIES as readonly string[]).includes(head) ? head : UNCATEGORIZED;
}

/**
 * 두 노트를 제목 오름차순(동일 시 경로 오름차순)으로 비교한다.
 * wiki-structure.ts 의 compareEntries 와 같은 규칙을 쓴다 — 같은 위키를 보는 두
 * 기능이 서로 다른 순서를 내놓으면 사용자가 대조할 수 없다.
 */
function compareNotes(a: WikiNote, b: WikiNote): number {
  if (a.title < b.title) return -1;
  if (a.title > b.title) return 1;
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/**
 * 위키 노트를 수집한다 — 중복 경로 제거(첫 항목 우선), 생성물 제외.
 * 인자 배열을 변형하지 않고 새 배열을 만든다.
 */
function collectWikiNotes(
  entries: readonly VaultIndexEntry[],
  wikiFolder: string,
): WikiNote[] {
  const notes: WikiNote[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const relative = toWikiRelativePath(entry.path, wikiFolder);
    if (relative === null) continue;
    // 카탈로그·로그는 전 노트를 링크하므로 연결도 판정을 오염시킨다.
    if (GENERATED_FILES.includes(relative)) continue;
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);

    const title = entry.title ?? "";
    notes.push({
      path: entry.path,
      title,
      // 빈 라벨(`n1[""]`)은 mermaid 파스 에러다. 제목 → 파일명 → 상수로 폴백한다.
      // 줄바꿈류 접기는 escapeLabel 이 처리하므로 여기서 손대지 않는다.
      label: resolveLabel(title, entry.path),
      category: categoryOf(relative),
    });
  }

  return notes;
}

/** 위키 내부 엣지 1건. */
interface WikiEdge {
  from: string;
  to: string;
}

/** 위키 내부 엣지와 외부 링크 개수를 함께 계산한 결과. */
interface LinkScan {
  /** 위키 내부 엣지 (중복·자기참조 제거, 결정론적 순서). */
  edges: WikiEdge[];
  /** 엣지에 한 번이라도 등장한 경로 = 연결된 노트. */
  connected: Set<string>;
  /** 위키 밖을 가리키는 (출처, 대상) 쌍의 수. */
  externalLinks: number;
}

/**
 * 위키 노트들의 outlinks/backlinks 로 내부 엣지와 외부 링크 수를 계산한다.
 *
 * backlinks 도 함께 읽는 이유: 인덱스의 outlinks/backlinks 는 서로 어긋날 수 있고
 * (knowledge-gaps 의 one-way 판정이 이걸 다룬다), 한쪽만 보면 실제로 존재하는 연결을
 * 놓쳐 "고립"이라는 강한 주장을 잘못 하게 된다. 이 그래프의 결론이 "연결 여부"인
 * 만큼 연결을 놓치는 오류가 가장 비싸다.
 *
 * 외부 링크는 **나가는 방향만** 센다. 들어오는 링크(볼트 노트가 위키를 참조)는 위키의
 * 연결 노력이 아니라 볼트 쪽 사정이고, backlinks 로 세면 링크 하나가 양쪽에서 두 번
 * 집계된다.
 */
function scanLinks(
  notes: readonly WikiNote[],
  entries: readonly VaultIndexEntry[],
  wikiFolder: string,
): LinkScan {
  // 위키 노트로 채택된 경로만 엣지 대상이다. 위키 폴더 하위지만 제외된 생성물
  // (index.md/log.md)과 아직 존재하지 않는 노트는 여기 없으므로 자연히 걸러진다.
  const wikiPaths = new Set(notes.map((note) => note.path));

  // 경로 → 엔트리. 중복 경로는 첫 항목만 쓴다(collectWikiNotes 와 동일 규칙).
  const entryByPath = new Map<string, VaultIndexEntry>();
  for (const entry of entries) {
    if (!entryByPath.has(entry.path)) entryByPath.set(entry.path, entry);
  }

  const edges: WikiEdge[] = [];
  const edgeKeys = new Set<string>();
  const connected = new Set<string>();
  const externalKeys = new Set<string>();

  /** 엣지 추가 — 자기참조·중복은 버린다. */
  const addEdge = (from: string, to: string): void => {
    if (from === to) return;
    const key = `${from}\x00${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to });
    connected.add(from);
    connected.add(to);
  };

  // 엔트리 원본이 아니라 수집·정렬된 notes 를 순회하므로 엣지 순서가 결정적이다.
  for (const note of notes) {
    const entry = entryByPath.get(note.path);
    if (!entry) continue;

    for (const target of entry.outlinks ?? []) {
      if (wikiPaths.has(target)) {
        // 위키 내부 링크 → 엣지
        addEdge(note.path, target);
      } else if (toWikiRelativePath(target, wikiFolder) === null) {
        // 위키 밖으로 나가는 링크 → 그리지 않고 개수만 센다. 전부 그리면 볼트 전체가
        // 딸려온다. 같은 (출처, 대상) 쌍이 두 번 세지지 않게 dedupe 한다.
        externalKeys.add(`${note.path} ${target}`);
      }
      // 남는 경우: 위키 폴더 하위지만 노드가 아닌 대상(생성물·아직 없는 노트).
      // 외부도 아니고 그릴 수도 없으므로(유령 노드 금지) 조용히 버린다.
    }

    // backlinks 는 방향을 뒤집어 엣지로 복원한다(외부 링크로는 세지 않는다).
    for (const source of entry.backlinks ?? []) {
      if (wikiPaths.has(source)) addEdge(source, note.path);
    }
  }

  return { edges, connected, externalLinks: externalKeys.size };
}

/**
 * 노드 상한을 카테고리 그룹에 균등 배분한다(라운드 로빈 water-filling).
 *
 * 한 카테고리가 상한을 다 먹으면 다른 카테고리가 통째로 사라진다. entities 100개 +
 * concepts 5개인 위키에서 concepts 가 그림에서 없어지면 "concepts 를 안 쓰고 있다"는
 * 잘못된 결론을 유도한다. 그룹당 1개씩 돌아가며 채우면 소수 카테고리가 항상 살아남고,
 * 남는 몫은 자연히 큰 그룹으로 흘러간다.
 *
 * 비용: 그룹 4개 × 상한 60 이라 최악 240회 루프다. 별도 최적화가 필요 없다.
 */
function allocateBudget(sizes: readonly number[], budget: number): number[] {
  const quota = sizes.map(() => 0);
  const demand = sizes.reduce((sum, n) => sum + n, 0);
  let remaining = Math.min(budget, demand);

  while (remaining > 0) {
    let progressed = false;
    for (let i = 0; i < sizes.length && remaining > 0; i += 1) {
      if (quota[i] >= sizes[i]) continue;
      quota[i] += 1;
      remaining -= 1;
      progressed = true;
    }
    // 모든 그룹이 수요를 채웠으면 더 배분할 곳이 없다(무한 루프 방지).
    if (!progressed) break;
  }

  return quota;
}

/**
 * 위키 폴더 구조 그래프를 mermaid 코드블록을 포함한 마크다운으로 만든다 — 순수 함수.
 *
 * 인자로 받은 배열·객체를 변형하지 않으며, 같은 입력(순서 무관)에 항상 같은 문자열을
 * 반환한다. `graph TD` 를 쓰는 이유: 카테고리 → 노트는 계층이고, 계층은 위→아래가
 * 관례이며 카테고리 3~4개가 최상단 형제로 나란히 놓인다.
 */
export function buildWikiGraph(
  entries: readonly VaultIndexEntry[],
  options: WikiGraphOptions,
): WikiGraph {
  const empty = (status: WikiGraphStatus): WikiGraph => ({
    status,
    markdown: "",
    shownNodes: 0,
    totalNodes: 0,
    shownEdges: 0,
    totalEdges: 0,
    isolatedNodes: 0,
    externalLinks: 0,
  });

  // 4종 그래프 중 이것만 Second Brain 기능이므로 enabled 를 확인한다.
  // 읽기 전용이지만 위키 폴더가 대상이라 기능을 안 쓰는 사용자에게는 의미가 없다.
  if (!options.enabled) return empty("disabled");

  const wikiFolder = normalizeWikiFolder(options.wikiFolder);
  const notes = collectWikiNotes(entries, wikiFolder).sort(compareNotes);

  // 위키 폴더가 없거나 노트가 0개 — Second Brain 을 켜기만 하고 안 쓴 가장 흔한 상태.
  // `graph TD` 만 내보내면 빈 사각형이 렌더되어 "고장난 기능"으로 보이므로 빈 문자열을
  // 돌려주고 안내는 i18n 을 가진 호출부에 맡긴다.
  if (notes.length === 0) return empty("empty");

  const { edges, connected, externalLinks } = scanLinks(notes, entries, wikiFolder);

  // === 노드 절단: 카테고리 그룹 순서 고정 + 그룹별 균등 배분 ===
  const orderedCategories = [...WIKI_CATEGORIES, UNCATEGORIZED];
  const groups = orderedCategories
    .map((category) => ({
      category,
      notes: notes.filter((note) => note.category === category),
    }))
    .filter((group) => group.notes.length > 0);

  const quotas = allocateBudget(
    groups.map((group) => group.notes.length),
    WIKI_GRAPH_MAX_NODES,
  );
  const shownGroups = groups
    .map((group, i) => ({ category: group.category, notes: group.notes.slice(0, quotas[i]) }))
    .filter((group) => group.notes.length > 0);

  // 경로 → 노드 id. 출력 순서 기반 순번이라 결정적이고, `n` 접두사가 mermaid
  // 예약어(end/graph/subgraph/class/style/click) 생성을 구조적으로 막는다.
  const idByPath = new Map<string, string>();
  for (const group of shownGroups) {
    for (const note of group.notes) {
      idByPath.set(note.path, mermaidNodeId(idByPath.size));
    }
  }

  // === 엣지 절단: 양 끝이 모두 살아남은 엣지만, 그리고 상한까지 ===
  // 절단된 노드를 가리키는 엣지를 남기면 mermaid 가 미선언 id 를 새 노드로 만들어
  // `n42` 같은 유령 노드가 조용히 생긴다(파스는 성공하므로 아무도 모른다).
  const drawableEdges = edges.filter(
    (edge) => idByPath.has(edge.from) && idByPath.has(edge.to),
  );
  const shownEdges = drawableEdges.slice(0, WIKI_GRAPH_MAX_EDGES);

  // === 조립 ===
  const lines: string[] = ["graph TD"];

  shownGroups.forEach((group, index) => {
    // 서브그래프 라벨도 노드 라벨과 동일한 escapeLabel 을 거친다 — 라벨을 만드는
    // 모든 지점이 같은 함수를 통과해야 이스케이프 누락이 재발하지 않는다.
    lines.push(`  subgraph g${index}["${escapeLabel(group.category)}"]`);
    for (const note of group.notes) {
      lines.push(`    ${idByPath.get(note.path)}["${escapeLabel(note.label)}"]`);
    }
    lines.push("  end");
  });

  for (const edge of shownEdges) {
    lines.push(`  ${idByPath.get(edge.from)} --> ${idByPath.get(edge.to)}`);
  }

  // 클래스별로 id 를 묶어 한 줄로 적용한다. 노드마다 style 을 쓰면 줄 수가 노드 수만큼
  // 늘어 maxTextSize 여유를 먹고 diff 도 지저분해진다.
  const membersByClass = new Map<string, string[]>([
    [CLASS_CONNECTED, []],
    [CLASS_ISOLATED, []],
  ]);
  for (const group of shownGroups) {
    for (const note of group.notes) {
      const cls = connected.has(note.path) ? CLASS_CONNECTED : CLASS_ISOLATED;
      membersByClass.get(cls)?.push(idByPath.get(note.path) as string);
    }
  }

  // 실제로 쓰인 클래스만 classDef 를 낸다 — 쓰지 않는 스타일 정의는 노이즈다.
  for (const [cls, members] of membersByClass) {
    if (members.length > 0) lines.push(`  ${CLASS_DEFS[cls]}`);
  }
  for (const [cls, members] of membersByClass) {
    if (members.length > 0) lines.push(`  class ${members.join(",")} ${cls}`);
  }

  const shownNodes = idByPath.size;
  return {
    status: "ok",
    markdown: ["```mermaid", ...lines, "```"].join("\n"),
    shownNodes,
    totalNodes: notes.length,
    shownEdges: shownEdges.length,
    totalEdges: edges.length,
    // 고립 판정은 절단 전 전체 위키 기준이다. 절단된 이웃 때문에 연결된 노트가
    // 고립으로 표시되면 이 그래프의 핵심 신호가 거짓이 된다.
    isolatedNodes: notes.filter((note) => !connected.has(note.path)).length,
    externalLinks,
  };
}
