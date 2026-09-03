// 모순해결(reconcile) 모듈 — 비파괴 (Second Brain Layer)
// ======================================================
// 특정 주제로 검색한 관련 노트들에서 LLM이 서로 상충하는 진술(모순)을 추출하여
// 사용자에게 리포트로 제시하는 능동 동작이다. 순수 코어(parseContradictionReport /
// formatReconcileReport)와 Vault/LLM에 접근하는 얇은 실행 래퍼(runReconcile)로
// 구성한다(graph-rag·synthesize 모듈과 동일한 "순수 코어 + I/O 래퍼" 패턴).
//
// 핵심 보장:
// - runReconcile은 검색·LLM 호출·리포트 반환만 수행하며 "어떤 노트도 수정하지 않는다"
//   (비파괴, Req 8.2). 승인 후 반영(applyReconciliations)은 별도 2단계로 분리한다(Task 7.3).
// - parseContradictionReport는 순수 함수이며, 파싱에 실패해도 예외를 던지지 않고
//   빈 배열을 반환한다(Req 8.3).
// - 모순 후보를 하나도 추출하지 못하면 "모순 없음"을 안내하고 노트를 변경하지 않는다(Req 8.5).
// - LLM 호출은 IAiClient.converseLight(단발 작업)만 사용한다(백엔드 무관, Req 8.1 토대).

import { TFile, normalizePath } from "obsidian";
import type { SecondBrainContext } from "./scheduler";
import {
  toSearchHits,
  hasNoHits,
  staleIndexWarning,
  SECOND_BRAIN_SYSTEM_PROMPT,
  type SearchHit,
} from "./search-adapter";
import { upsertGeneratedBlock, getGeneratedBlock } from "./sentinel-blocks";
import { processIfChanged } from "./vault-write";
import { parseJsonArray, toStringArray } from "./llm-json";

/**
 * 모순 항목 — 상충하는 노트 집합, 상충 진술, 제안 정정안을 담는다 (Req 8.3).
 */
export interface Contradiction {
  /** 상충하는 노트 쌍/집합의 경로 목록 */
  notePaths: string[];
  /** 서로 상충하는 진술 목록 */
  statements: string[];
  /** LLM이 제안한 정정안(제안일 뿐, 자동 반영되지 않음) */
  suggestion: string;
}

/**
 * 모순 점검 LLM 호출에 사용할 최대 토큰 수.
 * 모순 리포트는 종합보다는 짧고 분류 응답보다는 길어 중간값을 둔다(설계 §LLM 호출 규약).
 */
const RECONCILE_MAX_TOKENS = 1500;

/**
 * LLM 응답 텍스트에서 모순 항목을 파싱한다 — 순수 함수 (Req 8.3).
 *
 * LLM은 모순 후보를 JSON 배열로 출력하도록 프롬프트에서 지시받는다. 이 함수는 응답에서
 * JSON 배열을 추출·파싱하여 구조화된 Contradiction 목록으로 변환한다. 응답이 코드펜스로
 * 감싸여 있거나 앞뒤에 설명이 섞여 있어도 배열만 안전하게 추출한다.
 *
 * 견고성(Req 8.3): 입력이 비어 있거나, JSON이 아니거나, 형식이 손상된 경우에도 예외를
 * 던지지 않고 빈 배열을 반환한다. 빈 배열 출력([])은 "모순 없음"을 의미한다(Req 8.5).
 *
 * @param llmText LLM 응답 텍스트
 * @returns 파싱된 모순 항목 목록(실패 시 빈 배열)
 */
export function parseContradictionReport(llmText: string): Contradiction[] {
  return parseContradictionResult(llmText).items;
}

