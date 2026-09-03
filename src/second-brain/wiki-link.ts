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
    const label = trimmedAlias === "" ? target : trimmedAlias;
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

/** 마크다운 링크의 목적지에 쓸 수 있게 인코딩한다. */
function encodeLinkPath(path: string): string {
  return path.replace(/#/g, "%23").replace(/\|/g, "%7C").replace(/ /g, "%20");
}
