# 설계: Bedrock Assistant 플러그인 개선

## REQ-1: 스트리밍 렌더링 최적화

### 현재 문제
```
onTextDelta → contentEl.empty() → MarkdownRenderer.render(fullText) (매 델타마다)
```
델타가 수십~수백 번 발생하므로 DOM 전체를 매번 재구성.

### 해결 방안
- `requestAnimationFrame` 기반 디바운싱 적용
- 렌더링 플래그(`renderPending`)로 중복 렌더 방지
- 델타는 `fullText`에 누적만 하고, 다음 프레임에서 한 번만 렌더링
- 스트리밍 중에는 임시 `<pre>` 태그로 빠르게 표시하고, 스트리밍 완료 후 마크다운 렌더링

### 변경 파일
- `src/chat-view.ts`: `generateResponse()` 내 `onTextDelta` 콜백 수정

---

## REQ-2: 파괴적 도구 실행 전 사용자 확인

### 설계
- `types.ts`에 `confirmToolExecution: boolean` 설정 추가 (기본값: `true`)
- `chat-view.ts`에 `ToolConfirmModal` 클래스 추가
  - 도구 이름, 입력 파라미터 표시
  - "실행" / "거부" 버튼
- `executeAndRenderTool()`에서 파괴적 도구 목록 체크 후 모달 표시
- 파괴적 도구 목록: `edit_note`, `delete_file`, `move_file`, `create_note`
- 설정에서 확인 끄기 가능 (고급 사용자용)

### 변경 파일
- `src/types.ts`: 설정 필드 추가
- `src/chat-view.ts`: `ToolConfirmModal`, `executeAndRenderTool()` 수정
- `src/settings-tab.ts`: 토글 UI 추가 (I18N 포함)

---

## REQ-3: 대화 히스토리 토큰 트리밍

### 설계
- `generateResponse()` 시작 시 `converseMessages`의 총 토큰 추정
- 간단한 추정: `JSON.stringify(messages).length / 4` (영어 기준 ~4자/토큰)
- 컨텍스트 윈도우의 80% 초과 시 가장 오래된 메시지부터 제거
- 시스템 프롬프트 + 도구 정의 토큰도 고려 (약 2000~5000 토큰 예약)
- 최소 마지막 2개 메시지(user + assistant)는 유지

### 변경 파일
- `src/chat-view.ts`: `generateResponse()` 내 트리밍 로직 추가

---

## REQ-4: 도구 실행 루프 연속 실패 조기 중단

### 설계
- `generateResponse()` 내 도구 실행 루프에 `consecutiveFailures` 카운터 추가
- 도구 실행 결과가 에러 문자열(접두사 "도구 실행 오류" 또는 "Tool execution error")이면 카운터 증가
- 성공하면 카운터 리셋
- 3회 연속 실패 시 루프 중단, 사용자에게 안내 메시지 표시

### 변경 파일
- `src/chat-view.ts`: `generateResponse()` 수정

---

## REQ-5: 인덱서 동시성 보호

### 설계
- `VaultIndexer`에 `pendingFiles: Set<string>` 추가
- `indexing === true`일 때 `indexFile()` 호출 시 `pendingFiles`에 경로 추가 후 즉시 리턴
- `indexVault()` 완료 후 `pendingFiles`에 남은 파일들을 순차 처리

### 변경 파일
- `src/vault-indexer.ts`: `indexFile()`, `indexVault()` 수정

---

## REQ-6: MCP 도구 타임아웃 설정

### 설계
- `types.ts`에 `mcpTimeout: number` 설정 추가 (기본값: 30, 단위: 초)
- `McpServerConnection.sendRequest()`에서 설정값 사용
- `McpManager`에 `setTimeout()` 메서드 추가
- 설정 탭 MCP 섹션에 타임아웃 슬라이더 추가

### 변경 파일
- `src/types.ts`, `src/mcp-client.ts`, `src/settings-tab.ts`, `src/main.ts`

---

## REQ-7: 대화 내보내기

### 설계
- 헤더에 "내보내기" 아이콘 버튼 추가 (`download` 아이콘)
- 클릭 시 현재 `this.messages`를 마크다운 포맷으로 변환
- 포맷: `## User\n내용\n\n## Assistant\n내용\n\n---\n`
- 파일명: `Chat Export YYYY-MM-DD HH-mm.md`
- 저장 위치: 볼트 루트 (또는 설정 가능)
- 저장 후 `Notice`로 알림

### 변경 파일
- `src/chat-view.ts`: `buildHeader()`, `exportChat()` 메서드 추가

---

## REQ-8: 메시지 재생성

### 설계
- 어시스턴트 메시지 하단 footer에 "재생성" 버튼 추가 (`refresh-cw` 아이콘)
- 클릭 시:
  1. 마지막 어시스턴트 메시지를 `this.messages`에서 제거
  2. 해당 DOM 요소 제거
  3. `generateResponse()` 재호출
- 스트리밍 중에는 버튼 비활성화

### 변경 파일
- `src/chat-view.ts`: `generateResponse()` footer 영역, `regenerateLastResponse()` 메서드 추가

---

## REQ-9: 시스템 프롬프트 프리셋

### 설계
- `types.ts`에 `PromptPreset` 인터페이스 추가 (`id`, `name`, `prompt`)
- `types.ts`에 `promptPresets: PromptPreset[]`, `activePresetId: string` 설정 추가
- 기본 프리셋 3개: 기본 어시스턴트, 번역가, 코드 리뷰어
- 설정 탭에 프리셋 관리 UI (추가/편집/삭제)
- 채팅 뷰 헤더에 프리셋 전환 드롭다운

### 변경 파일
- `src/types.ts`, `src/settings-tab.ts`, `src/chat-view.ts`

---

## REQ-10: 대화 검색

### 설계
- `SessionListModal`을 `FuzzySuggestModal<ChatSession>`으로 변경
- 또는 기존 모달 상단에 검색 입력 필드 추가
- 세션 제목 + 첫 메시지 내용으로 필터링
- 실시간 필터링 (keyup 이벤트)

### 변경 파일
- `src/chat-view.ts`: `SessionListModal` 수정

---

## REQ-11: 세션 파일 손상 복구

### 설계
- `saveSessions()` 시 기존 파일을 `.bak` 확장자로 백업
- `loadSessions()`에서 JSON 파싱 실패 시 `.bak` 파일에서 복구 시도
- 복구 성공 시 `Notice`로 알림

### 변경 파일
- `src/main.ts`: `loadSessions()`, `saveSessions()` 수정

---

## REQ-12: 인덱싱 백그라운드 진행률

### 설계
- `main.ts`에서 옵시디언 상태바 아이템 등록 (`addStatusBarItem()`)
- `indexVault()` 호출 시 상태바에 진행률 표시
- 완료 후 3초 뒤 상태바 텍스트 제거

### 변경 파일
- `src/main.ts`: 상태바 아이템 추가
- `src/vault-indexer.ts`: `onProgress` 콜백 활용

---

## REQ-13: 이미지 생성 지원

### 설계
- `bedrock-client.ts`에 `generateImage()` 메서드 추가
- Titan Image Generator G1 v2 또는 Stability AI SDXL 사용
- 생성된 이미지를 base64 → ArrayBuffer → 볼트에 저장
- `obsidian-tools.ts`에 `generate_image` 도구 추가
- 채팅 뷰에서 이미지 인라인 표시

### 변경 파일
- `src/bedrock-client.ts`, `src/obsidian-tools.ts`, `src/chat-view.ts`