/** 파싱 결과. "모순 0건"과 "응답 해석 실패"를 구분한다. */
export interface ContradictionParseResult {
  /** 파싱에 성공했는지. false면 items는 비어 있고 응답을 신뢰할 수 없다. */
  ok: boolean;
  /** 파싱된 모순 항목 (ok=false면 빈 배열) */
  items: Contradiction[];
  /**
   * 배열에는 있었지만 정규화를 통과하지 못해 버린 후보 수.
   *
   * 실재하지 않는 노트를 가리키는 후보가 대표적이다. `items`가 비었는데 이 값이 0보다
   * 크면 "모순 없음"이 아니라 "후보가 전부 무효였음"이다.
   */
  dropped: number;
}

/**
 * LLM 응답을 파싱하고 성공 여부를 함께 반환한다 (Req 8.3).
 *
 * 기존 parseContradictionReport는 파싱 실패와 "모순 없음"을 모두 빈 배열로 반환해,
 * 응답이 토큰 제한으로 잘렸을 때도 사용자에게 "발견된 모순이 없습니다"라고
 * 잘못 보고했다(거짓 음성). 호출부가 두 경우를 구분할 수 있도록 ok를 함께 준다.
 */
export function parseContradictionResult(
  llmText: string,
  allowedPaths?: ReadonlySet<string>
): ContradictionParseResult {
  // 파싱·실패 의미론은 llm-json이 단일 출처로 갖는다. 빈 배열([])은 정상 응답이며
  // "모순 없음"을 의미하고(Req 8.5), ok=false는 해석 실패다(Req 8.3).
  return parseJsonArray(llmText, (raw) => normalizeContradiction(raw, allowedPaths));
}

/**
 * 임의 객체를 Contradiction으로 정규화한다. 유효하지 않으면 null.
 * - notePaths/statements는 문자열 배열만 취한다(문자열 아닌 원소는 제거).
 * - suggestion은 문자열만 취한다.
 * - 세 필드가 모두 비어 있으면(빈 항목) 유효하지 않은 것으로 보고 null을 반환한다.
 *
 * @param allowedPaths 주면 이 집합에 있는 노트 경로만 남기고, 남는 것이 없으면 항목을
 *   버린다. 승인 시 정정안이 이 경로의 노트에 기록되므로(applyReconciliations), 지어낸
 *   경로가 통과하면 사용자가 승인한 정정이 엉뚱한 노트에 가거나 조용히 사라진다.
 */
function normalizeContradiction(
  raw: unknown,
  allowedPaths?: ReadonlySet<string>
): Contradiction | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const rawPaths = toStringArray(obj.notePaths);
  const notePaths =
    allowedPaths === undefined ? rawPaths : rawPaths.filter((p) => allowedPaths.has(p));
  const statements = toStringArray(obj.statements);
  const suggestion = typeof obj.suggestion === "string" ? obj.suggestion : "";

  // 경로를 제한하는 중이라면, 걸러낸 뒤 남는 노트가 없는 항목은 적용할 대상이 없다.
  if (allowedPaths !== undefined && notePaths.length === 0) return null;

  // 완전히 빈 항목은 모순으로 보지 않는다.
  if (notePaths.length === 0 && statements.length === 0 && suggestion.trim() === "") {
    return null;
  }

  return { notePaths, statements, suggestion };
}

/**
 * 모순 리포트를 사용자에게 제시할 마크다운으로 렌더한다 — 순수 함수.
 *
 * 항목이 없으면 "모순 없음" 안내 문구를 반환한다. 각 항목은 관련 노트·상충 진술·제안
 * 정정안을 섹션으로 표시하며, 정정안이 사용자 승인 전까지 반영되지 않음을 명시한다(비파괴).
 *
 * @param items 파싱된 모순 항목 목록
 */
