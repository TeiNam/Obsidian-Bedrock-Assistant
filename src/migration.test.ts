import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { planMigrations, planCredentialMigration, legacyDataFileNames } from "./migration";

describe("legacyDataFileNames", () => {
  it("주어진 ID로 볼트 데이터 4개 파일명을 생성한다", () => {
    const names = legacyDataFileNames("bedrock-assistant");

    expect(names).toEqual([
      ".bedrock-assistant-index.json",
      ".bedrock-assistant-chat.json",
      ".bedrock-assistant-sessions.json",
      ".bedrock-assistant-sessions.json.bak",
    ]);
  });
});

describe("planMigrations", () => {
  // 헬퍼: 존재하는 경로 집합을 받아 exists 함수를 만든다
  const existsFrom = (paths: readonly string[]) => (p: string) => paths.includes(p);

  it("레거시 파일이 있고 신 파일이 없으면 복사 작업을 만든다", () => {
    const tasks = planMigrations(
      ["bedrock-assistant"],
      "obsidian-ai-assistant",
      existsFrom([".bedrock-assistant-index.json"]),
      ".obsidian"
    );

    expect(tasks).toEqual([
      {
        from: ".bedrock-assistant-index.json",
        to: ".obsidian-ai-assistant-index.json",
      },
    ]);
  });

  it("신 파일이 이미 있으면 건너뛴다 (재실행 안전)", () => {
    const tasks = planMigrations(
      ["bedrock-assistant"],
      "obsidian-ai-assistant",
      existsFrom([
        ".bedrock-assistant-index.json",
        ".obsidian-ai-assistant-index.json",
      ]),
      ".obsidian"
    );

    expect(tasks).toEqual([]);
  });

  it("레거시 파일이 없으면 빈 배열을 반환한다", () => {
    const tasks = planMigrations(
      ["bedrock-assistant"],
      "obsidian-ai-assistant",
      existsFrom([]),
      ".obsidian"
    );

    expect(tasks).toEqual([]);
  });

  it("두 레거시 ID에 같은 대상이 존재하면 앞선 ID를 우선한다", () => {
    const tasks = planMigrations(
      ["bedrock-assistant", "assistant-kiro"],
      "obsidian-ai-assistant",
      existsFrom([
        ".bedrock-assistant-index.json",
        ".assistant-kiro-index.json",
      ]),
      ".obsidian"
    );

    // 같은 to에 대해 하나만 나와야 하고, 앞선 ID(bedrock-assistant)여야 한다
    expect(tasks).toHaveLength(1);
    expect(tasks[0].from).toBe(".bedrock-assistant-index.json");
  });

  it("두 레거시 ID가 서로 다른 파일을 가지면 둘 다 복사한다", () => {
    const tasks = planMigrations(
      ["bedrock-assistant", "assistant-kiro"],
      "obsidian-ai-assistant",
      existsFrom([
        ".bedrock-assistant-index.json",
        ".assistant-kiro-chat.json",
      ]),
      ".obsidian"
    );

    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.to).sort()).toEqual([
      ".obsidian-ai-assistant-chat.json",
      ".obsidian-ai-assistant-index.json",
    ]);
  });

  it("레거시 A와 B가 서로 다른 종류의 파일을 가지면 둘 다 복사한다", () => {
    const tasks = planMigrations(
      ["bedrock-assistant", "assistant-kiro"],
      "obsidian-ai-assistant",
      existsFrom([
        ".obsidian/plugins/bedrock-assistant/data.json",
        ".obsidian/plugins/assistant-kiro/mcp.json",
      ]),
      ".obsidian"
    );

    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.from).sort()).toEqual([
      ".obsidian/plugins/assistant-kiro/mcp.json",
      ".obsidian/plugins/bedrock-assistant/data.json",
    ]);
  });

  it("같은 data.json이 양쪽에 있으면 앞선 레거시 ID의 것을 복사한다", () => {
    const tasks = planMigrations(
      ["bedrock-assistant", "assistant-kiro"],
      "obsidian-ai-assistant",
      existsFrom([
        ".obsidian/plugins/bedrock-assistant/data.json",
        ".obsidian/plugins/bedrock-assistant/mcp.json",
        ".obsidian/plugins/assistant-kiro/data.json",
      ]),
      ".obsidian"
    );

    // data.json은 bedrock 것 하나만, mcp.json도 bedrock 것 하나.
    expect(tasks).toHaveLength(2);
    const dataTask = tasks.find((t) => t.to.endsWith("data.json"));
    expect(dataTask?.from).toBe(".obsidian/plugins/bedrock-assistant/data.json");
  });

  it("MCP 설정 경로도 계획에 포함한다", () => {
    const tasks = planMigrations(
      ["bedrock-assistant"],
      "obsidian-ai-assistant",
      existsFrom([".obsidian/plugins/bedrock-assistant/mcp.json"]),
      ".obsidian"
    );

    expect(tasks).toEqual([
      {
        from: ".obsidian/plugins/bedrock-assistant/mcp.json",
        to: ".obsidian/plugins/obsidian-ai-assistant/mcp.json",
      },
    ]);
  });

  // data.json은 Plugin.loadData()가 읽는 설정 파일이다. 이것을 빠뜨리면
  // 사용자의 모든 설정(백엔드·모델·리전·Second Brain·커스텀 스킬)이 초기화된다.
  it("data.json도 계획에 포함한다", () => {
    const tasks = planMigrations(
      ["bedrock-assistant"],
      "obsidian-ai-assistant",
      existsFrom([".obsidian/plugins/bedrock-assistant/data.json"]),
      ".obsidian"
    );

    expect(tasks).toEqual([
      {
        from: ".obsidian/plugins/bedrock-assistant/data.json",
        to: ".obsidian/plugins/obsidian-ai-assistant/data.json",
      },
    ]);
  });

  it("configDir이 커스텀이어도 플러그인 폴더 경로를 올바르게 만든다", () => {
    const tasks = planMigrations(
      ["bedrock-assistant"],
      "obsidian-ai-assistant",
      existsFrom(["my-config/plugins/bedrock-assistant/mcp.json"]),
      "my-config"
    );

    expect(tasks[0].from).toBe("my-config/plugins/bedrock-assistant/mcp.json");
    expect(tasks[0].to).toBe("my-config/plugins/obsidian-ai-assistant/mcp.json");
  });

  it("볼트 데이터 4개와 플러그인 폴더 2개가 모두 있으면 6개 작업을 만든다", () => {
    const tasks = planMigrations(
      ["bedrock-assistant"],
      "obsidian-ai-assistant",
      existsFrom([
        ".bedrock-assistant-index.json",
        ".bedrock-assistant-chat.json",
        ".bedrock-assistant-sessions.json",
        ".bedrock-assistant-sessions.json.bak",
        ".obsidian/plugins/bedrock-assistant/data.json",
        ".obsidian/plugins/bedrock-assistant/mcp.json",
      ]),
      ".obsidian"
    );

    expect(tasks).toHaveLength(6);
  });

  it("신 ID가 레거시 ID와 같으면 아무 작업도 만들지 않는다", () => {
    const tasks = planMigrations(
      ["obsidian-ai-assistant"],
      "obsidian-ai-assistant",
      existsFrom([".obsidian-ai-assistant-index.json"]),
      ".obsidian"
    );

    expect(tasks).toEqual([]);
  });
});

