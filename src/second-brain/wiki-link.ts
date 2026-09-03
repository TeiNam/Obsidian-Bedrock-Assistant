// ============================================
// 노트 링크 표기 — 순수 함수
// ============================================
// 위키링크 문법에서 `#`와 `|`는 구조 문자다. 경로에 그 문자가 들어 있으면 링크가 다른 것을
// 가리킨다 — `[[Notes/foo#bar]]`는 `Notes/foo`의 `bar` 절이고, `|` 뒤는 별칭이 된다.
// 옵시디언에는 위키링크 안에서 이 문자를 이스케이프하는 방법이 없다.
//
// 생성 블록에 링크를 쓰는 곳이 여러 곳(링크 제안·중복 후보·지식 공백·위키 인덱스)이라
// 각자 문자열을 보간하면 한 곳만 고치고 나머지는 계속 깨진 링크를 쓴다. 여기서 한 번 정한다.

/** 위키링크로 쓸 수 없는 문자. 있으면 마크다운 링크로 물러난다. */
const UNSAFE_IN_WIKILINK = /[#|]/;

/** 확장자를 뗀 경로. 링크 대상으로 쓴다. */
export function pathWithoutExtension(path: string): string {
  return path.replace(/\.md$/i, "");
}

/**
 * 노트 하나를 가리키는 링크 표기.
 *
 * 경로가 안전하면 위키링크, 아니면 퍼센트 인코딩한 마크다운 링크를 쓴다. 옵시디언은 두
 * 형태를 모두 해석한다.
 *
 * @param target 확장자를 뗀 경로
 * @param alias 표시 이름. 비었거나 대상과 같으면 표기를 늘리지 않는다.
 */
export function formatNoteLink(target: string, alias = ""): string {
  const trimmedAlias = alias.trim();

  if (UNSAFE_IN_WIKILINK.test(target)) {
    const label = sanitizeLabel(trimmedAlias === "" ? target : trimmedAlias);
    return `[${label}](${encodeLinkPath(target)}.md)`;
  }

  return trimmedAlias === "" || trimmedAlias === target
    ? `[[${target}]]`
    : `[[${target}|${trimmedAlias}]]`;
}

/**
 * 노트의 특정 절을 가리키는 링크 표기. 앵커를 쓸 수 없으면 null.
 *
 * 헤딩에 `#`나 `|`가 있으면 앵커 자체가 성립하지 않는다(마크다운 링크의 프래그먼트도
 * 옵시디언이 헤딩으로 되찾지 못한다). 호출부가 노트 단위 인용으로 물러나게 null을 준다.
 *
 * @param target 확장자를 뗀 경로
 * @param heading 절 제목
 */
export function formatAnchorLink(target: string, heading: string): string | null {
  if (heading.trim() === "") return null;
  if (UNSAFE_IN_WIKILINK.test(heading)) return null;
  if (UNSAFE_IN_WIKILINK.test(target)) return null;
  return `[[${target}#${heading}]]`;
}

/**
 * 마크다운 링크의 목적지에 쓸 수 있게 인코딩한다. 경로 구분자(`/`)는 남긴다.
 *
 * 문자를 골라 치환하면 안 된다 — 파일명에 리터럴 `%`가 있으면(`a%20b.md`) `%`가 그대로
 * 남아 해석 시 공백으로 디코딩되어 다른 파일을 가리킨다. `?`·`)`처럼 링크 문법을 깨뜨리는
 * 문자도 있다. 세그먼트별 encodeURIComponent가 전부 처리하고 decodeURIComponent로 정확히
 * 되돌아온다.
 */
function encodeLinkPath(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      // encodeURIComponent는 `!'()*-._~`를 남긴다. 그중 괄호는 마크다운 링크의 목적지를
      // 조기에 끝내 링크를 깨뜨리므로 추가로 인코딩한다.
      encodeURIComponent(segment).replace(/\(/g, "%28").replace(/\)/g, "%29")
    )
    .join("/");
}

