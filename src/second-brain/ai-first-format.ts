// AI-first 노트 포맷 모듈 (Second Brain Layer)
//
// second-brain이 생성하는 노트를 "미래의 AI가 읽기 좋은" 일관된 규격으로
// 직렬화(buildAiFirstNote)하고 다시 역파싱(parseAiFirstNote)하는 순수 함수 모음.
//
// 설계 원칙:
// - buildAiFirstNote / parseAiFirstNote 는 서로 역함수다(라운드트립 보존, Req 3.3 / Property 7).
//   따라서 직렬화 형식은 자체 파서로 100% 복원 가능한 YAML 부분집합으로 고정한다.
// - 프론트매터는 표준 YAML(`---` 구분자)로 작성하여 기존 GraphExtractor / Obsidian
//   metadataCache 가 그대로 인덱싱할 수 있게 한다(Req 3.2). 문자열 값은 JSON 인코딩
//   (이중 따옴표 + 이스케이프)으로 직렬화하는데, 이는 YAML 이중따옴표 스칼라의 부분집합이라
//   Obsidian YAML 파서와도 호환된다.
// - confidence 는 [0,1] 수치 또는 low|medium|high 로 보정한다(Req 3.4 / Property 8).
// - 날짜는 YYYY-MM-DD 로 직렬화하고, learnedAt 미지정 시 생성 시점(today)으로 채운다(Req 3.5).
// - 입력 본문(body)은 일절 변형하지 않고 그대로 보존한다(Req 3.6). wikilink 강제는
//   포맷터 책임이 아니라 스킬/프롬프트 책임이다.
// - 손상/부재 입력 파싱 시 예외를 던지지 않고 parseFailed=true + 부분 메타를 반환한다(Req 3.7 / Property 9).

/** Recency_Marker — 노트 내용의 시의성 */
export type Recency = "evergreen" | "dated";

/** Confidence — 0.0~1.0 수치 또는 정성 등급 */
export type Confidence = number | "low" | "medium" | "high";

/** AI_First_Note 의 프론트매터 메타데이터 */
export interface AiFirstMeta {
  title: string;
  recency: Recency;
  confidence: Confidence;
  /** Bi_Temporal — 사실이 유효해진 시점 (YYYY-MM-DD) */
  validFrom?: string;
  /** Bi_Temporal — 사실을 알게 된 시점 (YYYY-MM-DD, 미지정 시 today) */
  learnedAt?: string;
  source?: string;
  tags?: string[];
}

/** buildAiFirstNote 입력 */
export interface AiFirstNoteInput {
  meta: AiFirstMeta;
  body: string;
}

/** parseAiFirstNote 결과 */
export interface ParsedAiFirstNote {
  /** 파싱 가능한 메타데이터(부분일 수 있음) */
  meta: Partial<AiFirstMeta>;
  /** 프론트매터/프리앰블을 제외한 본문 */
  body: string;
  /** 프론트매터 부재/손상 시 true (Req 3.7) */
  parseFailed: boolean;
}

/**
 * `## For future AI` 프리앰블 블록 (고정 상수).
 * 백엔드별 표시 이름을 보간하지 않는다(브랜딩 무관, Req 5.4 동일 제약).
 * build/parse 가 공유하여 본문(body)을 정확히 분리·복원한다.
 */
const AI_FIRST_PREAMBLE =
  "## For future AI\n" +
  "\n" +
  "이 노트는 미래의 AI 및 검색이 활용하기 좋도록 작성된 구조화 노트다. " +
  "프론트매터의 recency·confidence·bi-temporal 메타데이터를 신뢰도 판단에 사용하고, " +
  "다른 노트를 참조할 때는 wikilink(`[[노트명]]`) 형식을 따른다.\n" +
  "\n";

/**
 * 프론트매터 닫힘(`---`) 이후 본문 영역의 고정 접두사.
 * note = frontmatter + BODY_PREFIX + body 구조이므로, parse 는 이 접두사를 제거해
 * 원본 body 를 무손실 복원한다.
 */
