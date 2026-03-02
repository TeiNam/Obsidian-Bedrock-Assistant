# 요구사항: Bedrock Assistant 플러그인 개선

## 개요
전체 코드 분석 결과를 바탕으로 보완 사항과 신규 기능을 정리한 개선 스펙.
우선순위 순서대로 작업 가능하도록 태스크를 구성한다.

---

## 요구사항 목록

### 보완 (Bug Fix / Hardening)

- REQ-1: 스트리밍 렌더링 최적화 #performance
  - 현재 매 텍스트 델타마다 `contentEl.empty()` → `MarkdownRenderer.render()` 전체 재렌더링
  - 긴 응답에서 심각한 성능 저하 발생 가능
  - 디바운싱 또는 부분 렌더링으로 개선 필요
  - 파일: `src/chat-view.ts` (`generateResponse`)

- REQ-2: 파괴적 도구 실행 전 사용자 확인 #safety
  - `edit_note`, `delete_file`, `move_file` 등 파괴적 도구가 확인 없이 즉시 실행됨
  - AI가 잘못 판단하면 데이터 유실 위험
  - 실행 전 확인 모달 또는 토글 옵션 필요
  - 파일: `src/chat-view.ts`, `src/obsidian-tools.ts`, `src/types.ts`

- REQ-3: 대화 히스토리 토큰 트리밍 #stability
  - `converseMessages` 배열이 무한히 커질 수 있음
  - 컨텍스트 윈도우(200K) 초과 시 API 에러 발생
  - 오래된 메시지를 자동으로 트리밍하는 로직 필요
  - 파일: `src/chat-view.ts` (`generateResponse`)

- REQ-4: 도구 실행 루프 연속 실패 조기 중단 #stability
  - 도구 실행 중 에러가 발생해도 루프가 계속 진행됨
  - 연속 N회 실패 시 루프를 조기 중단하는 안전장치 필요
  - 파일: `src/chat-view.ts` (`generateResponse`)

- REQ-5: 인덱서 동시성 보호 #stability
  - `indexVault()` 진행 중 파일 변경 이벤트로 `indexFile()`이 동시 호출 가능
  - 인덱싱 중에는 개별 파일 인덱싱을 큐잉하거나 스킵하는 로직 필요
  - 파일: `src/vault-indexer.ts`

- REQ-6: MCP 도구 타임아웃 설정 가능 #ux
  - 현재 30초 고정 타임아웃
  - 느린 도구(DB 쿼리 등)에서 타임아웃 발생 가능
  - 설정에서 타임아웃 조절 가능하게 변경
  - 파일: `src/mcp-client.ts`, `src/types.ts`, `src/settings-tab.ts`

### 신규 기능

- REQ-7: 대화 내보내기 (Export to Note) #feature
  - 현재 대화를 마크다운 노트로 내보내기
  - 헤더 버튼 또는 메뉴에서 실행
  - 파일: `src/chat-view.ts`

- REQ-8: 메시지 재생성 (Regenerate) #feature
  - AI 응답을 삭제하고 다시 생성하는 기능
  - 응답 하단에 재생성 버튼 추가
  - 파일: `src/chat-view.ts`

- REQ-9: 시스템 프롬프트 프리셋 #feature
  - 용도별 시스템 프롬프트를 프리셋으로 저장/전환
  - 번역가, 코드 리뷰어, 글쓰기 도우미 등
  - 파일: `src/types.ts`, `src/settings-tab.ts`, `src/chat-view.ts`

- REQ-10: 대화 검색 #feature
  - 세션 목록에서 키워드로 과거 대화 검색
  - `SessionListModal`에 검색 입력 추가
  - 파일: `src/chat-view.ts`

- REQ-11: 세션 파일 손상 복구 #stability
  - 세션 JSON 파일이 손상되면 모든 히스토리 유실
  - 파싱 실패 시 백업 파일에서 복구 시도
  - 파일: `src/main.ts`

- REQ-12: 인덱싱 백그라운드 진행률 표시 #ux
  - 사이드바가 닫혀있어도 옵시디언 상태바에 인덱싱 진행률 표시
  - 파일: `src/chat-view.ts`, `src/main.ts`

- REQ-13: 이미지 생성 지원 (Titan Image / Stability AI) #feature
  - Bedrock의 이미지 생성 모델 연동
  - 생성된 이미지를 볼트에 저장 후 노트에 임베드
  - 파일: `src/bedrock-client.ts`, `src/chat-view.ts`, `src/obsidian-tools.ts`
