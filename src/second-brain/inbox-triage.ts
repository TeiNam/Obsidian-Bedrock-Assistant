// ============================================
// Inbox 검토 — 순수 함수
// ============================================
// 급하게 캡처한 노트는 제목이 "무제 1"이거나 루트에 쌓이고 태그가 없다. 시간이 지나면
// 검색에도 잘 안 걸리고(제목과 태그가 검색 신호의 큰 부분이다) 손대기도 부담스러워진다.
//
// 이 모듈은 새로 들어온 노트에 제목·이동 위치·태그·분할 여부를 제안한다. 기존 P.A.R.A
// 정리와 다른 점은 볼트 전체를 건드리지 않고 새 캡처만 본다는 것이다.
//
// 이름 변경과 이동은 되돌리기 번거로운 동작이므로, LLM이 제안한 경로를 그대로 믿지 않고
// 여기서 폴더 목록과 경로 안전성으로 걸러낸다.

import { parseJsonArray, toStringArray, toTrimmedString } from "./llm-json";
import { escapesVault } from "./vault-path-guard";

/** 노트 1건에 대한 검토 제안. */
export interface TriagePlan {
  /** 대상 노트의 현재 경로. */
  path: string;
  /** 제안 제목. 현재 제목이 이미 적절하면 빈 문자열. */
  suggestedTitle: string;
  /** 제안 이동 폴더. 이동이 불필요하면 빈 문자열. */
  suggestedFolder: string;
  /** 제안 태그(선행 # 제거, 소문자). */
  tags: string[];
  /** 여러 주제가 섞여 있어 나누는 편이 나은 경우의 설명. 없으면 빈 문자열. */
  splitHint: string;
  /** 왜 이렇게 제안했는지. 승인 판단의 근거로 보여준다. */
  reason: string;
}

/**
 * 한 번에 검토할 최대 노트 수.
 *
 * LLM 호출 비용과 승인 화면의 판단 가능성을 함께 제한한다. 50건이 한꺼번에 올라오면
 * 사용자가 전부 체크하거나 전부 무시하게 되고, 어느 쪽도 검토가 아니다.
 */
export const MAX_TRIAGE_NOTES = 12;

/** 파일명으로 쓸 수 없는 문자. 옵시디언과 OS 양쪽에서 문제가 되는 것들이다. */
const UNSAFE_TITLE_CHARS = /[\\/:*?"<>|#^[\]]/g;

/**
 * 윈도우 예약 파일명. 확장자가 붙어도 예약이다(`CON.md`도 만들 수 없다).
 *
 * 이걸 통과시키면 renameFile이 실패하고, 그 항목뿐 아니라 같은 배치의 뒤쪽 항목까지
 * 반영되지 않는다.
 */
const WINDOWS_RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * 파일명 한 구성요소의 최대 길이(바이트 근사).
 *
 * 대부분의 파일시스템이 255바이트를 넘지 못한다. UTF-8 한글은 한 자에 3바이트라
 * 문자 수로 재면 초과할 수 있어 넉넉히 잡는다(`.md` 확장자 몫도 남긴다).
 */
const MAX_TITLE_BYTES = 200;

/**
 * 제안 제목을 파일명으로 쓸 수 있게 정리한다.
 *
 * 경로 구분자와 옵시디언 링크 문법 문자를 제거한다. LLM이 `폴더/제목` 형태로 제목을
 * 돌려주는 일이 흔한데, 그대로 쓰면 의도치 않은 하위 폴더가 생긴다.
 */
export function sanitizeTitle(title: string): string {
  const cleaned = title
    .replace(UNSAFE_TITLE_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    // LLM이 `Report.md`처럼 확장자를 붙여 돌려주는 일이 있다. 그대로 쓰면
    // `Report.md.md` 파일이 생기고, 승인 화면에 보인 제목과도 달라진다.
    .replace(/\.md$/i, "")
    .trim()
    // 후행 마침표·공백은 윈도우에서 파일명으로 쓸 수 없다.
    .replace(/[.\s]+$/, "");

  if (cleaned === "") return "";
  // 윈도우 예약 이름은 승인해도 renameFile이 실패한다. 접미사를 붙여 피한다.
  if (WINDOWS_RESERVED.has(cleaned.toLowerCase())) return `${cleaned} 노트`;
  return truncateToBytes(cleaned, MAX_TITLE_BYTES);
}

/** UTF-8 바이트 길이를 넘지 않게 자른다. 문자 중간에서 끊지 않는다. */
function truncateToBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;

  let out = "";
  let bytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (bytes + size > maxBytes) break;
    out += char;
    bytes += size;
  }
  return out.trimEnd();
}

