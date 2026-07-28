// 종합(synthesize) 모듈 (Second Brain Layer)
// ============================================
// 특정 주제로 검색한 관련 노트 발췌에서 LLM이 패턴을 종합하여 하나의 AI_First_Note를
// 생성·갱신하는 능동 동작이다. 순수 코어(buildSynthesisPrompt)와 Vault/LLM에 접근하는
// 얇은 실행 래퍼(runSynthesize)로 구성한다(graph-rag 모듈과 동일한 "순수 코어 + I/O 래퍼" 패턴).
//
// 핵심 보장:
// - buildSynthesisPrompt는 부수효과 없는 순수 함수로, 각 검색 히트의 제목·발췌를 모두 포함한다
//   (Req 7.3, Property 14).
// - runSynthesize는 기존 VaultIndexer.search로만 검색하고(Req 7.2), 검색 결과가 없으면
//   노트를 생성하지 않고 안내만 반환한다(Req 7.6).
// - LLM 호출은 IAiClient.converseLight(단발 작업)만 사용한다(백엔드 무관, Req 7.5).
// - 종합 본문은 Block_Key 'synthesis'의 Sentinel_Block으로 감싸 작성하므로, 재실행 시
//   사용자가 추가한 주석(User_Region)은 보존된다(Req 7.4).

import { TFile, normalizePath } from "obsidian";
import type { SecondBrainContext } from "./scheduler";
import {
  toSearchHits,
  hasNoHits,
  staleIndexWarning,
  SECOND_BRAIN_SYSTEM_PROMPT,
  type SearchHit,
} from "./search-adapter";
import { buildAiFirstNote, type AiFirstMeta } from "./ai-first-format";
import { upsertGeneratedBlock } from "./sentinel-blocks";
import { ensureWikiFolders } from "./wiki-structure";
// 볼트 경로 탈출 방지 가드 (normalizePath는 ".." 를 해석하지 않는다)
import { ensureWithinFolder } from "./vault-path-guard";

/** 종합 본문을 감싸는 Sentinel_Block 키 (Req 7.4). */
const SYNTHESIS_BLOCK_KEY = "synthesis";

/**
 * 종합 LLM 호출에 사용할 최대 토큰 수.
 * 종합은 여러 노트를 통합하는 비교적 긴 출력이 필요하므로 넉넉히 둔다(설계 §LLM 호출 규약).
 */
const SYNTHESIS_MAX_TOKENS = 2000;

/**
 * 검색 결과로 종합 LLM 프롬프트를 구성한다 — 순수 함수 (Req 7.3, Property 14).
 *
 * 각 검색 히트의 제목과 발췌(excerpt)를 모두 포함하여, LLM이 흩어진 노트의 패턴을
 * 종합하도록 지시한다. 출력은 항상 모든 히트의 제목을 포함한다(Property 14).
 *
 * @param topic 종합 대상 주제/태그
 * @param hits 검색으로 모은 관련 노트 히트 목록
 */
export function buildSynthesisPrompt(topic: string, hits: SearchHit[]): string {
  const lines: string[] = [];
  lines.push(`# 종합 요청: ${topic}`);
  lines.push("");
  lines.push(
    `아래는 "${topic}"와(과) 관련된 노트 발췌입니다. 이 발췌들에서 공통 패턴·핵심 통찰·상호 관계를 ` +
      "종합하여 하나의 일관된 노트 본문으로 정리하십시오.",
  );
  lines.push("");
  lines.push("## 관련 노트");
  lines.push("");

  if (hits.length === 0) {
    // 실행 래퍼는 0건을 별도 분기로 처리하지만(Req 7.6), 순수 함수 단독 호출에도 안전하게 동작한다.
    lines.push("_관련 노트가 없습니다._");
  } else {
    hits.forEach((hit, index) => {
      // 각 히트의 제목을 반드시 포함한다(Property 14).
      lines.push(`### ${index + 1}. ${hit.title}`);
      lines.push(`- 경로: ${hit.path}`);
      lines.push(`- 발췌: ${hit.excerpt}`);
      lines.push("");
    });
  }

  lines.push("## 작성 지침");
  lines.push("- 제공된 노트 발췌만을 근거로 종합하고, 근거 없는 내용은 단정하지 마십시오.");
  lines.push("- 다른 노트를 참조할 때는 위키링크([[노트 제목]]) 형식을 사용하십시오.");
  lines.push("- 결과는 마크다운 본문만 출력하십시오(프론트매터는 작성하지 마십시오).");

  return lines.join("\n");
}

