# 태스크: Bedrock Assistant 플러그인 개선

> 우선순위 순서대로 정렬. 보완(안정성/성능) → 신규 기능(실용성 높은 순) 순서.

---

## Phase 1: 안정성 & 성능 (Critical)

- [x] Task 1: 스트리밍 렌더링 디바운싱 적용 (REQ-1)
  - `src/chat-view.ts`의 `generateResponse()` 내 `onTextDelta` 콜백 수정
  - `requestAnimationFrame` 기반 디바운싱으로 렌더링 횟수 최소화
  - 스트리밍 중에는 raw text로 빠르게 표시, 완료 후 마크다운 렌더링
  - 테스트: 긴 응답(2000자 이상) 생성 시 UI 버벅임 없는지 확인

- [x] Task 2: 파괴적 도구 실행 전 확인 모달 (REQ-2)
  - `src/types.ts`에 `confirmToolExecution: boolean` 설정 추가 (기본값: `true`)
  - `src/chat-view.ts`에 `ToolConfirmModal` 클래스 구현
  - `executeAndRenderTool()`에서 파괴적 도구(`edit_note`, `delete_file`, `move_file`, `create_note`) 실행 전 모달 표시
  - `src/settings-tab.ts`에 확인 토글 UI 추가 (I18N 포함)
  - 테스트: AI가 파일 삭제 요청 시 확인 모달이 뜨는지, 거부 시 도구가 실행되지 않는지 확인

- [x] Task 3: 대화 히스토리 토큰 트리밍 (REQ-3)
  - `src/chat-view.ts`의 `generateResponse()`에서 API 호출 전 토큰 추정
  - 컨텍스트 윈도우 80% 초과 시 오래된 메시지부터 제거
  - 최소 마지막 user+assistant 메시지 쌍은 유지
  - 테스트: 매우 긴 대화 후에도 API 에러 없이 응답 생성되는지 확인

- [x] Task 4: 도구 실행 루프 연속 실패 조기 중단 (REQ-4)
  - `src/chat-view.ts`의 `generateResponse()` 도구 루프에 `consecutiveFailures` 카운터 추가
  - 3회 연속 실패 시 루프 중단 + 사용자 안내 메시지
  - 테스트: 존재하지 않는 도구를 반복 호출하는 시나리오에서 루프가 중단되는지 확인

- [x] Task 5: 인덱서 동시성 보호 (REQ-5)
  - `src/vault-indexer.ts`에 `pendingFiles: Set<string>` 추가
  - `indexing === true`일 때 `indexFile()` 호출 시 큐잉 후 즉시 리턴
  - `indexVault()` 완료 후 큐에 남은 파일 순차 처리
  - 테스트: 인덱싱 중 파일 수정 시 에러 없이 처리되는지 확인

---

## Phase 2: UX 개선 (High)

- [x] Task 6: 대화 내보내기 기능 (REQ-7)
  - `src/chat-view.ts` 헤더에 내보내기 아이콘 버튼 추가 (`download` 아이콘)
  - `exportChat()` 메서드 구현: 메시지 → 마크다운 변환 → 볼트에 저장
  - 파일명: `Chat Export YYYY-MM-DD HH-mm.md`
  - I18N 키 추가 (en/ko)
  - 테스트: 대화 후 내보내기 버튼 클릭 시 마크다운 노트가 생성되는지 확인

- [x] Task 7: 메시지 재생성 기능 (REQ-8)
  - 어시스턴트 메시지 footer에 재생성 버튼 추가 (`refresh-cw` 아이콘)
  - `regenerateLastResponse()` 메서드 구현
  - 마지막 어시스턴트 메시지 제거 후 `generateResponse()` 재호출
  - 스트리밍 중 버튼 비활성화
  - 테스트: 재생성 버튼 클릭 시 이전 응답이 교체되는지 확인

- [x] Task 8: 대화 검색 기능 (REQ-10)
  - `src/chat-view.ts`의 `SessionListModal` 상단에 검색 입력 필드 추가
  - 세션 제목 + 첫 메시지 내용으로 실시간 필터링
  - 검색어 하이라이트
  - 테스트: 10개 이상 세션에서 키워드 검색이 정상 동작하는지 확인

- [x] Task 9: MCP 도구 타임아웃 설정 (REQ-6)
  - `src/types.ts`에 `mcpTimeout: number` 추가 (기본값: 30)
  - `src/mcp-client.ts`의 `sendRequest()`에서 설정값 사용
  - `src/settings-tab.ts` MCP 섹션에 타임아웃 슬라이더 추가 (10~120초)
  - I18N 키 추가
  - 테스트: 타임아웃 값 변경 후 MCP 도구 호출 시 적용되는지 확인

---

## Phase 3: 안정성 보강 (Medium)

- [x] Task 10: 세션 파일 손상 복구 (REQ-11)
  - `src/main.ts`의 `saveSessions()`에서 저장 전 `.bak` 백업 생성
  - `loadSessions()`에서 파싱 실패 시 `.bak`에서 복구 시도
  - 복구 성공/실패 시 `Notice` 알림
  - 테스트: 세션 파일을 의도적으로 손상시킨 후 복구되는지 확인

- [x] Task 11: 인덱싱 백그라운드 진행률 표시 (REQ-12)
  - `src/main.ts`에서 `addStatusBarItem()`으로 상태바 아이템 등록
  - `indexVault()` 호출 시 상태바에 "인덱싱 중... N%" 표시
  - 완료 후 3초 뒤 상태바 텍스트 제거
  - 테스트: 사이드바 닫힌 상태에서 인덱싱 시 상태바에 진행률이 표시되는지 확인

---

## Phase 4: 신규 기능 (Nice to Have)

- [~] Task 12: 시스템 프롬프트 프리셋 (REQ-9)
  - `src/types.ts`에 `PromptPreset` 인터페이스, `promptPresets`, `activePresetId` 추가
  - 기본 프리셋 3개 정의 (기본 어시스턴트, 번역가, 코드 리뷰어)
  - `src/settings-tab.ts`에 프리셋 관리 UI (추가/편집/삭제)
  - `src/chat-view.ts` 헤더에 프리셋 전환 드롭다운
  - I18N 키 추가
  - 테스트: 프리셋 전환 시 시스템 프롬프트가 변경되고 AI 응답 스타일이 달라지는지 확인

- [~] Task 13: 이미지 생성 지원 (REQ-13)
  - `src/bedrock-client.ts`에 `generateImage()` 메서드 추가 (Titan Image Generator)
  - `src/obsidian-tools.ts`에 `generate_image` 도구 정의 및 실행 로직
  - 생성된 이미지를 볼트에 저장 후 `![[image.png]]` 형태로 응답에 포함
  - `src/chat-view.ts`에서 이미지 인라인 표시
  - 테스트: "고양이 그림 그려줘" 요청 시 이미지가 생성되어 볼트에 저장되는지 확인
