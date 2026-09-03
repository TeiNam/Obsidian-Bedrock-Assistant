import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  stripCode,
  extractCitations,
  buildCitationIndex,
  findUnresolvedCitations,
  buildHeadingIndex,
  citationMatchesPath,
} from "./citation-check";

const VAULT = ["Meetings/2026-09-01 회의록.md", "Projects/Agent LLMs.md", "daily/2026-09-03.md"];

/** 인용 대상만 뽑아 비교용으로 정렬한다. */
function targets(markdown: string): string[] {
  return extractCitations(markdown)
    .map((c) => c.target)
    .sort();
}

describe("stripCode", () => {
  it("펜스 코드블록 안의 위키링크는 남기지 않는다", () => {
    const md = ["앞 문장 [[실제노트]]", "```md", "예시: [[가짜노트]]", "```", "뒤 문장"].join("\n");

    const out = stripCode(md);
    expect(out).toContain("[[실제노트]]");
    expect(out).not.toContain("가짜노트");
  });

  it("길이를 보존한다(원문과 위치가 어긋나지 않는다)", () => {
    const md = "a\n```\nbbb\n```\nc";
    expect(stripCode(md)).toHaveLength(md.length);
  });

  it("인라인 코드 안의 경로는 남기지 않는다", () => {
    const out = stripCode("설정은 `config/app.md` 를 보세요");
    expect(out).not.toContain("config/app.md");
  });

  it("더 긴 백틱 묶음의 일부를 닫는 기호로 오인하지 않는다", () => {
    expect(extractCitations("`a```[[가짜]]`")).toEqual([]);
  });

  it("닫히지 않은 펜스는 문서 끝까지 코드로 본다", () => {
    // 스트리밍이 중간에 끊긴 응답에서 뒤쪽 전부가 오탐이 되는 걸 막는다.
    const out = stripCode("본문 [[실제노트]]\n```\n[[가짜1]]\n[[가짜2]]");
    expect(out).toContain("[[실제노트]]");
    expect(out).not.toContain("가짜1");
    expect(out).not.toContain("가짜2");
  });

  it("~~~ 펜스도 처리한다", () => {
    const out = stripCode("~~~\n[[가짜]]\n~~~");
    expect(out).not.toContain("가짜");
  });
});

describe("extractCitations", () => {
  it("위키링크에서 별칭과 헤딩을 떼어낸다", () => {
    expect(targets("[[노트A|다른이름]] 그리고 [[노트B#섹션]] 또 [[노트C^block]]")).toEqual([
      "노트A",
      "노트B",
      "노트C",
    ]);
  });

  it("마크다운 링크의 .md 대상을 잡는다", () => {
    expect(targets("[회의록](Meetings/2026-09-01%20회의록.md) 참고")).toEqual([
      "Meetings/2026-09-01 회의록.md",
    ]);
  });

  it("문장 안의 맨 경로는 의도적으로 잡지 않는다", () => {
    // 노트 이름에 공백이 흔해 경계를 정할 수 없다. "Projects/Agent"로 자르든
    // "LLMs.md"로 자르든 틀리고, 잘린 경로는 전부 거짓 경고가 된다.
    expect(targets("근거는 Projects/Agent LLMs.md 입니다")).toEqual([]);
  });

  it("확장자 없는 일반 명사는 인용으로 보지 않는다", () => {
    // "회의록에 있습니다" 같은 문장을 경로로 오인하면 경고 신뢰가 먼저 무너진다.
    expect(targets("이 내용은 회의록에 정리되어 있습니다")).toEqual([]);
  });

  it("외부 URL은 인용이 아니다", () => {
    expect(targets("[문서](https://example.com/a.md) 와 [[https://x.com]]")).toEqual([]);
  });

  it("같은 대상·같은 앵커는 한 번만 반환한다", () => {
    expect(targets("[[노트A]] 그리고 [[노트A|별칭]] 그리고 [[노트A]]")).toEqual(["노트A"]);
  });

  it("앵커가 다르면 별개 인용으로 센다", () => {
    // 같은 노트의 다른 절을 각각 검증해야 하므로 합쳐서는 안 된다.
    const cites = extractCitations("[[노트A#가]] 와 [[노트A#나]] 와 [[노트A]]");

    expect(cites).toHaveLength(3);
    expect(cites.map((c) => c.anchor)).toEqual(["가", "나", undefined]);
  });

  it("블록 참조(^id)는 앵커로 보지 않는다", () => {
    // 블록 ID는 인덱스에 없어 검증할 수 없다. 검증 불가한 것을 경고하면 거짓 경고다.
    const cites = extractCitations("[[노트A^block123]]");

    expect(cites[0].target).toBe("노트A");
    expect(cites[0].anchor).toBeUndefined();
  });

  it("코드블록 안의 인용은 제외된다", () => {
    const md = "실제 근거는 [[노트A]]\n\n```ts\n// [[코드속가짜]]\nconst p = \"x/y.md\";\n```";
    expect(targets(md)).toEqual(["노트A"]);
    expect(targets("[본문](Real/Note.md)\n```\n[가짜](Fake/Note.md)\n```")).toEqual([
      "Real/Note.md",
    ]);
  });

  it("인용이 없으면 빈 배열이다", () => {
    expect(extractCitations("근거가 되는 노트를 찾지 못했습니다.")).toEqual([]);
  });
});

