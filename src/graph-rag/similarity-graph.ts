// 의미 유사도 그래프 (Semantic Similarity Graph) — 순수 모듈
// ==========================================================
// 중심 노트 하나와 볼트 전체를 비교해 "링크가 없는데 의미가 가까운 노트"를 엣지로
// 그린다. 코어 그래프 뷰는 링크만 그리므로 이 관계를 절대 보여줄 수 없다 — 이게
// 이 기능의 존재 이유이고, 그래서 이미 링크된 쌍은 반드시 제외한다. 링크가 있으면
// 코어 그래프가 이미 보여주고 있으므로 여기 그리면 중복 정보로 화면만 채운다.
//
// 이 파일은 전부 순수 함수다. Obsidian API·LLM·임베딩 API·파일 IO 호출이 0회이며
// i18n 테이블도 import 하지 않는다. 임베딩은 이미 인덱스에 있으므로 계산만 한다.
//
// === 성능: 왜 O(N) 이고, 왜 워커가 필요 없는가 ===
//
// "N 노트면 쌍이 N²/2" 는 전체 쌍 그래프의 이야기다. 이 빌더는 중심 노트 1개 대비
// 전체 N개를 비교하는 방사형(star)이라 비교 횟수가 N 이다. 실측(node, dim=1536):
//
//   전체 쌍  N=1000 (499,500쌍) → 730ms   ← 메인 스레드를 확실히 멈춘다
//   방사형   N=1000 (1,000비교) →   2ms
//   방사형   N=10000            →  18ms
//
// 365배 차이다. 방사형이면 1만 노트에서도 18ms 라 워커가 필요 없다. 대신 두 가지를
// 지켜야 이 예산이 유지된다:
//
//  1) 엔트리당 임베딩을 하나로 고정한다(resolveEntryVector). 청크마다 비교하면
//     비용이 청크 수만큼 배가된다 — 실측: 노트당 30청크면 N=1000 에서 2ms → 60ms,
//     N=3000 에서 323ms 로 뛴다. 개관용 그래프에 그 대가를 치를 값이 없다.
//  2) 후보 정렬은 전체 sort 로 충분하다. 실측 1만 건 정렬이 1.94ms 라 상한 크기를
//     유지하는 힙을 새로 만들 이유가 없다(ponytail — 신규 추상화 금지).
//
// 계산은 analyzeSimilarity 에 모여 있고 mermaid 조립과 분리돼 있다. 그래서 테스트가
// 가짜 임베딩 벡터만으로 즉시 돈다.

import { compareVectors } from "./vector-search";
import {
  buildMermaidGraph,
  MERMAID_MAX_NODES,
  type MermaidEdge,
  type MermaidGraph,
  type MermaidNode,
} from "./mermaid-graph";
import type { VaultIndexEntry } from "../types";

/**
 * 엣지를 그릴 최소 코사인 유사도. 이 값 이상(>=)만 후보가 된다.
 *
 * 0.8 은 의도적으로 엄격한 값이다. 이 그래프의 가치는 "몇 개의 놀라운 연결"에 있고,
 * 임계값을 낮추면 정규화된 임베딩끼리 흔히 나오는 0.6~0.7 대 잡음이 대량 유입되어
 * 상한 60노드가 전부 무의미한 이웃으로 채워진다. 그러면 사용자는 어느 연결이 볼
 * 값이 있는지 판단할 수 없고, 기능은 렌더되면서 실패한다.
 */
export const SIMILARITY_MIN_SCORE = 0.8;

/**
 * 임베딩 붕괴 판정 유사도. 후보가 전부 이 값 이상이면 인덱스를 신뢰하지 않는다.
 *
 * 임베딩 공급자가 상수 벡터를 돌려주거나 차원이 뭉개지면 모든 노트가 서로 0.99+ 가
 * 된다. 그걸 그리면 중심에 전부 연결된 완전 그래프가 나오는데, 모든 노트가 똑같이
 * 가깝다는 그래프는 정보량이 0 이면서 "관련 노트를 잔뜩 찾았다"고 거짓 신호를 준다.
 * 빈 그래프보다 나쁘다 — 그래서 그리지 않고 붕괴로 보고한다.
 */
