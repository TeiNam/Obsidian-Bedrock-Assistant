import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class {},
  TFolder: class {},
  Notice: class {},
}));

import {
  parseCategory,
  organizeVaultPara,
  PARA_MAX_CLASSIFICATIONS,
} from "./para-organizer";

// ============================================
// P.A.R.A 분류 응답 파싱 회귀 테스트
// ============================================
// 배경(리뷰 확인 결함):
//  1) 분류 실패 시 무조건 "resources"로 이동해 사용자 폴더 구조를 임의 재배치했다.
//  2) 단순 includes 매칭은 실패 응답("cannot choose projects, areas, ...")도
//     첫 카테고리로 오판해 노트를 잘못 옮긴다.

describe("parseCategory: 정상 응답", () => {
  it("카테고리 단어만 있는 응답을 인식한다", () => {
    expect(parseCategory("projects")).toBe("projects");
    expect(parseCategory("areas")).toBe("areas");
    expect(parseCategory("resources")).toBe("resources");
    expect(parseCategory("archives")).toBe("archives");
  });

  it("대소문자·공백·구두점을 허용한다", () => {
    expect(parseCategory("  Projects  ")).toBe("projects");
    expect(parseCategory("ARCHIVES.")).toBe("archives");
    expect(parseCategory("**areas**")).toBe("areas");
    expect(parseCategory('"resources"')).toBe("resources");
  });

  it("추론 서두 뒤 마지막 줄의 결론을 사용한다", () => {
    // 추론 모델은 사고 과정을 쓴 뒤 마지막에 답을 적는 경우가 있다.
    expect(parseCategory("이 노트는 진행 중인 작업으로 보입니다.\nprojects")).toBe("projects");
    expect(parseCategory("Let me think...\n\nAnswer:\narchives")).toBe("archives");
  });
});

describe("parseCategory: 실패 응답을 정상 분류로 오인하지 않는다", () => {
  it("카테고리 단어가 문장에 섞인 실패 응답은 null이다", () => {
    // 핵심 회귀 케이스 — includes 매칭이면 "projects"로 오판한다.
    expect(parseCategory("cannot choose projects, areas, resources, or archives")).toBeNull();
    expect(parseCategory("I am unable to classify this note into projects")).toBeNull();
  });

  it("빈/공백 응답은 null이다", () => {
    expect(parseCategory("")).toBeNull();
    expect(parseCategory("   \n  ")).toBeNull();
  });

  it("카테고리가 아닌 단어는 null이다", () => {
    expect(parseCategory("unknown")).toBeNull();
    expect(parseCategory("misc")).toBeNull();
  });

  it("null/undefined 입력을 안전하게 처리한다", () => {
    expect(parseCategory(undefined as unknown as string)).toBeNull();
    expect(parseCategory(null as unknown as string)).toBeNull();
  });
});

describe("PARA_MAX_CLASSIFICATIONS: 호출 상한", () => {
  it("노트당 1회 LLM 호출이므로 상한이 정의되어 있다", () => {
    // 상한이 없으면 대형 볼트에서 비용·소요 시간이 통제 불가로 커진다.
    expect(PARA_MAX_CLASSIFICATIONS).toBeGreaterThan(0);
    expect(Number.isInteger(PARA_MAX_CLASSIFICATIONS)).toBe(true);
  });
});

// ============================================
// 호출 예산 회귀 테스트 (굶주림 방지)
// ============================================
// 기존 구현은 "파일 수" 상한(slice)이었다. 앞자리 파일이 LLM 호출 없이 건너뛰어도
// 슬롯을 점거하므로, 재실행할 때마다 같은 파일들이 앞에 오고 뒤쪽 파일은 영구히
// 처리되지 않았다. 지금은 실제 LLM "호출 수"만 예산에서 차감한다.

interface FakeFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
}

function makeParaEnv(fileCount: number, existingTargets: Set<string> = new Set()) {
  const files: FakeFile[] = Array.from({ length: fileCount }, (_, i) => ({
    path: `note${i}.md`,
    name: `note${i}.md`,
    basename: `note${i}`,
    extension: "md",
  }));
  const renamed: string[] = [];
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => files,
      cachedRead: async () => "본문",
      // P.A.R.A 폴더는 이미 존재한다고 보고, 이동 대상 충돌만 제어한다.
      getAbstractFileByPath: (p: string) =>
        p.startsWith("0") && !p.includes("/") ? {} : existingTargets.has(p) ? {} : null,
      createFolder: async () => {},
      rename: async (f: FakeFile, to: string) => {
        renamed.push(to);
      },
      getAllLoadedFiles: () => [],
      delete: async () => {},
    },
  };
  return { app, files, renamed };
}

function makePlugin(respond: () => string) {
  const calls = { count: 0 };
  const plugin = {
    aiClient: {
      converseLight: async () => {
        calls.count++;
        return { text: respond() };
      },
    },
  };
  return { plugin, calls };
}

describe("organizeVaultPara: LLM 호출 예산", () => {
  it("네 폴더 모두 이름이 충돌하는 파일은 호출 없이 건너뛴다", async () => {
    // note0은 어떤 분류가 나와도 이동할 수 없다 → 호출 예산을 써서는 안 된다.
    const collide = new Set([
      "01. Projects/note0.md",
      "02. Areas/note0.md",
      "03. Resources/note0.md",
      "04. Archives/note0.md",
    ]);
    const { app } = makeParaEnv(3, collide);
    const { plugin, calls } = makePlugin(() => "resources");

    const result = await organizeVaultPara(app as never, plugin as never);

    // note1, note2만 호출한다. note0에 호출을 쓰면 매 실행마다 예산을 낭비한다.
    expect(calls.count).toBe(2);
    expect(result.skipped).toContain("note0.md");
    expect(result.moved.map((m) => m.from)).toEqual(["note1.md", "note2.md"]);
  });

  it("분류 실패는 skipped가 아니라 errors로 보고한다", async () => {
    const { app } = makeParaEnv(1);
    // 카테고리로 판별할 수 없는 응답 → 이동하지 않는다.
    const { plugin } = makePlugin(() => "I cannot decide.");

    const result = await organizeVaultPara(app as never, plugin as never);

    expect(result.moved).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.errors.some((e) => e.includes("note0.md") && e.includes("분류 실패"))).toBe(true);
  });

  it("연속 실패가 누적되면 중단하고 남은 파일을 보고한다", async () => {
    const { app } = makeParaEnv(30);
    const { plugin, calls } = makePlugin(() => "error");

    const result = await organizeVaultPara(app as never, plugin as never);

    // 상한(200)까지 태우지 않고 연속 실패 임계에서 멈춘다.
    expect(calls.count).toBeLessThan(30);
    expect(result.errors.some((e) => e.includes("연속 실패"))).toBe(true);
    expect(result.errors.some((e) => e.includes("중단으로"))).toBe(true);
  });
});
