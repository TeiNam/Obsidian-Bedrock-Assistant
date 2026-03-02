# 코드베이스 버그 수정 및 개선 설계 문서

## 개요

Obsidian AWS Bedrock 어시스턴트 플러그인에서 발견된 12개의 결함(버그 6개 + 개선사항 6개)을 체계적으로 수정합니다. 버그 조건(Bug Condition) 방법론을 적용하여 각 결함의 트리거 조건을 형식화하고, 수정 후 기존 동작이 보존되는지 검증합니다.

수정 범위는 크게 세 카테고리로 나뉩니다:
1. **안전성 버그**: ToolConfirmModal 미사용, 상태 초기화 누락, 이벤트 리스너 누수 (1.1~1.3)
2. **정확성 버그**: 코드 중복, 늦은 응답 무시, 진행률 역행 (1.4~1.6)
3. **개선사항**: 메시지 변이, 토큰 추정 불일치, 모듈 미활용, 폴더 자동 생성, 확장자 제한, SDK 버전 통일 (1.7~1.12)

## 용어 사전

- **Bug_Condition (C)**: 버그를 트리거하는 입력/상태 조건
- **Property (P)**: 버그 조건에서의 기대 동작 (올바른 동작)
- **Preservation**: 수정에 의해 변경되지 않아야 하는 기존 동작
- **executeAndRenderTool()**: `src/chat-view.ts`의 도구 실행 및 UI 렌더링 함수
- **clearChat()**: `src/chat-view.ts`의 대화 초기화 함수
- **closeModelDropdown()**: `src/chat-view.ts`의 모델 드롭다운 닫기 및 이벤트 리스너 해제 함수
- **createClient() / createControlClient()**: `src/bedrock-client.ts`의 AWS SDK 클라이언트 생성 함수
- **handleJsonMessage()**: `src/mcp-client.ts`의 JSON-RPC 메시지 처리 함수
- **indexVault()**: `src/vault-indexer.ts`의 볼트 인덱싱 함수
- **파괴적 도구(Destructive Tool)**: edit_note, create_note, delete_file, move_file 등 데이터를 변경하는 도구

## 버그 상세

### 결함 조건 (Fault Condition)

12개의 결함은 각각 독립적인 버그 조건을 가집니다. 아래에서 주요 버그 6개의 결함 조건을 형식화합니다.

**형식 명세:**

```
FUNCTION isBugCondition_ToolConfirm(input)
  INPUT: input of type { toolName: string, settings: Settings }
  OUTPUT: boolean

  destructiveTools := ['edit_note', 'create_note', 'delete_file', 'move_file']
  RETURN input.settings.confirmToolExecution === true
         AND input.toolName IN destructiveTools
         AND ToolConfirmModal이 표시되지 않음
END FUNCTION

FUNCTION isBugCondition_ClearChat(input)
  INPUT: input of type { action: string, currentState: ChatViewState }
  OUTPUT: boolean

  RETURN input.action === 'clearChat'
         AND (currentState.attachedFiles.size > 0
              OR currentState.manuallyAttachedPaths.size > 0
              OR currentState.autoAttachedPath !== null)
END FUNCTION

FUNCTION isBugCondition_OnClose(input)
  INPUT: input of type { action: string, dropdownListenerActive: boolean }
  OUTPUT: boolean

  RETURN input.action === 'onClose'
         AND input.dropdownListenerActive === true
END FUNCTION

FUNCTION isBugCondition_DuplicateClient(input)
  INPUT: input of type { method: string }
  OUTPUT: boolean

  RETURN input.method IN ['createClient', 'createControlClient']
         AND credential 설정 로직이 두 메서드에 중복 존재
END FUNCTION

FUNCTION isBugCondition_LateResponse(input)
  INPUT: input of type { responseId: number, pendingMap: Map }
  OUTPUT: boolean

  RETURN input.responseId !== undefined
         AND NOT input.pendingMap.has(input.responseId)
         // 타임아웃으로 이미 제거된 요청에 대한 늦은 응답
END FUNCTION

FUNCTION isBugCondition_ProgressRegression(input)
  INPUT: input of type { retrySuccess: boolean, previousProgress: number }
  OUTPUT: boolean

  RETURN input.retrySuccess === true
         // failures.pop()으로 failures.length가 감소하고
         // processed++로 processed가 증가하지만
         // 순 변화량이 0이 되어 진행률이 역행할 수 있음
         AND (processed + failures.length + skippedEmpty) < input.previousProgress
END FUNCTION
```