const BODY_PREFIX = "\n" + AI_FIRST_PREAMBLE;

/** Date 객체를 UTC 기준 YYYY-MM-DD 문자열로 포맷한다. */
function formatDateUtc(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 현재 시점(로컬)을 YYYY-MM-DD 로 포맷한다. */
function todayString(): string {
  const d = new Date();
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 날짜 문자열을 YYYY-MM-DD 로 정규화한다(Req 3.5).
 * - 이미 YYYY-MM-DD 형식이면 그대로 반환(멱등)
 * - 그 외 파싱 가능한 날짜면 UTC 기준 YYYY-MM-DD 로 변환
 * - 파싱 불가하면 입력을 그대로(trim) 반환하여 손실을 피한다
 */
function normalizeDate(value: string): string {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return t;
  }
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateUtc(parsed);
  }
  return t;
}

/**
 * confidence 를 유효 범위로 보정한다(Req 3.4 / Property 8).
 * - 수치: [0,1] 로 클램프, 비유한수는 0
 * - 문자열: low|medium|high 면 소문자 표준화, 수치 문자열이면 클램프, 그 외는 "medium"
 */
function normalizeConfidence(c: Confidence): number | "low" | "medium" | "high" {
  if (typeof c === "number") {
    if (!Number.isFinite(c)) return 0;
    return Math.min(1, Math.max(0, c));
  }
  const lc = String(c).trim().toLowerCase();
  if (lc === "low" || lc === "medium" || lc === "high") {
    return lc;
  }
  const n = Number(lc);
  if (lc !== "" && Number.isFinite(n)) {
    return Math.min(1, Math.max(0, n));
  }
  return "medium";
}

/** confidence 정규화 값을 YAML 토큰으로 직렬화한다. */
function serializeConfidence(c: number | "low" | "medium" | "high"): string {
  return typeof c === "number" ? String(c) : c;
}

/**
 * AI_First_Note 문자열을 생성한다 (Req 3.1, 3.2, 3.4, 3.5, 3.6).
 *
 * 구조: 프론트매터(YAML) + `## For future AI` 프리앰블 + body
 * @param input 메타데이터와 본문
 * @param today learnedAt 기본값으로 쓸 YYYY-MM-DD (미지정 시 현재 날짜)
 */
export function buildAiFirstNote(input: AiFirstNoteInput, today?: string): string {
  const meta = input.meta;
  const todayDate = today ? normalizeDate(today) : todayString();

  const lines: string[] = [];
  // 순서는 Req 3.1 의 키 나열을 따른다: title, recency, confidence, valid_from, learned_at, source, tags
  lines.push(`title: ${JSON.stringify(meta.title ?? "")}`);
  lines.push(`recency: ${meta.recency === "dated" ? "dated" : "evergreen"}`);
  lines.push(`confidence: ${serializeConfidence(normalizeConfidence(meta.confidence))}`);

  if (meta.validFrom !== undefined && meta.validFrom !== null) {
    lines.push(`valid_from: ${normalizeDate(String(meta.validFrom))}`);
  }
  // learnedAt 은 미지정 시 today 로 채운다(항상 출력).
  const learnedAt =
    meta.learnedAt !== undefined && meta.learnedAt !== null
      ? normalizeDate(String(meta.learnedAt))
      : todayDate;
  lines.push(`learned_at: ${learnedAt}`);

  if (meta.source !== undefined && meta.source !== null) {
    lines.push(`source: ${JSON.stringify(meta.source)}`);
  }
  if (meta.tags !== undefined && meta.tags !== null) {
    lines.push(`tags: ${JSON.stringify(meta.tags)}`);
  }

  const frontmatter = `---\n${lines.join("\n")}\n---\n`;
  // 본문은 절대 변형하지 않고 그대로 이어 붙인다(Req 3.6).
  return frontmatter + BODY_PREFIX + input.body;
}