export function formatReconcileReport(items: Contradiction[]): string {
  if (items.length === 0) {
    return "발견된 모순이 없습니다. 어떤 노트도 변경하지 않았습니다.";
  }

  const lines: string[] = [];
  lines.push(`# 모순 리포트 (${items.length}건)`);
  lines.push("");

  items.forEach((item, index) => {
    lines.push(`## ${index + 1}. 모순 후보`);

    if (item.notePaths.length > 0) {
      lines.push("");
      lines.push("**관련 노트:**");
      item.notePaths.forEach((path) => lines.push(`- ${path}`));
    }

    if (item.statements.length > 0) {
      lines.push("");
      lines.push("**상충 진술:**");
      item.statements.forEach((statement) => lines.push(`- ${statement}`));
    }

    if (item.suggestion.trim() !== "") {
      lines.push("");
      lines.push(`**제안 정정안:** ${item.suggestion}`);
    }

    lines.push("");
  });

  lines.push("> 위 정정안은 사용자가 명시적으로 승인하기 전까지 어떤 노트에도 반영되지 않습니다.");
  return lines.join("\n");
}

/**
 * 모순 점검 LLM 프롬프트를 구성한다 — 모듈 내부 헬퍼.
 *
 * 각 검색 히트의 제목·경로·발췌를 포함하고, 모순 후보를 JSON 배열로만 출력하도록
 * 지시한다(parseContradictionReport와 짝을 이룬다). 어떤 노트도 수정하지 말고 정정안은
 * 제안으로만 제시하라는 비파괴 지침을 함께 전달한다(Req 8.2).
 */
function buildReconcilePrompt(topic: string, hits: SearchHit[]): string {
  const lines: string[] = [];
  lines.push(`# 모순 점검 요청: ${topic}`);
  lines.push("");
  lines.push(
    `아래는 "${topic}"와(과) 관련된 노트 발췌입니다. 노트들 사이에서 서로 상충하는 진술(모순)을 찾으십시오.`,
  );
  lines.push("");
  lines.push("## 관련 노트");
  lines.push("");

  hits.forEach((hit, index) => {
    lines.push(`### ${index + 1}. ${hit.title}`);
    lines.push(`- 경로: ${hit.path}`);
    lines.push(`- 발췌: ${hit.excerpt}`);
    lines.push("");
  });

  lines.push("## 출력 형식");
  lines.push("- 모순 후보를 JSON 배열로만 출력하십시오. 배열 앞뒤에 다른 설명을 덧붙이지 마십시오.");
  lines.push("- 각 항목은 다음 형식의 객체입니다:");
  lines.push(
    '  {"notePaths": ["상충 노트 경로", ...], "statements": ["상충 진술", ...], "suggestion": "제안 정정안"}',
  );
  lines.push("- 모순이 없으면 빈 배열 `[]`을 출력하십시오.");
  lines.push("- 어떤 노트도 수정하지 마십시오. 정정안은 제안일 뿐 자동 반영되지 않습니다.");

  return lines.join("\n");
}

/**
 * 모순해결 실행 래퍼 (Req 8.2, 8.5) — 비파괴.
 *
 * 파이프라인:
 * 1. VaultIndexer.search로 주제 관련 노트를 검색한다(읽기 전용).
 * 2. hasNoHits면 점검할 노트가 없으므로 안내만 반환한다(노트 미변경).
 * 3. toSearchHits → buildReconcilePrompt로 모순 점검 프롬프트를 구성한다.
 * 4. IAiClient.converseLight(단발 호출)로 모순 후보 응답을 받는다(백엔드 무관, Req 8.1 토대).
 * 5. parseContradictionReport로 모순 항목을 파싱한다(실패 시 빈 배열, Req 8.3).
 * 6. 0건이면 "모순 없음"을 안내한다(Req 8.5).
 * 7. 그 외에는 formatReconcileReport 리포트를 반환한다.
 *
 * ⚠️ 이 함수는 어떤 노트도 생성·수정·삭제하지 않는다(비파괴, Req 8.2). 정정안의 실제
 *    반영은 사용자 승인 후 별도 단계(applyReconciliations, Task 7.3)에서만 수행된다.
 *
 * @param ctx Second Brain 실행 컨텍스트
 * @param topic 모순을 점검할 주제
 */
