---
inclusion: always
---

# 브랜치별 에디션 브랜딩 관리 규칙

## 개요
이 프로젝트는 하나의 코드베이스에서 3개의 에디션을 브랜치로 관리합니다.
기능 변경 시 브랜딩 파일이 덮어씌워지지 않도록 주의해야 합니다.

## 브랜치 ↔ 에디션 매핑

| 브랜치 | pluginId | displayName | 릴리즈 태그 접두사 |
|---|---|---|---|
| `main` | `bedrock-assistant` | Bedrock Assistant | `bedrock-assistant-` |
| `kiro-edition` | `assistant-kiro` | Assistant Kiro | `kiro-` |
| `gemini-edition` | `assistant-gemini` | Assistant Gemini | `gemini-` |

## 브랜딩 관련 파일 (브랜치별로 다름)

- `src/branding.ts` — pluginId, displayName, viewType, 파일 경로, 아이콘, 설정 타이틀
- `manifest.json` — id, name, description
- `package.json` — name
- `README.md`, `README-KR.md` — 에디션별 설명

## 핵심 규칙

1. **cherry-pick / merge 시 브랜딩 파일을 절대 덮어쓰지 않는다**
   - `branding.ts`, `manifest.json`, `package.json`의 name/id 필드, README 파일은 브랜치 고유
   - cherry-pick 충돌 시 현재 브랜치(HEAD)의 브랜딩 값을 유지

2. **공통 기능은 main에서 먼저 구현 후 cherry-pick으로 전파**
   - main → kiro-edition, gemini-edition 순서
   - gemini-edition은 들여쓰기 스타일이 다를 수 있어 충돌 가능성 높음

3. **새 기능 추가 시 브랜딩 참조는 `BRANDING` 상수 사용**
   - 하드코딩된 플러그인 이름/ID 금지
   - `import { BRANDING } from "./branding"` 사용

4. **CI/CD 릴리즈는 브랜치별 자동 분류**
   - `.github/workflows/release.yml`이 브랜치명으로 에디션 접두사 결정
   - 버전은 patch 단위로 증가 (0.1.0 → 0.1.1)

## 브랜치별 차이점

- `main`: AWS Bedrock (Claude + Titan) 기반, `@aws-sdk` 의존성
- `kiro-edition`: main과 동일 기능, 브랜딩만 다름, 커스텀 SVG 아이콘 포함
- `gemini-edition`: Google Gemini 기반, `gemini-client.ts` 사용, `bedrock-client.ts` 없음

## 자격증명 저장

- 모든 에디션이 동일한 `bedrock-assistant-credentials.json` 파일명 사용 (iCloud 비동기화 경로)
- `safe-storage.ts`에서 관리