### 개선사항 결함 조건:

```
FUNCTION isBugCondition_MessageMutation(input)
  INPUT: input of type { hasContext: boolean, message: ChatMessage }
  OUTPUT: boolean

  RETURN input.hasContext === true
         AND input.message.content가 contextPrefix로 직접 변경됨
END FUNCTION

FUNCTION isBugCondition_TokenEstimate(input)
  INPUT: input of type { text: string, source: string }
  OUTPUT: boolean

  RETURN input.source === 'estimateTokens'
         AND 사용된 비율이 4자/토큰 (영어 기준)
         // updateContextRing()은 2.5자/토큰 사용 → 불일치
END FUNCTION

FUNCTION isBugCondition_SessionRecovery(input)
  INPUT: input of type { caller: string }
  OUTPUT: boolean

  RETURN input.caller === 'main.ts'
         AND session-recovery.ts의 함수를 사용하지 않고 인라인 구현
END FUNCTION

FUNCTION isBugCondition_CreateNoteFolder(input)
  INPUT: input of type { path: string }
  OUTPUT: boolean

  RETURN input.path.includes('/')
         AND 부모 폴더가 존재하지 않음
END FUNCTION

FUNCTION isBugCondition_FileExtension(input)
  INPUT: input of type { filePath: string }
  OUTPUT: boolean

  textExtensions := ['.txt', '.json', '.yaml', '.yml', '.csv', '.xml',
                     '.html', '.css', '.js', '.ts']
  RETURN getExtension(input.filePath) IN textExtensions
         AND addFileContext()가 해당 파일을 거부함
END FUNCTION

FUNCTION isBugCondition_SdkVersion(input)
  INPUT: input of type { dependencies: Record<string, string> }
  OUTPUT: boolean

  RETURN input.dependencies['@aws-sdk/client-bedrock'] !== 
         input.dependencies['@aws-sdk/client-bedrock-runtime']
END FUNCTION
```

### 예시

- **ToolConfirmModal 미사용**: `confirmToolExecution=true` 상태에서 `edit_note` 도구 호출 → 확인 모달 없이 즉시 실행됨 (기대: 모달 표시 후 사용자 확인/취소)
- **clearChat() 상태 누락**: 파일 3개 첨부 후 `clearChat()` 호출 → `attachedFiles.size === 3` 유지 (기대: `attachedFiles.size === 0`)
- **onClose() 리스너 누수**: 모델 드롭다운 열린 상태에서 뷰 닫기 → `handleDropdownOutsideClick` 리스너가 document에 잔존 (기대: 리스너 해제)
- **중복 클라이언트 코드**: `createClient()`의 apikey 미들웨어 수정 시 `createControlClient()`에 반영 안 됨 (기대: 공통 로직 한 곳에서 관리)
- **MCP 늦은 응답**: 타임아웃 후 응답 도착 → 로그 없이 무시됨 (기대: 디버그 로그 출력)
- **진행률 역행**: 재시도 성공 시 `failures.pop()` → `processed + failures.length + skippedEmpty`가 이전보다 감소 (기대: 단조 증가)
- **메시지 변이**: 첨부 파일 있는 메시지 전송 → `this.messages` 배열의 원본 content가 변경됨 (기대: 원본 유지, API용 복사본만 변경)
- **토큰 추정 불일치**: `estimateTokens()`는 4자/토큰, `updateContextRing()`은 2.5자/토큰 → 60% 차이 (기대: 일관된 비율)
- **세션 복구 미활용**: `main.ts`에 `session-recovery.ts`와 동일한 로직이 인라인으로 중복 (기대: 모듈 재사용)
- **createNote() 폴더 누락**: `createNote("folder/sub/note.md", "...")` → 폴더 없으면 오류 (기대: 자동 생성)
- **파일 확장자 제한**: `addFileContext("data.json")` → `.md`가 아니므로 거부 (기대: 텍스트 파일 허용)
- **SDK 버전 불일치**: `client-bedrock: ^3.997.0`, `client-bedrock-runtime: ^3.700.0` → 297 버전 차이 (기대: 동일 버전)

