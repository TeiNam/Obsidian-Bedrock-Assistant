// AI-first 노트 포맷 속성 기반 테스트 (fast-check 기반)
// ====================================================
// 순수 함수 모듈 `ai-first-format.ts`의 설계 Correctness Properties를 검증한다.
// 각 속성 테스트는 최소 100회 반복(numRuns >= 100)으로 실행한다.
//
// 이 파일은 Property 7(생성→파싱 라운드트립 메타데이터 보존)만 다룬다.
// (Property 8/9는 후속 태스크 2.3, 2.4에서 추가된다.)

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildAiFirstNote,
  parseAiFirstNote,
  AiFirstMeta,
  AiFirstNoteInput,
  Confidence,
  Recency,
} from "./ai-first-format";

// --- 구현과 동일한 정규화 로직을 재현(replicate)하여 기대값을 계산한다 ---
// ai-first-format.ts 의 normalizeConfidence / normalizeDate 는 export 되지 않으므로,
// 라운드트립 후 "복원되어야 하는 값"을 동일 규약으로 다시 계산한다.

/** confidence 정규화 재현: [0,1] 클램프(비유한수→0), low|medium|high 표준화, 그 외 문자열→"medium" */
function expectedConfidence(c: Confidence): number | "low" | "medium" | "high" {
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

/** 날짜 정규화 재현: 이미 YYYY-MM-DD면 그대로, 파싱 가능하면 UTC 기준 YYYY-MM-DD, 아니면 trim 원본 */
function expectedDate(value: string): string {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return t;
  }
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear().toString().padStart(4, "0");
    const m = (parsed.getUTCMonth() + 1).toString().padStart(2, "0");
    const d = parsed.getUTCDate().toString().padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return t;
}

// --- 생성기(Generator) 설계 ---

