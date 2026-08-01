# 설계: obsidian-ai-assistant 단일 브랜치 통합

**날짜:** 2026-08-01
**대상 브랜치:** `main` (작업 브랜치 `feat/unify-ai-assistant`)
**기준 커밋:** `dc33868` (origin/main, 0.2.24)
**목표 버전:** 0.3.0

## 배경 — 요청과 실제 상태의 차이

원 요청은 네 가지였다. 저장소를 실측한 결과 대부분은 이미 구현돼 있었다.

| 요청 | 실제 상태 |
|---|---|
| "모든 지원 방식을 main에 통합" | **이미 완료.** main에 Bedrock/Gemini/OpenAI/Ollama 4종 존재. `kiro-edition`은 여기서 3종을 걷어낸 축소판 |
| "AI별로 아이콘이 바뀌도록" | **이미 동작.** `branding.ts`의 `updateBranding(aiBackend)` + `main.ts:927` 4종 `addIcon` 루프 + `refreshBranding()` |
| "하나의 브랜치로 통합" | 실제 작업 |
| "이름을 obsidian-ai-assistant로" | 실제 작업 |
| "Code Styler / Tasks 기능 내재화" | 감지 개선으로 축소 결정 (근거는 아래) |

브랜치 실측:

```
main(dc33868)  bedrock-assistant / 0.2.24 / 프로바이더 4종
kiro-edition   assistant-kiro    / 0.1.8  / Bedrock 전용, Kiro 아이콘
main·kiro 파일 차이: aws-icon.svg 1개뿐 (나머지는 내용 차이)
```

**델타 감사 결과: `kiro-edition`에만 있는 실질적 코드 개선은 0건이다.** Second Brain·Graph RAG 모듈은 두 브랜치가 바이트 단위로 동일하다.

### 문서 회수는 이미 완료됐다 (계획 수립 중 확인)

감사가 확정한 이식 대상 문서 9건은 **`origin/main`의 PR #11 `c4d3b43`("Graph RAG·Second Brain 문서화 및 사실 오류 정정")과 PR #12 `03b7afe`에서 이미 전부 반영됐다.** 실측 확인:

| 감사 지적 | `dc33868` 상태 |
|---|---|
| `docs/second-brain-{en,kr,ja}.md` 부재 | 3개 파일 모두 존재 |
| README에 Second Brain/Graph RAG 언급 0건 | README-KR 기준 10건 |
| `README-JA.md`의 `会고` 오작동 버그 | `회고`로 정정됨 (39행) |
| P.A.R.A 버튼 위치 오기 | "템플릿 폴더 항목 다음"으로 정정됨 (160행) |
| 웹 검색 전제조건(`fetch`/`exa`/`brave`) 누락 | 121행에 명시됨 |
| Web Clipper 프론트매터 4필드 | 148행에 명시됨 |
| AWS 인증 3방식 표 | 80~84행에 표로 존재 |

`main`과 `kiro-edition`의 남은 `.md` 차이는 kiro의 Bedrock 전용 서술과 브랜딩 문자열뿐이므로 **회수할 것이 없다.**

따라서 이 작업은 **main을 정본으로 확정하고 리네이밍하는 것**으로 축소된다. 문서는 회수가 아니라 리네이밍 반영만 필요하다.

## 결정 사항과 근거

### D1. `git merge`를 쓰지 않는다

`kiro-edition` → `main` 머지는 프로바이더 3종 삭제를 되살릴 위험만 있고 얻을 것이 없다. 회수 대상 문서 파일만 골라 가져온다.

### D2. Anthropic 직접 API는 이번 스코프에서 제외한다

**Anthropic은 임베딩 API를 제공하지 않는다.** 이 플러그인은 볼트 인덱싱(Graph RAG)에 `IAiClient.getEmbedding`이 필수이므로, Anthropic 백엔드는 임베딩을 다른 프로바이더에 위임하는 구조가 강제된다. 사용자는 API 키 2개와 청구서 2곳을 관리해야 한다. 그리고 **Bedrock 백엔드가 이미 Claude를 제공한다** — 직접 API의 추가 실익은 AWS 계정 불필요, 신모델 선출시 접근, 프롬프트 캐싱 정도로 얇다.

**정책으로 확정:** 임베딩 API가 없는 벤더는 백엔드로 제공하지 않는다. 문서에 명시해 같은 질문이 반복될 때의 근거로 남긴다.

`resolveEmbeddingProvider` 같은 확장 지점도 미리 만들지 않는다. 구현이 하나뿐인 추상화는 우회 계층일 뿐이고, 필요해지면 그때 `embeddingSignature`에 `case` 한 줄을 넣는 것이 더 싸다.

### D3. Code Styler / Tasks는 감지만 개선한다