## 기대 동작

### 보존 요구사항 (Preservation Requirements)

**변경 없는 동작:**
- `confirmToolExecution=false`일 때 모든 도구가 확인 없이 즉시 실행되어야 함
- 비파괴적 도구(search_vault, read_note, list_files 등)는 설정과 관계없이 확인 없이 실행
- `clearChat()` 후 메시지 목록 초기화, 환영 메시지 표시, 히스토리 삭제가 정상 동작
- 모델 드롭다운의 열기/닫기 동작이 기존과 동일하게 작동
- `createClient()`와 `createControlClient()`의 manual, apikey, env 세 가지 credential 모드가 동일하게 동작
- MCP 서버 정상 응답 시 pending Map에서 resolve/reject가 정상 처리
- `indexVault()` 첫 시도 성공 파일들의 진행률이 정상 증가
- 첨부 파일 없는 일반 메시지 전송/저장이 정상 동작
- `trimConversationHistory()` 컨텍스트 윈도우 초과 방지 및 최소 메시지 유지 로직 정상 동작
- 기존 세션 파일과의 호환성 유지, 백업/복구 동작 동일
- 루트 레벨 `createNote()` 시 폴더 생성 없이 바로 노트 생성
- `.md` 파일 첨부가 기존처럼 정상 동작
- AWS SDK 버전 통일 후 Converse, Embedding, ListModels API 호출 정상 동작

**범위:**
위 버그 조건에 해당하지 않는 모든 입력은 수정에 의해 영향받지 않아야 합니다.

## 가설적 근본 원인 (Hypothesized Root Cause)

버그 분석 결과, 각 결함의 근본 원인은 다음과 같이 추정됩니다:

1. **ToolConfirmModal 미사용 (1.1)**
   - `ToolConfirmModal` 클래스가 정의되어 있지만 `executeAndRenderTool()`에서 호출하는 코드가 누락됨
   - `confirmToolExecution` 설정값을 확인하는 분기문이 없음
   - 파괴적 도구 목록(`edit_note`, `create_note`, `delete_file`, `move_file`)에 대한 필터링 로직 부재

2. **clearChat() 상태 초기화 누락 (1.2)**
   - `clearChat()` 함수에서 `attachedBinaryFiles.clear()`만 호출하고 `attachedFiles`, `manuallyAttachedPaths`, `autoAttachedPath` 초기화를 빠뜨림
   - 바이너리 첨부 파일 기능이 나중에 추가되면서 텍스트 첨부 파일 초기화가 누락된 것으로 추정

3. **onClose() 이벤트 리스너 누수 (1.3)**
   - `onClose()`에서 `handleStop()`과 `persistHistory()`만 호출하고 `closeModelDropdown()` 호출이 누락됨
   - `closeModelDropdown()`은 `document.removeEventListener('click', this.handleDropdownOutsideClick)`을 수행하는 함수

4. **createClient/createControlClient 중복 (1.4)**
   - 두 함수가 credential 설정(manual/apikey/env 분기)과 API key 미들웨어 주입 로직을 각각 독립적으로 구현
   - 공통 헬퍼 메서드 추출 없이 복사-붙여넣기로 작성된 것으로 추정

5. **MCP 늦은 응답 무시 (1.5)**
   - `handleJsonMessage()`에서 `pending.has(id)` 체크 후 false인 경우 아무 처리 없이 무시
   - 타임아웃으로 제거된 요청의 늦은 응답에 대한 로깅이 없어 디버깅 어려움

