// 모순해결(reconcile) 모듈 — 비파괴 (Second Brain Layer)
// ======================================================
// 특정 주제로 검색한 관련 노트들에서 LLM이 서로 상충하는 진술(모순)을 추출하여
// 사용자에게 리포트로 제시하는 능동 동작이다. 순수 코어(parseContradictionReport /
// formatReconcileReport)와 Vault/LLM에 접근하는 얇은 실행 래퍼(runReconcile)로
// 구성한다(graph-rag·synthesize 모듈과 동일한 "순수 코어 + I/O 래퍼" 패턴).
//
// 핵심 보장:
// - runReconcile은 검색·LLM 호출·리포트 반환만 수행하며 "어떤 노트도 수정하지 않는다"
//   (비파괴, Req 8.2). 승인 후 반영(applyReconciliation)은 별도 2단계로 분리한다(Task 7.3).
// - parseContradictionReport는 순수 함수이며, 파싱에 실패해도 예외를 던지지 않고
//   빈 배열을 반환한다(Req 8.3).
// - 모순 후보를 하나도 추출하지 못하면 "모순 없음"을 안내하고 노트를 변경하지 않는다(Req 8.5).
// - LLM 호출은 IAiClient.converseLight(단발 작업)만 사용한다(백엔드 무관, Req 8.1 토대).

import { TFile, normalizePath } from "obsidian";
import type { SecondBrainContext } from "./scheduler";
import {
  toSearchHits,
  hasNoHits,
  SECOND_BRAIN_SYSTEM_PROMPT,
  type SearchHit,
} from "./search-adapter";
import { parseAiFirstNote, buildAiFirstNote, type AiFirstMeta } from "./ai-first-format";
import { upsertGeneratedBlock } from "./sentinel-blocks";

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
}

/**
 * LLM 응답을 파싱하고 성공 여부를 함께 반환한다 (Req 8.3).
 *
 * 기존 parseContradictionReport는 파싱 실패와 "모순 없음"을 모두 빈 배열로 반환해,
 * 응답이 토큰 제한으로 잘렸을 때도 사용자에게 "발견된 모순이 없습니다"라고
 * 잘못 보고했다(거짓 음성). 호출부가 두 경우를 구분할 수 있도록 ok를 함께 준다.
 */
export function parseContradictionResult(llmText: string): ContradictionParseResult {
  if (typeof llmText !== "string") return { ok: false, items: [] };
  const text = llmText.trim();
  // 빈 응답은 "모순 없음"이 아니라 해석 실패로 본다(LLM은 최소 `[]`를 출력해야 한다).
  if (text === "") return { ok: false, items: [] };

  // 코드펜스 제거 + JSON 배열 구간만 추출
  const jsonText = extractJsonArray(text);
  if (jsonText === null) return { ok: false, items: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // 파싱 실패 시 throw 금지, 실패 표시와 함께 빈 배열 반환 (Req 8.3)
    return { ok: false, items: [] };
  }

  if (!Array.isArray(parsed)) return { ok: false, items: [] };

  const result: Contradiction[] = [];
  for (const raw of parsed) {
    const item = normalizeContradiction(raw);
    if (item !== null) result.push(item);
  }
  // 빈 배열([])은 정상 응답이며 "모순 없음"을 의미한다 (Req 8.5).
  return { ok: true, items: result };
}

/**
 * 텍스트에서 JSON 배열 구간을 추출한다.
 * - 코드펜스(```json ... ```)로 감싼 경우 내부만 취한다.
 * - 그 외에는 첫 '['부터 마지막 ']'까지를 배열 후보로 본다.
 * - 배열 구간을 찾지 못하면 null.
 */
function extractJsonArray(text: string): string | null {
  let t = text;
  // 코드펜스가 있으면 내부 내용만 사용한다.
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    t = fenceMatch[1].trim();
  }
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start < 0 || end < 0 || end < start) return null;
  return t.slice(start, end + 1);
}

/**
 * 임의 객체를 Contradiction으로 정규화한다. 유효하지 않으면 null.
 * - notePaths/statements는 문자열 배열만 취한다(문자열 아닌 원소는 제거).
 * - suggestion은 문자열만 취한다.
 * - 세 필드가 모두 비어 있으면(빈 항목) 유효하지 않은 것으로 보고 null을 반환한다.
 */