/** YAML 스칼라 토큰을 문자열로 디코드한다(JSON 이중따옴표 인코딩이면 복원, 아니면 trim). */
function decodeScalar(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t;
    }
  }
  return t;
}

/** confidence 토큰을 파싱한다(수치 우선, 아니면 low|medium|high). */
function parseConfidenceToken(raw: string): Confidence | undefined {
  const t = raw.trim();
  const n = Number(t);
  if (t !== "" && Number.isFinite(n)) {
    return n;
  }
  const lc = t.toLowerCase();
  if (lc === "low" || lc === "medium" || lc === "high") {
    return lc;
  }
  return undefined;
}

/** tags 토큰(JSON 플로우 배열)을 문자열 배열로 파싱한다. */
function parseTagsToken(raw: string): string[] | undefined {
  const t = raw.trim();
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x));
    }
  } catch {
    // 손상된 tags 토큰은 무시(부분 파싱)
  }
  return undefined;
}

/**
 * AI_First_Note 를 파싱한다 (Req 3.3, 3.7 / Property 7, 9).
 *
 * - buildAiFirstNote 의 역함수: 정상 노트면 메타데이터를 무손실 복원한다.
 * - 프론트매터가 없거나 닫히지 않으면 예외 없이 parseFailed=true 와 부분 메타를 반환한다.
 */
export function parseAiFirstNote(note: string): ParsedAiFirstNote {
  // 프론트매터는 문서 시작의 `---\n` ... `\n---` 형태여야 한다.
  if (!note.startsWith("---\n")) {
    return { meta: {}, body: note, parseFailed: true };
  }

  // 여는 구분자 이후에서 닫는 `\n---` 를 찾는다.
  const afterOpen = note.slice(4); // "---\n" 제거
  const closeIdx = afterOpen.indexOf("\n---");
  if (closeIdx === -1) {
    // 닫히지 않은 프론트매터 — 손상으로 간주
    return { meta: {}, body: note, parseFailed: true };
  }

  const fmInner = afterOpen.slice(0, closeIdx);
  // 닫는 `---` 줄 다음(개행 포함)부터가 본문 영역이다.
  const afterClose = afterOpen.slice(closeIdx + "\n---".length);
  // 닫는 `---` 뒤에 오는 첫 개행 하나를 소비한다(`---\n` 형태).
  const bodyRegion = afterClose.startsWith("\n") ? afterClose.slice(1) : afterClose;

  // 프리앰블 접두사를 제거하여 원본 body 를 복원한다(없으면 best-effort).
  const body = bodyRegion.startsWith(BODY_PREFIX)
    ? bodyRegion.slice(BODY_PREFIX.length)
    : bodyRegion;

  const meta: Partial<AiFirstMeta> = {};
  for (const line of fmInner.split("\n")) {
    if (line.trim() === "") continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s?(.*)$/.exec(line);
    if (!m) continue; // 파싱 불가한 줄은 건너뛴다(부분 파싱)
    const key = m[1];
    const rawValue = m[2];
    switch (key) {
      case "title":
        meta.title = decodeScalar(rawValue);
        break;
      case "recency": {
        const v = rawValue.trim();
        meta.recency = v === "dated" ? "dated" : "evergreen";
        break;
      }
      case "confidence": {
        const c = parseConfidenceToken(rawValue);
        if (c !== undefined) meta.confidence = c;
        break;
      }
      case "valid_from":
        meta.validFrom = rawValue.trim();
        break;
      case "learned_at":
        meta.learnedAt = rawValue.trim();
        break;
      case "source":
        meta.source = decodeScalar(rawValue);
        break;
      case "tags": {
        const tags = parseTagsToken(rawValue);
        if (tags !== undefined) meta.tags = tags;
        break;
      }
      default:
        // 알 수 없는 키는 무시(GraphExtractor 호환을 위해 충돌 없음)
        break;
    }
  }

  return { meta, body, parseFailed: false };
}
