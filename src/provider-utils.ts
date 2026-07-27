/**
 * provider-utils.ts
 *
 * AWS Bedrock 백엔드에서 사용하는 부수효과 없는(pure) 보정/판별 함수 모음.
 * 네트워크/스트리밍 등 부수효과는 클라이언트에 격리하고, 이 모듈은 속성 기반
 * 테스트가 가능한 순수 함수만 포함한다.
 */

import type { EffortLevel, GeminiAssistantSettings } from "./types";

export type { EffortLevel };

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

// === 채팅 모델 계열 식별 (목록 필터/정렬) ===

/**
 * 채팅 모델로 노출할 계열 패턴. 배열 순서가 곧 표시 우선순위이며,
 * 인덱스는 "같은 계열에서 최신 버전만 남기기" 축약의 그룹 키로도 쓰인다.
 * 버전 숫자를 패턴에 넣지 않으므로 신규 버전이 나와도 자동으로 매칭된다.
 */
const CHAT_MODEL_FAMILIES: readonly RegExp[] = [
  /claude-opus/,
  /claude-sonnet/,
  /claude-haiku/,
  // OpenAI GPT-5 계열은 같은 버전 안에서도 variant(sol/terra/luna)가 별개 모델이다.
  /gpt-[\d.]+-sol/,
  /gpt-[\d.]+-terra/,
  /gpt-[\d.]+-luna/,
  // variant 없는 GPT 계열(gpt-oss 등)은 마지막 그룹으로 묶는다.
  /gpt-/,
];

/**
 * 모델 ID가 속한 채팅 모델 계열의 순위를 반환한다.
 * 채팅 모델로 노출하지 않는 모델(임베딩·이미지 등)이면 null.
 * 반환값은 정렬 우선순위(작을수록 먼저)와 계열 그룹 키를 겸한다.
 */
export function chatModelRank(modelId: string): number | null {
  const id = (modelId ?? "").toLowerCase();
  const rank = CHAT_MODEL_FAMILIES.findIndex((re) => re.test(id));
  return rank === -1 ? null : rank;
}

/**
 * 같은 계열 두 모델 ID의 버전 우열을 비교한다(a가 최신이면 양수).
 * 단순 문자열 비교는 `claude-opus-10`을 `claude-opus-4`보다 낮게 판정하므로,
 * ID에 등장하는 숫자 그룹을 자연 순서(numeric)로 비교한다.
 * 숫자 그룹이 모두 같으면 문자열 비교로 폴백한다.
 */
