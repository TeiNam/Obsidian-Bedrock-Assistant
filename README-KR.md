# Bedrock Assistant — Kiro Edition

[English](README.md) | [한국어](README-KR.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-CI/CD-2088FF.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://qr.kakaopay.com/Ej74xpc815dc06149)

AWS Bedrock 기반 Obsidian AI 어시스턴트 사이드바 플러그인입니다.
이 버전은 **Kiro Edition**으로, AI 기반 IDE인 [Kiro](https://kiro.dev)를 활용하여 개발·유지보수됩니다.

## Kiro Edition — 차이점

### iCloud 안전 자격증명 저장

기존(main) 브랜치에서는 API 키를 암호화하여 볼트 내 `data.json`에 저장합니다. 이 파일은 iCloud를 통해 기기 간 동기화되는데, 암호화가 각 기기의 OS 키체인에 바인딩되어 있어 다른 기기에서는 복호화할 수 없는 문제가 있었습니다.

Kiro Edition에서는 자격증명을 **iCloud 동기화 대상이 아닌 로컬 전용 경로**(`~/Library/Application Support/obsidian/`)에 별도 저장합니다. 모델, 리전, UI 설정 등 나머지 설정은 기존처럼 정상 동기화됩니다.

> **⚠️ 중요:** API 키는 기기별로 저장됩니다. iCloud로 볼트를 동기화하는 경우, 각 기기에서 AWS 자격증명을 별도로 설정해야 합니다.

### 자동 릴리즈

`kiro-edition` 브랜치에 푸시하면 GitHub Actions가 자동으로 테스트 → 빌드 → 패치 버전 증가 → GitHub Release 생성을 수행합니다.

## 주요 기능

- **Claude 채팅** — AWS Bedrock Claude 모델과 사이드바에서 대화
- **볼트 시맨틱 검색** — Titan Embedding으로 노트를 인덱싱하고 의미 기반 검색
- **태그 자동 생성** — 노트 내용을 분석하여 태그 자동 추천
- **템플릿** — 커스텀 템플릿 생성/적용 (변수 치환 지원)
- **To-Do 관리** — 일일 To-Do 생성, 미완료 항목 자동 승계 (계층 구조 유지), 아카이브
- **아카이브 비우기** — 오래된 아카이브 파일 정리 모달 (하위 폴더 재귀 탐색, 빈 폴더 자동 삭제, 생성일 기준 필터링)
- **웹 클리퍼** — URL로 웹 페이지를 가져와 AI로 번역/요약 후 마크다운 노트로 저장
- **MCP 서버 연동** — Model Context Protocol 서버 연결 (uvx, Docker 지원)
- **파일 관리** — AI를 통한 노트 생성/수정/이동/삭제
- **다국어 지원** — 한국어 / English / 日本語
- **파일 첨부** — 드래그앤드롭, 클립보드, 파일 검색으로 컨텍스트 첨부
- **대화 세션 관리** — 지난 대화 저장/복원
- **시스템 프롬프트 모달** — 전용 팝업 모달에서 시스템 프롬프트 편집

## 설치

### BRAT (권장)

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat) 플러그인 설치
2. BRAT 설정에서 이 레포지토리 URL 추가
3. 플러그인 활성화

### 수동 설치

1. [Releases](../../releases) 페이지에서 최신 버전의 `main.js`, `styles.css`, `manifest.json` 다운로드
2. 볼트의 `.obsidian/plugins/assistant-kiro/` 폴더에 복사
3. 설정 → 커뮤니티 플러그인에서 활성화

## 설정

### AWS 인증 (3가지 방식)

| 방식 | 설명 |
|------|------|
| **Manual** | Access Key / Secret Key 직접 입력 |
| **Env / Profile** | 환경변수 또는 `~/.aws/credentials` 프로파일 |
| **API Key** | Bedrock API Key (Bearer 토큰) |

> **참고:** 어떤 인증 방식을 선택하든, 자격증명은 각 기기의 로컬에만 저장되며 iCloud를 통해 동기화되지 않습니다. 사용하는 모든 기기에서 자격증명을 각각 설정해야 합니다.

### 필요 IAM 권한

- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

## 웹 클리퍼

웹 페이지를 가져와 번역(필요 시)하고 요약하여 마크다운 노트로 저장합니다.

- 채팅 헤더의 지구본 아이콘 클릭 → URL 입력
- 설정에서 저장 폴더 및 전용 AI 모델 지정 가능
- 언어 감지: 같은 언어 = 요약만, 다른 언어 = 번역 + 요약
- 프론트매터에 출처 URL, 날짜, 언어 포함

## To-Do & 아카이브

- **To-Do 생성**: `{{date}}` / `{{prevDate}}` 변수를 지원하는 템플릿으로 일일 노트 생성
- **미완료 승계**: 전일 미완료 항목을 계층 구조를 유지하며 자동 승계
- **자동 아카이브**: 새 To-Do 생성 시 설정 일수를 초과한 파일을 아카이브 폴더로 이동
- **아카이브 비우기**: 전용 버튼으로 오래된 아카이브 파일 삭제 (폴더 및 기준 일수 설정 가능, 파일 생성일 기준)

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
