// Graph RAG Chunker 속성 기반 테스트 (fast-check 기반)
// ====================================================
// 순수 함수 모듈 `chunker.ts`의 설계 Correctness Properties를 검증한다.
// 각 테스트는 최소 100회 반복(numRuns >= 100)으로 실행한다.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { splitIntoChunks, normalizeChunkConfig, ChunkConfig } from "./chunker";

/**
 * 불변식(maxSize >= 1, 0 <= overlap < maxSize)을 만족하는 유효 청크 설정 생성기.
 * maxSize를 먼저 뽑고, overlap을 [0, maxSize-1] 범위로 종속 생성하여 항상 유효함을 보장한다.
 */
const validChunkConfig: fc.Arbitrary<ChunkConfig> = fc
  .integer({ min: 1, max: 500 })
  .chain((maxSize) =>
    fc
      .integer({ min: 0, max: maxSize - 1 })
      .map((overlap) => ({ maxSize, overlap }))
  );

describe("splitIntoChunks - Property 6", () => {
  // Feature: graph-rag-knowledge-base, Property 6: 청크는 최대 크기를 초과하지 않는다
  it("반환되는 모든 청크의 길이는 maxSize 이하이다", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 3000 }), validChunkConfig, (body, config) => {
        const chunks = splitIntoChunks(body, config);
        for (const chunk of chunks) {
          expect(chunk.length).toBeLessThanOrEqual(config.maxSize);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("splitIntoChunks - Property 7", () => {
  // Feature: graph-rag-knowledge-base, Property 7: 짧은/빈 본문은 정확히 청크 1개로 처리된다
  it("본문 길이가 maxSize 이하(빈 본문 포함)이면 청크는 정확히 1개이고, 빈 본문이면 빈 텍스트 청크이다", () => {
    // 설정을 먼저 생성한 뒤, 본문 길이를 [0, maxSize] 범위로 종속 생성하여
    // "본문 길이 <= maxSize" 전제를 항상 만족시킨다.
    const configWithShortBody = validChunkConfig.chain((config) =>
      fc
        .string({ maxLength: config.maxSize })
        .map((body) => ({ config, body }))
    );

    fc.assert(
      fc.property(configWithShortBody, ({ config, body }) => {
        const chunks = splitIntoChunks(body, config);
        // 짧은/빈 본문은 정확히 청크 1개로 처리된다 (Req 3.3, 3.4).
        expect(chunks).toHaveLength(1);
        // 빈 본문이면 유일한 청크는 빈 문자열이다 (Req 3.4).
        if (body.length === 0) {
          expect(chunks[0]).toBe("");
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("splitIntoChunks - Property 8", () => {
  // Feature: graph-rag-knowledge-base, Property 8: 인접 청크는 지정된 크기만큼 겹친다
  // Validates: Requirements 3.5
  it("복수 청크로 분할될 때 인접 청크는 정확히 overlap 문자만큼 겹친다", () => {
    // 본문이 >= 2개 청크로 분할되도록 생성기를 구성한다.
    // - maxSize >= 2 : overlap >= 1 이 가능하도록 보장 (overlap < maxSize)
    // - overlap ∈ [1, maxSize-1] : 겹침이 의미를 가지도록 최소 1 이상으로 제약
    // - 본문 길이 > maxSize : 항상 2개 이상의 청크가 생성되도록 보장 (Req 3.3 단일 청크 분기 회피)
    const configWithLongBody = fc.integer({ min: 2, max: 500 }).chain((maxSize) =>
      fc.integer({ min: 1, max: maxSize - 1 }).chain((overlap) =>
        fc
          .string({ minLength: maxSize + 1, maxLength: maxSize + 1000 })
          .map((body) => ({ config: { maxSize, overlap } as ChunkConfig, body }))
      )
    );

    fc.assert(
      fc.property(configWithLongBody, ({ config, body }) => {
        const chunks = splitIntoChunks(body, config);
        // 본문 길이 > maxSize 이므로 청크는 항상 2개 이상이어야 한다.
        expect(chunks.length).toBeGreaterThanOrEqual(2);

        const { overlap } = config;
        // 모든 인접 청크 쌍에 대해 겹침 영역의 문자가 정확히 일치해야 한다 (Req 3.5):
        // chunk[i]의 마지막 overlap 문자 == chunk[i+1]의 처음 overlap 문자.
        for (let i = 0; i < chunks.length - 1; i++) {
          const tail = chunks[i].slice(chunks[i].length - overlap);
          const head = chunks[i + 1].slice(0, overlap);
          // 비(非)마지막 청크는 항상 maxSize 전체 길이이므로 tail 길이는 overlap 과 같다.
          expect(tail.length).toBe(overlap);
          expect(tail).toBe(head);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("splitIntoChunks - Property 9", () => {
  // Feature: graph-rag-knowledge-base, Property 9: 청크 분할은 무손실 커버리지를 보장한다
  // Validates: Requirements 3.7
  it("청크들을 순서대로 겹침을 제거하며 재조립하면 원본 본문이 정확히 복원된다", () => {
    // 다양한 길이의 본문(빈 본문 ~ maxSize 초과 포함)과 유효 설정을 조합한다.
    // maxLength 를 충분히 크게 두어 maxSize 를 초과하는 본문이 자주 생성되도록 한다.
    fc.assert(
      fc.property(fc.string({ maxLength: 3000 }), validChunkConfig, (body, config) => {
        const chunks = splitIntoChunks(body, config);
        const { overlap } = config;

        // 재조립 규칙(알고리즘 역산):
        // step = maxSize - overlap 이므로 chunk[i] = body.slice(i*step, i*step+maxSize).
        // 따라서 chunk[0] 은 본문 선두를 그대로 담고, 이후 청크는 앞 청크와 overlap 만큼
        // 겹치므로 겹침(앞 overlap 문자)을 제거한 tail 만 이어붙이면 본문이 무손실 복원된다:
        //   reconstruction = chunks[0] + chunks[1].slice(overlap) + chunks[2].slice(overlap) + ...
        // (overlap === 0 이면 slice(0) 이 청크 전체이므로 단순 연결과 동치이다.)
        let reconstruction = chunks[0];
        for (let i = 1; i < chunks.length; i++) {
          reconstruction += chunks[i].slice(overlap);
        }

        // 무손실 커버리지: 복원 결과가 원본 본문과 문자 단위로 정확히 일치해야 한다 (Req 3.7).
        expect(reconstruction).toBe(body);
      }),
      { numRuns: 100 }
    );
  });
});

// 임의의 수치 입력(음수/0/거대값/비정수/비유한 포함)을 생성하는 제너레이터.
// normalizeChunkConfig 가 어떤 입력에도 유효 불변식을 보장하는지 검증하기 위해
// 일반 정수/실수에 더해 경계·특이값(0, 음수, 매우 큰 값, NaN, ±Infinity)을 폭넓게 섞는다.
const arbitraryNumber: fc.Arbitrary<number> = fc.oneof(
  // 음수/0/양수를 포괄하는 정수 (경계 부근 포함)
  fc.integer({ min: -1000, max: 1000 }),
  // 매우 큰/작은 정수 (거대값 경로 검증)
  fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
  // 비정수 실수 (NaN/±Infinity 포함) - normalizeChunkConfig 의 유한성 보정 경로 검증
  fc.double({ noNaN: false }),
  // 명시적 특이값 상수
  fc.constantFrom(0, -0, 1, -1, 0.5, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
);

describe("normalizeChunkConfig - Property 25", () => {
  // Feature: graph-rag-knowledge-base, Property 25: 청크 설정 보정은 유효 불변식을 보장한다
  // Validates: Requirements 9.6, 9.7
  it("임의의 maxSize/overlap 입력에 대해 보정 결과는 항상 maxSize >= 1 이고 0 <= overlap < maxSize 를 만족한다", () => {
    fc.assert(
      fc.property(arbitraryNumber, arbitraryNumber, (maxSize, overlap) => {
        const config = normalizeChunkConfig(maxSize, overlap);

        // 불변식 1: maxSize 는 항상 1 이상이며 유한한 수이다 (Req 9.7).
        expect(Number.isFinite(config.maxSize)).toBe(true);
        expect(config.maxSize).toBeGreaterThanOrEqual(1);

        // 불변식 2: overlap 은 항상 0 이상이며 유한한 수이다 (음수 겹침 방지).
        expect(Number.isFinite(config.overlap)).toBe(true);
        expect(config.overlap).toBeGreaterThanOrEqual(0);

        // 불변식 3: overlap 은 항상 maxSize 미만이다 (Req 9.6).
        expect(config.overlap).toBeLessThan(config.maxSize);
      }),
      { numRuns: 100 }
    );
  });
});

// ====================================================
// Task 2.7: 청킹 엣지 예시 기반 단위 테스트
// ----------------------------------------------------
// 속성 테스트(Property 6~9, 25)와 별개로, 구체적 경계/특수 입력에 대한
// 결정적(example-based) 단위 테스트를 추가한다.
// _Requirements: 3.3, 3.4_

/**
 * 청크 배열을 겹침(overlap)을 제거하며 재조립하는 헬퍼.
 * chunker.ts 알고리즘의 역산: chunk[0] + chunk[i].slice(overlap) 이어붙이기.
 */
function reassemble(chunks: string[], overlap: number): string {
  let result = chunks[0];
  for (let i = 1; i < chunks.length; i++) {
    result += chunks[i].slice(overlap);
  }
  return result;
}

describe("splitIntoChunks - 엣지 단위 테스트 (Task 2.7)", () => {
  it("빈 본문은 빈 텍스트 청크 1개를 반환한다 (Req 3.4)", () => {
    const config: ChunkConfig = { maxSize: 10, overlap: 3 };
    const chunks = splitIntoChunks("", config);
    // 빈 본문 → 정확히 청크 1개이며 그 내용은 빈 문자열이다.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("");
  });

  it("본문 길이가 정확히 maxSize 이면 본문 전체를 담은 청크 1개를 반환한다 (Req 3.3)", () => {
    const maxSize = 10;
    const config: ChunkConfig = { maxSize, overlap: 3 };
    // 길이가 정확히 maxSize 인 본문 (경계값).
    const body = "0123456789";
    expect(body.length).toBe(maxSize);

    const chunks = splitIntoChunks(body, config);
    // 경계(=maxSize)에서는 분할되지 않고 단일 청크여야 한다.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(body);
  });

  it("본문 길이가 maxSize+1 이면 2개 청크로 분할되고 무손실 재조립된다 (경계 분기)", () => {
    const maxSize = 10;
    const overlap = 3;
    const config: ChunkConfig = { maxSize, overlap };
    // 길이가 maxSize+1 인 본문 (단일 청크 경계를 막 넘는 최소 길이).
    const body = "0123456789A";
    expect(body.length).toBe(maxSize + 1);

    const chunks = splitIntoChunks(body, config);
    // 경계를 넘으면 정확히 2개 청크로 분할되어야 한다.
    expect(chunks).toHaveLength(2);
    // 모든 청크 길이는 maxSize 이하이다.
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxSize);
    }
    // 첫 청크는 본문 선두 maxSize 문자이다.
    expect(chunks[0]).toBe("0123456789");
    // 겹침 제거 재조립 시 원본이 무손실 복원된다.
    expect(reassemble(chunks, overlap)).toBe(body);
  });

  it("유니코드/특수문자 본문도 청크 길이 <= maxSize 이고 무손실 재조립된다", () => {
    const maxSize = 8;
    const overlap = 2;
    const config: ChunkConfig = { maxSize, overlap };
    // 이모지(서로게이트 쌍, 2 code unit), CJK(한·중·일), 결합 문자(combining mark),
    // 개행/탭/특수기호를 혼합한 본문. JS 문자열은 UTF-16 code unit 단위로 슬라이스되므로
    // 재조립은 code unit 연결로 무손실 복원되어야 한다.
    const body = "😀안녕\u0301한中文\tworld\n!@#字😀é";

    const chunks = splitIntoChunks(body, config);
    // 모든 청크 길이(code unit)는 maxSize 이하이다.
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxSize);
    }
    // 겹침 제거 재조립 시 원본 본문이 문자(code unit) 단위로 정확히 복원된다.
    expect(reassemble(chunks, overlap)).toBe(body);
  });

  it("overlap=0 인 유니코드 본문은 단순 연결로 무손실 복원된다", () => {
    const maxSize = 5;
    const overlap = 0;
    const config: ChunkConfig = { maxSize, overlap };
    // overlap 이 0이면 청크들은 겹침 없이 본문을 분할하므로 단순 연결과 동치이다.
    const body = "🎉가나다🎊ABCあいう😀";

    const chunks = splitIntoChunks(body, config);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxSize);
    }
    // overlap=0 이므로 reassemble 은 단순 연결과 같고, 원본을 무손실 복원한다.
    expect(reassemble(chunks, overlap)).toBe(body);
    expect(chunks.join("")).toBe(body);
  });
});
