// ============================================
// 검색 품질 지표 — 순수 함수
// ============================================
// 검색 랭킹을 손볼 때 "좋아진 것 같다"를 "recall@5가 0.6 → 0.9"로 바꾸기 위한 최소
// 도구다. 지표가 없으면 융합 가중치나 임계값 조정이 전부 감으로 가고, 한 질의를
// 고치면서 다른 질의를 망가뜨려도 알 수 없다.
//
// 볼트도 LLM도 건드리지 않는다. "순위 목록 + 정답 집합 → 숫자"만 계산한다.

/** 경로 비교를 대소문자 무시로 정규화한다. */
function key(path: string): string {
  return path.toLowerCase();
}

/**
 * 상위 k개 안에 들어온 정답의 비율.
 *
 * 지식 기반 검색에서 가장 중요한 지표다 — 근거 노트가 상위 k에 없으면 모델은
 * 그 노트를 읽을 기회조차 없다.
 *
 * 순위 목록의 중복은 한 번만 센다. k가 목록보다 크면 목록 전체를 본다.
 *
 * @param ranked 검색이 돌려준 경로들 (관련도 내림차순)
 * @param relevant 이 질의의 정답 경로 집합
 * @param k 상위 몇 개까지 볼지
 * @returns 0.0~1.0. relevant가 비어 있으면 놓칠 것이 없으므로 1을 돌려준다
 *   (호출부는 빈 정답 집합을 픽스처 오류로 따로 걸러야 한다).
 */
export function recallAt(ranked: readonly string[], relevant: readonly string[], k: number): number {
  if (relevant.length === 0) return 1;
  if (k <= 0) return 0;

  const wanted = new Set(relevant.map(key));
  const seen = new Set<string>();
  for (const path of ranked.slice(0, k)) {
    const p = key(path);
    if (wanted.has(p)) seen.add(p);
  }
  return seen.size / wanted.size;
}

/**
 * 상위 k개 중 정답의 비율. 관련 없는 노트로 컨텍스트를 채우는 정도를 잰다.
 *
 * 분모는 실제로 반환된 개수가 아니라 k다. 5개를 요청했는데 2개만 돌려주고 둘 다
 * 맞았을 때 precision@5를 1.0으로 보고하면 "빈 자리"가 공짜가 되어, 적게 돌려주는
 * 쪽이 유리해지는 잘못된 신호가 된다.
 */
export function precisionAt(
  ranked: readonly string[],
  relevant: readonly string[],
  k: number
): number {
  if (k <= 0) return 0;

  const wanted = new Set(relevant.map(key));
  const seen = new Set<string>();
  for (const path of ranked.slice(0, k)) {
    const p = key(path);
    if (wanted.has(p)) seen.add(p);
  }
  return seen.size / k;
}

/**
 * 첫 정답의 역순위(1/rank). 정답이 없으면 0.
 * 상위 한 건만 보는 사용 패턴(모델이 첫 결과만 읽는 경우)의 품질을 잰다.
 */
export function reciprocalRank(ranked: readonly string[], relevant: readonly string[]): number {
  const wanted = new Set(relevant.map(key));
  for (let i = 0; i < ranked.length; i++) {
    if (wanted.has(key(ranked[i]))) return 1 / (i + 1);
  }
  return 0;
}

/** 산술 평균. 빈 배열은 0. */
export function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 평가 케이스 하나 — 질의와 그 질의의 정답 경로. */
export interface EvalCase {
  /** 무엇을 재는 케이스인지. 실패 메시지에 그대로 쓰인다. */
  name: string;
  query: string;
  /** 이 질의에 대해 상위권에 있어야 하는 경로. 비어 있으면 안 된다. */
  relevant: string[];
}

/** 한 케이스의 측정 결과. */
export interface EvalOutcome {
  name: string;
  recall: number;
  precision: number;
  reciprocalRank: number;
  /** 실제로 반환된 상위 k개 — 실패 시 무엇이 대신 올라왔는지 보기 위함. */
  top: string[];
}

/**
 * 케이스 묶음을 주어진 검색 함수로 돌려 케이스별 지표를 낸다.
 *
 * 검색 함수를 인자로 받으므로 dense 전용과 하이브리드처럼 서로 다른 랭킹을 같은
 * 케이스로 비교할 수 있다 — 그게 이 하네스의 존재 이유다.
 *
 * @throws relevant가 빈 케이스가 있으면. 그 케이스는 recall이 항상 1이 되어
 *   조용히 평균을 끌어올리고 회귀를 가린다.
 */
export function runEval(
  cases: readonly EvalCase[],
  search: (query: string) => string[],
  k: number
): EvalOutcome[] {
  for (const c of cases) {
    if (c.relevant.length === 0) {
      throw new Error(`평가 케이스 "${c.name}"에 정답 경로가 없습니다.`);
    }
  }

  return cases.map((c) => {
    const ranked = search(c.query);
    return {
      name: c.name,
      recall: recallAt(ranked, c.relevant, k),
      precision: precisionAt(ranked, c.relevant, k),
      reciprocalRank: reciprocalRank(ranked, c.relevant),
      top: ranked.slice(0, k),
    };
  });
}
