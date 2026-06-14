# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 규칙은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

> **에디션 안내**: 이 CHANGELOG는 **Assistant Kiro (`kiro-edition`)** 전용입니다.
> 이 에디션은 **AWS Bedrock 단일 백엔드**를 사용합니다.
> 멀티프로바이더(OpenAI/Ollama)·Gemini 기능은 `main` 브랜치(Bedrock Assistant)에서 관리됩니다.

## [Unreleased]

### Added
- 시스템 프롬프트 구조: 내장 기본 프롬프트에 사용자 추가 지침과 스킬을 결합해 주입.
- 스킬 시스템: 내장 스킬(항상 적용) + 사용자 커스텀 스킬(토글 활성화, AI 생성 보조).
- 웹 검색 토글: fetch/exa/brave MCP를 이용한 채팅 웹 검색.
- 기본 MCP 설정 템플릿(fetch/brave-search/exa/time) 및 MCP 도구 타임아웃 설정(1~60초).
- Graph RAG 기반 볼트 검색: 임베딩 + 그래프 순회로 관련 노트 탐색.
- 입력 보정: `maxTokens` 허용 범위 클램프, 임베딩 모델 변경 시 재인덱싱 안내.

### Changed
- **AWS Bedrock 단일 백엔드로 전환** — 백엔드 선택 UI와 비-Bedrock 클라이언트를 제거하고 Bedrock 전용으로 단순화.
- Daily Planner 구조 개편 — TimeBox 제거, 평면 To-Do 폴더 구조(`{폴더}/YYYY-MM-DD To-Do.md`)로 전환, To-Do 템플릿 정비.
- 설정 화면 재구성 — 사용자 경험을 모양/대화/볼트 3그룹으로 분류, 채팅 폰트 크기·MCP 타임아웃을 숫자 입력으로 변경.
- 웹 요약을 별도 모델 대신 현재 선택된 모델로 처리.

### Removed
- Gemini 및 기타 비-Bedrock 백엔드 관련 코드·설정·UI.
- TimeBox 노트 생성 기능 및 관련 템플릿.

## [0.2.15] - 2026-06-14

- 현재 배포 베이스 버전. 이후의 변경 사항은 위 [Unreleased] 섹션을 참고하세요.
