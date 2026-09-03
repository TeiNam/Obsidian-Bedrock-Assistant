import { describe, it, expect } from "vitest";
import {
  normalizeDecision,
  parseDecisionReport,
  decisionKey,
  mergeLedger,
  formatLedger,
  buildDecisionPrompt,
  parseLedger,
  type DecisionEntry,
} from "./decisions";

function decision(overrides: Partial<DecisionEntry> = {}): DecisionEntry {
  return {
    decision: "Bedrock을 기본 백엔드로 쓴다",
    rationale: "임베딩과 채팅을 한 계정에서 쓴다",
    sources: ["Meetings/2026-09-01.md"],
    decidedOn: "2026-09-01",
    owner: "",
    due: "",
    status: "open",
    supersededBy: "",
    ...overrides,
  };
}

describe("normalizeDecision", () => {
  it("결정 문구와 출처가 있으면 유효하다", () => {
    const out = normalizeDecision({ decision: "A로 간다", sources: ["a.md"] });

    expect(out?.decision).toBe("A로 간다");
    expect(out?.sources).toEqual(["a.md"]);
    // 모르는 값은 채우지 않는다.
    expect(out?.owner).toBe("");
    expect(out?.status).toBe("open");
  });

  it("출처가 없으면 무효다", () => {
    // 검증할 수 없는 항목이 쌓이면 원장 전체를 믿을 수 없게 된다.
    expect(normalizeDecision({ decision: "A로 간다", sources: [] })).toBeNull();
    expect(normalizeDecision({ decision: "A로 간다" })).toBeNull();
  });

  it("결정 문구가 없으면 무효다", () => {
    expect(normalizeDecision({ decision: "   ", sources: ["a.md"] })).toBeNull();
    expect(normalizeDecision({ sources: ["a.md"] })).toBeNull();
  });

  it("모르는 상태 값은 open으로 둔다", () => {
    // done으로 접으면 열린 약속이 조용히 사라진다.
    for (const status of ["무엇인가", "", null, 42, undefined]) {
      expect(normalizeDecision({ decision: "d", sources: ["a.md"], status })?.status).toBe("open");
    }
  });

  it("한국어 상태 값도 받는다", () => {
    expect(normalizeDecision({ decision: "d", sources: ["a.md"], status: "완료" })?.status).toBe(
      "done"
    );
    expect(
      normalizeDecision({ decision: "d", sources: ["a.md"], status: "대체됨" })?.status
    ).toBe("superseded");
  });

  it("형식이 틀린 날짜는 빈 문자열로 둔다(추측하지 않는다)", () => {
    for (const bad of ["2026-9-1", "지난달", "2026/09/01", 20260901]) {
      expect(normalizeDecision({ decision: "d", sources: ["a.md"], due: bad })?.due).toBe("");
    }
    expect(normalizeDecision({ decision: "d", sources: ["a.md"], due: "2026-09-30" })?.due).toBe(
      "2026-09-30"
    );
  });

  it("빈 출처 문자열은 버린다", () => {
    expect(normalizeDecision({ decision: "d", sources: ["", "  ", "a.md"] })?.sources).toEqual([
      "a.md",
    ]);
  });
});

describe("parseDecisionReport", () => {
  it("코드펜스로 감싼 응답을 파싱한다", () => {
    const text = '```json\n[{"decision":"A","sources":["a.md"]}]\n```';

    const out = parseDecisionReport(text);
    expect(out.ok).toBe(true);
    expect(out.items).toHaveLength(1);
  });

  it("빈 배열은 정상 응답이고 '결정 없음'이다", () => {
    const out = parseDecisionReport("[]");
    expect(out.ok).toBe(true);
    expect(out.items).toEqual([]);
  });

  it("해석 실패는 '결정 없음'과 구분된다", () => {
    // 잘린 응답을 "발견된 것 없음"으로 보고하면 사용자가 문제를 놓친다.
    for (const bad of ["", "JSON이 아님", "{}", null]) {
      expect(parseDecisionReport(bad).ok).toBe(false);
    }
  });

  it("무효한 원소만 버리고 나머지는 살린다", () => {
    const text = '[{"decision":"A","sources":["a.md"]},{"decision":"출처없음"}]';

    const out = parseDecisionReport(text);
    expect(out.ok).toBe(true);
    expect(out.items).toHaveLength(1);
  });
});

describe("decisionKey", () => {
  it("대소문자·구두점·공백 차이를 무시한다", () => {
    expect(decisionKey("Bedrock을 쓴다!")).toBe(decisionKey("  bedrock을   쓴다  "));
  });
});

