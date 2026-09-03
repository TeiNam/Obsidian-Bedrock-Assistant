import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  normalizeDecision,
  effectiveStatus,
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

  it("대체 대상을 별 칸에 적는다", () => {
    const md = formatLedger([
      decision({ decision: "A", status: "superseded", supersededBy: "B" }),
    ]);

    // 결정 칸에 화살표로 붙이지 않는다 — 문구에 " → "가 있으면 되읽기가 깨진다.
    expect(md).toContain("| 결정 | 이유 | 담당 | 기한 | 대체 | 근거 |");
    expect(md).not.toContain("A → B");
    expect(md).toContain("| A |");
    expect(md).toContain("| B |");
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

describe("parseLedger — 문구에 화살표가 있는 경우", () => {
  it("열린 결정 문구의 ' → '를 대체 관계로 오인하지 않는다", () => {
    // "모놀리식 → 마이크로서비스로 전환한다" 같은 문구가 잘려나가고 대체됨으로
    // 잘못 표시되던 결함. formatLedger는 대체됨 항목에만 화살표를 붙이므로
    // 그 섹션에서만 해석해야 한다.
    const e = decision({ decision: "모놀리식 → 마이크로서비스로 전환한다", status: "open" });

    const back = parseLedger(formatLedger([e]));

    expect(back[0].decision).toBe("모놀리식 → 마이크로서비스로 전환한다");
    expect(back[0].supersededBy).toBe("");
    expect(mergeLedger([], back)[0].status).toBe("open");
  });

  it("완료 섹션에서도 화살표를 해석하지 않는다", () => {
    const e = decision({ decision: "A → B 순서로 배포한다", status: "done" });

    expect(parseLedger(formatLedger([e]))[0].decision).toBe("A → B 순서로 배포한다");
  });

  it("대체됨 섹션에서는 여전히 대체 대상을 되읽는다", () => {
    const e = decision({ decision: "구 방식", status: "superseded", supersededBy: "신 방식" });

    const back = parseLedger(formatLedger([e]));
    expect(back[0].decision).toBe("구 방식");
    expect(back[0].supersededBy).toBe("신 방식");
  });

  it("대체됨 항목의 문구에 화살표가 있어도 대체 대상과 섞이지 않는다", () => {
    const e = decision({
      decision: "A → B 전환",
      status: "superseded",
      supersededBy: "C로 직행",
    });

    const back = parseLedger(formatLedger([e]));
    expect(back[0].decision).toBe("A → B 전환");
    expect(back[0].supersededBy).toBe("C로 직행");
  });

  it("대체 대상이 없는 대체됨 항목의 문구도 보존된다", () => {
    // 속성 테스트가 찾은 경우: "가 → 가"가 대체됨 상태이고 대체 대상이 비어 있으면
    // 화살표 인코딩에서는 문구가 "가"로 잘려 다른 결정과 합쳐졌다.
    const e = decision({ decision: "가 → 가", status: "superseded", supersededBy: "" });

    const back = parseLedger(formatLedger([e]));
    expect(back[0].decision).toBe("가 → 가");
    expect(back[0].supersededBy).toBe("");
  });

  it("손으로 적은 5칸 행도 읽는다(대체 칸 없음)", () => {
    const md = [
      "### 열림 (1)",
      "",
      "| 결정 | 이유 | 담당 | 기한 | 근거 |",
      "| --- | --- | --- | --- | --- |",
      "| 직접 적은 결정 | 이유 | — | — | [[a]] |",
    ].join("\n");

    const back = parseLedger(md);
    expect(back).toHaveLength(1);
    expect(back[0].decision).toBe("직접 적은 결정");
    expect(back[0].sources).toEqual(["a.md"]);
    expect(back[0].supersededBy).toBe("");
  });
});

// ============================================
// Property: 원장 왕복 안정성
// ============================================
/**
 * 화살표 결함(문구의 " → "가 대체 관계로 오인됨)은 구체적 예시를 떠올려야 발견되는
 * 종류였다. 같은 부류(표 구조를 흔드는 문자가 문구에 들어오는 경우)를 통째로 잡기 위해
 * 적대적 문자를 섞은 무작위 입력으로 왕복 안정성을 확인한다.
 *
 * 문서화된 손실은 생성기에서 제외한다 — rationale의 줄바꿈은 공백으로 접히고,
 * "—"는 빈 칸 표시라 빈 문자열로 되읽히며, decidedOn은 표에 실리지 않는다.
 */
describe("Property: formatLedger → parseLedger 왕복 안정성", () => {
  /** 표 구조와 파서를 흔들 만한 문자를 섞은 텍스트 생성기. */
  const adversarialText = fc
    .array(
      fc.constantFrom(
        "가",
        "A",
        "|",
        " → ",
        "[[링크]]",
        "###",
        "#태그",
        "\\|",
        "-",
        "  ",
        "0"
      ),
      { minLength: 1, maxLength: 6 }
    )
    .map((parts) => parts.join(""))
    // 앞뒤 공백만 남거나 빈 칸 표시와 같아지는 입력은 문서화된 손실이라 제외한다.
    .filter((t) => t.trim() !== "" && t.trim() !== "—");

  const entryArb = fc.record({
    decision: adversarialText,
    rationale: adversarialText,
    owner: adversarialText,
    due: fc.constantFrom("", "2026-09-30"),
    status: fc.constantFrom("open" as const, "done" as const, "superseded" as const),
    supersededBy: fc.constantFrom("", "다른 결정"),
  });

  it("결정 문구가 왕복에서 보존된다", () => {
    fc.assert(
      fc.property(entryArb, (raw) => {
        const e = decision({ ...raw, sources: ["a.md"], decidedOn: "" });
        const back = parseLedger(formatLedger([e]));

        // 문구가 잘리거나 다른 칸으로 새지 않는다.
        expect(back).toHaveLength(1);
        expect(back[0].decision).toBe(e.decision.trim());
        expect(back[0].rationale).toBe(e.rationale.trim());
        expect(back[0].owner).toBe(e.owner.trim());
      }),
      { numRuns: 300 }
    );
  });

  it("왕복 후 다시 포맷해도 같은 문서가 된다(멱등)", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 4 }), (raws) => {
        // 같은 결정 문구가 중복 생성될 수 있으므로 먼저 병합해 정본 상태를 만든다.
        const seeded = mergeLedger(
          [],
          raws.map((raw) => decision({ ...raw, sources: ["a.md"], decidedOn: "" }))
        );
        const once = formatLedger(seeded);
        const twice = formatLedger(mergeLedger(parseLedger(once), []));

        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });

  it("왕복 후 재병합해도 항목 수가 늘지 않는다", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 4 }), (raws) => {
        const seeded = mergeLedger(
          [],
          raws.map((raw) => decision({ ...raw, sources: ["a.md"], decidedOn: "" }))
        );
        const back = parseLedger(formatLedger(seeded));

        expect(mergeLedger(back, back)).toHaveLength(back.length);
      }),
      { numRuns: 200 }
    );
  });
});

