import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VIEW_I18N } from "./chat-view-i18n";

/**
 * mermaid 그래프 배선(wiring) 테스트
 *
 * 4종 그래프 빌더는 순수 함수로 각자 테스트되지만, "사용자가 실제로 도달할 수 있는가"는
 * 그 테스트가 증명하지 못한다. 배선이 빠진 기능은 코드가 전부 통과하면서 사용자에게는
 * 존재하지 않는다 — 가장 조용한 실패다.
 *
 * DOM 조작은 검증하지 않는다(Obsidian API 는 테스트 환경에 없다). 대신 배선의
 * **정적 계약** 3가지를 소스 기준으로 고정한다.
 *   1. 명령 3개가 등록되어 있고 id 가 기존 것과 충돌하지 않는다(사용자 핫키 보호).
 *   2. 검색 근거 그래프가 chat-view 의 도구 실행 경로에 배선돼 있다.
 *   3. 필요한 i18n 키가 en/ko/ja 세 언어에 모두 있다(AssertNever 가 잡지만, 함수형
 *      키의 **인자 개수**까지는 잡지 못한다).
 */

const SRC = __dirname;
const mainSource = readFileSync(join(SRC, "main.ts"), "utf8");
const chatViewSource = readFileSync(join(SRC, "chat-view.ts"), "utf8");

/**
 * runGraphCommand 본문만 잘라낸 조각.
 *
 * 재진입 가드·진행 표시·finally 정리는 기존 runSecondBrainTool 에도 **똑같은 모양으로**
 * 존재하므로, 파일 전체를 대상으로 단정하면 내 코드를 지워도 그쪽에 매치되어 통과한다.
 * 이건 추측이 아니라 변이 테스트로 실제 확인한 오탐이다.
 */
const graphCommandBlock = (() => {
  const start = mainSource.indexOf("private async runGraphCommand");
  const end = mainSource.indexOf("private registerGraphCommands");
  if (start < 0 || end <= start) throw new Error("runGraphCommand 본문을 찾지 못했다");
  return mainSource.slice(start, end);
})();

/** 새로 추가한 그래프 명령 id 3개. */
const NEW_COMMAND_IDS = [
  "graph-similar-notes",
  "graph-knowledge-gaps",
  "graph-wiki-structure",
] as const;

/**
 * 배선 전부터 존재했던 명령 id. 이 목록이 하나라도 사라지면 사용자 핫키가 끊긴다.
 * (기존 id 를 바꾸지 않았음을 증명하는 회귀 방어)
 */
const EXISTING_COMMAND_IDS = [
  "second-brain-create-wiki-note",
  "second-brain-update-index",
  "second-brain-synthesize",
  "second-brain-reconcile",
  "second-brain-challenge",
  "second-brain-connect",
  "second-brain-emerge",
  "second-brain-architect",
  "second-brain-knowledge-gaps",
  "second-brain-review-queue",
  "second-brain-run-scheduler",
] as const;

describe("명령 등록 — 신규 3종", () => {
  it("그래프 명령 3개가 addCommand 로 등록되어 있다", () => {
    for (const id of NEW_COMMAND_IDS) {
      expect(mainSource).toContain(`id: "${id}"`);
    }
  });

  it("registerGraphCommands 가 onload 경로에서 호출된다", () => {
    // 함수만 정의하고 호출하지 않으면 명령이 팔레트에 나타나지 않는다.
    expect(mainSource).toContain("this.registerGraphCommands(t)");
  });

  it("신규 id 는 기존 second-brain-* 과 겹치지 않는다", () => {
    for (const id of NEW_COMMAND_IDS) {
      expect(EXISTING_COMMAND_IDS as readonly string[]).not.toContain(id);
    }
  });

  it("기존 명령 id 11개가 그대로 남아 있다(사용자 핫키 보호)", () => {
    for (const id of EXISTING_COMMAND_IDS) {
      expect(mainSource).toContain(`id: "${id}"`);
    }
  });

  it("기존 지식 공백 리포트 명령과 그래프 명령이 별도 id 로 공존한다", () => {
    // 리포트(노트 작성)와 그래프(채팅 렌더)는 다른 동작이라 한 id 를 공유하면
    // 한쪽 기능이 사라진다.
    expect(mainSource).toContain('id: "second-brain-knowledge-gaps"');
    expect(mainSource).toContain('id: "graph-knowledge-gaps"');
  });
});