export function compareModelVersion(a: string, b: string): number {
  const numsA = (a.match(/\d+/g) ?? []).map(Number);
  const numsB = (b.match(/\d+/g) ?? []).map(Number);
  for (let i = 0; i < Math.max(numsA.length, numsB.length); i++) {
    // 숫자 그룹이 더 적은 쪽은 해당 자리를 0으로 취급한다(예: v4 < v4-1).
    const diff = (numsA[i] ?? 0) - (numsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a === b ? 0 : a > b ? 1 : -1;
}

/**
 * 모델 ID에서 표시용 공급자 이름을 추론한다.
 * 추론 프로파일 ID는 `global.<vendor>.<model>` 형태이므로 두 번째 세그먼트를 쓰되,
 * 알려진 벤더는 표기를 정규화한다.
 */
export function inferProviderName(modelId: string): string {
  const id = (modelId ?? "").toLowerCase();
  if (id.includes("anthropic") || id.includes("claude")) return "Anthropic";
  if (id.includes("openai") || id.includes("gpt-")) return "OpenAI";
  const segments = id.split(".");
  const vendor = segments.length >= 3 ? segments[1] : segments[0];
  if (!vendor) return "Unknown";
  return vendor.charAt(0).toUpperCase() + vendor.slice(1);
}

// === effort / temperature 지원 여부 판별 ===

/** effort 값의 강도 순서. clampEffort의 근접 값 선택 기준. */
const EFFORT_RANK: readonly EffortLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Anthropic Claude 계열이 허용하는 effort 값. */
const ANTHROPIC_EFFORTS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
/** OpenAI GPT 계열이 허용하는 effort 값. */
const OPENAI_EFFORTS: readonly EffortLevel[] = ["minimal", "low", "medium", "high"];

/**
 * effort 파라미터를 받는 추론 모델 패턴.
 * Anthropic은 opus-4 / sonnet-5 / haiku-5 이상, OpenAI는 gpt-5 이상이 effort 기반이다.
 * 두 자리 이상 버전(예: claude-opus-10)도 매칭되도록 `\d{2,}`를 함께 허용한다.
 */
const EFFORT_MODEL_PATTERNS: readonly RegExp[] = [
  /claude-opus-(?:[4-9]|\d{2,})/,
  /claude-sonnet-(?:[5-9]|\d{2,})/,
  /claude-haiku-(?:[5-9]|\d{2,})/,
  /gpt-(?:[5-9]|\d{2,})/,
];

/**
 * 주어진 Bedrock 모델이 추론 강도(effort) 파라미터를 지원하는지 판별한다.
 * effort 기반 모델은 temperature를 받지 않으므로 두 판별은 서로 배타적이다.
 */
export function supportsEffort(modelId: string): boolean {
  const id = (modelId ?? "").toLowerCase();
  return EFFORT_MODEL_PATTERNS.some((re) => re.test(id));
}

/**
 * 주어진 Bedrock 모델이 temperature 파라미터를 지원하는지 판별한다.
 * effort 기반 추론 모델은 temperature 지정 시 API 오류가 발생하므로 false를 반환하고,
 * 호출부는 요청에서 temperature를 생략한다. 그 외 모델은 지원으로 간주한다(true).
 */
export function supportsTemperature(modelId: string): boolean {
  return !supportsEffort(modelId);
}

/**
 * 모델이 허용하는 effort 값 목록을 반환한다.
 * effort 미지원 모델은 빈 배열. Anthropic과 OpenAI가 허용 값 집합이 다르므로
 * 설정 UI는 이 목록만 사용자에게 노출해야 한다.
 */
export function effortLevels(modelId: string): readonly EffortLevel[] {
  if (!supportsEffort(modelId)) return [];
  const id = (modelId ?? "").toLowerCase();
  return /gpt-/.test(id) ? OPENAI_EFFORTS : ANTHROPIC_EFFORTS;
}

/**
 * 저장된 effort 값을 해당 모델이 허용하는 값으로 보정한다.
 * 모델을 바꾸면 허용 집합이 달라지므로(예: Anthropic "max" → OpenAI 미허용),
 * 강도 랭크가 가장 가까운 허용 값으로 수렴시킨다. 동거리면 더 약한 쪽을 택한다.
 */
export function clampEffort(modelId: string, value: EffortLevel): EffortLevel {
  const allowed = effortLevels(modelId);
  if (allowed.length === 0) return value;
  if (allowed.includes(value)) return value;
  const target = EFFORT_RANK.indexOf(value);
  // 알 수 없는 값(설정 파일 손상 등)은 중간 강도로 폴백한다.
  if (target === -1) return allowed.includes("medium") ? "medium" : allowed[0];
  let best = allowed[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const level of allowed) {
    const dist = Math.abs(EFFORT_RANK.indexOf(level) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = level;
    }
  }
  return best;
}

/**
 * effort 값을 담은 additionalModelRequestFields 객체를 구성한다.
 * Bedrock Converse는 벤더 고유 파라미터를 additionalModelRequestFields로 통과시키며,
 * 구조는 벤더의 원본 API를 그대로 따른다.
 *  - Anthropic: `output_config: { effort }` (중첩). 평면 `effort`는 validation 오류.
 *  - OpenAI: `reasoning_effort` (평면).
 */
function buildEffortField(modelId: string, effort: EffortLevel): Record<string, unknown> {
  const isOpenAi = /gpt-/.test((modelId ?? "").toLowerCase());
  return isOpenAi ? { reasoning_effort: effort } : { output_config: { effort } };
}

/** buildGenerationParams 결과. Converse 입력에 그대로 펼쳐 넣을 수 있는 형태. */
export interface GenerationParams {
  /** inferenceConfig에 병합할 항목(temperature 지원 모델에서만 채워짐). */
  inferenceConfig: { temperature?: number };
  /** 벤더 고유 파라미터(effort 지원 모델에서만 채워짐). 중첩 구조를 허용한다. */
  additionalModelRequestFields?: Record<string, unknown>;
}

/**
 * 모델별 생성 파라미터를 구성한다.
 * - effort 지원(최신 추론) 모델: temperature를 생략하고 effort만 전달
 * - 그 외 모델: temperature만 전달
 * 두 파라미터가 동시에 실리는 일이 없으므로 API 오류를 구조적으로 차단한다.
 */
export function buildGenerationParams(
  modelId: string,
  opts: { temperature: number; effort: EffortLevel }
): GenerationParams {
  if (supportsEffort(modelId)) {
    return {
      inferenceConfig: {},
      additionalModelRequestFields: buildEffortField(
        modelId,
        clampEffort(modelId, opts.effort)
      ),
    };
  }
  return { inferenceConfig: { temperature: opts.temperature } };
}
