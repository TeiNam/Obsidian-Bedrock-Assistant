// 도구 실행 결과 다국어 레이블
//
// 도구가 돌려주는 문자열은 **화면에 그대로 표시된다** — chat-view가
// `resultEl.setText(result.slice(0, 500))`으로 도구 상태 행에 찍는다. 동시에 같은
// 문자열이 tool_result로 LLM에 전달된다. 두 소비자 모두 사용자 언어를 쓰는 것이 맞다:
// 화면에는 읽을 수 있는 문구가 필요하고, 모델도 뒤이어 같은 언어로 설명해야 한다.
//
// **번역하지 않는 것 두 가지가 있다.**
//
// 1. `TOOLS`의 `description` — 시스템 프롬프트에만 들어가고 화면에 뜨지 않는다.
//    사용자가 볼 일이 없으므로 번역할 이유가 없다.
// 2. 볼트에 기록하고 되읽는 문자열 — `decisions.ts`의 `LEDGER_HEADER_CELLS`
//    (`["결정","이유",…]`)와 `wiki-structure.ts`의 `UNCATEGORIZED`("기타")가 그렇다.
//    이건 UI 텍스트가 아니라 **파일 형식**이다. 번역하면 언어를 바꾼 사용자의 기존
//    `Decisions.md`를 파싱할 수 없게 되고, 위키 카테고리 폴더가 갈라진다.

import type { Locale } from "./types";