describe("buildCitationIndex", () => {
  it("전체 경로, 확장자 뗀 경로, basename 모두로 찾을 수 있다", () => {
    const idx = buildCitationIndex(["Projects/Agent LLMs.md"]);

    expect(idx.paths.has("projects/agent llms.md")).toBe(true);
    expect(idx.paths.has("projects/agent llms")).toBe(true);
    expect(idx.basenames.has("agent llms")).toBe(true);
  });
});

describe("findUnresolvedCitations", () => {
  it("노트 이름만 쓴 위키링크를 해결한다", () => {
    // 옵시디언 링크는 보통 전체 경로가 아니라 노트 이름만 쓴다.
    const cites = extractCitations("[[Agent LLMs]] 를 보세요");
    expect(findUnresolvedCitations(cites, VAULT)).toEqual([]);
  });

  it("전체 경로 인용을 해결한다", () => {
    const cites = extractCitations("[[Meetings/2026-09-01 회의록]]");
    expect(findUnresolvedCitations(cites, VAULT)).toEqual([]);
  });

  it("대소문자가 달라도 해결한다", () => {
    const cites = extractCitations("[[agent llms]]");
    expect(findUnresolvedCitations(cites, VAULT)).toEqual([]);
  });

  it("존재하지 않는 노트를 잡아낸다", () => {
    const cites = extractCitations("[[있는노트는아님]] 에 근거가 있습니다");
    const unresolved = findUnresolvedCitations(cites, VAULT);

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].target).toBe("있는노트는아님");
  });

  it("실재하는 것과 지어낸 것이 섞여 있으면 지어낸 것만 돌려준다", () => {
    const cites = extractCitations("[[Agent LLMs]] 와 [[존재하지않음]] 을 종합하면");
    const unresolved = findUnresolvedCitations(cites, VAULT);

    expect(unresolved.map((c) => c.target)).toEqual(["존재하지않음"]);
  });

  it("인덱스가 비어 있으면 아무것도 경고하지 않는다", () => {
    // 인덱싱 전에는 모든 인용이 미해결로 보인다 — 전부 거짓 경고가 된다.
    const cites = extractCitations("[[무엇이든]]");
    expect(findUnresolvedCitations(cites, [])).toEqual([]);
  });
});