describe("parseLedger — 구분선·헤더 오인", () => {
  it("`---`로 시작하는 결정이 구분선으로 오인되지 않는다", () => {
    // 속성 테스트가 찾은 결함: 접두어 "| ---"로 구분선을 판정해 이 행이 통째로
    // 버려졌고, 병합에서 항목이 사라졌다.
    const e = decision({ decision: "--- 임시 방편으로 A를 쓴다" });

    const back = parseLedger(formatLedger([e]));
    expect(back).toHaveLength(1);
    expect(back[0].decision).toBe("--- 임시 방편으로 A를 쓴다");
  });

  it("'결정'이라는 결정 문구가 헤더로 오인되지 않는다", () => {
    const e = decision({ decision: "결정", rationale: "짧은 이유" });

    expect(parseLedger(formatLedger([e]))).toHaveLength(1);
  });

  it("실제 구분선과 헤더는 여전히 건너뛴다", () => {
    const md = [
      "### 열림 (1)",
      "",
      "| 결정 | 이유 | 담당 | 기한 | 대체 | 근거 |",
      "| --- | --- | --- | --- | --- | --- |",
      "| :--- | ---: | :---: | --- | --- | --- |",
      "| 실제 결정 | 이유 | — | — | — | [[a]] |",
    ].join("\n");

    const back = parseLedger(md);
    expect(back).toHaveLength(1);
    expect(back[0].decision).toBe("실제 결정");
  });
});

