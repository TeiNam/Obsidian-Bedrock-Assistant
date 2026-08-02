// mermaid 그래프 공유 코어 + 검색 근거 그래프 — 순수 모듈
// ==========================================================
// 이 파일은 두 가지를 담는다:
//   1) 4개 그래프 빌더가 공유하는 코어 (escapeLabel / resolveLabel / mermaidNodeId /
//      상한 상수 / buildMermaidGraph)
//   2) 검색 근거 그래프 빌더 (buildSearchGraph)
//
// 전부 순수 함수다. Obsidian API·LLM·파일 IO 를 호출하지 않고, i18n 테이블도
// import 하지 않는다. 그래서 테스트가 볼트 없이 돈다. 절단 고지 문구나 신뢰도
// 경고처럼 언어가 필요한 표현은 숫자·플래그로만 보고하고 호출부(뷰 계층)가 만든다.
//
// mermaid 문법은 Obsidian 1.10 이 번들한 mermaid 11.13.0 기준으로 실측 검증한
// 규약을 따른다. 핵심 두 가지:
//   - 라벨은 예외 없이 항상 큰따옴표로 감싼다. 이게 근본 방어선이다. 대괄호·파이프·
//     화살표 유사 문자(`-->`)는 인용 안에서 전부 무해하므로 손대지 않는다.
//   - 노드 id 는 해시가 아니라 `n` + 순번이다. 충돌이 정의상 불가능하고 예약어
//     (`end`/`graph`/`class` 등, 실측 파스 에러)를 절대 생성하지 않는다.

import type { GraphRagResult, GraphRagSearchItem } from "../vault-indexer";

// === 상한 ===
//
// mermaid 11.13.0 실측 하드 리밋: maxEdges 500(초과 시 파스 자체가 실패),
// maxTextSize 50000자(초과 시 다이어그램이 에러 텍스트로 교체). 두 값 모두 mermaid
// `secure` 목록이라 코드블록 프론트매터로 올릴 수 없다 — 우리가 상한 아래에
// 머무는 것이 유일한 방법이다.

/**
 * 그래프 1개에 그릴 최대 노드 수.
 * 실질 상한은 mermaid 가 아니라 가독성이다. 채팅 패널 폭(수백 px)에 60노드는 이미
 * 빽빽하고, 200노드는 렌더돼도 읽을 수 없어 기능적으로 실패다.
 */
export const MERMAID_MAX_NODES = 60;

/**
 * 최대 엣지 수. mermaid 기본 maxEdges 500 의 30% 마진.
 * 파스 비용은 병목이 아니다(실측 490엣지 = 37ms). 진짜 비용은 dagre 레이아웃이고
 * 노드·엣지 수에 초선형이다. 150 은 레이아웃이 체감 즉시인 영역이며, mermaid 상류가
 * 기본값을 낮추거나 Obsidian 이 자체 config 를 주입해도 안전하다.
 */
export const MERMAID_MAX_EDGES = 150;

/** 제목과 경로가 모두 비었을 때 쓰는 라벨. 빈 라벨(`n0[""]`)은 mermaid 파스 에러다. */
export const UNTITLED_LABEL = "제목 없음";