function normalizeContradiction(raw: unknown): Contradiction | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const notePaths = toStringArray(obj.notePaths);
  const statements = toStringArray(obj.statements);
  const suggestion = typeof obj.suggestion === "string" ? obj.suggestion : "";

  // 완전히 빈 항목은 모순으로 보지 않는다.
  if (notePaths.length === 0 && statements.length === 0 && suggestion.trim() === "") {
    return null;
  }

  return { notePaths, statements, suggestion };
}

/** 값이 문자열 배열이면 문자열 원소만 추려 반환하고, 아니면 빈 배열을 반환한다. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
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
 *    반영은 사용자 승인 후 별도 단계(applyReconciliation, Task 7.3)에서만 수행된다.
 *
 * @param ctx Second Brain 실행 컨텍스트
 * @param topic 모순을 점검할 주제
 */
export async function runReconcile(ctx: SecondBrainContext, topic: string): Promise<string> {
  const trimmedTopic = topic.trim();
  if (trimmedTopic === "") {
    return "모순을 점검할 주제(topic)가 필요합니다.";
  }

  // 1) 기존 Graph RAG 검색 재사용 (읽기 전용, 비파괴)
  const result = await ctx.indexer.search(trimmedTopic);

  // 2) 관련 노트 없음 → 점검할 모순 없음 안내 (노트 미변경)
  if (hasNoHits(result)) {
    return `"${trimmedTopic}"와(과) 관련된 노트를 찾지 못해 점검할 모순이 없습니다.`;
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
  const parsed = parseContradictionResult(response.text);

  // 5-1) 응답 해석 실패 → "모순 없음"으로 오보고하지 않고 실패를 명시한다.
  //      응답이 토큰 제한으로 잘렸거나 JSON 형식이 아닌 경우가 여기에 해당한다.
  if (!parsed.ok) {
    return [
      "모순 점검 응답을 해석할 수 없었습니다(형식 오류 또는 응답 잘림).",
      "모순이 없다는 뜻이 아니므로, 다시 실행하거나 최대 토큰을 늘려 주세요.",
      "어떤 노트도 변경하지 않았습니다.",
    ].join("\n");
  }

  const contradictions = parsed.items;

  // 6) 모순 0건 → 안내, 노트 미변경 (Req 8.5)
  if (contradictions.length === 0) {
    return "발견된 모순이 없습니다. 어떤 노트도 변경하지 않았습니다.";
  }

  // 7) 모순 리포트 반환 — 어떤 노트도 수정하지 않는다 (Req 8.2)
  return formatReconcileReport(contradictions);
}

/**
 * 승인된 정정안을 대상 노트 본문에 병합할 때 사용하는 Sentinel_Block 키.
 * synthesize의 'synthesis' 키와 동일하게 Generated_Region만 교체되므로 User_Region(사람 편집)은
 * 보존된다(비파괴 쓰기, Req 8.4).
 */
const RECONCILE_BLOCK_KEY = "reconcile";

/** 노트 경로에서 제목 후보(확장자 제거한 파일명)를 추론한다. */
function deriveTitleFromPath(notePath: string): string {
  const base = notePath.slice(notePath.lastIndexOf("/") + 1);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
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
 * - AI-first 노트(parseAiFirstNote가 성공)면 메타데이터를 보존한 채 `learned_at`만 now로 바꾸고,
 *   본문에 정정안을 RECONCILE_BLOCK_KEY Sentinel_Block으로 병합한 뒤 buildAiFirstNote로 재직렬화한다.
 * - 그 외(비 AI-first)면 정정안을 Sentinel_Block으로 문서 끝에 병합하고 프론트매터 `learned_at`만
 *   최소 변경으로 갱신한다.
 * - 두 경로 모두 Generated_Region만 교체하므로 사람이 작성한 User_Region은 보존된다.
 *
 * @param current 원본 노트 내용
 * @param notePath 노트 경로(제목 추론용)
 * @param suggestion 승인된 정정안(빈 문자열이면 본문은 그대로 두고 learned_at만 갱신)
 * @param now YYYY-MM-DD 형식의 갱신 시점
 */
function applyToNoteContent(
  current: string,
  notePath: string,
  suggestion: string,
  now: string,
): string {
  const hasSuggestion = suggestion.trim() !== "";
  const parsed = parseAiFirstNote(current);

  if (!parsed.parseFailed) {
    // AI-first 노트: 본문에만 정정안을 병합(User_Region 보존)하고 메타의 learned_at을 갱신한다.
    const newBody = hasSuggestion
      ? upsertGeneratedBlock(parsed.body, RECONCILE_BLOCK_KEY, suggestion)
      : parsed.body;
    const meta: AiFirstMeta = {
      title: parsed.meta.title ?? deriveTitleFromPath(notePath),
      recency: parsed.meta.recency ?? "evergreen",
      confidence: parsed.meta.confidence ?? "medium",
      validFrom: parsed.meta.validFrom,
      learnedAt: now, // Bi_Temporal: 정정을 알게 된 시점으로 갱신 (Req 8.4)
      source: parsed.meta.source,
      tags: parsed.meta.tags,
    };
    return buildAiFirstNote({ meta, body: newBody }, now);
  }

  // 비 AI-first 노트: 정정안 Sentinel_Block을 끝에 병합한 뒤 프론트매터 learned_at만 갱신한다.
  const withSuggestion = hasSuggestion
    ? upsertGeneratedBlock(current, RECONCILE_BLOCK_KEY, suggestion)
    : current;
  return updateLearnedAtMinimal(withSuggestion, now);
}

/**
 * 승인 후 반영 핸들러 (Req 8.4) — runReconcile과 분리된 명시적 2단계.
 *
 * 사용자가 모순 리포트의 특정 Contradiction(정정안)을 명시적으로 "승인"한 경우에만 호출된다.
 * 승인된 Contradiction의 대상 노트(approved.notePaths)만 다음과 같이 갱신한다.
 * - 기존 edit_note/sentinel 병합 경로(vault.read → upsert → vault.modify)로 정정안을 반영하되,
 *   Generated_Region만 교체하여 사람이 작성한 User_Region을 보존한다(비파괴 쓰기).
 * - 각 대상 노트의 Bi_Temporal `learned_at`을 갱신 시점(now)으로 업데이트한다.
 * - 존재하지 않는 경로는 건너뛴다(생성하지 않음). 승인되지 않은 노트는 일절 건드리지 않는다.
 *
 * ⚠️ 이 함수는 "명시적 사용자 승인" 경로에서만 호출되어야 한다. 스케줄러(자동) 경로는
 *    덮어쓰기성 작업에 사용자 확인을 유지하므로 이 함수를 절대 호출하지 않는다(Req 11.4, 8.4).
 *    그래서 runReconcile/scheduler와 분리된 별도 export 함수로 둔다.
 *
 * @param ctx Second Brain 실행 컨텍스트
 * @param approved 사용자가 승인한 단일 모순 항목(정정안 포함)
 * @param now YYYY-MM-DD 형식의 반영 시점(learned_at 갱신용, 주입)
 * @returns 반영 결과 요약 문자열
 */
export async function applyReconciliation(
  ctx: SecondBrainContext,
  approved: Contradiction,
  now: string,
): Promise<string> {
  const targets = Array.isArray(approved?.notePaths) ? approved.notePaths : [];
  if (targets.length === 0) {
    return "반영할 대상 노트가 없습니다(승인된 모순 항목에 노트 경로가 없습니다).";
  }

  const updated: string[] = [];
  const skipped: string[] = [];

  for (const rawPath of targets) {
    const notePath = normalizePath(rawPath);
    const file = ctx.app.vault.getAbstractFileByPath(notePath);

    // 존재하지 않는 노트는 생성하지 않고 건너뛴다(비파괴, 승인 범위 한정).
    if (!(file instanceof TFile)) {
      skipped.push(notePath);
      continue;
    }

    const current = await ctx.app.vault.read(file);
    const next = applyToNoteContent(current, notePath, approved.suggestion ?? "", now);

    // 실제 변경이 있을 때만 기록한다(멱등성 — 동일 내용이면 modify 생략).
    if (next !== current) {
      await ctx.app.vault.modify(file, next);
      updated.push(notePath);
    } else {
      skipped.push(notePath);
    }
  }

  const parts: string[] = [];
  parts.push(`승인된 모순 정정을 반영했습니다 (learned_at=${now}).`);
  parts.push(`갱신: ${updated.length}건${updated.length > 0 ? ` (${updated.join(", ")})` : ""}`);
  if (skipped.length > 0) {
    parts.push(`건너뜀: ${skipped.length}건 (${skipped.join(", ")})`);
  }
  return parts.join("\n");
}
