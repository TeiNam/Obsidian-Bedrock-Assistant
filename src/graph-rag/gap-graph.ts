// 지식 공백 그래프 (Knowledge Gap Graph) — 순수 모듈
// ==================================================
// collectGaps/rankGaps 가 계산한 GapCandidate[] 를 mermaid 그래프로 렌더한다.
// 계산은 knowledge-gaps.ts 에서 이미 끝났고 이 파일은 렌더링만 한다 — 공백 판정
// 로직을 여기서 다시 만들지 않는다.
//
// 순수 함수다. Obsidian API·LLM·파일 IO·i18n 테이블을 호출하지 않으므로 테스트가
// 볼트 없이 돈다. 절단 고지 문구는 숫자(shownNodes/totalNodes)로만 보고하고
// 언어가 필요한 표현은 호출부(뷰 계층)가 만든다.
//
// ─── 설계 판단: 왜 "엣지 없는 단일 그래프 + 종류별 스타일" 인가 ───
//
// 4종 공백은 성격이 다르므로 서브그래프 분리·엣지 표현·엣지 있는 종류만 그리기를
// 모두 검토했다. 결론은 노드만 있는 단일 그래프이며, 근거는 취향이 아니라 데이터
// 구조와 공유 코어의 실제 제약이다.
//
// 1) 엣지를 그릴 수 없다 — GapCandidate 에 상대 경로가 없다.
//    엣지에는 양 끝 경로가 필요하지만 GapCandidate 는 `path` 하나만 들고 있다.
//    - one-way: 링크 대상이 `detail` 한국어 산문에 묻혀 있다
//      (`"B.md를 링크하지만 되돌아오는 참조가 없습니다."`, knowledge-gaps.ts:143).
//      산문을 정규식으로 되파싱해 경로를 복원하는 방법은 쓰지 않는다 — detail 문구가
//      바뀌면 그래프가 조용히 비고, 경로에 "를 링크하지만" 이 들어가면 오파싱한다.
//      표현 계층이 다른 계층의 산문 포맷에 의존하는 건 그 자체로 결합이다.
//    - missing: 참조 출처가 findUnresolvedLinkTargets 에서 개수로 집계되며
//      (`sources`/`total`) 출처 경로 자체는 반환값에 남지 않는다(:176-184).
//      실측 확인: `{ "note.md": { "없는 노트": 3 } }` → path 는 `"없는 노트"` 뿐이고
//      `"note.md"` 는 사라진다.
//    엣지를 그리려면 knowledge-gaps.ts 에 구조적 필드를 추가해야 하는데, 그 파일은
//    다른 담당 영역이고 지금 필요한 것은 렌더링뿐이다(ponytail: 최단 diff).
//
// 2) 서브그래프를 쓸 수 없다 — 공유 코어에 primitive 이 없다.
//    buildMermaidGraph 는 `graph`·노드·엣지·classDef·class 줄만 조립한다
//    (mermaid-graph.ts:214-247). subgraph 를 쓰려면 공유 코어를 수정해야 하고,
//    그 파일은 다른 담당이 만든다. 문자열을 직접 조립해 우회하면 escapeLabel 을
//    건너뛰는 새 라벨 경로가 생겨 알려진 위험 목록의 첫 항목을 그대로 밟는다.
//
// 3) "엣지 있는 종류만 그리기" 는 기능을 없애는 선택이다.
//    (1) 때문에 엣지를 가진 종류가 애초에 없다. 설령 있어도 orphan(고립)은 이 기능의
//    핵심 대상이고, 고립은 "엣지가 없음" 자체가 정보다. 엣지 기준으로 종류를 버리면
//    가장 중요한 공백이 그림에서 사라진다.
//
// 4) 그래서 남는 것은 노드만 있는 단일 그래프이고, 이게 실제로 맞는 표현이다.
//    사용자 질문은 "어디가 끊겨 있나"이고, 답은 끊긴 지점의 목록이다. 4종을 종류별로
//    묶어 배치하고 색·테두리·라벨 접두사로 구분하면 dagre 가 같은 클래스끼리 열로
//    쌓아 종류 구분이 시각적으로 드러난다. 상한도 노드 60 하나만 걸리므로 20건
//    (GAP_REPORT_LIMIT)인 실제 입력에서는 절단이 일어나지 않는다.
//
// 구분을 색에만 의존하지 않고 라벨 접두사(`[고립]`)를 함께 넣는다. mermaid classDef
// 는 고정 색이라 Obsidian 다크 테마에서 대비가 떨어질 수 있고, 색만으로 구분하면
// 색각 이상 사용자에게 정보가 전달되지 않는다. 접두사는 두 경우 모두를 덮는다.

