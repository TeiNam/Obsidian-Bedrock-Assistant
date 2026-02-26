import type { ChatSession } from "./types";

/**
 * 세션 검색 결과 타입
 * 원본 세션과 하이라이트된 제목을 포함
 */
export interface SessionSearchResult {
  session: ChatSession;
  /** 검색어가 하이라이트된 제목 (HTML) */
  highlightedTitle: string;
  /** 검색어가 하이라이트된 첫 메시지 미리보기 (HTML, 없으면 빈 문자열) */
  highlightedPreview: string;
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
      highlightedTitle: escapeHtml(session.title),
      highlightedPreview: getFirstMessagePreview(session),
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
        highlightedTitle: titleMatch
          ? highlightText(session.title, trimmed)
          : escapeHtml(session.title),
        highlightedPreview: msgMatch
          ? highlightText(truncateText(firstMsg, 80), trimmed)
          : getFirstMessagePreview(session),
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
 * 세션의 첫 번째 메시지 미리보기 (HTML 이스케이프 처리)
 */
function getFirstMessagePreview(session: ChatSession): string {
  const text = getFirstMessageText(session);
  if (!text) return "";
  return escapeHtml(truncateText(text, 80));
}

/**
 * 텍스트를 지정된 길이로 자르고 말줄임표 추가
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

/**
 * HTML 특수문자 이스케이프
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 텍스트 내 검색어를 <mark> 태그로 감싸서 하이라이트
 * 대소문자 무시, HTML 이스케이프 처리 후 하이라이트 적용
 *
 * @param text - 원본 텍스트
 * @param query - 검색어 (소문자)
 * @returns 하이라이트된 HTML 문자열
 */
export function highlightText(text: string, query: string): string {
  if (!query) return escapeHtml(text);

  // 정규식 특수문자 이스케이프
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");

  // 텍스트를 매칭/비매칭 부분으로 분리 후 각각 이스케이프 처리
  const parts = text.split(regex);
  return parts
    .map((part) => {
      if (part.toLowerCase() === query.toLowerCase()) {
        return `<mark class="ba-search-highlight">${escapeHtml(part)}</mark>`;
      }
      return escapeHtml(part);
    })
    .join("");
}