6. **진행률 역행 (1.6)**
   - 재시도 성공 시 `failures.pop()`으로 `failures.length`가 1 감소하고 `processed++`로 1 증가
   - 그러나 `onProgress` 콜백이 catch 블록 내부의 재시도 성공 후에는 호출되지 않고, 루프 끝의 `onProgress`에서 호출됨
   - `failures.pop()` 후 `processed++`하면 합계는 동일하지만, catch 블록에서 이미 failures에 push한 후 pop하므로 타이밍에 따라 역행 가능

7. **handleSend() 메시지 변이 (1.7)**
   - `this.messages` 배열의 마지막 요소의 `content` 프로퍼티를 직접 재할당
   - API 호출용 복사본을 만들지 않고 원본 객체를 수정

8. **estimateTokens() 토큰 추정 불일치 (1.8)**
   - `estimateTokens()`는 `JSON.stringify(messages).length / 4` (영어 기준 4자/토큰)
   - `updateContextRing()`은 `totalChars / 2.5` (한국어 혼합 기준 2.5자/토큰)
   - 동일한 텍스트에 대해 약 60% 차이가 발생

9. **session-recovery.ts 미활용 (1.9)**
   - `main.ts`의 `loadSessions()`와 `saveSessions()`가 `session-recovery.ts`의 `loadSessionsWithRecovery()`와 `saveSessionsWithBackup()`과 동일한 로직을 인라인으로 구현
   - 모듈이 존재하지만 import되지 않음

10. **createNote() 폴더 자동 생성 누락 (1.10)**
    - `applyTemplate()`과 `moveFile()`은 `outputDir` 확인 후 `createFolder()` 호출
    - `createNote()`에는 이 로직이 없음

11. **addFileContext() 확장자 제한 (1.11)**
    - `file.extension !== "md"` 조건으로 `.md` 외 모든 파일을 거부
    - 텍스트 기반 파일 확장자 허용 목록이 없음

12. **AWS SDK 버전 불일치 (1.12)**
    - `package.json`에서 `@aws-sdk/client-bedrock: ^3.997.0`, `@aws-sdk/client-bedrock-runtime: ^3.700.0`
    - 동일 SDK 패밀리이므로 버전을 맞춰야 호환성 보장

## 정확성 속성 (Correctness Properties)

Property 1: Fault Condition - 파괴적 도구 실행 전 확인 모달 표시

_For any_ 입력에서 `confirmToolExecution=true`이고 도구가 파괴적 도구 목록에 포함될 때, 수정된 `executeAndRenderTool()` 함수는 `ToolConfirmModal`을 표시하고 사용자가 승인해야만 도구를 실행하며, 거부 시 실행을 중단해야 합니다.

**Validates: Requirements 2.1**

Property 2: Preservation - 비파괴적 도구 및 설정 비활성화 시 동작 보존

_For any_ 입력에서 `confirmToolExecution=false`이거나 도구가 비파괴적일 때, 수정된 코드는 기존과 동일하게 확인 없이 즉시 도구를 실행해야 합니다.

**Validates: Requirements 3.1, 3.2**

Property 3: Fault Condition - clearChat() 전체 첨부 파일 상태 초기화

_For any_ `clearChat()` 호출에서, 수정된 함수는 `attachedFiles`, `manuallyAttachedPaths`, `autoAttachedPath`를 모두 초기화하여 이전 대화의 첨부 파일 컨텍스트가 잔존하지 않아야 합니다.

**Validates: Requirements 2.2**

Property 4: Preservation - clearChat() 기존 초기화 동작 보존

_For any_ `clearChat()` 호출에서, 수정된 함수는 기존처럼 메시지 목록 초기화, 환영 메시지 표시, 히스토리 삭제, `attachedBinaryFiles` 초기화가 정상 동작해야 합니다.

**Validates: Requirements 3.3**

Property 5: Fault Condition - onClose() 이벤트 리스너 정리

_For any_ `onClose()` 호출에서, 수정된 함수는 `closeModelDropdown()`을 호출하여 document 레벨 이벤트 리스너를 해제해야 합니다.

**Validates: Requirements 2.3**

Property 6: Preservation - 모델 드롭다운 정상 동작 보존

