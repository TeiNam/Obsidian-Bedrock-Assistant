// 명령 팔레트 · 입력 모달 · Notice 다국어 레이블
//
// 설정 탭은 I18N(settings-tab.ts), 채팅 사이드바는 VIEW_I18N(chat-view-i18n.ts)이 담당한다.
// 이 파일은 그 둘에 속하지 않는 표면 — 명령 팔레트 이름, SecondBrainInputModal 필드,
// 상태바, 그리고 main.ts / vault-indexer.ts가 띄우는 Notice — 를 담는다.
//
// 이 문자열들은 한동안 한국어로 하드코딩돼 있었다. 언어를 en/ja로 두면 설정과 사이드바만
// 번역되고 명령 팔레트와 알림은 한국어로 남았다.

import type { Locale } from "./types";

export const NOTICE_I18N = {
  en: {
    // ---- 명령 팔레트 ----
    cmdOpenAssistant: "Open assistant",
    cmdIndexVault: "Index vault",
    cmdCreateWikiNote: "Create wiki note",
    cmdUpdateIndex: "Update wiki index",
    cmdSynthesize: "Synthesize topic (synthesize)",
    cmdReconcile: "Check contradictions (reconcile)",
    cmdReconcileReview: "Review and apply contradictions (reconcile → apply)",
    cmdChallenge: "Challenge a claim (challenge)",
    cmdConnect: "Connect two topics (connect)",
    cmdEmerge: "Find recent patterns (emerge)",
    cmdArchitect: "Codebase architect (architect)",
    cmdKnowledgeGaps: "Refresh knowledge gap report",
    cmdDashboard: "Refresh and open Agent LLMs dashboard",
    cmdInboxTriage: "Inbox triage (title, move, tag suggestions)",
    cmdDecisions: "Extract decisions → ledger (decisions)",
    cmdCanonicalize: "Review duplicate candidates (canonical note and aliases)",
    cmdLinkSuggestions: "Suggest links (connect orphan and stub notes)",
    cmdReviewQueue: "Review queue (notes to revisit)",
    cmdRunScheduler: "Run Second Brain cleanup (scheduler)",

    // ---- 입력 모달 ----
    modalCreateWikiNote: "Create wiki note",
    modalSynthesize: "Synthesize topic (synthesize)",
    modalReconcile: "Check contradictions (reconcile)",
    modalReconcileReview: "Review and apply contradictions",
    modalChallenge: "Challenge a claim (challenge)",
    modalConnect: "Connect two topics (connect)",
    modalEmerge: "Find recent patterns (emerge)",
    modalArchitect: "Codebase architect (architect)",
    modalInboxTriage: "Inbox triage",
    modalDecisions: "Extract decisions",

    submitCreate: "Create",
    submitSynthesize: "Synthesize",
    submitReconcile: "Check",
    submitChallenge: "Challenge",
    submitConnect: "Connect",
    submitEmerge: "Find",
    submitArchitect: "Analyze",
    submitTriage: "Review",
    submitExtract: "Extract",
    submitCancel: "Cancel",

    fieldTitle: "Title",
    fieldTitlePlaceholder: "Note title",
    fieldBody: "Body",
    fieldBodyPlaceholder: "Note body",
    fieldTopic: "Topic",
    fieldTopicSynthesizePlaceholder: "Topic or tag to synthesize",
    fieldTopicReconcilePlaceholder: "Topic to check for contradictions",
    fieldTopicDecisionPlaceholder: "Topic to find decisions in",
    fieldClaim: "Claim",
    fieldClaimPlaceholder: "Claim to challenge",
    fieldTopicA: "Topic A",
    fieldTopicAPlaceholder: "First topic",
    fieldTopicB: "Topic B",
    fieldTopicBPlaceholder: "Second topic",
    fieldDays: "Recent days",
    fieldScanPath: "Scan path (leave empty for the whole vault)",
    fieldScanPathPlaceholder: "e.g. src",
    fieldFolder: "Folder",
    fieldFolderPlaceholder: "Folder to triage (e.g. Inbox)",

    // ---- 상태바 ----
    statusIndexing: (percent: number) => `Indexing... ${percent}%`,
    statusIndexDone: "Indexing complete ✓",

    // ---- Notice: Second Brain ----
    sbDisabled: "Second Brain is turned off. Enable it in settings and try again.",
    triageFolderRequired: "A folder path is required.",
    triageFailed: (reason: string) => `Inbox triage failed: ${reason}`,
    decisionTopicRequired: "A topic is required to find decisions.",
    decisionFailed: (reason: string) => `Decision extraction failed: ${reason}`,
    reconcileFailed: (reason: string) => `Contradiction check failed: ${reason}`,
    toolFailed: (tool: string, reason: string) => `Second Brain tool failed (${tool}): ${reason}`,
    gapsNone: "No structural gaps found.",
    gapsWritten: (count: number, path: string) => `Recorded ${count} knowledge gap(s) in the report: ${path}`,
    gapsFailed: (reason: string) => `Knowledge gap report failed: ${reason}`,
    dashboardUpdated: (count: number, path: string) =>
      `Bases dashboard updated (${count} item(s)): ${path}`,
    dashboardFailed: (reason: string) => `Bases dashboard failed: ${reason}`,
    reviewQueueEmpty: "Nothing to revisit right now.",
    schedulerBusy: "Second Brain cleanup is already running.",
    schedulerDone: "Second Brain cleanup ran (catalog, gap report, and Bases dashboard refreshed).",
    schedulerAllFailed: (steps: string) =>
      `Second Brain cleanup failed: every step failed (${steps}). Check the console log.`,
    schedulerPartial: (succeeded: number, failed: number, steps: string) =>
      `Second Brain cleanup partly failed: ${succeeded} succeeded, ${failed} failed (${steps}).`,
    schedulerFailed: (reason: string) => `Second Brain cleanup failed to run: ${reason}`,

    // ---- Notice: 세션 ----
    sessionRecovered: "The session file was corrupted and has been restored from the backup.",
    sessionRecoverFailed: "Could not restore the session file. Starting a new session.",

    // ---- Notice: 인덱싱 ----
    indexBusy: "Indexing is already running.",
    indexCleaned: (removed: number) => `Index cleanup complete: ${removed} removed, no changed files`,
    indexUpToDate: "All files are up to date.",
    indexIncremental: (total: number, skipped: number) =>
      `Incremental indexing: ${total} file(s) (${skipped} skipped)`,
    indexEmbeddingUnavailable: "⚠️ Embedding model unavailable → indexing in keyword search mode",

    // ---- AI 백엔드 오류 ----
    // 채팅 뷰가 `error(e)`로 감싸 화면에 그대로 띄우므로 사용자에게 보이는 문구다.
    errNoApiKey: (backend: string) => `${backend} API key is not configured. Enter it in settings.`,
    whatEmbedding: "embedding request",
    whatModelList: "model list lookup",
    whatRequest: "request",
    errNoEmbeddingModel: (backend: string) => `${backend} embedding model ID is not configured.`,
    errEmptyEmbeddingInput: "The text to embed is empty.",
    errNoEmbeddingVector: (backend: string) => `The ${backend} embedding response contains no valid vector.`,
    errNoResponseText: (backend: string) => `The ${backend} response contains no text.`,
    errNoResponseBody: (backend: string) => `The ${backend} response has no body to read.`,
    errTimeout: (backend: string, seconds: number) => `The ${backend} request timed out after ${seconds}s.`,
    errStreamFailed: (backend: string, reason: string) => `${backend} streaming failed: ${reason}`,
    errHttpStatus: (backend: string, what: string, status: number) =>
      `${backend} ${what} failed (HTTP ${status}).`,
    errEmbeddingUnparsable: (backend: string, model: string) =>
      `Could not parse the ${backend} embedding response (model=${model}).`,
    errTimeoutWhat: (backend: string, what: string, seconds: number) =>
      `The ${backend} ${what} timed out (${seconds}s).`,
    errServerUnreachable: (backend: string, url: string) =>
      `Cannot reach the ${backend} server (${url}). Check that ${backend} is running.`,
    errServerUnreachableDetail: (backend: string, url: string, reason: string) =>
      `Cannot reach the ${backend} server (${url}): ${reason}`,
    errApiHttp: (backend: string, status: number, detail: string) =>
      `${backend} API error (HTTP ${status}): ${detail}`,
    errStreamParseFailed: (backend: string, reason: string) =>
      `${backend} stream JSON parse failed: ${reason}`,
    // OpenAI HTTP 상태별 분류. `{backend} API {kind}{detail}` 형태로 조립된다.
    errKindUnauthorized: "authentication failed (401): check your API key",
    errKindForbidden: "forbidden (403)",
    errKindNotFound: "model or endpoint not found (404)",
    errKindBadRequest: "bad request (400)",
    errKindRateLimit: "rate limit exceeded (429)",
    errKindOther: (status: number) => `provider error (${status})`,

    // ---- MCP 설정 검증 오류 (설정 모달에 표시) ----
    mcpConfigNeedsServers: "An `mcpServers` object is required.",
    mcpConfigEmptyName: "An MCP server name cannot be empty.",
    mcpConfigNotObject: (name: string) => `The config for MCP server "${name}" must be an object.`,
    mcpConfigBadCommand: (name: string) => `"command" for MCP server "${name}" must be a non-empty string.`,
    mcpConfigBadArgs: (name: string) => `"args" for MCP server "${name}" must be an array of strings.`,
    mcpConfigBadEnv: (name: string) => `"env" for MCP server "${name}" must be an object of string values.`,
    mcpConfigBadDisabled: (name: string) => `"disabled" for MCP server "${name}" must be a boolean.`,

    // ---- Notice: 도구 실행 결과 ----
    // 도구의 반환 문자열은 LLM이 읽으므로 번역하지 않는다. 사용자에게 보이는 Notice만 번역한다.
    toolNoteCreated: (path: string) => `Note created: ${path}`,
    toolNotePatched: (path: string) => `Note partially updated: ${path}`,
    toolNoteEdited: (path: string) => `Note updated: ${path}`,
    toolNoteAppended: (path: string) => `Content appended: ${path}`,
    toolTemplateUpdated: (name: string) => `Template updated: ${name}`,
    toolTemplateCreated: (name: string) => `Template created: ${name}`,
    toolTemplateApplied: (path: string) => `Template applied: ${path}`,
    toolMoved: (kind: string, dest: string) => `${kind} moved: ${dest}`,
    toolDeleted: (kind: string, path: string) => `${kind} deleted: ${path}`,
    toolWikiNoteCreated: (path: string) => `Wiki note created: ${path}`,
    toolIndexUpdated: (count: number) => `Index catalog updated (${count} note(s))`,

    // ---- Notice: 웹 클리퍼 ----
    clipSummaryFallback: "AI summary failed — saving the original text instead.",
  },

  ko: {
    // ---- 명령 팔레트 ----
    cmdOpenAssistant: "어시스턴트 열기",
    cmdIndexVault: "볼트 인덱싱",
    cmdCreateWikiNote: "위키 노트 생성",
    cmdUpdateIndex: "위키 인덱스 갱신",
    cmdSynthesize: "주제 종합 (synthesize)",
    cmdReconcile: "모순 점검 (reconcile)",
    cmdReconcileReview: "모순 검토 및 반영 (reconcile → apply)",
    cmdChallenge: "주장 반박 (challenge)",
    cmdConnect: "두 주제 연결 (connect)",
    cmdEmerge: "최근 패턴 발견 (emerge)",
    cmdArchitect: "코드베이스 아키텍트 (architect)",
    cmdKnowledgeGaps: "지식 공백 리포트 갱신",
    cmdDashboard: "Agent LLMs 대시보드 갱신 및 열기",
    cmdInboxTriage: "Inbox 검토 (제목·이동·태그 제안)",
    cmdDecisions: "결정 추출 → 원장 (decisions)",
    cmdCanonicalize: "중복 후보 검토 (정본·별칭 정리)",
    cmdLinkSuggestions: "링크 제안 (고아·스텁 노트 연결)",
    cmdReviewQueue: "복습 큐 (다시 볼 노트)",
    cmdRunScheduler: "Second Brain 정리 실행 (스케줄러)",

    // ---- 입력 모달 ----
    modalCreateWikiNote: "위키 노트 생성",
    modalSynthesize: "주제 종합 (synthesize)",
    modalReconcile: "모순 점검 (reconcile)",
    modalReconcileReview: "모순 검토 및 반영",
    modalChallenge: "주장 반박 (challenge)",
    modalConnect: "두 주제 연결 (connect)",
    modalEmerge: "최근 패턴 발견 (emerge)",
    modalArchitect: "코드베이스 아키텍트 (architect)",
    modalInboxTriage: "Inbox 검토",
    modalDecisions: "결정 추출",

    submitCreate: "생성",
    submitSynthesize: "종합",
    submitReconcile: "점검",
    submitChallenge: "반박",
    submitConnect: "연결",
    submitEmerge: "발견",
    submitArchitect: "분석",
    submitTriage: "검토",
    submitExtract: "추출",
    submitCancel: "취소",

    fieldTitle: "제목",
    fieldTitlePlaceholder: "노트 제목",
    fieldBody: "본문",
    fieldBodyPlaceholder: "노트 본문",
    fieldTopic: "주제",
    fieldTopicSynthesizePlaceholder: "종합할 주제/태그",
    fieldTopicReconcilePlaceholder: "모순을 점검할 주제",
    fieldTopicDecisionPlaceholder: "결정을 찾을 주제",
    fieldClaim: "주장",
    fieldClaimPlaceholder: "검토(반박)할 주장",
    fieldTopicA: "주제 A",
    fieldTopicAPlaceholder: "첫 번째 주제",
    fieldTopicB: "주제 B",
    fieldTopicBPlaceholder: "두 번째 주제",
    fieldDays: "최근 일수",
    fieldScanPath: "스캔 경로 (비우면 볼트 전체)",
    fieldScanPathPlaceholder: "예: src",
    fieldFolder: "폴더",
    fieldFolderPlaceholder: "정리할 폴더 (예: Inbox)",

    // ---- 상태바 ----
    statusIndexing: (percent: number) => `인덱싱 중... ${percent}%`,
    statusIndexDone: "인덱싱 완료 ✓",

    // ---- Notice: Second Brain ----
    sbDisabled: "Second Brain 기능이 비활성 상태입니다. 설정에서 활성화한 뒤 다시 시도해 주세요.",
    triageFolderRequired: "정리할 폴더 경로가 필요합니다.",
    triageFailed: (reason: string) => `Inbox 검토 실패: ${reason}`,
    decisionTopicRequired: "결정을 찾을 주제가 필요합니다.",
    decisionFailed: (reason: string) => `결정 추출 실패: ${reason}`,
    reconcileFailed: (reason: string) => `모순 점검 실패: ${reason}`,
    toolFailed: (tool: string, reason: string) => `Second Brain 도구 실행 실패 (${tool}): ${reason}`,
    gapsNone: "구조적 공백이 발견되지 않았습니다.",
    gapsWritten: (count: number, path: string) => `지식 공백 ${count}건을 리포트에 기록했습니다: ${path}`,
    gapsFailed: (reason: string) => `지식 공백 리포트 실패: ${reason}`,
    dashboardUpdated: (count: number, path: string) =>
      `Bases 대시보드를 갱신했습니다 (${count}건): ${path}`,
    dashboardFailed: (reason: string) => `Bases 대시보드 갱신 실패: ${reason}`,
    reviewQueueEmpty: "지금 다시 볼 노트가 없습니다.",
    schedulerBusy: "Second Brain 정리가 이미 진행 중입니다.",
    schedulerDone: "Second Brain 정리(catalog·공백 리포트·Bases 대시보드 갱신)를 실행했습니다.",
    schedulerAllFailed: (steps: string) =>
      `Second Brain 정리 실패: 모든 단계가 실패했습니다 (${steps}). 콘솔 로그를 확인해 주세요.`,
    schedulerPartial: (succeeded: number, failed: number, steps: string) =>
      `Second Brain 정리 일부 실패: ${succeeded}개 성공, ${failed}개 실패 (${steps}).`,
    schedulerFailed: (reason: string) => `Second Brain 정리 실행 실패: ${reason}`,

    // ---- Notice: 세션 ----
    sessionRecovered: "세션 파일이 손상되어 백업에서 복구했습니다.",
    sessionRecoverFailed: "세션 파일 복구에 실패했습니다. 새로운 세션으로 시작합니다.",

    // ---- Notice: 인덱싱 ----
    indexBusy: "인덱싱이 이미 진행 중입니다.",
    indexCleaned: (removed: number) => `인덱스 정리 완료: ${removed}개 삭제됨, 변경 파일 없음`,
    indexUpToDate: "모든 파일이 최신 상태입니다.",
    indexIncremental: (total: number, skipped: number) =>
      `인크리멘털 인덱싱: ${total}개 파일 (${skipped}개 스킵)`,
    indexEmbeddingUnavailable: "⚠️ 임베딩 모델 접근 불가 → 키워드 검색 모드로 인덱싱",

    // ---- AI 백엔드 오류 ----
    errNoApiKey: (backend: string) => `${backend} API 키가 설정되지 않았습니다. 설정에서 API 키를 입력하세요.`,
    whatEmbedding: "임베딩 요청",
    whatModelList: "모델 목록 조회",
    whatRequest: "요청",
    errNoEmbeddingModel: (backend: string) => `${backend} 임베딩 모델 ID가 설정되지 않았습니다.`,
    errEmptyEmbeddingInput: "임베딩할 입력 텍스트가 비어 있습니다.",
    errNoEmbeddingVector: (backend: string) => `${backend} 임베딩 응답에 유효한 벡터가 없습니다.`,
    errNoResponseText: (backend: string) => `${backend} 응답에 텍스트가 없습니다.`,
    errNoResponseBody: (backend: string) => `${backend} 응답 본문을 읽을 수 없습니다.`,
    errTimeout: (backend: string, seconds: number) => `${backend} 요청이 시간 초과되었습니다(${seconds}초).`,
    errStreamFailed: (backend: string, reason: string) => `${backend} 스트리밍 처리 실패: ${reason}`,
    errHttpStatus: (backend: string, what: string, status: number) =>
      `${backend} ${what} 실패 (HTTP ${status}).`,
    errEmbeddingUnparsable: (backend: string, model: string) =>
      `${backend} 임베딩 응답을 해석할 수 없습니다 (model=${model}).`,
    errTimeoutWhat: (backend: string, what: string, seconds: number) =>
      `${backend} ${what} 시간 초과(${seconds}초).`,
    errServerUnreachable: (backend: string, url: string) =>
      `${backend} 서버에 접속할 수 없습니다 (${url}). ${backend}가 실행 중인지 확인하세요.`,
    errServerUnreachableDetail: (backend: string, url: string, reason: string) =>
      `${backend} 서버에 접속할 수 없습니다 (${url}): ${reason}`,
    errApiHttp: (backend: string, status: number, detail: string) =>
      `${backend} API 오류 (HTTP ${status}): ${detail}`,
    errStreamParseFailed: (backend: string, reason: string) =>
      `${backend} 스트림 JSON 파싱 실패: ${reason}`,
    errKindUnauthorized: "인증 실패(401): API 키를 확인하세요",
    errKindForbidden: "권한 없음(403)",
    errKindNotFound: "모델 또는 엔드포인트를 찾을 수 없습니다(404)",
    errKindBadRequest: "잘못된 요청(400)",
    errKindRateLimit: "요청 한도 초과(429)",
    errKindOther: (status: number) => `공급자 오류(${status})`,

    // ---- MCP 설정 검증 오류 (설정 모달에 표시) ----
    mcpConfigNeedsServers: "mcpServers 객체가 필요합니다.",
    mcpConfigEmptyName: "MCP 서버 이름은 비어 있을 수 없습니다.",
    mcpConfigNotObject: (name: string) => `MCP 서버 "${name}" 설정은 객체여야 합니다.`,
    mcpConfigBadCommand: (name: string) => `MCP 서버 "${name}"의 command는 비어 있지 않은 문자열이어야 합니다.`,
    mcpConfigBadArgs: (name: string) => `MCP 서버 "${name}"의 args는 문자열 배열이어야 합니다.`,
    mcpConfigBadEnv: (name: string) => `MCP 서버 "${name}"의 env는 문자열 값 객체여야 합니다.`,
    mcpConfigBadDisabled: (name: string) => `MCP 서버 "${name}"의 disabled는 boolean이어야 합니다.`,

    // ---- Notice: 도구 실행 결과 ----
    toolNoteCreated: (path: string) => `노트 생성됨: ${path}`,
    toolNotePatched: (path: string) => `노트 부분 수정됨: ${path}`,
    toolNoteEdited: (path: string) => `노트 수정됨: ${path}`,
    toolNoteAppended: (path: string) => `내용 추가됨: ${path}`,
    toolTemplateUpdated: (name: string) => `템플릿 수정됨: ${name}`,
    toolTemplateCreated: (name: string) => `템플릿 생성됨: ${name}`,
    toolTemplateApplied: (path: string) => `템플릿 적용됨: ${path}`,
    toolMoved: (kind: string, dest: string) => `${kind} 이동됨: ${dest}`,
    toolDeleted: (kind: string, path: string) => `${kind} 삭제됨: ${path}`,
    toolWikiNoteCreated: (path: string) => `위키 노트 생성됨: ${path}`,
    toolIndexUpdated: (count: number) => `인덱스 카탈로그 갱신됨 (${count}개 노트)`,

    // ---- Notice: 웹 클리퍼 ----
    clipSummaryFallback: "AI 요약에 실패하여 원본 텍스트로 저장합니다.",
  },

  ja: {
    // ---- 명령 팔레트 ----
    cmdOpenAssistant: "アシスタントを開く",
    cmdIndexVault: "ボルトをインデックス",
    cmdCreateWikiNote: "Wikiノートを作成",
    cmdUpdateIndex: "Wikiインデックスを更新",
    cmdSynthesize: "トピックを統合 (synthesize)",
    cmdReconcile: "矛盾をチェック (reconcile)",
    cmdReconcileReview: "矛盾をレビューして反映 (reconcile → apply)",
    cmdChallenge: "主張に反論 (challenge)",
    cmdConnect: "2つのトピックを接続 (connect)",
    cmdEmerge: "最近のパターンを発見 (emerge)",
    cmdArchitect: "コードベースアーキテクト (architect)",
    cmdKnowledgeGaps: "知識ギャップレポートを更新",
    cmdDashboard: "Agent LLMsダッシュボードを更新して開く",
    cmdInboxTriage: "Inbox整理 (タイトル・移動・タグの提案)",
    cmdDecisions: "決定を抽出 → 台帳 (decisions)",
    cmdCanonicalize: "重複候補をレビュー (正本・エイリアス整理)",
    cmdLinkSuggestions: "リンク提案 (孤立・スタブノートの接続)",
    cmdReviewQueue: "復習キュー (見直すノート)",
    cmdRunScheduler: "Second Brain整理を実行 (スケジューラ)",

    // ---- 입력 모달 ----
    modalCreateWikiNote: "Wikiノートを作成",
    modalSynthesize: "トピックを統合 (synthesize)",
    modalReconcile: "矛盾をチェック (reconcile)",
    modalReconcileReview: "矛盾をレビューして反映",
    modalChallenge: "主張に反論 (challenge)",
    modalConnect: "2つのトピックを接続 (connect)",
    modalEmerge: "最近のパターンを発見 (emerge)",
    modalArchitect: "コードベースアーキテクト (architect)",
    modalInboxTriage: "Inbox整理",
    modalDecisions: "決定を抽出",

    submitCreate: "作成",
    submitSynthesize: "統合",
    submitReconcile: "チェック",
    submitChallenge: "反論",
    submitConnect: "接続",
    submitEmerge: "発見",
    submitArchitect: "分析",
    submitTriage: "整理",
    submitExtract: "抽出",
    submitCancel: "キャンセル",

    fieldTitle: "タイトル",
    fieldTitlePlaceholder: "ノートのタイトル",
    fieldBody: "本文",
    fieldBodyPlaceholder: "ノートの本文",
    fieldTopic: "トピック",
    fieldTopicSynthesizePlaceholder: "統合するトピック/タグ",
    fieldTopicReconcilePlaceholder: "矛盾をチェックするトピック",
    fieldTopicDecisionPlaceholder: "決定を探すトピック",
    fieldClaim: "主張",
    fieldClaimPlaceholder: "検討(反論)する主張",
    fieldTopicA: "トピック A",
    fieldTopicAPlaceholder: "1つ目のトピック",
    fieldTopicB: "トピック B",
    fieldTopicBPlaceholder: "2つ目のトピック",
    fieldDays: "直近の日数",
    fieldScanPath: "スキャンパス (空ならボルト全体)",
    fieldScanPathPlaceholder: "例: src",
    fieldFolder: "フォルダ",
    fieldFolderPlaceholder: "整理するフォルダ (例: Inbox)",

    // ---- 상태바 ----
    statusIndexing: (percent: number) => `インデックス中... ${percent}%`,
    statusIndexDone: "インデックス完了 ✓",

    // ---- Notice: Second Brain ----
    sbDisabled: "Second Brain機能が無効です。設定で有効にしてから再度お試しください。",
    triageFolderRequired: "整理するフォルダのパスが必要です。",
    triageFailed: (reason: string) => `Inbox整理に失敗しました: ${reason}`,
    decisionTopicRequired: "決定を探すトピックが必要です。",
    decisionFailed: (reason: string) => `決定の抽出に失敗しました: ${reason}`,
    reconcileFailed: (reason: string) => `矛盾チェックに失敗しました: ${reason}`,
    toolFailed: (tool: string, reason: string) => `Second Brainツールの実行に失敗しました (${tool}): ${reason}`,
    gapsNone: "構造的なギャップは見つかりませんでした。",
    gapsWritten: (count: number, path: string) => `知識ギャップ${count}件をレポートに記録しました: ${path}`,
    gapsFailed: (reason: string) => `知識ギャップレポートに失敗しました: ${reason}`,
    dashboardUpdated: (count: number, path: string) =>
      `Basesダッシュボードを更新しました (${count}件): ${path}`,
    dashboardFailed: (reason: string) => `Basesダッシュボードの更新に失敗しました: ${reason}`,
    reviewQueueEmpty: "今見直すノートはありません。",
    schedulerBusy: "Second Brain整理はすでに実行中です。",
    schedulerDone: "Second Brain整理(カタログ・ギャップレポート・Basesダッシュボードの更新)を実行しました。",
    schedulerAllFailed: (steps: string) =>
      `Second Brain整理に失敗しました: すべてのステップが失敗しました (${steps})。コンソールログを確認してください。`,
    schedulerPartial: (succeeded: number, failed: number, steps: string) =>
      `Second Brain整理が一部失敗しました: ${succeeded}件成功、${failed}件失敗 (${steps})。`,
    schedulerFailed: (reason: string) => `Second Brain整理の実行に失敗しました: ${reason}`,

    // ---- Notice: 세션 ----
    sessionRecovered: "セッションファイルが破損していたためバックアップから復元しました。",
    sessionRecoverFailed: "セッションファイルの復元に失敗しました。新しいセッションを開始します。",

    // ---- Notice: 인덱싱 ----
    indexBusy: "インデックス処理はすでに実行中です。",
    indexCleaned: (removed: number) => `インデックス整理完了: ${removed}件削除、変更ファイルなし`,
    indexUpToDate: "すべてのファイルが最新です。",
    indexIncremental: (total: number, skipped: number) =>
      `増分インデックス: ${total}件のファイル (${skipped}件スキップ)`,
    indexEmbeddingUnavailable: "⚠️ 埋め込みモデルにアクセスできません → キーワード検索モードでインデックス",

    // ---- AI 백엔드 오류 ----
    errNoApiKey: (backend: string) => `${backend} APIキーが設定されていません。設定でAPIキーを入力してください。`,
    whatEmbedding: "埋め込みリクエスト",
    whatModelList: "モデル一覧の取得",
    whatRequest: "リクエスト",
    errNoEmbeddingModel: (backend: string) => `${backend} 埋め込みモデルIDが設定されていません。`,
    errEmptyEmbeddingInput: "埋め込む入力テキストが空です。",
    errNoEmbeddingVector: (backend: string) => `${backend} 埋め込みレスポンスに有効なベクトルがありません。`,
    errNoResponseText: (backend: string) => `${backend} レスポンスにテキストがありません。`,
    errNoResponseBody: (backend: string) => `${backend} レスポンス本文を読み取れません。`,
    errTimeout: (backend: string, seconds: number) => `${backend} リクエストがタイムアウトしました(${seconds}秒)。`,
    errStreamFailed: (backend: string, reason: string) => `${backend} ストリーミング処理に失敗しました: ${reason}`,
    errHttpStatus: (backend: string, what: string, status: number) =>
      `${backend} ${what}に失敗しました (HTTP ${status})。`,
    errEmbeddingUnparsable: (backend: string, model: string) =>
      `${backend} 埋め込みレスポンスを解釈できません (model=${model})。`,
    errTimeoutWhat: (backend: string, what: string, seconds: number) =>
      `${backend} ${what}がタイムアウトしました(${seconds}秒)。`,
    errServerUnreachable: (backend: string, url: string) =>
      `${backend} サーバーに接続できません (${url})。${backend}が実行中か確認してください。`,
    errServerUnreachableDetail: (backend: string, url: string, reason: string) =>
      `${backend} サーバーに接続できません (${url}): ${reason}`,
    errApiHttp: (backend: string, status: number, detail: string) =>
      `${backend} APIエラー (HTTP ${status}): ${detail}`,
    errStreamParseFailed: (backend: string, reason: string) =>
      `${backend} ストリームのJSON解析に失敗しました: ${reason}`,
    errKindUnauthorized: "認証失敗(401): APIキーを確認してください",
    errKindForbidden: "権限がありません(403)",
    errKindNotFound: "モデルまたはエンドポイントが見つかりません(404)",
    errKindBadRequest: "不正なリクエスト(400)",
    errKindRateLimit: "リクエスト上限を超過(429)",
    errKindOther: (status: number) => `プロバイダーエラー(${status})`,

    // ---- MCP 설정 검증 오류 (설정 모달에 표시) ----
    mcpConfigNeedsServers: "mcpServers オブジェクトが必要です。",
    mcpConfigEmptyName: "MCPサーバー名は空にできません。",
    mcpConfigNotObject: (name: string) => `MCPサーバー "${name}" の設定はオブジェクトである必要があります。`,
    mcpConfigBadCommand: (name: string) => `MCPサーバー "${name}" の command は空でない文字列である必要があります。`,
    mcpConfigBadArgs: (name: string) => `MCPサーバー "${name}" の args は文字列の配列である必要があります。`,
    mcpConfigBadEnv: (name: string) => `MCPサーバー "${name}" の env は文字列値のオブジェクトである必要があります。`,
    mcpConfigBadDisabled: (name: string) => `MCPサーバー "${name}" の disabled は boolean である必要があります。`,

    // ---- Notice: 도구 실행 결과 ----
    toolNoteCreated: (path: string) => `ノートを作成しました: ${path}`,
    toolNotePatched: (path: string) => `ノートを部分更新しました: ${path}`,
    toolNoteEdited: (path: string) => `ノートを更新しました: ${path}`,
    toolNoteAppended: (path: string) => `内容を追記しました: ${path}`,
    toolTemplateUpdated: (name: string) => `テンプレートを更新しました: ${name}`,
    toolTemplateCreated: (name: string) => `テンプレートを作成しました: ${name}`,
    toolTemplateApplied: (path: string) => `テンプレートを適用しました: ${path}`,
    toolMoved: (kind: string, dest: string) => `${kind}を移動しました: ${dest}`,
    toolDeleted: (kind: string, path: string) => `${kind}を削除しました: ${path}`,
    toolWikiNoteCreated: (path: string) => `Wikiノートを作成しました: ${path}`,
    toolIndexUpdated: (count: number) => `インデックスカタログを更新しました (${count}件のノート)`,

    // ---- Notice: 웹 클리퍼 ----
    clipSummaryFallback: "AI要約に失敗したため元のテキストで保存します。",
  },
};

/**
 * 언어에 해당하는 레이블 묶음. 알 수 없는 언어는 en으로 폴백한다.
 *
 * 반환 타입을 en 블록으로 고정하므로, ko/ja에 키가 빠지면 이 함수에서 컴파일 오류가 난다
 * (`as const`를 쓰지 않는 이유 — 리터럴 타입이 되면 값까지 같아야 해서 번역을 막는다).
 */
export function noticeI18n(locale: Locale | undefined): NoticeLabels {
  return (locale && NOTICE_I18N[locale]) || NOTICE_I18N.en;
}

/** en 블록이 정의하는 레이블 집합. ko/ja는 이 구조를 그대로 만족해야 한다. */
export type NoticeLabels = typeof NOTICE_I18N.en;
