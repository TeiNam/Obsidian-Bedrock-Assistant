---
inclusion: always
---

# 브랜딩·프로바이더 정책

## 개요

이 프로젝트는 **단일 브랜치(`main`)**로 관리한다. 0.3.0에서 `kiro-edition`
브랜치를 폐기하고 `main`으로 통합했다.

## 플러그인 식별자

| 항목 | 값 |
|---|---|
| pluginId | `ai-assistant` |
| manifest name | `AI Assistant` |
| viewType | `ai-assistant-view` |

**GitHub repo name / package.json name:** `obsidian-ai-assistant` — Obsidian의
커뮤니티 플러그인 가이드는 `id`에 "obsidian" 접두어를 쓰지 말라고 권장하므로
`pluginId`는 `ai-assistant`로 짧게 유지한다. repo/package 이름과 다르지만
의도된 차이다 — 둘을 맞추려 하지 말 것.

**과거 식별자(마이그레이션 소스):** `bedrock-assistant`(main 계보),
`assistant-kiro`(kiro-edition 계보). `src/migration.ts`가 두 ID의 데이터를
새 경로로 복사한다. 이 목록은 `src/main.ts`의 `LEGACY_PLUGIN_IDS`에 있다.

## 표시명과 아이콘

`displayName`, `icon`, `settingsTitle`은 `aiBackend` 설정에 따라 런타임에
전환된다. `pluginId`, `viewType`, `files`는 백엔드와 무관한 고정값이다.

| aiBackend | displayName |
|---|---|
| `bedrock` | Bedrock Assistant |
| `gemini` | Gemini Assistant |
| `openai` | OpenAI Assistant |
| `ollama` | Ollama Assistant |

전환 경로: `settings-tab.ts`의 백엔드 드롭다운 → `updateBranding(aiBackend)`
→ `plugin.refreshBranding()`이 리본 아이콘·뷰 헤더 갱신.

아이콘 SVG는 `src/branding.ts`에 문자열로 인라인한다. 별도 `.svg` 파일을
두지 않는다 — 빌드가 번들하지 않아 참조 없는 자산이 된다.

## 새 프로바이더 추가 규칙

새 백엔드를 추가할 때 손대야 하는 곳:

1. `types.ts` — `aiBackend` union, 프로바이더별 설정 필드
2. `provider-utils.ts` — `AiProvider` union, `embeddingSignature`, effort 매핑
3. `ai-client-factory.ts` — `case` 추가
4. `branding.ts` — 브랜딩 상수 + `getBranding`의 `case`
5. `main.ts` `registerBrandingIcons` — 백엔드 배열에 추가
6. `settings-tab.ts` — 인증·모델 UI
7. `safe-storage.ts` — API 키가 있으면 `SENSITIVE_FIELDS`에 추가

### 임베딩 API가 없는 벤더는 지원하지 않는다

이 플러그인은 볼트 인덱싱(Graph RAG)에 `IAiClient.getEmbedding`이 필수다.
임베딩 엔드포인트를 제공하지 않는 벤더를 백엔드로 추가하면 임베딩을 다른
프로바이더에 위임하는 구조가 강제되고, 사용자는 API 키 2개와 청구서 2곳을
관리해야 한다.

**Anthropic 직접 API가 이 사유로 제외됐다**(0.3.0 검토). Anthropic Claude
모델은 Bedrock 백엔드로 이미 사용할 수 있다. 직접 API의 추가 실익(AWS 계정
불필요, 신모델 선출시 접근, 프롬프트 캐싱)은 위 비용을 정당화하지 못한다고
판단했다.

이 정책을 뒤집으려면 임베딩 프로바이더 분리 설정(`embeddingProvider` 필드)을
먼저 설계해야 한다.

## 자격증명 저장

민감 필드(`SENSITIVE_FIELDS`)는 볼트의 `data.json`에 저장하지 않는다.
Electron `safeStorage`로 암호화해 userData 경로의
`ai-assistant-credentials.json`(권한 0600)에 둔다. 볼트가 클라우드
동기화되어도 키가 전파되지 않는다.

OS 키체인을 쓸 수 없는 환경에서는 해당 필드를 파일에 아예 쓰지 않는다
(`buildCredentialsPayload` 참조) — 평문으로 디스크에 남기지 않기 위함이다.