describe("mergeLedger", () => {
  it("새 결정을 뒤에 붙인다", () => {
    const out = mergeLedger([decision({ decision: "A" })], [decision({ decision: "B" })]);

    expect(out.map((e) => e.decision)).toEqual(["A", "B"]);
  });

  it("같은 결정은 합치고 빈 칸만 채운다", () => {
    const existing = [decision({ decision: "A로 간다", owner: "", rationale: "기존 이유" })];
    const incoming = [decision({ decision: "A로 간다!", owner: "김", rationale: "새 이유" })];

    const out = mergeLedger(existing, incoming);

    expect(out).toHaveLength(1);
    // 비어 있던 담당은 채운다.
    expect(out[0].owner).toBe("김");
    // 이미 있던 이유는 덮어쓰지 않는다 — 사용자가 다듬었을 수 있다.
    expect(out[0].rationale).toBe("기존 이유");
    // 문구도 기존 것을 유지한다.
    expect(out[0].decision).toBe("A로 간다");
  });

  it("출처를 합집합으로 누적한다", () => {
    const out = mergeLedger(
      [decision({ sources: ["a.md"] })],
      [decision({ sources: ["a.md", "b.md"] })]
    );

    expect(out[0].sources).toEqual(["a.md", "b.md"]);
  });

  it("상태는 진행 방향으로만 바뀐다", () => {
    // LLM이 오래된 노트를 다시 읽어 "아직 열려 있다"고 판단하는 일이 흔하다.
    const done = mergeLedger([decision({ status: "done" })], [decision({ status: "open" })]);
    expect(done[0].status).toBe("done");

    const forward = mergeLedger([decision({ status: "open" })], [decision({ status: "done" })]);
    expect(forward[0].status).toBe("done");

    const superseded = mergeLedger(
      [decision({ status: "superseded" })],
      [decision({ status: "done" })]
    );
    expect(superseded[0].status).toBe("superseded");
  });

  it("supersededBy가 있으면 그 항목을 대체됨으로 표시한다", () => {
    const out = mergeLedger(
      [],
      [decision({ decision: "A로 간다", status: "open", supersededBy: "B로 간다" })]
    );

    expect(out[0].status).toBe("superseded");
  });

  it("자기 자신을 가리키는 supersededBy는 무시한다", () => {
    const out = mergeLedger([], [decision({ decision: "A로 간다", supersededBy: "A로 간다!" })]);

    expect(out[0].status).toBe("open");
  });

  it("빈 결정 문구는 버린다", () => {
    expect(mergeLedger([], [decision({ decision: "   " })])).toEqual([]);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const existing = [decision({ sources: ["a.md"] })];
    const before = JSON.stringify(existing);

    mergeLedger(existing, [decision({ sources: ["b.md"] })]);

    expect(JSON.stringify(existing)).toBe(before);
  });
});

describe("formatLedger", () => {
  it("열린 결정을 먼저 보여준다", () => {
    const md = formatLedger([
      decision({ decision: "완료된 것", status: "done" }),
      decision({ decision: "열린 것", status: "open" }),
    ]);

    // 열린 약속을 먼저 보는 것이 원장을 여는 주된 이유다.
    expect(md.indexOf("열림")).toBeLessThan(md.indexOf("완료"));
  });

  it("표 구조를 깨는 문자를 이스케이프한다", () => {
    const md = formatLedger([
      decision({ decision: "A | B 중 A", rationale: "여러\n줄\n이유" }),
    ]);

    // 파이프와 줄바꿈이 그대로 들어가면 표가 깨져 원장 전체가 읽히지 않는다.
    expect(md).toContain("A \\| B 중 A");
    expect(md).toContain("여러 줄 이유");
  });

  it("빈 칸은 — 로 채운다", () => {
    expect(formatLedger([decision({ owner: "", due: "" })])).toContain("—");
  });

  it("출처를 위키링크로 만든다", () => {
    const md = formatLedger([decision({ sources: ["Meetings/2026-09-01.md"] })]);
    expect(md).toContain("[[Meetings/2026-09-01]]");
  });

  it("대체된 결정에 대체 대상을 표시한다", () => {
    const md = formatLedger([
      decision({ decision: "A", status: "superseded", supersededBy: "B" }),
    ]);
    expect(md).toContain("A → B");
  });

  it("빈 원장은 안내 문구다", () => {
    expect(formatLedger([])).toBe("기록된 결정이 없습니다.");
  });
});