export interface ReconcileOutcome {
  /** 도구 응답·알림에 그대로 쓰는 사람이 읽는 리포트. */
  report: string;
  /**
   * 승인 UI에 넘길 구조화된 모순 목록. 주제가 비었거나 관련 노트가 없거나
   * 응답 해석에 실패했거나 모순이 0건이면 빈 배열이다.
   *
   * 문자열 리포트만 돌려주면 승인 화면이 그것을 다시 파싱해야 한다 — LLM 응답을 한 번
   * 파싱해 놓고 그 결과를 버리고 사람이 읽을 문장을 재파싱하는 것은 되돌릴 이유가 없는
   * 정보 손실이다.
   */
  contradictions: Contradiction[];
}

/**
 * runReconcile의 구조화된 형태. 리포트 문자열과 파싱된 모순 목록을 함께 돌려준다.
 * 동작은 runReconcile과 동일하며 비파괴다 — 어떤 노트도 건드리지 않는다.
 */
export async function runReconcileDetailed(
  ctx: SecondBrainContext,
  topic: string
): Promise<ReconcileOutcome> {
  const trimmedTopic = topic.trim();
  if (trimmedTopic === "") {
    return { report: "모순을 점검할 주제(topic)가 필요합니다.", contradictions: [] };
  }

  // 1) 기존 Graph RAG 검색 재사용 (읽기 전용, 비파괴)
  const result = await ctx.indexer.search(trimmedTopic);

  // 인덱스가 낡은 경우(임베딩 모델 변경) 결과 메시지에 경고를 덧붙인다.
  const staleNote = staleIndexWarning(result);

  // 2) 관련 노트 없음 → 점검할 모순 없음 안내 (노트 미변경)
  if (hasNoHits(result)) {
    return {
      report: `"${trimmedTopic}"와(과) 관련된 노트를 찾지 못해 점검할 모순이 없습니다.${staleNote}`,
      contradictions: [],
    };
  }

  // 3) 검색 히트 → 모순 점검 프롬프트
  const hits = toSearchHits(result);
  const prompt = buildReconcilePrompt(trimmedTopic, hits);

  // 4) 단발 LLM 호출 (백엔드 무관)
  const response = await ctx.aiClient.converseLight(
    prompt,
    SECOND_BRAIN_SYSTEM_PROMPT,
    RECONCILE_MAX_TOKENS,
  );

  // 5) 모순 항목 파싱 (실패 시 실패 표시, throw 금지 — Req 8.3)
  // 이번 검색에 걸린 노트만 모순 대상으로 인정한다. 프롬프트에 없던 경로를 LLM이
  // 지어내면 승인된 정정안이 엉뚱한 노트로 간다.
  const parsed = parseContradictionResult(response.text, new Set(hits.map((h) => h.path)));

  // 5-1) 응답 해석 실패 → "모순 없음"으로 오보고하지 않고 실패를 명시한다.
  //      응답이 토큰 제한으로 잘렸거나 JSON 형식이 아닌 경우가 여기에 해당한다.
  if (!parsed.ok) {
    return {
      report: [
        "모순 점검 응답을 해석할 수 없었습니다(형식 오류 또는 응답 잘림).",
        "모순이 없다는 뜻이 아니므로, 다시 실행하거나 최대 토큰을 늘려 주세요.",
        "어떤 노트도 변경하지 않았습니다.",
      ].join("\n"),
      contradictions: [],
    };
  }

  const contradictions = parsed.items;

  // 6) 모순 0건 → 안내, 노트 미변경 (Req 8.5)
  if (contradictions.length === 0) {
    // 후보는 있었지만 전부 실재하지 않는 노트를 가리켜 버린 경우와 정말로 모순이 없는
    // 경우를 구분한다. 전자를 "모순 없음"으로 보고하면 LLM이 근거를 날조했다는 사실이
    // 사용자에게 전달되지 않는다.
    if (parsed.dropped > 0) {
      return {
        report: [
          `모순 후보 ${parsed.dropped}건이 모두 문맥에 없는 노트를 가리켜 버렸습니다.`,
          "모순이 없다는 뜻이 아니므로, 다시 실행해 주세요.",
          `어떤 노트도 변경하지 않았습니다.${staleNote}`,
        ].join("\n"),
        contradictions: [],
      };
    }
    return {
      report: `발견된 모순이 없습니다. 어떤 노트도 변경하지 않았습니다.${staleNote}`,
      contradictions: [],
    };
  }

  // 7) 모순 리포트 반환 — 어떤 노트도 수정하지 않는다 (Req 8.2)
  return {
    report: `${formatReconcileReport(contradictions)}${staleNote}`,
    contradictions,
  };
}