describe("planCredentialMigration", () => {
  it("레거시 자격증명 파일이 있으면 파일명 쌍을 반환한다", () => {
    const task = planCredentialMigration(
      ["bedrock-assistant"],
      "obsidian-ai-assistant",
      (name) => name === "bedrock-assistant-credentials.json"
    );

    expect(task).toEqual({
      from: "bedrock-assistant-credentials.json",
      to: "obsidian-ai-assistant-credentials.json",
    });
  });

  it("신 파일이 이미 있으면 null을 반환한다", () => {
    const task = planCredentialMigration(
      ["bedrock-assistant"],
      "obsidian-ai-assistant",
      (name) =>
        name === "bedrock-assistant-credentials.json" ||
        name === "obsidian-ai-assistant-credentials.json"
    );

    expect(task).toBeNull();
  });

  it("레거시 파일이 없으면 null을 반환한다", () => {
    const task = planCredentialMigration(
      ["bedrock-assistant", "assistant-kiro"],
      "obsidian-ai-assistant",
      () => false
    );

    expect(task).toBeNull();
  });

  it("두 레거시가 모두 있으면 앞선 ID를 택한다", () => {
    // 레거시 2개만 존재하고 대상은 없는 상태. endsWith로 판정하면 대상까지
    // 존재로 잡혀 함수가 null을 반환하므로, 레거시 파일명을 정확히 열거한다.
    const task = planCredentialMigration(
      ["bedrock-assistant", "assistant-kiro"],
      "obsidian-ai-assistant",
      (name) =>
        name === "bedrock-assistant-credentials.json" ||
        name === "assistant-kiro-credentials.json"
    );

    expect(task?.from).toBe("bedrock-assistant-credentials.json");
  });
});

