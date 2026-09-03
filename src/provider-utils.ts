/**
 * provider-utils.ts
 *
 * OpenAI/Ollama 클라이언트가 공유하는 부수효과 없는(pure) 매핑/정규화 함수 모음.
 * 네트워크/스트리밍 등 부수효과는 각 클라이언트에 격리하고, 이 모듈은 속성 기반
 * 테스트가 가능한 순수 함수만 포함한다.
 *
 * (후속 작업 2.4, 2.7, 2.9에서 임베딩 절단/모델 필터/도구·메시지 매퍼 등이 같은
 *  파일에 추가된다.)
 */

import type {
	ModelInfo,
	ConverseMessage,
	ContentBlockToolUse,
	EffortLevel,
	ToolDefinition,
	GeminiAssistantSettings,
} from "./types";

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
 * 현재 설정의 임베딩 구성 시그니처(`{provider}:{embeddingModelId}`)를 계산한다.
 * 백엔드 전환 또는 임베딩 모델 변경으로 임베딩 벡터 차원/공간이 바뀌면 시그니처도 바뀐다.
 * 시그니처가 달라지면 기존 인덱스의 벡터는 새 쿼리 벡터와 차원이 달라(또는 공간이 달라)
 * 코사인 유사도가 0으로 수렴하므로, 호출부는 이 변화를 감지해 재인덱싱을 안내한다.
 */
export function embeddingSignature(settings: GeminiAssistantSettings): string {
	switch (settings.aiBackend) {
		case "bedrock":
			return `bedrock:${settings.bedrockEmbeddingModel}`;
		case "openai":
			return `openai:${settings.openaiEmbeddingModel}`;
		case "ollama":
			return `ollama:${settings.ollamaEmbeddingModel}`;
		case "gemini":
		default:
			return `gemini:${settings.embeddingModel}`;
	}
}

// === base URL 정규화/해석/검증 (Req 2.6~2.10) ===

/**
 * base URL 정규화.
 * 앞뒤 공백을 제거하고 후행 슬래시("/")를 모두 제거한다.
 * 예) "  https://api.example.com//  " → "https://api.example.com"
 */
export function normalizeBaseUrl(raw: string): string {
	// trim으로 앞뒤 공백 제거 후, 끝에 붙은 슬래시를 모두(/+$) 제거한다.
	return raw.trim().replace(/\/+$/, "");
}

/**
 * base URL 해석.
 * 정규화 결과가 빈 문자열이면 공급자별 기본 엔드포인트(fallback)를 사용하고(Req 2.7, 2.9),
 * 비어 있지 않으면 정규화된 값을 그대로 사용한다(Req 2.8).
 */
export function resolveBaseUrl(raw: string, fallback: string): string {
	const normalized = normalizeBaseUrl(raw);
	return normalized === "" ? fallback : normalized;
}

/**
 * base URL 형식 검증 술어.
 * 정규화 후 빈 문자열(= 기본 엔드포인트 사용)이거나 http:// 또는 https:// scheme으로
 * 시작하는 경우에만 true를 반환한다(Req 2.10). 설정 저장 시점의 검증에 사용한다.
 */
export function isValidBaseUrl(raw: string): boolean {
	const normalized = normalizeBaseUrl(raw);
	return normalized === "" || /^https?:\/\//.test(normalized);
}

// === 임베딩 입력 절단 (Req 6.3) ===

/**
 * 임베딩 입력 텍스트 절단.
 * 텍스트 길이가 maxChars 이하이면 원본을 그대로 반환하고,
 * 초과하면 앞부분(접두사)부터 maxChars 글자까지만 잘라서 반환한다.
 * 결과는 항상 입력의 접두사이며 길이는 maxChars 이하임이 보장된다(Property 10).
 * 각 클라이언트의 getEmbedding에서 maxChars=20000(기존 Gemini/Bedrock과 일관)으로 적용한다.
 */
export function truncateForEmbedding(text: string, maxChars: number): string {
	return text.length <= maxChars ? text : text.slice(0, maxChars);
}

// === 채팅 모델 계열 식별 (Bedrock 추론 프로파일 목록 필터/정렬) ===

/**
 * Bedrock 채팅 모델로 노출할 계열 패턴. 배열 순서가 곧 표시 우선순위이며,
 * 인덱스는 "같은 계열에서 최신 버전만 남기기" 축약의 그룹 키로도 쓰인다.
 * 버전 숫자를 패턴에 넣지 않으므로 신규 버전이 나와도 자동으로 매칭된다.
 */
