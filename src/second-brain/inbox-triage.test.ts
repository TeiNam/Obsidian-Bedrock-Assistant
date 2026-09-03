import { describe, it, expect } from "vitest";
import {
  sanitizeTitle,
  sanitizeTag,
  normalizeTriagePlan,
  hasActionableSuggestion,
  parseTriageReport,
  resolveTargetPath,
  buildTriagePrompt,
  MAX_TRIAGE_NOTES,
  type TriagePlan,
} from "./inbox-triage";

const FOLDERS = new Set(["Projects", "Areas", "Areas/Work"]);
const PATHS = new Set(["Inbox/무제 1.md", "Inbox/메모.md"]);

function plan(overrides: Partial<TriagePlan> = {}): TriagePlan {
  return {
    path: "Inbox/무제 1.md",
    suggestedTitle: "쿠버네티스 배포 정리",
    suggestedFolder: "Projects",
    tags: ["k8s"],
    splitHint: "",
    reason: "내용이 배포 절차다",
    ...overrides,
  };
}

describe("sanitizeTitle", () => {
  it("경로 구분자와 링크 문법 문자를 제거한다", () => {
    // LLM이 "폴더/제목" 형태로 돌려주면 의도치 않은 하위 폴더가 생긴다.
    expect(sanitizeTitle("Projects/배포 [정리]")).toBe("Projects 배포 정리");
    expect(sanitizeTitle('a:b*c?d"e<f>g|h#i^j')).toBe("a b c d e f g h i j");
  });

  it("공백을 정리한다", () => {
    expect(sanitizeTitle("  여러   공백  ")).toBe("여러 공백");
  });
});

describe("sanitizeTag", () => {
  it("선행 #을 떼고 소문자로 만든다", () => {
    expect(sanitizeTag("#Work")).toBe("work");
  });

  it("내부 공백을 하이픈으로 바꾼다", () => {
    expect(sanitizeTag("machine learning")).toBe("machine-learning");
  });

  it("태그에 쓸 수 없는 문자를 버린다", () => {
    expect(sanitizeTag("a!b@c")).toBe("abc");
  });

  it("계층 태그의 슬래시는 유지한다", () => {
    expect(sanitizeTag("#work/project")).toBe("work/project");
  });
});

describe("normalizeTriagePlan", () => {
  it("실재하는 노트와 폴더만 받는다", () => {
    const out = normalizeTriagePlan(
      { path: "Inbox/무제 1.md", suggestedFolder: "Projects", tags: ["#K8s"] },
      FOLDERS,
      PATHS
    );

    expect(out?.suggestedFolder).toBe("Projects");
    expect(out?.tags).toEqual(["k8s"]);
  });

  it("실재하지 않는 노트 경로는 버린다", () => {
    // 경로를 지어낸 응답을 걸러낸다.
    expect(
      normalizeTriagePlan({ path: "없는노트.md", suggestedTitle: "제목" }, FOLDERS, PATHS)
    ).toBeNull();
  });

  it("실재하지 않는 폴더 제안은 버리고 나머지는 살린다", () => {
    // LLM이 그럴듯한 폴더를 지어내면 새 폴더가 조용히 생기고 볼트 구조가 어긋난다.
    const out = normalizeTriagePlan(
      { path: "Inbox/메모.md", suggestedFolder: "지어낸폴더", suggestedTitle: "괜찮은 제목" },
      FOLDERS,
      PATHS
    );

    expect(out?.suggestedFolder).toBe("");
    expect(out?.suggestedTitle).toBe("괜찮은 제목");
  });

  it("볼트를 벗어나는 폴더 제안을 거부한다", () => {
    for (const folder of ["../밖", "/etc", "C:/temp", "Projects/../../밖"]) {
      const out = normalizeTriagePlan(
        { path: "Inbox/메모.md", suggestedFolder: folder, suggestedTitle: "제목" },
        FOLDERS,
        PATHS
      );
      expect(out?.suggestedFolder).toBe("");
    }
  });

  it("중복 태그를 합친다", () => {
    const out = normalizeTriagePlan(
      { path: "Inbox/메모.md", tags: ["#Work", "work", "WORK"] },
      FOLDERS,
      PATHS
    );

    expect(out?.tags).toEqual(["work"]);
  });

  it("바꿀 것이 하나도 없으면 버린다", () => {
    // 보여줄 이유가 없는 항목이 목록을 채우면 검토가 어려워진다.
    expect(
      normalizeTriagePlan({ path: "Inbox/메모.md", reason: "이유만 있음" }, FOLDERS, PATHS)
    ).toBeNull();
  });

  it("객체가 아니면 버린다", () => {
    for (const bad of [null, "문자열", 42, []]) {
      expect(normalizeTriagePlan(bad, FOLDERS, PATHS)).toBeNull();
    }
  });
});

