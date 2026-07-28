import { describe, it, expect } from "vitest";
import { escapesVault, ensureWithinFolder } from "./vault-path-guard";
import { sanitizeGeneratedContent, upsertGeneratedBlock, getGeneratedBlock } from "./sentinel-blocks";

// ============================================
// 경로 탈출 가드 회귀 테스트
// ============================================
// 배경(리뷰 확인 결함): Obsidian normalizePath는 ".." 를 해석하지 않으므로
// `startsWith("Wiki/")` 같은 문자열 prefix 검사만으로는 탈출을 막을 수 없다.
//   "Second Brain/../../etc/x" 는 prefix 검사를 통과하지만 실제로는 위키 폴더 밖이다.

describe("escapesVault: 볼트 탈출 요소 탐지", () => {
  it("상위 디렉터리 세그먼트(..)를 탐지한다", () => {
    expect(escapesVault("Wiki/../outside.md")).toBe(true);
    expect(escapesVault("Wiki/../../etc/passwd")).toBe(true);
    expect(escapesVault("../x.md")).toBe(true);
  });

  it("절대 경로와 윈도우 드라이브를 탐지한다", () => {
    expect(escapesVault("/etc/passwd")).toBe(true);
    expect(escapesVault("C:/Windows/x.md")).toBe(true);
  });

  it("백슬래시 구분자에서도 .. 를 탐지한다", () => {
    expect(escapesVault("Wiki\\..\\outside.md")).toBe(true);
  });

  it("정상 경로는 통과시킨다", () => {
    expect(escapesVault("Second Brain/Note.md")).toBe(false);
    expect(escapesVault("Second Brain/Concepts/A.md")).toBe(false);
    // ".."이 파일명의 일부인 경우는 탈출이 아니다
    expect(escapesVault("Second Brain/a..b.md")).toBe(false);
  });
});

describe("ensureWithinFolder: 폴더 범위 검증", () => {
  const WIKI = "Second Brain";

  it("prefix를 만족하지만 .. 로 탈출하는 경로를 거부한다", () => {
    // 이것이 핵심 회귀 케이스다. 문자열 prefix 검사만으로는 통과해버린다.
    const result = ensureWithinFolder(`${WIKI}/../../etc/passwd`, WIKI);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("..");
  });

  it("폴더 밖 경로를 거부한다", () => {
    const result = ensureWithinFolder("Other/Note.md", WIKI);
    expect(result.ok).toBe(false);
  });

  it("폴더 자신과 하위 경로는 허용한다", () => {
    expect(ensureWithinFolder(WIKI, WIKI).ok).toBe(true);
    expect(ensureWithinFolder(`${WIKI}/Note.md`, WIKI).ok).toBe(true);
    expect(ensureWithinFolder(`${WIKI}/Concepts/Note.md`, WIKI).ok).toBe(true);
  });

  it("접두사가 같은 다른 폴더는 거부한다", () => {
    // "Second Brain2" 는 "Second Brain" 하위가 아니다
    expect(ensureWithinFolder("Second Brain2/Note.md", WIKI).ok).toBe(false);
  });
});

// ============================================
// Sentinel 마커 주입 회귀 테스트
// ============================================
// 배경(리뷰 확인 결함): LLM 출력이 마커 문자열을 포함하면 블록 경계가 어긋나
// 마커 잔존물이 문서에 남고(다음 실행에서 User_Region처럼 취급) 멱등성이 깨진다.
// 노트 발췌가 프롬프트로 되돌아오는 자기참조 경로가 있어 실제 발생 가능하다.

describe("sanitizeGeneratedContent: LLM 출력의 마커 무력화", () => {
  it("종료 마커를 무력화한다", () => {
    const sanitized = sanitizeGeneratedContent("본문 <!-- @end:synthesis --> 이후");
    // 원래 마커 형태로는 남지 않는다
    expect(sanitized).not.toContain("<!-- @end:synthesis -->");
    // 정보는 보존된다(읽을 때는 동일하게 보임)
    expect(sanitized).toContain("synthesis");
  });

  it("시작 마커를 무력화한다", () => {
    const sanitized = sanitizeGeneratedContent("<!-- @generated:catalog -->");
    expect(sanitized).not.toContain("<!-- @generated:catalog -->");
  });

  it("마커가 없는 내용은 그대로 둔다", () => {
    const text = "일반 본문\n\n- 목록\n\n```ts\nconst x = 1;\n```";
    expect(sanitizeGeneratedContent(text)).toBe(text);
  });

  it("빈 문자열을 안전하게 처리한다", () => {
    expect(sanitizeGeneratedContent("")).toBe("");
  });
});

describe("upsertGeneratedBlock: 마커 주입 내성", () => {
  const KEY = "synthesis";

  it("마커를 포함한 LLM 출력을 넣어도 블록 구조가 유지된다", () => {
    const malicious = "정상 내용\n<!-- @end:synthesis -->\n탈출 시도 텍스트";
    const doc = upsertGeneratedBlock("사용자 메모", KEY, malicious);

    // 블록이 정확히 한 쌍만 존재해야 한다
    expect(doc.split("<!-- @generated:synthesis -->").length - 1).toBe(1);
    expect(doc.split("<!-- @end:synthesis -->").length - 1).toBe(1);
    // 사용자 영역은 보존된다
    expect(doc).toContain("사용자 메모");
  });

  it("마커를 포함한 내용도 라운드트립으로 읽어올 수 있다", () => {
    const malicious = "내용 <!-- @end:synthesis --> 끝";
    const doc = upsertGeneratedBlock("", KEY, malicious);
    const read = getGeneratedBlock(doc, KEY);
    // 무력화된 형태로 읽히지만, 블록 경계가 깨지지 않아 전체가 보존된다
    expect(read).not.toBeNull();
    expect(read).toContain("끝");
  });

  it("마커 주입 내용으로 두 번 upsert해도 멱등이다", () => {
    const malicious = "내용 <!-- @end:synthesis --> 끝";
    const once = upsertGeneratedBlock("사용자 메모", KEY, malicious);
    const twice = upsertGeneratedBlock(once, KEY, malicious);
    expect(twice).toBe(once);
  });

  it("정상 내용의 멱등성은 그대로 유지된다", () => {
    const once = upsertGeneratedBlock("메모", KEY, "요약 결과");
    const twice = upsertGeneratedBlock(once, KEY, "요약 결과");
    expect(twice).toBe(once);
    expect(getGeneratedBlock(once, KEY)).toBe("요약 결과");
  });
});