describe("buildDecisionPrompt", () => {
  it("모르면 비우라고 명시한다", () => {
    // 추측해서 채우면 원장이 근거 없는 값으로 오염되고 사용자가 확인할 방법이 없다.
    const prompt = buildDecisionPrompt("배포", [{ path: "a.md", excerpt: "내용" }]);

    expect(prompt).toContain("명시된 경우에만");
    expect(prompt).toContain("지어내면 안 됩니다");
    expect(prompt).toContain("[]");
  });

  it("노트 경로와 발췌를 문맥에 담는다", () => {
    const prompt = buildDecisionPrompt("배포", [{ path: "Notes/a.md", excerpt: "결정 내용" }]);

    expect(prompt).toContain("Notes/a.md");
    expect(prompt).toContain("결정 내용");
  });

  it("아이디어와 결정을 구분하라고 지시한다", () => {
    expect(buildDecisionPrompt("t", [])).toContain("아이디어·후보·논의 중인 사항은 결정이 아닙니다");
  });
});

describe("parseLedger — formatLedger와의 왕복", () => {
  it("상태·결정·이유·담당·기한·출처를 되읽는다", () => {
    const entries = [
      decision({
        decision: "Bedrock을 쓴다",
        rationale: "한 계정에서 임베딩과 채팅",
        owner: "김",
        due: "2026-10-01",
        sources: ["Meetings/a.md", "Notes/b.md"],
        status: "open",
      }),
    ];

    const back = parseLedger(formatLedger(entries));

    expect(back).toHaveLength(1);
    expect(back[0].decision).toBe("Bedrock을 쓴다");
    expect(back[0].rationale).toBe("한 계정에서 임베딩과 채팅");
    expect(back[0].owner).toBe("김");
    expect(back[0].due).toBe("2026-10-01");
    expect(back[0].sources).toEqual(["Meetings/a.md", "Notes/b.md"]);
    expect(back[0].status).toBe("open");
  });

  it("상태별 섹션을 각각 되읽는다", () => {
    const entries = [
      decision({ decision: "A", status: "open" }),
      decision({ decision: "B", status: "done" }),
      decision({ decision: "C", status: "superseded", supersededBy: "D" }),
    ];

    const back = parseLedger(formatLedger(entries));

    expect(back.map((e) => [e.decision, e.status])).toEqual([
      ["A", "open"],
      ["B", "done"],
      ["C", "superseded"],
    ]);
    expect(back.find((e) => e.decision === "C")?.supersededBy).toBe("D");
  });

  it("이스케이프된 파이프를 칸 구분자로 오인하지 않는다", () => {
    const entries = [decision({ decision: "A | B 중 A", rationale: "이유 | 추가" })];

    const back = parseLedger(formatLedger(entries));

    expect(back).toHaveLength(1);
    expect(back[0].decision).toBe("A | B 중 A");
    expect(back[0].rationale).toBe("이유 | 추가");
  });

  it("빈 칸 표시(—)를 빈 문자열로 되읽는다", () => {
    const back = parseLedger(formatLedger([decision({ owner: "", due: "" })]));

    expect(back[0].owner).toBe("");
    expect(back[0].due).toBe("");
  });

  it("표가 아닌 내용은 무시한다", () => {
    const md = ["# 결정 원장", "", "사용자가 직접 쓴 메모입니다.", "", formatLedger([decision()])].join(
      "\n"
    );

    expect(parseLedger(md)).toHaveLength(1);
  });

  it("출처가 없는 행은 버린다", () => {
    // 검증 불가한 항목이 되읽기로 다시 들어오면 안 된다.
    const md = ["### 열림 (1)", "", "| 결정 | 이유 | 담당 | 기한 | 근거 |", "| --- | --- | --- | --- | --- |", "| A | 이유 | — | — | — |"].join("\n");

    expect(parseLedger(md)).toEqual([]);
  });

  it("빈 원장 안내 문구에서는 아무것도 읽지 않는다", () => {
    expect(parseLedger(formatLedger([]))).toEqual([]);
  });

  it("왕복 후 병합해도 항목이 늘어나지 않는다", () => {
    // 이게 축적의 핵심 성질이다 — 매 실행마다 같은 결정이 중복 기록되면 원장이 망가진다.
    const entries = [decision({ decision: "A" }), decision({ decision: "B", status: "done" })];
    const ledger = formatLedger(entries);

    const merged = mergeLedger(parseLedger(ledger), parseLedger(ledger));

    expect(merged).toHaveLength(2);
    expect(formatLedger(merged)).toBe(ledger);
  });
});