const CHAT_MODEL_FAMILIES: readonly RegExp[] = [
	/claude-opus/,
	/claude-sonnet/,
	/claude-haiku/,
	// OpenAI GPT 계열은 같은 버전 안에서도 variant(sol/terra/luna)가 별개 모델이다.
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
 * Bedrock 추론 프로파일 ID는 `global.<vendor>.<model>` 형태이므로 두 번째 세그먼트를
 * 쓰되, 알려진 벤더는 표기를 정규화한다.
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

/**
 * 현재 선택된 백엔드의 채팅 모델 ID를 반환한다.
 * 백엔드마다 모델 ID를 보관하는 설정 필드가 달라(bedrockChatModel /
 * openaiChatModel / ollamaChatModel / chatModel) 호출부가 분기하지 않도록 모은다.
 */
export function activeChatModelId(settings: GeminiAssistantSettings): string {
	switch (settings.aiBackend) {
		case "bedrock":
			return settings.bedrockChatModel;
		case "openai":
			return settings.openaiChatModel;
		case "ollama":
			return settings.ollamaChatModel;
		case "gemini":
		default:
			return settings.chatModel;
	}
}

// === 추론 강도(effort) 지원 여부 및 요청 파라미터 구성 ===

/** 공급자(백엔드) 식별자. */
export type AiProvider = "openai" | "ollama" | "gemini" | "bedrock";

/**
 * effort 파라미터를 받는 추론 모델 패턴(공급자별).
 * 버전 숫자는 "해당 버전 이상"을 뜻하며, 두 자리 이상 버전(예: gpt-10, claude-opus-12)도
 * 낮은 버전으로 오판하지 않도록 `\d{2,}`를 함께 허용한다.
 *
 *  - openai: gpt-5 이상 계열과 o 시리즈(o1/o3/o4 …) 추론 모델
 *  - gemini: gemini-3 이상 계열
 *  - bedrock: Anthropic opus-4 이상 / sonnet-5 이상 / haiku-5 이상,
 *             그리고 Bedrock에 올라온 OpenAI GPT-5 이상 계열(sol/terra/luna 등)
 *  - ollama: 로컬/셀프호스트 모델은 effort 규격이 없으므로 대상 없음
 */
const EFFORT_MODEL_PATTERNS: Record<AiProvider, readonly RegExp[]> = {
	openai: [/^gpt-(?:[5-9]|\d{2,})/, /^o[1-9]/],
	gemini: [/^gemini-(?:[3-9]|\d{2,})/],
	bedrock: [
		/claude-opus-(?:[4-9]|\d{2,})/,
		/claude-sonnet-(?:[5-9]|\d{2,})/,
		/claude-haiku-(?:[5-9]|\d{2,})/,
		/gpt-(?:[5-9]|\d{2,})/,
	],
	ollama: [],
};

/**
 * 주어진 공급자/모델이 추론 강도(effort) 파라미터를 지원하는지 판별한다.
 * 지원하지 않는 모델(구형 모델, Ollama 로컬 모델 등)에는 요청에서 effort를 생략한다.
 * 이 프로젝트는 temperature를 전송하지 않으므로, effort 미지원 모델은
 * 공급자 기본 샘플링 설정을 그대로 사용한다.
 */
export function supportsEffort(provider: AiProvider, modelId: string): boolean {
	const id = (modelId ?? "").toLowerCase();
	return (EFFORT_MODEL_PATTERNS[provider] ?? []).some((re) => re.test(id));
}

/**
 * 프롬프트 캐싱 마커(cachePoint)를 넣어도 되는 Bedrock 모델 패턴.
 *
 * Bedrock에서 프롬프트 캐싱은 모델별 지원 기능이다. 지원하지 않는 모델에 cachePoint
 * 블록을 보내면 검증 오류로 요청 전체가 실패하므로, 확실히 지원하는 계열만 허용한다.
 * 목록에 없으면 캐시 마커 없이 보낸다 — 캐싱은 최적화이고, 최적화가 요청을 깨서는 안 된다.
 */
const CACHING_MODEL_PATTERNS: readonly RegExp[] = [
	/claude-opus-(?:[4-9]|\d{2,})/,
	/claude-sonnet-(?:[4-9]|\d{2,})/,
	/claude-haiku-(?:[4-9]|\d{2,})/,
	/nova-(?:lite|pro|premier)/,
];

/**
 * 캐시 마커를 붙일 최소 안정 접두어 길이(문자).
 *
 * Anthropic 모델은 캐시 대상이 1024토큰(일부 모델 2048) 이상이어야 캐싱이 일어난다.
 * 토크나이저가 없으므로 문자 수로 보수적으로 가늠한다 — 영어 위주 프롬프트에서 4자/토큰을
 * 잡으면 1024토큰은 약 4096자다. 미달인데 마커를 붙이면 아무 이득 없이 요청 모양만
 * 복잡해지므로 그때는 붙이지 않는다.
 */
export const MIN_CACHEABLE_PREFIX_CHARS = 4096;

/**
 * 주어진 백엔드/모델/안정 접두어에 프롬프트 캐시 마커를 붙일 수 있는지 판별한다.
 *
 * Bedrock만 true가 될 수 있다. 나머지 백엔드는 이 플러그인이 할 일이 없다:
 *  - OpenAI: 1024토큰 이상 접두어를 자동으로 캐싱한다. 마커 규격이 없다.
 *  - Ollama: 로컬 실행이라 과금 대상이 아니고 캐싱 API도 없다.
 *  - Gemini: 명시적 캐싱은 CachedContent 리소스를 만들고 TTL과 수명을 직접 관리해야
 *    한다(별 API 호출 + 삭제 책임). 한 줄 마커로 끝나는 일이 아니어서 범위 밖이다.
 */
export function supportsPromptCaching(
	provider: AiProvider,
	modelId: string,
	stablePrefixLength: number
): boolean {
	if (provider !== "bedrock") return false;
	if (stablePrefixLength < MIN_CACHEABLE_PREFIX_CHARS) return false;

	const id = (modelId ?? "").toLowerCase();
	return CACHING_MODEL_PATTERNS.some((re) => re.test(id));
}

/** 바이너리 첨부의 종류. 백엔드 지원 범위가 종류별로 다르다. */
export type AttachmentKind = "image" | "document";

/**
 * 백엔드별로 모델까지 전달할 수 있는 첨부 종류.
 *
 * chat-view의 buildBinaryContentBlock은 Bedrock Converse 규격으로 블록을 만들고
 * (`{image:{format,source:{bytes}}}` / `{document:{...}}`), 각 클라이언트가 자기 규격으로
 * 번역한다. 번역이 없는 조합은 블록이 조용히 사라져 사용자가 "모델이 첨부를 보고
 * 틀렸다"고 오해하므로, 여기 없는 조합은 첨부 자체를 거절한다.
 *
 * 범위를 좁게 잡은 이유:
 *  - openai: 이미지는 `image_url` 데이터 URL로 확실히 전달된다. PDF는 `type:"file"`
 *    규격이 모델과 엔드포인트에 따라 달라지고, 이 플러그인은 OpenAI 호환 커스텀
 *    base URL을 허용하므로(그쪽이 지원할 보장이 없다) 문서는 제외한다.
 *  - ollama: 메시지의 `images` 배열로 이미지만 보낼 수 있다. 문서 규격은 없다.
 *    이미지도 비전 모델이어야 실제로 보이지만, 올바른 API로 보내면 못 보는 모델은
 *    오류를 돌려준다 — 조용히 사라지는 것보다 낫다.
 *  - gemini: inlineData로 이미지와 PDF를 보낸다. Office 문서는 지원하지 않으므로
 *    chat-view가 pdf만 document로 허용하는지는 종류 단위로 판정할 수 없다 —
 *    형식 단위 판정은 supportsAttachmentFormat이 담당한다.
 */
const ATTACHMENT_SUPPORT: Record<AiProvider, readonly AttachmentKind[]> = {
	bedrock: ["image", "document"],
	gemini: ["image", "document"],
	openai: ["image"],
	ollama: ["image"],
};

/** 백엔드가 해당 종류의 첨부를 전달할 수 있는지. */
export function supportsAttachmentKind(provider: AiProvider, kind: AttachmentKind): boolean {
	return ATTACHMENT_SUPPORT[provider]?.includes(kind) ?? false;
}

/** 확장자 → 첨부 종류. 목록에 없으면 첨부 대상이 아니다. */
const IMAGE_FORMATS: Record<string, string> = {
	png: "png",
	jpg: "jpeg",
	jpeg: "jpeg",
	gif: "gif",
	webp: "webp",
};
const DOCUMENT_FORMATS: Record<string, string> = {
	pdf: "pdf",
	doc: "doc",
	docx: "docx",
	xls: "xls",
	xlsx: "xlsx",
};

/** 확장자의 첨부 종류를 판정한다. 바이너리 첨부가 아니면 null. */
export function attachmentKindOf(ext: string): AttachmentKind | null {
	const e = (ext ?? "").toLowerCase();
	if (IMAGE_FORMATS[e]) return "image";
	if (DOCUMENT_FORMATS[e]) return "document";
	return null;
}

/**
 * 백엔드가 이 확장자를 실제로 전달할 수 있는지 판별한다.
 *
 * 종류 단위 판정으로는 부족하다 — Gemini는 document를 지원하지만 PDF만이고 Office는
 * 못 받는다. 형식까지 봐야 "docx를 붙였는데 조용히 사라지는" 경우를 막을 수 있다.
 */
export function supportsAttachmentFormat(provider: AiProvider, ext: string): boolean {
	const kind = attachmentKindOf(ext);
	if (kind === null) return false;
	if (!supportsAttachmentKind(provider, kind)) return false;

	// Gemini의 inlineData는 PDF만 문서로 받는다. Office 형식은 Bedrock 전용이다.
	if (kind === "document" && provider !== "bedrock") {
		return (ext ?? "").toLowerCase() === "pdf";
	}
	return true;
}

/**
 * 이 형식을 전달할 수 있는 백엔드 목록. 거절 안내에서 "그럼 어디로 바꿔야 하나"에
 * 답하기 위해 쓴다. 능력 행렬이 바뀌면 안내 문구도 자동으로 따라간다.
 */
export function backendsSupportingFormat(ext: string): AiProvider[] {
	const all: AiProvider[] = ["bedrock", "gemini", "openai", "ollama"];
	return all.filter((p) => supportsAttachmentFormat(p, ext));
}

/** 첨부 형식의 MIME 타입. inlineData·데이터 URL에 필요하다. */
export function attachmentMimeType(ext: string): string | null {
	const e = (ext ?? "").toLowerCase();
	if (IMAGE_FORMATS[e]) return `image/${IMAGE_FORMATS[e]}`;
	if (e === "pdf") return "application/pdf";
	if (e === "doc") return "application/msword";
	if (e === "docx") {
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
	}
	if (e === "xls") return "application/vnd.ms-excel";
	if (e === "xlsx") {
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
	}
	return null;
}

/**
 * 바이트열을 base64로 인코딩한다.
 * Electron 렌더러와 Node(테스트) 모두 Buffer를 제공하므로 그것을 쓴다.
 */
export function bytesToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

/** effort 값의 강도 순서(약함 → 강함). clampEffort의 근접 값 선택 기준. */
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
/**
 * OpenAI 추론 강도 허용 값.
 * 스펙상 전체 집합은 none~max지만 모델마다 지원 범위가 다르다.
 *  - gpt-5.6 이상: low~max (xhigh/max 지원, minimal 미지원)
 *  - 그 이전 gpt-5.x: minimal~high
 *  - o 시리즈: low~high (minimal 미지원)
 * ("none"은 추론을 끄는 값으로, 이 플러그인은 노출하지 않는다.)
 *
 * gpt-5.6은 minimal을 거부한다("Supported values are: 'none', 'low', 'medium',
 * 'high', 'xhigh', and 'max'"). Bedrock sol/terra/luna 3종에서 확인(2026-08-18).
 */
const OPENAI_EFFORTS_FULL: readonly EffortLevel[] = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];
const OPENAI_EFFORTS_BASIC: readonly EffortLevel[] = ["minimal", "low", "medium", "high"];
const O_SERIES_EFFORTS: readonly EffortLevel[] = ["low", "medium", "high"];
/**
 * Gemini thinking level 허용 값.
 * Gemini 3 이상에서 지원하며 모델 계열별로 범위가 다르다.
 *  - Pro 계열: low / high 만 지원
 *  - Flash·Flash-Lite 계열: minimal~high
 * 2.5 이하는 thinkingBudget(토큰 수) 규격이라 effort 대상에서 제외한다
 * (EFFORT_MODEL_PATTERNS.gemini 참고) — 해당 모델은 공급자 기본값을 사용한다.
 */