두 플러그인을 실제로 대진하려면 CM6 에디터 확장(편집 모드 데코레이터)과 쿼리 DSL 파서·반복 규칙 엔진을 재구현해야 한다. 추정 1,500줄 이상이고, CM6 내부 API에 의존하므로 Obsidian 업데이트마다 회귀 위험을 안는다. 통합 작업 전체보다 큰 부담이다.

대신 **설치 여부를 감지해 설치된 경우 버튼을 배지로 대체한다.** 현재는 이미 설치한 사용자에게도 설치 버튼이 계속 보인다.

### D4. pluginId를 바꾸고 데이터는 복사로 마이그레이션한다

표시명만 바꾸는 대안이 있었으나, 내부 식별자에 `bedrock` 흔적을 남기지 않기로 했다.

### D5. 표시명은 프로바이더별로 전환한다 (현행 유지)

`aiBackend`에 따라 이름과 아이콘이 함께 바뀌는 현재 main 동작을 유지한다. 어떤 백엔드가 활성인지 리본 툴팁에서 바로 보인다.

## 리네이밍 범위

```
manifest.json     id:   bedrock-assistant        → obsidian-ai-assistant
                  name: Bedrock Assistant        → AI Assistant
                  description: 4종 프로바이더 반영
package.json      name: obsidian-bedrock-assistant → obsidian-ai-assistant
                  version: 0.2.21 → 0.3.0
versions.json     main 이력 채택 + "0.3.0": "1.4.0"
branding.ts       pluginId, viewType, files 4개
safe-storage.ts   CREDENTIALS_FILE
```

`pluginId` 참조 3곳은 `BRANDING.pluginId`를 경유하므로 자동 반영된다: `mcp-client.ts:171`(MCP clientInfo), `main.ts:1136`(MCP 설정 경로), `settings-tab.ts:620`(README 경로).

## 마이그레이션

`pluginId`가 바뀌면 네 종류의 저장 위치가 달라진다.

| 대상 | 구 경로 | 처리 |
|---|---|---|
| 볼트 데이터 4개 | 볼트 루트 `.bedrock-assistant-{index,chat,sessions}.json`, `.bak` | 복사 |
| MCP 설정 | `.obsidian/plugins/bedrock-assistant/mcp.json` | 복사 |
| 자격증명 | Electron userData `bedrock-assistant-credentials.json` | 복사 |
| viewType | 워크스페이스 레이아웃 | 마이그레이션 불가 — 사이드바 재열기 |

**이동이 아니라 복사로 통일한다.** 코드 경로가 하나로 줄고, 사용자가 구 버전으로 되돌려도 그대로 동작한다.

**소스는 `bedrock-assistant`와 `assistant-kiro` 양쪽을 본다.** `kiro-edition`을 폐기하므로 그 사용자도 흡수해야 한다. 같은 대상에 두 소스가 모두 존재하면 `bedrock-assistant`를 우선한다(main 계보가 정본).

### 구조

순수 함수로 판단하고, 부수 효과는 호출부에서만 일으킨다.

```ts
// src/migration.ts
export interface MigrationTask { from: string; to: string; }

/**
 * 구 경로 → 신 경로 복사 작업 목록을 계산한다.
 * 대상 파일이 이미 있으면 건너뛴다(재실행 안전).
 */
export function planMigrations(
  legacyIds: readonly string[],
  newId: string,
  exists: (path: string) => boolean
): MigrationTask[]
```

호출부(`main.ts` `onload`)는 목록을 받아 복사만 수행한다.

**실패는 조용히 삼킨다.** 마이그레이션 실패의 최악 결과는 새 파일로 시작하는 것(인덱스 재생성, 자격증명 재입력)인데, 여기서 예외를 던지면 플러그인 전체가 로드에 실패한다. 개별 작업을 각각 `try/catch`로 감싼다.

**복사 성공 시 Notice 1회:** 구 데이터 파일이 남아 있음을 알린다(인덱스는 임베딩 때문에 수십 MB일 수 있다).

## 아이콘과 브랜딩

구조 변경 없음. 5종 확장 시 `getBranding`에 `case` 한 줄과 브랜딩 상수 하나만 추가하면 되는 상태가 이미 갖춰져 있다.

```
BEDROCK_BRANDING   "Bedrock Assistant"   AWS 로고
GEMINI_BRANDING    "Gemini Assistant"    Gemini 스파크
OPENAI_BRANDING    "OpenAI Assistant"    OpenAI blossom
OLLAMA_BRANDING    "Ollama Assistant"    알파카
```

동작 경로(이미 구현됨): `main.ts:927` `addIcon` 루프 → `settings-tab.ts:801` `updateBranding` → `main.ts:946` `refreshBranding`이 리본 아이콘·라벨 갱신.

`getBranding`의 `default`가 Gemini로 폴백하는 점은 **건드리지 않는다.** `ai-client-factory`의 폴백과 일관되어 있고, 바꾸면 양쪽을 함께 수정해야 해서 이번 스코프를 넘는다.

