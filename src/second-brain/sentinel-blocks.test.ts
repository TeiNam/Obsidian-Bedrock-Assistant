// Sentinel 블록 병합 속성 기반 테스트 (fast-check 기반)
// ====================================================
// 순수 함수 모듈 `sentinel-blocks.ts`의 설계 Correctness Properties를 검증한다.
//
// 이 파일은 Property 1(멱등성)으로 시작하며, 후속 작업(Task 1.6~1.10)이
// Property 2~6을 같은 파일에 덧붙인다. 그래서 문서/키/내용 생성기를 모듈 상단의
// "공유 생성기" 섹션에 두어 모든 속성 테스트가 재사용하도록 구성한다.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { parseBlocks, upsertGeneratedBlock, getGeneratedBlock, extractUserBlocks, startMarker, endMarker } from "./sentinel-blocks";

// ============================================
// 공유 생성기 (Generators) — Property 1~6 공용
// ============================================

// Block_Key 문자 집합:
//  - 정규식 특수문자(. * + ? ^ $ | ( ) [ ] { } \ 등)를 포함하여 escapeRegExp 경로를 검증한다.
//  - 단, HTML 주석 마커(<!-- ... -->)나 마커 파서(개행 비포함 매칭)를 깨뜨리는 문자
//    (`<`, `>`, 공백, 개행)는 제외하여 "키가 마커 구조 자체를 망가뜨리는" 무의미한 입력을 배제한다.
const KEY_CHARS = [
  ..."abcdABCD0123".split(""),
  ".", "*", "+", "?", "^", "$", "|", "(", ")", "[", "]", "{", "}", "\\", ":", "_",
];
const keyArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...KEY_CHARS), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""));

// 내용(Generated_Region 에 들어갈 새 content): 개행을 포함할 수 있는 임의 텍스트.
// 임의 문자열이 sentinel 마커(<!-- @generated:KEY -->/<!-- @end:KEY -->)의 정확한 바이트열을
// 우연히 만들 확률은 사실상 0이므로, "임의의 content"를 충실히 대표한다.
const contentArb: fc.Arbitrary<string> = fc
  .array(fc.string({ maxLength: 24 }), { maxLength: 3 })
  .map((lines) => lines.join("\n"));

type Segment =
  | { kind: "text"; text: string } // 마커 없는 평문(User_Region 후보)
  | { kind: "block"; key: string; content: string } // 닫힌 Sentinel_Block
  | { kind: "unclosed"; key: string; text: string } // 종료 마커 없는 시작 마커
  | { kind: "strayEnd"; key: string }; // 짝 없는 종료 마커

/** 한 세그먼트를 문서 문자열 조각으로 렌더한다. */
function renderSegment(seg: Segment): string {
  switch (seg.kind) {
    case "text":
      return seg.text;
    case "block":
      return `${startMarker(seg.key)}\n${seg.content}\n${endMarker(seg.key)}`;
    case "unclosed":
      return `${startMarker(seg.key)}\n${seg.text}`;
    case "strayEnd":
      return endMarker(seg.key);
  }
}

/** 멱등성/병합 테스트용 입력 묶음. */
interface DocCase {
  doc: string;
  key: string;
  content: string;
}

/**
 * 문서/키/내용 생성기.
 * 커버하는 케이스: 마커 없음 / 단일 블록 / 다중 블록(동일·상이 키) / 닫히지 않은 마커 /
 * 짝 없는 종료 마커 / 정규식 특수문자 키. 대상 키는 문서에 존재하는 키(교체 경로)와
 * 새 키(말미 추가 경로)를 모두 포함하도록 키 풀에서 뽑거나 새로 만든다.
 */
const docCaseArb: fc.Arbitrary<DocCase> = fc
  .array(keyArb, { minLength: 0, maxLength: 4 })
  .chain((pool) => {
    // 문서에 등장할 키를 풀에서(있으면) 또는 새로 뽑는다 → 동일 키 다중 블록 유도.
    const segmentKeyArb: fc.Arbitrary<string> =
      pool.length > 0 ? fc.oneof(fc.constantFrom(...pool), keyArb) : keyArb;

    const segmentArb: fc.Arbitrary<Segment> = fc.oneof(
      { weight: 2, arbitrary: fc.record({ kind: fc.constant("text" as const), text: fc.string({ maxLength: 30 }) }) },
      { weight: 3, arbitrary: fc.record({ kind: fc.constant("block" as const), key: segmentKeyArb, content: contentArb }) },
      { weight: 1, arbitrary: fc.record({ kind: fc.constant("unclosed" as const), key: segmentKeyArb, text: fc.string({ maxLength: 20 }) }) },
      { weight: 1, arbitrary: fc.record({ kind: fc.constant("strayEnd" as const), key: segmentKeyArb }) },
    );

    // 대상 키: 문서에 존재하는 키(교체) 또는 새 키(추가) 모두를 고르게 다룬다.
    const targetKeyArb: fc.Arbitrary<string> =
      pool.length > 0 ? fc.oneof(fc.constantFrom(...pool), keyArb) : keyArb;

    return fc
      .tuple(fc.array(segmentArb, { minLength: 0, maxLength: 6 }), targetKeyArb, contentArb)
      .map(([segs, key, content]) => ({
        doc: segs.map(renderSegment).join("\n\n"),
        key,
        content,
      }));
  });