describe("hasActionableSuggestion", () => {
  it("제목·폴더·태그·분할 중 하나라도 있으면 true다", () => {
    expect(hasActionableSuggestion(plan({ suggestedTitle: "", suggestedFolder: "", tags: [] }))).toBe(
      false
    );
    expect(hasActionableSuggestion(plan({ suggestedTitle: "x", suggestedFolder: "", tags: [] }))).toBe(
      true
    );
    expect(
      hasActionableSuggestion(
        plan({ suggestedTitle: "", suggestedFolder: "", tags: [], splitHint: "나누세요" })
      )
    ).toBe(true);
  });
});

describe("parseTriageReport", () => {
  it("코드펜스 응답에서 유효한 제안만 뽑는다", () => {
    const text = [
      "```json",
      JSON.stringify([
        { path: "Inbox/무제 1.md", suggestedTitle: "좋은 제목" },
        { path: "없는노트.md", suggestedTitle: "버려짐" },
      ]),
      "```",
    ].join("\n");

    const out = parseTriageReport(text, FOLDERS, PATHS);
    expect(out.ok).toBe(true);
    expect(out.items).toHaveLength(1);
  });

  it("해석 실패는 '제안 없음'과 구분된다", () => {
    expect(parseTriageReport("잘린 응답", FOLDERS, PATHS).ok).toBe(false);
    expect(parseTriageReport("[]", FOLDERS, PATHS).ok).toBe(true);
  });
});

describe("resolveTargetPath", () => {
  it("제목과 폴더를 합쳐 대상 경로를 만든다", () => {
    expect(resolveTargetPath(plan(), new Set(["Inbox/무제 1.md"]))).toBe(
      "Projects/쿠버네티스 배포 정리.md"
    );
  });

  it("제목만 제안되면 현재 폴더를 유지한다", () => {
    const out = resolveTargetPath(plan({ suggestedFolder: "" }), new Set());
    expect(out).toBe("Inbox/쿠버네티스 배포 정리.md");
  });

  it("폴더만 제안되면 현재 제목을 유지한다", () => {
    const out = resolveTargetPath(plan({ suggestedTitle: "" }), new Set());
    expect(out).toBe("Projects/무제 1.md");
  });

  it("결과가 현재 경로와 같으면 null이다", () => {
    // 같은 경로로 rename을 호출하면 옵시디언이 오류를 낸다.
    const out = resolveTargetPath(
      plan({ suggestedTitle: "무제 1", suggestedFolder: "Inbox" }),
      new Set()
    );
    expect(out).toBeNull();
  });

  it("대상이 이미 있으면 null이다(덮어쓰지 않는다)", () => {
    // 이름이 겹치는 다른 노트를 덮어쓰는 것이 최악이다.
    const taken = new Set(["Projects/쿠버네티스 배포 정리.md"]);
    expect(resolveTargetPath(plan(), taken)).toBeNull();
  });

  it("루트로 이동하는 경우도 처리한다", () => {
    const out = resolveTargetPath(
      { ...plan({ suggestedFolder: "" }), path: "메모.md", suggestedTitle: "새 제목" },
      new Set()
    );
    expect(out).toBe("새 제목.md");
  });
});

describe("buildTriagePrompt", () => {
  it("폴더 목록과 자주 쓰는 태그를 함께 준다", () => {
    // 주지 않으면 매번 새 폴더·태그 체계를 지어내 볼트가 갈라진다.
    const prompt = buildTriagePrompt(
      [{ path: "Inbox/a.md", excerpt: "내용" }],
      ["Projects", "Areas"],
      ["work", "idea"]
    );

    expect(prompt).toContain("Projects, Areas");
    expect(prompt).toContain("work, idea");
    expect(prompt).toContain("새 폴더를 만들지 마세요");
  });

  it("폴더가 없으면 이동 제안을 금지한다", () => {
    const prompt = buildTriagePrompt([{ path: "a.md", excerpt: "x" }], [], []);
    expect(prompt).toContain("이동 제안 금지");
  });

  it("경로를 지어내지 말라고 지시한다", () => {
    expect(buildTriagePrompt([], [], [])).toContain("경로를 지어내면 안 됩니다");
  });
});

describe("MAX_TRIAGE_NOTES", () => {
  it("한 번에 검토할 양을 판단 가능한 수준으로 제한한다", () => {
    // 50건이 한꺼번에 올라오면 전부 체크하거나 전부 무시하게 되고 어느 쪽도 검토가 아니다.
    expect(MAX_TRIAGE_NOTES).toBeGreaterThan(0);
    expect(MAX_TRIAGE_NOTES).toBeLessThanOrEqual(20);
  });
});