/** 라벨 안에서 치환해야 하는 문자. 실측으로 확인된 것만 넣는다(과잉 이스케이프 금지). */
const LABEL_ESCAPE = /["<>&#`]/g;

/**
 * mermaid 디렉티브 도입 시퀀스.
 *
 * mermaid 는 preprocessDiagram 단계에서 **인용 라벨을 구분하지 않고** 원문 전체에
 * directiveRegex 를 적용한다. 따라서 노트 제목에 `%%{` 가 있으면 라벨 안이라도
 * 디렉티브로 해석된다. `%` 단독·`%%` 단독·`}%%` 는 실측상 안전하므로 이 3문자
 * 시퀀스만 무해화한다 — `%` 를 전부 엔티티화하면 "성장률 50% 분석" 같은 흔한
 * 제목이 불필요하게 변형된다.
 */
const LABEL_DIRECTIVE = /%%\{/g;

/**
 * 라벨 안에서 공백 1개로 정규화해야 하는 줄바꿈류.
 * U+2028/U+2029 도 포함한다 — 텍스트 에디터에서는 보이지 않지만 줄을 나눈다.
 */
const LABEL_LINEBREAK = /[\r\n\t\u{2028}\u{2029}]+/gu;

/**
 * 라벨 문자열을 mermaid 인용 라벨 안에서 안전하게 만든다.
 *
 * 치환 대상은 실측으로 확인된 5개뿐이다:
 * - `"` → `#quot;` : 인용 라벨을 깨는 유일한 문자. jison lexer 의 문자열 상태는
 *   다음 `"` 에서 종료되므로 라벨 내 따옴표는 파스 에러다.
 * - `<` `>` → `#60;` `#62;` : htmlLabels(기본 true)로 HTML 파싱되어 태그가
 *   소실되고(`A <b>bold</b>` → `A bold`), `javascript:` URL 이 SVG 에 잔존한다.
 *   노트 제목은 웹 클리퍼로 외부 HTML 이 유입될 수 있어 신뢰 경계로 취급한다.
 * - `&` → `#38;` : 엔티티 시작 문자.
 * - `#` → `#35;` : mermaid 자체 엔티티 문법의 도입 문자. 제목에 `#35;` 가 이미
 *   있으면 mermaid 의 decodeEntities 가 `/#\w+;/g` 를 잡아 `#` 로 디코드해버려
 *   텍스트가 조용히 훼손된다(실측: `Price #35; note` → `Price # note`).
 * - `` ` `` → `#96;` : 라벨이 백틱으로 시작하면 lexer 가 markdown-string 상태로
 *   진입해 "Lexical error ... Unrecognized text" 로 그래프 전체가 렌더되지 않는다.
 *   `` `useState` 훅 정리 `` 처럼 개발자 볼트에 흔한 H1 이 그대로 걸린다. 위치로
 *   분기하지 않고 전부 치환한다 — 라벨 앞이 잘리면 비선행 백틱도 선행이 된다.
 * - `%%{` → `%#37;{` : mermaid 는 preprocessDiagram 에서 인용 라벨을 구분하지 않고
 *   directiveRegex 를 적용한다. 미닫힘 `%%{` 하나가 남은 다이어그램 전체를 먹어
 *   파스 에러를 내고, `%%{init: {'theme':'forest'}}%%` 는 파스는 통과하면서 제목이
 *   소실되고 실제로 렌더 config 가 바뀐다(노트 제목이 config 주입 경로가 된다).
 *
 * 반대로 대괄호·중괄호·소괄호·파이프·화살표 유사(`-->`, `==>`)·세미콜론·
 * 단독 `%`·한글·이모지는 인용 안에서 전부 그대로 통과하고 원문대로 렌더된다.
 * 이들을 제거·치환하는 새니타이즈는 금지다 — 불필요하고 `[초안]`·`(2026)`·
 * `성장률 50%` 같은 실제 정보를 파괴한다.
 *
 * ⚠️ 알려진 한계: mermaid 의 decodeEntities 는 내부 sentinel `ﬂ°`→`&`, `¶ß`→`;`
 * 를 무조건 되돌린다. 제목에 이 2문자 인접 조합이 있으면 훼손되며, 디코드가
 * 엔티티화 이후 단계에서 일어나므로 이 계층에서 막을 수 없는 mermaid 상류 제약이다.
 * 단일 문자(`ﬂ`, `°`, `¶`, `ß`)는 안전하고, 한국어·영어 제목에서 인접 조합은
 * 사실상 발생하지 않아 대응하지 않는다.
 *
 * 줄바꿈류(개행·CR·TAB·U+2028·U+2029)는 유일하게 무손실이 아닌 처리다. mermaid
 * 문법은 줄 단위라서 라벨 안의 실제 개행은 노드 선언을 두 줄로 쪼개 그래프 전체를
 * 깨뜨린다. 연속된 줄바꿈류를 공백 1개로 접는다 — 제목이 한 줄로 보이는 것은
 * 사용자가 기대하는 동작이기도 하다.
 */
export function escapeLabel(raw: string): string {
  return (
    raw
      .replace(LABEL_LINEBREAK, " ")
      // 문자 치환을 **먼저** 한다. 순서를 뒤집으면 디렉티브 치환이 삽입한 `#` 을
      // LABEL_ESCAPE 가 다시 이스케이프해 `%#35;37;{` 이라는 깨진 엔티티가 나온다.
      .replace(LABEL_ESCAPE, (c) => (c === '"' ? "#quot;" : `#${c.codePointAt(0)};`))
      // 두 번째 `%` 만 엔티티화해 `%%{` 시퀀스를 깨뜨리되, 왕복 디코드로 원문이
      // 복원되게 한다(`%%{` → `%#37;{` → 디코드 → `%%{`).
      .replace(LABEL_DIRECTIVE, "%#37;{")
  );
}

/**
 * 노드 라벨을 결정한다. 절대 빈 문자열을 반환하지 않는다.
 *
 * 빈 라벨은 mermaid 파스 에러(`n1[""]` 실측 실패)이므로 노트 하나가 그래프 전체를
 * 죽인다. title 이 비는 경로는 드물지만 실재한다 — vault-indexer 의 H1 정규식은
 * 공백만인 `#    ` 을 매치하지 못하고, 프론트매터 안의 `# text` 를 본문 H1 으로
 * 오인하기도 한다.
 *
 * 폴백 순서: title → 확장자를 뗀 basename → UNTITLED_LABEL.
 */
export function resolveLabel(title: string, path: string): string {
  const trimmedTitle = title.trim();
  if (trimmedTitle.length > 0) return trimmedTitle;

  // 경로의 마지막 세그먼트에서 확장자를 뗀다. `folder/` 처럼 끝이 구분자면 빈 값이 된다.
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim();
  return stem.length > 0 ? stem : UNTITLED_LABEL;
}

/**
 * 순번으로 노드 id 를 만든다.
 *
 * 경로를 그대로 id 로 쓸 수 없다: 공백·`/`·괄호가 문법에 걸리고, 실측으로
 * `end`/`graph`/`subgraph`/`class`/`style`/`click` 6개 소문자 예약어가 전부 파스
 * 에러다(`Notes/end.md` 가 그래프를 죽인다). 해시도 쓰지 않는다 — 절단 해시는
 * 충돌 가능하고, 충돌하면 두 노트가 한 노드로 합쳐져 파스는 성공한 채로 그래프가
 * 조용히 거짓말을 한다. `n` 접두사 순번은 충돌이 정의상 불가능하고 예약어를 절대
 * 만들지 않으며, 같은 입력에 같은 출력이라 스냅샷 테스트가 가능하다.
 */
export function mermaidNodeId(index: number): string {
  return `n${index}`;
}

/** 그래프 노드 1개. 도메인 무관 최소 형태. */
export interface MermaidNode {
  /** 경로. 노드 id 생성 키이며 중복 경로는 같은 노드로 합쳐진다. */
  path: string;
  /** 사용자에게 보일 라벨(보통 노트 제목). 비어 있으면 path 에서 유도한다. */
  label: string;
  /** classDef 클래스명. 생략하면 스타일 미적용. */
  cls?: string;
}

/** 그래프 엣지 1개. from/to 는 노드의 path 를 가리킨다. */
export interface MermaidEdge {
  from: string;
  to: string;
  /** 엣지 라벨(예: 유사도 0.87). 생략하면 라벨 없는 화살표. */
  label?: string;
}

/** 그래프 조립 결과. 절단 여부를 숫자로 보고해 호출부가 고지 문구를 만든다. */
export interface MermaidGraph {
  /** 코드펜스를 포함한 마크다운. 노드가 0개면 빈 문자열. */
  markdown: string;
  /** 실제로 그린 노드 수 */
  shownNodes: number;
  /** 절단 전 전체 노드 수 */
  totalNodes: number;
  /** 절단 전 전체 엣지 수(양 끝이 살아 있는 유효 엣지 기준) */
  totalEdges: number;
}

/** buildMermaidGraph 옵션. */
export interface MermaidGraphOptions {
  /** 레이아웃 방향. 노트 제목이 가로로 길어 대부분 LR 이 유리하다. */
  direction: "LR" | "TD";
  /** classDef 줄 목록. 끝 세미콜론은 자동으로 제거된다. */
  classDefs?: readonly string[];
}

/** mermaid 본문 줄 들여쓰기. 라벨 안 백틱이 코드펜스를 닫지 못하게 하는 역할도 겸한다. */
const INDENT = "  ";

/**
 * 노드·엣지 목록을 mermaid 코드블록을 포함한 마크다운으로 조립한다 — 순수 함수.
 * 인자로 받은 배열을 변형하지 않으며, 같은 입력에 항상 같은 문자열을 반환한다.
 *
 * 상한은 노드 → 엣지 순으로 적용한다. 노드가 잘리면 그 노드를 가리키던 엣지도 함께
 * 버려야 한다 — mermaid 는 미선언 id 를 에러 없이 새 노드로 만들어버리므로(라벨은
 * id 그대로) `n42` 같은 유령 노드가 파스 성공한 채로 나타난다. 반대로 엣지가 잘려
 * 고립된 노드는 남긴다. 노드를 지우면 "이 노트가 볼트에 없다"로 오독된다.
 */
export function buildMermaidGraph(
  nodes: readonly MermaidNode[],
  edges: readonly MermaidEdge[],
  options: MermaidGraphOptions
): MermaidGraph {
  // --- 노드 중복 제거 ---
  // 같은 경로가 여러 번 들어오면 하나로 합치고 첫 라벨만 유지한다. mermaid 는 중복
  // 선언을 허용하지만 "마지막 텍스트가 이긴다"는 규칙 때문에 라벨이 예고 없이 바뀐다.
  const idByPath = new Map<string, string>();
  const unique: MermaidNode[] = [];
  for (const node of nodes) {
    if (idByPath.has(node.path)) continue;
    idByPath.set(node.path, mermaidNodeId(unique.length));
    unique.push(node);
  }

  const totalNodes = unique.length;
  if (totalNodes === 0) {
    // 노드 0개로 `graph LR` 만 내보내면 파스·렌더가 성공하면서 빈 사각형이 나와
    // 사용자에게는 "기능이 고장났다"로 보인다. 빈 문자열을 돌려주고, 안내 문구는
    // i18n 을 가진 호출부가 붙인다.
    return { markdown: "", shownNodes: 0, totalNodes: 0, totalEdges: 0 };
  }

  // --- 노드 상한 적용 ---
  // 각 빌더가 이미 정렬해 넘긴 배열의 앞에서 자른다(새 랭킹 로직을 만들지 않는다).
  const shown = unique.slice(0, MERMAID_MAX_NODES);
  const liveIds = new Set(shown.map((_, i) => mermaidNodeId(i)));

  // --- 유효 엣지 선별 ---
  // 살아남은 노드만 가리키고, 자기 참조가 아니고, 중복이 아닌 엣지만 남긴다.
  const seenEdges = new Set<string>();
  const validEdges: Array<{ from: string; to: string; label?: string }> = [];
  for (const edge of edges) {
    const from = idByPath.get(edge.from);
    const to = idByPath.get(edge.to);
    if (!from || !to) continue;
    if (!liveIds.has(from) || !liveIds.has(to)) continue;
    if (from === to) continue;
    const key = `${from}\x00${to}\x00${edge.label ?? ""}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    validEdges.push({ from, to, label: edge.label });
  }

  const totalEdges = validEdges.length;
  const drawnEdges = validEdges.slice(0, MERMAID_MAX_EDGES);

  // --- 줄 조립 ---
  const lines: string[] = [`graph ${options.direction}`];

  for (const [index, node] of shown.entries()) {
    const label = escapeLabel(resolveLabel(node.label, node.path));
    lines.push(`${INDENT}${mermaidNodeId(index)}["${label}"]`);
  }

  for (const edge of drawnEdges) {
    // 엣지 라벨도 노드 라벨과 동일한 escapeLabel 을 거친다. 지금은 숫자라 안전해
    // 보이지만 포맷 함수가 바뀌면 무너지므로 예외를 두지 않는다.
    const arrow =
      edge.label === undefined ? "-->" : `-->|"${escapeLabel(edge.label)}"|`;
    lines.push(`${INDENT}${edge.from} ${arrow} ${edge.to}`);
  }

  for (const def of options.classDefs ?? []) {
    // mermaid 의 encodeEntities 가 `/classDef.*:\S*#.*;/g` 를 특별 처리해 끝 문자를
    // 잘라낸다. 색상값에 `#` 이 있어 이 정규식에 반드시 걸리므로 세미콜론을 뗀다.
    lines.push(`${INDENT}${def.replace(/;+$/, "")}`);
  }

  // 클래스는 노드별 `style` 이 아니라 `class a,b,c name` 으로 묶어 적용한다. 줄 수가
  // 노드 수만큼 늘면 maxTextSize 여유를 먹고 diff 도 지저분해진다.
  const byClass = new Map<string, string[]>();
  for (const [index, node] of shown.entries()) {
    if (!node.cls) continue;
    const bucket = byClass.get(node.cls);
    const id = mermaidNodeId(index);
    if (bucket) bucket.push(id);
    else byClass.set(node.cls, [id]);
  }
  for (const [cls, ids] of byClass) {
    lines.push(`${INDENT}class ${ids.join(",")} ${cls}`);
  }

  return {
    markdown: ["```mermaid", ...lines, "```"].join("\n"),
    shownNodes: shown.length,
    totalNodes,
    totalEdges,
  };
}

// === 검색 근거 그래프 ===

/**
 * 검색 근거 그래프의 classDef 4줄.
 * 색은 의미가 있는 구분(시드 vs 1hop vs 2hop+)에만 쓴다. 라이트·다크 테마 모두에서
 * 읽히도록 밝은 fill + 진한 stroke 조합을 쓴다(Obsidian 테마 변수를 mermaid
 * classDef 에서 쓸 수 없어 고정 색이지만 대비를 확보했다).
 *
 * `stroke-dasharray` 의 콤마는 `\,` 로 이스케이프해야 하므로 공백 구분(`4 2`)으로
 * 회피한다. 세미콜론으로 끝내지 않는 이유는 buildMermaidGraph 주석 참조.
 */
const SEARCH_CLASS_DEFS: readonly string[] = [
  "classDef seed fill:#e8f0ff,stroke:#4a6fa5,stroke-width:2px",
  "classDef hop1 fill:#f4f6f8,stroke:#8a9ba8",
  "classDef hop2 fill:#fafafa,stroke:#b0b8c0,stroke-dasharray:4 2",
];

/**
 * hop 값을 classDef 클래스명으로 바꾼다.
 * hop 3 이상은 hop2 로 묶는다 — 순회 깊이 상한이 3이라 클래스가 폭발하지는 않지만,
 * 3단계 이상의 회색 계조는 시각적으로 구분되지 않아 클래스를 늘릴 값이 없다.
 */
function hopClass(item: GraphRagSearchItem): string {
  if (item.isSeed || item.hop <= 0) return "seed";
  return item.hop === 1 ? "hop1" : "hop2";
}

/**
 * combinedScore 를 라벨 접미사로 만든다.
 *
 * 엣지 라벨이 아니라 노드 라벨에 붙인다. 엣지는 "이 시드가 이 이웃을 도달시켰다"는
 * 링크 관계이고 점수는 노드 자신의 속성이므로, 엣지에 점수를 얹으면 관계가 아니라
 * 노드 속성을 화살표에 잘못 매달게 된다. 화살표마다 숫자가 붙으면 가독성도 무너진다.
 */
function scoreSuffix(score: number): string {
  return Number.isFinite(score) ? ` (${score.toFixed(2)})` : "";
}

/**
 * 검색 근거 그래프를 만든다 — 시드(hop 0)에서 이웃으로 뻗는 mermaid 그래프.
 *
 * 그래프 계산을 새로 하지 않는다. GraphRagResult 의 각 항목이 이미 hop·isSeed·
 * seedPath 를 들고 있고, `seedPath → path` 가 곧 엣지다. traverseGraph 가 최소 hop
 * 하나만 남기므로 중복 경로는 없어야 하지만, 방어적으로 buildMermaidGraph 의 경로
 * 중복 제거를 그대로 신뢰한다.
 *
 * 방향은 LR — 쿼리에서 시드, 시드에서 이웃으로 가는 hop 진행이 왼쪽에서 오른쪽
 * 깊이로 읽히고 `hop` 값이 그대로 x축이 된다. 가로로 긴 노트 제목이 깊이 방향과
 * 일치해 폭도 덜 낭비한다.
 *
 * staleEmbeddings / usedKeywordFallback 이 true 여도 그래프는 그대로 그린다. 근거의
 * 신뢰도가 낮다는 사실은 사용자가 알아야 하지만, 그 문구는 i18n 이 필요하므로
 * 호출부가 원본 result 의 플래그를 보고 붙인다(순수 코어는 언어 테이블을 모른다).
 */
export function buildSearchGraph(result: GraphRagResult): MermaidGraph {
  const items = result.items ?? [];

  // --- 노드 순서: 시드 우선, 그 다음 원래 정렬(combinedScore 내림차순) 유지 ---
  // 상한에 걸릴 때 시드가 잘리면 이웃의 seedPath 가 그래프에 없는 노드를 가리켜
  // 엣지가 통째로 사라지고 이웃이 근거 없이 떠 있게 된다. 시드를 앞으로 모아
  // 절단이 항상 꼬리(점수 낮은 이웃)에서 일어나게 한다.
  const seeds = items.filter((it) => it.isSeed || it.hop <= 0);
  const neighbors = items.filter((it) => !(it.isSeed || it.hop <= 0));
  const ordered = [...seeds, ...neighbors];

  const nodes: MermaidNode[] = ordered.map((it) => ({
    path: it.path,
    label: `${resolveLabel(it.title, it.path)}${scoreSuffix(it.combinedScore)}`,
    cls: hopClass(it),
  }));

  // 엣지 방향은 seed → neighbor. seedPath 가 null 인 시드는 물론이고, 상한으로
  // 잘려나가 items 에 없는 경로를 가리키는 이웃도 엣지를 만들지 못한다 —
  // buildMermaidGraph 가 미선언 경로 엣지를 버려 유령 노드를 막는다.
  const edges: MermaidEdge[] = ordered
    .filter((it) => it.seedPath !== null && it.seedPath !== undefined)
    .map((it) => ({ from: it.seedPath as string, to: it.path }));

  return buildMermaidGraph(nodes, edges, {
    direction: "LR",
    classDefs: SEARCH_CLASS_DEFS,
  });
}