const GEMINI_EFFORTS: readonly EffortLevel[] = ["minimal", "low", "medium", "high"];
const GEMINI_PRO_EFFORTS: readonly EffortLevel[] = ["low", "high"];

/** OpenAI 모델 ID의 허용 effort 집합을 판별한다(Bedrock에 올라온 GPT도 동일 규칙). */
function openAiEffortsFor(id: string): readonly EffortLevel[] {
	// o 시리즈(o1/o3/o4 …)는 minimal을 지원하지 않는다.
	if (/^o[1-9]/.test(id)) return O_SERIES_EFFORTS;
	// gpt-5.6 이상은 xhigh/max까지 지원한다. 5.6 미만(5, 5.1, 5.4 …)은 high까지.
	const version = /gpt-(\d+)(?:\.(\d+))?/.exec(id);
	if (version) {
		const major = Number(version[1]);
		const minor = Number(version[2] ?? 0);
		if (major > 5 || (major === 5 && minor >= 6)) return OPENAI_EFFORTS_FULL;
	}
	return OPENAI_EFFORTS_BASIC;
}

/**
 * 모델이 허용하는 effort 값 목록을 반환한다(effort 미지원이면 빈 배열).
 * 벤더마다 허용 집합이 다르므로(Anthropic만 xhigh/max 보유) 설정 UI는
 * 이 목록만 사용자에게 노출해야 한다.
 */