export const DEGENERATE_SIMILARITY = 0.99;

/**
 * 붕괴 판정에 필요한 최소 후보 수.
 *
 * 노트 2~3개가 실제로 거의 같은 내용일 수 있다(복사본, 번역쌍, 분할 전 초안).
 * 표본 하한이 없으면 그런 정상 볼트에 "임베딩이 고장났다"는 거짓 경고를 띄우고
 * 진짜 유사 노트를 숨겨버린다. 붕괴는 볼트 전역 현상이므로 표본이 모여야 판정한다.
 */
export const DEGENERATE_MIN_SAMPLE = 5;

/** 유사 노트 후보 1건. */
export interface SimilarityCandidate {
  /** 볼트 루트 기준 경로 */
  path: string;
  /** 노트 제목(빈 문자열일 수 있다 — 라벨 폴백은 mermaid 계층이 처리한다) */
  title: string;
  /** 중심 노트와의 코사인 유사도 (SIMILARITY_MIN_SCORE 이상) */
  similarity: number;
}

/** analyzeSimilarity 결과. 왜 후보가 없는지를 숫자·플래그로 보고한다. */
export interface SimilarityAnalysis {
  /** 유사도 내림차순(동점 시 경로 오름차순) 후보. 붕괴 시에는 비어 있다. */
  candidates: readonly SimilarityCandidate[];
  /** 중심 노트가 비교 가능한 벡터를 가졌는지. false 면 계산 자체가 불가능하다. */
  centerHasVector: boolean;
  /** 비교 불가로 제외한 노트 수 — 빈 임베딩 또는 차원 불일치(compareVectors 가 null) */
  incomparableCount: number;
  /** 이미 링크로 연결돼 제외한 노트 수. 코어 그래프가 이미 보여주는 쌍이다. */
  linkedCount: number;
  /** 임베딩 붕괴 판정. true 면 candidates 를 의도적으로 비운다. */
  degenerate: boolean;
}

/** buildSimilarityGraph 결과. MermaidGraph 에 "왜 비었는가"를 덧붙인다. */
export interface SimilarityGraph extends MermaidGraph {
  /** 임베딩 붕괴로 그리지 않았는지 */
  degenerate: boolean;
  /** 중심 노트에 비교 가능한 벡터가 있었는지 */
  centerHasVector: boolean;
  /** 비교 불가로 제외한 노트 수(재인덱싱 안내 판단용) */
  incomparableCount: number;
  /** 이미 링크돼 제외한 노트 수 */
  linkedCount: number;
}

/**
 * 엔트리를 대표하는 임베딩 벡터 하나를 고른다. 없으면 빈 배열.
 *
 * 레거시 단일 임베딩(`entry.embedding`)을 우선한다. vault-indexer 가 이 값을 "첫
 * 유효 청크 임베딩"으로 채우므로(buildEntry), 청크를 다시 훑지 않고도 첫 유효 청크
 * 벡터를 공짜로 얻는 셈이다. 비어 있을 때만 청크를 순회해 폴백한다 — 구버전 인덱스나
 * 부분 갱신으로 레거시 필드만 빈 경우가 있다.
 *
 * 노트당 최대 유사도(청크별 비교의 max)를 쓰면 대표성은 조금 올라가지만 비용이 청크
 * 수만큼 배가된다(파일 상단 실측 참조). 이 그래프는 정밀 검색이 아니라 개관이므로
 * 대표 벡터 1개로 충분하다. 정밀 순위가 필요한 경로는 이미 vectorSearchByChunk 가 있다.
 */
export function resolveEntryVector(entry: VaultIndexEntry): number[] {
  if (entry.embedding && entry.embedding.length > 0) return entry.embedding;
  for (const chunk of entry.chunks ?? []) {
    if (chunk.embedding && chunk.embedding.length > 0) return chunk.embedding;
  }
  return [];
}

