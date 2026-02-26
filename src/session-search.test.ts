import { describe, it, expect } from "vitest";
import { filterSessions, highlightText, escapeHtml } from "./session-search";
import type { ChatSession } from "./types";

/** 테스트용 세션 생성 헬퍼 */
function makeSession(
  id: string,
  title: string,
  messages: { role: "user" | "assistant"; content: string }[] = []
): ChatSession {
  return {
    id,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: messages.map((m, i) => ({ ...m, timestamp: Date.now() + i })),
  };
}

describe("filterSessions", () => {
  // 10개 이상의 세션으로 테스트 데이터 구성
  const sessions: ChatSession[] = [
    makeSession("1", "프로젝트 회의록", [{ role: "user", content: "오늘 회의 내용 정리해줘" }]),
    makeSession("2", "React 컴포넌트 설계", [{ role: "user", content: "버튼 컴포넌트를 만들어줘" }]),
    makeSession("3", "Python 스크립트 작성", [{ role: "user", content: "파일 정리 스크립트 필요해" }]),
    makeSession("4", "일정 관리", [{ role: "user", content: "이번 주 일정을 정리해줘" }]),
    makeSession("5", "영어 번역 요청", [{ role: "user", content: "이 문장을 영어로 번역해줘" }]),
    makeSession("6", "블로그 글 작성", [{ role: "user", content: "AI 트렌드에 대한 블로그 글" }]),
    makeSession("7", "코드 리뷰", [{ role: "user", content: "이 React 코드를 리뷰해줘" }]),
    makeSession("8", "데이터베이스 설계", [{ role: "user", content: "사용자 테이블 스키마 설계" }]),
    makeSession("9", "버그 수정 도움", [{ role: "user", content: "TypeError가 발생하는 코드" }]),
    makeSession("10", "학습 계획", [{ role: "user", content: "Python 학습 로드맵 만들어줘" }]),
    makeSession("11", "빈 세션", []),
  ];

  it("빈 검색어는 전체 세션을 반환한다", () => {
    const results = filterSessions(sessions, "");
    expect(results).toHaveLength(sessions.length);
  });

  it("공백만 있는 검색어도 전체 세션을 반환한다", () => {
    const results = filterSessions(sessions, "   ");
    expect(results).toHaveLength(sessions.length);
  });

  it("제목으로 검색하면 매칭되는 세션만 반환한다", () => {
    const results = filterSessions(sessions, "React");
    // 제목 "React 컴포넌트 설계" + 메시지 "이 React 코드를 리뷰해줘"
    expect(results).toHaveLength(2);
    expect(results[0].session.id).toBe("2");
  });

  it("첫 메시지 내용으로 검색할 수 있다", () => {
    const results = filterSessions(sessions, "번역");
    expect(results).toHaveLength(1);
    expect(results[0].session.id).toBe("5");
  });

  it("대소문자를 구분하지 않는다", () => {
    const results = filterSessions(sessions, "react");
    // 제목 "React 컴포넌트 설계" + 메시지 "이 React 코드를 리뷰해줘"
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.session.id);
    expect(ids).toContain("2");
    expect(ids).toContain("7");
  });

  it("제목과 메시지 모두에서 검색한다", () => {
    const results = filterSessions(sessions, "Python");
    // 제목 "Python 스크립트 작성" + 메시지 "Python 학습 로드맵"
    expect(results).toHaveLength(2);
  });

  it("매칭되는 세션이 없으면 빈 배열을 반환한다", () => {
    const results = filterSessions(sessions, "존재하지않는키워드");
    expect(results).toHaveLength(0);
  });

  it("검색 결과에 하이라이트된 제목이 포함된다", () => {
    const results = filterSessions(sessions, "React");
    expect(results[0].highlightedTitle).toContain("<mark");
    expect(results[0].highlightedTitle).toContain("React");
  });

  it("메시지 매칭 시 하이라이트된 미리보기가 포함된다", () => {
    const results = filterSessions(sessions, "번역");
    expect(results[0].highlightedPreview).toContain("<mark");
    expect(results[0].highlightedPreview).toContain("번역");
  });

  it("메시지가 없는 세션은 제목으로만 검색된다", () => {
    const results = filterSessions(sessions, "빈 세션");
    expect(results).toHaveLength(1);
    expect(results[0].session.id).toBe("11");
  });

  it("10개 이상 세션에서 키워드 검색이 정상 동작한다", () => {
    // "정리" 키워드: 메시지에 "정리해줘"가 포함된 세션들
    const results = filterSessions(sessions, "정리");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // 모든 결과가 제목 또는 첫 메시지에 "정리"를 포함하는지 확인
    for (const r of results) {
      const titleMatch = r.session.title.toLowerCase().includes("정리");
      const msgMatch = r.session.messages[0]?.content.toLowerCase().includes("정리");
      expect(titleMatch || msgMatch).toBe(true);
    }
  });
});

describe("highlightText", () => {
  it("검색어를 mark 태그로 감싼다", () => {
    const result = highlightText("Hello World", "world");
    expect(result).toBe('Hello <mark class="ba-search-highlight">World</mark>');
  });

  it("여러 번 등장하는 검색어를 모두 하이라이트한다", () => {
    const result = highlightText("test is a test", "test");
    const markCount = (result.match(/<mark/g) || []).length;
    expect(markCount).toBe(2);
  });

  it("빈 검색어는 이스케이프된 원본 텍스트를 반환한다", () => {
    const result = highlightText("Hello <World>", "");
    expect(result).toBe("Hello &lt;World&gt;");
  });

  it("HTML 특수문자가 이스케이프된다", () => {
    const result = highlightText('<script>alert("xss")</script>', "script");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;");
  });

  it("정규식 특수문자가 포함된 검색어도 안전하게 처리된다", () => {
    const result = highlightText("price is $100.00", "$100");
    expect(result).toContain("<mark");
  });
});

describe("escapeHtml", () => {
  it("HTML 특수문자를 이스케이프한다", () => {
    expect(escapeHtml('<div class="test">&')).toBe(
      "&lt;div class=&quot;test&quot;&gt;&amp;"
    );
  });

  it("일반 텍스트는 변경하지 않는다", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });
});