/**
 * 종합 실행 래퍼 (Req 7.2, 7.4, 7.5, 7.6).
 *
 * 파이프라인:
 * 1. VaultIndexer.search로 주제 관련 노트를 검색한다(Req 7.2).
 * 2. hasNoHits면 노트를 생성하지 않고 안내 메시지만 반환한다(Req 7.6).
 * 3. toSearchHits → buildSynthesisPrompt로 종합 프롬프트를 구성한다(Req 7.3).
 * 4. IAiClient.converseLight(단발 호출)로 종합 결과를 받는다(백엔드 무관, Req 7.5).
 * 5. 종합 본문을 Block_Key 'synthesis'의 Sentinel_Block으로 감싸 작성한다(Req 7.4).
 *    - 신규 노트: buildAiFirstNote로 AI_First_Note를 만들어 Wiki_Folder에 생성한다.
 *    - 기존 노트: 현재 내용을 읽어 synthesis 블록만 교체(upsert)하여 User_Region을 보존한다.
 *
 * @param ctx Second Brain 실행 컨텍스트
 * @param topic 종합 대상 주제
 */
export async function runSynthesize(ctx: SecondBrainContext, topic: string): Promise<string> {
  const trimmedTopic = topic.trim();
  if (trimmedTopic === "") {
    return "종합할 주제(topic)가 필요합니다.";
  }

  // 1) 기존 Graph RAG 검색 재사용 (Req 7.2)
  const result = await ctx.indexer.search(trimmedTopic);

  // 인덱스가 낡은 경우(임베딩 모델 변경) 결과 메시지에 경고를 덧붙인다.
  const staleNote = staleIndexWarning(result);

  // 2) 검색 결과 없음 → 노트 생성 없이 안내 (Req 7.6)
  if (hasNoHits(result)) {
    return `"${trimmedTopic}"와(과) 관련된 노트를 찾지 못해 종합 노트를 생성하지 않았습니다.${staleNote}`;
  }

  // 3) 검색 히트 → 종합 프롬프트 (Req 7.3)
  const hits = toSearchHits(result);
  const prompt = buildSynthesisPrompt(trimmedTopic, hits);

  // 4) 단발 LLM 호출 (백엔드 무관, Req 7.5)
  const response = await ctx.aiClient.converseLight(
    prompt,
    SECOND_BRAIN_SYSTEM_PROMPT,
    SYNTHESIS_MAX_TOKENS,
  );
  const synthesisBody = response.text;

  // 5) 종합 노트 작성 — synthesis Sentinel_Block으로 감싸 사용자 주석 보존 (Req 7.4)
  const wikiFolder = normalizePath(ctx.wikiFolder);
  const fileName = `${trimmedTopic}.md`;
  const notePath = normalizePath(`${wikiFolder}/${fileName}`);

  // Wiki_Folder 범위 검증 — 주제에 "../" 등 경로 탈출이 포함되면 거부한다.
  // normalizePath는 ".." 를 해석하지 않으므로 세그먼트 단위 검사가 필요하다.
  const guard = ensureWithinFolder(notePath, wikiFolder);
  if (!guard.ok) {
    return guard.reason;
  }

  const existing = ctx.app.vault.getAbstractFileByPath(notePath);
  if (existing instanceof TFile) {
    // 기존 종합 노트: synthesis 블록만 교체하여 프론트매터·프리앰블·User_Region을 보존한다.
    const current = await ctx.app.vault.read(existing);
    const updated = upsertGeneratedBlock(current, SYNTHESIS_BLOCK_KEY, synthesisBody);
    if (updated !== current) {
      await ctx.app.vault.modify(existing, updated);
    }
    return `종합 노트를 갱신했습니다: ${notePath}${staleNote}`;
  }

  // 신규 종합 노트: AI_First_Note 본문에 synthesis 블록을 담아 생성한다.
  const meta: AiFirstMeta = {
    title: trimmedTopic,
    recency: "evergreen",
    confidence: "medium",
    source: "synthesize",
  };
  const body = upsertGeneratedBlock("", SYNTHESIS_BLOCK_KEY, synthesisBody);
  const noteContent = buildAiFirstNote({ meta, body });
  // Wiki_Folder가 없으면 create가 실패한다(LLM 호출 비용만 소진). 다른 쓰기 경로와
  // 동일하게 부모 폴더를 먼저 보장한다.
  await ensureWikiFolders(ctx.app, ctx.wikiFolder);
  await ctx.app.vault.create(notePath, noteContent);
  return `종합 노트를 생성했습니다: ${notePath}${staleNote}`;
}