/**
 * 두 노트가 이미 링크로 연결돼 있는지 판정한다.
 *
 * 네 방향(중심의 outlinks/backlinks, 후보의 outlinks/backlinks)을 모두 본다. 한
 * 방향만 보면 안 된다 — 인덱스의 outlinks 와 backlinks 는 어긋날 수 있고(그게
 * knowledge-gaps 의 "one-way" 공백이 존재하는 이유다), 어긋난 쪽으로 링크된 쌍이
 * 새어 나오면 코어 그래프에 이미 보이는 연결을 중복으로 그린다.
 */
function isLinked(center: VaultIndexEntry, other: VaultIndexEntry): boolean {
  return (
    (center.outlinks ?? []).includes(other.path) ||
    (center.backlinks ?? []).includes(other.path) ||
    (other.outlinks ?? []).includes(center.path) ||
    (other.backlinks ?? []).includes(center.path)
  );
}

/** 유사도 내림차순 → 동점 시 경로 오름차순. 환경 무관 결정론을 위해 코드 유닛 비교. */
function compareCandidates(a: SimilarityCandidate, b: SimilarityCandidate): number {
  if (b.similarity !== a.similarity) return b.similarity - a.similarity;
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/**
 * 중심 노트와 의미가 가까운 "링크 없는" 노트를 찾는다 — 순수 함수.
 *
 * 파이프라인(전부 O(N), 노트당 벡터 비교 1회):
 *  1. 중심 대표 벡터 확보. 없으면 즉시 빈 결과(centerHasVector=false).
 *  2. 자기 자신·중복 경로 제외.
 *  3. 이미 링크된 쌍 제외 — 이 그래프의 존재 이유다.
 *  4. compareVectors 로 비교. null(빈 벡터·차원 불일치)이면 제외하고 카운트한다.
 *     차원 불일치를 유사도 0 으로 취급하면 안 되는 이유는 compareVectors 주석 참조.
 *  5. 임계값 미달 제외 후 정렬.
 *  6. 붕괴 판정 — 전부 0.99+ 면 후보를 비운다.
 *
 * 인자로 받은 배열·객체를 변형하지 않으며, 입력 순서가 달라도 같은 결과를 낸다.
 * 상한은 적용하지 않는다 — 절단은 mermaid 계층이 하고, 여기서 미리 자르면 호출부가
 * 절단 고지의 분모(전체 몇 개 중 몇 개)를 알 수 없게 된다.
 */
export function analyzeSimilarity(
  center: VaultIndexEntry,
  entries: readonly VaultIndexEntry[]
): SimilarityAnalysis {
  const centerVector = resolveEntryVector(center);
  if (centerVector.length === 0) {
    return {
      candidates: [],
      centerHasVector: false,
      incomparableCount: 0,
      linkedCount: 0,
      degenerate: false,
    };
  }

  const matched: SimilarityCandidate[] = [];
  const seen = new Set<string>([center.path]);
  let incomparableCount = 0;
  let linkedCount = 0;

  for (const entry of entries) {
    // 자기 자신 제외 — 유사도 1.0 이라 항상 최상위를 차지하고 자기 루프 엣지가 된다.
    // 중복 경로도 여기서 걸러 엣지 중복 생성과 상한 낭비를 막는다.
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);

    if (isLinked(center, entry)) {
      linkedCount++;
      continue;
    }

    const similarity = compareVectors(centerVector, resolveEntryVector(entry));
    if (similarity === null) {
      incomparableCount++;
      continue;
    }
    if (similarity < SIMILARITY_MIN_SCORE) continue;

    matched.push({ path: entry.path, title: entry.title, similarity });
  }

  matched.sort(compareCandidates);

  // 붕괴 판정: 표본이 모였고 전부 0.99+ 면 인덱스를 신뢰하지 않는다.
  const degenerate =
    matched.length >= DEGENERATE_MIN_SAMPLE &&
    matched.every((c) => c.similarity >= DEGENERATE_SIMILARITY);

  return {
    candidates: degenerate ? [] : matched,
    centerHasVector: true,
    incomparableCount,
    linkedCount,
    degenerate,
  };
}