_For any_ `ChatView`가 열려 있는 상태에서, 모델 드롭다운의 열기/닫기 동작이 기존과 동일하게 작동해야 합니다.

**Validates: Requirements 3.4**

Property 7: Fault Condition - 클라이언트 생성 코드 중복 제거

_For any_ `createClient()` 또는 `createControlClient()` 호출에서, credential 설정 및 API key 미들웨어 로직이 공통 헬퍼 메서드를 통해 재사용되어야 합니다.

**Validates: Requirements 2.4**

Property 8: Preservation - 세 가지 credential 모드 동작 보존

_For any_ credential 모드(manual, apikey, env)에서, 리팩토링 후에도 클라이언트가 기존과 동일하게 생성되고 인증이 정상 동작해야 합니다.

**Validates: Requirements 3.5**

Property 9: Fault Condition - MCP 타임아웃 후 늦은 응답 로깅

_For any_ 타임아웃으로 pending Map에서 제거된 요청에 대해 늦은 응답이 도착할 때, 수정된 `handleJsonMessage()`는 디버그 로그를 출력해야 합니다.

**Validates: Requirements 2.5**

Property 10: Preservation - MCP 정상 응답 처리 보존

_For any_ 정상적인 MCP 응답에서, pending Map의 resolve/reject가 기존과 동일하게 처리되어야 합니다.

**Validates: Requirements 3.6**

Property 11: Fault Condition - 인덱싱 진행률 단조 증가

_For any_ `indexVault()` 실행에서 재시도가 성공할 때, `onProgress` 콜백에 전달되는 진행률 값이 이전 호출보다 크거나 같아야 합니다 (단조 증가).

**Validates: Requirements 2.6**

Property 12: Preservation - 첫 시도 성공 파일 진행률 보존

_For any_ `indexVault()` 실행에서 첫 시도에 성공하는 파일들에 대해, 진행률이 기존처럼 정상적으로 증가해야 합니다.

**Validates: Requirements 3.7**

Property 13: Fault Condition - handleSend() 원본 메시지 보존

_For any_ 첨부 파일 컨텍스트가 있는 메시지 전송에서, `this.messages` 배열의 원본 `content`는 변경되지 않고, API 호출용 메시지만 컨텍스트 접두사를 포함해야 합니다.

**Validates: Requirements 2.7**

Property 14: Preservation - 첨부 파일 없는 메시지 동작 보존

_For any_ 첨부 파일 컨텍스트가 없는 일반 메시지 전송에서, 기존처럼 메시지가 정상적으로 전송되고 저장되어야 합니다.

**Validates: Requirements 3.8**

Property 15: Fault Condition - 토큰 추정 일관성

_For any_ 토큰 추정에서, `estimateTokens()`와 `updateContextRing()` 모두 일관되게 약 2.5자/토큰 비율을 사용해야 합니다.

**Validates: Requirements 2.8**

Property 16: Preservation - trimConversationHistory() 동작 보존

_For any_ `trimConversationHistory()` 호출에서, 토큰 추정 변경 후에도 컨텍스트 윈도우 초과 방지 및 최소 메시지 유지 로직이 정상 동작해야 합니다.

**Validates: Requirements 3.9**

Property 17: Fault Condition - session-recovery.ts 모듈 활용

_For any_ 세션 로드/저장에서, `main.ts`가 `session-recovery.ts`의 `loadSessionsWithRecovery()`와 `saveSessionsWithBackup()` 함수를 활용하여 중복 코드를 제거해야 합니다.

**Validates: Requirements 2.9**

Property 18: Preservation - 세션 호환성 보존

_For any_ 세션 로드/저장에서, 리팩토링 후에도 기존 세션 파일과의 호환성이 유지되고 백업/복구 동작이 동일해야 합니다.

**Validates: Requirements 3.10**

Property 19: Fault Condition - createNote() 부모 폴더 자동 생성

_For any_ 중첩 경로에 노트를 생성할 때, 부모 폴더가 없으면 자동으로 생성해야 합니다.

**Validates: Requirements 2.10**

