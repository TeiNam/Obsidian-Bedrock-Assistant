# Bedrock Assistant

[English](README.md) | [한국어](README-KR.md) | [日本語](README-JA.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4.svg)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT-412991.svg)
![Ollama](https://img.shields.io/badge/Ollama-Local-000000.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![카카오페이 후원](https://img.shields.io/badge/카카오페이-후원하기-FFCD00?style=for-the-badge&logo=kakaotalk&logoColor=black)](https://qr.kakaopay.com/Ej74xpc815dc06149)

AWS Bedrock, Google Gemini, OpenAI, Ollama 멀티 프로바이더 백엔드를 지원하는 Obsidian AI 어시스턴트 사이드바 플러그인입니다.

## 주요 기능

- **멀티 프로바이더 AI 백엔드** — 설정에서 AWS Bedrock (Claude), Google Gemini, OpenAI, Ollama를 전환
- **스트리밍 채팅** — 사이드바에서 실시간 스트리밍 응답
- **Graph RAG 검색** — 노트를 청크 단위로 임베딩하고, 링크(아웃링크·백링크)를 따라 이웃 노트까지 확장하여 검색
- **Second Brain Layer (옵트인, 기본 꺼짐)** — 검색된 노트를 근거로 위키 노트를 생성·갱신하고, 사고 도구(challenge/connect/emerge/reconcile)로 노트를 읽기만 하는 분석 수행
- **지식 공백 리포트** — 끊긴 링크·빈 노트·고아 노트를 인덱스 데이터로 계산해 리포트로 기록 (LLM 호출 없음)
- **복습 큐** — 오래 열지 않았지만 링크가 많은 노트 5건 제시 (LLM 호출 없음)
- **대화 결론 수확** — 세션에서 결론·결정·근거만 추출해 볼트 노트로 저장 (원본 대화는 저장하지 않음)
- **회고 체인** — 일일 회고 생성 시 최근 7일 회고를 함께 입력해 반복 문제를 추적
- **추론 강도(Effort) 설정** — 지원 모델에 대해 추론 깊이를 조절
- **태그 자동 생성** — 노트 내용을 분석하여 태그 추천
- **템플릿** — 변수 치환을 지원하는 커스텀 템플릿
- **To-Do 관리** — 일일 To-Do 생성, 미완료 항목 자동 승계, 아카이브
- **아카이브 비우기** — 설정 탭에서 오래된 아카이브 파일 정리
- **P.A.R.A 환경 설정** — P.A.R.A 폴더 구조(Projects, Areas, Resources, Archives)를 만들고 AI로 기존 노트를 자동 분류
- **웹 클리퍼** — URL로 웹 페이지를 가져와 번역/요약 후 마크다운 노트로 저장
- **웹 서치 토글** — Gemini 백엔드의 Google Search grounding 또는 검색 MCP를 이용한 웹 검색
- **MCP 서버 연동** — Model Context Protocol 서버 (uvx, Docker 지원)
- **파일 관리** — AI를 통한 노트 생성/수정/이동/삭제
- **다국어 지원** — English, 한국어, 日本語
- **파일 첨부** — 드래그앤드롭, 클립보드, 파일 검색 (이미지, PDF, 텍스트)
- **대화 세션 관리** — 지난 대화 저장/복원 (최대 50개)
- **Obsidian 스킬** — AI가 Obsidian 문법과 글쓰기 규칙을 정확히 따르도록 하는 지식 모듈 6종 제공
- **채팅 회고 명령** — 채팅에 "회고", "retrospective", "振り返り" 입력 시 일일 회고 생성
- **대화 내보내기** — 대화를 마크다운 파일로 내보내기
- **응답 재생성** — 마지막 AI 응답을 재생성
- **대화 검색** — 저장된 대화 세션 검색
- **MCP JSON 에디터** — 실시간 검증, 자동 포맷팅, 괄호 매칭, 템플릿 삽입
- **파괴적 도구 확인** — 파일 작업 전 선택적 확인 대화상자
- **컨텍스트 윈도우 관리** — 자동 토큰 트리밍

## 설치

### BRAT (권장)

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat) 플러그인 설치
2. BRAT 설정에서 레포지토리 URL 추가: `https://github.com/teinam/obsidian-bedrock-assistant`
3. 플러그인 활성화

### 수동 설치

1. [Releases](../../releases) 페이지에서 `main.js`, `styles.css`, `manifest.json` 다운로드
2. 볼트의 `.obsidian/plugins/bedrock-assistant/` 폴더에 복사
3. 설정 → 커뮤니티 플러그인에서 활성화

## 빠른 시작

### 1. AI 백엔드 선택

설정 → Bedrock Assistant → **AI 백엔드**:

