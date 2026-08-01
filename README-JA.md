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

AWS Bedrock、Google Gemini、OpenAI、Ollamaのマルチプロバイダーバックエンドに対応したObsidian AIアシスタントサイドバープラグインです。

> **コマンド名について:** このプラグインのコマンドパレットラベルは現在韓国語のみです。

## 主な機能

- **マルチプロバイダーAIバックエンド** — 設定でAWS Bedrock (Claude)、Google Gemini、OpenAI、Ollamaを切り替え
- **ストリーミングチャット** — リアルタイムストリーミング応答
- **Graph RAG ボルト検索** — チャンクレベルの埋め込み + リンク走査(アウトリンク・バックリンク) + 最小関連性しきい値
- **Second Brain レイヤー** — オプトイン知識レイヤー(既定はオフ)。専用フォルダにWikiノートを書き込み、センチネルブロックでユーザーが書いた内容を保護
- **ナレッジギャップレポート** — インデックスデータのみから構造的ギャップを検出(LLM呼び出し0回)
- **復習キュー** — 長く開いていないがリンクの多いノート5件を提示(LLM呼び出し0回)
- **会話収穫** — 保存された会話セッションから結論・決定・根拠・未解決の問いを抽出し、検索可能なノートにする
- **推論強度** — モデルごとに推論の深さを設定。サポートしていないモデルでは省略
- **タグ自動生成** — ノート内容を分析して関連タグを提案
- **テンプレート** — 変数置換をサポートするカスタムテンプレート
- **To-Do管理** — 日次To-Do、未完了項目の自動引き継ぎ、アーカイブ
- **アーカイブクリーンアップ** — 設定タブから古いアーカイブファイルをクリーンアップ
- **P.A.R.A オーガナイザー** — P.A.R.Aフォルダ構造(Projects, Areas, Resources, Archives)をセットアップし、既存ノートをAIで分類
- **Webクリッパー** — WebページをマークダウンノートとしてfetchLambertson、翻訳、要約
- **MCPサーバー連携** — Model Context Protocolサーバー(uvx、Docker)
- **ファイル管理** — AIによるノートの作成、編集、移動、削除
- **多言語UI** — English、한국어、日本語
- **ファイル添付** — ドラッグ＆ドロップ、クリップボード、ファイル検索(画像、PDF、テキスト)
- **チャットセッション履歴** — 過去の会話を保存・復元
- **Obsidianスキル** — 6つの組み込み知識モジュール: `obsidian-markdown`、`obsidian-bases`、`json-canvas`、`korean-writing`、`business-english-writing`、`second-brain`
- **チャット振り返り** — チャットで「회고」「retrospective」「振り返り」と入力すると日次振り返りを自動生成し、直近7日間の振り返りセクションと連鎖して繰り返し問題を可視化
- **チャットエクスポート** — 会話をマークダウンファイルとしてエクスポート
- **応答再生成** — 最後のAI応答を再生成
- **会話検索** — 保存されたチャットセッションを検索
- **MCP JSONエディタ** — リアルタイム検証、自動フォーマット、括弧マッチング、テンプレート
- **破壊的ツール確認** — ファイル操作前のオプション確認
- **コンテキストウィンドウ管理** — 自動トークントリミング

## インストール

### BRAT（推奨）

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat)プラグインをインストール
2. BRAT設定でリポジトリURLを追加: `https://github.com/teinam/obsidian-ai-assistant`
3. プラグインを有効化

### 手動インストール

1. 最新の[Release](../../releases)から`main.js`、`styles.css`、`manifest.json`をダウンロード
2. ボルトの`.obsidian/plugins/ai-assistant/`フォルダにコピー
3. 設定 → コミュニティプラグインで有効化

### 0.2.xからのアップグレード

バージョン0.3.0でプラグインIDが`bedrock-assistant`から`ai-assistant`に変更されました。