Property 20: Preservation - 루트 레벨 createNote() 동작 보존

_For any_ 루트 레벨에 노트를 생성할 때, 기존처럼 폴더 생성 없이 바로 노트가 생성되어야 합니다.

**Validates: Requirements 3.11**

Property 21: Fault Condition - addFileContext() 텍스트 파일 확장자 허용

_For any_ 텍스트 기반 파일(`.txt`, `.json`, `.yaml`, `.yml`, `.csv`, `.xml`, `.html`, `.css`, `.js`, `.ts`)을 첨부할 때, `addFileContext()`가 해당 파일을 허용해야 합니다.

**Validates: Requirements 2.11**

Property 22: Preservation - .md 파일 첨부 동작 보존

_For any_ `.md` 파일을 첨부할 때, 기존처럼 정상적으로 첨부되어야 합니다.

**Validates: Requirements 3.12**

Property 23: Fault Condition - AWS SDK 버전 통일

_For any_ 프로젝트 빌드에서, `@aws-sdk/client-bedrock`과 `@aws-sdk/client-bedrock-runtime`의 버전이 동일하게 `^3.997.0`이어야 합니다.

**Validates: Requirements 2.12**

Property 24: Preservation - AWS SDK API 호출 동작 보존

_For any_ AWS SDK를 사용한 Bedrock API 호출(Converse, Embedding, ListModels)에서, 버전 통일 후에도 정상 동작해야 합니다.

**Validates: Requirements 3.13**

## 수정 구현 (Fix Implementation)

### 필요한 변경사항

근본 원인 분석이 맞다는 가정 하에:

**파일**: `src/chat-view.ts`

**함수**: `executeAndRenderTool()`

**변경사항 1 - ToolConfirmModal 연동**:
1. 파괴적 도구 목록 상수 정의: `const DESTRUCTIVE_TOOLS = ['edit_note', 'create_note', 'delete_file', 'move_file']`
2. `executeAndRenderTool()` 시작 부분에 `confirmToolExecution` 설정 확인 분기 추가
3. 파괴적 도구일 경우 `ToolConfirmModal`을 Promise로 감싸서 사용자 응답 대기
4. 사용자가 거부하면 "도구 실행이 취소되었습니다" 메시지 반환 및 UI 업데이트

---

**파일**: `src/chat-view.ts`

**함수**: `clearChat()`

**변경사항 2 - 첨부 파일 상태 초기화**:
1. `this.attachedFiles.clear()` 추가
2. `this.manuallyAttachedPaths.clear()` 추가
3. `this.autoAttachedPath = null` 추가

---

**파일**: `src/chat-view.ts`

**함수**: `onClose()`

**변경사항 3 - 드롭다운 리스너 정리**:
1. `this.closeModelDropdown()` 호출 추가

---

**파일**: `src/bedrock-client.ts`

**함수**: `createClient()`, `createControlClient()`

**변경사항 4 - 공통 헬퍼 추출**:
1. `private buildClientConfig(): Record<string, unknown>` 헬퍼 메서드 추출 (credential 설정 로직)
2. `private applyApiKeyMiddleware(client: { middlewareStack: any }): void` 헬퍼 메서드 추출 (API key 미들웨어 주입)
3. `createClient()`와 `createControlClient()`가 헬퍼를 호출하도록 리팩토링

---

**파일**: `src/mcp-client.ts`

**함수**: `handleJsonMessage()`

**변경사항 5 - 늦은 응답 로깅**:
1. `pending.has(id)` 체크 후 false인 경우 `console.debug()` 로그 추가
2. 로그에 응답 ID와 타임아웃 후 도착했다는 메시지 포함

---

**파일**: `src/vault-indexer.ts`

**함수**: `indexVault()`

**변경사항 6 - 진행률 역행 수정**:
1. 재시도 성공 시 `failures.pop()` 후 `processed++` 대신, 별도의 `retrySuccessCount` 변수 사용
2. 또는 `onProgress` 콜백에 전달하는 값을 `Math.max(previousProgress, currentProgress)`로 보정
3. 가장 간단한 접근: 재시도 성공 시 `failures.pop()` + `processed++`는 합계가 동일하므로, catch 블록 내부에서 재시도 성공 후 별도 `onProgress` 호출 제거하고 루프 끝의 `onProgress`만 사용

