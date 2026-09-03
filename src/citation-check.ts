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
  /**
   * 인용에 붙은 헤딩 앵커(`[[노트#헤딩]]`의 헤딩). 없으면 생략된다.
   *
   * 인덱스에 헤딩 정보가 있으면 이것까지 검증한다 — 존재하는 노트의 존재하지 않는
   * 절을 인용하는 것도 사용자를 헛걸음시키는 실패다.
   */
  anchor?: string;
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

    // 같은 문자로 시작하고 여는 펜스만큼 길며 **뒤에 공백만 있는** 줄이 닫는 펜스다.
    // CommonMark 규약이다. 뒤에 문자가 붙은 줄(코드 안의 ```json 등)을 닫는 펜스로
    // 처리하면 그 뒤 코드의 위키링크가 실제 인용으로 오인된다.
    const closes =
      m !== null &&
      m[1][0] === fenceMarker[0] &&
      m[1].length >= fenceMarker.length &&
      line.slice(line.indexOf(m[1]) + m[1].length).trim() === "";
    if (closes) fenceMarker = null;
    return blank(line);
  });
  // 닫히지 않은 펜스는 위 루프에서 문서 끝까지 코드로 처리된다 — 스트리밍이 끊긴
  // 응답에서 뒤쪽 전부가 오탐이 되는 걸 막는다.

  // 인라인 코드. 더 긴 백틱 묶음의 일부를 닫는 기호로 쓰지 않고 정확히 같은 길이만 찾는다.
  const text = lines.join("\n");
  let output = "";
  let cursor = 0;

  for (let i = 0; i < text.length; ) {
    if (text[i] !== "`") {
      i++;
      continue;
    }

    const open = i;
    while (i < text.length && text[i] === "`") i++;
    const markerLength = i - open;
    let searchAt = i;
    let close = -1;

    while (searchAt < text.length) {
      const runStart = text.indexOf("`", searchAt);
      if (runStart === -1) break;
      let runEnd = runStart;
      while (runEnd < text.length && text[runEnd] === "`") runEnd++;
      if (runEnd - runStart === markerLength) {
        close = runEnd;
        break;
      }
      searchAt = runEnd;
    }

    if (close === -1) continue;
    output += text.slice(cursor, open) + blank(text.slice(open, close));
    cursor = close;
    i = close;
  }

  return output + text.slice(cursor);
}

/**
 * `[[target|alias]]`, `[[target#heading]]` → { target, anchor }.
 *
 * 블록 참조(`^blockId`)는 앵커로 보지 않는다 — 블록 ID는 인덱스에 없어 검증할 수 없고,
 * 검증할 수 없는 것을 경고하면 거짓 경고가 된다.
 */
function splitTarget(inner: string): { target: string; anchor?: string } {
  // 별칭(|)을 먼저 떼어낸다.
  const noAlias = inner.split("|")[0];
  // 블록 참조가 있으면 그 앞까지만 본다.
  //
  // 캐럿 위치를 가리지 않는 이유: 옵시디언은 **파일명에 `^`를 금지한다.** 그래서
  // `[[노트^id]]`는 파일명의 일부가 아니라 (구분자 `#`를 빠뜨린) 블록 참조다. 그 링크는
  // 옵시디언에서도 열리지 않으므로 `노트`를 대상으로 보고 판정하는 것이 맞다.
  const noBlock = noAlias.split("^")[0];

  const hashAt = noBlock.indexOf("#");
  if (hashAt === -1) return { target: noBlock.trim() };

  const target = noBlock.slice(0, hashAt).trim();
  const anchor = noBlock.slice(hashAt + 1).trim();
  return anchor === "" ? { target } : { target, anchor };
}

/**
 * URL로 보이는 대상인지. 외부 링크는 볼트 인용이 아니다.
 *
 * 스킴을 열거하지 않는다 — `ftp:`나 사용자 정의 스킴처럼 목록에 없는 것이 `.md`로 끝나면
 * 볼트 인용으로 오인되어 거짓 경고가 된다. 일반 URI 스킴 패턴과 프로토콜 상대 URL(`//host`),
 * 그리고 같은 노트 내 앵커(`#절`)를 함께 본다. 볼트 경로는 스킴을 가질 수 없다.
 */