/** 깨끗한 YYYY-MM-DD 문자열 생성기 (d<=28 로 월 길이 이슈 회피). */
const ymdArb: fc.Arbitrary<string> = fc
  .record({
    y: fc.integer({ min: 1900, max: 2999 }),
    mo: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ y, mo, d }) =>
      `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  );

/**
 * 날짜 입력 생성기 — 정규화 경로를 모두 통과하도록 YYYY-MM-DD 와 (UTC) ISO 형식을 섞는다.
 * 두 형식 모두 normalizeDate 가 깨끗한 YYYY-MM-DD 로 결정적으로 변환한다.
 */
const dateArb: fc.Arbitrary<string> = ymdArb.chain((ymd) =>
  fc.constantFrom(ymd, `${ymd}T00:00:00.000Z`, `${ymd}T08:15:30Z`)
);

/**
 * confidence 입력 생성기 — 범위 내/외 수치, 비유한수, 정성 등급(대소문자 혼합),
 * 수치 문자열, 임의 문자열을 모두 포함한다(Req 3.4 보정 경로 커버).
 */
const confidenceArb: fc.Arbitrary<Confidence> = fc.oneof(
  fc.double({ min: -1000, max: 1000, noNaN: true }),
  fc.constantFrom(Infinity, -Infinity, NaN),
  fc.constantFrom("low", "medium", "high", "LOW", "Medium", "HIGH"),
  fc.double({ min: -10, max: 10, noNaN: true }).map((n) => String(n)),
  fc.string()
);

/** 유효한 AiFirstMeta 생성기 — 선택 필드는 가끔 undefined. */
const metaArb: fc.Arbitrary<AiFirstMeta> = fc.record({
  title: fc.string(),
  recency: fc.constantFrom<Recency>("evergreen", "dated"),
  confidence: confidenceArb,
  validFrom: fc.option(dateArb, { nil: undefined }),
  learnedAt: fc.option(dateArb, { nil: undefined }),
  source: fc.option(fc.string(), { nil: undefined }),
  tags: fc.option(fc.array(fc.string()), { nil: undefined }),
});

describe("ai-first-format - Property 7", () => {
  // Feature: second-brain-layer, Property 7: AI-first 노트는 생성→파싱 라운드트립에서 메타데이터를 보존한다
  it("parseAiFirstNote(buildAiFirstNote(input)) 는 입력 메타데이터를 (정규화 기준) 보존한다", () => {
    fc.assert(
      fc.property(metaArb, fc.string(), ymdArb, (meta, body, today) => {
        const input: AiFirstNoteInput = { meta, body };
        const note = buildAiFirstNote(input, today);
        const parsed = parseAiFirstNote(note);

        // 정상 노트이므로 파싱은 실패하지 않고 본문은 무손실 보존된다.
        expect(parsed.parseFailed).toBe(false);
        expect(parsed.body).toBe(body);

        // 항상 출력되는 필드: title, recency, confidence, learned_at
        const expected: Partial<AiFirstMeta> = {
          title: meta.title,
          recency: meta.recency,
          confidence: expectedConfidence(meta.confidence),
          learnedAt:
            meta.learnedAt !== undefined
              ? expectedDate(String(meta.learnedAt))
              : expectedDate(today),
        };
        // 선택 필드는 입력에 있을 때만 복원된다.
        if (meta.validFrom !== undefined) {
          expected.validFrom = expectedDate(String(meta.validFrom));
        }
        if (meta.source !== undefined) {
          expected.source = meta.source;
        }
        if (meta.tags !== undefined) {
          expected.tags = meta.tags;
        }

        expect(parsed.meta).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });
});

describe("ai-first-format - Property 8", () => {
  // Feature: second-brain-layer, Property 8: confidence는 항상 유효 범위로 정규화된다
  it("buildAiFirstNote 가 직렬화한 confidence 는 [0,1] 수치이거나 low|medium|high 다 (Req 3.4)", () => {
    fc.assert(
      fc.property(confidenceArb, fc.string(), ymdArb, (confidence, body, today) => {
        // 임의의 confidence 입력으로 노트를 만들고 다시 파싱한다.
        const input: AiFirstNoteInput = {
          meta: {
            title: "t",
            recency: "evergreen",
            confidence,
          },
          body,
        };
        const note = buildAiFirstNote(input, today);
        const parsed = parseAiFirstNote(note);

        // 정상 노트이므로 confidence 는 항상 복원된다.
        const c = parsed.meta.confidence;
        const isClampedNumber =
          typeof c === "number" && c >= 0 && c <= 1;
        const isQualitative =
          c === "low" || c === "medium" || c === "high";

        // confidence 는 유효 범위([0,1] 수치) 또는 정성 등급으로만 정규화되어야 한다.
        expect(isClampedNumber || isQualitative).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// --- 손상/비프론트매터 입력 생성기 (Property 9) ---
// parseAiFirstNote 는 다음 두 조건 중 하나라도 만족하면 parseFailed=true 를 반환한다:
//   (a) 문서가 "---\n" 으로 시작하지 않음
//   (b) "---\n" 으로 시작하지만 닫는 "\n---" 가 존재하지 않음
// 따라서 "정상 노트가 우연히 생성되는 경우"를 배제하도록 두 부류를 명시적으로 생성한다.

/** (a) "---\n" 으로 시작하지 않는 임의 문자열 — 프론트매터 부재로 간주된다. */
const nonFrontmatterArb: fc.Arbitrary<string> = fc
  .string()
  .filter((s) => !s.startsWith("---\n"));

/**
 * (b) "---\n" 으로 시작하지만 닫는 "\n---" 가 없는 문자열 — 닫히지 않은(손상) 프론트매터.
 * 내부 본문에 "\n---" 가 포함되면 닫힘으로 해석되므로 이를 배제한다.
 */
const unclosedFrontmatterArb: fc.Arbitrary<string> = fc
  .string()
  .filter((s) => !s.includes("\n---"))
  .map((inner) => `---\n${inner}`);

/** 손상 입력 전체 생성기 — 두 부류를 합친다. */
const corruptNoteArb: fc.Arbitrary<string> = fc.oneof(
  nonFrontmatterArb,
  unclosedFrontmatterArb
);

describe("ai-first-format - Property 9", () => {
  // Feature: second-brain-layer, Property 9: 손상된 노트 파싱은 예외 없이 실패 표시를 반환한다
  it("parseAiFirstNote 는 손상/비프론트매터 입력에 대해 예외 없이 parseFailed=true 를 반환한다 (Req 3.7)", () => {
    fc.assert(
      fc.property(corruptNoteArb, (note) => {
        // 어떤 손상 입력에도 예외를 던지지 않아야 한다.
        let parsed!: ReturnType<typeof parseAiFirstNote>;
        expect(() => {
          parsed = parseAiFirstNote(note);
        }).not.toThrow();

        // 손상 입력은 항상 실패 표시(parseFailed=true)와 부분 메타(객체)를 반환한다.
        expect(parsed.parseFailed).toBe(true);
        expect(typeof parsed.meta).toBe("object");
        expect(parsed.meta).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
