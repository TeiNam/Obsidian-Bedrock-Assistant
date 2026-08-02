import { MERMAID_MAX_EDGES } from "./mermaid-graph";
import type { GraphRagResult } from "../vault-indexer";

/**
 * 그래프 → 채팅 메시지 조립 (뷰 계층 어댑터)
 *
 * 순수 빌더 4종은 숫자만 반환하고 언어 테이블을 모른다. 절단 고지 문구를 붙이는 일은
 * i18n 을 가진 호출부 책임인데, "붙일지 말지"의 판단 자체는 DOM·vault 없이 검증 가능한
 * 순수 로직이라 여기 한 곳으로 모았다. chat-view 와 명령 팔레트 두 경로가 같은 규칙을
 * 쓰게 되고(DRY), 규칙이 테스트로 고정된다.
 */

/**
 * 검색 근거 그래프를 답변에 붙일지 판단한다 — 순수 함수.
 *
 * **기본은 켬이지만 새 설정 항목을 만들지 않았다.** 조건이 "엣지가 1개 이상"이기
 * 때문에 기존 `graphTraversalDepth` 설정이 그대로 옵트아웃으로 동작한다 — 0 으로
 * 두면 이웃이 생기지 않아 엣지가 0 이고 그래프가 붙지 않는다. 설정 추가는 비용이므로
 * 이미 있는 스위치가 같은 일을 하면 새로 만들지 않는다(ponytail).
 *
 * 엣지 0개를 배제하는 이유는 노이즈 차단이다. 시드만 있는 그래프는 바로 위 텍스트
 * 목록과 똑같은 정보를 상자로 반복하는 것이라 읽을 값이 없다. 반대로 이웃이 있으면
 * "이 노트가 왜 결과에 들어왔는가"(시드 경유 경로)가 텍스트로는 읽기 어렵고 그래프가
 * 압도적으로 잘 보여준다 — 그래프가 정보를 **더할** 때만 붙인다.
 *
 * seedPath 가 결과에 없는 경로를 가리키는 경우(상한 절단·비정상 데이터)도 엣지가
 * 폐기되므로 여기서 false 가 된다. buildSearchGraph 와 같은 판정을 쓰기 위해 자체
 * 계산을 하지 않고 경로 집합 기준으로 확인한다.
 */
export function shouldAttachSearchGraph(result: GraphRagResult): boolean {
  const items = result.items ?? [];
  if (items.length === 0) return false;

  // 엣지의 양 끝이 모두 결과 안에 있어야 실제로 그려진다. 미선언 경로를 가리키는
  // 엣지는 빌더가 버리므로(유령 노드 방지) 여기서도 같은 기준으로 센다.
  const paths = new Set(items.map((it) => it.path));
  return items.some(
    (it) =>
      !(it.isSeed || it.hop <= 0) &&
      typeof it.seedPath === "string" &&
      it.seedPath !== it.path &&
      paths.has(it.seedPath)
  );
}

/** 빌더 4종의 반환값에서 고지 판단에 필요한 최소 필드. */
export interface GraphCounts {
  /** 코드펜스를 포함한 마크다운. 빈 문자열이면 그릴 것이 없다. */
  markdown: string;
  /** 실제로 그린 노드 수 */
  shownNodes: number;
  /** 절단 전 전체 노드 수 */
  totalNodes: number;
  /** 절단 전 전체(유효) 엣지 수 */
  totalEdges: number;
  /**
   * 실제로 그린 엣지 수. WikiGraph 만 이 값을 직접 보고한다.
   * 생략되면 MERMAID_MAX_EDGES 로 추정한다 — 공유 코어가 상한에서 자르기 때문이다.
   */
  shownEdges?: number;
}

/** 절단 고지 문구 생성기. VIEW_I18N 의 함수형 키를 그대로 받는다. */
export interface GraphTruncationLabels {
  /** 노드만 잘린 경우 */
  truncated: (shown: number, total: number) => string;
  /** 노드·엣지가 함께(또는 엣지만) 잘린 경우 — 한 줄로 합쳐 쓴다 */
  truncatedEdges: (
    shownNodes: number,
    totalNodes: number,
    shownEdges: number,
    totalEdges: number
  ) => string;
}

/**
 * 그래프 마크다운에 헤딩과 절단 고지를 붙여 채팅에 보낼 한 덩어리로 만든다 — 순수 함수.
 *
 * 규칙 3개가 핵심이고 셋 다 어기면 "조용한 실패"가 된다.
 *  1. markdown 이 비면 아무것도 내보내지 않는다. 헤딩만 남은 메시지는 사용자에게
 *     "기능이 고장났다"로 보이고, 빈 코드블록은 실제 파스 에러를 낸다.
 *  2. 고지는 코드블록 **밖**에 둔다. 안에 넣으면 mermaid 문법이 깨져 그래프가 통째로
 *     사라지고, 안내 노드로 넣으면 그것도 노드라 상한 계산에 섞여 실제 노트로 오독된다.
 *  3. 절단이 없으면 고지 줄을 아예 넣지 않는다. 항상 "60/60 표시"를 출력하면 노이즈가
 *     되어 고지가 있다는 사실 자체가 신호가 되지 못한다.
 *
 * @param heading 코드블록 앞에 붙일 마크다운 헤딩. 빈 문자열이면 생략한다.
 * @param counts 빌더 반환값(필요 필드만)
 * @param labels i18n 문구 생성기 — 호출부가 자기 언어 테이블에서 넘긴다
 */
export function composeGraphMessage(
  heading: string,
  counts: GraphCounts,
  labels: GraphTruncationLabels
): string {
  // 그릴 것이 없으면 헤딩도 내보내지 않는다. 안내 문구는 호출부가 별도로 띄운다.
  if (counts.markdown.trim() === "") return "";

  const nodesTruncated = counts.shownNodes < counts.totalNodes;
  const edgesTruncated = counts.totalEdges > MERMAID_MAX_EDGES;

  // 엣지가 잘렸으면 노드 수까지 한 줄에 합쳐 쓴다. 고지 줄이 2개면 과하다.
  let notice = "";
  if (edgesTruncated) {
    const shownEdges = counts.shownEdges ?? MERMAID_MAX_EDGES;
    notice = labels.truncatedEdges(
      counts.shownNodes,
      counts.totalNodes,
      shownEdges,
      counts.totalEdges
    );
  } else if (nodesTruncated) {
    notice = labels.truncated(counts.shownNodes, counts.totalNodes);
  }

  // architect.ts:242 의 `_... 외 N개 항목 생략_` 선례를 따라 이탤릭 한 줄로 붙인다.
  const parts = [
    ...(heading ? [heading, ""] : []),
    counts.markdown,
    ...(notice ? ["", `_${notice}_`] : []),
  ];
  return parts.join("\n");
}