// ============================================
// 속성 테스트
// ============================================

describe("Sentinel 블록 속성 테스트", () => {
  // Feature: second-brain-layer, Property 1: upsert는 멱등하다
  // Validates: Requirements 2.6
  it("upsertGeneratedBlock을 동일 인자로 두 번 적용한 결과는 한 번 적용한 결과와 같다(멱등성)", () => {
    fc.assert(
      fc.property(docCaseArb, ({ doc, key, content }) => {
        const once = upsertGeneratedBlock(doc, key, content);
        const twice = upsertGeneratedBlock(once, key, content);
        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: second-brain-layer, Property 2: upsert는 마커 밖 텍스트와 User_Region을 보존한다
  // Validates: Requirements 2.3, 2.4, 2.5
  it("upsertGeneratedBlock 적용 전후로 extractUserBlocks가 반환하는 User_Region 조각이 동일하다(마커 밖 텍스트 보존)", () => {
    fc.assert(
      fc.property(docCaseArb, ({ doc, key, content }) => {
        // 교체 경로(대상 키 존재): Generated_Region 내부만 바뀌므로 마커 밖 텍스트 불변(Req 2.3).
        // 추가 경로(대상 키 부재): 문서 끝에 새 Generated_Region을 덧붙일 뿐이며, 끼워 넣는
        //   구분 공백은 trim 으로 정규화되어 User_Region 집합에 기여하지 않는다(Req 2.4).
        // 두 경우 모두 extractUserBlocks(Req 2.5)가 반환하는 조각이 순서까지 동일해야 한다.
        const before = extractUserBlocks(doc);
        const after = extractUserBlocks(upsertGeneratedBlock(doc, key, content));
        expect(after).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: second-brain-layer, Property 3: get은 upsert가 쓴 내용을 그대로 돌려준다
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4
  it("upsertGeneratedBlock으로 쓴 뒤 getGeneratedBlock으로 읽으면 동일한 content를 반환한다(쓰기-읽기 일관성)", () => {
    fc.assert(
      fc.property(docCaseArb, ({ doc, key, content }) => {
        // 교체 경로(대상 키 존재)든 추가 경로(대상 키 부재)든, upsert 가 기록한 content 는
        // unwrap 라운드트립을 거쳐 손실 없이 복원되어야 한다(Req 2.1, 2.2, 2.3, 2.4).
        const written = upsertGeneratedBlock(doc, key, content);
        expect(getGeneratedBlock(written, key)).toBe(content);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: second-brain-layer, Property 4: 닫히지 않은 마커는 원본을 손실 없이 보존한다
  // Validates: Requirements 2.7
  it("시작 마커는 있으나 종료 마커가 없으면 parseBlocks가 해당 키를 블록으로 인식하지 않고 upsert는 원본을 부분 문자열로 보존한다", () => {
    // 닫히지 않은 시작 마커를 가진 문서 생성기.
    //  - 대상 키(key)의 시작 마커는 문서에 넣되, 대응하는 종료 마커는 절대 넣지 않는다.
    //  - 앞/중간/뒤에 임의 평문을 배치해 "마커가 평문 사이에 끼인" 현실적 입력을 대표한다.
    //  - 임의 평문이 우연히 종료 마커 바이트열을 만들 확률은 0에 가깝지만, 안전을 위해
    //    endMarker(key)를 포함하는 케이스는 filter로 배제하여 "닫히지 않음" 불변식을 보장한다.
    const unclosedDocArb = fc
      .tuple(keyArb, fc.string({ maxLength: 30 }), fc.string({ maxLength: 20 }), fc.string({ maxLength: 30 }), contentArb)
      .map(([key, prefix, mid, suffix, content]) => ({
        key,
        content,
        doc: `${prefix}\n${startMarker(key)}\n${mid}\n${suffix}`,
      }))
      .filter(({ key, doc }) => !doc.includes(endMarker(key)));

    fc.assert(
      fc.property(unclosedDocArb, ({ doc, key, content }) => {
        // (1) 닫히지 않은 시작 마커는 Generated_Region으로 인식되지 않는다(Req 2.7).
        const blocks = parseBlocks(doc);
        expect(blocks.some((b) => b.key === key)).toBe(false);

        // (2) 대상 키의 닫힌 블록이 없으므로 upsert는 "블록 없음"으로 보고 끝에 새 블록을
        //     추가할 뿐, 기존 문서를 통째로 보존한다 → 원본 문서가 결과의 부분 문자열이다.
        const result = upsertGeneratedBlock(doc, key, content);
        expect(result.includes(doc)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: second-brain-layer, Property 5: Block_Key의 정규식 특수문자는 리터럴로 처리된다
  // Validates: Requirements 2.8
  it("Block_Key에 정규식 특수문자가 있어도 정확히 같은 키의 블록만 매칭되고, 정규식으로 취급하면 충돌할 유사 키는 매칭되지 않는다", () => {
    // 정규식 특수문자 풀: escapeRegExp 경로를 직접 자극한다.
    //  - 마커 구조(<!-- ... -->)를 깨는 `<`, `>`, 공백, 개행은 의도적으로 제외한다.
    const SPECIAL_CHARS = [".", "*", "+", "?", "^", "$", "|", "(", ")", "[", "]", "{", "}", "\\"];
    const SAFE_LITERAL = "abcdABCD0123".split(""); // 'x'(와일드카드 대체 문자)와 겹치지 않는 일반 문자

    // 키의 각 자리(slot) 정의:
    //  - shared: 특수 키(sk)와 구체 키(ck)에 동일하게 들어가는 문자(일반 또는 특수문자).
    //            이 자리의 특수문자가 escapeRegExp로 리터럴화되어야 sk 자신의 마커를 찾을 수 있다.
    //  - wild  : sk에는 정규식 와일드카드 '.', ck에는 '.'가 매칭하는 구체 문자 'x'.
    //            이스케이프가 없으면 sk의 '.'가 ck의 'x'에 매칭되어 "다른 키"가 오검출된다(버그).
    type Slot = { kind: "shared"; ch: string } | { kind: "wild" };
    const slotArb: fc.Arbitrary<Slot> = fc.oneof(
      {
        weight: 2,
        arbitrary: fc
          .constantFrom(...SAFE_LITERAL, ...SPECIAL_CHARS)
          .map((ch) => ({ kind: "shared" as const, ch })),
      },
      { weight: 1, arbitrary: fc.constant({ kind: "wild" as const }) },
    );

    // 특수 키(sk)와 구체 키(ck) 쌍 생성기.
    //  - 최소 한 자리는 wild 여야 sk ≠ ck 이며 "정규식 취급 시 충돌" 시나리오가 성립한다.
    //  - sk 는 정규식 특수문자를 반드시 포함하고(와일드카드 '.' 또는 shared 특수문자),
    //    regex(sk)는 (이스케이프하지 않으면) ck 에 매칭될 수 있다.
    const regexKeyPairArb: fc.Arbitrary<{ sk: string; ck: string }> = fc
      .array(slotArb, { minLength: 1, maxLength: 8 })
      .map((slots) => (slots.some((s) => s.kind === "wild") ? slots : [...slots, { kind: "wild" as const }]))
      .map((slots) => ({
        sk: slots.map((s) => (s.kind === "wild" ? "." : s.ch)).join(""),
        ck: slots.map((s) => (s.kind === "wild" ? "x" : s.ch)).join(""),
      }));

    fc.assert(
      fc.property(regexKeyPairArb, contentArb, ({ sk, ck }, content) => {
        // 구체 키(ck) 블록만 가진 문서: 특수 키(sk)를 정규식으로 취급하면 ck 마커에 충돌 매칭될 수 있다.
        const docCk = upsertGeneratedBlock("", ck, content);
        // 정확히 같은 키(ck)로 읽으면 내용을 그대로 돌려준다.
        expect(getGeneratedBlock(docCk, ck)).toBe(content);
        // 특수 키(sk)는 리터럴로 처리되어 ck 마커에 매칭되지 않는다 → null.
        expect(getGeneratedBlock(docCk, sk)).toBeNull();

        // 특수 키(sk) 블록만 가진 문서: sk 의 특수문자가 리터럴로 이스케이프되어야 자기 마커를 찾는다.
        const docSk = upsertGeneratedBlock("", sk, content);
        // 정확히 같은 특수 키(sk)로 읽으면 내용을 그대로 돌려준다(이스케이프가 올바름).
        expect(getGeneratedBlock(docSk, sk)).toBe(content);
        // 유사하지만 다른 구체 키(ck)는 매칭되지 않는다 → null.
        expect(getGeneratedBlock(docSk, ck)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: second-brain-layer, Property 6: 동일 키 다중 블록 시 첫 블록만 교체된다
  // Validates: Requirements 2.9
  it("동일 Block_Key 블록이 둘 이상이면 upsertGeneratedBlock은 첫 블록 내용만 교체하고 이후 동일 키 블록과 마커 밖 텍스트는 보존한다", () => {
    // 동일 키 다중 블록 문서 생성기.
    //  - 대상 키(sharedKey)의 "닫힌 블록"을 반드시 2개 이상 포함한다(전제 충족).
    //  - 그 사이/앞/뒤에 임의 평문과 (다른 키일 수도, 우연히 같은 키일 수도 있는) 다른 닫힌
    //    블록을 끼워 "현실적인 혼합 문서"를 대표한다.
    //  - 짝이 맞는 닫힌 블록만 사용한다(닫히지 않은/짝 없는 마커는 Property 4 영역이므로 배제).
    //    이로써 parseBlocks(스택)와 matchBlock(정규식)이 보는 "첫 블록"이 일치하여 속성이 모호해지지 않는다.
    const property6DocArb = keyArb.chain((sharedKey) => {
      // 주변 세그먼트: 평문 또는 (임의 키) 닫힌 블록.
      const otherSegArb: fc.Arbitrary<Segment> = fc.oneof(
        { weight: 2, arbitrary: fc.record({ kind: fc.constant("text" as const), text: fc.string({ maxLength: 30 }) }) },
        { weight: 2, arbitrary: fc.record({ kind: fc.constant("block" as const), key: keyArb, content: contentArb }) },
      );
      return fc
        .tuple(
          contentArb, // 첫 sharedKey 블록의 원본 내용
          contentArb, // 둘째 sharedKey 블록의 원본 내용
          fc.array(otherSegArb, { maxLength: 3 }), // 앞쪽 주변 세그먼트
          fc.array(otherSegArb, { maxLength: 3 }), // 가운데 주변 세그먼트
          fc.array(otherSegArb, { maxLength: 3 }), // 뒤쪽 주변 세그먼트
          contentArb, // 새로 기록할 content
        )
        .map(([c1, c2, prefix, mid, suffix, newContent]) => {
          const shared1: Segment = { kind: "block", key: sharedKey, content: c1 };
          const shared2: Segment = { kind: "block", key: sharedKey, content: c2 };
          const segs: Segment[] = [...prefix, shared1, ...mid, shared2, ...suffix];
          return { doc: segs.map(renderSegment).join("\n\n"), key: sharedKey, newContent };
        });
    });

    fc.assert(
      fc.property(property6DocArb, ({ doc, key, newContent }) => {
        const before = parseBlocks(doc);
        // 전제: 대상 키의 닫힌 블록이 둘 이상 존재한다(생성기가 보장).
        expect(before.filter((b) => b.key === key).length).toBeGreaterThanOrEqual(2);

        const result = upsertGeneratedBlock(doc, key, newContent);
        const after = parseBlocks(result);

        // (1) 블록 개수와 키 순서는 보존된다(내부 내용만 바뀌므로 시작 순서 불변).
        expect(after.map((b) => b.key)).toEqual(before.map((b) => b.key));

        // (2) 첫 번째 대상 키 블록의 내용만 newContent로 바뀌고, 나머지 모든 블록
        //     (이후 동일 키 블록 + 다른 키 블록)은 원본 내용을 그대로 유지한다(Req 2.9).
        const firstSharedIdx = before.findIndex((b) => b.key === key);
        after.forEach((b, i) => {
          if (i === firstSharedIdx) {
            expect(b.content).toBe(newContent);
          } else {
            expect(b.content).toBe(before[i].content);
          }
        });

        // (3) getGeneratedBlock(=첫 블록 조회)은 새 content를 돌려준다(쓰기 반영 확인).
        expect(getGeneratedBlock(result, key)).toBe(newContent);

        // (4) 마커 밖 텍스트(User_Region)는 한 글자도 변하지 않는다(Req 2.9의 "마커 밖 불변").
        expect(extractUserBlocks(result)).toEqual(extractUserBlocks(doc));
      }),
      { numRuns: 100 },
    );
  });
});