- **プラグインフォルダが変わるため、再インストールが必要です。** BRATを使用している場合は、既存のエントリを削除してから再度追加してください。
- **設定(`data.json`)**、ボルトインデックス、チャット履歴、セッション、MCP設定、認証情報は**初回起動時に自動的にコピーされます**。バックエンド選択、モデル、リージョン、Second Brain設定、カスタムスキルはすべて保持されます。旧ファイルは削除されずに残るため、以前のバージョンにロールバックしてもシームレスに動作します。
- **サイドバーを一度開き直す必要があります。** Obsidianはワークスペースレイアウトにビュー識別子を記録しており、プラグインはそれを代わりに書き換えることができません。
- 移行が完了すると通知が表示されます。旧データファイル(`.bedrock-assistant-*.json`)は使用されなくなるため、ボルトサイズが気になる場合は手動で削除できます。インデックスファイルは埋め込みのため数十MBになる可能性があります。

`kiro-edition`(Assistant Kiro)を使用していた場合も同じ移行が適用されます。このエディションは0.3.0でmainにマージされ、`.assistant-kiro-*.json`データも自動的に移行されます。

## クイックスタート

### 1. AIバックエンドを選択

設定 → AI Assistant → **AIバックエンド**:

- **Bedrock** — AWS Bedrock (ClaudeおよびBedrock-hostedモデル)
- **Gemini** — Google Gemini。[Google AI Studio](https://aistudio.google.com/)からのAPIキーが必要
- **OpenAI** — OpenAIまたはOpenAI互換エンドポイント
- **Ollama** — ローカルOllamaサーバー

バックエンドを切り替えると、サイドバーアイコン、モデルリスト、ブランディングが動的に更新されます。

> **バックエンドサポートポリシー:** このプラグインはGraph RAGボルト検索に埋め込みAPIを使用するため、埋め込みエンドポイントを提供するプロバイダーのみがサポートされます。Anthropic直接APIは埋め込みエンドポイントを提供していないため除外されています — ClaudeモデルはBedrockバックエンドを使用してください。

### 2. 認証情報を設定

**Bedrock:** 3つの認証方法のいずれかを選択してから、AWSリージョンを設定します。

| 方法 | 提供するもの |
|------|--------------|
| Access Key | AWS Access Key IDとSecret Access Key |
| Bedrock API Key | 長期Bedrock APIキー(ベアラートークンとして送信) |
| AWS Profile | `~/.aws/config`または`~/.aws/credentials`からのプロファイル名。SSOプロファイルの場合は、まずターミナルで`aws sso login --profile <name>`を実行 |

必要なIAM権限:
- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

**Gemini:** [Google AI Studio](https://aistudio.google.com/)からAPIキーを入力

**OpenAI:** APIキーを入力。OpenAI互換エンドポイントを使用するには、`/v1`を含むbase URLを設定。空のままにすると公式APIを使用

**Ollama:** サーバーのbase URLを入力。空のままにすると`http://localhost:11434`を使用。APIキーは不要

> **注意:** 認証情報はOSキーチェーン暗号化を使用してローカルに保存され、iCloud経由で同期されません。各デバイスで個別に設定してください。

### 3. サイドバーを開く

リボンアイコンをクリックするか、コマンドパレットから**어시스턴트 열기**(「アシスタントを開く」)を実行

### 4. ボルトをインデックス化(オプション)

チャットヘッダーの🔍をクリックするか、**볼트 인덱싱**を実行します。Graph RAG検索およびボルトを検索するSecond Brainツールに必要です。`emerge`もインデックスエントリを列挙するため、インデックスが必要です。`architect`と`update_index`はボルトファイルリストを直接読み取るため、インデックスなしで動作します。

## 使用方法

### チャット

入力エリアにメッセージを入力してEnter。AIがリアルタイムストリーミングで応答します。ツールバーボタンでコンテキストノートを添付:

- 📎 現在のノートを添付
- 🔍 ファイルを検索して添付
- 📁 ファイルピッカー、ドラッグ＆ドロップ、クリップボード貼り付けで画像/PDFを添付

入力ツールバーのWeb検索トグル(地球アイコン)は、検索MCP(`fetch`、`exa`、`brave`)が設定されているか、ネイティブGoogle検索グラウンディングを持つGeminiバックエンドの場合にのみオンになります。それ以外の場合は通知が表示され、トグルはオフのままです。

### 推論強度

設定 → AI Assistant → **生成設定** → **推論強度**で、モデルの推論の深さを設定します。

許可される値は、選択したプロバイダーとモデルによって異なります(例: BedrockのAnthropicモデルは`xhigh`と`max`を許可し、Gemini Proモデルは`low`と`high`のみを許可)。設定は推論強度をサポートするモデルにのみ表示され、サポートしないモデルへのリクエストはプロバイダーのデフォルトサンプリング動作にフォールバックします。保存された値が許可されていないモデルに切り替えた場合、最も近い許可レベルにクランプされます。

### Graph RAG ボルト検索

ノートをチャンクに分割して埋め込み、検索時に最良のマッチのアウトリンクとバックリンクをウォークして関連する隣接ノートを引き込みます。サイドバーヘッダーの検索アイコンまたは`볼트 인덱싱`コマンドから開始します。編集されたファイルは自動的に再インデックス化されます。

詳細: [Graph RAG & Second Brain](docs/second-brain-ja.md)

### Second Brainレイヤー

既存のノートに基づいてWikiノートを作成・維持するレイヤーです。
**既定ではオフ** — 設定 → Second Brainで明示的に有効化してください。

- 読み取り専用ツール(challenge、connect、emerge、reconcile)はノートを作成せず、分析のみを返します
- 生成ツール(synthesize、architectなど)は設定したWikiフォルダ内にのみ書き込みます
- 生成された領域は`<!-- @generated:KEY -->`マーカーでラップされるため、再生成しても**同じファイル内に自分で書いたノートは保持されます**

詳細: [Graph RAG & Second Brain](docs/second-brain-ja.md)

### Webクリッパー

チャット入力上のアクションツールバーの地球アイコン(🌐) → URLを入力。ページがfetch、翻訳(必要に応じて)され、マークダウンノートとして要約されます。

生成されたフロントマターには4つのフィールドが含まれます: `source`(URL)、`created`(日付)、`type: web-clip`、`tags: [web-clip]`

### To-Do & Archive

- **To-Do**: `{{date}}` / `{{prevDate}}`変数を含むテンプレートから日次ノートを生成
- **引き継ぎ**: 前日の未完了タスクを階層を保持して引き継ぎ
- **自動アーカイブ**: 古いTo-Doファイルをアーカイブフォルダに移動
- **アーカイブクリーンアップ**: 設定タブから古いアーカイブファイルを削除(フォルダと日数しきい値を設定可能)

### P.A.R.A オーガナイザー

1. 設定 → AI Assistant → **ボルト管理**セクションを開きます。
2. テンプレートフォルダ設定のすぐ下にある**P.A.R.A設定**ボタンをクリック
3. プラグインが4つのルートフォルダを作成: `01. Projects`、`02. Areas`、`03. Resources`、`04. Archives`
4. 既存のノートが見つかった場合、現在設定されているAIモデルが各ノートを適切なフォルダに分類
5. 進行状況モーダルがリアルタイムステータスと完了時の概要を表示

### MCPサーバー

設定 → MCP Servers → Edit Config:

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

`uvx`(Python)と`docker`の両方をサポートしています。

## ネットワーク使用

このプラグインは以下の外部サービスにネットワークリクエストを送信します:

- **AWS Bedrock API** — Bedrockバックエンド使用時、チャット、埋め込み、モデルリスト取得のためにAWS Bedrockエンドポイントにリクエストを送信。具体的なリージョンエンドポイントは設定したAWSリージョンに依存(例: `bedrock-runtime.us-east-1.amazonaws.com`)
- **Google Gemini API** — Geminiバックエンド使用時、チャット、埋め込み、モデルリスト取得のために`generativelanguage.googleapis.com`にリクエストを送信
- **OpenAI API** — OpenAIバックエンド使用時、チャット、埋め込み、モデルリスト取得のために`https://api.openai.com/v1`または設定したOpenAI互換base URLにリクエストを送信
- **Ollama** — Ollamaバックエンド使用時、Ollamaサーバー(既定`http://localhost:11434`)にリクエストを送信。別の場所を指定しない限りローカル
- **Webクリッパー** — Webクリッパー機能使用時、要約のためにターゲットURLをfetch
- **MCPサーバー** — MCPサーバーが設定されている場合、stdioを介してローカルで生成されたMCPサーバープロセスと通信

サードパーティの分析や追跡サービスにデータは送信されません。

## デスクトップ専用

このプラグインはデスクトップ専用(`isDesktopOnly: true`)です。MCPサーバー連携がstdio経由でローカル子プロセスを生成することに依存しており、これはモバイルプラットフォームでは利用できません。

## ライセンス

[MIT](LICENSE)