import type { GapCandidate, GapKind } from "../second-brain/knowledge-gaps";
import {
  buildMermaidGraph,
  resolveLabel,
  type MermaidGraph,
  type MermaidNode,
} from "./mermaid-graph";

/**
 * 종류별 렌더 순서. knowledge-gaps.ts 의 KIND_ORDER(중요도 순)와 같은 순서를 쓴다.
 *
 * 같은 종류를 인접하게 배치해 dagre 가 열로 묶어 놓게 하고, 리스트 리포트
 * (buildGapReport)와 그래프의 종류 순서를 일치시킨다. 두 뷰의 순서가 다르면 같은
 * 데이터를 보면서도 대조가 어려워진다.
 *
 * 그 파일의 KIND_ORDER 는 export 되지 않아 여기서 다시 선언한다. 상수 하나를
 * export 시키려고 다른 담당의 파일을 건드리지 않는다.
 */
const KIND_ORDER: readonly GapKind[] = ["missing", "stub", "orphan", "one-way"];

/**
 * 종류별 classDef 클래스명. mermaid id 규칙상 하이픈이 안전하지 않아
 * `one-way` → `gapOneWay` 로 camelCase 를 쓴다.
 */
const KIND_CLASS: Record<GapKind, string> = {
  missing: "gapMissing",
  stub: "gapStub",
  orphan: "gapOrphan",
  "one-way": "gapOneWay",
};

/**
 * 라벨 접두사에 쓰는 짧은 종류 표기.
 *
 * 리스트 리포트의 제목(`"참조되지만 없는 노트"`)은 그래프 노드 라벨로 쓰기엔 너무
 * 길다 — 노트 경로까지 붙으면 노드가 가로로 폭발해 읽을 수 없다. 2~3자로 줄이고
 * 상세 설명(detail)은 리스트 뷰에 맡긴다. 그래프는 개관, 리스트는 근거. 역할 분리.
 */
const KIND_TAG: Record<GapKind, string> = {
  missing: "없음",
  stub: "빈약",
  orphan: "고립",
  "one-way": "단방향",
};

/**
 * 종류별 classDef 4줄.
 *
 * - missing 만 `stroke-dasharray` 점선을 쓴다. GapCandidate.path 는 missing 의 경우
 *   실제 경로가 아니라 "아직 존재하지 않는 링크 대상 이름"이므로(knowledge-gaps.ts:33)
 *   실존 노트와 반드시 구분돼야 한다. 점선은 "아직 없는 것"의 관용적 표기다.
 * - 색은 시급도 순서를 따른다: missing 주황(만들어야 함) → stub 노랑(채워야 함) →
 *   orphan 회색(연결해야 함) → one-way 연청(선택적). 장식이 아니라 의미다.
 * - 라이트·다크 테마 모두에서 읽히도록 밝은 fill + 진한 stroke 를 쓴다. mermaid
 *   classDef 에서 Obsidian 테마 변수를 쓸 수 없어 고정 색이지만 대비를 확보했다.
 * - `stroke-dasharray` 의 콤마는 `\,` 이스케이프가 필요하므로 공백 구분(`4 2`)으로
 *   회피한다. 세미콜론으로 끝내지 않는 이유는 buildMermaidGraph 주석 참조
 *   (mermaid encodeEntities 가 끝 문자를 잘라먹는다).
 */
const GAP_CLASS_DEFS: readonly string[] = [
  "classDef gapMissing fill:#fff4e6,stroke:#c98a3c,stroke-width:2px,stroke-dasharray:4 2",
  "classDef gapStub fill:#fffbe6,stroke:#b8952f",
  "classDef gapOrphan fill:#f4f6f8,stroke:#8a9ba8",
  "classDef gapOneWay fill:#eef4fb,stroke:#6a8bb0",
];

/**
 * 경로에서 사람이 읽을 이름을 만든다.
 *
 * resolveLabel 은 title 이 비면 basename 에서 확장자를 떼는데, 이때 `2026.01 회고`
 * 같은 경로의 첫 점을 확장자 구분자로 오인해 `2026` 으로 잘라버린다. 그래서 `.md`
 * 만 명시적으로 떼어 title 인자로 넘긴다 — 리스트 리포트(buildGapReport:235)가
 * `replace(/\.md$/, "")` 로 하는 것과 같은 처리다.
 *
 * 경로가 완전히 비어 라벨이 비면 resolveLabel 이 UNTITLED_LABEL 로 폴백한다.
 * 빈 라벨(`n0[""]`)은 mermaid 파스 에러이므로 이 폴백이 방어선이다.
 */