export function effortLevels(provider: AiProvider, modelId: string): readonly EffortLevel[] {
	if (!supportsEffort(provider, modelId)) return [];
	const id = (modelId ?? "").toLowerCase();
	switch (provider) {
		case "gemini":
			// Pro 계열은 low/high만 지원한다(minimal/medium 전송 시 INVALID_ARGUMENT).
			return /-pro/.test(id) ? GEMINI_PRO_EFFORTS : GEMINI_EFFORTS;
		case "openai":
			return openAiEffortsFor(id);
		case "bedrock":
			// Bedrock은 Anthropic과 OpenAI 모델을 함께 제공하므로 모델 ID로 구분한다.
			return /gpt-/.test(id) ? openAiEffortsFor(id) : ANTHROPIC_EFFORTS;
		default:
			return [];
	}
}

/**
 * 저장된 effort 값을 해당 모델이 허용하는 값으로 보정한다.
 * 백엔드/모델을 바꾸면 허용 집합이 달라지므로(예: Anthropic "max" → OpenAI 미허용),
 * 강도 랭크가 가장 가까운 허용 값으로 수렴시킨다. 동거리면 더 약한 쪽을 택한다.
 */
export function clampEffort(
	provider: AiProvider,
	modelId: string,
	value: EffortLevel
): EffortLevel {
	const allowed = effortLevels(provider, modelId);
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
 * 레거시 temperature 값을 effort 강도로 환산한다.
 * temperature를 제거하는 마이그레이션에서 구버전 설정값의 "의도"(보수적 ↔ 창의적)를
 * 최대한 승계하기 위한 매핑이며, 정확한 등가 변환은 아니다.
 * 낮은 temperature는 결정적 출력을 원한다는 뜻이므로 낮은 강도로 대응시킨다.
 */
export function legacyTemperatureToEffort(temperature: number): EffortLevel {
	if (!Number.isFinite(temperature)) return "medium";
	if (temperature <= 0.2) return "low";
	if (temperature <= 0.7) return "medium";
	return "high";
}

/**
 * 공급자별 effort 요청 파라미터를 구성한다.
 * 각 공급자의 원본 API 스펙을 그대로 따르며, effort 미지원 모델은 빈 객체를 반환해
 * 호출부가 파라미터를 생략하도록 한다.
 *
 *  - openai: `{ reasoning_effort }` (Chat Completions 요청 본문 최상위)
 *  - bedrock(Anthropic): `{ output_config: { effort } }` (additionalModelRequestFields)
 *  - bedrock(OpenAI): `{ reasoning: { effort } }` (additionalModelRequestFields)
 *  - gemini: `{ thinkingConfig: { thinkingLevel } }` (generationConfig 내부)
 *  - ollama: 대상 없음 → 빈 객체
 */
export function buildEffortParams(
	provider: AiProvider,
	modelId: string,
	effort: EffortLevel
): Record<string, unknown> {
	if (!supportsEffort(provider, modelId)) return {};
	const level = clampEffort(provider, modelId, effort);
	const id = (modelId ?? "").toLowerCase();
	switch (provider) {
		case "openai":
			return { reasoning_effort: level };
		case "gemini":
			// Gemini는 thinkingConfig.thinkingLevel로 사고 깊이를 지정한다.
			return { thinkingConfig: { thinkingLevel: level } };
		case "bedrock":
			// 두 벤더 모두 평면 키를 거부하므로 각자의 네이티브 형태로 중첩한다.
			// Anthropic: 평면 `effort`는 validation 오류.
			// OpenAI: Bedrock은 GPT-5 이상의 Converse 요청을 Responses 규격으로 전달하므로
			// Chat Completions의 평면 `reasoning_effort`는 unknown_parameter 오류가 된다.
			return /gpt-/.test(id)
				? { reasoning: { effort: level } }
				: { output_config: { effort: level } };
		default:
			return {};
	}
}

// === 도구 호출 ID 생성 (Req 5.7) ===

/**
 * 고유 toolUseId 생성.
 * 공급자(특히 Ollama)가 도구 호출에 식별자를 제공하지 않을 때, 각 도구 호출에
 * 부여할 고유 ID를 생성한다(Req 5.7). 가용하면 crypto.randomUUID()를 사용하고,
 * 미지원 환경에서는 시간값과 난수를 조합한 폴백 ID를 사용한다.
 */
export function generateToolUseId(): string {
	// crypto.randomUUID는 부수효과가 없는 순수 난수 생성으로, 호출마다 고유 ID를 반환한다.
	const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } })
		.crypto;
	if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
		return `tooluse_${cryptoObj.randomUUID()}`;
	}
	// 폴백: randomUUID 미지원 환경에서 시간값 + 난수로 충돌 가능성이 낮은 ID 구성.
	const rand = Math.random().toString(36).slice(2);
	return `tooluse_${Date.now().toString(36)}_${rand}`;
}

