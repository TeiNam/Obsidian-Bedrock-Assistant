/**
 * provider-utils.ts
 *
 * AWS Bedrock 백엔드에서 사용하는 부수효과 없는(pure) 보정/판별 함수 모음.
 * 네트워크/스트리밍 등 부수효과는 클라이언트에 격리하고, 이 모듈은 속성 기반
 * 테스트가 가능한 순수 함수만 포함한다.
 */

import type { GeminiAssistantSettings } from "./types";

// === maxTokens 입력 정규화 ===

/** maxTokens 허용 하한(1 미만은 무의미). */
export const MIN_MAX_TOKENS = 1;
/** maxTokens 허용 상한(과도한 출력 요청으로 인한 비용/오류 방지). */
export const MAX_MAX_TOKENS = 200000;

/**
 * maxTokens 입력값을 허용 범위([MIN_MAX_TOKENS, MAX_MAX_TOKENS])로 클램프한다.
 * 정수가 아니거나 유한하지 않은 값은 호출부에서 걸러지는 것을 전제로 하되,
 * 안전을 위해 비유한 입력은 하한으로 수렴시킨다.
 */
export function clampMaxTokens(value: number): number {
  if (!Number.isFinite(value)) return MIN_MAX_TOKENS;
  return Math.max(MIN_MAX_TOKENS, Math.min(MAX_MAX_TOKENS, Math.trunc(value)));
}

// === 임베딩 구성 시그니처 ===

/**
 * 현재 설정의 임베딩 구성 시그니처(`bedrock:{embeddingModelId}`)를 계산한다.
 * 임베딩 모델 변경으로 임베딩 벡터 차원/공간이 바뀌면 시그니처도 바뀐다.
 * 시그니처가 달라지면 기존 인덱스의 벡터는 새 쿼리 벡터와 차원이 달라(또는 공간이 달라)
 * 코사인 유사도가 0으로 수렴하므로, 호출부는 이 변화를 감지해 재인덱싱을 안내한다.
 */
export function embeddingSignature(settings: GeminiAssistantSettings): string {
  return `bedrock:${settings.bedrockEmbeddingModel}`;
}

// === 임베딩 입력 절단 ===

/**
 * 임베딩 입력 텍스트 절단.
 * 텍스트 길이가 maxChars 이하이면 원본을 그대로 반환하고,
 * 초과하면 앞부분(접두사)부터 maxChars 글자까지만 잘라서 반환한다.
 * 결과는 항상 입력의 접두사이며 길이는 maxChars 이하임이 보장된다.
 */
export function truncateForEmbedding(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

// === temperature 지원 여부 판별 (Bedrock 최신 모델 대응) ===

/**
 * 주어진 Bedrock 모델이 temperature 파라미터를 지원하는지 판별한다.
 * 일부 최신 추론(reasoning) 모델은 temperature 지정이 미지원이므로
 * (예: Anthropic claude-opus-4 계열), 해당 모델에는 요청에서 temperature를
 * 생략하기 위해 false를 반환한다. 그 외 모델은 모두 지원으로 간주한다(true).
 */
export function supportsTemperature(modelId: string): boolean {
  const id = (modelId ?? "").toLowerCase();
  // Anthropic claude-opus-4 계열은 temperature 미지원
  return !/claude-opus-4/.test(id);
}