function pathLabel(path: string): string {
  return resolveLabel(path.replace(/\.md$/, ""), path);
}

/**
 * 지식 공백 그래프를 만든다 — 종류별로 묶인 노드 그래프.
 *
 * 같은 경로가 여러 종류로 등장하면(예: 백링크가 있는 짧은 노트가 되돌아오지 않는
 * 아웃링크도 가진 경우) 노드 하나로 합치고 라벨에 `[빈약+단방향]` 처럼 종류를 모두
 * 표기한다. 노드를 종류마다 따로 만들면 같은 노트가 그래프에 두 번 나타나 "다른
 * 노트"로 오독되고, 종류 하나만 남기면 나머지 진단이 사라진다.
 *
 * 방향은 LR — 노트 경로 라벨이 가로로 길어(한국어 제목도 20~40자가 흔하다) LR 이
 * 폭을 덜 낭비하고, 종류 그룹이 세로로 쌓이며 각 그룹 항목이 가로로 전개된다.
 *
 * 상한(노드 60)은 buildMermaidGraph 가 적용하고 절단 여부는 shownNodes/totalNodes
 * 로 보고된다. 실제로는 rankGaps 가 이미 GAP_REPORT_LIMIT(20)으로 자르므로 이
 * 경로에서 상한에 닿지 않지만, 호출부가 rankGaps 를 거치지 않은 배열을 넘길 수도
 * 있으므로 상한 처리를 우회하지 않는다.
 *
 * 위키 폴더 노트 필터링은 하지 않는다. 실존 노트 3종(orphan/stub/one-way)은 상류의
 * isGenerated 가 이미 걸러낸다(knowledge-gaps.ts:70, 97, 132·137 — 실측 확인).
 * missing 의 대상 이름은 상류가 링크 '출처'만 거르고(:167) 대상은 아직 존재하지
 * 않는 노트라 걸러낼 근거가 없어 위키 폴더 이름이 통과할 수 있는데, 이건 렌더러가
 * 아니라 도메인 계층에서 정할 문제다. 렌더러가 몰래 빼면 같은 데이터의 두 뷰
 * (리스트·그래프)가 불일치해 사용자가 그래프에 없는 항목을 리스트에서 보게 된다.
 */
export function buildGapGraph(gaps: readonly GapCandidate[]): MermaidGraph {
  // --- 경로별로 종류를 모은다 ---
  // 인자 배열을 변형하지 않고 새 Map 을 만든다. Map 은 삽입 순서를 보존하므로
  // 같은 종류 안에서 rankGaps 가 정한 순서(weight 내림차순)가 그대로 유지된다.
  const kindsByPath = new Map<string, Set<GapKind>>();
  for (const gap of gaps) {
    const bucket = kindsByPath.get(gap.path);
    if (bucket) bucket.add(gap.kind);
    else kindsByPath.set(gap.path, new Set([gap.kind]));
  }

  // --- 종류별로 묶어 배치한다 ---
  // 한 경로는 자신의 종류 중 KIND_ORDER 상 가장 앞선 그룹에 한 번만 들어간다.
  // 그래야 같은 노트가 그래프에 중복 등장하지 않으면서 종류 그룹이 인접해 놓인다.
  const nodes: MermaidNode[] = [];
  const placed = new Set<string>();
  for (const kind of KIND_ORDER) {
    for (const [path, kinds] of kindsByPath) {
      if (placed.has(path)) continue;
      if (!kinds.has(kind)) continue;
      placed.add(path);

      // 종류 표기는 입력 순서가 아니라 KIND_ORDER 를 따른다 — 같은 원소면 입력
      // 순서가 달라도 동일한 출력을 보장한다(결정론).
      const tags = KIND_ORDER.filter((k) => kinds.has(k)).map((k) => KIND_TAG[k]);
      nodes.push({
        path,
        label: `[${tags.join("+")}] ${pathLabel(path)}`,
        // 클래스는 가장 앞선 종류를 쓴다. 라벨이 종류 전체를 이미 보여주므로
        // 색은 "가장 시급한 종류"만 나타내면 충분하다.
        cls: KIND_CLASS[kind],
      });
    }
  }

  // 엣지 없음 — 파일 상단 설계 판단 (1) 참조. GapCandidate 에 상대 경로가 없다.
  return buildMermaidGraph(nodes, [], {
    direction: "LR",
    classDefs: GAP_CLASS_DEFS,
  });
}