// === stopReason 매핑 (Req 4.4, 4.5) ===

/**
 * 내부 stopReason 매핑.
 * 도구 호출이 존재하면(hasToolUse=true) 공급자 종료 사유와 무관하게 항상 "tool_use"를
 * 반환한다(Req 4.4). 도구 호출이 없으면 공급자 종료 사유 원문을 내부 값으로 매핑한다(Req 4.5):
 *  - "stop"/"end_turn"     → "end_turn"
 *  - "length"/"max_tokens" → "max_tokens"
 *  - 그 외(null 포함)        → "end_turn" 폴백
 */
export function mapStopReason(
	rawReason: string | null,
	hasToolUse: boolean
): string {
	// 도구 호출이 있으면 종료 사유보다 우선하여 tool_use로 확정한다(Req 4.4).
	if (hasToolUse) {
		return "tool_use";
	}
	switch (rawReason) {
		case "stop":
		case "end_turn":
			return "end_turn";
		case "length":
		case "max_tokens":
			return "max_tokens";
		default:
			// 알 수 없는 사유나 null은 정상 종료(end_turn)로 폴백한다.
			return "end_turn";
	}
}

// === OpenAI 임베딩 모델 필터 (Req 7.2, 7.4) ===

/**
 * OpenAI 임베딩 모델 필터.
 * OpenAI `/models` 응답은 채팅/임베딩 모델이 혼합되어 있으므로, modelId에 "embedding"을
 * 포함하는 항목만 남겨 임베딩 모델 목록으로 좁힌다(Req 7.2, 7.4).
 * 부수효과 없이 입력 순서를 보존하는 새 배열을 반환한다.
 * 결과의 모든 항목은 "embedding"을 포함하며, 입력에서 "embedding"을 포함하는 모든
 * 항목은 결과에 보존된다(Property 11).
 */
export function filterEmbeddingModels(models: ModelInfo[]): ModelInfo[] {
	return models.filter((m) => m.modelId.includes("embedding"));
}

// === 도구 정의 매핑 (Req 5.1~5.3) ===

/**
 * 단일 ToolDefinition → 공급자 function 스키마 변환.
 * OpenAI와 Ollama 모두 `{ type:"function", function:{ name, description, parameters } }`
 * 형태를 사용하며, 내부 모델의 `input_schema`를 `function.parameters`로 손실 없이 옮긴다.
 */
