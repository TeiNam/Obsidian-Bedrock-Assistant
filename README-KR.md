# Bedrock Assistant

[English](README.md) | [한국어](README-KR.md) | [日本語](README-JA.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![카카오페이 후원](https://img.shields.io/badge/카카오페이-후원하기-FFCD00?style=for-the-badge&logo=kakaotalk&logoColor=black)](https://qr.kakaopay.com/Ej74xpc815dc06149)

AWS Bedrock와 Google Gemini 듀얼 백엔드를 지원하는 Obsidian AI 어시스턴트 사이드바 플러그인입니다.

## 주요 기능

- **듀얼 AI 백엔드** — 설정에서 AWS Bedrock (Claude)과 Google Gemini를 전환
- **스트리밍 채팅** — 사이드바에서 실시간 스트리밍 응답
- **볼트 시맨틱 검색** — 임베딩으로 노트를 인덱싱하고 의미 기반 검색
- **태그 자동 생성** — 노트 내용을 분석하여 태그 추천
- **템플릿** — 변수 치환을 지원하는 커스텀 템플릿
- **To-Do 관리** — 일일 To-Do 생성, 미완료 항목 자동 승계, 아카이브
- **아카이브 비우기** — 모달 UI로 오래된 아카이브 파일 정리
- **웹 클리퍼** — URL로 웹 페이지를 가져와 번역/요약 후 마크다운 노트로 저장
- **MCP 서버 연동** — Model Context Protocol 서버 (uvx, Docker 지원)
- **파일 관리** — AI를 통한 노트 생성/수정/이동/삭제
- **다국어 지원** — English, 한국어, 日本語
- **파일 첨부** — 드래그앤드롭, 클립보드, 파일 검색 (이미지, PDF, 텍스트)
- **대화 세션 관리** — 지난 대화 저장/복원
- **Obsidian 스킬** — AI가 Obsidian 문법을 정확히 사용하도록 지식 모듈 제공
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

- **Bedrock** — AWS Bedrock (Claude). AWS Access Key / Secret Key 필요.
- **Gemini** — Google Gemini. [Google AI Studio](https://aistudio.google.com/)에서 API 키 발급 필요.

백엔드를 전환하면 사이드바 아이콘, 모델 목록, 브랜딩이 자동으로 변경됩니다.

### 2. 자격증명 설정

**Bedrock:** AWS Access Key ID, Secret Access Key, Region을 입력합니다.

필요 IAM 권한:
- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

**Gemini:** [Google AI Studio](https://aistudio.google.com/)에서 발급받은 API 키를 입력합니다.

> **참고:** 자격증명은 OS 키체인 암호화를 사용하여 각 기기에 로컬로만 저장되며, iCloud를 통해 동기화되지 않습니다. 각 기기에서 별도로 설정해야 합니다.

### 3. 사이드바 열기

리본 아이콘을 클릭하거나 커맨드 팔레트에서 **"어시스턴트 열기"**를 실행합니다.

### 4. 볼트 인덱싱 (선택)

채팅 헤더의 🔍 아이콘을 클릭하여 시맨틱 검색용 노트 인덱싱을 실행합니다.

## 사용법

### 채팅

입력창에 메시지를 입력하고 Enter를 누르면 AI가 실시간 스트리밍으로 응답합니다. 툴바 버튼으로 노트를 컨텍스트로 첨부할 수 있습니다:

- 📎 현재 노트 첨부
- 🔍 파일 검색하여 첨부
- 📁 이미지/PDF를 파일 선택, 드래그앤드롭, 클립보드 붙여넣기로 첨부

### 웹 클리퍼

채팅 헤더의 지구본 아이콘 (🌐) 클릭 → URL 입력. 웹 페이지를 가져와 번역(필요 시)하고 요약하여 프론트매터가 포함된 마크다운 노트로 저장합니다.

### To-Do & 아카이브

- **To-Do 생성**: `{{date}}` / `{{prevDate}}` 변수를 지원하는 템플릿으로 일일 노트 생성
- **미완료 승계**: 전일 미완료 항목을 계층 구조를 유지하며 자동 승계
- **자동 아카이브**: 오래된 To-Do 파일을 아카이브 폴더로 이동
- **아카이브 비우기**: 휴지통 버튼으로 오래된 아카이브 파일 삭제 (폴더 및 기준 일수 설정 가능)

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

## 라이선스

[MIT](LICENSE)
