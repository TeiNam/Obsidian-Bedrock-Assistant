// ============================================
// 순위 융합 (Reciprocal Rank Fusion) — 순수 함수
// ============================================
// 벡터 검색과 어휘 검색을 함께 쓰기 위한 모듈이다.
//
// 왜 점수를 더하지 않고 순위를 섞는가: 두 점수는 비교 가능한 척도가 아니다. 코사인
// 유사도는 -1~1의 밀집 분포이고 어휘 점수는 "제목 3배 + 본문 빈도(상한 10)"의 정수
// 합이다. 정규화해서 가중합을 하면 가중치가 볼트 크기와 질의 길이에 따라 계속 어긋난다.
// RRF는 각 목록의 순위만 쓰므로 척도 문제가 아예 없다.
//
// 왜 필요한가: dense 검색은 정확한 문자열에 약하다. 에러 코드(CrashLoopBackOff),
// 함수명, 버전 문자열, 사람 이름, 한글 형태소 변형처럼 "그 문자열이 literally 들어
// 있는 노트 한 개"를 임베딩 유사도가 상위권 밖으로 밀어내는 일이 흔하다.
// 어휘 검색은 그걸 정확히 잡는다. 서로의 약점이 겹치지 않아 융합 이득이 크다.

/**
 * RRF 감쇠 상수. 원 논문(Cormack et al. 2009)이 제시한 값이다.
 *
 * 값이 작으면 1위와 2위의 차이가 과장되어 한 목록이 결과를 지배한다. 크면 순위 차이가
 * 뭉개져 두 목록의 상위권이 뒤섞인다. 60은 "상위 몇 개는 확실히 우대하되 10~20위권도
 * 살아남는" 지점이다.
 */
export const RRF_K = 60;

/** 융합에 넣을 순위 목록 하나. */
export interface RankedList {
  /** 진단·설명용 이름 (예: "dense", "lexical"). */
  name: string;
  /** 관련도 내림차순 경로 목록. 중복은 첫 등장만 유효하다. */
  paths: readonly string[];
  /**
   * 이 목록의 기여 가중치. 기본 1.
   * 어휘 목록을 보조로만 쓰고 싶으면 1보다 작게 준다.
   */
  weight?: number;
}

/** 융합 결과 한 항목. */
export interface FusedRank {
  path: string;
  /** RRF 합산 점수. 절대값에 의미는 없고 순서만 의미가 있다. */
  score: number;
  /** 이 경로를 올린 목록 이름들. 어느 신호가 잡았는지 진단할 때 쓴다. */
  sources: string[];
}

/**
 * 여러 순위 목록을 RRF로 융합한다.
 *
 * 각 목록에서 순위 r(0부터)에 있는 경로는 `weight / (RRF_K + r + 1)`를 얻고,
 * 경로별로 합산해 내림차순 정렬한다. 두 목록 모두에 등장한 경로가 자연히 위로 온다.
 *
 * 동점은 경로 오름차순으로 깨서 결과를 결정적으로 만든다 — 같은 입력에 매번 같은
 * 순서가 나와야 평가 지표가 흔들리지 않는다.
 *
 * 원본 배열은 변형하지 않는다.
 */
export function fuseRanks(lists: readonly RankedList[]): FusedRank[] {
  const scores = new Map<string, { score: number; sources: string[] }>();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    if (weight <= 0) continue;

    const seen = new Set<string>();
    let rank = 0;
    for (const path of list.paths) {
      // 한 목록 안의 중복은 첫 등장만 센다. 같은 노트가 두 번 기여하면
      // 그 목록의 영향이 부당하게 커진다.
      if (seen.has(path)) continue;
      seen.add(path);

      const contribution = weight / (RRF_K + rank + 1);
      rank++;

      const cur = scores.get(path);
      if (cur) {
        cur.score += contribution;
        cur.sources.push(list.name);
      } else {
        scores.set(path, { score: contribution, sources: [list.name] });
      }
    }
  }

  return Array.from(scores, ([path, v]) => ({ path, score: v.score, sources: v.sources })).sort(
    (a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    }
  );
}

/**
 * 한 목록에만 있는 상위 후보의 결과 자리를 보장한다.
 *
 * 왜 필요한가: RRF의 K는 60이라 상위 순위 간 점수 차가 매우 작다(1위 1/61 vs 10위 1/70,
 * 15% 차이). 어휘 목록에 가중치 0.5를 곱하면 **어휘 1위**가 0.5/61 ≈ 0.0082가 되어
 * **dense 10위** 1/70 ≈ 0.0143보다도 낮다. 두 목록에 다 있는 노트는 점수가 합산되어
 * 올라가지만, 어휘 목록에만 있는 노트는 `limit=10`으로 자르는 단계에서 항상 사라진다.
 *
 * 그런데 하이브리드 검색을 넣은 이유가 바로 그 경우다 — 에러 코드·함수명처럼 dense가
 * 상위권 밖으로 밀어낸 정확 문자열을 어휘가 잡아오는 것. 가중치를 1.0으로 올리면 어휘
 * 1위가 dense 1위와 동점이 되어 이번엔 어휘가 주 신호를 뒤집는다. 순위 조정으로는 두
 * 요구를 동시에 만족시킬 수 없어 자리를 예약한다.
 *
 * 예약분은 **목록 끝의 자리**를 차지한다 — dense 상위권을 밀어내지 않는다.
 *
 * @param ranked 융합 순위(경로 순서)
 * @param reserved 자리를 보장할 경로. 앞쪽이 우선이다.
 * @param limit 최종 결과 수
 */
export function reserveSlots(
  ranked: readonly string[],
  reserved: readonly string[],
  limit: number
): string[] {
  if (limit <= 0) return [];

  const head = ranked.slice(0, limit);
  const inHead = new Set(head);
  const missing = reserved.filter((path) => !inHead.has(path));
  if (missing.length === 0) return head;

  // 자리를 비울 때 **예약 항목은 건드리지 않는다.** 앞에서부터 자르면 이미 head에 든
  // 예약 항목이 밀려나 보장이 깨진다(limit=3, head=[d1,d2,lex1], 예약=[lex1,lex2] →
  // [d1,d2,lex2]가 되어 lex1을 잃는다). 뒤에서부터 비예약 항목만 뺀다.
  const reservedSet = new Set(reserved);
  const take = missing.slice(0, limit);
  const keep = [...head];
  for (let i = keep.length - 1; i >= 0 && keep.length + take.length > limit; i--) {
    if (!reservedSet.has(keep[i])) keep.splice(i, 1);
  }

  // 예약 항목만으로 limit을 넘기면 앞에서부터 자른다(그럴 만큼 예약하지 않는 것이
  // 호출부 책임이다).
  return [...keep, ...take].slice(0, limit);
}
