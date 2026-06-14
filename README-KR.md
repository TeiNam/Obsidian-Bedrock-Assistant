# Assistant Kiro

[English](README.md) | [한국어](README-KR.md) | [日本語](README-JA.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-CI/CD-2088FF.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://qr.kakaopay.com/Ej74xpc815dc06149)

**AWS Bedrock** 기반의 Obsidian AI 어시스턴트 사이드바 플러그인입니다.
AI 기반 IDE인 [Kiro](https://kiro.dev)로 개발·유지보수됩니다.

## 주요 기능

- **AWS Bedrock 백엔드** — AWS Bedrock (Claude) 모델 기반
- **스트리밍 채팅** — 사이드바에서 실시간 스트리밍 응답
- **볼트 시맨틱 검색** — 임베딩(Titan / Gemini)으로 노트를 인덱싱하고 의미 기반 검색
- **태그 자동 생성** — 노트 내용을 분석하여 태그 자동 추천
- **To-Do 관리** — 템플릿 기반 일일 To-Do 생성, 미완료 항목 자동 승계 (계층 구조 유지), 아카이브
- **아카이브 비우기** — 설정 탭에서 오래된 아카이브 파일 정리
- **P.A.R.A 환경 설정** — P.A.R.A 폴더 구조(Projects, Areas, Resources, Archives)를 설정하고 AI로 기존 노트를 자동 분류
- **웹 클리퍼** — URL로 웹 페이지를 가져와 AI로 번역/요약 후 마크다운 노트로 저장
- **MCP 서버 연동** — Model Context Protocol 서버 연결 (uvx, Docker)
- **파일 관리** — AI 도구 호출을 통한 노트 생성/수정/이동/삭제
- **다국어 지원** — 한국어 / English / 日本語
- **파일 첨부** — 드래그앤드롭, 클립보드, 파일 검색, 이미지/PDF 첨부
- **대화 세션 관리** — 지난 대화 저장/복원 및 검색
- **일일 회고** — To-Do 기반 AI 일일 회고 생성
- **채팅 회고 명령** — 채팅에 "회고", "retrospective", "振り返り" 입력 시 자동으로 회고 생성
- **대화 내보내기** — 대화를 마크다운 파일로 내보내기
- **대화 검색** — 저장된 대화 세션 검색
- **MCP JSON 에디터** — 실시간 검증, 자동 포맷팅, 괄호 매칭, 템플릿 삽입
- **컨텍스트 윈도우 표시** — 토큰 사용량을 시각적 링으로 표시
- **Obsidian 스킬** — 시스템 프롬프트에 Obsidian 전용 지식 (Dataview, Tasks, Templater) 추가
- **파괴적 도구 실행 확인** — 파일 수정 작업 전 선택적 확인 대화상자

## 설치

### BRAT (권장)

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat) 플러그인 설치
2. BRAT 설정에서 이 레포지토리 URL 추가
3. 플러그인 활성화

### 수동 설치

1. [Releases](../../releases) 페이지에서 최신 버전의 `main.js`, `styles.css`, `manifest.json` 다운로드
2. 볼트의 `.obsidian/plugins/assistant-kiro/` 폴더에 복사
3. 설정 → 커뮤니티 플러그인에서 활성화

## 빠른 시작

1. 설정 → Assistant Kiro 설정 열기
2. AI 백엔드 선택 (Gemini 또는 Bedrock)
3. 자격증명 입력:
   - **Gemini**: [Google AI Studio](https://aistudio.google.com/apikey)에서 발급받은 API 키 입력
   - **Bedrock**: AWS Access Key, Secret Key, Region 입력
4. 왼쪽 리본의 Assistant Kiro 아이콘을 클릭하여 사이드바 열기
5. 대화 시작!

## AI 백엔드 설정

### 백엔드 전환

설정 → Assistant Kiro 설정 → AI 백엔드 드롭다운에서 전환합니다. 전환 즉시 사이드바 아이콘, 브랜딩, 모델 목록이 업데이트됩니다. 각 백엔드의 자격증명은 독립적으로 저장됩니다.

### Google Gemini

| 설정 | 설명 |
|------|------|
| API Key | [Google AI Studio](https://aistudio.google.com/apikey)에서 발급받은 Gemini API 키 |
| 채팅 모델 | 사용 가능한 Gemini 모델 선택 (드롭다운) |
| 임베딩 모델 | 볼트 인덱싱용 모델 (기본값: `text-embedding-004`) |

### AWS Bedrock

| 설정 | 설명 |
|------|------|
| Access Key ID | AWS IAM 액세스 키 |
| Secret Access Key | AWS IAM 시크릿 키 |
| Region | AWS 리전 (예: `us-east-1`) |
| 채팅 모델 | 사용 가능한 Bedrock 모델 선택 (드롭다운) |
| 임베딩 모델 | 볼트 인덱싱용 모델 (기본값: `amazon.titan-embed-text-v2:0`) |

#### 필요 IAM 권한

```
bedrock:InvokeModelWithResponseStream
bedrock:InvokeModel
bedrock:ListFoundationModels
```

## 사용 가이드

### 채팅

- 메시지를 입력하고 Enter로 전송 (Shift+Enter로 줄바꿈)
- AI가 스트리밍으로 응답하며, 마크다운으로 렌더링됩니다
- 재생성 버튼으로 다른 응답을 받을 수 있습니다
- Escape 키로 생성 중 중단 가능

### 파일 첨부

| 방법 | 설명 |
|------|------|
| 자동 첨부 | 현재 열린 노트가 자동으로 컨텍스트에 포함 (설정에서 토글) |
| 수동 첨부 | 입력 툴바의 파일 추가 또는 검색 아이콘 클릭 |
| 드래그 앤 드롭 | 파일을 입력 영역에 직접 드래그 |
| 클립보드 붙여넣기 | 스크린샷이나 이미지를 클립보드에서 붙여넣기 |
| 바이너리 파일 | 클립 아이콘으로 이미지 (PNG, JPG, GIF, WebP) 및 PDF 첨부 |

### 볼트 인덱싱

1. 사이드바 헤더의 검색 아이콘 클릭 (또는 커맨드 팔레트: "볼트 인덱싱")
2. 모든 마크다운 파일이 임베딩으로 인덱싱됩니다
3. 인덱싱 완료 후 AI가 질문에 답할 때 볼트를 시맨틱 검색할 수 있습니다
4. 파일 수정 시 자동으로 재인덱싱됩니다 (2초 디바운스)

### 태그 생성

1. 에디터에서 노트 열기
2. 사이드바 액션 툴바의 태그 아이콘 클릭
3. AI가 노트를 분석하여 3~5개 태그를 추천
4. 태그가 노트의 프론트매터에 자동 추가됩니다

### To-Do 관리

1. 설정에서 To-Do 폴더와 템플릿 설정
2. 체크 아이콘을 클릭하여 오늘의 To-Do 생성
3. 전일 미완료 항목이 계층 구조를 유지하며 자동 승계
4. 설정된 일수를 초과한 To-Do 파일은 자동 아카이브

### 일일 회고

1. 액션 툴바의 책 아이콘 클릭
2. 오늘 할 일을 모두 끝마쳤는지 확인
3. AI가 회고 요약을 생성하여 오늘의 To-Do에 추가

### 웹 클리퍼

1. 액션 툴바의 지구본 아이콘 클릭
2. URL 입력
3. AI가 페이지를 가져와 번역(필요 시)하고 요약
4. 프론트매터(출처 URL, 날짜, 언어)와 함께 마크다운 노트로 저장

### 아카이브 비우기

1. 설정 → Assistant Kiro 설정 → To-Do 섹션 열기
2. 아카이브 삭제 기준 일수를 설정하고 옆의 비우기 버튼 클릭
3. 기준 일수보다 오래된 파일이 아카이브 폴더에서 삭제 대상으로 표시됩니다

### P.A.R.A 환경 설정

1. 설정 → Assistant Kiro 설정 → 사용자 경험 섹션 열기
2. 환영 인사 아래의 "P.A.R.A 환경 설정하기" 버튼 클릭
3. 볼트 루트에 4개 폴더가 생성됩니다: `01. Projects`, `02. Areas`, `03. Resources`, `04. Archives`
4. 기존 노트가 있으면 현재 설정된 AI 모델이 각 노트를 적절한 폴더로 자동 분류합니다
5. 진행 상황 모달에서 실시간 상태와 완료 시 요약을 확인할 수 있습니다
6. 이미 P.A.R.A 폴더 안에 있는 노트는 자동으로 건너뜁니다

### 웹 서치

입력 툴바의 지구본 버튼을 토글하여 웹 서치를 활성화합니다. 활성화 시 AI가 최신 정보를 웹에서 검색하여 출처 URL과 함께 답변에 포함합니다.

## MCP 서버 설정

설정 탭 → MCP 서버 → 설정 편집에서 JSON 형식으로 설정합니다:

```json
{
  "mcpServers": {
    "fetch": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp/fetch"]
    }
  }
}
```

`uvx` (Python)와 `docker` 명령 모두 지원합니다. GUI 환경에서 명령 경로를 자동으로 탐색합니다. 연결된 서버는 채팅 입력 하단에 상태 인디케이터로 표시됩니다.

## 자격증명 저장

자격증명은 **iCloud 동기화 대상이 아닌 로컬 전용 경로**(`~/Library/Application Support/obsidian/`)에 저장됩니다. 나머지 설정은 `data.json`을 통해 정상 동기화됩니다.

> **참고:** API 키는 기기별로 저장됩니다. iCloud로 볼트를 동기화하는 경우, 각 기기에서 자격증명을 별도로 설정해야 합니다.

## 네트워크 사용

이 플러그인은 다음 외부 서비스에 네트워크 요청을 보냅니다:

- **AWS Bedrock API** — Bedrock 백엔드 사용 시, 채팅/임베딩/모델 목록 조회를 위해 AWS Bedrock 엔드포인트에 요청합니다. 설정된 AWS 리전에 따라 엔드포인트가 결정됩니다 (예: `bedrock-runtime.us-east-1.amazonaws.com`).
- **Google Gemini API** — Gemini 백엔드 사용 시, 채팅/임베딩/모델 목록 조회를 위해 `generativelanguage.googleapis.com`에 요청합니다.
- **웹 클리퍼** — 웹 클리퍼 기능 사용 시, 요약을 위해 대상 URL의 페이지 콘텐츠를 가져옵니다.
- **MCP 서버** — MCP 서버가 설정된 경우, 로컬에서 실행된 MCP 서버 프로세스와 stdio를 통해 통신합니다.

제3자 분석이나 추적 서비스로 데이터를 전송하지 않습니다.

## 데스크톱 전용

이 플러그인은 데스크톱 전용(`isDesktopOnly: true`)입니다. MCP 서버 통합이 로컬 자식 프로세스를 stdio로 생성하는 방식이므로 모바일 플랫폼에서는 사용할 수 없습니다.

## 라이선스

[MIT](LICENSE)