// ============================================
// 근거 경로 제한
// ============================================
/**
 * 원장의 가치는 "왜 그렇게 결정했나"를 되짚을 수 있다는 것이고, 그건 근거 노트가 실재할
 * 때만 성립한다. LLM은 프롬프트에 없던 경로를 지어내는 일이 흔하다.
 */
describe("normalizeDecision — 근거 경로 제한", () => {
  const raw = {
    decision: "A를 쓴다",
    rationale: "빠르다",
    sources: ["Notes/실재.md", "Notes/지어냄.md"],
  };
  const allowed = new Set(["Notes/실재.md"]);

  it("허용 집합에 없는 근거를 버린다", () => {
    expect(normalizeDecision(raw, allowed)?.sources).toEqual(["Notes/실재.md"]);
  });

  it("남는 근거가 없으면 항목 자체를 버린다", () => {
    // 근거 없는 결정은 검증할 수 없고, 검증할 수 없는 항목이 쌓이면 원장을 못 믿는다.
    expect(normalizeDecision(raw, new Set(["다른.md"]))).toBeNull();
  });

  it("허용 집합을 주지 않으면 제한하지 않는다", () => {
    expect(normalizeDecision(raw)?.sources).toHaveLength(2);
  });
});

describe("parseDecisionReport — 전부 무효인 응답", () => {
  it("모두 버려진 경우를 '결정 없음'과 구분한다", () => {
    // "0건"으로 보고하면 사용자가 LLM의 경로 날조를 눈치채지 못한다.
    const text = JSON.stringify([
      { decision: "A", sources: ["지어냄.md"] },
      { decision: "B", sources: ["또지어냄.md"] },
    ]);

    const out = parseDecisionReport(text, new Set(["실재.md"]));

    expect(out.ok).toBe(true);
    expect(out.items).toEqual([]);
    expect(out.dropped).toBe(2);
  });

  it("정말로 결정이 없으면 dropped도 0이다", () => {
    const out = parseDecisionReport("[]", new Set(["실재.md"]));

    expect(out.ok).toBe(true);
    expect(out.dropped).toBe(0);
  });
});

// ============================================
// 승인 화면과 병합의 상태 판정 일치
// ============================================
/**
 * LLM은 `status: "open"`과 `supersededBy: "B로 간다"`를 같이 돌려주는 일이 흔하다.
 * 승인 화면이 원시 status를 보여주면 사용자는 "열림"으로 보고 승인한 뒤 원장에서
 * "대체됨"을 발견한다 — 보지 않은 상태 전환을 승인한 셈이다.
 */
describe("effectiveStatus", () => {
  it("supersededBy가 다른 결정을 가리키면 대체됨이다", () => {
    const e = decision({ decision: "A로 간다", status: "open", supersededBy: "B로 간다" });
    expect(effectiveStatus(e)).toBe("superseded");
  });

  it("자기 자신을 가리키면 원래 상태를 유지한다", () => {
    const e = decision({ decision: "A로 간다", status: "open", supersededBy: "A로 간다!" });
    expect(effectiveStatus(e)).toBe("open");
  });

  it("supersededBy가 비면 원래 상태다", () => {
    expect(effectiveStatus(decision({ status: "done", supersededBy: "" }))).toBe("done");
  });

  it("mergeLedger가 기록하는 상태와 일치한다", () => {
    // 두 판정이 갈라지면 화면과 원장이 다른 말을 한다.
    const entries = [
      decision({ decision: "A", status: "open", supersededBy: "B" }),
      decision({ decision: "C", status: "open", supersededBy: "" }),
      decision({ decision: "D", status: "done", supersededBy: "E" }),
    ];

    const merged = mergeLedger([], entries);

    for (const entry of entries) {
      const found = merged.find((m) => decisionKey(m.decision) === decisionKey(entry.decision));
      expect(found?.status).toBe(effectiveStatus(entry));
    }
  });
});
