# Assistant Kiro

[English](README.md) | [한국어](README-KR.md) | [日本語](README-JA.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://qr.kakaopay.com/Ej74xpc815dc06149)

**AWS Bedrock** 기반의 Obsidian AI 어시스턴트 사이드바 플러그인입니다.
AI 기반 IDE인 [Kiro](https://kiro.dev)로 개발·유지보수됩니다.

## 주요 기능

- **AWS Bedrock 백엔드** — AWS Bedrock (Claude) 모델 기반. 인증 방식 3가지 지원 (Access Key / Bedrock API 키 / `~/.aws` 공유 프로필)
- **스트리밍 채팅** — 사이드바에서 실시간 스트리밍 응답
- **Graph RAG 볼트 검색** — 노트를 청크 단위로 임베딩하고, 검색된 노트의 링크를 따라 이웃 노트까지 확장해 검색
- **Second Brain Layer** — 볼트를 근거로 종합·모순 점검·반박·연결을 수행하는 옵트인 지식 레이어 (기본 꺼짐)
- **지식 공백 리포트** — 인덱스만으로 끊긴 링크·빈약한 노트·고아 노트를 찾아 리포트 (LLM 호출 0회)
- **복습 큐** — 오래 열지 않았지만 링크가 많은 노트 5건을 제시 (LLM 호출 0회)
- **대화 결론 수확** — 지난 대화에서 결론·결정·근거만 뽑아 검색 가능한 노트로 저장
- **일일 회고** — 채팅에 "회고", "retrospective", "振り返り"를 입력하면 To-Do 기반 AI 회고를 생성. 최근 7일의 회고를 함께 입력해 반복 문제와 개선 여부를 추적 (회고 체인)
- **태그 자동 생성** — 노트 내용을 분석하여 태그 자동 추천
- **To-Do 관리** — 템플릿 기반 일일 To-Do 생성, 미완료 항목 자동 승계 (계층 구조 유지), 아카이브
- **아카이브 비우기** — 설정 탭에서 오래된 아카이브 파일 정리
- **P.A.R.A 환경 설정** — P.A.R.A 폴더 구조(Projects, Areas, Resources, Archives)를 설정하고 AI로 기존 노트를 자동 분류
- **웹 클리퍼** — URL로 웹 페이지를 가져와 AI로 번역/요약 후 마크다운 노트로 저장
- **MCP 서버 연동** — Model Context Protocol 서버 연결 (uvx, Docker)
- **파일 관리** — AI 도구 호출을 통한 노트 생성/수정/이동/삭제
- **다국어 지원** — 한국어 / English / 日本語
- **파일 첨부** — 드래그앤드롭, 클립보드, 파일 검색, 이미지/PDF 첨부
- **대화 세션 관리** — 지난 대화 저장/복원 및 검색 (최대 50개 보관)
- **대화 내보내기** — 대화를 마크다운 파일로 내보내기
- **MCP JSON 에디터** — 실시간 검증, 자동 포맷팅, 괄호 매칭, 템플릿 삽입
- **컨텍스트 윈도우 표시** — 토큰 사용량을 시각적 링으로 표시
- **스킬** — 시스템 프롬프트에 지식·지침을 추가하는 내장 스킬 6종 (Obsidian Markdown, Obsidian Bases, JSON Canvas, 사람처럼 글쓰기(한국어), 비지니스 이메일/메신저 글쓰기(영어), Second Brain). 커스텀 스킬도 추가 가능
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
2. **AWS Bedrock** 섹션에서 인증 방식을 선택하고 자격증명 입력 (아래 [AWS Bedrock 설정](#aws-bedrock-설정) 참고)
3. AWS 리전과 채팅 모델 선택
4. 왼쪽 리본의 Assistant Kiro 아이콘을 클릭하여 사이드바 열기
5. 대화 시작!

## AWS Bedrock 설정

이 에디션은 **AWS Bedrock 단일 백엔드**입니다. 다른 AI 제공자를 선택하는 설정은 없습니다.

### 인증 방식

설정 → Assistant Kiro 설정 → AWS Bedrock → 인증 방식 드롭다운에서 선택합니다. 선택한 방식에 해당하는 입력 필드만 표시됩니다.

| 인증 방식 | 입력 항목 | 설명 |
|-----------|-----------|------|
| Access Key (기본값) | Access Key ID, Secret Access Key | AWS IAM 액세스 키를 직접 입력 |
| Bedrock API 키 | Bedrock API 키 | Bedrock 장기 API 키. 베어러 토큰으로 전송됩니다 |
| AWS 프로필 (~/.aws) | 프로필 이름 (드롭다운) | `~/.aws/config` 또는 `~/.aws/credentials`의 프로필을 사용. SSO 프로필은 터미널에서 `aws sso login --profile <이름>`을 먼저 실행해야 합니다 |

프로필 방식은 `~/.aws`에서 프로필 목록을 읽어 드롭다운으로 제시하며, "프로필 다시 읽기" 버튼으로 목록을 갱신할 수 있습니다.

### 공통 설정

| 설정 | 설명 |
|------|------|
| Region | AWS 리전 (예: `us-east-1`) |
| 채팅 모델 | 사용 가능한 Bedrock 모델 선택 (드롭다운) |
| 임베딩 모델 | 볼트 인덱싱용 Bedrock 임베딩 모델. 기본값이 없으므로 드롭다운에서 직접 선택해야 합니다 |
| 최대 토큰 | 응답 최대 토큰 수 |
| 추론 강도 (Effort) / Temperature | effort를 지원하는 모델에서는 추론 강도(Effort) 드롭다운이, 지원하지 않는 모델에서는 Temperature 슬라이더가 표시됩니다 |

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
2. 모든 마크다운 파일이 청크 단위로 분할되어 임베딩으로 인덱싱됩니다
3. 인덱싱 완료 후 AI가 질문에 답할 때 볼트를 시맨틱 검색할 수 있습니다
4. 파일 생성·수정·이름변경·삭제 시 자동으로 인덱스가 갱신됩니다 (파일별 2초 디바운스)

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

채팅 입력창에 "회고", "retrospective", "振り返り" 중 하나를 입력하면 AI 요청 전에 가로채져 회고가 생성되고, 결과가 오늘의 To-Do에 추가됩니다. 별도의 회고 버튼이나 확인 대화상자는 없습니다.

회고 생성 시 **최근 7일의 회고 섹션**을 함께 입력해 반복되는 문제와 개선 여부를 추적합니다(회고 체인). 일일 노트 전체가 아니라 회고 섹션만 넣고, 건당 1000자로 잘라 넣으므로 **LLM 호출 횟수는 늘지 않습니다**. 과거 회고가 없으면 오늘 입력만으로 동작합니다. 당일 회고는 입력에서 제외합니다 — 직전 결과를 자기 입력으로 되먹이면 같은 문장이 증폭되기 때문입니다.

오늘자 To-Do 문서가 없으면 먼저 To-Do를 만들라는 안내만 표시됩니다.

### 웹 클리퍼

1. 액션 툴바의 지구본 아이콘 클릭
2. URL 입력
3. AI가 페이지를 가져와 번역(필요 시)하고 요약
4. 프론트매터(`source`, `created`, `type: web-clip`, `tags: [web-clip]`)와 함께 마크다운 노트로 저장

### 아카이브 비우기

1. 설정 → Assistant Kiro 설정 → To-Do 섹션 열기
2. 아카이브 삭제 기준 일수를 설정하고 옆의 비우기 버튼 클릭
3. 기준 일수보다 오래된 파일이 아카이브 폴더에서 삭제 대상으로 표시됩니다

### P.A.R.A 환경 설정

1. 설정 → Assistant Kiro 설정 → **볼트 관리** 섹션 열기
2. 템플릿 폴더 설정 다음에 있는 "P.A.R.A 설정하기" 버튼 클릭
3. 볼트 루트에 4개 폴더가 생성됩니다: `01. Projects`, `02. Areas`, `03. Resources`, `04. Archives`
4. 기존 노트가 있으면 현재 설정된 AI 모델이 각 노트를 적절한 폴더로 자동 분류합니다
5. 진행 상황 모달에서 실시간 상태와 완료 시 요약을 확인할 수 있습니다
6. 이미 P.A.R.A 폴더 안에 있는 노트는 자동으로 건너뜁니다

### 웹 서치

**전제 조건:** 검색용 MCP 서버(`fetch`, `exa`, `brave` 중 하나)가 먼저 설정되어 있어야 합니다. 없으면 토글이 켜지지 않고 "설정 → MCP에서 구성하세요"라는 안내만 표시됩니다.

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

자격증명은 **iCloud 동기화 대상이 아닌 로컬 전용 경로**(`~/Library/Application Support/obsidian/`)에 저장됩니다. Access Key ID, Secret Access Key, Bedrock API 키가 대상이며 `data.json`에는 남지 않습니다. 나머지 설정은 `data.json`을 통해 정상 동기화됩니다.

> **참고:** API 키는 기기별로 저장됩니다. iCloud로 볼트를 동기화하는 경우, 각 기기에서 자격증명을 별도로 설정해야 합니다.

## 네트워크 사용

이 플러그인은 다음 외부 서비스에 네트워크 요청을 보냅니다:

- **AWS Bedrock API** — 채팅/임베딩/모델 목록 조회를 위해 AWS Bedrock 엔드포인트에 요청합니다. 설정된 AWS 리전에 따라 엔드포인트가 결정됩니다 (예: `bedrock-runtime.us-east-1.amazonaws.com`).
- **웹 클리퍼** — 웹 클리퍼 기능 사용 시, 요약을 위해 대상 URL의 페이지 콘텐츠를 가져옵니다.
- **MCP 서버** — MCP 서버가 설정된 경우, 로컬에서 실행된 MCP 서버 프로세스와 stdio를 통해 통신합니다.

제3자 분석이나 추적 서비스로 데이터를 전송하지 않습니다.

## 데스크톱 전용

이 플러그인은 데스크톱 전용(`isDesktopOnly: true`)입니다. MCP 서버 통합이 로컬 자식 프로세스를 stdio로 생성하는 방식이므로 모바일 플랫폼에서는 사용할 수 없습니다.

## 라이선스

[MIT](LICENSE)
