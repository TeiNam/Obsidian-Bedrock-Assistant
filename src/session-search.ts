import type { ChatSession } from "./types";

/**
 * 하이라이트 세그먼트 타입
 * DOM API로 안전하게 렌더링하기 위한 구조
 */
export interface HighlightSegment {
  text: string;
  highlight: boolean;
}

/**
 * 세션 검색 결과 타입
 * 원본 세션과 하이라이트 세그먼트를 포함
 */
export interface SessionSearchResult {
  session: ChatSession;
  /** 제목 하이라이트 세그먼트 배열 */
  titleSegments: HighlightSegment[];
  /** 미리보기 하이라이트 세그먼트 배열 (없으면 빈 배열) */
  previewSegments: HighlightSegment[];
}

/**
 * 검색어로 세션 목록을 필터링하고 하이라이트 정보를 반환하는 함수
 * 세션 제목과 첫 번째 메시지 내용을 기준으로 필터링
 *
 * @param sessions - 전체 세션 목록
 * @param query - 검색어 (빈 문자열이면 전체 반환)
 * @returns 필터링된 세션 검색 결과 배열
 */
export function filterSessions(
  sessions: ChatSession[],
  query: string
): SessionSearchResult[] {
  const trimmed = query.trim().toLowerCase();

  // 검색어가 없으면 전체 세션을 하이라이트 없이 반환
  if (trimmed === "") {
    return sessions.map((session) => ({
      session,
      titleSegments: [{ text: session.title, highlight: false }],
      previewSegments: getFirstMessagePreviewSegments(session),
    }));
  }

  const results: SessionSearchResult[] = [];

  for (const session of sessions) {
    const titleLower = session.title.toLowerCase();
    const firstMsg = getFirstMessageText(session);
    const firstMsgLower = firstMsg.toLowerCase();

    // 제목 또는 첫 메시지에 검색어가 포함되어 있으면 매칭
    const titleMatch = titleLower.includes(trimmed);
    const msgMatch = firstMsgLower.includes(trimmed);

    if (titleMatch || msgMatch) {
      results.push({
        session,
        titleSegments: titleMatch
          ? buildHighlightSegments(session.title, trimmed)
          : [{ text: session.title, highlight: false }],
        previewSegments: msgMatch
          ? buildHighlightSegments(truncateText(firstMsg, 80), trimmed)
          : getFirstMessagePreviewSegments(session),
      });
    }
  }

  return results;
}

/**
 * 세션의 첫 번째 사용자 메시지 텍스트를 반환
 */
function getFirstMessageText(session: ChatSession): string {
  if (!session.messages || session.messages.length === 0) return "";
  const firstUserMsg = session.messages.find((m) => m.role === "user");
  return firstUserMsg ? firstUserMsg.content : "";
}

/**
 * 세션의 첫 번째 메시지 미리보기 세그먼트 배열
 */
function getFirstMessagePreviewSegments(session: ChatSession): HighlightSegment[] {
  const text = getFirstMessageText(session);
  if (!text) return [];
  return [{ text: truncateText(text, 80), highlight: false }];
}

/**
 * 텍스트를 지정된 길이로 자르고 말줄임표 추가
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

/**
 * 텍스트 내 검색어를 기준으로 하이라이트 세그먼트 배열을 생성
 * DOM API로 안전하게 렌더링하기 위한 구조
 *
 * @param text - 원본 텍스트
 * @param query - 검색어 (소문자)
 * @returns 하이라이트 세그먼트 배열
 */
export function buildHighlightSegments(text: string, query: string): HighlightSegment[] {
  if (!query) return [{ text, highlight: false }];

  // 정규식 특수문자 이스케이프
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");

  const parts = text.split(regex);
  return parts
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      highlight: part.toLowerCase() === query.toLowerCase(),
    }));
}