---

**파일**: `src/chat-view.ts`

**함수**: `handleSend()`

**변경사항 7 - 메시지 변이 방지**:
1. `lastMsg.content = contextPrefix + text` 대신 `generateResponse()`에 컨텍스트 접두사를 별도 파라미터로 전달
2. 또는 `generateResponse()` 내부에서 API 호출 시에만 컨텍스트를 주입하고 `this.messages`는 원본 유지

---

**파일**: `src/token-trimmer.ts`

**함수**: `estimateTokens()`

**변경사항 8 - 토큰 추정 통일**:
1. `JSON.stringify(messages).length / 4`를 `JSON.stringify(messages).length / 2.5`로 변경
2. 상수로 추출: `const CHARS_PER_TOKEN = 2.5`

---

**파일**: `src/main.ts`

**함수**: `loadSessions()`, `saveSessions()`

**변경사항 9 - session-recovery.ts 활용**:
1. `session-recovery.ts`에서 `loadSessionsWithRecovery`, `saveSessionsWithBackup` import
2. Obsidian Vault API를 `FileAdapter` 인터페이스에 맞게 어댑터 생성
3. `loadSessions()`와 `saveSessions()`가 해당 함수를 호출하도록 리팩토링

---

**파일**: `src/obsidian-tools.ts`

**함수**: `createNote()`

**변경사항 10 - 부모 폴더 자동 생성**:
1. `applyTemplate()`, `moveFile()`과 동일한 패턴으로 부모 폴더 확인/생성 로직 추가
2. `path.lastIndexOf("/")`로 디렉토리 경로 추출 후 `createFolder()` 호출

---

**파일**: `src/chat-view.ts`

**함수**: `addFileContext()`

**변경사항 11 - 파일 확장자 허용 목록 확장**:
1. `file.extension !== "md"` 조건을 허용 목록 기반으로 변경
2. 허용 확장자: `md`, `txt`, `json`, `yaml`, `yml`, `csv`, `xml`, `html`, `css`, `js`, `ts`

---

**파일**: `package.json`

**변경사항 12 - AWS SDK 버전 통일**:
1. `@aws-sdk/client-bedrock-runtime`의 버전을 `^3.997.0`으로 변경

## 테스트 전략 (Testing Strategy)

### 검증 접근법

테스트 전략은 두 단계로 진행합니다: 먼저 수정 전 코드에서 버그를 재현하는 반례(counterexample)를 확인하고, 수정 후 올바른 동작과 기존 동작 보존을 검증합니다.

### 탐색적 결함 조건 확인 (Exploratory Fault Condition Checking)

**목표**: 수정 전 코드에서 버그를 재현하여 근본 원인 분석을 확인/반박합니다. 반박되면 재분석이 필요합니다.

**테스트 계획**: 각 버그 조건을 트리거하는 테스트를 작성하고 수정 전 코드에서 실행하여 실패를 관찰합니다.

**테스트 케이스**:
1. **ToolConfirmModal 테스트**: `confirmToolExecution=true`에서 `edit_note` 호출 시 모달 표시 여부 확인 (수정 전 실패)
2. **clearChat() 상태 테스트**: 파일 첨부 후 `clearChat()` 호출 시 `attachedFiles.size` 확인 (수정 전 실패)
3. **onClose() 리스너 테스트**: 드롭다운 열린 상태에서 `onClose()` 후 document 리스너 존재 여부 확인 (수정 전 실패)
4. **진행률 역행 테스트**: 재시도 성공 시나리오에서 `onProgress` 값의 단조 증가 확인 (수정 전 실패)
5. **메시지 변이 테스트**: 첨부 파일 있는 메시지 전송 후 `this.messages` 원본 content 확인 (수정 전 실패)
6. **토큰 추정 테스트**: `estimateTokens()`와 `updateContextRing()`의 토큰 비율 비교 (수정 전 불일치)