/** 태그 정규화 — 선행 #과 공백 제거, 소문자, 내부 공백은 하이픈. */
export function sanitizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}/_-]/gu, "");
}

/**
 * 임의 객체를 TriagePlan으로 정규화한다.
 *
 * @param allowedFolders 볼트에 실재하는 폴더 목록. 여기 없는 폴더 제안은 버린다 —
 *   LLM이 그럴듯한 폴더 이름을 지어내면 새 폴더가 조용히 생기고 볼트 구조가 어긋난다.
 * @param knownPaths 볼트에 실재하는 노트 경로 집합. 여기 없는 대상은 버린다.
 */
export function normalizeTriagePlan(
  raw: unknown,
  allowedFolders: ReadonlySet<string>,
  knownPaths: ReadonlySet<string>
): TriagePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const path = toTrimmedString(obj.path);
  // 대상이 실재하지 않으면 적용할 수 없다. 경로를 지어낸 응답을 걸러낸다.
  if (path === "" || !knownPaths.has(path)) return null;

  const suggestedTitle = sanitizeTitle(toTrimmedString(obj.suggestedTitle));

  const rawFolder = toTrimmedString(obj.suggestedFolder).replace(/^\/+|\/+$/g, "");
  // 볼트를 벗어나는 경로와 실재하지 않는 폴더는 버린다.
  const suggestedFolder =
    rawFolder !== "" && !escapesVault(rawFolder) && allowedFolders.has(rawFolder)
      ? rawFolder
      : "";

  const tags = [
    ...new Set(
      toStringArray(obj.tags)
        .map(sanitizeTag)
        .filter((t) => t !== "")
    ),
  ];

  const plan: TriagePlan = {
    path,
    suggestedTitle,
    suggestedFolder,
    tags,
    splitHint: toTrimmedString(obj.splitHint),
    reason: toTrimmedString(obj.reason),
  };

  // 제안이 하나도 없으면 보여줄 이유가 없다.
  if (!hasActionableSuggestion(plan)) return null;
  return plan;
}

/** 실제로 무언가를 바꾸는 제안이 있는지. */
export function hasActionableSuggestion(plan: TriagePlan): boolean {
  return (
    plan.suggestedTitle !== "" ||
    plan.suggestedFolder !== "" ||
    plan.tags.length > 0 ||
    plan.splitHint !== ""
  );
}

/** LLM 응답에서 검토 제안 목록을 파싱한다. */
export function parseTriageReport(
  llmText: unknown,
  allowedFolders: ReadonlySet<string>,
  knownPaths: ReadonlySet<string>
) {
  return parseJsonArray(llmText, (raw) =>
    normalizeTriagePlan(raw, allowedFolders, knownPaths)
  );
}

/** 경로에서 확장자를 뗀 파일명. */
function basenameNoExt(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "");
}

/** 경로의 폴더 부분. 루트면 빈 문자열. */
function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/**
 * 제안을 적용했을 때의 대상 경로를 계산한다.
 *
 * 제목과 폴더 중 제안된 것만 반영한다. 결과가 현재 경로와 같으면 null — 이동·이름
 * 변경이 필요 없다는 뜻이고, 같은 경로로 rename을 호출하면 옵시디언이 오류를 낸다.
 *
 * @param taken 이미 존재하는 경로 집합. 충돌하면 null을 돌려 건너뛰게 한다 —
 *   덮어쓰기는 절대 하지 않는다.
 */
