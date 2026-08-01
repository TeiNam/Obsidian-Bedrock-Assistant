# AWS SSO 프로필 설정 가이드

AI Assistant의 Bedrock 백엔드를 AWS IAM Identity Center(구 AWS SSO)로 인증하는 방법과, 여러 기기에서 쓸 때 각 기기에 해야 하는 설정을 다룹니다.

## 전제조건

| 항목 | 요구사항 |
|---|---|
| AWS CLI | v2 이상. v1은 `sso-session` 문법을 지원하지 않습니다 |
| IAM Identity Center | 조직에 활성화되어 있고, 본인 계정에 Bedrock 권한이 있는 역할이 할당됨 |
| 플러그인 | 데스크톱 전용입니다. 모바일에서는 `~/.aws` 파일을 읽을 수 없어 프로필 인증이 동작하지 않습니다 |

필요한 IAM 권한 3개:

```
bedrock:InvokeModelWithResponseStream
bedrock:InvokeModel
bedrock:ListFoundationModels
```

`bedrock:ListInferenceProfiles`도 있으면 채팅 모델 드롭다운이 채워집니다. 없으면 모델 ID를 직접 입력해야 합니다.

AWS CLI 버전 확인:

```bash
aws --version
```

기대 출력:

```
aws-cli/2.28.11 Python/3.13.4 Darwin/25.5.0 source/arm64
```

## 1. SSO 세션과 프로필 구성

`~/.aws/config`를 편집합니다. 파일이 없으면 새로 만듭니다.

```ini
[sso-session my-org]
sso_start_url = https://my-org.awsapps.com/start
sso_region = us-west-2
sso_registration_scopes = sso:account:access

[profile bedrock-prod]
sso_session = my-org
sso_account_id = 123456789012
sso_role_name = BedrockUser
region = ap-northeast-2
output = json
```

각 키의 의미:

| 키 | 위치 | 설명 |
|---|---|---|
| `sso_start_url` | `sso-session` | 조직의 AWS 액세스 포털 URL. 관리자에게 받습니다 |
| `sso_region` | `sso-session` | **Identity Center가 배치된 리전.** Bedrock을 쓰는 리전과 다를 수 있습니다 |
| `sso_registration_scopes` | `sso-session` | `sso:account:access`면 충분합니다 |
| `sso_account_id` | `profile` | 12자리 AWS 계정 번호 |
| `sso_role_name` | `profile` | 그 계정에서 맡을 역할 이름(권한 세트 이름) |
| `region` | `profile` | **Bedrock을 호출할 리전.** 플러그인 설정의 리전과 일치시킵니다 |

`sso_region`과 `region`은 역할이 다릅니다. 앞은 로그인 대상, 뒤는 모델 호출 대상입니다. 서울 리전에서 Bedrock을 쓰면서 Identity Center는 오레곤에 있는 구성이 흔합니다.

### 레거시 문법도 동작합니다

`sso-session` 섹션 없이 프로필에 직접 적는 예전 형식도 지원합니다.

```ini
[profile bedrock-prod]
sso_start_url = https://my-org.awsapps.com/start
sso_region = us-west-2
sso_account_id = 123456789012
sso_role_name = BedrockUser
region = ap-northeast-2
```

플러그인은 프로필에 적힌 값을 먼저 보고, 없으면 `sso_session`이 가리키는 섹션에서 찾습니다. 두 형식을 섞어 써도 됩니다.

### 계정·역할 이름을 모를 때

```bash
aws configure sso
```

대화형으로 포털에 로그인한 뒤 접근 가능한 계정과 역할을 골라 프로필을 만들어 줍니다. 만들어진 결과를 `~/.aws/config`에서 확인하면 위 형식과 같습니다.

## 2. 로그인

```bash
aws sso login --profile bedrock-prod
```

브라우저가 열리고 조직 포털에서 승인하면 터미널에 다음이 출력됩니다.

```
Successfully logged into Start URL: https://my-org.awsapps.com/start
```

이 명령은 `~/.aws/sso/cache/`에 액세스 토큰을 JSON 파일로 저장합니다. **플러그인은 이 캐시 토큰을 읽어서 동작합니다.**

## 3. 자격증명이 실제로 발급되는지 확인

로그인 성공만으로는 Bedrock 호출 권한이 있는지 알 수 없습니다. 확인합니다.

```bash
aws sts get-caller-identity --profile bedrock-prod
```

기대 출력:

```json
{
    "UserId": "AROAEXAMPLEID:my-name",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_BedrockUser_abc123/my-name"
}
```

`Account`가 의도한 계정인지 확인하세요. Bedrock 모델 접근까지 확인하려면:

