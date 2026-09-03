// ============================================
// 결정 원장 — 순수 함수
// ============================================
// "왜 X를 선택했나?"와 "아직 열린 약속은?"은 볼트에 답이 있는데도 답하기 어려운
// 질문이다. 결정은 회의록·일지·대화에 흩어져 있고, 나중에 뒤집힌 결정과 유효한 결정이
// 같은 무게로 검색되기 때문이다.
//
// 이 모듈은 흩어진 결정을 한 노트(원장)에 모으고, 뒤집힌 결정은 대체 관계로 표시한다.
// LLM은 추출만 하고, 상태 판정과 병합은 여기서 규칙으로 처리한다 — 상태를 LLM이
// 매번 추측하면 같은 결정이 실행마다 다른 상태로 기록된다.

import { parseJsonArray, toStringArray, toTrimmedString } from "./llm-json";

/** 결정의 현재 상태. */
export type DecisionStatus = "open" | "done" | "superseded";

/** 원장 항목 1건. */
export interface DecisionEntry {
  /** 무엇을 결정했는지. 이 값이 항목의 신원이다. */
  decision: string;
  /** 왜 그렇게 결정했는지. 비어 있으면 원장의 가치가 절반으로 줄어든다. */
  rationale: string;
  /** 근거가 된 노트 경로들. 검증 가능한 출처가 없는 항목은 받지 않는다. */
  sources: string[];
  /** 결정 시점 "YYYY-MM-DD". 알 수 없으면 빈 문자열. */
  decidedOn: string;
  /** 담당자. 알 수 없으면 빈 문자열 — 추측해서 채우지 않는다. */
  owner: string;
  /** 기한 "YYYY-MM-DD". 없으면 빈 문자열. */
  due: string;
  status: DecisionStatus;
  /** 이 결정을 대체한 결정의 문구. status가 superseded일 때만 의미가 있다. */
  supersededBy: string;
}

/** LLM이 돌려준 상태 문자열을 union으로 좁힌다. 모르는 값은 open으로 둔다. */
function normalizeStatus(value: unknown): DecisionStatus {
  const v = toTrimmedString(value).toLowerCase();
  if (v === "done" || v === "완료") return "done";
  if (v === "superseded" || v === "대체됨") return "superseded";
  // 모르는 값을 done으로 접으면 열린 약속이 조용히 사라진다. open이 안전한 기본값이다.
  return "open";
}

/** "YYYY-MM-DD" 형식만 통과시킨다. 형식이 다르면 빈 문자열 — 추측하지 않는다. */
function normalizeDate(value: unknown): string {
  const v = toTrimmedString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

/**
 * 임의 객체를 DecisionEntry로 정규화한다. 유효하지 않으면 null.
 *
 * decision과 sources가 모두 있어야 유효하다. 출처 없는 결정은 검증할 수 없고,
 * 검증할 수 없는 항목이 원장에 쌓이면 원장 전체를 믿을 수 없게 된다.
 */
export function normalizeDecision(raw: unknown): DecisionEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const decision = toTrimmedString(obj.decision);
  const sources = toStringArray(obj.sources)
    .map((s) => s.trim())
    .filter((s) => s !== "");

  if (decision === "" || sources.length === 0) return null;

  return {
    decision,
    rationale: toTrimmedString(obj.rationale),
    sources,
    decidedOn: normalizeDate(obj.decidedOn),
    owner: toTrimmedString(obj.owner),
    due: normalizeDate(obj.due),
    status: normalizeStatus(obj.status),
    supersededBy: toTrimmedString(obj.supersededBy),
  };
}

/** LLM 응답에서 결정 목록을 파싱한다. ok=false는 해석 실패이고 "결정 없음"과 다르다. */
export function parseDecisionReport(llmText: unknown) {
  return parseJsonArray(llmText, normalizeDecision);
}