function looksLikeUrl(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("#");
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
/**
 * 이미 분리된 경로·앵커를 각각 디코딩해 인용으로 만든다.
 *
 * 합쳐서 `splitTarget`에 넘기면 안 된다 — 디코딩으로 생긴 `#`(`%23`)를 앵커 구분자로
 * 오인한다. 마크다운 링크에서 앵커는 정규식이 이미 나눠 놓았다.
 */
function decodedCitation(
  rawPath: string,
  rawAnchor: string | undefined
): { target: string; anchor?: string } {
  const target = safeDecode(rawPath).trim();
  if (rawAnchor === undefined) return { target };

  const anchor = safeDecode(rawAnchor.replace(/^#/, "")).trim();
  return anchor === "" ? { target } : { target, anchor };
}

/**
 * URI 디코딩. 실패하면 원문을 그대로 쓴다.
 *
 * `decodeURIComponent`는 `%ZZ`처럼 잘못된 이스케이프에 URIError를 던진다. 그대로 두면
 * 호출부의 try/catch가 검증 **전체**를 포기해서, 같은 응답의 다른 깨진 인용도 경고되지
 * 않는다 — 인용 하나의 형식 오류가 검증 기능을 끄는 셈이다.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 파일 확장자로 볼 수 있는 형태. 글자로 시작하는 1~5자 영숫자다.
 *
 * 점이 든 노트 이름을 확장자로 오인하지 않기 위한 제한이다 — `Release 1.2`의 `.2`를
 * 확장자로 보면 그 노트에 대한 임베드가 검증에서 빠진다.
 */
const FILE_EXTENSION = /^\.[a-z][a-z0-9]{0,4}$/i;

/**
 * 대상이 마크다운이 아닌 파일을 가리키는지.
 *
 * 확장자가 있고 그것이 `.md`가 아니면 첨부 파일로 본다. 확장자가 없으면 노트다 —
 * 옵시디언 위키링크는 보통 확장자를 생략한다.
 */
function isNonMarkdownFile(target: string): boolean {
  const base = target.split("/").pop() ?? target;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;

  const ext = base.slice(dot);
  if (!FILE_EXTENSION.test(ext)) return false;
  return ext.toLowerCase() !== ".md";
}

export function extractCitations(markdown: string): Citation[] {
  const text = stripCode(markdown);
  const seen = new Set<string>();
  const out: Citation[] = [];

  const add = (raw: string, parsed: { target: string; anchor?: string }): void => {
    const { target, anchor } = parsed;
    if (target === "" || looksLikeUrl(target)) return;
    // 앵커가 다르면 다른 인용으로 센다 — 같은 노트의 다른 절을 각각 검증해야 한다.
    const key = `${target.toLowerCase()}#${(anchor ?? "").toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ raw, target, ...(anchor !== undefined ? { anchor } : {}) });
  };

  // 1) 위키링크
  //
  // 내부에 `[`를 허용하지 않는다. 허용하면 `[[[[노트]]` 같은 입력에서 첫 `[[`부터
  // 매칭돼 대상이 `[[노트`가 되고, 그 대상은 인덱스에서 찾을 수 없어 거짓 경고가 된다.
  // 배제하면 정규식이 안쪽 `[[`부터 다시 매칭해 올바른 대상을 얻는다.
  //
  // 앞에 `!`가 붙은 임베드에서 **비마크다운 파일**은 건너뛴다. `![[Images/chart.png]]`는
  // 노트 인용이 아니라 첨부 임베드인데, 존재 판정은 마크다운 파일 목록으로만 하므로
  // 실제로 그 이미지가 있어도 항상 거짓 경고가 된다.
  for (const m of text.matchAll(/(!?)\[\[([^[\]\n]+)\]\]/g)) {
    const isEmbed = m[1] === "!";
    const citation = splitTarget(m[2]);
    if (isEmbed && isNonMarkdownFile(citation.target)) continue;
    add(m[0], citation);
  }

  // 2) 마크다운 링크 중 .md 대상. 헤딩 앵커(`Note.md#절`)까지 받는다 —
  //    받지 않으면 그 형태로 존재하지 않는 노트·절을 인용해도 검증되지 않는다.
  //
  //    **경로와 앵커는 디코딩 전에 나뉘어 있다.** 합쳐서 디코딩한 뒤 다시 `#`로 쪼개면
  //    `Notes/foo%23bar.md`가 `Notes/foo` + 앵커 `bar.md`로 오인되어, 실재하는 파일에
  //    깨진 인용 경고가 붙는다.
  for (const m of text.matchAll(/\[[^\]\n]*\]\(([^)\s#]+\.md)(#[^)\s]*)?(?:\s[^)]*)?\)/gi)) {
    add(m[0], decodedCitation(m[1], m[2]));
  }

  // 3) 꺾쇠로 감싼 목적지 — `[근거](<Projects/Fake Note.md>)`.
  //    공백이 든 경로를 쓰는 표준 형태다. 받지 않으면 그 형태의 지어낸 인용이 검증에서 빠진다.
  for (const m of text.matchAll(/\[[^\]\n]*\]\(<([^<>\n]+\.md)(#[^<>\n]*)?>\)/gi)) {
    add(m[0], decodedCitation(m[1], m[2]));
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
 * 인용 대상이 실재하는 노트를 가리키는지 판정한다 — **옵시디언의 해석 규칙을 따른다.**
 *
 *  - 전체 경로 일치(확장자는 있어도 없어도 된다)
 *  - 폴더가 붙은 대상은 **경로 접미사** 일치도 인정한다. 볼트에 `Archive/Projects/Note.md`가
 *    있으면 옵시디언에서 `[[Projects/Note]]`는 유효한 링크다. 전체 경로만 요구하면 실제로
 *    열리는 인용에 거짓 경고가 붙는다.
 *  - 접미사는 **세그먼트 경계**에서만 맞아야 한다. 그러지 않으면 `[[ojects/Note]]`도 통과한다.
 *  - 이름만 쓴 대상은 볼트 어디서든 찾는다(옵시디언과 같다).
 *
 * 폴더가 틀린 대상(`[[Wrong/Agent LLMs]]`)은 여전히 걸린다 — `Wrong/Agent LLMs`는
 * `Projects/Agent LLMs`의 접미사가 아니다.
 */
function resolvesToNote(
  target: string,
  index: { paths: Set<string>; basenames: Set<string> }
): boolean {
  const lower = target.toLowerCase();
  if (index.paths.has(lower)) return true;

  if (target.includes("/")) {
    const needle = `/${lower.replace(/\.md$/i, "")}`;
    for (const known of index.paths) {
      if (known.endsWith(needle)) return true;
    }
    return false;
  }

  return index.basenames.has(basenameNoExt(target).toLowerCase());
}

/**
 * 인용 대상이 이 경로의 노트를 가리키는지 — `resolvesToNote`와 **같은 규칙**이다.
 *
 * 헤딩 인덱스에 넣을 파일을 고르는 쪽이 쓴다. 존재 판정과 규칙이 갈라지면 접미사로 맞은
 * 노트가 헤딩 인덱스에 빠져 지어낸 절을 놓친다.
 *
 * @param citedTarget 소문자화된 인용 대상
 * @param path 볼트 파일 경로
 */
export function citationMatchesPath(citedTarget: string, path: string): boolean {
  const lowerPath = path.toLowerCase();
  const noExt = lowerPath.replace(/\.md$/i, "");
  const target = citedTarget.replace(/\.md$/i, "");

  if (target === lowerPath || target === noExt) return true;
  if (citedTarget.includes("/")) return noExt.endsWith(`/${target}`);
  return basenameNoExt(lowerPath) === target;
}

/**
 * 인용의 헤딩 앵커가 그 노트에 실재하는지 판정한다.
 *
 * 헤딩 정보가 없는 노트(스키마 v1 인덱스, 헤딩 없는 노트)는 통과시킨다 — 확인할 수
 * 없는 것을 "없다"고 경고하면 거짓 경고가 되고, 거짓이 섞이면 진짜 경고까지 무시된다.
 */
function resolvesAnchor(
  citation: Citation,
  headingsByNote: Map<string, Set<string>>
): boolean {
  if (citation.anchor === undefined) return true;
  if (headingsByNote.size === 0) return true;

  // 인용 대상을 찾을 키. **폴더가 붙은 대상은 경로로만 찾는다** — basename으로 폴백하면
  // `A/Topic`과 `B/Topic`이 같은 basename 키를 공유해서, B에만 있는 헤딩이
  // `[[A/Topic#...]]`을 통과시킨다.
  const target = citation.target.toLowerCase();
  const keys = target.includes("/")
    ? [target, target.replace(/\.md$/i, ""), ...suffixKeys(target, headingsByNote)]
    : [target, basenameNoExt(citation.target).toLowerCase()];
  for (const key of keys) {
    const headings = headingsByNote.get(key);
    if (headings === undefined) continue;
    // 헤딩을 하나도 모르는 노트는 판정 불가 → 통과.
    if (headings.size === 0) return true;
    if (headings.has(citation.anchor.toLowerCase())) return true;
    return false;
  }
  // 헤딩 정보가 없는 노트다 → 판정 불가 → 통과.
  return true;
}

/**
 * 인용 대상이 경로 접미사로 맞는 헤딩 인덱스 키들.
 *
 * 존재 판정은 접미사를 인정하는데(옵시디언이 그렇게 해석한다) 앵커 판정이 정확 키만 보면,
 * `Archive/Projects/Note.md`에 대한 `[[Projects/Note#없는 절]]`이 "헤딩 정보 없음 → 통과"로
 * 빠져나간다. 같은 규칙을 여기서도 적용한다.
 */
function suffixKeys(
  lowerTarget: string,
  headingsByNote: Map<string, Set<string>>
): string[] {
  const needle = `/${lowerTarget.replace(/\.md$/i, "")}`;
  const out: string[] = [];
  for (const key of headingsByNote.keys()) {
    if (key.endsWith(needle)) out.push(key);
  }
  return out;
}

/**
 * 노트별 헤딩 집합 조회표를 만든다. 전체 경로와 basename 두 키로 모두 찾을 수 있다.
 *
 * @param entries `[노트 경로, 그 노트의 헤딩 목록]` 쌍. 스키마 v2 인덱스의 청크에서 모은다.
 */
export function buildHeadingIndex(
  entries: Iterable<[string, Iterable<string>]>
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();

  for (const [path, headings] of entries) {
    const set = new Set<string>();
    for (const h of headings) {
      const normalized = h.trim().toLowerCase();
      if (normalized !== "") set.add(normalized);
    }
    // 확장자 있는 경로 / 뗀 경로 / basename 세 가지로 찾을 수 있게 둔다. 인용은
    // `[[폴더/노트]]`처럼 확장자를 생략하는 형태가 대부분이다.
    for (const key of [
      path.toLowerCase(),
      path.replace(/\.md$/i, "").toLowerCase(),
      basenameNoExt(path).toLowerCase(),
    ]) {
      const existing = out.get(key);
      if (existing) for (const h of set) existing.add(h);
      else out.set(key, new Set(set));
    }
  }

  return out;
}

/**
 * 볼트에서 찾을 수 없는 인용만 골라낸다.
 *
 * 인덱스가 비어 있으면(인덱싱 전) 빈 배열을 반환한다. 아직 색인하지 않은 것을
 * "없는 노트"라고 경고하면 전부 거짓 경고가 된다.
 *
 * @param headingsByNote 노트별 헤딩 집합(buildHeadingIndex 결과). 주면 `[[노트#헤딩]]`의
 *   앵커까지 검증한다 — 존재하는 노트의 존재하지 않는 절을 인용하는 것도 사용자를
 *   헛걸음시키는 실패다. 생략하면 노트 존재만 본다.
 */
export function findUnresolvedCitations(
  citations: Citation[],
  knownPaths: Iterable<string>,
  headingsByNote: Map<string, Set<string>> = new Map()
): Citation[] {
  const index = buildCitationIndex(knownPaths);
  if (index.paths.size === 0) return [];

  return citations.filter((c) => {
    if (!resolvesToNote(c.target, index)) return true;
    return !resolvesAnchor(c, headingsByNote);
  });
}