// ============================================
// 속성 테스트
// ============================================

describe("planMigrations 속성", () => {
  // 플러그인 ID로 쓰일 수 있는 문자열(소문자·숫자·하이픈, 1자 이상)
  const idArb = fc
    .stringMatching(/^[a-z0-9-]+$/)
    .filter((s) => s.length > 0 && s.length < 40);

  it("아무 파일도 없으면 항상 빈 배열이다", () => {
    fc.assert(
      fc.property(idArb, idArb, (legacy, next) => {
        const tasks = planMigrations([legacy], next, () => false, ".obsidian");
        expect(tasks).toEqual([]);
      })
    );
  });

  it("레거시 ID와 신 ID가 같으면 자기 복사를 만들지 않는다", () => {
    fc.assert(
      fc.property(idArb, (id) => {
        // 모든 경로가 존재해도 자기 자신으로의 복사는 나오지 않아야 한다.
        const tasks = planMigrations([id], id, () => true, ".obsidian");
        expect(tasks).toEqual([]);
      })
    );
  });

  it("서로 다른 ID면 모든 작업의 from과 to가 다르고, 작업이 하나 이상 나온다", () => {
    fc.assert(
      fc.property(idArb, idArb, (legacy, next) => {
        // 같은 ID가 생성되면 이 속성의 대상이 아니다(위 테스트가 담당).
        fc.pre(legacy !== next);
        // 레거시 경로만 존재하고 신 경로는 없는 상태 — 마이그레이션이 필요하다.
        const legacyPaths = new Set([
          ...legacyDataFileNames(legacy),
          `.obsidian/plugins/${legacy}/data.json`,
          `.obsidian/plugins/${legacy}/mcp.json`,
        ]);
        const tasks = planMigrations(
          [legacy],
          next,
          (p) => legacyPaths.has(p),
          ".obsidian"
        );
        // 레거시만 존재하므로 작업이 나와야 한다.
        expect(tasks.length).toBeGreaterThan(0);
        for (const t of tasks) {
          expect(t.from).not.toBe(t.to);
        }
      })
    );
  });

  it("to 경로에 중복이 없다", () => {
    fc.assert(
      fc.property(idArb, idArb, idArb, (legacyA, legacyB, next) => {
        const tasks = planMigrations([legacyA, legacyB], next, () => true, ".obsidian");
        const targets = tasks.map((t) => t.to);
        expect(new Set(targets).size).toBe(targets.length);
      })
    );
  });

  it("두 번 실행하면(첫 실행 결과가 반영된 상태) 두 번째는 빈 배열이다", () => {
    fc.assert(
      fc.property(idArb, idArb, (legacy, next) => {
        // 1차: 레거시만 존재
        const legacyPaths = new Set([
          ...legacyDataFileNames(legacy),
          `.obsidian/plugins/${legacy}/data.json`,
          `.obsidian/plugins/${legacy}/mcp.json`,
        ]);
        const first = planMigrations(
          [legacy],
          next,
          (p) => legacyPaths.has(p),
          ".obsidian"
        );

        // 1차 결과를 반영: to 경로들이 생겼다고 가정
        const afterFirst = new Set([...legacyPaths, ...first.map((t) => t.to)]);
        const second = planMigrations(
          [legacy],
          next,
          (p) => afterFirst.has(p),
          ".obsidian"
        );

        expect(second).toEqual([]);
      })
    );
  });
});