function toFunctionTool(tool: ToolDefinition): {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
} {
	return {
		type: "function",
		function: {
			// name/description/input_schema를 공급자 스키마로 1:1 매핑(손실 없음).
			name: tool.name,
			description: tool.description,
			parameters: tool.input_schema,
		},
	};
}

/**
 * OpenAI 도구 정의 매핑.
 * 도구 목록이 비어 있으면 `undefined`를 반환하여 요청 바디에서 `tools` 파라미터를
 * 생략한다(Req 5.3). 비어 있지 않으면 입력과 동일 개수의 function 도구 항목을 반환한다(Req 5.1).
 */
export function toOpenAITools(
	tools: ToolDefinition[]
): unknown[] | undefined {
	if (tools.length === 0) {
		return undefined;
	}
	return tools.map(toFunctionTool);
}

/**
 * Ollama 도구 정의 매핑.
 * OpenAI와 동일한 function 스키마(`function.parameters`)를 사용한다(Req 5.2).
 * 빈 목록이면 `undefined`(요청에서 생략, Req 5.3).
 */
export function toOllamaTools(
	tools: ToolDefinition[]
): unknown[] | undefined {
	if (tools.length === 0) {
		return undefined;
	}
	return tools.map(toFunctionTool);
}

// === 응답 도구 호출 → ContentBlockToolUse (Req 5.4~5.7) ===

/**
 * OpenAI tool_calls(JSON 문자열 인자) → ContentBlockToolUse[] 변환.
 * 각 호출의 `function.arguments`(JSON 문자열)를 `JSON.parse`하여 `input`에 설정하고(Req 5.5),
 * 파싱에 실패하면 오류를 throw한다(Req 5.6). 호출 ID가 없으면 `generateToolUseId()`로
 * 고유 ID를 부여한다(Req 5.7). 입력 N개에 대해 정확히 N개의 블록을 반환한다(Req 5.4).
 * 빈/공백 인자 문자열은 인자 없는 호출로 간주하여 `{}`로 처리한다(스트리밍 누적 산출물 호환).
 */
export function openAIToolCallsToBlocks(
	toolCalls: unknown[]
): ContentBlockToolUse[] {
	return toolCalls.map((call) => {
		const c = (call ?? {}) as Record<string, unknown>;
		const fn = (c.function ?? {}) as Record<string, unknown>;
		const name = typeof fn.name === "string" ? fn.name : "";
		const rawArgs = fn.arguments;

		let input: Record<string, unknown> = {};
		if (typeof rawArgs === "string" && rawArgs.trim() !== "") {
			// JSON.parse 실패 시 예외를 전파한다(Req 5.6). 정상 호출로 반환하지 않는다.
			input = JSON.parse(rawArgs) as Record<string, unknown>;
		} else if (rawArgs !== null && typeof rawArgs === "object") {
			// 일부 호환 공급자가 이미 객체로 전달하는 경우 그대로 사용한다.
			input = rawArgs as Record<string, unknown>;
		}

		const id = typeof c.id === "string" && c.id !== "" ? c.id : "";
		return {
			type: "tool_use",
			toolUseId: id || generateToolUseId(),
			name,
			input,
		};
	});
}

/**
 * Ollama tool_calls(객체 인자) → ContentBlockToolUse[] 변환.
 * `function.arguments`는 이미 객체이므로 그대로 `input`에 사용한다.
 * 호출 ID가 없으면(Ollama는 미제공 가능) `generateToolUseId()`로 부여한다(Req 5.7).
 * 입력 N개에 대해 정확히 N개의 블록을 반환한다(Req 5.4).
 */
export function ollamaToolCallsToBlocks(
	toolCalls: unknown[]
): ContentBlockToolUse[] {
	return toolCalls.map((call) => {
		const c = (call ?? {}) as Record<string, unknown>;
		const fn = (c.function ?? {}) as Record<string, unknown>;
		const name = typeof fn.name === "string" ? fn.name : "";
		const rawArgs = fn.arguments;

		// Ollama는 인자를 객체로 전달한다. 객체가 아니면 빈 객체로 폴백한다.
		const input: Record<string, unknown> =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};

		const id = typeof c.id === "string" && c.id !== "" ? c.id : "";
		return {
			type: "tool_use",
			toolUseId: id || generateToolUseId(),
			name,
			input,
		};
	});
}

// === ConverseMessage → 공급자 메시지 (Req 5.8, 5.9) ===

/**
 * 내부 메시지 콘텐츠 블록의 정규화 표현.
 * 코드베이스에는 두 가지 블록 표현이 공존한다:
 *  - Bedrock 스타일 중첩: `{ text }`, `{ toolUse:{ toolUseId,name,input } }`,
 *    `{ toolResult:{ toolUseId,name,content:[{text}] } }` (실제 ConverseMessage.content에 저장되는 형태)
 *  - 평면 판별 유니온: `{ type:"text", text }`, `{ type:"tool_use", toolUseId/id,... }`,
 *    `{ type:"tool_result", tool_use_id, content }` (types.ts 정의)
 * 매퍼는 두 표현을 모두 인식하여 일관되게 변환한다.
 */
