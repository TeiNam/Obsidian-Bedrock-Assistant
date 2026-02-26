# Bedrock Assistant

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-CI/CD-2088FF.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://qr.kakaopay.com/Ej74xpc815dc06149)

AWS Bedrock 기반 Obsidian AI 어시스턴트 사이드바 플러그인입니다.

## 주요 기능

- **Claude 채팅** — AWS Bedrock Claude 모델과 사이드바에서 대화
- **볼트 시맨틱 검색** — Titan Embedding으로 노트를 인덱싱하고 의미 기반 검색
- **태그 자동 생성** — 노트 내용을 분석하여 태그 자동 추천
- **템플릿** — 커스텀 템플릿 생성/적용 (변수 치환 지원)
- **To-Do 관리** — 일일 To-Do 생성, 미완료 항목 자동 승계, 아카이브
- **MCP 서버 연동** — Model Context Protocol 서버 연결 (uvx, Docker 지원)
- **파일 관리** — AI를 통한 노트 생성/수정/이동/삭제
- **다국어 지원** — 한국어/영어 UI
- **파일 첨부** — 드래그앤드롭, 클립보드, 파일 검색으로 컨텍스트 첨부
- **대화 세션 관리** — 지난 대화 저장/복원

## 설치

### BRAT (권장)

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat) 플러그인 설치
2. BRAT 설정에서 이 레포지토리 URL 추가
3. 플러그인 활성화

### 수동 설치

1. [Releases](../../releases) 페이지에서 최신 버전의 `main.js`, `styles.css`, `manifest.json` 다운로드
2. 볼트의 `.obsidian/plugins/bedrock-assistant/` 폴더에 복사
3. 설정 → 커뮤니티 플러그인에서 활성화

## 설정

### AWS 인증 (3가지 방식)

| 방식 | 설명 |
|------|------|
| **Manual** | Access Key / Secret Key 직접 입력 |
| **Env / Profile** | 환경변수 또는 `~/.aws/credentials` 프로파일 |
| **API Key** | Bedrock API Key (Bearer 토큰) |

### 필요 IAM 권한

- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

## MCP 서버 설정

설정 탭 → MCP Servers → Edit Config에서 JSON 형식으로 설정합니다.

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

`uvx` (Python)와 `docker` 명령 모두 지원합니다. GUI 환경에서 명령 경로를 자동으로 탐색합니다.

## 라이선스

[MIT](LICENSE)