/**
 * 마크다운 링크의 표시 텍스트로 쓸 수 있게 다듬는다.
 *
 * `[`·`]`는 링크 문법을 깨뜨린다. 퍼센트 인코딩하면 사용자에게 `%5B`가 보이므로 둥근
 * 괄호로 바꾼다 — 표시용 텍스트이고, 링크가 깨지는 것보다 낫다. 다시 적용해도 같다.
 */
function sanitizeLabel(label: string): string {
  return label.replace(/\[/g, "(").replace(/\]/g, ")");
}

/** 텍스트에서 읽어낸 노트 링크. */
export interface ParsedNoteLink {
  /**
   * 링크 대상(앵커 제외). **확장자는 원문 그대로 둔다.**
   *
   * 벗기면 `a.MD`가 `a`가 되고 호출부가 `.md`를 붙여 대소문자가 바뀐다 — 대소문자 구분
   * 파일시스템에서 다른 파일이 된다. 확장자를 뗄지는 호출부가 정한다.
   */
  target: string;
  /** 표시 이름. 없으면 빈 문자열. */
  alias: string;
}

/**
 * 텍스트에 든 노트 링크를 읽는다 — **위키링크와 마크다운 링크 둘 다**.
 *
 * formatNoteLink가 경로에 따라 두 형태 중 하나를 쓰므로, 되읽는 쪽이 한 형태만 알면
 * 생성 블록을 교체할 때 이전에 승인한 링크가 사라진다. 쓰기와 읽기를 같은 모듈에 두어
 * 형태가 늘어날 때 짝이 어긋나지 않게 한다.
 */
export function parseNoteLinks(text: string): ParsedNoteLink[] {
  const out: ParsedNoteLink[] = [];

  // 1) 위키링크. 첫 파이프만 구분자다(옵시디언과 같다).
  for (const m of text.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
    const pipe = m[1].indexOf("|");
    const targetPart = pipe < 0 ? m[1] : m[1].slice(0, pipe);
    const alias = pipe < 0 ? "" : m[1].slice(pipe + 1).trim();
    const target = stripAnchor(targetPart).trim();
    if (target !== "") out.push({ target, alias });
  }

  // 2) 마크다운 링크. 목적지는 인코딩돼 있으므로 앵커를 뗀 뒤 디코딩한다.
  //
  //    꺾쇠(`[x](<a b.md>)`)는 공백이 든 경로를 쓰는 표준 형태라 별 분기로 받는다 —
  //    꺾쇠 없는 목적지는 공백에서 끊어야 하고, 꺾쇠 안은 공백을 허용해야 한다.
  //
  //    디코딩 결과를 **trim하지 않는다.** 인코딩이 정확하므로 앞뒤 공백도 경로의 일부다.
  const markdownLinks = [
    ...text.matchAll(/\[([^\]\n]*)\]\(<([^<>\n]+)>\)/g),
    ...text.matchAll(/\[([^\]\n]*)\]\(([^)\s<>]+)\)/g),
  ];
  for (const m of markdownLinks) {
    const [pathPart] = splitFragment(m[2]);
    const target = safeDecodeUri(pathPart);
    if (target.trim() !== "") out.push({ target, alias: m[1].trim() });
  }

  return out;
}

/** 헤딩 앵커를 뗀 부분. */
function stripAnchor(value: string): string {
  const at = value.indexOf("#");
  return at < 0 ? value : value.slice(0, at);
}

/** URL의 프래그먼트를 **디코딩 전에** 분리한다. `%23`은 파일명의 일부이지 앵커가 아니다. */
function splitFragment(dest: string): [string, string] {
  const at = dest.indexOf("#");
  return at < 0 ? [dest, ""] : [dest.slice(0, at), dest.slice(at + 1)];
}

/** 디코딩. 실패하면 원문을 그대로 쓴다. */
function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
