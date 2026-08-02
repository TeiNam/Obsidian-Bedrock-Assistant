// 현재 노트 → 위키 노트 승격 모듈 (Second Brain Layer)
// ============================================
// 지금 열려 있는 노트(또는 선택 영역)를 LLM 이 AI-first 규격의 위키 본문으로 다시 써서
// create_wiki_note 로 저장하는 경로다. 다른 능동 동작과 달리 **검색을 하지 않는다** —
// synthesize 는 주제로 인덱스를 검색해 여러 노트를 종합하고, architect 는 폴더를 스캔하며,
// harvest 는 저장된 대화 세션을 읽는다. 이 모듈만 입력이 눈앞의 노트 하나이므로
// 인덱싱 없이도 동작한다(설치 직후 쓸 수 있는 유일한 위키 생성 경로).
//
// synthesize 와 같은 "순수 코어 + I/O 래퍼" 패턴을 따르되, 쓰기는 기존
// create_wiki_note 도구에 위임하므로 이 파일에는 I/O 가 없다(순수 함수만).

/** 생성된 위키 본문 끝에 붙이는 출처 줄의 접두사. */
export const WIKI_SOURCE_LINK_PREFIX = "출처:";

/**
 * 위키 본문 생성 LLM 호출에 사용할 최대 토큰 수.
 * 노트 한 건을 재구성하는 작업이라 synthesize(여러 노트 종합)와 같은 수준으로 둔다.
 */
export const NOTE_WIKI_MAX_TOKENS = 2000;

/**
 * LLM 에 넘길 원문 본문의 최대 길이.
 * 채팅 컨텍스트 첨부와 같은 상한을 쓴다 — 긴 노트 전문을 그대로 보내면 응답 토큰을
 * 밀어내 본문이 잘린다.
 */
export const NOTE_WIKI_MAX_INPUT_CHARS = 8000;

/**
 * 노트 제목·본문으로 위키 본문 생성 프롬프트를 구성한다 — 순수 함수.
 *
 * 출력 규약은 buildSynthesisPrompt 와 같다: 마크다운 본문만, 프론트매터 금지
 * (buildAiFirstNote 가 직렬화한다), 참조는 위키링크, 근거 없는 단정 금지.
 *
 * @param title 원본 노트 제목 (생성될 위키 노트의 제목이기도 하다)
 * @param body 원본 노트 본문 또는 선택 영역
 */
export function buildNoteWikiPrompt(title: string, body: string): string {
  const lines: string[] = [];
  lines.push(`# 위키 노트 작성 요청: ${title}`);
  lines.push("");
  lines.push(
    `아래는 "${title}" 노트의 내용입니다. 이 내용을 나중에 다시 찾아 읽을 수 있는 ` +
      "지식 노트 본문으로 재구성하십시오. 핵심 개념을 앞에 두고, 세부 사항은 그 뒤에 " +
      "배치하십시오.",
  );
  lines.push("");
  lines.push("## 원본 내용");
  lines.push("");
  lines.push(body.trim() === "" ? "_본문이 비어 있습니다. 제목만으로 작성하십시오._" : body);
  lines.push("");
  lines.push("## 작성 지침");
  lines.push("- 원본 내용만을 근거로 작성하고, 근거 없는 내용은 추가하지 마십시오.");
  lines.push("- 다른 노트를 참조할 때는 위키링크([[노트 제목]]) 형식을 사용하십시오.");
  lines.push("- 결과는 마크다운 본문만 출력하십시오(프론트매터는 작성하지 마십시오).");
  lines.push("- 원본의 사실·수치·고유명사를 바꾸지 마십시오.");

  return lines.join("\n");
}

/**
 * 생성된 본문 끝에 원본 노트를 가리키는 위키링크를 붙인다 — 순수 함수.
 *
 * 이 링크가 없으면 생성된 위키 노트는 아웃링크·백링크가 0인 고아 노트가 되어
 * findOrphanNotes 에 잡힌다. 즉 플러그인이 자기 지식 공백 리포트를 채운다.
 *
 * LLM 이 지침을 따라 스스로 출처를 적는 경우가 있으므로, 같은 원본을 가리키는 링크가
 * 이미 있으면 중복해서 붙이지 않는다.
 */
export function appendSourceLink(body: string, sourceTitle: string): string {
  const link = `[[${sourceTitle}]]`;
  if (body.includes(link)) {
    return body;
  }
  const trimmed = body.replace(/\s+$/, "");
  const suffix = `${WIKI_SOURCE_LINK_PREFIX} ${link}`;
  return trimmed === "" ? suffix : `${trimmed}\n\n${suffix}`;
}