type NormalizedBlock =
	| { kind: "text"; text: string }
	| { kind: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { kind: "tool_result"; id: string; content: string }
	| {
			kind: "media";
			mediaKind: AttachmentKind;
			/** Bedrock 규격의 형식 문자열("png", "pdf" 등). */
			format: string;
			bytes: Uint8Array;
			/** 문서 블록의 표시 이름. 이미지에는 없다. */
			name?: string;
	  };

/**
 * tool_result 콘텐츠를 평탄한 문자열로 추출한다.
 * 문자열이면 그대로, `[{text}]` 배열이면 text를 이어 붙인다.
 */
function extractResultText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		let text = "";
		for (const part of content) {
			if (
				typeof part === "object" &&
				part !== null &&
				typeof (part as Record<string, unknown>).text === "string"
			) {
				text += (part as Record<string, unknown>).text as string;
			}
		}
		return text;
	}
	return "";
}

/**
 * 단일 콘텐츠 블록을 정규화 표현으로 변환한다(인식 불가 블록은 null).
 */
function normalizeBlock(block: unknown): NormalizedBlock | null {
	if (typeof block !== "object" || block === null) {
		return null;
	}
	const b = block as Record<string, unknown>;

	// Bedrock 스타일 중첩 도구 호출
	if ("toolUse" in b && typeof b.toolUse === "object" && b.toolUse !== null) {
		const tu = b.toolUse as Record<string, unknown>;
		const id = (tu.toolUseId ?? tu.id ?? "") as string;
		return {
			kind: "tool_use",
			id: typeof id === "string" ? id : "",
			name: typeof tu.name === "string" ? tu.name : "",
			input:
				tu.input !== null && typeof tu.input === "object"
					? (tu.input as Record<string, unknown>)
					: {},
		};
	}

	// Bedrock 스타일 중첩 도구 결과
	if (
		"toolResult" in b &&
		typeof b.toolResult === "object" &&
		b.toolResult !== null
	) {
		const tr = b.toolResult as Record<string, unknown>;
		const id = (tr.toolUseId ?? tr.tool_use_id ?? "") as string;
		return {
			kind: "tool_result",
			id: typeof id === "string" ? id : "",
			content: extractResultText(tr.content),
		};
	}

	// 평면 판별 유니온: tool_use
	if (b.type === "tool_use") {
		const id = (b.toolUseId ?? b.id ?? "") as string;
		return {
			kind: "tool_use",
			id: typeof id === "string" ? id : "",
			name: typeof b.name === "string" ? b.name : "",
			input:
				b.input !== null && typeof b.input === "object"
					? (b.input as Record<string, unknown>)
					: {},
		};
	}

	// 평면 판별 유니온: tool_result
	if (b.type === "tool_result") {
		const id = (b.tool_use_id ?? b.toolUseId ?? "") as string;
		return {
			kind: "tool_result",
			id: typeof id === "string" ? id : "",
			content: extractResultText(b.content),
		};
	}

	// Bedrock 규격 이미지 블록: { image: { format, source: { bytes } } }
	if ("image" in b && typeof b.image === "object" && b.image !== null) {
		const media = normalizeMedia(b.image as Record<string, unknown>, "image");
		if (media) return media;
	}

	// Bedrock 규격 문서 블록: { document: { format, name, source: { bytes } } }
	if ("document" in b && typeof b.document === "object" && b.document !== null) {
		const media = normalizeMedia(b.document as Record<string, unknown>, "document");
		if (media) return media;
	}

	// 텍스트 블록(중첩/평면 공통: text 필드 보유)
	if (typeof b.text === "string") {
		return { kind: "text", text: b.text };
	}

	return null;
}

/** image/document 블록 내부를 정규화한다. 바이트가 없으면 null(전달할 것이 없다). */
function normalizeMedia(
	inner: Record<string, unknown>,
	mediaKind: AttachmentKind
): NormalizedBlock | null {
	const source = inner.source;
	if (typeof source !== "object" || source === null) return null;

	const bytes = (source as Record<string, unknown>).bytes;
	if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null;

	return {
		kind: "media",
		mediaKind,
		format: typeof inner.format === "string" ? inner.format : "",
		bytes,
		...(typeof inner.name === "string" ? { name: inner.name } : {}),
	};
}

/**
 * ConverseMessage 목록 → OpenAI chat 메시지 배열 변환(Req 5.8, 5.9).
 * - `role`은 user/assistant를 그대로 보존한다.
 * - 텍스트 블록은 메시지 `content`로 합친다.
 * - assistant의 tool_use 블록은 `tool_calls`(`{id,type:"function",function:{name,arguments}}`,
 *   arguments는 JSON 문자열)로 매핑한다.
 * - tool_result 블록은 별도의 `{ role:"tool", tool_call_id, content }` 메시지로 매핑하며,
 *   `tool_use_id`를 `tool_call_id`로 사용하여 원 도구 호출과 매칭한다(Req 5.8).
 */