/** 결정 문구 비교용 정규화 — 같은 결정을 다르게 적은 경우를 합치기 위함이다. */
export function decisionKey(decision: string): string {
  return decision
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 기존 원장과 새로 추출한 결정을 병합한다.
 *
 * 규칙:
 *  - 같은 결정(정규화 문구 기준)은 한 항목으로 합치고, 새 정보로 빈 칸만 채운다.
 *    이미 채워진 값을 새 추출로 덮어쓰지 않는다 — 사용자가 손으로 고친 값을 LLM 추출이
 *    되돌리면 원장을 신뢰할 수 없다.
 *  - 상태는 진행 방향으로만 바뀐다: open → done/superseded. 되돌리지 않는다.
 *    LLM이 오래된 노트를 다시 읽어 "아직 열려 있다"고 판단하는 일이 흔하다.
 *  - supersededBy가 가리키는 결정이 원장에 있으면 그 항목을 superseded로 표시한다.
 *  - 출처는 합집합으로 누적한다.
 *
 * 원본 배열을 변형하지 않는다.
 */
export function mergeLedger(
  existing: readonly DecisionEntry[],
  incoming: readonly DecisionEntry[]
): DecisionEntry[] {
  const byKey = new Map<string, DecisionEntry>();
  const order: string[] = [];

  const put = (entry: DecisionEntry): void => {
    const key = decisionKey(entry.decision);
    if (key === "") return;

    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...entry, sources: [...entry.sources] });
      order.push(key);
      return;
    }

    byKey.set(key, {
      // 문구는 기존 것을 유지한다 — 사용자가 다듬었을 수 있다.
      decision: current.decision,
      rationale: current.rationale !== "" ? current.rationale : entry.rationale,
      sources: [...new Set([...current.sources, ...entry.sources])],
      decidedOn: current.decidedOn !== "" ? current.decidedOn : entry.decidedOn,
      owner: current.owner !== "" ? current.owner : entry.owner,
      due: current.due !== "" ? current.due : entry.due,
      status: advanceStatus(current.status, entry.status),
      supersededBy: current.supersededBy !== "" ? current.supersededBy : entry.supersededBy,
    });
  };

  for (const entry of existing) put(entry);
  for (const entry of incoming) put(entry);

  // supersededBy가 가리키는 결정을 superseded로 표시한다.
  for (const key of order) {
    const entry = byKey.get(key)!;
    if (entry.supersededBy === "") continue;
    const targetKey = decisionKey(entry.supersededBy);
    // "A가 B로 대체됨"이라고 적힌 항목은 A 자신이 superseded다.
    if (targetKey !== "" && targetKey !== key) {
      byKey.set(key, { ...entry, status: "superseded" });
    }
  }

  return order.map((key) => byKey.get(key)!);
}

/** 상태는 진행 방향으로만 바뀐다. */
function advanceStatus(current: DecisionStatus, next: DecisionStatus): DecisionStatus {
  if (current === "superseded" || next === "superseded") return "superseded";
  if (current === "done" || next === "done") return "done";
  return "open";
}

/** 원장에 기록할 Sentinel_Block 키. */
export const DECISION_BLOCK_KEY = "decisions";

/** 원장 노트 파일명. */
export const DECISION_LEDGER_FILE = "Decisions.md";

const STATUS_LABEL: Record<DecisionStatus, string> = {
  open: "열림",
  done: "완료",
  superseded: "대체됨",
};

/**
 * 원장을 마크다운 표로 렌더한다.
 *
 * 상태 순(열림 → 완료 → 대체됨)으로 묶는다. 열린 약속을 먼저 보여주는 것이 원장을
 * 여는 주된 이유이고, 뒤집힌 결정이 위에 있으면 유효한 결정을 가린다.
 */