// ============================================
// 헤딩 앵커 검증 (스키마 v2)
// ============================================
/**
 * 존재하는 노트의 존재하지 않는 절을 인용하는 것도 사용자를 헛걸음시키는 실패다.
 * 다만 확인할 수 없는 것을 "없다"고 경고하면 거짓 경고가 되고, 거짓이 섞이면 진짜
 * 경고까지 무시된다 — 그래서 헤딩 정보가 없을 때는 통과시킨다.
 */
describe("헤딩 앵커 검증", () => {
  const HEADINGS = buildHeadingIndex([
    ["Projects/Agent LLMs.md", ["개요", "설계 결정"]],
    ["Meetings/2026-09-01 회의록.md", []],
  ]);

  it("실재하는 헤딩 앵커는 통과한다", () => {
    const cites = extractCitations("[[Agent LLMs#설계 결정]] 참고");
    expect(findUnresolvedCitations(cites, VAULT, HEADINGS)).toEqual([]);
  });

  it("없는 헤딩 앵커를 잡아낸다", () => {
    const cites = extractCitations("[[Agent LLMs#지어낸 절]] 에 나옵니다");

    const unresolved = findUnresolvedCitations(cites, VAULT, HEADINGS);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].anchor).toBe("지어낸 절");
  });

  it("헤딩 대소문자를 무시한다", () => {
    const cites = extractCitations("[[Agent LLMs#설계 결정]]");
    expect(findUnresolvedCitations(cites, VAULT, HEADINGS)).toEqual([]);

    const upper = extractCitations("[[Agent LLMs#설계 결정]]".toUpperCase());
    // 대상 노트 이름도 대문자가 되므로 노트 해석 자체는 통과해야 한다.
    expect(findUnresolvedCitations(upper, VAULT, HEADINGS)).toEqual([]);
  });

  it("헤딩을 하나도 모르는 노트는 앵커를 검증하지 않는다", () => {
    // v1 인덱스로 색인된 노트이거나 헤딩이 없는 노트다 — 판정 불가는 통과다.
    const cites = extractCitations("[[2026-09-01 회의록#무슨 절이든]]");
    expect(findUnresolvedCitations(cites, VAULT, HEADINGS)).toEqual([]);
  });

  it("헤딩 인덱스를 주지 않으면 노트 존재만 본다", () => {
    const cites = extractCitations("[[Agent LLMs#지어낸 절]]");
    expect(findUnresolvedCitations(cites, VAULT)).toEqual([]);
  });

  it("노트 자체가 없으면 앵커와 무관하게 잡아낸다", () => {
    const cites = extractCitations("[[없는노트#어떤절]]");
    expect(findUnresolvedCitations(cites, VAULT, HEADINGS)).toHaveLength(1);
  });
});

describe("buildHeadingIndex", () => {
  it("전체 경로와 basename 두 키로 찾을 수 있다", () => {
    const idx = buildHeadingIndex([["Notes/Deep/Topic.md", ["절 하나"]]]);

    expect(idx.get("notes/deep/topic.md")?.has("절 하나")).toBe(true);
    expect(idx.get("topic")?.has("절 하나")).toBe(true);
  });

  it("빈 헤딩과 공백은 버린다", () => {
    const idx = buildHeadingIndex([["a.md", ["", "   ", "실제"]]]);
    expect(idx.get("a.md")).toEqual(new Set(["실제"]));
  });

  it("basename이 같은 노트들의 헤딩을 합친다", () => {
    // 같은 이름의 노트가 여러 폴더에 있으면 위키링크로는 구분할 수 없다.
    // 합집합으로 판정해야 거짓 경고가 생기지 않는다.
    const idx = buildHeadingIndex([
      ["A/Topic.md", ["가"]],
      ["B/Topic.md", ["나"]],
    ]);

    expect(idx.get("topic")).toEqual(new Set(["가", "나"]));
  });
});