export function toOpenAIMessages(messages: ConverseMessage[]): unknown[] {
	const result: unknown[] = [];

	for (const msg of messages) {
		const blocks = (msg.content as unknown[]).map(normalizeBlock);

		const textSegments: string[] = [];
		const toolCalls: unknown[] = [];
		const toolResultMessages: unknown[] = [];
		/** 이미지 파트. 있으면 user content를 배열 형태로 바꿔야 한다. */
		const imageParts: unknown[] = [];

		for (const nb of blocks) {
			if (nb === null) continue;
			if (nb.kind === "text") {
				textSegments.push(nb.text);
			} else if (nb.kind === "tool_use") {
				toolCalls.push({
					id: nb.id,
					type: "function",
					function: {
						name: nb.name,
						// OpenAI는 인자를 JSON 문자열로 요구한다.
						arguments: JSON.stringify(nb.input),
					},
				});
			} else if (nb.kind === "tool_result") {
				// tool_result → role:"tool" 별도 메시지. tool_call_id로 원 호출과 매칭.
				toolResultMessages.push({
					role: "tool",
					tool_call_id: nb.id,
					content: nb.content,
				});
			} else {
				// media: 이미지만 전달한다. 문서(PDF 등)는 type:"file" 규격이 모델·엔드포인트에
				// 따라 달라지고 이 플러그인은 OpenAI 호환 커스텀 base URL을 허용하므로,
				// 첨부 단계에서 이미 거절된다(supportsAttachmentFormat).
				if (nb.mediaKind !== "image") continue;
				const mime = attachmentMimeType(nb.format);
				if (mime === null) continue;
				imageParts.push({
					type: "image_url",
					image_url: { url: `data:${mime};base64,${bytesToBase64(nb.bytes)}` },
				});
			}
		}

		if (msg.role === "assistant") {
			// 어시스턴트 메시지: 텍스트 + (있으면) tool_calls를 하나의 메시지로 구성.
			const assistantMsg: Record<string, unknown> = {
				role: "assistant",
				content: textSegments.join(""),
			};
			if (toolCalls.length > 0) {
				assistantMsg.tool_calls = toolCalls;
			}
			result.push(assistantMsg);
			// 어시스턴트 메시지에 결과 블록이 섞여 있으면 뒤이어 tool 메시지로 추가(드문 경우).
			for (const trm of toolResultMessages) {
				result.push(trm);
			}
		} else {
			// user 메시지: tool_result(이전 호출 응답)를 먼저 배치한 뒤 사용자 텍스트를 둔다.
			for (const trm of toolResultMessages) {
				result.push(trm);
			}
			// 이미지가 있으면 content를 파트 배열로 보낸다. 문자열 content에는 이미지를
			// 실을 자리가 없다. 이미지를 먼저 두면 모델이 텍스트 질문을 이미지 문맥에서 읽는다.
			if (imageParts.length > 0) {
				const parts: unknown[] = [...imageParts];
				const text = textSegments.join("");
				if (text !== "") parts.push({ type: "text", text });
				result.push({ role: "user", content: parts });
			} else if (textSegments.length > 0) {
				result.push({ role: "user", content: textSegments.join("") });
			}
		}
	}

	return result;
}

/**
 * ConverseMessage 목록 → Ollama chat 메시지 배열 변환(Req 5.8, 5.9).
 * - `role`은 user/assistant를 그대로 보존한다.
 * - 텍스트 블록은 메시지 `content`로 합친다.
 * - assistant의 tool_use 블록은 `tool_calls`(`{function:{name,arguments}}`,
 *   arguments는 객체)로 매핑한다.
 * - tool_result 블록은 별도의 `{ role:"tool", content }` 메시지로 매핑한다(Ollama는
 *   tool_call_id를 사용하지 않으며, 직전 호출과의 매칭은 순서로 보장한다, Req 5.8).
 */
export function toOllamaMessages(messages: ConverseMessage[]): unknown[] {
	const result: unknown[] = [];

	for (const msg of messages) {
		const blocks = (msg.content as unknown[]).map(normalizeBlock);

		const textSegments: string[] = [];
		const toolCalls: unknown[] = [];
		const toolResultMessages: unknown[] = [];
		/** Ollama는 이미지를 메시지 레벨 images 배열(base64 문자열)로 받는다. */
		const images: string[] = [];

		for (const nb of blocks) {
			if (nb === null) continue;
			if (nb.kind === "text") {
				textSegments.push(nb.text);
			} else if (nb.kind === "tool_use") {
				toolCalls.push({
					function: {
						name: nb.name,
						// Ollama는 인자를 객체로 전달한다.
						arguments: nb.input,
					},
				});
			} else if (nb.kind === "tool_result") {
				toolResultMessages.push({
					role: "tool",
					content: nb.content,
				});
			} else {
				// media: Ollama에는 문서 규격이 없다. 이미지만 전달한다.
				if (nb.mediaKind !== "image") continue;
				images.push(bytesToBase64(nb.bytes));
			}
		}

		if (msg.role === "assistant") {
			const assistantMsg: Record<string, unknown> = {
				role: "assistant",
				content: textSegments.join(""),
			};
			if (toolCalls.length > 0) {
				assistantMsg.tool_calls = toolCalls;
			}
			result.push(assistantMsg);
			for (const trm of toolResultMessages) {
				result.push(trm);
			}
		} else {
			for (const trm of toolResultMessages) {
				result.push(trm);
			}
			if (images.length > 0) {
				// content가 비어도 메시지를 만든다 — 이미지만 붙이고 질문 없이 보내는 경우가 있다.
				result.push({ role: "user", content: textSegments.join(""), images });
			} else if (textSegments.length > 0) {
				result.push({ role: "user", content: textSegments.join("") });
			}
		}
	}

	return result;
}
