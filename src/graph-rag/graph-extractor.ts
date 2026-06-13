// GraphExtractor 모듈
// 옵시디언 metadataCache에서 노트 간 링크(아웃링크/백링크), 태그, 프론트매터를 추출한다.
// 옵시디언 API에 직접 의존하지 않고 MetadataSource 어댑터를 통해 추출하므로
// 테스트 시 모킹이 용이하고, 추출 로직을 순수 함수로 유지할 수 있다.
//
// 관련 요구사항: 1.1, 1.2, 1.3, 1.5, 1.6, 2.1, 2.2, 2.4, 2.5, 2.6, 3.1, 3.3, 3.4
// 관련 속성: Property 1(링크 중복 제거·존재 노트만), 3(태그 # 제거·중복 제거), 4(프론트매터 분리 보존)

/**
 * 단일 노트에서 추출된 메타데이터.
 * - outlinks: 볼트 내 실제 존재하는 노트 경로만, 중복 제거 (Req 1.1, 1.3)
 * - backlinks: 중복 제거 (Req 1.2)
 * - tags: 선행 '#' 제거, 중복 제거, 프론트매터 태그 + 본문 인라인 태그 통합 (Req 2.1)
 * - frontmatter: tags와 분리된 별도 필드, 입력 프론트매터를 그대로 보존 (Req 2.2)
 */
export interface ExtractedMetadata {
  outlinks: string[];
  backlinks: string[];
  tags: string[];
  frontmatter: Record<string, unknown>;
}

/**
 * 메타데이터 추출 소스 어댑터.
 * 옵시디언 app.metadataCache를 감싸는 어댑터(main.ts)가 이 인터페이스를 구현한다.
 */
export interface MetadataSource {
  /** path → (대상 경로 → 링크 수) 형태의 해석된(resolved) 아웃링크 맵 */
  resolvedLinks: Record<string, Record<string, number>>;
  /**
   * 백링크 경로 목록. 어댑터는 비공식 API `getBacklinksForFile()` 대신
   * `resolvedLinks` 역산으로 구현하는 것을 1차 권장한다(타입 안정성·유지보수).
   */
  getBacklinks(path: string): string[];
  /** 노트 캐시 조회. 태그/프론트매터/프론트매터 끝 오프셋을 제공한다. */
  getFileCache(path: string): {
    tags?: string[];
    frontmatter?: Record<string, unknown>;
    /** frontmatter 끝 오프셋. 본문(frontmatter 제외) 추출에 사용 (Req 3 전제) */
    frontmatterEndOffset?: number;
  } | null;
  /** 볼트 내 해당 경로의 노트가 실제 존재하는지 여부 (dangling 판정용) */
  fileExists(path: string): boolean;
}

/** 배열에서 순서를 유지하며 중복을 제거한다. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/** 태그 문자열에서 선행 '#' 기호를 제거하고 좌우 공백을 제거한다. */
function stripTagHash(tag: string): string {
  // 중첩/연속된 '#'(예: "##tag")도 모두 제거하기 위해 선행 '#'들을 일괄 제거한다.
  return tag.replace(/^#+/, "").trim();
}

/**
 * 프론트매터의 tags 필드를 문자열 배열로 정규화한다.
 * - 배열이면 각 요소를 문자열로 변환
 * - 문자열이면 쉼표/공백 기준으로 분리
 * - 그 외 타입은 무시
 */
function normalizeFrontmatterTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string | number => item !== null && item !== undefined)
      .map((item) => String(item));
  }
  if (typeof value === "string") {
    return value.split(/[,\s]+/);
  }
  return [];
}

/**
 * 단일 노트의 메타데이터(아웃링크/백링크/태그/프론트매터)를 추출한다.
 *
 * - 아웃링크: resolvedLinks[path]의 키 목록 → fileExists로 dangling 제외 → 중복 제거 (Req 1.1, 1.3)
 * - 백링크: getBacklinks(path) → 중복 제거 (Req 1.2)
 * - 태그: 프론트매터 tags + 본문 인라인 태그 → '#' 제거 → 중복 제거 (Req 2.1)
 * - 프론트매터: getFileCache().frontmatter를 그대로 보존(없으면 빈 객체) (Req 2.2)
 * - 정보 없음 → 빈 목록/빈 객체 (Req 1.5, 2.4, 2.5)
 * - 추출 중 오류 발생 시 모든 필드를 빈 값으로 반환하고 오류를 기록한다 (Req 1.6, 2.6)
 */
export function extractMetadata(path: string, source: MetadataSource): ExtractedMetadata {
  try {
    // 1) 아웃링크: resolvedLinks에서 추출 후 dangling 제외, 중복 제거
    const linkMap = source.resolvedLinks?.[path] ?? {};
    const rawOutlinks = Object.keys(linkMap);
    const outlinks = dedupe(rawOutlinks.filter((target) => source.fileExists(target)));

    // 2) 백링크: 어댑터에서 받아 중복 제거
    const backlinks = dedupe(source.getBacklinks(path) ?? []);

    // 3) 캐시 조회: 태그·프론트매터
    const cache = source.getFileCache(path);
    const frontmatter: Record<string, unknown> = cache?.frontmatter ?? {};

    // 인라인 태그 + 프론트매터 태그를 통합하고 '#' 제거 후 중복 제거
    const inlineTags = cache?.tags ?? [];
    const frontmatterTags = normalizeFrontmatterTags(frontmatter.tags);
    const tags = dedupe(
      [...inlineTags, ...frontmatterTags]
        .map(stripTagHash)
        .filter((tag) => tag.length > 0)
    );

    return { outlinks, backlinks, tags, frontmatter };
  } catch (error) {
    // 추출 실패 격리: 모든 필드를 빈 값으로 반환하고 오류 기록 (Req 1.6, 2.6)
    console.error(`[GraphExtractor] 메타데이터 추출 실패 (path=${path}):`, error);
    return { outlinks: [], backlinks: [], tags: [], frontmatter: {} };
  }
}

/**
 * 원문에서 frontmatter를 제거한 본문을 반환한다 (Req 3 전제, Chunker 입력 생성용).
 *
 * - getFileCache().frontmatterEndOffset이 있으면 해당 오프셋 이후를 본문으로 사용
 * - 없으면 원문 전체를 본문으로 간주(frontmatter 없는 노트)
 * - 결과가 공백/빈 문자열이어도 그대로 반환(스킵 판단은 호출자 VaultIndexer 책임)
 * - 조회 중 오류가 발생하면 안전하게 원문 전체를 반환한다
 */
export function stripFrontmatter(content: string, source: MetadataSource, path: string): string {
  try {
    const cache = source.getFileCache(path);
    const offset = cache?.frontmatterEndOffset;
    // 유효한 오프셋(0 이상의 숫자)이 있을 때만 본문을 잘라낸다.
    if (typeof offset === "number" && offset >= 0) {
      return content.slice(offset);
    }
    return content;
  } catch (error) {
    // 조회 실패 시 원문 전체를 본문으로 사용(무예외 보장)
    console.error(`[GraphExtractor] frontmatter 분리 실패 (path=${path}):`, error);
    return content;
  }
}