/**
 * 모순해결 실행 래퍼 — 리포트 문자열만 필요한 호출부(LLM 도구)를 위한 얇은 감싸기.
 * 동작은 runReconcileDetailed와 완전히 같다.
 */
export async function runReconcile(ctx: SecondBrainContext, topic: string): Promise<string> {
  return (await runReconcileDetailed(ctx, topic)).report;
}

/**
 * 승인된 정정안을 대상 노트 본문에 병합할 때 사용하는 Sentinel_Block 키.
 * synthesize의 'synthesis' 키와 동일하게 Generated_Region만 교체되므로 User_Region(사람 편집)은
 * 보존된다(비파괴 쓰기, Req 8.4).
 */
const RECONCILE_BLOCK_KEY = "reconcile";

/**
 * 정정안 경계 표식.
 *
 * 번호 목록(`1. `)으로 나누면 항목 경계가 모호해진다 — 정정안이 여러 줄이거나 그 자체가
 * `1. `로 시작하면 다음 실행에서 경계를 잃거나 진짜 접두어를 목록 번호로 지운다.
 * HTML 주석은 미리보기에 보이지 않고 정정안 본문에 나타날 일이 없다.
 */
const RECONCILE_ITEM_MARKER = "<!-- @item -->";

/**
 * 기존 정정 블록과 새 정정안을 합친다 — 순수 함수.
 *
 * `upsertGeneratedBlock`은 Generated_Region **전체**를 교체한다. 그래서 이번 승인분만으로
 * 블록을 만들면 이전 실행에서 승인한 정정이 사라진다. 사용자가 명시적으로 승인한 것을
 * 다음 승인이 지우는 조용한 손실이므로 합집합으로 다시 쓴다.
 *
 * 한 건이면 문구 그대로 쓴다(표식 없음) — 대부분의 경우이고, 노트에 군더더기를 남길
 * 이유가 없다. 두 건 이상이면 각 항목 앞에 경계 표식을 둔다.
 */
export function mergeReconcileBlock(
  existingBlock: string | null,
  incoming: readonly string[]
): string {
  const items = parseReconcileBlock(existingBlock);
  for (const raw of incoming) {
    const next = raw.trim();
    // 표식을 포함한 정정안은 되읽기를 깨뜨린다. 표식만 지우고 받는다.
    const safe = next.split(RECONCILE_ITEM_MARKER).join("").trim();
    if (safe !== "" && !items.includes(safe)) items.push(safe);
  }

  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return items.map((item) => `${RECONCILE_ITEM_MARKER}\n${item}`).join("\n\n");
}

/**
 * 기록된 정정 블록에서 정정안 목록을 되읽는다.
 *
 * 표식이 없으면 블록 전체가 한 건이다 — 여러 줄짜리 정정안을 줄 단위로 쪼개면 문장이
 * 조각난다.
 */