/**
 * 의미 유사도 그래프의 classDef.
 *
 * 클래스는 2개뿐이다 — 중심과 유사 노트. 유사도 강약을 색으로 계조 표현하고 싶은
 * 유혹이 있지만, 엣지 라벨에 이미 숫자가 있어 정보가 중복되고 회색 계조는 채팅
 * 패널 크기에서 구분되지 않는다.
 *
 * 세미콜론으로 끝내지 않는다(mermaid encodeEntities 가 `/classDef.*:\S*#.*;/g` 로
 * 끝 문자를 잘라낸다). stroke-dasharray 의 콤마 이스케이프 문제도 피하려 쓰지 않는다.
 */
const SIMILARITY_CLASS_DEFS: readonly string[] = [
  "classDef center fill:#e8f0ff,stroke:#4a6fa5,stroke-width:2px",
  "classDef similar fill:#f4f6f8,stroke:#8a9ba8",
];

/**
 * 의미 유사도 그래프를 만든다 — 중심 노트에서 유사 노트로 뻗는 방사형 mermaid 그래프.
 *
 * 방향은 LR. 중심에서 방사되는 형태이고 노트 제목이 가로로 길어(한국어라도 20~40자가
 * 흔하다) LR 이 폭을 덜 낭비한다.
 *
 * 유사도는 노드 라벨이 아니라 **엣지 라벨**에 붙인다. 유사도는 노드 하나의 속성이
 * 아니라 중심과 그 노드 사이의 관계값이므로 화살표에 얹는 게 의미와 일치한다.
 * (검색 근거 그래프가 combinedScore 를 노드 라벨에 붙이는 것과 반대인데, 그건 그
 * 값이 노드 자신의 점수이기 때문이다.)
 *
 * 중심 노드를 배열 맨 앞에 둔다. 상한 절단은 꼬리에서 일어나므로 중심이 잘려
 * 엣지의 from 이 미선언 id 가 되는(유령 노드) 사태를 구조적으로 막는다.
 *
 * 후보가 없으면 markdown 은 빈 문자열이다. 이유(붕괴·벡터 없음·전부 미달)는 플래그로
 * 보고하고, 안내 문구는 i18n 을 가진 호출부가 만든다.
 */
export function buildSimilarityGraph(
  center: VaultIndexEntry,
  entries: readonly VaultIndexEntry[]
): SimilarityGraph {
  const analysis = analyzeSimilarity(center, entries);

  // 후보가 없으면 중심 노드 하나만 남은 그래프가 되는데, 그건 "관련 노트를 못 찾음"을
  // 노드 1개짜리 다이어그램으로 표현하는 것이라 빈 사각형과 다를 바 없다. 그리지 않는다.
  if (analysis.candidates.length === 0) {
    return {
      markdown: "",
      shownNodes: 0,
      totalNodes: 0,
      totalEdges: 0,
      degenerate: analysis.degenerate,
      centerHasVector: analysis.centerHasVector,
      incomparableCount: analysis.incomparableCount,
      linkedCount: analysis.linkedCount,
    };
  }

  const nodes: MermaidNode[] = [
    { path: center.path, label: center.title, cls: "center" },
    ...analysis.candidates.map((c) => ({
      path: c.path,
      label: c.title,
      cls: "similar",
    })),
  ];

  const edges: MermaidEdge[] = analysis.candidates.map((c) => ({
    from: center.path,
    to: c.path,
    // 소수점 둘째 자리로 자른다. 0.8714 를 그대로 쓰면 라벨이 길어져 엣지가 겹치고,
    // 둘째 자리 이하의 차이는 사용자 판단에 영향을 주지 않는다.
    label: c.similarity.toFixed(2),
  }));

  const graph = buildMermaidGraph(nodes, edges, {
    direction: "LR",
    classDefs: SIMILARITY_CLASS_DEFS,
  });

  return {
    ...graph,
    degenerate: analysis.degenerate,
    centerHasVector: analysis.centerHasVector,
    incomparableCount: analysis.incomparableCount,
    linkedCount: analysis.linkedCount,
  };
}

/**
 * 그래프 1개에 그릴 수 있는 최대 유사 노트 수(중심 노드 1자리를 뺀 값).
 * 호출부가 "몇 개까지 보이는가"를 안내할 때 쓴다. 실제 절단은 mermaid 계층이 한다.
 */
export const SIMILARITY_MAX_NEIGHBORS = MERMAID_MAX_NODES - 1;
