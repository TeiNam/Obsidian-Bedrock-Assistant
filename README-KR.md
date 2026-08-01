# AI Assistant

[English](README.md) | [한국어](README-KR.md) | [日本語](README-JA.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS Bedrock](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![Google Gemini](https://img.shields.io/badge/Google-Gemini-4285F4.svg)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT-412991.svg)
![Ollama](https://img.shields.io/badge/Ollama-Local-000000.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/teinam)

Obsidian용 AI 어시스턴트 사이드바 플러그인. AWS Bedrock, Google Gemini, OpenAI, Ollama 멀티프로바이더 백엔드를 지원합니다.

> **명령 이름 안내**: 이 플러그인의 명령 팔레트 레이블은 현재 한국어로만 제공됩니다.

## 기능

- **멀티프로바이더 AI 백엔드** — AWS Bedrock(Claude), Google Gemini, OpenAI, Ollama를 설정에서 전환
- **스트리밍 채팅** — 실시간 스트리밍 응답
- **Graph RAG 볼트 검색** — 청크 단위 임베딩 + 링크 순회(아웃링크·백링크) + 최소 관련성 임계값
- **Second Brain 레이어** — 옵트인 지식 레이어(기본 꺼짐). 전용 폴더에 위키 노트를 작성하며, sentinel 블록으로 사용자가 직접 작성한 내용을 보존합니다
- **지식 공백 리포트** — 인덱스 데이터만으로 구조적 공백을 찾습니다(LLM 호출 0회)
- **복습 큐** — 오래 열지 않았지만 연결이 많은 노트 5건을 제시합니다(LLM 호출 0회)
- **대화 결론 수확** — 저장된 대화에서 결론·결정·근거·미해결 질문만 추출해 검색 가능한 노트로 남깁니다
- **추론 강도** — 모델별 추론 깊이 설정. 지원하지 않는 모델에서는 생략됩니다
- **자동 태그 생성** — 노트 내용 분석 및 관련 태그 제안
- **템플릿** — 변수 치환을 지원하는 커스텀 템플릿
- **할 일 관리** — 일일 할 일, 미완료 항목 자동 이월, 아카이빙
- **아카이브 정리** — 설정 탭에서 오래된 아카이브 파일 정리
- **P.A.R.A 정리** — P.A.R.A 폴더 구조(Projects, Areas, Resources, Archives) 생성 및 기존 노트 AI 분류
- **웹 클리퍼** — 웹 페이지를 마크다운 노트로 가져오기, 번역, 요약
- **MCP 서버 통합** — Model Context Protocol 서버(uvx, Docker)
- **파일 관리** — AI를 통한 노트 생성, 편집, 이동, 삭제
- **다국어 UI** — English, 한국어, 日本語
- **파일 첨부** — 드래그앤드롭, 클립보드, 파일 검색(이미지, PDF, 텍스트)
- **채팅 세션 히스토리** — 과거 대화 저장 및 복원
- **옵시디언 스킬** — 6개 내장 지식 모듈: `obsidian-markdown`, `obsidian-bases`, `json-canvas`, `korean-writing`, `business-english-writing`, `second-brain`
- **채팅 회고** — "회고", "retrospective", "振り返り" 입력 시 일일 회고 자동 생성. 최근 7일의 회고 섹션을 함께 제공해 반복 문제를 추적합니다
- **채팅 내보내기** — 대화를 마크다운 파일로 내보내기
- **응답 재생성** — 마지막 AI 응답 재생성
- **대화 검색** — 저장된 채팅 세션 검색
- **MCP JSON 편집기** — 실시간 검증, 자동 포매팅, 괄호 매칭, 템플릿
- **파괴적 도구 확인** — 파일 작업 전 선택적 확인
- **컨텍스트 윈도우 관리** — 자동 토큰 트리밍

## 설치

### BRAT (권장)

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat) 플러그인 설치
2. BRAT 설정에서 레포지토리 URL 추가: `https://github.com/teinam/obsidian-ai-assistant`
3. 플러그인 활성화

### 수동 설치

1. 최신 [Release](../../releases)에서 `main.js`, `styles.css`, `manifest.json` 다운로드
2. 볼트의 `.obsidian/plugins/ai-assistant/` 폴더에 복사
3. 설정 → 커뮤니티 플러그인에서 활성화

### 0.2.x에서 업그레이드

0.3.0에서 플러그인 ID가 `bedrock-assistant`에서 `ai-assistant`로 바뀌었습니다.

- **새 플러그인을 켜기 전에 기존 플러그인을 먼저 비활성화하세요.** 둘이 동시에 켜져 있으면 기존 플러그인이 인덱스를 저장하는 도중 새 플러그인이 같은 파일을 읽어 불완전한 복사가 생길 수 있습니다(재인덱싱으로 복구되지만 시간이 걸립니다).
- **플러그인 폴더가 달라지므로 재설치가 필요합니다.** BRAT을 쓰신다면 기존 항목을 제거하고 다시 추가하세요.
- **설정(`data.json`)**, 볼트 인덱스, 채팅 기록, 세션, MCP 설정, 자격증명은 **첫 실행 시 자동으로 복사됩니다**. 백엔드 선택, 모델, 리전, Second Brain 설정, 커스텀 스킬이 모두 그대로 유지됩니다. 구 파일은 지우지 않고 남겨두므로 이전 버전으로 되돌려도 그대로 동작합니다.
- **사이드바를 한 번 다시 열어야 합니다.** 옵시디언이 워크스페이스 레이아웃에 뷰 식별자를 기록하는데, 이 값은 플러그인이 대신 옮길 수 없습니다.
- 복사가 끝나면 알림이 뜹니다. 구 데이터 파일(`.bedrock-assistant-*.json`)은 더 이상 쓰이지 않으니 볼트 용량이 신경 쓰이면 수동으로 지워도 됩니다. 인덱스 파일은 임베딩 때문에 수십 MB일 수 있습니다.

`kiro-edition`(Assistant Kiro)을 쓰셨다면 같은 절차가 적용됩니다. 이 에디션은 0.3.0에서 main으로 통합되었고, `.assistant-kiro-*.json` 데이터도 자동으로 복사됩니다.

## 빠른 시작

### 1. AI 백엔드 선택

설정 → AI Assistant → **AI 백엔드**:

- **Bedrock** — AWS Bedrock(Claude 등 Bedrock 호스팅 모델)
- **Gemini** — Google Gemini. [Google AI Studio](https://aistudio.google.com/)에서 API 키 필요
- **OpenAI** — OpenAI 또는 OpenAI 호환 엔드포인트
- **Ollama** — 로컬 Ollama 서버

백엔드를 전환하면 사이드바 아이콘, 모델 목록, 브랜딩이 동적으로 업데이트됩니다.

> **지원 백엔드 기준:** 이 플러그인은 볼트 검색(Graph RAG)에 임베딩을 사용하므로, 임베딩 API를 제공하는 벤더만 백엔드로 지원합니다. Anthropic 직접 API는 임베딩 엔드포인트가 없어 제외했습니다 — Claude 모델은 Bedrock 백엔드로 사용하세요.

### 2. 자격증명 구성

**Bedrock:** AWS 콘솔(Bedrock → API keys)에서 발급한 **장기 Bedrock API 키**를 입력하고 AWS Region을 설정합니다. 키는 OS 키체인으로 암호화해 로컬에만 저장되며 볼트에 남지 않습니다.

키 발급, 모델 접근 활성화, 여러 기기에서 사용하기: [Bedrock 설정 가이드](docs/bedrock-setup-kr.md)

> 0.3.0에서 AWS 액세스 키와 `~/.aws` 프로필(SSO 포함) 인증을 제거했습니다. 액세스 키는 장기 자격증명이라 위험이 크고, SSO는 기기마다 `aws sso login`과 8~12시간 주기 재로그인이 필요해 여러 기기에서 쓰는 노트 앱에는 부담이 큽니다. 기존 사용자는 설정에서 Bedrock API 키를 입력해야 합니다.

필수 IAM 권한:
- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

**Gemini:** [Google AI Studio](https://aistudio.google.com/)에서 발급한 API 키 입력

**OpenAI:** API 키 입력. OpenAI 호환 엔드포인트를 사용하려면 `/v1`을 포함한 base URL 설정. 비워두면 공식 API 사용

**Ollama:** 서버 base URL 입력. 비워두면 `http://localhost:11434` 사용. API 키 불필요

> **주의:** 자격증명은 OS 키체인 암호화로 로컬에 저장되며 iCloud로 동기화되지 않습니다. 각 기기에서 별도 설정 필요

### 3. 사이드바 열기

리본 아이콘을 클릭하거나, 명령 팔레트에서 **어시스턴트 열기** 실행

### 4. 볼트 인덱싱 (선택)

채팅 헤더의 🔍을 클릭하거나 **볼트 인덱싱** 명령 실행. Graph RAG 검색과 볼트를 검색하는 Second Brain 도구에 필요합니다. `emerge`도 인덱스를 열거하므로 인덱스가 필요합니다. `architect`와 `update_index`는 볼트 파일 목록을 직접 읽으므로 인덱스 없이 작동합니다.

## 사용법

### 채팅

입력 영역에 메시지를 입력하고 Enter. AI가 실시간 스트리밍으로 응답합니다. 도구 모음 버튼으로 컨텍스트 노트 첨부:

- 📎 현재 노트 첨부
- 🔍 파일 검색 후 첨부
- 📁 파일 선택기, 드래그앤드롭, 클립보드 붙여넣기로 이미지/PDF 첨부

입력 도구 모음의 웹 검색 토글(지구본 아이콘)은 검색 MCP(`fetch`, `exa`, `brave`)가 구성되어 있거나 네이티브 Google 검색 그라운딩이 있는 Gemini 백엔드일 때만 켜집니다. 그 외에는 알림이 표시되고 토글이 꺼진 상태로 유지됩니다.

### 추론 강도

설정 → AI Assistant → **생성 설정** → **추론 강도**에서 모델의 추론 깊이를 설정합니다.

허용 값은 선택한 프로바이더와 모델에 따라 다릅니다(예: Bedrock의 Anthropic 모델은 `xhigh`와 `max` 허용, Gemini Pro 모델은 `low`와 `high`만 허용). 설정은 추론 강도를 지원하는 모델에만 표시되며, 지원하지 않는 모델로 요청 시 프로바이더의 기본 샘플링 동작으로 폴백합니다. 저장된 값이 허용되지 않는 모델로 전환하면 가장 가까운 허용 레벨로 클램프됩니다.

### Graph RAG 볼트 검색

노트를 청크로 나누고 임베딩한 후, 검색 시 최상위 매치의 아웃링크와 백링크를 순회하여 관련 이웃을 함께 가져옵니다. 사이드바 헤더의 검색 아이콘이나 `볼트 인덱싱` 명령으로 시작합니다. 편집된 파일은 자동으로 재인덱싱됩니다.

자세한 내용: [Graph RAG & Second Brain](docs/second-brain-kr.md)

### Second Brain 레이어

기존 노트를 기반으로 위키 노트를 생성하고 유지하는 레이어입니다.
**기본적으로 꺼져 있습니다** — 설정 → Second Brain에서 명시적으로 활성화하세요.

- 읽기 전용 도구(challenge, connect, emerge, reconcile)는 노트를 생성하지 않고 분석만 반환합니다
- 생성 도구(synthesize, architect 등)는 설정한 위키 폴더 내부에만 씁니다
- 생성된 영역은 `<!-- @generated:KEY -->` 마커로 감싸지므로, 재생성해도 **같은 파일에 직접 작성한 노트는 보존됩니다**

자세한 내용: [Graph RAG & Second Brain](docs/second-brain-kr.md)

### 웹 클리퍼

채팅 입력 위 액션 도구 모음의 지구본 아이콘(🌐) → URL 입력. 페이지를 가져와 번역(필요 시)하고 마크다운 노트로 요약합니다.

생성된 프론트매터는 네 개 필드를 포함합니다: `source`(URL), `created`(날짜), `type: web-clip`, `tags: [web-clip]`

### 할 일 & 아카이브

- **할 일**: `{{date}}` / `{{prevDate}}` 변수를 포함한 템플릿에서 일일 노트 생성
- **이월**: 전날의 미완료 작업을 계층 구조를 유지하며 이월
- **자동 아카이브**: 오래된 할 일 파일을 아카이브 폴더로 이동
- **아카이브 정리**: 설정 탭에서 오래된 아카이브 파일 삭제(폴더 및 일수 임계값 설정 가능)

### P.A.R.A 정리

1. 설정 → AI Assistant → **볼트 관리** 섹션으로 이동
2. 템플릿 폴더 설정 바로 아래의 **P.A.R.A 설정** 버튼 클릭
3. 플러그인이 네 개 루트 폴더 생성: `01. Projects`, `02. Areas`, `03. Resources`, `04. Archives`
4. 기존 노트가 있으면 현재 설정된 AI 모델이 각 노트를 적절한 폴더로 분류
5. 진행률 모달이 실시간 상태와 완료 시 요약 표시

### MCP 서버

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

`uvx`(Python)와 `docker` 모두 지원됩니다.

## 네트워크 사용

이 플러그인은 다음 외부 서비스에 네트워크 요청을 보냅니다:

- **AWS Bedrock API** — Bedrock 백엔드 사용 시 채팅, 임베딩, 모델 목록 조회를 위해 AWS Bedrock 엔드포인트로 요청. 구체적인 리전 엔드포인트는 설정한 AWS Region에 따라 다릅니다(예: `bedrock-runtime.us-east-1.amazonaws.com`)
- **Google Gemini API** — Gemini 백엔드 사용 시 채팅, 임베딩, 모델 목록 조회를 위해 `generativelanguage.googleapis.com`으로 요청
- **OpenAI API** — OpenAI 백엔드 사용 시 채팅, 임베딩, 모델 목록 조회를 위해 `https://api.openai.com/v1` 또는 설정한 OpenAI 호환 base URL로 요청
- **Ollama** — Ollama 백엔드 사용 시 Ollama 서버(기본 `http://localhost:11434`)로 요청. 다른 곳을 가리키지 않는 한 로컬입니다
- **웹 클리퍼** — 웹 클리퍼 기능 사용 시 요약을 위해 대상 URL을 가져옵니다
- **MCP 서버** — MCP 서버가 구성되어 있으면 stdio를 통해 로컬에서 실행된 MCP 서버 프로세스와 통신합니다

서드파티 분석 또는 추적 서비스로는 데이터를 전송하지 않습니다.

## 데스크톱 전용

이 플러그인은 데스크톱 전용(`isDesktopOnly: true`)입니다. MCP 서버 통합이 stdio를 통한 로컬 자식 프로세스 생성에 의존하기 때문이며, 이는 모바일 플랫폼에서 사용할 수 없습니다.

## 라이선스

[MIT](LICENSE)