function parseReconcileBlock(block: string | null): string[] {
  if (block === null) return [];
  const text = block.trim();
  if (text === "") return [];

  if (!text.includes(RECONCILE_ITEM_MARKER)) return [text];
  return text
    .split(RECONCILE_ITEM_MARKER)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * 비(非) AI-first 노트의 프론트매터 `learned_at`만 최소 변경으로 갱신한다.
 *
 * - 표준 프론트매터(`---\n ... \n---`)가 있으면 그 안의 `learned_at:` 줄만 새 값으로 교체하고,
 *   없으면 프론트매터 끝에 `learned_at` 줄을 추가한다(다른 키/본문은 불변).
 * - 프론트매터가 없거나 닫히지 않았으면 최소 프론트매터를 앞에 추가하고 기존 내용은 그대로 보존한다.
 *
 * @param content 원본 노트 내용
 * @param now YYYY-MM-DD 형식의 갱신 시점
 */
function updateLearnedAtMinimal(content: string, now: string): string {
  if (content.startsWith("---\n")) {
    const afterOpen = content.slice(4); // 여는 "---\n" 제거
    const closeIdx = afterOpen.indexOf("\n---");
    if (closeIdx !== -1) {
      const frontmatter = afterOpen.slice(0, closeIdx);
      const rest = afterOpen.slice(closeIdx); // "\n---..." (닫는 구분자 이후 본문 포함)
      const lines = frontmatter.split("\n");
      let found = false;
      const newLines = lines.map((line) => {
        if (/^learned_at:\s?/.test(line)) {
          found = true;
          return `learned_at: ${now}`;
        }
        return line;
      });
      if (!found) newLines.push(`learned_at: ${now}`);
      return `---\n${newLines.join("\n")}${rest}`;
    }
  }
  // 프론트매터 부재/손상 → 최소 프론트매터를 앞에 추가(기존 내용 보존)
  return `---\nlearned_at: ${now}\n---\n${content}`;
}

/**
 * 단일 노트에 승인된 정정안을 반영하고 `learned_at`을 갱신한 새 내용을 만든다 — 순수 보조.
 *
 * 정정안을 Sentinel_Block으로 문서 끝에 병합하고 프론트매터 `learned_at`만 최소 변경으로
 * 갱신한다. Generated_Region만 교체하므로 사람이 작성한 User_Region은 보존된다.
 *
 * **AI-first 형식으로 재직렬화하지 않는다.** 과거에는 `parseAiFirstNote`가 성공하면
 * `buildAiFirstNote`로 다시 썼는데, 그 판정은 "프론트매터가 닫혀 있다" 뿐이라 **모든**
 * 일반 노트가 통과한다. 그러면 재직렬화가 아는 키(title/recency/confidence/valid_from/
 * learned_at/source/tags)만 남기고 `aliases`·`cssclasses`·사용자 정의 키·YAML 주석·목록형
 * tags를 조용히 지운다. 모순 반영 대상은 검색에 걸린 **사용자 노트**이므로 실제 데이터
 * 손실이다.
 *
 * 최소 갱신 경로가 AI-first 노트에도 똑같이 맞는다 — `learned_at` 줄만 바꾸고 나머지는
 * 건드리지 않으므로 메타데이터 보존은 오히려 더 확실하다.
 *
 * @param current 원본 노트 내용
 * @param suggestion 승인된 정정안(빈 문자열이면 본문은 그대로 두고 learned_at만 갱신)
 * @param now YYYY-MM-DD 형식의 갱신 시점
 */
function applyToNoteContent(
  current: string,
  suggestions: readonly string[],
  now: string
): string {
  const merged = mergeReconcileBlock(
    // 기존 블록과 합친다. upsertGeneratedBlock은 블록 **전체**를 교체하므로 이번
    // 승인분만으로 만들면 다른 실행에서 승인한 정정이 조용히 사라진다.
    getGeneratedBlock(current, RECONCILE_BLOCK_KEY),
    suggestions
  );
  const withSuggestion =
    merged !== "" ? upsertGeneratedBlock(current, RECONCILE_BLOCK_KEY, merged) : current;
  return updateLearnedAtMinimal(withSuggestion, now);
}


/**
 * 노트 하나에 정정안들을 **한 번의 쓰기로** 반영한다. 실제로 썼으면 true.
 *
 * 존재하지 않는 노트는 생성하지 않는다(비파괴, 승인 범위 한정). 내용이 그대로면 쓰지
 * 않는다 — 같은 바이트를 써서 mtime만 바꾸면 인덱서가 그 노트를 다시 임베딩한다.
 */
async function writeSuggestions(
  ctx: SecondBrainContext,
  notePath: string,
  suggestions: readonly string[],
  now: string,
): Promise<boolean> {
  const file = ctx.app.vault.getAbstractFileByPath(notePath);
  if (!(file instanceof TFile)) return false;

  return processIfChanged(ctx.app, file, (content) =>
    applyToNoteContent(content, suggestions, now)
  );
}

/**
 * 승인된 정정안 여러 건을 **노트 단위로 합쳐** 한 번씩 반영한다 (Req 8.4).
 *
 * 왜 합치는가: 정정안은 대상 노트마다 고정 키 `reconcile` Sentinel_Block에 upsert된다.
 * 한 배치에서 두 승인 항목의 `notePaths`가 같은 노트를 포함하면 두 번째 쓰기가 첫 번째를
 * **교체**한다 — 요약은 둘 다 반영했다고 말하지만 노트에는 마지막 것만 남는다. 사용자가
 * 명시적으로 승인한 정정이 조용히 사라지는 것이므로 노트별로 모아 한 번만 쓴다.
 *
 * 항목별 키를 쪼개지 않은 이유: 키가 항목 순서에 묶이면 다음 실행에서 순서가 바뀔 때
 * 같은 노트에 낡은 블록이 남는다. 하나의 블록에 번호를 붙이는 쪽이 멱등하다.
 *
 * @param approved 사용자가 승인한 모순 항목들
 * @param now YYYY-MM-DD 형식의 반영 시점(learned_at 갱신용, 주입)
 */
export async function applyReconciliations(
  ctx: SecondBrainContext,
  approved: readonly Contradiction[],
  now: string,
): Promise<string> {
  // 노트별 정정안. 같은 문구가 두 항목에 있으면 한 번만 넣는다.
  const byNote = new Map<string, string[]>();

  for (const item of approved) {
    const suggestion = (item?.suggestion ?? "").trim();
    const targets = Array.isArray(item?.notePaths) ? item.notePaths : [];
    for (const rawPath of targets) {
      const notePath = normalizePath(rawPath);
      const list = byNote.get(notePath) ?? [];
      if (suggestion !== "" && !list.includes(suggestion)) list.push(suggestion);
      byNote.set(notePath, list);
    }
  }

  if (byNote.size === 0) {
    return "반영할 대상 노트가 없습니다(승인된 모순 항목에 노트 경로가 없습니다).";
  }

  const updated: string[] = [];
  const skipped: string[] = [];

  for (const [notePath, suggestions] of byNote) {
    // 노트당 한 번만 쓴다. 여러 번 쓰면 mtime이 그만큼 바뀌어 재임베딩을 부르고,
    // 사용자가 편집 중일 때 겹칠 창도 그만큼 늘어난다.
    if (await writeSuggestions(ctx, notePath, suggestions, now)) updated.push(notePath);
    else skipped.push(notePath);
  }

  const parts: string[] = [];
  parts.push(`승인된 모순 정정을 반영했습니다 (learned_at=${now}).`);
  parts.push(`갱신: ${updated.length}건${updated.length > 0 ? ` (${updated.join(", ")})` : ""}`);
  if (skipped.length > 0) {
    parts.push(`건너뜀: ${skipped.length}건 (${skipped.join(", ")})`);
  }
  return parts.join("\n");
}