**예상 반례**:
- ToolConfirmModal이 호출되지 않고 도구가 즉시 실행됨
- `clearChat()` 후 `attachedFiles.size > 0`
- `onClose()` 후 document에 `handleDropdownOutsideClick` 리스너 잔존
- 재시도 성공 후 `onProgress(n, total)`에서 n이 이전 호출보다 작음

### 수정 확인 (Fix Checking)

**목표**: 버그 조건이 성립하는 모든 입력에서 수정된 함수가 기대 동작을 생성하는지 검증합니다.

**의사코드:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
```

### 보존 확인 (Preservation Checking)

**목표**: 버그 조건이 성립하지 않는 모든 입력에서 수정된 함수가 원본 함수와 동일한 결과를 생성하는지 검증합니다.

**의사코드:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**테스트 접근법**: 속성 기반 테스트(Property-Based Testing)를 보존 확인에 권장합니다:
- 입력 도메인 전체에 걸쳐 많은 테스트 케이스를 자동 생성
- 수동 단위 테스트가 놓칠 수 있는 엣지 케이스 포착
- 비버그 입력에 대한 동작 불변성을 강력하게 보장

**테스트 계획**: 수정 전 코드에서 비버그 입력의 동작을 먼저 관찰한 후, 해당 동작을 캡처하는 속성 기반 테스트를 작성합니다.

**테스트 케이스**:
1. **비파괴적 도구 보존**: `search_vault`, `read_note` 등이 확인 없이 실행되는지 확인
2. **clearChat() 기존 동작 보존**: 메시지 초기화, 환영 메시지, 히스토리 삭제 정상 동작 확인
3. **드롭다운 정상 동작 보존**: 뷰가 열려 있을 때 드롭다운 열기/닫기 정상 동작 확인
4. **credential 모드 보존**: manual, apikey, env 모드에서 클라이언트 생성 정상 동작 확인
5. **MCP 정상 응답 보존**: 타임아웃 전 정상 응답의 resolve/reject 처리 확인
6. **첫 시도 성공 진행률 보존**: 재시도 없는 파일들의 진행률 정상 증가 확인

### 단위 테스트 (Unit Tests)

- ToolConfirmModal 표시/승인/거부 시나리오 테스트
- clearChat() 호출 후 모든 상태 변수 초기화 확인
- onClose() 호출 후 이벤트 리스너 해제 확인
- buildClientConfig() 헬퍼의 세 가지 credential 모드 출력 확인
- handleJsonMessage()의 늦은 응답 로깅 확인
- indexVault() 진행률 단조 증가 확인
- handleSend() 원본 메시지 불변성 확인
- estimateTokens() 토큰 비율 일관성 확인
- createNote() 중첩 경로 폴더 자동 생성 확인
- addFileContext() 허용 확장자 목록 확인

### 속성 기반 테스트 (Property-Based Tests)

- 임의의 도구 이름과 설정 조합에서 파괴적/비파괴적 분류 정확성 검증
- 임의의 첨부 파일 상태에서 clearChat() 후 완전 초기화 검증
- 임의의 credential 설정에서 buildClientConfig() 출력 일관성 검증
- 임의의 파일 목록과 실패/재시도 시나리오에서 진행률 단조 증가 검증
- 임의의 메시지와 컨텍스트에서 원본 메시지 불변성 검증
- 임의의 텍스트에서 estimateTokens()와 updateContextRing() 토큰 추정 일관성 검증
- 임의의 파일 경로에서 addFileContext() 확장자 필터링 정확성 검증

### 통합 테스트 (Integration Tests)

- 파괴적 도구 실행 → 모달 표시 → 승인 → 실행 완료 전체 흐름
- 파일 첨부 → 메시지 전송 → clearChat() → 새 대화 시작 전체 흐름
- 세션 저장 → 앱 종료 → 세션 로드 → 복구 전체 흐름
- 볼트 인덱싱 → 실패 → 재시도 → 완료 전체 흐름
- 중첩 경로 노트 생성 → 폴더 자동 생성 → 노트 확인 전체 흐름
