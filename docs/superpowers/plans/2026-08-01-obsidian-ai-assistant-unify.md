# obsidian-ai-assistant 단일 브랜치 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플러그인 식별자를 `bedrock-assistant` → `obsidian-ai-assistant`로 바꾸고, 기존 사용자 데이터를 자동 복사 마이그레이션하며, `kiro-edition` 브랜치를 폐기해 단일 브랜치로 통합한다.

**Architecture:** main 브랜치가 이미 프로바이더 4종(Bedrock/Gemini/OpenAI/Ollama)과 AI별 아이콘 전환을 갖추고 있다. 따라서 새 기능을 만들지 않고, 식별자 리네이밍 + 마이그레이션 + 정리에 집중한다. 마이그레이션은 "무엇을 복사할지 계산하는 순수 함수"와 "복사를 실행하는 얇은 호출부"로 분리해 테스트 가능성을 확보한다.

**Tech Stack:** TypeScript 5.4, Obsidian Plugin API, vitest 4, fast-check(속성 테스트), esbuild

## Global Constraints

- **기준 커밋:** `dc33868` (origin/main, 0.2.24). 작업 브랜치는 여기서 분기한다.
- **작업 브랜치명:** `feat/unify-ai-assistant`
- **목표 버전:** 0.3.0 (`manifest.json`, `package.json`, `versions.json` 3곳 일치)
- **신 플러그인 ID:** `obsidian-ai-assistant` (하이픈, 소문자)
- **레거시 ID 2개:** `bedrock-assistant`, `assistant-kiro` — 마이그레이션 소스로 둘 다 본다. 같은 대상에 둘 다 존재하면 `bedrock-assistant` 우선(main 계보가 정본).
- **마이그레이션은 복사(copy)다.** 이동·삭제하지 않는다. 사용자가 구 버전으로 되돌려도 동작해야 한다.
- **마이그레이션 실패는 삼킨다.** 예외를 던지면 플러그인 전체가 로드에 실패한다. 개별 작업을 각각 `try/catch`로 감싼다.
- **표시명 정책:** 프로바이더별 전환 유지(`Bedrock Assistant` / `Gemini Assistant` / `OpenAI Assistant` / `Ollama Assistant`). `manifest.json`의 `name`만 `AI Assistant`로 고정.
- **Anthropic 백엔드는 추가하지 않는다.** 임베딩 API가 없는 벤더는 지원하지 않는다는 정책을 문서에 명시한다.
- **한국어 주석.** 이 저장소의 모든 코드 주석은 한국어다. 새 코드도 한국어 주석을 단다.
- **커뮤니티 플러그인 심사 기준 (obsidian-plugin-develop 스킬):**
  - `console.log` / `console.warn` / `console.debug` **금지**. `console.error`만 허용. 현재 저장소는 0건이므로 이 상태를 유지한다.
  - `innerHTML` / `outerHTML` / `insertAdjacentHTML` 금지. `createEl()` / `createDiv()` / `createSpan()` / `setText()` 사용.
  - 하드코딩 스타일(`el.style.color`) 금지. CSS 클래스 + `var(--text-normal)` 등 테마 변수 사용.
  - `manifest.json`의 `description`은 250자 이내, 동작을 서술하는 문장으로 시작하고 마침표로 끝낸다. 이모지·특수문자 금지.
  - `manifest.json`의 `id`는 소문자와 하이픈만 쓴다.
  - Node/Electron API를 쓰므로 `isDesktopOnly: true`를 유지한다(`safe-storage.ts`가 `require("fs")`, `require("electron")`을 쓴다).
  - 설정 탭 섹션 제목은 `setHeading()`을 쓴다. `createEl("h2")` 금지.
  - 사용자 입력 경로는 `normalizePath()`를 거친다. **이 계획의 마이그레이션 경로는 사용자 입력이 아니라 코드 상수로 조립하므로 해당되지 않는다.**
- **`src/aws-profile.ts`, `src/aws-profile.test.ts`, `src/aws-profile-runtime.ts`에 이 계획과 무관한 미커밋 변경(+177/−7)이 있다.** 절대 건드리지 말고, 커밋에도 포함하지 않는다. `git add`는 항상 파일을 명시한다 — `git add -A`나 `git add .`를 쓰지 않는다.

---

## File Structure

**신규 파일:**

| 파일 | 책임 |
|---|---|
| `src/migration.ts` | 레거시 경로 → 신 경로 복사 작업 목록 계산 (순수 함수) |
| `src/migration.test.ts` | 위 함수의 단위·속성 테스트 |
| `src/plugin-detect.ts` | 커뮤니티 플러그인 활성 여부 판정 (Obsidian 비공식 API 캐스팅 격리) |
| `src/plugin-detect.test.ts` | 위 함수의 단위 테스트 |

**수정 파일:**

| 파일 | 변경 |
|---|---|
| `src/branding.ts` | `pluginId`, `viewType`, `files` 4개 값 |
| `src/safe-storage.ts` | `CREDENTIALS_FILE` 상수 |
| `src/main.ts` | `onload`에 마이그레이션 배선, `registerBrandingIcons` 주석 |
| `src/settings-tab.ts` | 추천 플러그인 절에 감지 적용, i18n 키 3개 언어 |
| `manifest.json` | `id`, `name`, `description`, `version` |
| `package.json` | `name`, `description`, `version` |
| `versions.json` | `0.3.0` 추가 |
| `.gitattributes` | `merge=ours` 줄 삭제 |
| `.kiro/steering/branch-branding.md` | 단일 브랜치 정책으로 개정 |
| `README.md`, `README-KR.md`, `README-JA.md` | 리네이밍 반영 + 마이그레이션 안내 + 지원 정책 |
| `CHANGELOG.md` | 0.3.0 항목 |

**삭제 파일:** `aws-icon.svg`(추적 안 됨), `gemini-icon.svg`, `kiro-icon.svg` — `branding.ts`에 SVG가 인라인되어 있어 참조가 없다.

---

### Task 0: 작업 브랜치 생성

**Files:** 없음 (git 조작만)

**Interfaces:**
- Consumes: 없음
- Produces: `feat/unify-ai-assistant` 브랜치

- [ ] **Step 1: 현재 상태 확인**

```bash
git switch main
git log --oneline -1
```

Expected: `dc33868 chore: bump version to 0.2.24`

다르면 중단하고 보고한다. 이 계획의 모든 행 번호는 `dc33868` 기준이다.

- [ ] **Step 2: 미커밋 변경 확인**

```bash
git status --short
```

Expected: `src/aws-profile*.ts` 3개가 ` M`으로 표시된다. 이 파일들은 이 작업과 무관하니 손대지 않는다. `.kiro/agents/`, `aws-icon.svg`, `docs/superpowers/`가 `??`로 보이는 것도 정상이다.

- [ ] **Step 3: 브랜치 생성**

```bash
git switch -c feat/unify-ai-assistant
git branch --show-current
```

Expected: `feat/unify-ai-assistant`

- [ ] **Step 4: 기준선 테스트 통과 확인**

```bash
npm test 2>&1 | tail -20
```

Expected: 전체 통과. 여기서 실패하는 테스트가 있으면 **기록해 둔다** — 이후 단계에서 내가 깬 것인지 원래 깨져 있던 것인지 구분해야 한다.

---

### Task 1: 마이그레이션 계획 함수

리네이밍 전에 만든다. 순수 함수라 리네이밍과 독립적으로 테스트할 수 있고, Task 2에서 바로 배선하면 된다.

**Files:**
- Create: `src/migration.ts`
- Test: `src/migration.test.ts`

**Interfaces:**
- Consumes: 없음 (완전 독립)
- Produces:
  - `interface MigrationTask { from: string; to: string; }`
  - `function planMigrations(legacyIds: readonly string[], newId: string, exists: (path: string) => boolean, configDir: string): MigrationTask[]`

**배경 — 마이그레이션 대상 경로 규칙**

`dc33868`의 `src/branding.ts` 80~85행과 `src/main.ts:1136`, `src/safe-storage.ts:29`, 그리고 옵시디언 `Plugin.loadData()`의 저장 위치(`obsidian.d.ts:4897` — "Data is stored in `data.json` in the plugin folder")를 근거로 한다.