describe("명령 등록 — 안전장치", () => {
  it("재진입 가드로 기존 runningSecondBrainTools Set 을 재사용한다", () => {
    // 새 상태를 만들지 않는다(ponytail). 무거운 유사도 계산 중복 실행 방지.
    expect(graphCommandBlock).toContain("runningSecondBrainTools.has(commandKey)");
    expect(graphCommandBlock).toContain("runningSecondBrainTools.add(commandKey)");
  });

  it("진행 표시를 Notice(문구, 0) 로 띄우고 finally 에서 hide 한다", () => {
    // finally 를 빠뜨리면 예외 경로에서 진행 Notice 가 화면에 영구히 남고 명령이 잠긴다.
    //
    // ⚠️ 이 단정은 반드시 runGraphCommand 본문으로 범위를 좁혀야 한다. 파일 전체를
    // 대상으로 하면 기존 runSecondBrainTool 의 동일한 finally 블록에 매치되어
    // 내 코드에서 progress.hide() 를 지워도 통과한다(변이 테스트로 실제 확인했다).
    expect(graphCommandBlock).toMatch(/new Notice\(t\.graphRunning, 0\)/);
    expect(graphCommandBlock).toMatch(
      /finally \{[\s\S]{0,300}progress\.hide\(\)[\s\S]{0,300}runningSecondBrainTools\.delete/,
    );
  });

  it("인덱스가 비어 있으면 안내하고 중단한다", () => {
    expect(graphCommandBlock).toMatch(/getEntries\(\)\.length === 0[\s\S]{0,120}graphIndexEmpty/);
    // return 이 없으면 안내만 하고 계속 진행해 빈 그래프를 그린다.
    expect(graphCommandBlock).toMatch(/graphIndexEmpty\)[\s\S]{0,40}return/);
  });

  it("위키 구조만 secondBrain.enabled 를 넘긴다", () => {
    // 나머지 2종은 Graph RAG 기능이라 SB 와 무관하게 동작해야 한다.
    expect(mainSource).toMatch(/buildWikiGraph\([\s\S]{0,200}enabled: this\.settings\.secondBrain\.enabled/);
  });

  it("유사도·공백 그래프는 secondBrain.enabled 를 확인하지 않는다", () => {
    // 두 명령의 콜백 사이 구간에 enabled 게이트가 없어야 한다.
    // 주석은 제거하고 본다 — 위키 명령의 설명 주석이 `id:` 줄보다 앞에 오므로 이
    // 구간에 포함되는데, 주석은 동작이 아니다(첫 시도에서 이것 때문에 오탐이 났다).
    const simStart = mainSource.indexOf('id: "graph-similar-notes"');
    const wikiStart = mainSource.indexOf('id: "graph-wiki-structure"');
    expect(simStart).toBeGreaterThan(0);
    expect(wikiStart).toBeGreaterThan(simStart);
    const between = mainSource
      .slice(simStart, wikiStart)
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(between).not.toContain("secondBrain.enabled");
    expect(between).not.toContain("sbDisabled");
  });

  it("읽기 전용 — 그래프 명령 구간에서 vault 쓰기 API 를 호출하지 않는다", () => {
    const start = mainSource.indexOf("private registerGraphCommands");
    const end = mainSource.indexOf("private registerSecondBrainCommands");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = mainSource.slice(start, end);
    for (const forbidden of ["vault.create", "vault.modify", "vault.delete", "writeGapReport"]) {
      expect(block).not.toContain(forbidden);
    }
  });
});

describe("검색 근거 그래프 — 채팅 인라인 배선", () => {
  it("도구 실행 성공 경로에서 appendSearchGraph 를 호출한다", () => {
    expect(chatViewSource).toContain("await this.appendSearchGraph(toolEl)");
  });

  it("appendSearchGraph 가 정의되어 있다", () => {
    expect(chatViewSource).toContain("private async appendSearchGraph(");
  });

  it("소비형 조회(takeLastSearchResult)로 결과를 가져온다", () => {
    // 도구 이름 문자열 비교 대신 소비형 조회를 쓴다 — 검색이 아닌 도구에서는
    // null 이 돌아와 아무 일도 일어나지 않는다.
    expect(chatViewSource).toContain("takeLastSearchResult()");
  });

  it("게이트가 거짓이면 조기 반환해 빈 블록을 만들지 않는다", () => {
    expect(chatViewSource).toMatch(/shouldAttachSearchGraph\(searchResult\)\) return/);
  });

  it("markdown 이 비면 렌더하지 않는다(이중 방어)", () => {
    expect(chatViewSource).toMatch(/if \(!markdown\) return/);
  });

  it("접히는 블록(<details>)으로 붙인다", () => {
    // 기본 접힘이라 답변 본문이 도형에 밀려 내려가지 않는다.
    expect(chatViewSource).toMatch(/createEl\("details"/);
  });

  it("기존 도구 결과 UI(ba-tool-content)를 그대로 유지한다", () => {
    // 그래프를 붙이면서 기존 접히는 블록 UI 를 깨뜨리지 않았음을 고정한다.
    expect(chatViewSource).toContain('cls: "ba-tool-content"');
    expect(chatViewSource).toContain('setIcon(iconEl, "wrench")');
  });

  it("그래프 마크다운이 도구 결과 문자열(LLM 입력)에 섞이지 않는다", () => {
    // appendSearchGraph 는 DOM 에만 쓰고 반환값이 없다 — LLM 토큰을 낭비하지 않는다.
    expect(chatViewSource).toMatch(/private async appendSearchGraph\([\s\S]{0,1600}?\): Promise<void>/);
  });
});

describe("i18n — 3개 국어 완전성", () => {
  const REQUIRED_STRING_KEYS = [
    "graphSearchHeading",
    "cmdSimilarityGraph",
    "cmdGapGraph",
    "cmdWikiGraph",
    "graphIndexEmpty",
    "graphNoActiveNote",
    "graphRunning",
    "graphAlreadyRunning",
    "graphSimilarityEmpty",
    "graphSimilarityNoVector",
    "graphSimilarityDegenerate",
    "graphGapHeading",
    "graphGapEmpty",
    "graphWikiHeading",
    "graphWikiEmpty",
  ] as const;

  const REQUIRED_FN_KEYS = [
    ["graphTruncated", 2],
    ["graphTruncatedEdges", 4],
    ["graphFailed", 1],
    ["graphSimilarityHeading", 1],
    ["graphWikiIsolated", 2],
  ] as const;

  for (const lang of ["en", "ko", "ja"] as const) {
    it(`${lang}: 문자열 키가 모두 있고 비어 있지 않다`, () => {
      const table = VIEW_I18N[lang] as Record<string, unknown>;
      for (const key of REQUIRED_STRING_KEYS) {
        expect(typeof table[key], `${lang}.${key}`).toBe("string");
        expect((table[key] as string).length).toBeGreaterThan(0);
      }
    });

    it(`${lang}: 함수형 키가 정확한 인자 개수를 받는다`, () => {
      // AssertNever 가드는 키 존재만 검사한다. 인자 개수가 언어마다 다르면 어떤
      // 언어에서만 분모가 빠진 고지가 나가고 tsc 는 통과한다.
      const table = VIEW_I18N[lang] as Record<string, unknown>;
      for (const [key, arity] of REQUIRED_FN_KEYS) {
        expect(typeof table[key], `${lang}.${key}`).toBe("function");
        expect((table[key] as (...a: unknown[]) => string).length, `${lang}.${key} arity`).toBe(arity);
      }
    });

    it(`${lang}: 절단 고지에 분모(전체 수)가 들어간다`, () => {
      // "280개 생략"만으로는 규모를 알 수 없다. 340 대 60 이어야 "일부다"를 안다.
      const table = VIEW_I18N[lang] as Record<string, (...a: number[]) => string>;
      const notice = table.graphTruncated(60, 340);
      expect(notice).toContain("60");
      expect(notice).toContain("340");
    });

    it(`${lang}: 엣지 절단 고지에 네 숫자가 모두 들어간다`, () => {
      const table = VIEW_I18N[lang] as Record<string, (...a: number[]) => string>;
      const notice = table.graphTruncatedEdges(60, 200, 150, 900);
      for (const n of ["60", "200", "150", "900"]) {
        expect(notice).toContain(n);
      }
    });

    it(`${lang}: 고립 경고에 분자·분모가 들어간다`, () => {
      const table = VIEW_I18N[lang] as Record<string, (...a: number[]) => string>;
      const warn = table.graphWikiIsolated(7, 10);
      expect(warn).toContain("7");
      expect(warn).toContain("10");
    });
  }

  it("sbDisabled 를 재사용하고 위키 전용 비활성 키를 새로 만들지 않았다", () => {
    for (const lang of ["en", "ko", "ja"] as const) {
      const table = VIEW_I18N[lang] as Record<string, unknown>;
      expect(typeof table.sbDisabled).toBe("string");
      expect(table.graphWikiDisabled).toBeUndefined();
    }
  });

  it("새 설정 항목을 만들지 않았다 — graphTraversalDepth 가 옵트아웃으로 동작한다", () => {
    // 그래프 표시 여부 설정을 추가하면 이 단정이 깨진다(설정 추가는 비용이다).
    const typesSource = readFileSync(join(SRC, "types.ts"), "utf8");
    for (const forbidden of ["showSearchGraph", "graphEnabled", "mermaidGraph", "inlineGraph"]) {
      expect(typesSource).not.toContain(forbidden);
    }
  });
});
