# 버그 수정 요구사항 문서

## 소개

Obsidian AWS Bedrock 어시스턴트 플러그인의 코드 분석을 통해 발견된 6개의 버그와 6개의 개선사항을 체계적으로 수정합니다. 버그는 미사용 확인 모달, 상태 초기화 누락, 이벤트 리스너 누수, 코드 중복, 늦은 응답 무시, 진행률 역행 문제를 포함하며, 개선사항은 메시지 변이(mutation), 토큰 추정 불일치, 미활용 모듈, 폴더 자동 생성 누락, 파일 확장자 제한, SDK 버전 불일치를 포함합니다.

## 버그 분석

### 현재 동작 (결함)

1.1 WHEN `confirmToolExecution` 설정이 활성화된 상태에서 파괴적 도구(edit_note, create_note, delete_file, move_file)가 호출될 때 THEN `ToolConfirmModal`이 정의만 되어 있고 `executeAndRenderTool()`에서 사용되지 않아 사용자 확인 없이 즉시 실행됨

1.2 WHEN `clearChat()`가 호출될 때 THEN `attachedBinaryFiles`만 초기화되고 `attachedFiles`, `manuallyAttachedPaths`, `autoAttachedPath`가 초기화되지 않아 이전 대화의 첨부 파일 컨텍스트가 새 대화에 잔존함

1.3 WHEN `ChatView.onClose()`가 호출될 때 THEN `closeModelDropdown()`이 호출되지 않아 document 레벨의 `handleDropdownOutsideClick` 이벤트 리스너가 해제되지 않고 메모리 누수가 발생함

1.4 WHEN `BedrockClient`에서 `createClient()`와 `createControlClient()`가 각각 호출될 때 THEN credential 설정 및 API key 미들웨어 로직이 두 메서드에 완전히 중복되어 유지보수 시 한쪽만 수정하면 불일치가 발생할 수 있음

1.5 WHEN MCP 서버 요청이 타임아웃으로 pending Map에서 제거된 후 늦게 응답이 도착할 때 THEN `handleJsonMessage()`에서 `pending.has(id)`가 false이므로 응답이 조용히 무시되어 디버깅이 어려움

1.6 WHEN `indexVault()` 재시도 로직에서 `failures.pop()`으로 실패 항목을 제거하고 `processed++`를 실행할 때 THEN `onProgress` 콜백에 전달되는 `processed + failures.length + skippedEmpty` 값이 이전 호출보다 작아져 진행률이 역행함

1.7 WHEN `handleSend()`에서 첨부 파일 컨텍스트가 있을 때 THEN `this.messages` 배열의 마지막 메시지 `content`를 컨텍스트 접두사로 직접 변경(mutate)하여 저장/내보내기 시 접두사가 포함된 채로 저장됨

1.8 WHEN `estimateTokens()` 함수가 토큰 수를 추정할 때 THEN 영어 기준 4자/토큰을 사용하지만 `updateContextRing()`은 한국어 혼합 기준 2.5자/토큰을 사용하여 토큰 추정이 불일치함

1.9 WHEN `main.ts`에서 세션을 로드/저장할 때 THEN `session-recovery.ts`에 잘 구현된 `loadSessionsWithRecovery()`와 `saveSessionsWithBackup()` 함수를 사용하지 않고 동일한 로직을 인라인으로 중복 구현함

1.10 WHEN `createNote()`로 중첩 경로(예: `folder/subfolder/note.md`)에 노트를 생성할 때 THEN 부모 폴더를 자동 생성하지 않아 폴더가 없으면 오류가 발생함 (반면 `applyTemplate()`과 `moveFile()`은 부모 폴더를 자동 생성함)

1.11 WHEN `addFileContext()`로 볼트 파일을 첨부할 때 THEN `.md` 확장자만 허용하여 `.txt`, `.json`, `.yaml`, `.js`, `.ts` 등 텍스트 기반 파일을 첨부할 수 없음

1.12 WHEN 프로젝트 의존성을 설치할 때 THEN `@aws-sdk/client-bedrock`(^3.997.0)과 `@aws-sdk/client-bedrock-runtime`(^3.700.0)의 버전이 불일치하여 호환성 문제가 발생할 수 있음

### 기대 동작 (올바른 동작)

2.1 WHEN `confirmToolExecution` 설정이 활성화된 상태에서 파괴적 도구가 호출될 때 THEN `executeAndRenderTool()`이 `ToolConfirmModal`을 표시하여 사용자가 확인/취소를 선택할 수 있어야 하며, 취소 시 도구 실행이 중단되어야 함

2.2 WHEN `clearChat()`가 호출될 때 THEN `attachedFiles.clear()`, `manuallyAttachedPaths.clear()`, `autoAttachedPath = null`도 함께 초기화하여 모든 첨부 파일 상태가 완전히 리셋되어야 함