export function formatLedger(entries: readonly DecisionEntry[]): string {
  if (entries.length === 0) return "기록된 결정이 없습니다.";

  const order: DecisionStatus[] = ["open", "done", "superseded"];
  const lines: string[] = [];

  for (const status of order) {
    const group = entries.filter((e) => e.status === status);
    if (group.length === 0) continue;

    lines.push(`### ${STATUS_LABEL[status]} (${group.length})`, "");
    lines.push("| 결정 | 이유 | 담당 | 기한 | 근거 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const e of group) {
      const sources = e.sources.map((s) => `[[${s.replace(/\.md$/i, "")}]]`).join(" ");
      const note = e.status === "superseded" && e.supersededBy !== "" ? ` → ${e.supersededBy}` : "";
      lines.push(
        `| ${cell(e.decision + note)} | ${cell(e.rationale)} | ${cell(e.owner)} | ` +
          `${cell(e.due)} | ${cell(sources)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * 표 칸에 넣을 문자열을 안전하게 만든다.
 * 파이프와 줄바꿈이 그대로 들어가면 표 구조가 깨져 원장 전체가 읽히지 않는다.
 */
function cell(value: string): string {
  const v = value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  return v === "" ? "—" : v;
}

/**
 * 결정 추출 프롬프트를 만든다.
 *
 * 상태·담당·기한을 "모르면 비워라"라고 명시한다. 추측해서 채우면 원장이 근거 없는
 * 값으로 오염되고, 그걸 사용자가 확인할 방법이 없다.
 */
export function buildDecisionPrompt(
  topic: string,
  notes: ReadonlyArray<{ path: string; excerpt: string }>
): string {
  const context = notes.map((n) => `## ${n.path}\n${n.excerpt}`).join("\n\n");

  return [
    `다음 노트들에서 "${topic}"에 관해 실제로 내려진 결정을 추출하세요.`,
    "",
    "규칙:",
    "- 결정으로 볼 수 있는 것만 뽑으세요. 아이디어·후보·논의 중인 사항은 결정이 아닙니다.",
    "- `sources`에는 근거가 된 노트 경로를 아래 문맥에 나온 그대로 적으세요. 경로를 지어내면 안 됩니다.",
    "- `rationale`은 노트에 적힌 이유만 쓰세요. 추론한 이유를 적지 마세요.",
    "- `owner`, `due`, `decidedOn`은 노트에 명시된 경우에만 채우고, 그 외에는 빈 문자열로 두세요.",
    "- `status`는 open/done/superseded 중 하나입니다. 판단할 근거가 없으면 open으로 두세요.",
    "- 어떤 결정이 다른 결정을 뒤집었다면 뒤집힌 쪽의 `supersededBy`에 새 결정 문구를 적으세요.",
    "",
    "JSON 배열만 출력하세요. 결정이 없으면 `[]`를 출력하세요.",
    "각 원소:",
    '{"decision":"","rationale":"","sources":[""],"decidedOn":"","owner":"","due":"","status":"open","supersededBy":""}',
    "",
    "---",
    context,
  ].join("\n");
}

/** STATUS_LABEL의 역방향 조회. 섹션 헤딩에서 상태를 되읽는 데 쓴다. */
const LABEL_TO_STATUS: Record<string, DecisionStatus> = {
  열림: "open",
  완료: "done",
  대체됨: "superseded",
};

/** 표 칸 값을 되읽는다. cell()의 역변환 — 이스케이프 해제 + 빈 칸 표시 복원. */
function uncell(value: string): string {
  const v = value.trim();
  if (v === "—") return "";
  return v.replace(/\\\|/g, "|").trim();
}

/**
 * formatLedger가 만든 마크다운을 DecisionEntry 목록으로 되읽는다.
 *
 * 원장을 노트에 표로 저장하는 이유는 사용자가 직접 고칠 수 있어야 하기 때문이다.
 * 고친 값을 다음 추출이 되돌리지 않으려면 그 값을 읽어올 수 있어야 하므로, 별도
 * 데이터 파일을 두지 않고 표를 그대로 되읽는다.
 *
 * 왕복이 완전하지 않은 지점(문서화된 손실):
 *  - `rationale`의 줄바꿈은 formatLedger에서 공백으로 접히므로 복원되지 않는다.
 *  - `decidedOn`은 표에 실리지 않아 되읽을 수 없다. 병합에서 빈 칸으로 취급되며,
 *    새 추출이 값을 갖고 있으면 그때 채워진다.
 */
export function parseLedger(markdown: string): DecisionEntry[] {
  const out: DecisionEntry[] = [];
  let status: DecisionStatus | null = null;

  for (const line of markdown.split("\n")) {
    const heading = /^###\s+(\S+)/.exec(line.trim());
    if (heading) {
      status = LABEL_TO_STATUS[heading[1]] ?? null;
      continue;
    }

    const trimmed = line.trim();
    if (status === null || !trimmed.startsWith("|")) continue;
    // 헤더 행과 구분선은 건너뛴다.
    if (trimmed.startsWith("| ---") || trimmed.startsWith("| 결정 |")) continue;

    // 이스케이프된 파이프(\|)를 칸 구분자로 오인하지 않도록 분리한다.
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map(uncell);
    if (cells.length < 5) continue;

    // "결정 → 대체결정" 형태에서 대체 대상을 되읽는다.
    const [rawDecision, rationale, owner, due, sourceCell] = cells;
    const arrowAt = rawDecision.lastIndexOf(" → ");
    const decision = arrowAt >= 0 ? rawDecision.slice(0, arrowAt).trim() : rawDecision;
    const supersededBy = arrowAt >= 0 ? rawDecision.slice(arrowAt + 3).trim() : "";
    if (decision === "") continue;

    // 위키링크에서 경로를 되읽는다. .md는 formatLedger가 떼므로 다시 붙인다.
    const sources = [...sourceCell.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) =>
      m[1].endsWith(".md") ? m[1] : `${m[1]}.md`
    );
    if (sources.length === 0) continue;

    out.push({
      decision,
      rationale,
      sources,
      decidedOn: "",
      owner,
      due,
      status,
      supersededBy,
    });
  }

  return out;
}
