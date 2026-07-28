// 검색 결과 어댑터 + 공유 LLM 규약 (Search Adapter & Shared LLM Conventions)
// ====================================================================
// VaultIndexer.search가 반환하는 GraphRagResult를 second-brain 능동 기능
// (synthesize/reconcile/thinking-tools)이 공통으로 쓰는 가벼운 SearchHit로
// 변환하는 순수 어댑터와, 모든 run* 래퍼가 공유하는 고정 시스템 프롬프트를
// 단일 출처로 제공한다.
//
// 설계 원칙:
// - 순수 함수: toSearchHits/hasNoHits는 부수효과가 없어 단위/속성 테스트가 쉽다.
// - 백엔드 무관: SECOND_BRAIN_SYSTEM_PROMPT는 백엔드별 표시 이름을 보간하지
//   않는다(스킬 본문과 동일한 브랜딩 무관 제약, Req 5.4).

import type { GraphRagResult } from "../vault-indexer";

/** synthesize/reconcile/thinking이 공유하는 가벼운 검색 히트 (점수·hop 등은 제외). */
export interface SearchHit {
  /** 노트의 볼트 루트 기준 경로 */
  path: string;
  /** 노트 제목 */
  title: string;
  /** 발췌(excerpt) */
  excerpt: string;
}

/**
 * GraphRagResult → SearchHit[] 변환 (순수 함수, Req 7.5 공유 토대).
 * items의 path/title/excerpt만 추출한다(점수·hop은 종합/사고에 불필요).
 */
export function toSearchHits(result: GraphRagResult): SearchHit[] {
  // items가 없을 수도 있는 방어적 처리 — 빈 배열로 안전하게 수렴
  const items = result?.items ?? [];
  return items.map((item) => ({
    path: item.path,
    title: item.title,
    excerpt: item.excerpt,
  }));
}

/**
 * "관련 노트 없음" 판정 (순수 함수, Req 7.6 공유 토대).
 * - invalidQuery: 빈/공백 쿼리로 검색이 수행되지 않은 경우
 * - items.length === 0: 검색은 수행되었으나 진짜 0건인 경우
 * 두 경우를 모두 "결과 없음"으로 본다. 종합/사고 래퍼의 0건 분기가 공유한다.
 */
export function hasNoHits(result: GraphRagResult): boolean {
  if (!result) return true;
  if (result.invalidQuery) return true;
  return (result.items?.length ?? 0) === 0;
}

/**
 * 인덱스가 낡아(임베딩 모델 변경) 검색 근거를 신뢰할 수 없을 때 붙이는 경고 문구.
 *
 * Second Brain 기능은 검색 결과를 근거로 노트를 생성·수정하므로, 인덱스가 무효인
 * 상태를 사용자에게 알리지 않으면 낡은 근거로 만든 결과가 볼트에 기록된다.
 * 결과가 없으면 빈 문자열을 반환해 호출부가 무조건 이어붙일 수 있게 한다.
 */
export function staleIndexWarning(result: GraphRagResult): string {
  return result?.staleEmbeddings
    ? "\n\n⚠️ 임베딩 모델이 변경되어 검색 인덱스가 낡았습니다. 볼트를 다시 인덱싱한 뒤 재실행하면 더 정확한 결과를 얻을 수 있습니다."
    : "";
}

/**
 * 모든 run* 래퍼가 converseLight의 systemPrompt 인자로 공유하는 고정 지침.
 * 백엔드 무관: 특정 백엔드 표시 이름을 하드코딩/보간하지 않는다(Req 5.4 제약 동일).
 */
export const SECOND_BRAIN_SYSTEM_PROMPT = [
  "당신은 사용자의 개인 지식 베이스(Second Brain)를 돕는 보조자입니다.",
  "제공된 노트 발췌만을 근거로 사고하고, 근거가 없는 내용은 단정하지 마십시오.",
  "노트를 참조할 때는 위키링크([[노트 제목]]) 형식을 사용하십시오.",
  "응답은 명확하고 간결한 마크다운으로 작성하며, 불확실성은 솔직하게 표시하십시오.",
  "사용자의 명시적 승인 없이 노트를 덮어쓰는 행위를 제안하지 마십시오.",
].join("\n");