2.3 WHEN `ChatView.onClose()`가 호출될 때 THEN `closeModelDropdown()`을 호출하여 document 레벨 이벤트 리스너를 정리하고 메모리 누수를 방지해야 함

2.4 WHEN `BedrockClient`에서 클라이언트를 생성할 때 THEN credential 설정 및 API key 미들웨어 로직을 공통 헬퍼 메서드로 추출하여 `createClient()`와 `createControlClient()`가 이를 재사용해야 함

2.5 WHEN MCP 서버 요청이 타임아웃 후 늦게 응답이 도착할 때 THEN `handleJsonMessage()`에서 해당 응답에 대한 디버그 로그를 출력하여 타임아웃 후 늦은 응답을 추적할 수 있어야 함

2.6 WHEN `indexVault()` 재시도 로직에서 재시도가 성공할 때 THEN 진행률 계산이 역행하지 않고 단조 증가(monotonically increasing)해야 함

2.7 WHEN `handleSend()`에서 첨부 파일 컨텍스트가 있을 때 THEN 원본 메시지의 `content`는 변경하지 않고, API 호출용 메시지만 컨텍스트 접두사를 포함하여 저장/내보내기 시 원본 텍스트가 유지되어야 함

2.8 WHEN 토큰 수를 추정할 때 THEN `estimateTokens()`와 `updateContextRing()` 모두 일관되게 한국어 혼합 기준 약 2.5자/토큰을 사용해야 함

2.9 WHEN `main.ts`에서 세션을 로드/저장할 때 THEN `session-recovery.ts`의 `loadSessionsWithRecovery()`와 `saveSessionsWithBackup()` 함수를 활용하여 중복 코드를 제거해야 함

2.10 WHEN `createNote()`로 중첩 경로에 노트를 생성할 때 THEN `applyTemplate()`, `moveFile()`과 동일하게 부모 폴더가 없으면 자동으로 생성해야 함

2.11 WHEN `addFileContext()`로 볼트 파일을 첨부할 때 THEN `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.csv`, `.xml`, `.html`, `.css`, `.js`, `.ts` 등 텍스트 기반 파일 확장자를 허용해야 함

2.12 WHEN 프로젝트 의존성을 설치할 때 THEN `@aws-sdk/client-bedrock`과 `@aws-sdk/client-bedrock-runtime`의 버전이 동일하게 `^3.997.0`으로 맞춰져야 함

### 변경 없는 동작 (회귀 방지)

3.1 WHEN `confirmToolExecution` 설정이 비활성화된 상태에서 도구가 호출될 때 THEN 기존처럼 확인 없이 즉시 실행되어야 함

3.2 WHEN 비파괴적 도구(search_vault, read_note, list_files 등)가 호출될 때 THEN `confirmToolExecution` 설정과 관계없이 기존처럼 확인 없이 실행되어야 함

3.3 WHEN `clearChat()` 후 새 대화를 시작할 때 THEN 기존처럼 메시지 목록 초기화, 환영 메시지 표시, 히스토리 삭제가 정상 동작해야 함

3.4 WHEN `ChatView`가 정상적으로 열려 있을 때 THEN 모델 드롭다운의 열기/닫기 동작이 기존과 동일하게 작동해야 함

3.5 WHEN `createClient()`와 `createControlClient()`가 호출될 때 THEN 리팩토링 후에도 manual, apikey, env 세 가지 credential 모드가 기존과 동일하게 동작해야 함

3.6 WHEN MCP 서버 요청이 정상적으로 응답할 때 THEN 기존처럼 pending Map에서 resolve/reject가 정상 처리되어야 함

3.7 WHEN `indexVault()`에서 첫 시도에 성공하는 파일들에 대해 THEN 기존처럼 진행률이 정상적으로 증가해야 함

3.8 WHEN 첨부 파일 컨텍스트가 없는 일반 메시지를 보낼 때 THEN 기존처럼 메시지가 정상적으로 전송되고 저장되어야 함

3.9 WHEN `trimConversationHistory()`가 호출될 때 THEN 토큰 추정 변경 후에도 컨텍스트 윈도우 초과 방지 및 최소 메시지 유지 로직이 정상 동작해야 함

3.10 WHEN `session-recovery.ts` 리팩토링 후 세션을 로드/저장할 때 THEN 기존 세션 파일과의 호환성이 유지되고 백업/복구 동작이 동일해야 함

3.11 WHEN `createNote()`로 루트 레벨에 노트를 생성할 때 THEN 기존처럼 폴더 생성 없이 바로 노트가 생성되어야 함

3.12 WHEN `.md` 파일을 `addFileContext()`로 첨부할 때 THEN 기존처럼 정상적으로 첨부되어야 함

3.13 WHEN AWS SDK를 사용하여 Bedrock API를 호출할 때 THEN 버전 통일 후에도 기존 API 호출(Converse, Embedding, ListModels)이 정상 동작해야 함
