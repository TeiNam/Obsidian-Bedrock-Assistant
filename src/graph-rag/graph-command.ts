import { composeGraphMessage, type GraphTruncationLabels } from "./graph-message";
import type { MermaidGraph } from "./mermaid-graph";
import type { SimilarityGraph } from "./similarity-graph";
import type { WikiGraph } from "./wiki-graph";

/**
 * 명령 팔레트 3종(유사도·공백·위키) 메시지 조립 — 순수 함수 모음.
 *
 * 각 빌더는 "왜 비었는가"를 플래그·숫자로만 보고하고 문구를 모른다. 그 플래그를 읽어
 * 무엇을 보여줄지 결정하는 분기를 main.ts 의 명령 콜백에 두면 DOM·Notice 와 뒤섞여
 * 테스트할 수 없으므로 여기로 분리했다. main.ts 는 반환값을 그대로 소비만 한다.
 */

/** 명령 3종이 쓰는 문구 생성기. VIEW_I18N 의 키를 그대로 받는다. */
export interface GraphCommandLabels extends GraphTruncationLabels {
  similarityHeading: (title: string) => string;
  similarityEmpty: string;
  similarityNoVector: string;
  similarityDegenerate: string;
  gapHeading: string;
  gapEmpty: string;
  wikiHeading: string;
  wikiEmpty: string;
  wikiIsolated: (isolated: number, total: number) => string;
  /** Second Brain 비활성 안내. 기존 키를 재사용한다(새 키를 만들지 않는다). */
  sbDisabled: string;
}

/**
 * 명령 실행 결과. 둘 중 정확히 하나만 채워진다.
 * - `markdown`: 채팅에 어시스턴트 메시지로 렌더할 내용
 * - `notice`: 그릴 것이 없어 Notice 로만 안내할 문구
 *
 * 둘을 동시에 채우면 호출부가 Notice 를 띄우면서 채팅에도 렌더해 중복 안내가 된다.
 */
export interface GraphCommandOutput {
  markdown?: string;
  notice?: string;
}

/**
 * 의미 유사도 그래프 메시지.
 *
 * 빈 결과의 이유를 3가지로 구분한다 — 하나로 뭉치면 사용자가 재인덱싱이 필요한 상태를
 * 영구히 모른다. 벡터 없음이 붕괴보다 우선한다(벡터가 없으면 붕괴 판정 자체가 무의미).
 */
export function buildSimilarityMessage(
  title: string,
  graph: SimilarityGraph,
  labels: GraphCommandLabels
): GraphCommandOutput {
  if (!graph.markdown) {
    if (!graph.centerHasVector) return { notice: labels.similarityNoVector };
    if (graph.degenerate) return { notice: labels.similarityDegenerate };
    return { notice: labels.similarityEmpty };
  }
  return {
    markdown: composeGraphMessage(labels.similarityHeading(title), graph, labels),
  };
}

/** 지식 공백 그래프 메시지. 공백 0건은 실패가 아니라 좋은 상태라 Notice 로 축하한다. */
export function buildGapMessage(
  graph: MermaidGraph,
  labels: GraphCommandLabels
): GraphCommandOutput {
  if (!graph.markdown) return { notice: labels.gapEmpty };
  return { markdown: composeGraphMessage(labels.gapHeading, graph, labels) };
}

/**
 * 위키 구조 그래프 메시지.
 *
 * 절단 고지와 고립 경고는 서로 다른 정보라 함께 나올 수 있다 — 절단은 "일부만 봤다",
 * 고립은 "본 것들이 연결돼 있지 않다"다. 고립 수는 이 그래프의 유일한 결론이므로
 * 숫자로도 반드시 전달한다(색·점선만으로는 색각 이상 사용자에게 도달하지 않는다).
 */
export function buildWikiMessage(
  graph: WikiGraph,
  labels: GraphCommandLabels
): GraphCommandOutput {
  if (graph.status === "disabled") return { notice: labels.sbDisabled };
  if (graph.status === "empty" || !graph.markdown) return { notice: labels.wikiEmpty };

  const base = composeGraphMessage(labels.wikiHeading, graph, labels);
  // 고립 경고도 코드블록 '밖'이다. 안에 넣으면 안내 노드가 되어 상한 계산에 섞인다.
  const isolated =
    graph.isolatedNodes > 0
      ? `\n\n_${labels.wikiIsolated(graph.isolatedNodes, graph.totalNodes)}_`
      : "";
  return { markdown: `${base}${isolated}` };
}