```bash
aws bedrock list-foundation-models --profile bedrock-prod --region ap-northeast-2 --query 'modelSummaries[?outputModality==`EMBEDDING`].modelId' --output table
```

목록이 비어 있으면 해당 리전에서 모델 접근이 활성화되지 않았습니다. AWS 콘솔의 Bedrock → Model access에서 사용할 모델을 신청해야 합니다.

## 4. 플러그인 설정

1. 설정 → **AI Assistant**를 엽니다
2. **AI 백엔드**를 `Bedrock`으로 선택합니다
3. **인증 방식**을 `AWS 프로필 (~/.aws)`로 선택합니다
4. **AWS 프로필** 드롭다운에서 `bedrock-prod`를 선택합니다
5. **AWS 리전**에 `ap-northeast-2`를 입력합니다 — `~/.aws/config`의 `region`과 일치시킵니다
6. **Bedrock 채팅 모델**과 **Bedrock 임베딩 모델**을 드롭다운에서 고릅니다

드롭다운이 비어 있고 텍스트 입력창이 나타나면 플러그인이 `~/.aws`에서 프로필을 찾지 못한 것입니다. 프로필 이름을 직접 입력할 수 있습니다. 파일을 편집한 직후라면 프로필 항목 옆의 **프로필 다시 읽기**(↻) 버튼을 누릅니다.

### 프로필 목록에 잡히는 대상

플러그인은 `~/.aws/config`와 `~/.aws/credentials`의 섹션 헤더를 읽어 목록을 만듭니다. `[sso-session ...]` 섹션은 프로필이 아니므로 제외됩니다. 두 파일에 같은 이름이 있으면 한 번만 표시됩니다.

## 5. 토큰 만료와 재로그인

SSO 액세스 토큰은 조직 정책에 따라 보통 8~12시간 뒤 만료됩니다. 만료되면 플러그인에 다음 오류가 나타납니다.

```
SSO 토큰이 없거나 만료됐습니다. 터미널에서 'aws sso login --profile bedrock-prod'을 실행하세요
```

**플러그인은 브라우저 로그인 플로우를 대신 수행하지 않습니다.** 터미널에서 직접 재로그인해야 합니다.

```bash
aws sso login --profile bedrock-prod
```

재로그인 후 플러그인을 다시 시작할 필요는 없습니다. 다음 요청에서 새 캐시 토큰을 읽습니다.

캐시에 같은 포털의 토큰이 여러 개 있으면 만료가 가장 늦은 것을 사용합니다. 여러 프로필이 같은 `sso_start_url`을 공유하면 한 번의 로그인으로 모두 동작합니다.

## 여러 기기에서 사용하기

기기마다 **개별 설정이 필요합니다.** 볼트를 동기화해도 인증은 따라오지 않습니다. 설계상 의도된 동작입니다 — 자격증명이 클라우드 동기화로 퍼지지 않게 막습니다.

### 기기마다 해야 하는 것

| 항목 | 저장 위치 | 동기화 여부 | 조치 |
|---|---|---|---|
| `~/.aws/config` | 홈 디렉터리 | ✗ | 기기마다 만들거나 복사 |
| SSO 캐시 토큰 | `~/.aws/sso/cache/` | ✗ | 기기마다 `aws sso login` 실행 |
| AWS CLI v2 | 시스템 | ✗ | 기기마다 설치 |
| 플러그인 설정(모델·리전·프로필명) | 볼트 `.obsidian/plugins/ai-assistant/data.json` | ○ (볼트 동기화 시) | 자동 |
| 볼트 인덱스 | 볼트 루트 `.ai-assistant-index.json` | ○ | 아래 주의사항 참조 |

새 기기 절차:

```bash
# 1. AWS CLI v2 설치 (macOS 예시)
brew install awscli

# 2. ~/.aws/config 작성 — 기존 기기에서 복사해도 됩니다
#    (이 파일에는 비밀값이 없습니다. start URL·계정 ID·역할 이름만 들어갑니다)
mkdir -p ~/.aws
# 편집기로 config 작성

# 3. 로그인
aws sso login --profile bedrock-prod

# 4. 확인
aws sts get-caller-identity --profile bedrock-prod
```

플러그인 설정은 볼트를 동기화했다면 이미 프로필 이름을 기억하고 있습니다. 프로필 이름을 기기마다 다르게 지었다면 설정에서 다시 골라야 합니다 — **모든 기기에서 프로필 이름을 같게 유지하는 것이 가장 편합니다.**

### `~/.aws/config`는 복사해도 되지만 캐시는 안 됩니다

`config` 파일에는 비밀값이 없습니다. start URL, 계정 번호, 역할 이름, 리전뿐입니다. 기기 간에 복사해도 안전합니다.