| 종류 | 경로 패턴 | 예시 (레거시 `bedrock-assistant`) |
|---|---|---|
| 볼트 데이터 4개 | 볼트 루트 `.{id}-{suffix}.json` | `.bedrock-assistant-index.json`, `-chat.json`, `-sessions.json`, `-sessions.json.bak` |
| 플러그인 폴더 파일 2개 | `{configDir}/plugins/{id}/{name}` | `.obsidian/plugins/bedrock-assistant/data.json`, `.../mcp.json` |
| 자격증명 | `{id}-credentials.json` (파일명만; 디렉터리는 Electron userData) | `bedrock-assistant-credentials.json` |

**`data.json`이 가장 중요한 대상이다.** `Plugin.loadData()`/`saveData()`가 읽고 쓰는 설정 파일이며 플러그인 폴더 안에 있다. pluginId가 바뀌면 이 파일을 잃고, 그러면 사용자의 **모든 설정이 기본값으로 돌아간다** — 백엔드 선택, 모델, 리전, 인증 방식, Second Brain 설정, Graph RAG 튜닝값, 커스텀 스킬, 플래너 폴더 전부. 민감 필드는 `safe-storage`가 별도 파일로 빼내지만 나머지는 여기에만 있다.

`mcp.json`과 같은 디렉터리에 있으므로 경로 조립 로직은 동일하다 — 파일명 목록만 2개로 늘린다.

