// GraphExtractor 속성/단위 테스트
// 옵시디언 metadataCache 추출 로직(extractMetadata, stripFrontmatter)을 검증한다.
// 이 파일은 task 3.2~3.5에서 공유되며, 본 커밋에는 Property 1 테스트를 포함한다.

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";

import {
  extractMetadata,
  stripFrontmatter,
  MetadataSource,
} from "./graph-extractor";

/**
 * 생성된 데이터로부터 모킹된 MetadataSource를 구성하는 헬퍼.
 * - resolvedLinks: 대상 노트(중복 가능) 목록을 {대상: 링크수} 맵으로 변환
 * - existingFiles: fileExists 판정에 사용되는 실제 존재 노트 집합
 * - backlinks: getBacklinks가 반환할 (중복 가능) 백링크 목록
 */
function buildMockSource(params: {
  path: string;
  outlinkTargets: string[];
  existingFiles: Set<string>;
  backlinks: string[];
}): MetadataSource {
  const { path, outlinkTargets, existingFiles, backlinks } = params;

  // 동일 대상이 여러 번 등장해도 resolvedLinks는 {대상: 누적 링크수} 형태이므로
  // 카운트를 누적하여 옵시디언의 실제 자료구조를 모사한다.
  const linkMap: Record<string, number> = {};
  for (const target of outlinkTargets) {
    linkMap[target] = (linkMap[target] ?? 0) + 1;
  }

  return {
    resolvedLinks: { [path]: linkMap },
    getBacklinks: (p: string): string[] => (p === path ? backlinks : []),
    getFileCache: () => null,
    fileExists: (p: string): boolean => existingFiles.has(p),
  };
}