`~/.aws/sso/cache/`는 복사하지 마세요. 액세스 토큰이 평문으로 들어 있고, 기기마다 새로 발급받는 것이 원래 동작입니다.

`~/.aws/credentials`에 장기 액세스 키가 남아 있다면 이 플러그인은 더 이상 사용하지 않습니다(액세스 키 인증은 제거되었습니다). 다른 도구가 쓰지 않는다면 정리하는 편이 안전합니다.

### 볼트 인덱스는 기기 간 공유됩니다

볼트를 동기화하면 `.ai-assistant-index.json`도 함께 옮겨집니다. 임베딩 벡터가 들어 있어 수십 MB가 될 수 있습니다.

**임베딩 구성이 같으면** 새 기기에서 재인덱싱 없이 검색이 바로 동작합니다. 플러그인은 `{프로바이더}:{모델 ID}` 형태의 시그니처로 이를 판단합니다(예: `bedrock:amazon.titan-embed-text-v2:0`).

**임베딩 모델이 기기마다 다르면** 시그니처가 어긋나 기존 벡터가 폐기되고 재인덱싱이 필요하다는 안내가 나타납니다. 그동안 검색은 키워드 방식으로 동작합니다. 기기 간에 임베딩 모델을 같게 두면 이 문제가 생기지 않습니다.

동기화 도구가 `.으로 시작하는 파일`을 제외하도록 설정돼 있으면 인덱스가 옮겨지지 않습니다. 그 경우 새 기기에서 한 번 인덱싱하면 됩니다.

## 문제 해결

### `SSO 토큰이 없거나 만료됐습니다`

터미널에서 `aws sso login --profile <이름>`을 실행합니다. 이미 실행했는데도 같은 오류가 나오면 프로필 이름이 플러그인 설정과 일치하는지 확인하세요. 플러그인은 프로필의 `sso_start_url`과 캐시 파일 내용의 `startUrl`을 대조해 토큰을 찾습니다 — 두 값이 다르면 로그인해도 매칭되지 않습니다.

```bash
# 캐시에 어떤 startUrl이 들어 있는지 확인
grep -h startUrl ~/.aws/sso/cache/*.json
```

### `프로필 '...'에 sso_region이 없습니다`

`sso-session` 섹션이나 프로필에 `sso_region`을 추가합니다. Identity Center가 배치된 리전이며, Bedrock 리전과 다를 수 있습니다.

### `프로필 '...'의 role_arn(역할 위임)은 지원하지 않습니다`

`role_arn`으로 다른 역할을 위임하는 프로필은 지원하지 않습니다. Identity Center 역할을 직접 가리키는 프로필을 따로 만들어 쓰세요.

### `프로필 '...'에서 자격증명을 찾을 수 없습니다`

프로필에 SSO 필드(`sso_start_url`·`sso_account_id`·`sso_role_name`), 정적 키, `credential_process` 중 어느 것도 없습니다. `~/.aws/config`의 해당 섹션을 확인하세요. 섹션명에 `profile ` 접두사가 필요한 점도 확인합니다 — `credentials` 파일에서는 접두사가 없고 `config`에서는 있습니다.

### `SSO 자격증명 발급 실패 (HTTP 403)`

로그인은 됐지만 그 계정·역할 조합에 접근 권한이 없습니다. `sso_account_id`와 `sso_role_name`이 포털에서 실제로 할당된 값인지 확인하세요.

### 프로필 드롭다운이 비어 있습니다

플러그인이 `~/.aws/config`와 `~/.aws/credentials`를 찾지 못했습니다. 홈 디렉터리에 파일이 있는지 확인하고, **프로필 다시 읽기** 버튼을 누릅니다. 비표준 경로를 쓴다면 텍스트 입력창에 프로필 이름을 직접 입력할 수 있지만, 플러그인은 `~/.aws`만 읽으므로 표준 경로로 옮기는 것이 확실합니다.

### 모델 드롭다운이 비어 있습니다

`bedrock:ListInferenceProfiles`(채팅) 또는 `bedrock:ListFoundationModels`(임베딩) 권한이 없거나, 해당 리전에서 모델 접근이 활성화되지 않았습니다. 4절의 `aws bedrock list-foundation-models` 명령으로 확인하세요.

## 네트워크 사용

프로필 인증 시 플러그인이 접속하는 곳:

| 대상 | 목적 |
|---|---|
| `portal.sso.{sso_region}.amazonaws.com` | 캐시된 SSO 토큰을 임시 자격증명으로 교환 |
| `bedrock-runtime.{region}.amazonaws.com` | 채팅·임베딩 호출 |
| `bedrock.{region}.amazonaws.com` | 모델 목록 조회 |

자격증명은 로컬에만 저장됩니다. 제3자 분석이나 추적 서비스로 데이터를 보내지 않습니다.
