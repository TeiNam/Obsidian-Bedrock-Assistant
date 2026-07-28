// Sentinel 블록 병합 순수 모듈 (Second Brain Layer)
// ==================================================
// 자동 생성 영역(Generated_Region)을 마커로 식별·교체·병합하는 토대 유틸.
// architect / synthesize / wiki-structure 가 공유한다.
//
// 설계 원칙:
//  - 부수효과 없는 순수 함수 (fast-check 기반 속성 테스트 가능)
//  - 마커 밖 텍스트(User_Region) 불변 보존 (비파괴 쓰기)
//  - 멱등성: upsert 를 동일 인자로 두 번 적용해도 한 번과 동일
//  - Block_Key 는 정규식 특수문자를 포함해도 리터럴로 처리 (escapeRegExp)
//
// 마커 형식:
//  - 시작: <!-- @generated:KEY -->
//  - 종료: <!-- @end:KEY -->

// ============================================
// 타입
// ============================================

export interface ParsedBlock {
  /** Block_Key */
  key: string;
  /** 시작 마커 시작 인덱스 */
  start: number;
  /** 종료 마커 끝 인덱스 (exclusive) */
  end: number;
  /** Generated_Region 내부 내용 (마커 제외) */
  content: string;
}

// ============================================
// 내부 헬퍼
// ============================================

/** 정규식 특수문자를 이스케이프한다 (동적 RegExp 구성용). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generated_Region 에 기록할 내용에서 sentinel 마커를 무력화한다.
 *
 * `<!-- @generated:X -->` / `<!-- @end:X -->` 형태를 `<!-- @generated​:X -->` 처럼
 * 제로폭 공백을 끼워 치환한다. 사람이 읽을 때는 동일하게 보이지만 마커 정규식과는
 * 일치하지 않으므로 블록 경계를 침범하지 못한다. 원문의 정보는 보존된다.
 */
export function sanitizeGeneratedContent(content: string): string {
  if (typeof content !== "string" || content === "") return content ?? "";
  return content.replace(
    /<!--\s*@(generated|end):/g,
    (_match, kind: string) => `<!-- @${kind}​:`
  );
}

/** 주어진 Block_Key 의 시작 마커 문자열을 만든다. */
export function startMarker(key: string): string {
  return `<!-- @generated:${key} -->`;
}

/** 주어진 Block_Key 의 종료 마커 문자열을 만든다. */
export function endMarker(key: string): string {
  return `<!-- @end:${key} -->`;
}

/**
 * upsert 가 내부 내용을 감쌀 때 사용하는 래핑(앞뒤 개행 1개씩)을 되돌린다.
 * upsert 는 항상 `\n${content}\n` 형태로 기록하므로, 앞뒤 개행을 정확히 1개씩만
 * 제거하면 임의의 content(개행 포함)를 원형 그대로 복원한다 → 라운드트립 보존(Property 3).
 */
function unwrap(region: string): string {
  let s = region;
  if (s.startsWith("\n")) s = s.slice(1);
  if (s.endsWith("\n")) s = s.slice(0, -1);
  return s;
}

/**
 * 특정 Block_Key 의 "첫 번째 닫힌 블록"을 찾는다 (Req 2.2, 2.3, 2.9).
 *
 * 정규식은 escapeRegExp 로 마커를 리터럴화하여(Req 2.8) 키의 정규식 특수문자를 안전하게
 * 처리한다. 내부 내용에는 또 다른 시작 마커가 포함되지 않도록 부정형 전방탐색
 * `(?!start)` 을 둔다. 이 덕분에 "닫히지 않은 시작 마커"가 앞에 있어도, 실제로 짝이
 * 맞는(시작↔종료가 인접한) 블록만 매칭되어 upsert 멱등성이 유지된다(Property 1).
 */
function matchBlock(
  doc: string,
  key: string,
): { start: number; innerStart: number; innerEnd: number; end: number; content: string } | null {
  const open = startMarker(key);
  const close = endMarker(key);
  const escOpen = escapeRegExp(open);
  const escClose = escapeRegExp(close);
  // 시작 마커 + (시작 마커를 포함하지 않는 내부) + 종료 마커
  const re = new RegExp(`${escOpen}((?:(?!${escOpen})[\\s\\S])*?)${escClose}`);
  const m = re.exec(doc);
  if (m === null) return null;

  const start = m.index;
  const innerStart = start + open.length;
  const inner = m[1];
  const innerEnd = innerStart + inner.length;
  const end = innerEnd + close.length;
  return { start, innerStart, innerEnd, end, content: unwrap(inner) };
}

// ============================================
// 공개 API
// ============================================

/**
 * 문서에서 닫힌 Sentinel_Block 을 모두 식별한다 (Req 2.1).
 * 닫히지 않은 시작 마커는 블록으로 인식하지 않는다 (Req 2.7).
 *
 * 종료 마커는 "가장 가까운 미매칭 동일 키 시작 마커"와 짝지어(스택 방식) 닫힌
 * 블록을 만든다. 짝을 찾지 못한 시작/종료 마커는 무시한다.
 * 반환 배열은 시작 위치 오름차순으로 정렬된다.
 */