- **Bedrock** — AWS Bedrock (Claude, GPT 등). 액세스 키 / Bedrock API 키 / `~/.aws` 공유 프로필 중 하나로 인증합니다.
- **Gemini** — Google Gemini. [Google AI Studio](https://aistudio.google.com/)에서 API 키 발급 필요.
- **OpenAI** — OpenAI API 키 필요. Base URL을 지정하면 OpenAI 호환 엔드포인트도 사용할 수 있습니다.
- **Ollama** — 로컬 Ollama 서버. 비우면 `http://localhost:11434`를 사용합니다.

백엔드를 전환하면 사이드바 아이콘, 모델 목록, 브랜딩이 자동으로 변경됩니다.

### 2. 자격증명 설정

**Bedrock:** 인증 방식을 선택한 뒤 해당 값과 리전을 입력합니다.

| 인증 방식 | 입력 항목 |
|-----------|-----------|
| 액세스 키 | AWS Access Key ID, Secret Access Key |
| Bedrock API 키 | 장기 베어러 토큰 |
| 공유 프로필 | `~/.aws`의 프로필 이름 (`aws sso login` 결과 포함) |

필요 IAM 권한:
- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

**Gemini:** [Google AI Studio](https://aistudio.google.com/)에서 발급받은 API 키를 입력합니다.

**OpenAI:** API 키를 입력합니다. Base URL은 선택 항목이며, 비우면 공식 엔드포인트(`https://api.openai.com/v1`)를 사용합니다.

**Ollama:** 서버 Base URL을 입력합니다. 비우면 `http://localhost:11434`를 사용합니다.

> **참고:** 자격증명은 OS 키체인 암호화를 사용하여 각 기기에 로컬로만 저장되며, iCloud를 통해 동기화되지 않습니다. 각 기기에서 별도로 설정해야 합니다.

### 3. 모델 선택

설정 → **모델**에서 채팅 모델과 임베딩 모델을 선택합니다. 목록은 현재 백엔드에서 조회하며, 임베딩 모델은 기본값이 없으므로 Graph RAG 검색을 쓰려면 직접 선택해야 합니다.

### 4. 사이드바 열기

리본 아이콘을 클릭하거나 커맨드 팔레트에서 **"어시스턴트 열기"**를 실행합니다.

### 5. 볼트 인덱싱 (선택)

채팅 헤더의 인덱싱 버튼을 클릭하거나 커맨드 **"볼트 인덱싱"**을 실행하면 Graph RAG 검색용 인덱스를 만듭니다.

## 사용법

### 채팅

입력창에 메시지를 입력하고 Enter를 누르면 AI가 실시간 스트리밍으로 응답합니다. 입력창 툴바에서 노트와 파일을 컨텍스트로 첨부할 수 있습니다:

- 현재 노트 첨부
- 파일 검색하여 첨부
- 이미지/PDF를 파일 선택, 드래그앤드롭, 클립보드 붙여넣기로 첨부

**웹 서치 토글** — 입력창 툴바의 지구본 아이콘으로 켭니다. Gemini 백엔드(Google Search grounding)를 쓰고 있거나 검색 MCP(`fetch`, `exa`, `brave` 중 하나)가 연결돼 있어야 하며, 둘 다 없으면 안내만 표시되고 켜지지 않습니다.

### 추론 강도 (Effort)

설정 → 생성 설정 → **추론 강도 (Effort)** 에서 모델의 추론 깊이를 조절합니다. 지원 모델에서는 temperature 대신 이 값을 사용하고, 미지원 모델에서는 요청에서 생략되어 공급자 기본 샘플링 설정이 적용됩니다(그 경우 항목 자체가 표시되지 않습니다). 허용 값은 백엔드와 모델에 따라 다릅니다(예: Gemini Pro 계열은 low/high만 지원). 백엔드나 모델을 바꾸면 저장된 값이 새 모델이 허용하는 값 중 가장 가까운 값으로 자동 보정됩니다.

### Graph RAG 볼트 검색

노트를 청크로 나눠 임베딩하고, 검색된 노트의 링크(아웃링크·백링크)를 따라 이웃까지 확장해
관련 노트를 찾습니다. 사이드바 헤더의 검색 아이콘 또는 커맨드 `볼트 인덱싱`으로 인덱싱을 시작합니다.
파일을 수정하면 자동으로 다시 인덱싱됩니다.

상세: [Graph RAG & Second Brain](docs/second-brain-kr.md)

### Second Brain Layer (LLM Wiki)

검색된 노트를 근거로 위키 노트를 만들고 관리하는 계층입니다. **기본적으로 꺼져 있으며**
설정 → Second Brain에서 직접 활성화해야 동작합니다.

- 읽기 전용 도구(challenge·connect·emerge·reconcile)는 노트를 만들지 않고 분석 결과만 돌려줍니다.
- 생성 도구(synthesize·architect 등)는 지정한 Wiki 폴더 안에만 씁니다.
- 생성 영역은 `<!-- @generated:KEY -->` 마커로 감싸여 있어, 다시 생성해도 **같은 노트에 직접 적은 메모는 그대로 유지됩니다**.

상세: [Graph RAG & Second Brain](docs/second-brain-kr.md)

### 웹 클리퍼

입력창 위 액션 툴바의 지구본 아이콘 클릭 → URL 입력. 웹 페이지를 가져와 번역(필요 시)하고 요약하여 마크다운 노트로 저장합니다. 프론트매터에는 `source`, `created`, `type: web-clip`, `tags: [web-clip]` 네 항목이 들어갑니다.

### To-Do & 아카이브

- **To-Do 생성**: `{{date}}` / `{{prevDate}}` 변수를 지원하는 템플릿으로 일일 노트 생성
- **미완료 승계**: 전일 미완료 항목을 계층 구조를 유지하며 자동 승계
- **자동 아카이브**: 오래된 To-Do 파일을 아카이브 폴더로 이동
- **아카이브 비우기**: 설정 탭에서 기준 일수를 설정하고 오래된 아카이브 파일 삭제 (폴더 및 기준 일수 설정 가능)

### P.A.R.A 환경 설정

1. 설정 → Bedrock Assistant → **볼트 관리** 섹션으로 이동
2. 템플릿 폴더 항목 다음에 있는 **"P.A.R.A 설정하기"** 버튼 클릭
3. 볼트 루트에 4개 폴더가 생성됩니다: `01. Projects`, `02. Areas`, `03. Resources`, `04. Archives`
4. 기존 노트가 있으면 현재 설정된 AI 모델이 각 노트를 적절한 폴더로 자동 분류합니다
5. 진행 상황 모달에서 실시간 상태와 완료 시 요약을 확인할 수 있습니다

### Obsidian 스킬

AI가 Obsidian 문법과 글쓰기 규칙을 정확히 따르도록 하는 지식 모듈입니다. 설정 → **스킬**에서 개별로 켜고 끌 수 있으며, 커스텀 스킬을 직접 추가할 수도 있습니다.

기본 제공 6종:

| 스킬 | 내용 |
|------|------|
| Obsidian Markdown | Obsidian 확장 마크다운 문법 |
| Obsidian Bases | `.base` 파일 규격 |
| JSON Canvas | `.canvas` 파일 규격 |
| 사람처럼 글쓰기 (한국어) | 한국어 문체 가이드 |
| 비즈니스 이메일/메신저 글쓰기 (영어) | 영어 비즈니스 커뮤니케이션 |
| Second Brain (LLM Wiki) | Second Brain 노트 작성 규약 |

### MCP 서버 설정

설정 → MCP Servers → Edit Config:

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

`uvx` (Python)와 `docker` 모두 지원합니다.

## 네트워크 사용

이 플러그인은 다음 외부 서비스에 네트워크 요청을 보냅니다:

- **AWS Bedrock API** — Bedrock 백엔드 사용 시, 채팅/임베딩/모델 목록 조회를 위해 AWS Bedrock 엔드포인트에 요청합니다. 설정된 AWS 리전에 따라 엔드포인트가 결정됩니다 (예: `bedrock-runtime.us-east-1.amazonaws.com`).
- **Google Gemini API** — Gemini 백엔드 사용 시, 채팅/임베딩/모델 목록 조회를 위해 `generativelanguage.googleapis.com`에 요청합니다.
- **OpenAI API** — OpenAI 백엔드 사용 시, 채팅/임베딩/모델 목록 조회를 위해 `api.openai.com`에 요청합니다. Base URL을 지정하면 해당 엔드포인트로 요청합니다.
- **Ollama 서버** — Ollama 백엔드 사용 시, 설정된 서버 주소(기본 `http://localhost:11434`)로 요청합니다.
- **웹 클리퍼** — 웹 클리퍼 기능 사용 시, 요약을 위해 대상 URL의 페이지 콘텐츠를 가져옵니다.
- **MCP 서버** — MCP 서버가 설정된 경우, 로컬에서 실행된 MCP 서버 프로세스와 stdio를 통해 통신합니다.

제3자 분석이나 추적 서비스로 데이터를 전송하지 않습니다.

## 데스크톱 전용

이 플러그인은 데스크톱 전용(`isDesktopOnly: true`)입니다. MCP 서버 통합이 로컬 자식 프로세스를 stdio로 생성하는 방식이므로 모바일 플랫폼에서는 사용할 수 없습니다.

## 라이선스

[MIT](LICENSE)
