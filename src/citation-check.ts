// ============================================
// 인용 경로 검증 — 순수 함수
// ============================================
// 시스템 프롬프트는 모델에게 "근거로 쓴 노트 경로를 밝혀라"라고 지시한다. 그런데
// 밝힌 경로가 실제로 존재하는지는 아무도 확인하지 않았다. 모델이 그럴듯한 경로를
// 지어내면 사용자는 클릭해봐야 안다. 지식 기반에서 이건 신뢰를 갉아먹는 실패다.
//
// 이 모듈은 응답 마크다운에서 인용을 추출하고 인덱스와 대조만 한다.
// Vault I/O도 LLM 호출도 하지 않는다.

/** 응답에서 찾아낸 인용 하나. */
export interface Citation {
  /** 원문에 나타난 형태 (사용자에게 그대로 보여주기 위함). */
  raw: string;
  /** 대조에 쓰는 대상 — 헤딩(#)과 별칭(|)을 떼어낸 경로 또는 노트 이름. */
  target: string;
}

/**
 * 펜스 코드블록과 인라인 코드를 같은 길이의 공백으로 치환한다.
 *
 * 모델이 코드 예제 안에 `[[foo]]`나 `path/to.md`를 쓰는 일은 흔하다. 그걸 인용으로
 * 세면 "존재하지 않는 노트" 경고가 쏟아져 경고 자체를 무시하게 된다.
 * 길이를 보존해 치환하므로 이후 인덱스 계산이 원문과 어긋나지 않는다.
 */
export function stripCode(markdown: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, " ");

  // 펜스는 줄 단위로 훑는다. 정규식 하나로 여는 펜스·본문·닫는 펜스를 묶으려 하면
  // /m 플래그의 $가 줄 끝을 뜻해 본문을 건너뛰는 실수가 나기 쉽다.
  let fenceMarker: string | null = null;
  const lines = markdown.split("\n").map((line) => {
    const m = /^[ \t]*(`{3,}|~{3,})/.exec(line);

    if (fenceMarker === null) {
      if (!m) return line;
      fenceMarker = m[1];
      return blank(line);
    }

    // 같은 문자로 시작하고 여는 펜스만큼 긴 줄이 닫는 펜스다.
    if (m && m[1][0] === fenceMarker[0] && m[1].length >= fenceMarker.length) {
      fenceMarker = null;
    }
    return blank(line);
  });
  // 닫히지 않은 펜스는 위 루프에서 문서 끝까지 코드로 처리된다 — 스트리밍이 끊긴
  // 응답에서 뒤쪽 전부가 오탐이 되는 걸 막는다.

  // 인라인 코드. 백틱 개수가 같은 쌍만 묶는다.
  return lines.join("\n").replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, blank);
}

/** `[[target|alias]]`, `[[target#heading]]` → target. 앞뒤 공백 제거. */
function cleanTarget(inner: string): string {
  // 별칭(|)이 먼저, 그 다음 헤딩(#)/블록(^) 앵커를 떼어낸다.
  const noAlias = inner.split("|")[0];
  const noAnchor = noAlias.split("#")[0].split("^")[0];
  return noAnchor.trim();
}

/** URL로 보이는 대상인지. 외부 링크는 볼트 인용이 아니다. */
function looksLikeUrl(target: string): boolean {
  return /^(https?:|obsidian:|file:|mailto:|#)/i.test(target);
}

/**
 * 응답 마크다운에서 볼트 노트 인용을 추출한다.
 *
 * 구분자로 둘러싸인 두 형태만 인식한다:
 *  - `[[노트]]` / `[[폴더/노트|별칭]]` / `[[노트#헤딩]]` — 옵시디언 고유 형태
 *  - `[텍스트](폴더/노트.md)` — 마크다운 링크 중 .md 대상
 *
 * 문장 안의 맨 경로(`근거는 Projects/Agent LLMs.md 입니다`)는 의도적으로 추출하지
 * 않는다. 옵시디언 노트 이름에는 공백이 흔히 들어가므로 어디서 경로가 시작하고
 * 끝나는지 정할 방법이 없다 — 위 예에서 `Projects/Agent`와 `LLMs.md` 중 무엇을
 * 택해도 틀린다. 잘못 자른 경로는 전부 "존재하지 않는 노트" 거짓 경고가 되고,
 * 거짓 경고가 섞이면 진짜 경고까지 무시된다. 구분자가 있는 형태만 다룬다.
 *
 * 같은 대상이 여러 번 인용되면 한 번만 반환한다(대상 기준 중복 제거).
 */
export function extractCitations(markdown: string): Citation[] {
  const text = stripCode(markdown);
  const seen = new Set<string>();
  const out: Citation[] = [];

  const add = (raw: string, target: string): void => {
    if (target === "" || looksLikeUrl(target)) return;
    const key = target.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ raw, target });
  };

  // 1) 위키링크
  for (const m of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    add(m[0], cleanTarget(m[1]));
  }

  // 2) 마크다운 링크 중 .md 대상
  for (const m of text.matchAll(/\[[^\]\n]*\]\(([^)\s]+\.md)(?:\s[^)]*)?\)/gi)) {
    add(m[0], cleanTarget(decodeURIComponent(m[1])));
  }

  return out;
}

/** 경로에서 확장자를 뗀 basename. `a/b/c.md` → `c` */
function basenameNoExt(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "");
}

/**
 * 인용 대상이 볼트에 실재하는지 판정하기 위한 조회 인덱스를 만든다.
 *
 * 옵시디언 위키링크는 보통 전체 경로가 아니라 노트 이름만 쓴다(`[[회의록]]`).
 * 그래서 전체 경로와 basename 두 가지로 모두 찾을 수 있어야 한다.
 * 대소문자는 무시한다 — 옵시디언의 링크 해석도 대소문자를 가리지 않는다.
 */
export function buildCitationIndex(knownPaths: Iterable<string>): {
  paths: Set<string>;
  basenames: Set<string>;
} {
  const paths = new Set<string>();
  const basenames = new Set<string>();

  for (const p of knownPaths) {
    paths.add(p.toLowerCase());
    // 확장자를 뗀 경로로도 찾을 수 있게 둔다 — `[[폴더/노트]]` 형태 때문이다.
    paths.add(p.replace(/\.md$/i, "").toLowerCase());
    basenames.add(basenameNoExt(p).toLowerCase());
  }

  return { paths, basenames };
}

/**
 * 볼트에서 찾을 수 없는 인용만 골라낸다.
 *
 * 인덱스가 비어 있으면(인덱싱 전) 빈 배열을 반환한다. 아직 색인하지 않은 것을
 * "없는 노트"라고 경고하면 전부 거짓 경고가 된다.
 */
export function findUnresolvedCitations(
  citations: Citation[],
  knownPaths: Iterable<string>
): Citation[] {
  const index = buildCitationIndex(knownPaths);
  if (index.paths.size === 0) return [];

  return citations.filter((c) => {
    const t = c.target.toLowerCase();
    if (index.paths.has(t)) return false;
    if (index.basenames.has(basenameNoExt(c.target).toLowerCase())) return false;
    return true;
  });
}