**정리:** 루트의 `aws-icon.svg`, `kiro-icon.svg`는 참조 없는 자산이다(SVG는 `branding.ts`에 인라인). 삭제한다. `gemini-icon.svg`도 같은 이유로 삭제 대상이다.

## 플러그인 감지

```ts
// src/plugin-detect.ts
/** 지정 ID의 커뮤니티 플러그인이 활성 상태인지 판정한다. */
export function isPluginEnabled(app: unknown, id: string): boolean
```

`app.plugins.enabledPlugins`는 Obsidian 공식 타입에 없어 캐스팅이 필요하다. 캐스팅과 옵셔널 체이닝을 이 함수 안에 격리하고, 접근 실패 시 `false`를 반환한다(미설치로 간주 → 설치 버튼 표시. 안전한 기본값).

`settings-tab.ts:1558~1575`를 수정: 설치됨 → "✓ 설치됨" 배지, 미설치 → 기존 설치 버튼.

## 문서 갱신 (회수 아님)

문서 회수는 `c4d3b43`·`03b7afe`에서 이미 완료됐다(배경 절 참조). 남은 작업은 **리네이밍 반영**뿐이다.

리네이밍으로 바뀌는 문서 문자열:

| 대상 | 현재 | 변경 후 |
|---|---|---|
| README 3종 제목 | `# Bedrock Assistant` | `# AI Assistant` |
| 설치 경로 안내 | `.obsidian/plugins/bedrock-assistant/` | `.obsidian/plugins/obsidian-ai-assistant/` |
| 설정 경로 안내 | `설정 → Bedrock Assistant` | `설정 → AI Assistant` |
| `docs/second-brain-*.md` | `Assistant Kiro Settings` 등 잔존 표기 | 통합 후 표시명 |

추가할 내용 2건:

1. **마이그레이션 안내** — 구 버전 사용자가 알아야 할 것: 플러그인 폴더가 바뀌므로 재설치가 필요하고, 볼트 데이터·MCP 설정·자격증명은 자동 복사되며, **사이드바를 한 번 다시 열어야 한다**(`viewType` 변경은 코드로 마이그레이션할 수 없다).
2. **지원 정책** — D2를 사용자 문서 수준으로 명시: 임베딩 API를 제공하지 않는 벤더는 백엔드로 지원하지 않는다.

`CHANGELOG.md`에 0.3.0 항목을 추가한다.

## 저장소 정리

- `.gitattributes`의 `src/branding.ts merge=ours` 삭제 — 브랜치가 하나면 무의미하다.
- `.kiro/steering/branch-branding.md` 개정 — 브랜치별 에디션 정책을 단일 브랜치 정책으로 교체하고, D2(임베딩 없는 벤더 미지원)를 기록한다.
- `kiro-edition` 브랜치 삭제(로컬·원격).

## 테스트

신규 테스트:

| 대상 | 검증 |
|---|---|
| `planMigrations` | 구 파일만 있을 때 작업 생성 / 신 파일 존재 시 건너뜀(재실행 안전) / 두 레거시 ID 동시 존재 시 `bedrock-assistant` 우선 / 아무것도 없을 때 빈 배열 |
| `isPluginEnabled` | 활성·비활성·`app` 구조 접근 실패 시 `false` |

기존 테스트는 브랜딩 문자열을 참조하는 것만 갱신한다(`branding.test.ts`).

검증 명령:

```bash
npm test           # 기존 + 신규 통과
npm run build      # tsc --noEmit 통과
```

수동 확인 2건:

1. 프로바이더 4종 전환 시 리본 아이콘·툴팁·설정 UI가 갱신되는지
2. `bedrock-assistant` 구 데이터가 있는 볼트, `assistant-kiro` 구 데이터가 있는 볼트에서 각각 복사 마이그레이션이 동작하는지

## 작업 순서

각 단계에서 테스트가 통과한 뒤 다음으로 넘어간다.

1. **마이그레이션 계획 함수** — `planMigrations` 테스트 우선. 리네이밍보다 먼저 만들어야 리네이밍 시점에 바로 붙일 수 있다.
2. **리네이밍 + 마이그레이션 배선** — 식별자 변경과 `onload` 배선을 함께. 이 둘은 쪼개면 중간 상태가 깨진다.
3. **플러그인 감지 개선** — `isPluginEnabled` 테스트 우선.
4. **아이콘 자산 정리 + `.gitattributes`·steering 개정**
5. **문서 리네이밍 반영 + CHANGELOG**
6. **squash 머지 → `kiro-edition` 삭제**

## 스코프 밖 (의도적 제외)

- Anthropic 직접 API (D2)
- Code Styler / Tasks 기능 대진 (D3)
- `getBranding` / `ai-client-factory` 폴백 정책 변경
- 커맨드 팔레트 표시명 i18n — 현재 11종이 한국어 하드코딩(`main.ts:218~732`)이다. 실제 결함이지만 이번 통합과 독립적이므로 별도 작업으로 둔다.