export function resolveTargetPath(
  plan: TriagePlan,
  taken: ReadonlySet<string>
): string | null {
  // 제안 제목이 정리 후 비면(예: LLM이 ".md"만 돌려준 경우) 제안이 없는 것으로 보고
  // 현재 이름을 유지한다. 폴더 제안은 그대로 살려 이동은 가능하게 둔다.
  //
  // 기존 파일명은 **정리하지 않는다.** `foo#bar.md`나 `foo.md.md`처럼 sanitizeTitle이
  // 손대는 이름도 이미 볼트에 있는 유효한 파일명이다. 폴더만 옮기는 승인에서 이름까지
  // 바꾸면 사용자가 승인하지 않은 변경이 되고, 승인 화면에는 이동만 표시된다.
  const suggested = sanitizeTitle(plan.suggestedTitle);
  const title = suggested !== "" ? suggested : basenameNoExt(plan.path);
  if (title === "") return null;
  const folder = plan.suggestedFolder !== "" ? plan.suggestedFolder : dirOf(plan.path);

  const target = folder === "" ? `${title}.md` : `${folder}/${title}.md`;
  if (target === plan.path) return null;
  // 대상이 이미 있으면 건너뛴다. 이름이 겹치는 다른 노트를 덮어쓰는 것이 최악이다.
  //
  // 비교는 **대소문자를 무시한다.** macOS·Windows 기본 파일시스템에서 `Projects/Foo.md`와
  // `Projects/foo.md`는 같은 파일이므로, 구분해서 통과시키면 renameFile이 오류를 내고
  // 이미 일부 반영된 승인 배치가 중간에 끊긴다.
  if (isTaken(target, taken, plan.path)) return null;
  if (escapesVault(target)) return null;

  return target;
}

/**
 * 대소문자를 무시한 경로 충돌 판정. **자기 자신은 충돌이 아니다.**
 *
 * `taken`에는 이 노트의 현재 경로도 들어 있다. 제외하지 않으면 `Inbox/foo.md`를
 * `Inbox/Foo.md`로 바꾸는 제안이 자기 자신과 충돌해 승인해도 건너뛰게 된다.
 *
 * @param self 이 노트의 현재 경로
 */
function isTaken(target: string, taken: ReadonlySet<string>, self: string): boolean {
  const lower = target.toLowerCase();
  for (const existing of taken) {
    if (existing === self) continue;
    if (existing.toLowerCase() === lower) return true;
  }
  return false;
}

/**
 * 검토 프롬프트를 만든다.
 *
 * 기존 폴더 목록과 자주 쓰는 태그를 함께 준다. 주지 않으면 LLM이 매번 새 폴더 이름과
 * 새 태그 체계를 지어내고, 볼트가 비슷한 뜻의 폴더·태그로 갈라진다.
 */
export function buildTriagePrompt(
  notes: ReadonlyArray<{ path: string; excerpt: string }>,
  folders: readonly string[],
  commonTags: readonly string[]
): string {
  const context = notes.map((n) => `## ${n.path}\n${n.excerpt}`).join("\n\n");

  return [
    "다음은 정리되지 않은 새 노트들입니다. 각 노트에 대해 정리 제안을 하세요.",
    "",
    "규칙:",
    "- `path`는 아래 문맥에 나온 경로를 그대로 적으세요. 경로를 지어내면 안 됩니다.",
    "- `suggestedFolder`는 **아래 폴더 목록에 있는 것만** 쓰세요. 새 폴더를 만들지 마세요.",
    "- `tags`는 아래 자주 쓰는 태그를 우선 재사용하세요. 새 태그는 정말 필요할 때만 만드세요.",
    "- 현재 제목이 이미 내용을 잘 나타내면 `suggestedTitle`을 빈 문자열로 두세요.",
    "- 이동이 필요 없으면 `suggestedFolder`를 빈 문자열로 두세요.",
    "- 한 노트에 별개 주제가 섞여 있을 때만 `splitHint`에 어떻게 나눌지 적으세요.",
    "- `reason`은 한 문장으로 짧게 쓰세요.",
    "",
    `사용 가능한 폴더: ${folders.length > 0 ? folders.join(", ") : "(없음 — 이동 제안 금지)"}`,
    `자주 쓰는 태그: ${commonTags.length > 0 ? commonTags.join(", ") : "(없음)"}`,
    "",
    "JSON 배열만 출력하세요. 제안할 것이 없으면 `[]`를 출력하세요.",
    "각 원소:",
    '{"path":"","suggestedTitle":"","suggestedFolder":"","tags":[""],"splitHint":"","reason":""}',
    "",
    "---",
    context,
  ].join("\n");
}