자격증명은 볼트 밖(Electron userData)에 있어 `vault.adapter`로 접근할 수 없다. **이 함수는 파일명만 계산하고, 디렉터리 결합은 호출부가 한다.** 그래서 자격증명은 별도 함수로 분리한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/migration.test.ts` 생성:

```typescript
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

  it("모든 작업의 from과 to는 서로 다르다", () => {
    fc.assert(
      fc.property(idArb, idArb, (legacy, next) => {
        const tasks = planMigrations([legacy], next, () => true, ".obsidian");
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest --run src/migration.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Failed to resolve import "./migration"` 또는 그에 준하는 모듈 미존재 에러.

- [ ] **Step 3: 최소 구현 작성**

`src/migration.ts` 생성:

```typescript
/**
 * 플러그인 ID 변경에 따른 데이터 마이그레이션 계획 계산 모듈.
 *
 * pluginId가 바뀌면 볼트 루트 데이터 파일, MCP 설정, 로컬 자격증명 파일의
 * 경로가 모두 달라진다. 이 모듈은 "무엇을 어디로 복사할지"만 계산하는 순수
 * 함수를 제공하고, 실제 파일 조작은 호출부(main.ts)가 담당한다.
 *
 * 복사(copy)이지 이동(move)이 아니다. 사용자가 구 버전으로 되돌려도 계속
 * 동작해야 하므로 원본을 남긴다.
 */

/** 단일 복사 작업. from을 to로 복사한다. */
export interface MigrationTask {
  from: string;
  to: string;
}

/** 볼트 루트 데이터 파일의 접미사 4종. branding.ts의 files 필드와 대응한다. */
const DATA_SUFFIXES = [
  "-index.json",
  "-chat.json",
  "-sessions.json",
  "-sessions.json.bak",
] as const;

/**
 * 플러그인 폴더(`{configDir}/plugins/{id}/`) 안에서 옮겨야 하는 파일들.
 *
 * - `data.json`: Plugin.loadData()/saveData()가 쓰는 설정 파일. 이것을 잃으면
 *   사용자의 모든 설정이 기본값으로 초기화된다. 가장 중요한 대상이다.
 * - `mcp.json`: MCP 서버 설정. main.ts의 MCP_CONFIG_FILE과 같은 값이다.
 */
const PLUGIN_FOLDER_FILES = ["data.json", "mcp.json"] as const;

/** 자격증명 파일명 접미사. safe-storage.ts의 CREDENTIALS_FILE 규칙과 대응한다. */
const CREDENTIALS_SUFFIX = "-credentials.json";

/**
 * 주어진 플러그인 ID에 대응하는 볼트 루트 데이터 파일명 4개를 반환한다.
 * 볼트 루트의 숨김 파일이므로 앞에 점이 붙는다.
 */
export function legacyDataFileNames(pluginId: string): string[] {
  return DATA_SUFFIXES.map((suffix) => `.${pluginId}${suffix}`);
}

/** 플러그인 폴더 안 파일의 볼트 상대 경로를 만든다. */
function pluginFolderPath(configDir: string, pluginId: string, fileName: string): string {
  return `${configDir}/plugins/${pluginId}/${fileName}`;
}

/**
 * 레거시 ID들의 볼트 내 파일을 신 ID 경로로 복사하는 작업 목록을 계산한다.
 *
 * 규칙:
 *  - 대상(to)이 이미 존재하면 건너뛴다 → 재실행해도 안전하고, 사용자가 새로
 *    만든 데이터를 덮어쓰지 않는다.
 *  - 같은 대상에 여러 레거시 ID가 후보로 걸리면 legacyIds 배열의 앞선 것을
 *    택한다. 호출부가 정본 계보를 앞에 둔다.
 *  - 레거시 ID가 신 ID와 같으면 자기 자신 복사가 되므로 제외한다.
 *
 * @param legacyIds 우선순위 순서의 레거시 플러그인 ID 목록
 * @param newId 새 플러그인 ID
 * @param exists 볼트 상대 경로의 존재 여부를 판정하는 함수
 * @param configDir 옵시디언 설정 디렉터리 (보통 ".obsidian")
 */
export function planMigrations(
  legacyIds: readonly string[],
  newId: string,
  exists: (path: string) => boolean,
  configDir: string
): MigrationTask[] {
  const tasks: MigrationTask[] = [];
  // 이미 작업이 등록된 대상. 앞선 레거시 ID가 이겼음을 기록한다.
  const claimed = new Set<string>();

  for (const legacyId of legacyIds) {
    // 자기 자신으로의 복사는 의미가 없다.
    if (legacyId === newId) continue;

    const pairs: MigrationTask[] = [
      // 볼트 루트 데이터 4종
      ...DATA_SUFFIXES.map((suffix) => ({
        from: `.${legacyId}${suffix}`,
        to: `.${newId}${suffix}`,
      })),
      // 플러그인 폴더 파일 2종 (data.json, mcp.json)
      ...PLUGIN_FOLDER_FILES.map((fileName) => ({
        from: pluginFolderPath(configDir, legacyId, fileName),
        to: pluginFolderPath(configDir, newId, fileName),
      })),
    ];

    for (const pair of pairs) {
      // 앞선 레거시 ID가 이미 이 대상을 차지했다.
      if (claimed.has(pair.to)) continue;
      // 원본이 없으면 복사할 것이 없다.
      if (!exists(pair.from)) continue;
      // 대상이 이미 있으면 보존한다(덮어쓰기 금지).
      if (exists(pair.to)) {
        claimed.add(pair.to);
        continue;
      }
      tasks.push(pair);
      claimed.add(pair.to);
    }
  }

  return tasks;
}

/**
 * 로컬 자격증명 파일의 복사 계획을 계산한다.
 *
 * 자격증명은 볼트가 아닌 Electron userData 경로에 있어 vault.adapter로
 * 접근할 수 없다. 따라서 이 함수는 파일명만 다루고, 디렉터리 결합과 실제
 * 파일 조작은 호출부가 Node fs로 수행한다.
 *
 * @param legacyIds 우선순위 순서의 레거시 플러그인 ID 목록
 * @param newId 새 플러그인 ID
 * @param exists 파일명(디렉터리 제외)의 존재 여부를 판정하는 함수
 * @returns 복사할 작업, 또는 복사가 불필요하면 null
 */
export function planCredentialMigration(
  legacyIds: readonly string[],
  newId: string,
  exists: (fileName: string) => boolean
): MigrationTask | null {
  const target = `${newId}${CREDENTIALS_SUFFIX}`;
  // 대상이 이미 있으면 덮어쓰지 않는다.
  if (exists(target)) return null;

  for (const legacyId of legacyIds) {
    if (legacyId === newId) continue;
    const source = `${legacyId}${CREDENTIALS_SUFFIX}`;
    if (exists(source)) {
      return { from: source, to: target };
    }
  }

  return null;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

```bash
npx vitest --run src/migration.test.ts 2>&1 | tail -20
```

Expected: PASS, 전체 테스트 통과.

실패하면 구현이 아니라 **테스트의 기대값이 맞는지 먼저 확인한다.** 특히 속성 테스트 "두 번 실행하면 두 번째는 빈 배열"이 실패한다면 `claimed` 로직에 문제가 있다.

- [ ] **Step 5: 전체 테스트 회귀 확인**

```bash
npm test 2>&1 | tail -15
```

Expected: Task 0 Step 4에서 기록한 기준선과 동일. 새로 깨진 테스트가 없어야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/migration.ts src/migration.test.ts
git commit -m "feat: 플러그인 ID 변경용 마이그레이션 계획 함수 추가

- planMigrations: 볼트 데이터 4종 + MCP 설정 복사 계획 계산
- planCredentialMigration: 로컬 자격증명 파일 복사 계획 (userData 경로)
- 대상이 이미 있으면 건너뛰어 재실행 안전성 확보
- 레거시 ID 2개(bedrock-assistant, assistant-kiro) 우선순위 처리"
```

---

### Task 2: 리네이밍 + 마이그레이션 배선

식별자 변경과 마이그레이션 실행을 한 커밋으로 묶는다. 쪼개면 "ID는 바뀌었는데 마이그레이션이 없는" 중간 상태가 생겨 그 시점에 플러그인을 켠 사용자가 데이터를 잃는다.

**Files:**
- Modify: `src/branding.ts:71-85`
- Modify: `src/safe-storage.ts:29`
- Modify: `src/main.ts` (`onload` 내부, 상수 근처)
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `versions.json`

**Interfaces:**
- Consumes: Task 1의 `planMigrations`, `planCredentialMigration`, `MigrationTask`
- Produces:
  - `BRANDING.pluginId === "obsidian-ai-assistant"`
  - `BRANDING.viewType === "obsidian-ai-assistant-view"`
  - `BRANDING.files` 4개 값이 `.obsidian-ai-assistant-*` 형태
  - `GeminiAssistantPlugin.migrateLegacyData(): Promise<void>` (private)

- [ ] **Step 1: 브랜딩 식별자 변경**

`src/branding.ts`의 `BRANDING` 객체(71~85행)를 수정한다. `pluginId`, `viewType`, `files` 4개만 바꾸고 나머지는 손대지 않는다.

변경 전:

```typescript
  /** 플러그인 ID (폴더명, MCP clientInfo 등) — 고정값 */
  pluginId: "bedrock-assistant",

  /** UI에 표시되는 플러그인 이름 */
  displayName: "Bedrock Assistant",

  /** 옵시디언 뷰 타입 식별자 — 고정값 */
  viewType: "bedrock-assistant-view",

  /** 볼트 내 데이터 파일 경로 — 고정값 */
  files: {
    index: ".bedrock-assistant-index.json",
    chatHistory: ".bedrock-assistant-chat.json",
    sessions: ".bedrock-assistant-sessions.json",
    sessionsBackup: ".bedrock-assistant-sessions.json.bak",
  },
```

변경 후:

```typescript
  /** 플러그인 ID (폴더명, MCP clientInfo 등) — 고정값 */
  pluginId: "obsidian-ai-assistant",

  /** UI에 표시되는 플러그인 이름 (백엔드에 따라 updateBranding으로 전환됨) */
  displayName: "Bedrock Assistant",

  /** 옵시디언 뷰 타입 식별자 — 고정값 */
  viewType: "obsidian-ai-assistant-view",

  /** 볼트 내 데이터 파일 경로 — 고정값 */
  files: {
    index: ".obsidian-ai-assistant-index.json",
    chatHistory: ".obsidian-ai-assistant-chat.json",
    sessions: ".obsidian-ai-assistant-sessions.json",
    sessionsBackup: ".obsidian-ai-assistant-sessions.json.bak",
  },
```

`displayName`은 `"Bedrock Assistant"`로 남긴다 — `DEFAULT_SETTINGS.aiBackend`가 `"bedrock"`이므로 초기값이 일치해야 하고, `updateBranding()`이 즉시 덮어쓴다.

- [ ] **Step 2: 자격증명 파일명 변경**

`src/safe-storage.ts:29`:

변경 전:
```typescript
const CREDENTIALS_FILE = "bedrock-assistant-credentials.json";
```

변경 후:
```typescript
const CREDENTIALS_FILE = "obsidian-ai-assistant-credentials.json";
```

- [ ] **Step 3: 레거시 ID 상수와 마이그레이션 메서드 추가**

`src/main.ts`의 상수 블록(50행 `const MCP_CONFIG_FILE = "mcp.json";` 바로 아래)에 추가:

```typescript
/**
 * 구 플러그인 ID 목록. pluginId가 obsidian-ai-assistant로 바뀌기 전의 값들이다.
 * 배열 순서가 우선순위다 — 같은 대상 파일에 둘 다 후보로 걸리면 앞선 것을 택한다.
 * bedrock-assistant가 main 계보의 정본이므로 앞에 둔다.
 */
const LEGACY_PLUGIN_IDS = ["bedrock-assistant", "assistant-kiro"] as const;
```

import 문에 마이그레이션 함수를 추가한다(파일 상단 import 블록):

```typescript
import { planMigrations, planCredentialMigration } from "./migration";
```

그리고 클래스 안에 메서드를 추가한다. `refreshBranding()` 메서드(942행) 바로 앞에 넣는다:

```typescript
  /**
   * 구 플러그인 ID로 저장된 데이터를 새 ID 경로로 복사한다.
   *
   * 복사이지 이동이 아니다 — 사용자가 구 버전으로 되돌려도 계속 동작해야 한다.
   * 대상 파일이 이미 있으면 건너뛰므로 여러 번 실행해도 안전하다.
   *
   * 실패는 전부 삼킨다. 마이그레이션이 실패해도 최악의 결과는 "새 파일로 시작"
   * (인덱스 재생성, 자격증명 재입력)인데, 여기서 예외를 던지면 플러그인 전체가
   * 로드에 실패해 사용자가 아무것도 쓸 수 없게 된다.
   */
  private async migrateLegacyData(): Promise<void> {
    const adapter = this.app.vault.adapter;
    let copiedCount = 0;

    // --- 볼트 내 파일 (데이터 4종 + MCP 설정) ---
    //
    // planMigrations는 동기 exists를 요구하므로, 후보 경로의 존재 여부를 미리
    // 조회해 집합으로 만든 뒤 넘긴다. 후보 수가 적어(레거시 2개 × 5경로 + 신
    // 5경로) 일괄 조회 비용이 무시할 만하다.
    try {
      const configDir = this.app.vault.configDir;
      const candidates = new Set<string>();
      for (const id of [...LEGACY_PLUGIN_IDS, BRANDING.pluginId]) {
        candidates.add(`.${id}-index.json`);
        candidates.add(`.${id}-chat.json`);
        candidates.add(`.${id}-sessions.json`);
        candidates.add(`.${id}-sessions.json.bak`);
        // data.json은 설정 전체를 담고 있어 가장 중요하다. mcp.json과 같은 폴더에 있다.
        candidates.add(`${configDir}/plugins/${id}/data.json`);
        candidates.add(`${configDir}/plugins/${id}/mcp.json`);
      }

      const existing = new Set<string>();
      for (const path of candidates) {
        try {
          if (await adapter.exists(path)) existing.add(path);
        } catch {
          // 개별 경로 조회 실패는 "없음"으로 취급한다.
        }
      }

      const tasks = planMigrations(
        LEGACY_PLUGIN_IDS,
        BRANDING.pluginId,
        (p) => existing.has(p),
        configDir
      );

      for (const task of tasks) {
        try {
          const data = await adapter.read(task.from);
          // 대상 디렉터리가 없을 수 있다(MCP 설정의 플러그인 폴더).
          const dir = task.to.substring(0, task.to.lastIndexOf("/"));
          if (dir && !(await adapter.exists(dir))) {
            await adapter.mkdir(dir);
          }
          await adapter.write(task.to, data);
          copiedCount++;
        } catch (e) {
          console.error(`마이그레이션 실패 (${task.from} → ${task.to}):`, e);
        }
      }
    } catch (e) {
      console.error("볼트 데이터 마이그레이션 실패:", e);
    }

    // --- 로컬 자격증명 파일 (Electron userData, 볼트 밖) ---
    try {
      if (migrateCredentialsFile(LEGACY_PLUGIN_IDS, BRANDING.pluginId)) {
        copiedCount++;
      }
    } catch (e) {
      console.error("자격증명 마이그레이션 실패:", e);
    }

    // 복사가 한 건이라도 있었으면 구 파일이 남아 있음을 알린다.
    // 인덱스 파일은 임베딩 때문에 수십 MB일 수 있어 사용자가 정리하고 싶을 수 있다.
    if (copiedCount > 0) {
      new Notice(
        `기존 데이터 ${copiedCount}건을 새 플러그인 ID로 복사했습니다. ` +
          `구 파일(.bedrock-assistant-*, .assistant-kiro-*)은 남아 있으니 수동으로 지워도 됩니다.`,
        10000
      );
    }
  }
```

- [ ] **Step 4: 자격증명 복사 함수를 safe-storage.ts에 추가**

자격증명 파일은 Electron userData 경로에 있어 `vault.adapter`로 접근할 수 없다. Node fs 접근 코드가 이미 `safe-storage.ts`에 격리되어 있으므로 거기에 추가한다.

`src/safe-storage.ts` 맨 아래에 추가:

```typescript
/**
 * 구 플러그인 ID의 자격증명 파일을 새 ID 파일명으로 복사한다.
 *
 * 복사이지 이동이 아니다. 대상이 이미 있으면 아무것도 하지 않는다.
 * 암복호화는 하지 않는다 — 암호화된 Base64 문자열을 그대로 옮기며,
 * OS 키체인 키가 동일 기기에서 유지되므로 복호화는 계속 가능하다.
 *
 * @returns 복사를 수행했으면 true
 */
export function migrateCredentialsFile(
  legacyIds: readonly string[],
  newId: string
): boolean {
  const dir = getLocalStoragePath();
  if (!dir || !nodeFs || !nodePath) return false;

  const exists = (fileName: string): boolean => {
    try {
      return nodeFs.existsSync(nodePath.join(dir, fileName));
    } catch {
      return false;
    }
  };

  const task = planCredentialMigration(legacyIds, newId, exists);
  if (!task) return false;

  try {
    const data = nodeFs.readFileSync(nodePath.join(dir, task.from), "utf-8");
    // 자격증명 파일은 소유자만 읽고 쓸 수 있어야 한다(0600).
    nodeFs.writeFileSync(nodePath.join(dir, task.to), data, {
      encoding: "utf-8",
      mode: 0o600,
    });
    try {
      nodeFs.chmodSync(nodePath.join(dir, task.to), 0o600);
    } catch {
      // Windows 등 chmod 미지원 환경은 무시한다.
    }
    return true;
  } catch (e) {
    console.error("자격증명 파일 복사 실패:", e);
    return false;
  }
}
```

`safe-storage.ts` 상단 import에 추가:

```typescript
import { planCredentialMigration } from "./migration";
```

`src/main.ts`의 `safe-storage` import 문에 `migrateCredentialsFile`을 추가한다. 현재 import 형태를 확인하고 거기에 이름만 끼워 넣는다:

```bash
grep -n "from \"./safe-storage\"" src/main.ts
```

- [ ] **Step 5: onload에 마이그레이션 배선**

`src/main.ts`의 `onload()`에서 **`loadSettings()` 직후, `updateBranding()` 앞**에 넣는다. 순서가 중요하다 — 설정 로드 시 자격증명을 읽으므로 그 전에 파일이 제자리에 있어야 하지만, `loadSettings`는 이미 실행됐다. 따라서 마이그레이션 후 자격증명을 다시 로드해야 한다.

`onload()` 123~126행이 현재 이렇다:

```typescript
  async onload(): Promise<void> {
    await this.loadSettings();

    // 초기 브랜딩 설정 (로드된 설정의 aiBackend에 맞게 갱신)
    updateBranding(this.settings.aiBackend);
```

이렇게 바꾼다:

```typescript
  async onload(): Promise<void> {
    // 구 플러그인 ID의 데이터를 새 경로로 복사한다. loadSettings보다 먼저
    // 실행해야 자격증명 파일이 제자리에 있는 상태로 설정을 읽을 수 있다.
    await this.migrateLegacyData();

    await this.loadSettings();

    // 초기 브랜딩 설정 (로드된 설정의 aiBackend에 맞게 갱신)
    updateBranding(this.settings.aiBackend);
```

`migrateLegacyData`가 `BRANDING.pluginId`를 참조하는데 이 값은 모듈 상수이므로 `updateBranding` 호출 여부와 무관하다(`updateBranding`은 `displayName`·`icon`·`settingsTitle`만 바꾼다). 따라서 앞에 두어도 안전하다.

- [ ] **Step 6: 타입 체크**

```bash
npx tsc --noEmit -skipLibCheck 2>&1 | head -20
```

Expected: 에러 없음.

`Notice`가 `main.ts`에 이미 import되어 있는지 확인한다(1행에 있다). `adapter.mkdir`은 옵시디언 공식 타입(`obsidian.d.ts:1481`)에 있으므로 캐스팅이 필요 없다.

- [ ] **Step 7: manifest.json 수정**

```json
{
  "id": "obsidian-ai-assistant",
  "name": "AI Assistant",
  "version": "0.3.0",
  "minAppVersion": "1.4.0",
  "description": "AI assistant sidebar with four backends (AWS Bedrock, Google Gemini, OpenAI, Ollama). Includes chat, Graph RAG vault search, Second Brain layer, to-do management, web clipper, and MCP server integration.",
  "author": "teinam",
  "authorUrl": "https://github.com/teinam",
  "isDesktopOnly": true,
  "fundingUrl": "https://buymeacoffee.com/teinam"
}
```

- [ ] **Step 8: package.json 수정**

`name`, `description`, `version` 3개 필드만 바꾼다. 나머지(scripts, devDependencies, dependencies)는 손대지 않는다.

```json
  "name": "obsidian-ai-assistant",
  "version": "0.3.0",
  "description": "Obsidian sidebar AI assistant with four backends (AWS Bedrock, Google Gemini, OpenAI, Ollama)",
```

- [ ] **Step 9: versions.json에 0.3.0 추가**

기존 `"0.2.24": "1.4.0"` 뒤에 추가한다:

```json
  "0.2.24": "1.4.0",
  "0.3.0": "1.4.0"
}
```

- [ ] **Step 10: 전체 테스트 실행**

```bash
npm test 2>&1 | tail -25
```

Expected: Task 0 기준선과 동일하게 통과.

`branding.test.ts`가 실패할 수 있다. 379~400행의 "정적 참조 금지 검증"은 `branding.ts` 소스에 `manifest`/`package.json`/`README` 문자열이 없어야 한다고 검사한다. 내가 추가한 주석에 그런 단어가 없는지 확인한다. `pluginId` 관련 테스트는 하드코딩 값이 아니라 상대 비교(호출 전후 동일)만 하므로 영향받지 않는다.

- [ ] **Step 11: 빌드 확인**

```bash
npm run build 2>&1 | tail -10
```

Expected: 성공. `main.js`가 생성된다.

- [ ] **Step 12: 커밋**

```bash
git add src/branding.ts src/safe-storage.ts src/main.ts manifest.json package.json versions.json
git commit -m "feat!: 플러그인 ID를 obsidian-ai-assistant로 변경

- pluginId, viewType, 볼트 데이터 파일 4개, 자격증명 파일명 변경
- onload에서 구 ID(bedrock-assistant, assistant-kiro) 데이터 자동 복사
- 복사 방식이므로 구 버전으로 되돌려도 동작하며, 대상이 있으면 건너뜀
- manifest name을 'AI Assistant'로 고정 (백엔드별 표시명은 런타임 전환 유지)
- 0.3.0

BREAKING CHANGE: 플러그인 폴더명이 바뀌어 재설치가 필요하고,
사이드바를 한 번 다시 열어야 한다(viewType 변경은 마이그레이션 불가)."
```

---

### Task 3: 추천 플러그인 설치 여부 감지

**Files:**
- Create: `src/plugin-detect.ts`
- Test: `src/plugin-detect.test.ts`
- Modify: `src/settings-tab.ts:1838-1858` (추천 플러그인 절), i18n 키 3개 언어

**Interfaces:**
- Consumes: 없음
- Produces: `function isPluginEnabled(app: unknown, pluginId: string): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/plugin-detect.test.ts` 생성:

```typescript
import { describe, it, expect } from "vitest";
import { isPluginEnabled } from "./plugin-detect";

describe("isPluginEnabled", () => {
  // 옵시디언 app 객체의 최소 형태를 흉내낸다.
  const appWith = (ids: string[]) => ({
    plugins: { enabledPlugins: new Set(ids) },
  });

  it("활성 플러그인이면 true를 반환한다", () => {
    expect(isPluginEnabled(appWith(["code-styler"]), "code-styler")).toBe(true);
  });

  it("비활성 플러그인이면 false를 반환한다", () => {
    expect(isPluginEnabled(appWith(["dataview"]), "code-styler")).toBe(false);
  });

  it("활성 플러그인이 하나도 없으면 false를 반환한다", () => {
    expect(isPluginEnabled(appWith([]), "code-styler")).toBe(false);
  });

  it("app이 null이면 false를 반환한다", () => {
    expect(isPluginEnabled(null, "code-styler")).toBe(false);
  });

  it("app이 undefined면 false를 반환한다", () => {
    expect(isPluginEnabled(undefined, "code-styler")).toBe(false);
  });

  it("plugins 속성이 없으면 false를 반환한다", () => {
    expect(isPluginEnabled({}, "code-styler")).toBe(false);
  });

  it("enabledPlugins가 없으면 false를 반환한다", () => {
    expect(isPluginEnabled({ plugins: {} }, "code-styler")).toBe(false);
  });

  it("enabledPlugins가 Set이 아니면 false를 반환한다", () => {
    expect(
      isPluginEnabled({ plugins: { enabledPlugins: ["code-styler"] } }, "code-styler")
    ).toBe(false);
  });

  it("has가 예외를 던져도 false를 반환한다", () => {
    const hostile = {
      plugins: {
        enabledPlugins: {
          has: () => {
            throw new Error("boom");
          },
        },
      },
    };

    expect(isPluginEnabled(hostile, "code-styler")).toBe(false);
  });

  it("빈 문자열 ID는 false를 반환한다", () => {
    expect(isPluginEnabled(appWith(["code-styler"]), "")).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest --run src/plugin-detect.test.ts 2>&1 | tail -15
```

Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 최소 구현 작성**

`src/plugin-detect.ts` 생성:

```typescript
/**
 * 커뮤니티 플러그인 설치·활성 여부 판정 모듈.
 *
 * app.plugins.enabledPlugins는 옵시디언 공식 타입 정의에 없는 내부 API다.
 * 캐스팅과 방어 코드를 이 파일에 격리해, 호출부가 any를 다루지 않게 한다.
 */

/**
 * 지정 ID의 커뮤니티 플러그인이 활성 상태인지 판정한다.
 *
 * 내부 API에 의존하므로 접근에 실패하면 false를 반환한다. false는
 * "미설치로 간주 → 설치 버튼 표시"로 이어지는 안전한 기본값이다.
 * (true를 기본값으로 하면 미설치 사용자에게 설치 경로를 숨기게 된다.)
 */
export function isPluginEnabled(app: unknown, pluginId: string): boolean {
  if (!pluginId) return false;

  try {
    const enabled = (app as { plugins?: { enabledPlugins?: unknown } })?.plugins
      ?.enabledPlugins;
    // Set이 아닌 값(배열 등)은 has가 없거나 의미가 다르므로 거부한다.
    if (!(enabled instanceof Set)) {
      // has 메서드를 직접 가진 Set 유사 객체는 예외 처리 경로로 흘려보낸다.
      const hasFn = (enabled as { has?: unknown })?.has;
      if (typeof hasFn !== "function") return false;
      return (enabled as { has: (id: string) => unknown }).has(pluginId) === true;
    }
    return enabled.has(pluginId);
  } catch {
    // 내부 API 구조가 바뀌었거나 접근이 막힌 경우.
    return false;
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

```bash
npx vitest --run src/plugin-detect.test.ts 2>&1 | tail -15
```

Expected: PASS.

"enabledPlugins가 Set이 아니면 false"와 "has가 예외를 던져도 false" 두 테스트가 서로 충돌할 수 있다. 배열은 `has`가 없으므로 첫 분기에서 false, 적대적 객체는 `has`가 함수라 호출되고 예외가 catch된다. 통과하지 않으면 구현의 분기 순서를 다시 본다.

- [ ] **Step 5: i18n 키 추가 (3개 언어)**

`src/settings-tab.ts`에 "설치됨" 배지 문구를 추가한다. 기존 `codeStylerInstall` 키 바로 아래에 각각 넣는다.

영어 블록(149행 근처):
```typescript
    codeStylerInstall: "Install Code Styler",
    codeStylerInfo: "Install the Code Styler plugin to enhance code block rendering with language-specific styling.",
    pluginInstalled: "Installed",
```

한국어 블록(359행 근처):
```typescript
    codeStylerInstall: "Code Styler 설치",
    codeStylerInfo: "Code Styler 플러그인을 설치하면 코드 블록이 언어별 스타일로 더 보기 좋게 렌더링됩니다.",
    pluginInstalled: "설치됨",
```

일본어 블록(569행 근처):
```typescript
    codeStylerInstall: "Code Stylerをインストール",
    codeStylerInfo: "Code Stylerプラグインをインストールして、言語別スタイリングでコードブロックの表示を強化します。",
    pluginInstalled: "インストール済み",
```

`pluginInstalled` 키는 3개 언어 블록 모두에 있어야 한다. 하나라도 빠지면 타입 에러가 난다(i18n 객체가 같은 형태를 요구한다). `npx tsc --noEmit`으로 확인한다.

- [ ] **Step 6: 추천 플러그인 절에 감지 적용**

`src/settings-tab.ts` 1838~1858행을 교체한다.

변경 전:

```typescript
    // 추천 플러그인 설치 안내 (설정 화면 맨 아래로 이동)
    new Setting(containerEl).setName(t.recommendedPlugins).setHeading();

    const codeStylerSetting = new Setting(containerEl)
      .setName(t.codeStylerInstall)
      .setDesc(t.codeStylerInfo);
    codeStylerSetting.addButton((btn) =>
      btn.setButtonText(t.codeStylerInstall).onClick(() => {
        window.open("obsidian://show-plugin?id=code-styler");
      })
    );

    const tasksSetting = new Setting(containerEl)
      .setName(t.todoTasksInstall)
      .setDesc(t.todoTasksInfo);
    tasksSetting.addButton((btn) =>
      btn.setButtonText(t.todoTasksInstall).onClick(() => {
        window.open("obsidian://show-plugin?id=obsidian-tasks-plugin");
      })
    );
  }
```

변경 후:

```typescript
    // 추천 플러그인 설치 안내 (설정 화면 맨 아래로 이동)
    new Setting(containerEl).setName(t.recommendedPlugins).setHeading();

    // 이미 설치한 사용자에게 설치 버튼을 계속 보여주지 않도록 활성 여부를 확인한다.
    this.addRecommendedPlugin(
      containerEl,
      "code-styler",
      t.codeStylerInstall,
      t.codeStylerInfo,
      t.pluginInstalled
    );
    this.addRecommendedPlugin(
      containerEl,
      "obsidian-tasks-plugin",
      t.todoTasksInstall,
      t.todoTasksInfo,
      t.pluginInstalled
    );
  }

  /**
   * 추천 플러그인 항목을 추가한다.
   * 이미 활성화된 플러그인은 설치 버튼 대신 "설치됨" 배지를 보여준다.
   */
  private addRecommendedPlugin(
    containerEl: HTMLElement,
    pluginId: string,
    installLabel: string,
    description: string,
    installedLabel: string
  ): void {
    const setting = new Setting(containerEl).setName(installLabel).setDesc(description);

    if (isPluginEnabled(this.app, pluginId)) {
      // 설치·활성 상태 — 버튼 대신 정적 배지를 표시한다.
      const badge = setting.controlEl.createSpan({ cls: "ba-plugin-installed" });
      setIcon(badge, "check");
      badge.createSpan({ text: installedLabel });
      return;
    }

    setting.addButton((btn) =>
      btn.setButtonText(installLabel).onClick(() => {
        window.open(`obsidian://show-plugin?id=${pluginId}`);
      })
    );
  }
```

`src/settings-tab.ts` 상단 import에 추가:

```typescript
import { isPluginEnabled } from "./plugin-detect";
```

`setIcon`이 이미 import되어 있는지 확인한다:

```bash
grep -n "^import.*setIcon" src/settings-tab.ts
```

없으면 obsidian import에 추가한다.

- [ ] **Step 7: 배지 스타일 추가**

`styles.css` 맨 아래에 추가:

```css
/* 추천 플러그인 "설치됨" 배지 */
.ba-plugin-installed {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  color: var(--text-success);
  font-size: var(--font-ui-small);
}

.ba-plugin-installed svg {
  width: 1em;
  height: 1em;
}
```

- [ ] **Step 8: 타입 체크와 테스트**

```bash
npx tsc --noEmit -skipLibCheck 2>&1 | head -20
npm test 2>&1 | tail -20
```

Expected: 둘 다 통과. `settings-tab.test.ts`가 i18n 키 개수나 구조를 검사한다면 `pluginInstalled` 추가로 실패할 수 있다 — 그 경우 테스트를 함께 갱신한다.

- [ ] **Step 9: 커밋**

```bash
git add src/plugin-detect.ts src/plugin-detect.test.ts src/settings-tab.ts styles.css
git commit -m "feat: 추천 플러그인 설치 여부 감지

- isPluginEnabled: app.plugins.enabledPlugins 접근을 격리한 판정 함수
- 설치된 플러그인은 설치 버튼 대신 '설치됨' 배지 표시
- 내부 API 접근 실패 시 false(미설치 간주) — 설치 경로를 숨기지 않는 안전한 기본값
- pluginInstalled i18n 키 3개 언어 추가"
```

---

### Task 4: 아이콘 자산 정리 + 브랜치 정책 개정

**Files:**
- Delete: `gemini-icon.svg`, `kiro-icon.svg`
- Modify: `.gitattributes`
- Modify: `.kiro/steering/branch-branding.md`
- Modify: `src/main.ts:927` (주석)

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (정리 작업)

- [ ] **Step 1: 아이콘 파일이 참조되지 않는지 확인**

```bash
grep -rn "gemini-icon\|kiro-icon\|aws-icon" src/ esbuild.config.mjs manifest.json package.json styles.css 2>/dev/null
```

Expected: 출력 없음. SVG는 `branding.ts`에 문자열로 인라인되어 있다.

출력이 있으면 **삭제하지 말고 보고한다.**

- [ ] **Step 2: 아이콘 파일 삭제**

```bash
git rm gemini-icon.svg kiro-icon.svg
```

`aws-icon.svg`는 git에 추적되지 않으므로(`??` 상태) 건드리지 않는다. 사용자의 작업 디렉터리 파일이다.

- [ ] **Step 3: .gitattributes 수정**

현재 내용:
```
# 브랜딩 파일은 머지 시 현재 브랜치의 값을 유지
src/branding.ts merge=ours
```

브랜치가 하나면 `merge=ours`는 의미가 없고, 오히려 앞으로의 정상적인 머지에서 `branding.ts` 변경을 조용히 버리는 함정이 된다. 파일 전체를 삭제한다:

```bash
git rm .gitattributes
```

- [ ] **Step 4: steering 문서 개정**

`.kiro/steering/branch-branding.md`를 전체 교체한다:

```markdown
---
inclusion: always
---

# 브랜딩·프로바이더 정책

## 개요

이 프로젝트는 **단일 브랜치(`main`)**로 관리한다. 0.3.0에서 `kiro-edition`
브랜치를 폐기하고 `main`으로 통합했다.

## 플러그인 식별자

| 항목 | 값 |
|---|---|
| pluginId | `obsidian-ai-assistant` |
| manifest name | `AI Assistant` |
| viewType | `obsidian-ai-assistant-view` |

**과거 식별자(마이그레이션 소스):** `bedrock-assistant`(main 계보),
`assistant-kiro`(kiro-edition 계보). `src/migration.ts`가 두 ID의 데이터를
새 경로로 복사한다. 이 목록은 `src/main.ts`의 `LEGACY_PLUGIN_IDS`에 있다.

## 표시명과 아이콘

`displayName`, `icon`, `settingsTitle`은 `aiBackend` 설정에 따라 런타임에
전환된다. `pluginId`, `viewType`, `files`는 백엔드와 무관한 고정값이다.

| aiBackend | displayName |
|---|---|
| `bedrock` | Bedrock Assistant |
| `gemini` | Gemini Assistant |
| `openai` | OpenAI Assistant |
| `ollama` | Ollama Assistant |

전환 경로: `settings-tab.ts`의 백엔드 드롭다운 → `updateBranding(aiBackend)`
→ `plugin.refreshBranding()`이 리본 아이콘·뷰 헤더 갱신.

아이콘 SVG는 `src/branding.ts`에 문자열로 인라인한다. 별도 `.svg` 파일을
두지 않는다 — 빌드가 번들하지 않아 참조 없는 자산이 된다.

## 새 프로바이더 추가 규칙

새 백엔드를 추가할 때 손대야 하는 곳:

1. `types.ts` — `aiBackend` union, 프로바이더별 설정 필드
2. `provider-utils.ts` — `AiProvider` union, `embeddingSignature`, effort 매핑
3. `ai-client-factory.ts` — `case` 추가
4. `branding.ts` — 브랜딩 상수 + `getBranding`의 `case`
5. `main.ts` `registerBrandingIcons` — 백엔드 배열에 추가
6. `settings-tab.ts` — 인증·모델 UI
7. `safe-storage.ts` — API 키가 있으면 `SENSITIVE_FIELDS`에 추가

### 임베딩 API가 없는 벤더는 지원하지 않는다

이 플러그인은 볼트 인덱싱(Graph RAG)에 `IAiClient.getEmbedding`이 필수다.
임베딩 엔드포인트를 제공하지 않는 벤더를 백엔드로 추가하면 임베딩을 다른
프로바이더에 위임하는 구조가 강제되고, 사용자는 API 키 2개와 청구서 2곳을
관리해야 한다.

**Anthropic 직접 API가 이 사유로 제외됐다**(0.3.0 검토). Anthropic Claude
모델은 Bedrock 백엔드로 이미 사용할 수 있다. 직접 API의 추가 실익(AWS 계정
불필요, 신모델 선출시 접근, 프롬프트 캐싱)은 위 비용을 정당화하지 못한다고
판단했다.

이 정책을 뒤집으려면 임베딩 프로바이더 분리 설정(`embeddingProvider` 필드)을
먼저 설계해야 한다.

## 자격증명 저장

민감 필드(`SENSITIVE_FIELDS`)는 볼트의 `data.json`에 저장하지 않는다.
Electron `safeStorage`로 암호화해 userData 경로의
`obsidian-ai-assistant-credentials.json`(권한 0600)에 둔다. 볼트가 클라우드
동기화되어도 키가 전파되지 않는다.

OS 키체인을 쓸 수 없는 환경에서는 해당 필드를 파일에 아예 쓰지 않는다
(`buildCredentialsPayload` 참조) — 평문으로 디스크에 남기지 않기 위함이다.
```

- [ ] **Step 5: main.ts 주석 갱신**

`src/main.ts:927`의 주석이 "4개 백엔드"를 명시하고 있다. 값은 맞지만 배열과 중복되므로 유지 부담을 줄인다.

변경 전:
```typescript
    // bedrock/gemini/openai/ollama 4개 백엔드 아이콘을 모두 addIcon으로 등록한다.
    // (하나라도 누락되면 해당 백엔드로 전환 시 아이콘이 표시되지 않는다)
```

변경 후:
```typescript
    // 모든 백엔드 아이콘을 미리 addIcon으로 등록한다.
    // (하나라도 누락되면 해당 백엔드로 전환 시 아이콘이 표시되지 않는다)
    // 새 프로바이더 추가 시 아래 배열에 반드시 넣어야 한다.
```

- [ ] **Step 6: 테스트와 빌드**

```bash
npm test 2>&1 | tail -15
npm run build 2>&1 | tail -5
```

Expected: 통과. `branding.test.ts`가 SVG 파일 존재를 검사하지 않는지 확인한다(379행 이후는 소스 문자열만 검사한다).

- [ ] **Step 7: 커밋**

```bash
git add .kiro/steering/branch-branding.md src/main.ts
git commit -m "chore: 단일 브랜치 정책으로 개정 및 미사용 아이콘 정리

- .gitattributes 삭제 (branding.ts merge=ours는 단일 브랜치에서 함정)
- gemini-icon.svg, kiro-icon.svg 삭제 (branding.ts에 인라인되어 참조 없음)
- steering 문서를 브랜치별 에디션 → 단일 브랜치 정책으로 교체
- 임베딩 API 없는 벤더 미지원 정책 기록 (Anthropic 제외 근거)"
```

---

### Task 5: 문서 리네이밍 반영

문서 회수는 `c4d3b43`·`03b7afe`에서 이미 완료됐다. 남은 것은 리네이밍 반영과 마이그레이션 안내다.

**Files:**
- Modify: `README.md`, `README-KR.md`, `README-JA.md`
- Modify: `docs/second-brain-en.md`, `docs/second-brain-kr.md`, `docs/second-brain-ja.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 바꿔야 할 문자열 목록 만들기**

```bash
grep -rn "bedrock-assistant\|Bedrock Assistant\|Assistant Kiro\|assistant-kiro" README.md README-KR.md README-JA.md docs/*.md CHANGELOG.md
```

이 목록이 작업 대상이다. **주의:** 모든 `Bedrock Assistant`를 일괄 치환하면 안 된다.

- 플러그인 **이름**을 가리키는 것 → `AI Assistant`로 바꾼다 (제목, 설치 경로, 설정 경로)
- **백엔드 표시명**을 가리키는 것 → 그대로 둔다 (프로바이더별 전환 설명, `aiBackend: "bedrock"` 선택 시 나타나는 이름)
- CHANGELOG의 **과거 항목** → 그대로 둔다 (당시 사실이다)

- [ ] **Step 2: README 3종 수정**

각 파일에서 바꿀 것:

| 위치 | 변경 |
|---|---|
| 최상단 제목 | `# Bedrock Assistant` → `# AI Assistant` |
| 수동 설치 경로 | `.obsidian/plugins/bedrock-assistant/` → `.obsidian/plugins/obsidian-ai-assistant/` |
| 설정 진입 경로 | `설정 → Bedrock Assistant` → `설정 → AI Assistant` (영어: `Settings → AI Assistant`, 일본어: `設定 → AI Assistant`) |
| 배지 | AWS Bedrock 단독 배지가 있으면 4종 프로바이더를 반영하도록 조정. Buy Me A Coffee 배지는 그대로 유지 |

`## Installation` 절 다음에 마이그레이션 안내를 추가한다. 한국어판 문구:

```markdown
### 0.2.x에서 업그레이드

0.3.0에서 플러그인 ID가 `bedrock-assistant`에서 `obsidian-ai-assistant`로
바뀌었습니다.

- **플러그인 폴더가 달라지므로 재설치가 필요합니다.** BRAT을 쓰신다면 기존
  항목을 제거하고 다시 추가하세요.
- 볼트 인덱스, 채팅 기록, 세션, MCP 설정, 자격증명은 **첫 실행 시 자동으로
  복사됩니다.** 구 파일은 지우지 않고 남겨두므로 이전 버전으로 되돌려도
  그대로 동작합니다.
- **사이드바를 한 번 다시 열어야 합니다.** 옵시디언이 워크스페이스 레이아웃에
  뷰 식별자를 기록하는데, 이 값은 플러그인이 대신 옮길 수 없습니다.
- 복사가 끝나면 알림이 뜹니다. 구 데이터 파일(`.bedrock-assistant-*.json`)은
  더 이상 쓰이지 않으니 볼트 용량이 신경 쓰이면 수동으로 지워도 됩니다.
  인덱스 파일은 임베딩 때문에 수십 MB일 수 있습니다.

`kiro-edition`(Assistant Kiro)을 쓰셨다면 같은 절차가 적용됩니다. 이 에디션은
0.3.0에서 main으로 통합되었고, `.assistant-kiro-*.json` 데이터도 자동으로
복사됩니다.
```

영어판·일본어판도 같은 내용으로 각 언어에 맞게 작성한다. 기계적 번역이 아니라 각 언어로 자연스럽게 쓴다.

- [ ] **Step 3: 지원 정책 명시**

각 README의 백엔드 설명 절 끝에 추가한다. 한국어판:

```markdown
> **지원 백엔드 기준:** 이 플러그인은 볼트 검색(Graph RAG)에 임베딩을 사용하므로,
> 임베딩 API를 제공하는 벤더만 백엔드로 지원합니다. Anthropic 직접 API는 임베딩
> 엔드포인트가 없어 제외했습니다 — Claude 모델은 Bedrock 백엔드로 사용하세요.
```

- [ ] **Step 4: docs/second-brain-*.md 수정**

```bash
grep -n "Assistant Kiro\|Bedrock Assistant\|bedrock-assistant" docs/second-brain-en.md docs/second-brain-kr.md docs/second-brain-ja.md
```

설정 경로 안내(`Settings → ... → Second Brain`)의 플러그인 이름을 `AI Assistant`로 바꾼다. 임베딩 시그니처 예시(`bedrock:{model}`)가 있으면 4종 프로바이더를 반영하도록 확장한다:

```
{프로바이더}:{모델 ID} 형태입니다. 예: `bedrock:amazon.titan-embed-text-v2:0`,
`openai:text-embedding-3-large`, `ollama:nomic-embed-text`, `gemini:text-embedding-004`
```

- [ ] **Step 5: CHANGELOG에 0.3.0 추가**

기존 최상단 항목 위에 추가한다. 기존 파일의 형식(헤딩 레벨, 날짜 표기)을 그대로 따른다:

```markdown
## 0.3.0

### Breaking

- 플러그인 ID를 `bedrock-assistant` → `obsidian-ai-assistant`로 변경. 플러그인
  폴더가 바뀌므로 재설치가 필요하고, 사이드바를 한 번 다시 열어야 한다.
- `kiro-edition` 브랜치 폐기. Bedrock 전용 에디션은 main으로 통합되었고,
  `assistant-kiro` 데이터도 자동 마이그레이션 대상이다.

### 추가

- 구 플러그인 ID(`bedrock-assistant`, `assistant-kiro`)의 볼트 데이터, MCP 설정,
  자격증명을 첫 실행 시 새 경로로 자동 복사. 원본은 보존하므로 이전 버전으로
  되돌려도 동작한다.
- 추천 플러그인(Code Styler, Tasks) 설치 여부를 감지해, 이미 설치한 경우
  설치 버튼 대신 "설치됨" 배지를 표시.

### 정리

- 참조되지 않던 `gemini-icon.svg`, `kiro-icon.svg` 삭제 (아이콘 SVG는
  `branding.ts`에 인라인).
- `.gitattributes`의 `branding.ts merge=ours` 삭제 — 단일 브랜치에서는
  정상적인 머지 변경을 조용히 버리는 함정이 된다.
- 임베딩 API를 제공하지 않는 벤더는 백엔드로 지원하지 않는다는 정책을
  steering 문서에 기록.
```

- [ ] **Step 6: 잔존 문자열 확인**

```bash
grep -rn "bedrock-assistant\|assistant-kiro" README.md README-KR.md README-JA.md docs/*.md
```

Expected: 마이그레이션 안내와 CHANGELOG의 의도적 언급만 남는다. 설치 경로나 설정 경로에 남아 있으면 고친다.

- [ ] **Step 7: 커밋**

```bash
git add README.md README-KR.md README-JA.md docs/second-brain-en.md docs/second-brain-kr.md docs/second-brain-ja.md CHANGELOG.md
git commit -m "docs: 리네이밍 반영 및 마이그레이션 안내 추가

- 플러그인 이름·설치 경로·설정 경로를 AI Assistant / obsidian-ai-assistant로
- 0.2.x 업그레이드 절 신설 (재설치 필요, 자동 복사, 사이드바 재열기)
- 임베딩 API 없는 벤더 미지원 정책 명시
- 임베딩 시그니처 예시를 4종 프로바이더로 확장
- CHANGELOG 0.3.0"
```

---

### Task 6: 최종 검증

**Files:** 없음 (검증만)

**Interfaces:**
- Consumes: Task 1~5의 모든 산출물
- Produces: 없음

- [ ] **Step 1: 전체 테스트**

```bash
npm test 2>&1 | tail -25
```

Expected: 전체 통과. Task 0 Step 4의 기준선과 비교해 새로 깨진 것이 없어야 한다.

- [ ] **Step 2: 타입 체크와 프로덕션 빌드**

```bash
npm run build 2>&1 | tail -10
```

Expected: 성공. `main.js` 생성.

- [ ] **Step 3: 식별자 일관성 확인**

```bash
echo "=== manifest/package/versions 버전 일치 ==="
grep '"version"' manifest.json package.json
grep '0.3.0' versions.json
echo "=== 소스에 구 ID 잔존 확인 ==="
grep -rn "bedrock-assistant\|assistant-kiro" src/ --include="*.ts" | grep -v "\.test\."
```

Expected:
- 버전 3곳 모두 `0.3.0`
- 소스의 구 ID는 `main.ts`의 `LEGACY_PLUGIN_IDS`에만 있어야 한다. 다른 곳에 있으면 리네이밍 누락이다.

- [ ] **Step 4: 무관한 파일이 커밋되지 않았는지 확인**

```bash
git diff main --stat
git status --short
```

Expected:
- diff에 `src/aws-profile.ts`, `src/aws-profile.test.ts`, `src/aws-profile-runtime.ts`가 **없어야 한다**
- `git status`에 세 파일이 여전히 ` M`으로 남아 있어야 한다 (건드리지 않았다는 증거)

diff에 포함됐으면 해당 파일만 커밋에서 되돌린다.

- [ ] **Step 5: 수동 확인 — 프로바이더 전환**

실제 볼트에 빌드 산출물을 설치해 확인한다.

```bash
# 테스트용 볼트 경로를 VAULT로 지정
VAULT=~/path/to/test-vault
mkdir -p "$VAULT/.obsidian/plugins/obsidian-ai-assistant"
cp main.js styles.css manifest.json "$VAULT/.obsidian/plugins/obsidian-ai-assistant/"
```

옵시디언에서 플러그인을 켜고 확인할 것:

1. 리본 아이콘이 보이고 클릭하면 사이드바가 열린다
2. 설정에서 백엔드를 Bedrock → Gemini → OpenAI → Ollama로 바꿀 때마다 **리본 아이콘 그림과 툴팁이 함께 바뀐다**
3. 설정 화면 맨 아래 추천 플러그인 절에서, Code Styler를 설치하면 버튼이 "설치됨" 배지로 바뀐다

- [ ] **Step 6: 수동 확인 — 마이그레이션**

구 데이터가 있는 상태를 만들어 확인한다. **실제 사용 볼트가 아닌 테스트 볼트에서 한다.**

```bash
VAULT=~/path/to/test-vault
# 구 ID 데이터를 흉내낸 파일 생성
echo '{"test":"bedrock-legacy"}' > "$VAULT/.bedrock-assistant-chat.json"
mkdir -p "$VAULT/.obsidian/plugins/bedrock-assistant"
echo '{"mcpServers":{}}' > "$VAULT/.obsidian/plugins/bedrock-assistant/mcp.json"
```

옵시디언에서 플러그인을 껐다 켜고 확인:

```bash
ls -la "$VAULT"/.obsidian-ai-assistant-*.json
ls -la "$VAULT/.obsidian/plugins/obsidian-ai-assistant/mcp.json"
cat "$VAULT/.obsidian-ai-assistant-chat.json"
ls -la "$VAULT/.bedrock-assistant-chat.json"
```

Expected:
- `.obsidian-ai-assistant-chat.json`이 생겼고 내용이 `{"test":"bedrock-legacy"}`
- `mcp.json`이 새 플러그인 폴더에 복사됐다
- **구 파일이 그대로 남아 있다** (복사이므로)
- 복사 건수를 알리는 Notice가 떴다

`assistant-kiro` 접두사로도 같은 절차를 반복한다.

재실행 안전성 확인 — 플러그인을 다시 껐다 켰을 때:
- Notice가 다시 뜨지 않는다 (대상이 이미 있어 작업이 0건)
- `.obsidian-ai-assistant-chat.json` 내용이 덮어써지지 않는다

- [ ] **Step 7: 푸시와 PR**

```bash
git push -u origin feat/unify-ai-assistant
gh pr create --title "feat!: obsidian-ai-assistant로 리네이밍 및 단일 브랜치 통합" --body "$(cat <<'EOF'
## Summary

- 플러그인 ID를 `bedrock-assistant` → `obsidian-ai-assistant`로 변경하고, 구 ID(`bedrock-assistant`, `assistant-kiro`) 데이터를 첫 실행 시 자동 복사
- `kiro-edition` 브랜치 폐기 준비 — 델타 감사 결과 kiro 고유 코드 개선은 0건, 문서는 #11·#12에서 이미 반영됨
- 추천 플러그인(Code Styler, Tasks) 설치 여부 감지
- 임베딩 API를 제공하지 않는 벤더는 백엔드로 지원하지 않는다는 정책을 steering에 기록 (Anthropic 직접 API 제외 근거)

## Breaking changes

- 플러그인 폴더명이 바뀌어 **재설치가 필요**합니다
- 워크스페이스에 기록된 `viewType`은 마이그레이션할 수 없어 **사이드바를 한 번 다시 열어야** 합니다
- 볼트 데이터·MCP 설정·자격증명은 자동 복사되며, 원본은 보존됩니다

## Test plan

- [x] `npm test` 전체 통과
- [x] `npm run build` 성공
- [x] 백엔드 4종 전환 시 리본 아이콘·툴팁 갱신 확인
- [x] `bedrock-assistant` 구 데이터 복사 확인 (원본 보존)
- [x] `assistant-kiro` 구 데이터 복사 확인
- [x] 재실행 시 중복 복사·덮어쓰기 없음 확인
- [x] Code Styler 설치 시 "설치됨" 배지 표시 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: kiro-edition 삭제는 머지 후에**

PR이 머지된 뒤에 실행한다. **머지 전에 지우면 회수 누락이 발견됐을 때 돌아갈 곳이 없다.**

```bash
# 머지 확인 후
git switch main && git pull
# 안전망: 삭제 전 태그를 남긴다
git tag kiro-edition-final kiro-edition
git push origin kiro-edition-final
# 브랜치 삭제
git push origin --delete kiro-edition
git branch -D kiro-edition
```

---

## Self-Review

**1. Spec coverage**

| 스펙 항목 | 담당 Task |
|---|---|
| D1 `git merge` 안 씀 | Task 6 Step 8 (문서 회수 없이 태그 후 삭제) |
| D2 Anthropic 제외 | Task 4 Step 4 (steering 기록), Task 5 Step 3 (사용자 문서) |
| D3 Code Styler/Tasks 감지만 | Task 3 |
| D4 pluginId 변경 + 복사 마이그레이션 | Task 1, Task 2 |
| D5 프로바이더별 표시명 유지 | Task 2 Step 1 (`displayName` 보존), Task 4 Step 4 (정책 기록) |
| 리네이밍 범위 6파일 | Task 2 Step 1~2, 7~9 |
| 마이그레이션 4종 | Task 1(계산), Task 2 Step 3~5(실행) |
| 아이콘 5종 확장 | **해당 없음** — Anthropic 제외로 4종 유지. Task 4 Step 5가 새 프로바이더 추가 시 주의사항을 주석에 남긴다 |
| 플러그인 감지 | Task 3 |
| 문서 갱신 | Task 5 |
| 저장소 정리 | Task 4 |
| 테스트 | Task 1 Step 1(planMigrations), Task 3 Step 1(isPluginEnabled), Task 6(통합) |

빠진 항목 없음.

**2. Placeholder scan**

"TBD", "적절히", "필요에 따라" 없음. 모든 코드 단계에 실제 코드 블록이 있고, 모든 검증 단계에 실행 명령과 기대 출력이 있다.

Task 5는 문서 편집이라 최종 문장을 전부 싣지 않았으나, **무엇을 바꿀지 표로 명시하고 새로 추가할 절은 전문을 실었다.** 번역이 필요한 부분(영어·일본어판)은 한국어 원문을 제공했다.

**3. Type consistency**

- `MigrationTask { from, to }` — Task 1에서 정의, Task 2 Step 3에서 `task.from`/`task.to`로 사용. 일치.
- `planMigrations(legacyIds, newId, exists, configDir)` — Task 1 정의 4인자, Task 2 Step 3 호출 4인자. 일치.
- `planCredentialMigration(legacyIds, newId, exists)` — Task 1 정의 3인자, Task 2 Step 4 호출 3인자. 일치.
- `legacyDataFileNames(pluginId)` — Task 1에서 정의·export, 같은 Task의 속성 테스트에서 사용. 일치.
- `migrateCredentialsFile(legacyIds, newId): boolean` — Task 2 Step 4에서 정의, 같은 Task Step 3의 `migrateLegacyData`에서 호출. 일치.
- `isPluginEnabled(app, pluginId)` — Task 3에서 정의, 같은 Task Step 6에서 호출. 일치.
- `LEGACY_PLUGIN_IDS` — Task 2 Step 3에서 정의, 같은 Task Step 3~4에서 사용, Task 4 Step 4 문서에서 언급. 일치.
- `t.pluginInstalled` — Task 3 Step 5에서 3개 언어 추가, Step 6에서 사용. 일치.
- `ba-plugin-installed` CSS 클래스 — Task 3 Step 6에서 생성, Step 7에서 스타일 정의. 일치.

**순환 의존 확인:** `safe-storage.ts` → `migration.ts` (Task 2 Step 4), `main.ts` → 둘 다. `migration.ts`는 아무것도 import하지 않으므로 순환 없음.

발견된 불일치 없음.