export function parseBlocks(doc: string): ParsedBlock[] {
  const markerRe = /<!-- @(generated|end):(.*?) -->/g;
  const stack: Array<{ key: string; start: number; afterStart: number }> = [];
  const blocks: ParsedBlock[] = [];

  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(doc)) !== null) {
    const kind = m[1];
    const key = m[2];
    if (kind === "generated") {
      stack.push({ key, start: m.index, afterStart: markerRe.lastIndex });
      continue;
    }
    // 종료 마커: 동일 키의 가장 가까운(가장 최근) 미매칭 시작 마커를 찾아 닫는다.
    let idx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].key === key) {
        idx = i;
        break;
      }
    }
    if (idx === -1) continue; // 짝 없는 종료 마커 → 무시
    const openMarker = stack[idx];
    stack.splice(idx, 1);
    const region = doc.slice(openMarker.afterStart, m.index);
    blocks.push({
      key,
      start: openMarker.start,
      end: markerRe.lastIndex,
      content: unwrap(region),
    });
  }

  blocks.sort((a, b) => a.start - b.start);
  return blocks;
}

/**
 * 해당 Block_Key 의 Generated_Region 내부 내용을 반환한다 (Req 2.2).
 * 해당 키의 닫힌 블록이 없으면 null 을 반환한다.
 */
export function getGeneratedBlock(doc: string, key: string): string | null {
  const block = matchBlock(doc, key);
  return block === null ? null : block.content;
}

/**
 * Generated_Region 을 upsert 한다 (Req 2.3, 2.4).
 *  - 해당 Block_Key 블록이 있으면 내부 내용만 새 content 로 교체하고 마커 밖 텍스트는
 *    한 글자도 변경하지 않는다 (Req 2.3). 동일 키 다중 블록이면 첫 블록만 교체한다 (Req 2.9).
 *  - 없으면 기존 문서를 보존한 채 문서 끝에 새 Sentinel_Block 을 추가한다 (Req 2.4).
 *  - 동일 인자 반복 적용은 멱등이다 (Req 2.6).
 *  - 닫히지 않은 시작 마커만 있는 경우 "블록 없음"으로 보아 끝에 추가하므로 원본이
 *    손실 없이 보존된다 (Req 2.7).
 */
export function upsertGeneratedBlock(doc: string, key: string, content: string): string {
  // LLM 출력에 섞인 마커 문자열을 무력화한다.
  //
  // content에 `<!-- @generated:KEY -->` / `<!-- @end:KEY -->`가 그대로 들어가면 블록
  // 경계가 어긋나 마커 잔존물이 문서에 남고(다음 실행에서 User_Region처럼 취급됨)
  // 멱등성이 깨진다. 노트 발췌가 프롬프트로 되돌아오는 자기참조 경로가 있어 실제로
  // 발생 가능하므로, 기록 전에 마커를 무해한 형태로 치환한다.
  const region = `\n${sanitizeGeneratedContent(content)}\n`;
  const block = matchBlock(doc, key);

  if (block !== null) {
    // 기존 블록: 마커 사이 내부만 교체. 마커와 그 밖 텍스트는 불변.
    return doc.slice(0, block.innerStart) + region + doc.slice(block.innerEnd);
  }

  // 신규 블록: 문서 끝에 추가. 기존 문서 내용은 그대로 보존한다.
  const newBlock = `${startMarker(key)}${region}${endMarker(key)}`;
  if (doc.length === 0) return newBlock;
  const separator = doc.endsWith("\n") ? "\n" : "\n\n";
  return doc + separator + newBlock;
}

/**
 * 어떤 Generated_Region 에도 속하지 않는 User_Region 텍스트 조각을 원래 순서대로
 * 반환한다 (Req 2.5). 공백만으로 이루어진 조각은 의미 없는 조각으로 보아 제외하며,
 * 각 조각의 양끝 공백은 정규화(trim)한다. 이 정규화 덕분에 upsert 가 새 블록을 추가하며
 * 끼워 넣는 구분 공백이 User_Region 집합을 바꾸지 않는다(Property 2).
 */
export function extractUserBlocks(doc: string): string[] {
  const blocks = parseBlocks(doc);
  if (blocks.length === 0) {
    const whole = doc.trim();
    return whole.length > 0 ? [whole] : [];
  }

  // 블록 구간 [start, end) 을 병합(중첩/겹침 안전)한 뒤 그 여집합을 조각으로 모은다.
  const intervals = blocks
    .map((b) => [b.start, b.end] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of intervals) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const fragments: string[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    const segment = doc.slice(cursor, s).trim();
    if (segment.length > 0) fragments.push(segment);
    cursor = e;
  }
  const tail = doc.slice(cursor).trim();
  if (tail.length > 0) fragments.push(tail);
  return fragments;
}