// ============================================
// Property: 추출 결과의 형태 보장
// ============================================
/**
 * 인용 대상은 인덱스 조회 키로 쓰인다. 앵커·별칭·링크 문법 문자가 대상에 섞이면 실재하는
 * 노트를 못 찾아 거짓 경고가 나고, 거짓이 섞이면 진짜 경고까지 무시된다.
 */
describe("Property: extractCitations 결과 형태", () => {
  /** 링크 문법과 코드 펜스를 흔들 조각들. */
  const piece = fc.constantFrom(
    "본문 ",
    "[[가]]",
      "[[나|별칭]]",
    "[[다#헤딩]]",
    "[[라^block]]",
    "[텍스트](a/b.md)",
    "`인라인`",
    "```",
    "~~~",
    "\n",
    "[[",
    "]]",
    "|",
    "#",
    "http://x.com",
    "[[http://y.com]]"
  );

  it("대상에 링크 문법·앵커 문자가 남지 않는다", () => {
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 14 }), (parts) => {
        for (const c of extractCitations(parts.join(""))) {
          expect(c.target).not.toContain("[");
          expect(c.target).not.toContain("]");
          expect(c.target).not.toContain("|");
          expect(c.target).not.toContain("#");
          expect(c.target).not.toContain("^");
          // 빈 대상은 반환하지 않는다.
          expect(c.target.trim()).not.toBe("");
        }
      }),
      { numRuns: 500 }
    );
  });

  it("외부 URL을 인용으로 반환하지 않는다", () => {
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 14 }), (parts) => {
        for (const c of extractCitations(parts.join(""))) {
          expect(/^https?:/i.test(c.target)).toBe(false);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("stripCode는 길이를 보존한다", () => {
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 14 }), (parts) => {
        const md = parts.join("");
        expect(stripCode(md)).toHaveLength(md.length);
      }),
      { numRuns: 500 }
    );
  });

  it("같은 대상·앵커 조합은 중복 반환하지 않는다", () => {
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 14 }), (parts) => {
        const cites = extractCitations(parts.join(""));
        const keys = cites.map((c) => `${c.target.toLowerCase()}#${c.anchor ?? ""}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 500 }
    );
  });
});

describe("중첩된 대괄호", () => {
  it("`[[[[노트]]`에서 대상만 올바르게 뽑는다", () => {
    // 속성 테스트가 찾은 결함: 첫 `[[`부터 매칭돼 대상이 `[[노트`가 되고,
    // 그 대상은 인덱스에서 찾을 수 없어 거짓 경고가 됐다.
    expect(extractCitations("[[[[노트|별칭]]").map((c) => c.target)).toEqual(["노트"]);
    expect(extractCitations("[[ 그리고 [[실제노트]]").map((c) => c.target)).toEqual(["실제노트"]);
  });

  it("닫히지 않은 대괄호만 있으면 인용이 없다", () => {
    expect(extractCitations("[[ 열린 채로 끝")).toEqual([]);
  });
});

// ============================================
// 폴더가 붙은 대상은 경로로만 판정
// ============================================
/**
 * `[[Wrong/Agent LLMs]]`는 basename이 실재해도 옵시디언이 열지 못한다. basename으로
 * 폴백하면 실제로 깨진 링크를 "확인됨"으로 보고하게 되고, 그건 검증의 목적과 정반대다.
 */
describe("findUnresolvedCitations — 폴더 지정 인용", () => {
  const known = ["Projects/Agent LLMs.md"];

  it("폴더가 틀린 인용을 경고한다", () => {
    const out = findUnresolvedCitations(extractCitations("[[Wrong/Agent LLMs]]"), known);
    expect(out.map((c) => c.target)).toEqual(["Wrong/Agent LLMs"]);
  });

  it("폴더가 맞는 인용은 통과한다", () => {
    expect(findUnresolvedCitations(extractCitations("[[Projects/Agent LLMs]]"), known)).toEqual([]);
  });

  it("이름만 쓴 인용은 볼트 어디서든 찾는다", () => {
    // 옵시디언이 그렇게 해석한다.
    expect(findUnresolvedCitations(extractCitations("[[Agent LLMs]]"), known)).toEqual([]);
  });

  it("확장자가 붙은 전체 경로도 통과한다", () => {
    expect(
      findUnresolvedCitations(extractCitations("[[Projects/Agent LLMs.md]]"), known)
    ).toEqual([]);
  });
});

// ============================================
// 첨부 임베드는 노트 인용이 아니다
// ============================================
/**
 * 존재 판정은 마크다운 파일 목록으로만 한다. `![[Images/chart.png]]`를 노트 인용으로
 * 뽑으면 실제로 그 이미지가 있어도 항상 거짓 경고가 붙는다.
 */
describe("extractCitations — 첨부 임베드", () => {
  it("비마크다운 임베드를 인용으로 뽑지 않는다", () => {
    for (const embed of [
      "![[Images/chart.png]]",
      "![[docs/spec.pdf]]",
      "![[audio/note.mp3]]",
      "![[data.xlsx]]",
    ]) {
      expect(extractCitations(embed)).toEqual([]);
    }
  });

  it("노트 임베드는 여전히 인용으로 본다", () => {
    // `![[노트]]`는 그 노트의 내용을 근거로 끌어온 것이므로 실재해야 한다.
    expect(extractCitations("![[Projects/노트]]").map((c) => c.target)).toEqual([
      "Projects/노트",
    ]);
    expect(extractCitations("![[Projects/노트.md]]").map((c) => c.target)).toEqual([
      "Projects/노트.md",
    ]);
  });

  it("임베드가 아닌 일반 링크는 확장자와 무관하게 인용이다", () => {
    // `!`가 없으면 사용자가 그 파일을 근거로 제시한 것이다.
    expect(extractCitations("[[Images/chart.png]]").map((c) => c.target)).toEqual([
      "Images/chart.png",
    ]);
  });

  it("점이 파일명에 없으면 노트로 본다", () => {
    expect(extractCitations("![[폴더.이름/노트]]").map((c) => c.target)).toEqual([
      "폴더.이름/노트",
    ]);
  });
});

// ============================================
// 같은 이름의 노트가 여러 폴더에 있을 때의 앵커
// ============================================
/**
 * 한 응답이 `A/Topic`과 `B/Topic`을 함께 인용하면 basename 키 `topic`은 두 노트의 헤딩
 * 합집합이 된다. 경로 대상까지 그 키로 폴백하면 B에만 있는 헤딩이 `[[A/Topic#...]]`을
 * 통과시킨다 — 존재하지 않는 절을 "확인됨"으로 보고하는 것이다.
 */
describe("findUnresolvedCitations — 폴더별 앵커", () => {
  const paths = ["A/Topic.md", "B/Topic.md"];
  const headings = buildHeadingIndex([
    ["A/Topic.md", ["가"]],
    ["B/Topic.md", ["나"]],
  ]);

  it("그 노트에 없는 헤딩을 경고한다", () => {
    // "나"는 B에만 있다.
    const out = findUnresolvedCitations(extractCitations("[[A/Topic#나]]"), paths, headings);
    expect(out.map((c) => c.anchor)).toEqual(["나"]);
  });

  it("그 노트에 있는 헤딩은 통과한다", () => {
    expect(findUnresolvedCitations(extractCitations("[[A/Topic#가]]"), paths, headings)).toEqual(
      []
    );
    expect(findUnresolvedCitations(extractCitations("[[B/Topic#나]]"), paths, headings)).toEqual(
      []
    );
  });

  it("확장자를 붙인 경로도 같게 판정한다", () => {
    expect(
      findUnresolvedCitations(extractCitations("[[A/Topic.md#나]]"), paths, headings)
    ).toHaveLength(1);
  });

  it("이름만 쓴 대상은 합집합으로 본다", () => {
    // 어느 노트를 가리키는지 정할 수 없으므로 둘 중 하나에 있으면 통과시킨다 —
    // 확인할 수 없는 것을 "없다"고 경고하면 거짓 경고가 된다.
    expect(findUnresolvedCitations(extractCitations("[[Topic#나]]"), paths, headings)).toEqual([]);
  });
});

describe("extractCitations — 마크다운 링크의 앵커", () => {
  it("Note.md#절 형태를 추출한다", () => {
    // 앵커를 못 받으면 그 형태로 없는 노트·절을 인용해도 검증되지 않는다.
    const out = extractCitations("[설명](Projects/Note.md#결론)");

    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("Projects/Note.md");
    expect(out[0].anchor).toBe("결론");
  });

  it("앵커가 없는 형태도 그대로 받는다", () => {
    const out = extractCitations("[설명](Projects/Note.md)");
    expect(out[0].target).toBe("Projects/Note.md");
    expect(out[0].anchor).toBeUndefined();
  });

  it("URL 인코딩된 앵커를 해석한다", () => {
    const out = extractCitations("[설명](Note.md#%EA%B2%B0%EB%A1%A0)");
    expect(out[0].anchor).toBe("결론");
  });

  it("앵커가 붙은 링크도 존재하지 않으면 경고한다", () => {
    const out = findUnresolvedCitations(
      extractCitations("[설명](없는노트.md#절)"),
      ["Projects/Note.md"]
    );
    expect(out).toHaveLength(1);
  });
});

describe("extractCitations — 잘못된 URI 이스케이프", () => {
  it("디코딩 실패가 다른 인용의 검증을 막지 않는다", () => {
    // decodeURIComponent가 던지면 호출부의 try/catch가 검증 전체를 포기한다 —
    // 인용 하나의 형식 오류가 검증 기능을 끄는 셈이다.
    const text = "[깨진](Note%ZZ.md) 그리고 [[없는노트]]";

    const out = extractCitations(text);

    expect(out.map((c) => c.target)).toContain("없는노트");
    // 깨진 것도 원문 그대로 대상으로 남는다.
    expect(out.map((c) => c.target)).toContain("Note%ZZ.md");
  });

  it("퍼센트만 든 경로도 예외를 던지지 않는다", () => {
    expect(() => extractCitations("[x](100%.md)")).not.toThrow();
    expect(() => extractCitations("[x](Note.md#100%)")).not.toThrow();
  });

  it("정상 인코딩은 여전히 디코딩한다", () => {
    expect(extractCitations("[x](%ED%8F%B4%EB%8D%94/Note.md)")[0].target).toBe("폴더/Note.md");
  });
});

describe("extractCitations — 꺾쇠 목적지", () => {
  it("공백이 든 경로를 꺾쇠로 감싼 링크를 받는다", () => {
    // 공백 경로를 쓰는 표준 마크다운 형태다. 받지 않으면 그 형태의 지어낸 인용이
    // 검증에서 빠진다.
    const out = extractCitations("[근거](<Projects/Fake Note.md>)");

    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("Projects/Fake Note.md");
  });

  it("꺾쇠 목적지의 앵커도 받는다", () => {
    const out = extractCitations("[근거](<Projects/Fake Note.md#결론>)");
    expect(out[0].target).toBe("Projects/Fake Note.md");
    expect(out[0].anchor).toBe("결론");
  });

  it("꺾쇠 인용도 존재하지 않으면 경고한다", () => {
    const out = findUnresolvedCitations(extractCitations("[근거](<없는 노트.md>)"), ["a.md"]);
    expect(out).toHaveLength(1);
  });
});

describe("stripCode — 닫는 펜스 조건", () => {
  it("펜스 뒤에 문자가 붙은 줄은 닫는 펜스가 아니다", () => {
    // CommonMark 규약이다. 닫힌 것으로 처리하면 그 뒤 코드의 위키링크가 실제 인용으로
    // 오인된다.
    const text = ["```", "```json", "[[코드 안의 링크]]", "```", "[[진짜 인용]]"].join("\n");

    const out = extractCitations(text);

    expect(out.map((c) => c.target)).toEqual(["진짜 인용"]);
  });

  it("펜스 뒤 공백은 허용한다", () => {
    const text = ["```", "[[코드]]", "```   ", "[[진짜]]"].join("\n");
    expect(extractCitations(text).map((c) => c.target)).toEqual(["진짜"]);
  });
});

describe("extractCitations — 인코딩된 경로", () => {
  it("%23은 파일명의 일부이지 앵커가 아니다", () => {
    // 합쳐서 디코딩한 뒤 `#`로 쪼개면 `Notes/foo` + 앵커 `bar.md`로 오인되어, 실재하는
    // 파일에 깨진 인용 경고가 붙는다.
    const out = extractCitations("[x](Notes/foo%23bar.md)");

    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("Notes/foo#bar.md");
    expect(out[0].anchor).toBeUndefined();
  });

  it("%7C도 파일명의 일부다", () => {
    expect(extractCitations("[x](Notes/a%7Cb.md)")[0].target).toBe("Notes/a|b.md");
  });

  it("인코딩된 경로 + 실제 앵커를 함께 처리한다", () => {
    const out = extractCitations("[x](Notes/foo%23bar.md#결론)");
    expect(out[0].target).toBe("Notes/foo#bar.md");
    expect(out[0].anchor).toBe("결론");
  });

  it("실재하는 파일이면 경고하지 않는다", () => {
    const out = findUnresolvedCitations(extractCitations("[x](Notes/foo%23bar.md)"), [
      "Notes/foo#bar.md",
    ]);
    expect(out).toEqual([]);
  });
});

// ============================================
// 옵시디언의 경로 접미사 해석
// ============================================
/**
 * 볼트에 `Archive/Projects/Note.md`가 있으면 옵시디언에서 `[[Projects/Note]]`는 유효한
 * 링크다. 전체 경로만 요구하면 실제로 열리는 인용에 거짓 경고가 붙는다.
 */
describe("findUnresolvedCitations — 경로 접미사", () => {
  const known = ["Archive/Projects/Note.md", "Projects/Agent LLMs.md"];

  it("경로 접미사로 맞으면 통과한다", () => {
    expect(findUnresolvedCitations(extractCitations("[[Projects/Note]]"), known)).toEqual([]);
  });

  it("전체 경로도 통과한다", () => {
    expect(
      findUnresolvedCitations(extractCitations("[[Archive/Projects/Note]]"), known)
    ).toEqual([]);
  });

  it("세그먼트 경계가 아닌 접미사는 통과하지 않는다", () => {
    // `ojects/Note`는 문자열로는 접미사지만 경로로는 아니다.
    expect(findUnresolvedCitations(extractCitations("[[ojects/Note]]"), known)).toHaveLength(1);
  });

  it("폴더가 틀린 인용은 여전히 걸린다", () => {
    expect(
      findUnresolvedCitations(extractCitations("[[Wrong/Agent LLMs]]"), known)
    ).toHaveLength(1);
  });

  it("확장자가 붙은 접미사도 통과한다", () => {
    expect(findUnresolvedCitations(extractCitations("[[Projects/Note.md]]"), known)).toEqual([]);
  });
});

describe("citationMatchesPath", () => {
  it("존재 판정과 같은 규칙이다", () => {
    // 규칙이 갈라지면 접미사로 맞은 노트가 헤딩 인덱스에 빠져 지어낸 절을 놓친다.
    expect(citationMatchesPath("projects/note", "Archive/Projects/Note.md")).toBe(true);
    expect(citationMatchesPath("archive/projects/note", "Archive/Projects/Note.md")).toBe(true);
    expect(citationMatchesPath("archive/projects/note.md", "Archive/Projects/Note.md")).toBe(true);
    expect(citationMatchesPath("note", "Archive/Projects/Note.md")).toBe(true);
  });

  it("세그먼트 경계가 아닌 접미사는 맞지 않는다", () => {
    expect(citationMatchesPath("ojects/note", "Archive/Projects/Note.md")).toBe(false);
  });

  it("폴더가 틀리면 맞지 않는다", () => {
    expect(citationMatchesPath("wrong/note", "Archive/Projects/Note.md")).toBe(false);
  });

  it("이름이 다르면 맞지 않는다", () => {
    expect(citationMatchesPath("other", "Archive/Projects/Note.md")).toBe(false);
  });
});

describe("findUnresolvedCitations — 접미사 경로의 앵커", () => {
  const paths = ["Archive/Projects/Note.md"];
  const headings = buildHeadingIndex([["Archive/Projects/Note.md", ["결론"]]]);

  it("접미사로 맞은 노트의 없는 절을 경고한다", () => {
    // 존재 판정은 접미사로 통과하는데 앵커 판정이 정확 키만 보면 "헤딩 정보 없음 → 통과"로
    // 지어낸 절이 빠져나간다.
    const out = findUnresolvedCitations(
      extractCitations("[[Projects/Note#없는 절]]"),
      paths,
      headings
    );

    expect(out).toHaveLength(1);
    expect(out[0].anchor).toBe("없는 절");
  });

  it("접미사로 맞은 노트의 있는 절은 통과한다", () => {
    expect(
      findUnresolvedCitations(extractCitations("[[Projects/Note#결론]]"), paths, headings)
    ).toEqual([]);
  });

  it("전체 경로 앵커도 그대로 동작한다", () => {
    expect(
      findUnresolvedCitations(extractCitations("[[Archive/Projects/Note#결론]]"), paths, headings)
    ).toEqual([]);
    expect(
      findUnresolvedCitations(extractCitations("[[Archive/Projects/Note#없음]]"), paths, headings)
    ).toHaveLength(1);
  });
});

describe("extractCitations — 외부 스킴", () => {
  it("열거되지 않은 스킴도 외부로 본다", () => {
    // 스킴을 열거하면 목록에 없는 것이 `.md`로 끝날 때 볼트 인용으로 오인된다.
    for (const url of [
      "ftp://server/readme.md",
      "custom-app://open/a.md",
      "//cdn.example.com/a.md",
    ]) {
      expect(extractCitations(`[docs](${url})`)).toEqual([]);
    }
  });

  it("같은 노트 내 앵커는 인용이 아니다", () => {
    expect(extractCitations("[절로](#결론)")).toEqual([]);
  });

  it("볼트 경로는 여전히 인용이다", () => {
    expect(extractCitations("[문서](Notes/a.md)")[0].target).toBe("Notes/a.md");
  });
});

describe("extractCitations — 점이 든 노트 이름", () => {
  it("버전 번호를 확장자로 오인하지 않는다", () => {
    // `.2`를 확장자로 보면 그 노트에 대한 임베드가 검증에서 빠진다.
    expect(extractCitations("![[Release 1.2]]").map((c) => c.target)).toEqual(["Release 1.2"]);
    expect(extractCitations("![[2026.09.04 회의]]").map((c) => c.target)).toEqual([
      "2026.09.04 회의",
    ]);
  });

  it("실제 확장자는 여전히 첨부로 본다", () => {
    for (const embed of ["![[a.png]]", "![[a.pdf]]", "![[a.xlsx]]", "![[a.mp3]]"]) {
      expect(extractCitations(embed)).toEqual([]);
    }
  });

  it("점이 든 노트 임베드가 존재하지 않으면 경고한다", () => {
    const out = findUnresolvedCitations(extractCitations("![[Release 9.9]]"), ["Release 1.2.md"]);
    expect(out).toHaveLength(1);
  });
});