export const TOOL_I18N = {
  en: {
    // ---- 도구 실패 접두어 ----
    // `isToolError`가 이 접두어로 실패를 판별한다. ERROR_PREFIXES가 세 언어를 모두
    // 담으므로, 언어를 바꿔도 이전 언어로 저장된 히스토리의 실패 표시가 유지된다.
    toolErrorPrefix: "Tool execution error:",

    // ---- 공통: 경로·존재 여부 ----
    notFound: (path: string) => `File not found: ${path}`,
    notFoundAny: (path: string) => `File or folder not found: ${path}`,
    folderNotFound: (folder: string) => `Folder not found: ${folder}`,
    alreadyExists: (path: string) => `File already exists: ${path}`,
    destExists: (path: string) => `A file already exists at the destination: ${path}`,
    escapesVault: (tool: string, value: string) =>
      `${tool}: paths outside the vault are not allowed: ${value}`,
    unknownTool: (tool: string) => `Unknown tool: ${tool}`,

    // ---- 검색 ----
    searchFilterInvalid: (problems: string) => `The search filter is not valid:\n- ${problems}`,
    searchFailed: (reason: string) => `Search failed: ${reason}`,
    searchQueryEmpty: "The search query is empty. Enter something to search for.",
    searchLimitRange: (limit: number) =>
      `\`limit\` must be between 1 and 100 (received: ${limit}).`,
    searchNoResults: (staleWarning: string) =>
      `No search results. Your vault may need indexing.${staleWarning}`,

    // ---- 노트 읽기·쓰기 ----
    noteCreated: (path: string) => `Note created: ${path}`,
    notePatched: (path: string) => `Note partially updated: ${path}`,
    noteEdited: (path: string) => `Note updated: ${path}`,
    noteAppended: (path: string) => `Content appended: ${path}`,
    noteOpened: (path: string) => `Note opened: ${path}`,
    findEmpty: "The text to replace (find) is empty. Specify the string to look for.",
    findNotFound: (snippet: string) => `Could not find the text to replace: "${snippet}..."`,
    editParamsRequired: "Either `content` or `find`/`replace` is required.",
    emptyFolder: "The folder is empty.",
    noActiveNote: "No note is currently open.",
    pathHeader: (path: string, content: string) => `Path: ${path}\n\n${content}`,

    // ---- 템플릿 ----
    templateFolderMissing: (folder: string) =>
      `No template folder at: ${folder}\nIt is created automatically when you save a template.`,
    noTemplates: "No templates saved yet.",
    templateUpdated: (path: string) => `Template updated: ${path}`,
    templateSaved: (path: string) => `Template saved: ${path}`,
    templateAppliedWithRemaining: (path: string, remaining: string) =>
      `Note created: ${path}\n⚠️ Unsubstituted variables remain: ${remaining}`,

    // ---- 이동·삭제 ----
    moved: (kind: string, from: string, to: string) => `${kind} moved: ${from} → ${to}`,
    deleted: (kind: string, path: string) => `${kind} deleted: ${path}`,
    kindFolder: "Folder",
    kindFile: "File",

    // ---- Second Brain 공통 ----
    sbDisabled: "Second Brain is turned off. Enable it in settings and try again.",
    noAiClient: (what: string) => `No AI client is available, so ${what} cannot run.`,
    whatSynthesize: "synthesis",
    whatReconcile: "the contradiction check",
    whatArchitect: "architecture analysis",
    whatChallenge: "the critical review",
    whatConnect: "topic connection",
    whatEmerge: "pattern discovery",

    // ---- Second Brain 입력 요구 ----
    titleRequired: "A note title is required.",
    topicRequired: "A topic is required.",
    claimRequired: "A claim to review is required.",
    topicsRequired: "Both topics (topicA, topicB) are required.",

    // ---- Second Brain 결과 ----
    wikiNoteExists: (path: string) => `A note already exists and was not overwritten: ${path}`,
    wikiNoteCreated: (path: string) => `Wiki note created: ${path}`,
    catalogUpdated: (count: number) => `Index catalog updated: ${count} note(s)`,
    synthesizeNoHits: (topic: string, staleNote: string) =>
      `No notes found for "${topic}", so no synthesis note was created.${staleNote}`,
    synthesizeUpdated: (path: string, staleNote: string) =>
      `Synthesis note updated: ${path}${staleNote}`,
    synthesizeCreated: (path: string, staleNote: string) =>
      `Synthesis note created: ${path}${staleNote}`,
    reconcileNone: "No contradictions found. No notes were changed.",
    reconcileNoTargets:
      "No target notes to apply to (the approved contradictions carry no note paths).",
    architectNoFiles: (scanLabel: string) =>
      `No files to analyze under the scan path (${scanLabel}).`,
    architectUpdated: (path: string) => `Architecture note updated: ${path}`,
    architectCreated: (path: string) => `Architecture note created: ${path}`,
    challengeNoHits: (claim: string) =>
      `No notes found that could serve as evidence for or against "${claim}".`,
    connectNoHits: (topicA: string, topicB: string) =>
      `No related notes found for either "${topicA}" or "${topicB}", so there is nothing to connect.`,
    emergeNoRecent: (days: number) => `No notes modified in the last ${days} day(s).`,
    emergeCapped: (text: string, total: number, analyzed: number) =>
      `${text}\n\n---\n(Analyzed only the ${analyzed} most recent of ${total} notes. Narrow the period for a more precise result.)`,
    gapsNone: "No structural gaps found.",
    wikiEmpty: (heading: string) => `${heading}\n\n_No wiki notes yet._\n`,
    ledgerEmpty: "No decisions recorded.",
    ledgerHeading: "# Decision ledger\n",

    // ---- MCP 도구 경로 ----
    mcpToolFailed: (tool: string, detail: string) => `MCP ${tool}: ${detail}`,
    mcpToolFailedNoDetail: "execution failed",
    mcpBadToolName: (name: string) => `Invalid MCP tool name: ${name}`,
    mcpNotConnectedTo: (server: string) => `Not connected to MCP server: ${server}`,
    mcpNotConnected: "Not connected to the MCP server",
    mcpServerExited: (code: number | null) => `MCP server exited (code: ${code})`,
    mcpRequestTimeout: (method: string) => `MCP request timed out: ${method}`,
    mcpError: (message: string) => `MCP error: ${message}`,
    mcpConnectionClosed: "MCP server connection closed",
  },

  ko: {
    toolErrorPrefix: "도구 실행 오류:",

    notFound: (path: string) => `파일을 찾을 수 없습니다: ${path}`,
    notFoundAny: (path: string) => `파일/폴더를 찾을 수 없습니다: ${path}`,
    folderNotFound: (folder: string) => `폴더를 찾을 수 없습니다: ${folder}`,
    alreadyExists: (path: string) => `파일이 이미 존재합니다: ${path}`,
    destExists: (path: string) => `대상 경로에 이미 파일이 존재합니다: ${path}`,
    escapesVault: (tool: string, value: string) =>
      `${tool}: 볼트를 벗어나는 경로는 허용되지 않습니다: ${value}`,
    unknownTool: (tool: string) => `알 수 없는 도구: ${tool}`,

    searchFilterInvalid: (problems: string) => `검색 필터가 올바르지 않습니다:\n- ${problems}`,
    searchFailed: (reason: string) => `검색 실패: ${reason}`,
    searchQueryEmpty: "검색 쿼리가 비어 있습니다. 검색어를 입력해 주세요.",
    searchLimitRange: (limit: number) =>
      `limit은 1 이상 100 이하여야 합니다 (입력값: ${limit}).`,
    searchNoResults: (staleWarning: string) =>
      `검색 결과가 없습니다. 볼트 인덱싱이 필요할 수 있습니다.${staleWarning}`,

    noteCreated: (path: string) => `노트가 생성되었습니다: ${path}`,
    notePatched: (path: string) => `노트가 부분 수정되었습니다: ${path}`,
    noteEdited: (path: string) => `노트가 수정되었습니다: ${path}`,
    noteAppended: (path: string) => `내용이 추가되었습니다: ${path}`,
    noteOpened: (path: string) => `노트를 열었습니다: ${path}`,
    findEmpty: "교체할 텍스트(find)가 비어 있습니다. 찾을 문자열을 지정해 주세요.",
    findNotFound: (snippet: string) => `교체 대상 텍스트를 찾을 수 없습니다: "${snippet}..."`,
    editParamsRequired: "content 또는 find/replace 파라미터가 필요합니다.",
    emptyFolder: "빈 폴더입니다.",
    noActiveNote: "현재 열려있는 노트가 없습니다.",
    pathHeader: (path: string, content: string) => `경로: ${path}\n\n${content}`,

    templateFolderMissing: (folder: string) =>
      `템플릿 폴더가 없습니다: ${folder}\n템플릿을 저장하면 자동으로 생성됩니다.`,
    noTemplates: "저장된 템플릿이 없습니다.",
    templateUpdated: (path: string) => `템플릿이 수정되었습니다: ${path}`,
    templateSaved: (path: string) => `템플릿이 저장되었습니다: ${path}`,
    templateAppliedWithRemaining: (path: string, remaining: string) =>
      `노트가 생성되었습니다: ${path}\n⚠️ 미치환 변수가 남아있습니다: ${remaining}`,

    moved: (kind: string, from: string, to: string) => `${kind}을(를) 이동했습니다: ${from} → ${to}`,
    deleted: (kind: string, path: string) => `${kind}을(를) 삭제했습니다: ${path}`,
    kindFolder: "폴더",
    kindFile: "파일",

    sbDisabled: "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.",
    // 목적격 조사를 값에 포함한다. `${what}을`로 조립하면 받침 없는 말에서 틀린다
    // ("비판적 검토을"). 언어별로 문장을 각자 만드는 구조라 이렇게 두는 것이 맞다.
    noAiClient: (what: string) => `AI 클라이언트를 사용할 수 없어 ${what} 수행할 수 없습니다.`,
    whatSynthesize: "종합을",
    whatReconcile: "모순 점검을",
    whatArchitect: "아키텍처 분석을",
    whatChallenge: "비판적 검토를",
    whatConnect: "주제 연결을",
    whatEmerge: "패턴 발견을",

    titleRequired: "노트 제목(title)이 필요합니다.",
    topicRequired: "주제(topic)가 필요합니다.",
    claimRequired: "검토할 주장(claim)이 필요합니다.",
    topicsRequired: "연결할 두 주제(topicA, topicB)가 모두 필요합니다.",

    wikiNoteExists: (path: string) => `노트가 이미 존재하여 덮어쓰지 않았습니다: ${path}`,
    wikiNoteCreated: (path: string) => `위키 노트가 생성되었습니다: ${path}`,
    catalogUpdated: (count: number) => `인덱스 카탈로그를 갱신했습니다: ${count}개 노트`,
    synthesizeNoHits: (topic: string, staleNote: string) =>
      `"${topic}"와(과) 관련된 노트를 찾지 못해 종합 노트를 생성하지 않았습니다.${staleNote}`,
    synthesizeUpdated: (path: string, staleNote: string) =>
      `종합 노트를 갱신했습니다: ${path}${staleNote}`,
    synthesizeCreated: (path: string, staleNote: string) =>
      `종합 노트를 생성했습니다: ${path}${staleNote}`,
    reconcileNone: "발견된 모순이 없습니다. 어떤 노트도 변경하지 않았습니다.",
    reconcileNoTargets: "반영할 대상 노트가 없습니다(승인된 모순 항목에 노트 경로가 없습니다).",
    architectNoFiles: (scanLabel: string) =>
      `스캔 대상 경로(${scanLabel})에서 분석할 파일을 찾지 못했습니다.`,
    architectUpdated: (path: string) => `아키텍처 노트를 갱신했습니다: ${path}`,
    architectCreated: (path: string) => `아키텍처 노트를 생성했습니다: ${path}`,
    challengeNoHits: (claim: string) =>
      `"${claim}"을(를) 반박할 근거가 될 관련 노트를 찾지 못했습니다.`,
    connectNoHits: (topicA: string, topicB: string) =>
      `"${topicA}"와(과) "${topicB}" 모두에서 관련 노트를 찾지 못해 연결할 근거가 없습니다.`,
    emergeNoRecent: (days: number) => `최근 ${days}일 이내에 수정된 노트가 없습니다.`,
    emergeCapped: (text: string, total: number, analyzed: number) =>
      `${text}\n\n---\n(최근 노트 ${total}건 중 최신 ${analyzed}건만 분석했습니다. 기간을 좁히면 더 정확한 결과를 얻을 수 있습니다.)`,
    gapsNone: "발견된 구조적 공백이 없습니다.",
    wikiEmpty: (heading: string) => `${heading}\n\n_아직 위키 노트가 없습니다._\n`,
    ledgerEmpty: "기록된 결정이 없습니다.",
    ledgerHeading: "# 결정 원장\n",

    mcpToolFailed: (tool: string, detail: string) => `MCP ${tool}: ${detail}`,
    mcpToolFailedNoDetail: "실행 실패",
    mcpBadToolName: (name: string) => `잘못된 MCP 도구 이름: ${name}`,
    mcpNotConnectedTo: (server: string) => `MCP 서버에 연결되지 않음: ${server}`,
    mcpNotConnected: "MCP 서버에 연결되지 않음",
    mcpServerExited: (code: number | null) => `MCP 서버 종료 (code: ${code})`,
    mcpRequestTimeout: (method: string) => `MCP 요청 타임아웃: ${method}`,
    mcpError: (message: string) => `MCP 오류: ${message}`,
    mcpConnectionClosed: "MCP 서버 연결 종료",
  },

  ja: {
    toolErrorPrefix: "ツール実行エラー:",

    notFound: (path: string) => `ファイルが見つかりません: ${path}`,
    notFoundAny: (path: string) => `ファイル/フォルダが見つかりません: ${path}`,
    folderNotFound: (folder: string) => `フォルダが見つかりません: ${folder}`,
    alreadyExists: (path: string) => `ファイルが既に存在します: ${path}`,
    destExists: (path: string) => `移動先に既にファイルが存在します: ${path}`,
    escapesVault: (tool: string, value: string) =>
      `${tool}: ボルト外のパスは許可されていません: ${value}`,
    unknownTool: (tool: string) => `不明なツール: ${tool}`,

    searchFilterInvalid: (problems: string) => `検索フィルタが正しくありません:\n- ${problems}`,
    searchFailed: (reason: string) => `検索に失敗しました: ${reason}`,
    searchQueryEmpty: "検索クエリが空です。検索語を入力してください。",
    searchLimitRange: (limit: number) =>
      `limit は1以上100以下である必要があります (入力値: ${limit})。`,
    searchNoResults: (staleWarning: string) =>
      `検索結果がありません。ボルトのインデックスが必要かもしれません。${staleWarning}`,

    noteCreated: (path: string) => `ノートを作成しました: ${path}`,
    notePatched: (path: string) => `ノートを部分更新しました: ${path}`,
    noteEdited: (path: string) => `ノートを更新しました: ${path}`,
    noteAppended: (path: string) => `内容を追記しました: ${path}`,
    noteOpened: (path: string) => `ノートを開きました: ${path}`,
    findEmpty: "置換するテキスト(find)が空です。検索する文字列を指定してください。",
    findNotFound: (snippet: string) => `置換対象のテキストが見つかりません: "${snippet}..."`,
    editParamsRequired: "content または find/replace パラメータが必要です。",
    emptyFolder: "空のフォルダです。",
    noActiveNote: "現在開いているノートがありません。",
    pathHeader: (path: string, content: string) => `パス: ${path}\n\n${content}`,

    templateFolderMissing: (folder: string) =>
      `テンプレートフォルダがありません: ${folder}\nテンプレートを保存すると自動的に作成されます。`,
    noTemplates: "保存されたテンプレートがありません。",
    templateUpdated: (path: string) => `テンプレートを更新しました: ${path}`,
    templateSaved: (path: string) => `テンプレートを保存しました: ${path}`,
    templateAppliedWithRemaining: (path: string, remaining: string) =>
      `ノートを作成しました: ${path}\n⚠️ 未置換の変数が残っています: ${remaining}`,

    moved: (kind: string, from: string, to: string) => `${kind}を移動しました: ${from} → ${to}`,
    deleted: (kind: string, path: string) => `${kind}を削除しました: ${path}`,
    kindFolder: "フォルダ",
    kindFile: "ファイル",

    sbDisabled: "Second Brain機能が無効です。設定で有効にしてから再度お試しください。",
    noAiClient: (what: string) => `AIクライアントが使用できないため${what}を実行できません。`,
    whatSynthesize: "統合",
    whatReconcile: "矛盾チェック",
    whatArchitect: "アーキテクチャ分析",
    whatChallenge: "批判的レビュー",
    whatConnect: "トピックの接続",
    whatEmerge: "パターン発見",

    titleRequired: "ノートのタイトル(title)が必要です。",
    topicRequired: "トピック(topic)が必要です。",
    claimRequired: "検討する主張(claim)が必要です。",
    topicsRequired: "接続する2つのトピック(topicA, topicB)の両方が必要です。",

    wikiNoteExists: (path: string) => `ノートが既に存在するため上書きしませんでした: ${path}`,
    wikiNoteCreated: (path: string) => `Wikiノートを作成しました: ${path}`,
    catalogUpdated: (count: number) => `インデックスカタログを更新しました: ${count}件のノート`,
    synthesizeNoHits: (topic: string, staleNote: string) =>
      `"${topic}" に関連するノートが見つからず、統合ノートを作成しませんでした。${staleNote}`,
    synthesizeUpdated: (path: string, staleNote: string) =>
      `統合ノートを更新しました: ${path}${staleNote}`,
    synthesizeCreated: (path: string, staleNote: string) =>
      `統合ノートを作成しました: ${path}${staleNote}`,
    reconcileNone: "矛盾は見つかりませんでした。ノートは一切変更していません。",
    reconcileNoTargets:
      "反映する対象ノートがありません(承認された矛盾項目にノートパスがありません)。",
    architectNoFiles: (scanLabel: string) =>
      `スキャン対象パス(${scanLabel})に分析するファイルが見つかりませんでした。`,
    architectUpdated: (path: string) => `アーキテクチャノートを更新しました: ${path}`,
    architectCreated: (path: string) => `アーキテクチャノートを作成しました: ${path}`,
    challengeNoHits: (claim: string) =>
      `"${claim}" に反論する根拠となる関連ノートが見つかりませんでした。`,
    connectNoHits: (topicA: string, topicB: string) =>
      `"${topicA}" と "${topicB}" のどちらでも関連ノートが見つからず、接続する根拠がありません。`,
    emergeNoRecent: (days: number) => `直近${days}日以内に更新されたノートがありません。`,
    emergeCapped: (text: string, total: number, analyzed: number) =>
      `${text}\n\n---\n(最近のノート${total}件のうち最新${analyzed}件のみを分析しました。期間を絞るとより正確な結果が得られます。)`,
    gapsNone: "構造的なギャップは見つかりませんでした。",
    wikiEmpty: (heading: string) => `${heading}\n\n_まだWikiノートがありません。_\n`,
    ledgerEmpty: "記録された決定がありません。",
    ledgerHeading: "# 決定台帳\n",

    mcpToolFailed: (tool: string, detail: string) => `MCP ${tool}: ${detail}`,
    mcpToolFailedNoDetail: "実行失敗",
    mcpBadToolName: (name: string) => `不正なMCPツール名: ${name}`,
    mcpNotConnectedTo: (server: string) => `MCPサーバーに接続されていません: ${server}`,
    mcpNotConnected: "MCPサーバーに接続されていません",
    mcpServerExited: (code: number | null) => `MCPサーバーが終了しました (code: ${code})`,
    mcpRequestTimeout: (method: string) => `MCPリクエストがタイムアウトしました: ${method}`,
    mcpError: (message: string) => `MCPエラー: ${message}`,
    mcpConnectionClosed: "MCPサーバーの接続が閉じられました",
  },
};

/**
 * 언어에 해당하는 도구 결과 레이블. 알 수 없는 언어는 en으로 폴백한다.
 *
 * 반환 타입을 en 블록으로 고정하므로 ko/ja에 키가 빠지면 여기서 컴파일 오류가 난다.
 */
export function toolI18n(locale: Locale | undefined): ToolLabels {
  return (locale && TOOL_I18N[locale]) || TOOL_I18N.en;
}

/** en 블록이 정의하는 레이블 집합. ko/ja는 이 구조를 그대로 만족해야 한다. */
export type ToolLabels = typeof TOOL_I18N.en;