describe("graph-extractor: extractMetadata", () => {
  // Feature: graph-rag-knowledge-base, Property 1: 링크 추출은 중복이 없고 존재하는 노트만 포함한다
  // Validates: Requirements 1.1, 1.2, 1.3, 1.5
  it("Property 1: outlinks는 중복 없이 존재하는 노트만 포함하고, backlinks도 중복이 없다", () => {
    // 노트 경로 생성기: 비어 있지 않은 짧은 문자열
    const pathArb = fc.string({ minLength: 1, maxLength: 8 });

    fc.assert(
      fc.property(
        pathArb, // 추출 대상 노트 경로
        fc.array(pathArb), // 아웃링크 대상(중복 포함 가능)
        fc.array(pathArb), // 볼트 내 존재하는 노트 후보
        fc.array(pathArb), // 백링크 목록(중복 포함 가능)
        (path, outlinkTargets, existingList, backlinks) => {
          const existingFiles = new Set(existingList);
          const source = buildMockSource({
            path,
            outlinkTargets,
            existingFiles,
            backlinks,
          });

          const result = extractMetadata(path, source);

          // 1) outlinks 중복 없음 (Req 1.1, 1.3)
          expect(new Set(result.outlinks).size).toBe(result.outlinks.length);

          // 2) 모든 outlink는 볼트 내 실제 존재하는 노트를 가리킨다 (Req 1.3)
          for (const link of result.outlinks) {
            expect(existingFiles.has(link)).toBe(true);
          }

          // 3) 존재하는 대상은 누락 없이 outlinks에 포함된다 (Req 1.1, 1.5)
          const expectedOutlinks = new Set(
            outlinkTargets.filter((t) => existingFiles.has(t))
          );
          expect(new Set(result.outlinks)).toEqual(expectedOutlinks);

          // 4) backlinks 중복 없음 (Req 1.2)
          expect(new Set(result.backlinks).size).toBe(result.backlinks.length);

          // 5) backlinks는 입력 백링크 집합과 동일한 원소 집합을 보존한다 (Req 1.2, 1.5)
          expect(new Set(result.backlinks)).toEqual(new Set(backlinks));
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: graph-rag-knowledge-base, Property 3: 태그 추출은 # 기호를 제거하고 중복을 제거한다
  // Validates: Requirements 2.1, 2.4
  it("Property 3: tags는 선행 '#'가 제거되고 중복이 없다", () => {
    // 동일 베이스에서 '#' 접두사만 다른 태그가 생성되도록 하여
    // (예: "todo", "#todo", "##todo") 중복 제거 로직을 집중적으로 검증한다.
    const baseTagArb = fc.constantFrom("project", "idea", "todo", "work", "note");
    const hashPrefixArb = fc.constantFrom("", "#", "##", "###");
    const tagArb = fc
      .tuple(hashPrefixArb, baseTagArb)
      .map(([hash, base]) => hash + base);

    // 테스트 내에서 구현과 동일한 방식으로 기대값을 계산하기 위한 strip 헬퍼.
    const strip = (tag: string): string => tag.replace(/^#+/, "").trim();

    fc.assert(
      fc.property(
        fc.array(tagArb), // 본문 인라인 태그(중복/'#' 포함 가능)
        fc.array(tagArb), // 프론트매터 tags(중복/'#' 포함 가능)
        (inlineTags, frontmatterTags) => {
          // getFileCache가 생성된 태그를 반환하는 모킹 소스 구성.
          // 링크 관련 필드는 본 속성과 무관하므로 비워 둔다.
          const source: MetadataSource = {
            resolvedLinks: {},
            getBacklinks: (): string[] => [],
            getFileCache: () => ({
              tags: inlineTags,
              frontmatter: { tags: frontmatterTags },
            }),
            fileExists: (): boolean => false,
          };

          const result = extractMetadata("note.md", source);

          // 1) 어떤 태그도 '#'로 시작하지 않는다 (Req 2.1)
          for (const tag of result.tags) {
            expect(tag.startsWith("#")).toBe(false);
          }

          // 2) 태그에 중복이 없다 (Req 2.1)
          expect(new Set(result.tags).size).toBe(result.tags.length);

          // 3) 입력 태그 집합(인라인 + 프론트매터)을 '#' 제거·공백 제거 후
          //    비어 있지 않은 것만 모은 집합과 결과 집합이 정확히 일치한다 (Req 2.1, 2.4)
          const expected = new Set(
            [...inlineTags, ...frontmatterTags]
              .map(strip)
              .filter((tag) => tag.length > 0)
          );
          expect(new Set(result.tags)).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: graph-rag-knowledge-base, Property 4: 프론트매터는 태그와 분리된 별도 필드로 보존된다
  // Validates: Requirements 2.2, 2.5
  it("Property 4: frontmatter는 입력값 그대로 보존되며 tags와 분리된 별도 필드다", () => {
    // 임의의 프론트매터 객체 생성기.
    // fc.object로 중첩/다양한 타입을 포함하는 프론트매터를 생성하여
    // 추출 결과가 입력 프론트매터를 변형 없이 보존하는지 검증한다.
    const frontmatterArb = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 6 }),
      fc.oneof(
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.array(fc.string()),
        fc.object()
      )
    );

    fc.assert(
      fc.property(frontmatterArb, (frontmatter) => {
        // getFileCache가 생성된 프론트매터를 반환하는 모킹 소스 구성.
        const source: MetadataSource = {
          resolvedLinks: {},
          getBacklinks: (): string[] => [],
          getFileCache: () => ({ frontmatter }),
          fileExists: (): boolean => false,
        };

        const result = extractMetadata("note.md", source);

        // 1) frontmatter는 입력값과 deep-equal하게 보존된다 (Req 2.2)
        expect(result.frontmatter).toEqual(frontmatter);

        // 2) tags는 frontmatter와 분리된 별도 배열 필드다 (Req 2.2, 2.5)
        expect(Array.isArray(result.tags)).toBe(true);
        expect(result.tags).not.toBe(result.frontmatter);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: graph-rag-knowledge-base, Property 4: 프론트매터는 태그와 분리된 별도 필드로 보존된다
  // Validates: Requirements 2.2, 2.5
  it("Property 4: 프론트매터가 없는 노트의 frontmatter는 빈 객체({})다", () => {
    fc.assert(
      // 캐시 자체가 null인 경우와 frontmatter 필드만 없는 경우를 모두 검증한다.
      fc.property(fc.boolean(), (cacheIsNull) => {
        const source: MetadataSource = {
          resolvedLinks: {},
          getBacklinks: (): string[] => [],
          getFileCache: () => (cacheIsNull ? null : { tags: [] }),
          fileExists: (): boolean => false,
        };

        const result = extractMetadata("note.md", source);

        // 프론트매터 정보가 없으면 빈 객체로 보존된다 (Req 2.5)
        expect(result.frontmatter).toEqual({});
      }),
      { numRuns: 100 }
    );
  });
});

// task 3.5: 추출 오류 격리 단위 테스트
// throw하는 MetadataSource에 대해 extractMetadata가 빈 값을 반환하고
// 오류 로그(console.error)를 남기는지 예시 기반(unit)으로 검증한다.
// Validates: Requirements 1.6, 2.6
describe("graph-extractor: extractMetadata 추출 오류 격리", () => {
  // 모든 필드가 빈 값인 기대 결과(추출 실패 시 안전한 기본값)
  const EMPTY_RESULT = {
    outlinks: [],
    backlinks: [],
    tags: [],
    frontmatter: {},
  };

  // 각 테스트마다 console.error를 spy로 가로채고, 끝나면 원복한다.
  let errorSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    // 다른 테스트/콘솔 출력에 영향을 주지 않도록 spy를 반드시 복원한다.
    errorSpy?.mockRestore();
  });

  // 케이스 1: 링크 추출 단계에서 getBacklinks가 throw (Req 1.6)
  it("getBacklinks가 throw하면 빈 값을 반환하고 오류를 기록한다 (Req 1.6)", () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const source: MetadataSource = {
      resolvedLinks: { "note.md": { "target.md": 1 } },
      // 백링크 조회 시 예외 발생 → 링크 추출 중 오류
      getBacklinks: (): string[] => {
        throw new Error("getBacklinks 실패");
      },
      getFileCache: () => ({ tags: ["#todo"], frontmatter: { title: "t" } }),
      fileExists: (): boolean => true,
    };

    const result = extractMetadata("note.md", source);

    // 모든 필드가 빈 값으로 반환된다 (격리)
    expect(result).toEqual(EMPTY_RESULT);
    // 오류가 기록된다
    expect(errorSpy).toHaveBeenCalled();
  });

  // 케이스 2: 링크 추출 단계에서 resolvedLinks 접근이 throw (Req 1.6)
  it("resolvedLinks 접근(getter)이 throw하면 빈 값을 반환하고 오류를 기록한다 (Req 1.6)", () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // resolvedLinks를 getter로 정의하여 접근 시 예외가 발생하도록 한다.
    const source = {
      get resolvedLinks(): Record<string, Record<string, number>> {
        throw new Error("resolvedLinks 접근 실패");
      },
      getBacklinks: (): string[] => [],
      getFileCache: () => null,
      fileExists: (): boolean => true,
    } as MetadataSource;

    const result = extractMetadata("note.md", source);

    expect(result).toEqual(EMPTY_RESULT);
    expect(errorSpy).toHaveBeenCalled();
  });

  // 케이스 3: 태그/프론트매터 추출 단계에서 getFileCache가 throw (Req 2.6)
  it("getFileCache가 throw하면 빈 값을 반환하고 오류를 기록한다 (Req 2.6)", () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const source: MetadataSource = {
      resolvedLinks: { "note.md": { "target.md": 1 } },
      getBacklinks: (): string[] => ["other.md"],
      // 캐시 조회 시 예외 발생 → 태그/프론트매터 추출 중 오류
      getFileCache: () => {
        throw new Error("getFileCache 실패");
      },
      fileExists: (): boolean => true,
    };

    const result = extractMetadata("note.md", source);

    expect(result).toEqual(EMPTY_RESULT);
    expect(errorSpy).toHaveBeenCalled();
  });

  // 케이스 4: dangling 판정(fileExists)이 throw해도 격리된다 (Req 1.6)
  it("fileExists가 throw하면 빈 값을 반환하고 오류를 기록한다 (Req 1.6)", () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const source: MetadataSource = {
      resolvedLinks: { "note.md": { "target.md": 1 } },
      getBacklinks: (): string[] => [],
      getFileCache: () => null,
      // 존재 여부 판정 중 예외 발생 → 아웃링크 필터링 중 오류
      fileExists: (): boolean => {
        throw new Error("fileExists 실패");
      },
    };

    const result = extractMetadata("note.md", source);

    expect(result).toEqual(EMPTY_RESULT);
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ============================================
// 프론트매터 경계는 원문에서 계산한다
// ============================================
/**
 * 캐시의 `frontmatterEndOffset`을 쓰면 프론트매터를 방금 고친 직후(processFrontMatter로
 * aliases 추가 등) 낡은 오프셋으로 잘라 YAML이 본문 청크와 발췌에 들어간다. 그 상태가
 * 최신 mtime과 함께 굳으면 디바운스 재색인도 건너뛰어 영구히 남는다.
 */
describe("stripFrontmatter — 원문 기반 경계", () => {
  /** 낡은(또는 없는) 오프셋을 돌려주는 캐시. */
  function staleSource(offset?: number): MetadataSource {
    return {
      resolvedLinks: {},
      getBacklinks: () => [],
      getFileCache: () => (offset === undefined ? null : { frontmatterEndOffset: offset }),
      fileExists: () => true,
    } as unknown as MetadataSource;
  }

  it("캐시 오프셋이 낡아도 YAML을 본문에 남기지 않는다", () => {
    const content = "---\naliases:\n  - 새 별칭\nlearned_at: 2026-09-03\n---\n\n# 노트\n본문\n";
    // 캐시는 aliases 추가 이전의 짧은 오프셋을 갖고 있다.
    const body = stripFrontmatter(content, staleSource(20), "a.md");

    expect(body).not.toContain("aliases");
    expect(body).not.toContain("learned_at");
    expect(body).toContain("# 노트");
  });

  it("프론트매터가 없으면 원문 전체가 본문이다", () => {
    const content = "# 노트\n본문\n";
    expect(stripFrontmatter(content, staleSource(), "a.md")).toBe(content);
  });

  it("닫는 구분자가 없으면(손상된 YAML) 원문 전체를 본문으로 본다", () => {
    const content = "---\naliases: x\n# 노트\n";
    expect(stripFrontmatter(content, staleSource(), "a.md")).toBe(content);
  });

  it("본문에 나오는 --- 는 경계로 보지 않는다", () => {
    // 여는 줄이 문서 첫 줄이 아니면 프론트매터가 아니다.
    const content = "# 노트\n\n---\n\n구분선 아래 본문\n";
    expect(stripFrontmatter(content, staleSource(), "a.md")).toBe(content);
  });

  it("CRLF 줄바꿈도 처리한다", () => {
    const content = "---\r\ntitle: x\r\n---\r\n\r\n# 노트\r\n";
    const body = stripFrontmatter(content, staleSource(), "a.md");
    expect(body).not.toContain("title: x");
    expect(body).toContain("# 노트");
  });

  it("빈 프론트매터도 벗긴다", () => {
    const content = "---\n---\n\n# 노트\n";
    expect(stripFrontmatter(content, staleSource(), "a.md")).toContain("# 노트");
    expect(stripFrontmatter(content, staleSource(), "a.md").startsWith("---")).toBe(false);
  });
});

// ============================================
// Property: stripFrontmatter
// ============================================
/**
 * 경계를 원문에서 계산하도록 바꿨으므로, 어떤 입력에도 지켜져야 하는 성질을 못박는다.
 * 특히 "YAML이 본문에 새지 않는다"가 이번 수정의 목적이다.
 */
/** 캐시가 아예 없는 소스. 원문 계산만 검증한다. */
const noCacheSource = {
  resolvedLinks: {},
  getBacklinks: () => [],
  getFileCache: () => null,
  fileExists: () => true,
} as unknown as MetadataSource;

describe("Property: stripFrontmatter", () => {
  const line = fc.stringMatching(/^[가-힣A-Za-z0-9 :#-]{0,20}$/);

  it("결과는 항상 원문의 접미사다", () => {
    fc.assert(
      fc.property(fc.array(line, { maxLength: 8 }), (lines) => {
        const content = lines.join("\n");
        const body = stripFrontmatter(content, noCacheSource, "a.md");
        expect(content.endsWith(body)).toBe(true);
      }),
      { numRuns: 400 }
    );
  });

  it("프론트매터가 있으면 결과에 YAML 키가 남지 않는다", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z_]{1,8}: [가-힣A-Za-z0-9 ]{1,10}$/), { minLength: 1, maxLength: 5 }),
        fc.array(line, { maxLength: 5 }),
        (fmLines, bodyLines) => {
          const content = `---\n${fmLines.join("\n")}\n---\n${bodyLines.join("\n")}`;
          const body = stripFrontmatter(content, noCacheSource, "a.md");
          for (const fmLine of fmLines) expect(body).not.toContain(fmLine);
        }
      ),
      { numRuns: 400 }
    );
  });


});
