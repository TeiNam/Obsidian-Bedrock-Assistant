# Bedrock Assistant

[English](README.md) | [한국어](README-KR.md) | [日本語](README-JA.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4.svg)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT-412991.svg)
![Ollama](https://img.shields.io/badge/Ollama-Local-000000.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/teinam)

AWS Bedrock、Google Gemini、OpenAI、Ollamaのマルチプロバイダーバックエンドに対応したObsidian AIアシスタントサイドバープラグインです。

## 主な機能

- **マルチプロバイダーAIバックエンド** — 設定でAWS Bedrock (Claude)、Google Gemini、OpenAI、Ollamaを切り替え
- **ストリーミングチャット** — サイドバーでリアルタイムストリーミング応答
- **Graph RAG ボルト検索** — ノートをチャンク単位で埋め込み、検索結果からリンクをたどって関連ノートまで広げる意味ベース検索
- **Second Brain レイヤー（オプトイン・既定はオフ）** — 検索結果をもとにWikiノートを生成・更新する書き込みレイヤーと、ノートを作らない思考ツール群
- **ナレッジギャップレポート** — インデックスの構造指標から「まだ書かれていない場所」を洗い出す（LLM呼び出し0回）
- **復習キュー** — 長く開いていないがリンクの多いノートを5件だけ提示（LLM呼び出し0回）
- **会話の結論収穫** — チャットセッションから結論・決定・根拠・未解決の問いだけを抽出してノート化
- **振り返りチェーン** — 日次振り返りの生成時に直近7日分の振り返りを参照し、繰り返している問題を追跡
- **推論強度（Effort）** — 対応モデルで推論の深さを指定
- **タグ自動生成** — ノート内容を分析してタグを推薦
- **テンプレート** — 変数置換対応のカスタムテンプレート
- **To-Do管理** — 日次To-Do作成、未完了タスクの自動引き継ぎ、アーカイブ
- **P.A.R.A セットアップ** — P.A.R.Aフォルダ構造（Projects, Areas, Resources, Archives）を作成し、AIで既存ノートを自動分類
- **Webクリッパー** — URLからWebページを取得、翻訳・要約してマークダウンノートに保存
- **MCPサーバー連携** — Model Context Protocolサーバー（uvx、Docker対応）
- **ファイル管理** — AIによるノートの作成・編集・移動・削除
- **多言語対応** — English、한국어、日本語（コマンドパレットの表示名は韓国語のみ）
- **ファイル添付** — ドラッグ＆ドロップ、クリップボード、ファイル検索（画像、PDF、テキスト）
- **チャットセッション履歴** — 過去の会話を保存・復元・検索・エクスポート
- **Obsidianスキル** — AIがObsidian構文を正確に使うための知識モジュール
- **チャット振り返り** — チャットで「회고」「retrospective」「振り返り」と入力すると日次振り返りを生成
- **応答再生成** — 最後のAI応答を再生成
- **MCP JSONエディタ** — リアルタイム検証、自動フォーマット、括弧マッチング、テンプレート挿入
- **ノート変更の確認** — ファイル操作前のオプション確認ダイアログ
- **コンテキストウィンドウ管理** — 自動トークントリミング

## インストール

### BRAT（推奨）

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat)プラグインをインストール
2. BRAT設定でリポジトリURLを追加: `https://github.com/teinam/obsidian-bedrock-assistant`
3. プラグインを有効化

### 手動インストール

1. [Releases](../../releases)ページから`main.js`、`styles.css`、`manifest.json`をダウンロード
2. ボルトの`.obsidian/plugins/bedrock-assistant/`フォルダにコピー
3. 設定 → コミュニティプラグインで有効化

## クイックスタート

### 1. AIバックエンドを選択

設定 → Bedrock Assistant → **AIバックエンド**:

- **Bedrock** — AWS Bedrock。認証方式は3種類から選べます（下記参照）。
- **Gemini** — Google Gemini。[Google AI Studio](https://aistudio.google.com/)からAPIキーを取得。
- **OpenAI** — OpenAI APIキー。Base URLを指定すればOpenAI互換エンドポイントも使用できます。
- **Ollama** — ローカルのOllamaサーバー（既定 `http://localhost:11434`）。APIキーは不要。

バックエンドを切り替えると、サイドバーアイコン、モデルリスト、ブランディングが自動的に更新されます。

### 2. 資格情報を設定

**Bedrock:** 認証方式を選び、対応する項目だけを入力します。

| 認証方式 | 入力項目 |
|----------|----------|
| アクセスキー | AWS Access Key ID、Secret Access Key、リージョン |
| Bedrock APIキー | Bedrockの長期APIキー（ベアラートークンとして送信）、リージョン |
| AWSプロファイル (`~/.aws`) | プロファイル名、リージョン。SSOプロファイルの場合は先にターミナルで `aws sso login --profile <名前>` を実行してください |

必要なIAM権限:
- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

**Gemini:** [Google AI Studio](https://aistudio.google.com/)から取得したAPIキーを入力します。

**OpenAI:** APIキーを入力します。Base URLは任意で、空の場合は `https://api.openai.com/v1` を使用します。

**Ollama:** サーバーのBase URLを入力します。空の場合は `http://localhost:11434` を使用します。

> **注意:** 資格情報はOSキーチェーン暗号化を使用して各デバイスにローカル保存され、iCloudでは同期されません。各デバイスで個別に設定してください。

### 3. サイドバーを開く

リボンアイコンをクリックするか、コマンドパレットで `어시스턴트 열기` を実行します。

> コマンドパレットの表示名は現時点ではすべて韓国語です。プラグインの表示言語設定とは連動しないため、本ドキュメントでは韓国語の原文をそのまま記載します。

### 4. モデルを選択

設定 → モデル設定で、チャットモデルと埋め込みモデルをドロップダウンから選びます。埋め込みモデルには既定値が入っていないバックエンドもあるため、Graph RAG検索を使う前に明示的に選択してください。

### 5. ボルトインデックス（オプション）

チャットヘッダーの検索アイコンをクリックしてGraph RAG検索用のノートインデックスを作成します。

## 使い方

### チャット

入力エリアにメッセージを入力してEnterを押すと、AIがリアルタイムストリーミングで応答します。入力欄の下のツールバーからコンテキストを追加できます:

- 現在のノートを添付
- ファイルを検索して添付
- 画像/PDFをファイル選択、ドラッグ＆ドロップ、クリップボード貼り付けで添付
- **Web検索トグル** — 有効にするには、検索用MCP（`fetch` / `exa` / `brave` のいずれか）が設定されているか、ネイティブ検索を持つバックエンド（Gemini）を使っている必要があります。どちらも無い状態でトグルを押すと、その旨の通知が出て有効になりません。

入力欄の上のアクションツールバーには、日次To-Do作成・タグ生成・Webページ要約の3つのボタンがあります。

### 推論強度（Effort）

設定 → 生成設定 → **推論強度 (Effort)** で、モデルの推論の深さを指定します。

- 選択できる値は `minimal` / `low` / `medium` / `high` / `xhigh` / `max` のうち、**現在のバックエンドとモデルが許可するものだけ**です（既定 `medium`）。
- effortに対応するモデルが無いバックエンド（Ollamaなど）では項目自体が表示されず、リクエストにも含まれません。その場合はプロバイダー既定のサンプリング設定が使われます。
- バックエンドやモデルを切り替えると、保存済みの値が許容範囲外になることがあります。その場合は最も近い値へ自動的に補正されます。

### Graph RAG ボルト検索

ノートをチャンクに分割して埋め込みを作成し、見つかったノートのリンク（アウトリンク・バックリンク）を
辿って隣接ノートまで広げて関連ノートを探します。サイドバーヘッダーの検索アイコン、または
コマンド `볼트 인덱싱` でインデックスを開始します。ファイルを編集すると自動的に再インデックスされます。

詳細: [Graph RAG & Second Brain](docs/second-brain-ja.md)

### Second Brain レイヤー（LLM Wiki）

検索したノートを根拠にウィキノートを作成・管理するレイヤーです。**デフォルトでは無効**で、
設定 → Second Brain で明示的に有効化する必要があります。

- 読み取り専用ツール（challenge・connect・emerge・reconcile）はノートを作成せず、分析結果のみを返します。
- 生成ツール（synthesize・architect など）は指定したWikiフォルダ内にのみ書き込みます。
- 生成領域は `<!-- @generated:KEY -->` マーカーで囲まれており、再生成しても**同じノートに自分で書いたメモはそのまま残ります**。

詳細: [Graph RAG & Second Brain](docs/second-brain-ja.md)

### Obsidianスキル

AIがObsidianの構文や執筆ルールを正確に扱うための知識モジュールです。設定 → スキルで有効・無効を切り替えられ、独自のスキルを追加することもできます。同梱されているのは次の6種類です。

| スキル | 内容 |
|--------|------|
| Obsidian Markdown | ウィキリンク、コールアウト、埋め込み、プロパティなどの構文 |
| Obsidian Bases | `.base` ファイルのビュー・フィルター・数式 |
| JSON Canvas | `.canvas` ファイルのノード・エッジ・グループ |
| 사람처럼 글쓰기 (한국어) | 韓国語を自然に書くためのルール |
| 비지니스 이메일/메신저 글쓰기 (영어) | 英語のビジネスメール・メッセージ作成 |
| Second Brain (LLM Wiki) | AI-firstノートの規約とSecond Brainツールの使い方 |

### Webクリッパー

アクションツールバーの地球アイコンをクリック → URLを入力。Webページを取得し、翻訳（必要に応じて）・要約してマークダウンノートとして保存します。

フロントマターには `source`（元のURL）、`created`（クリップ日）、`type: web-clip`、`tags: [web-clip]` の4項目が入ります。

### To-Do & アーカイブ

- **To-Do作成**: `{{date}}` / `{{prevDate}}`変数対応のテンプレートで日次ノートを生成
- **未完了引き継ぎ**: 前日の未完了タスクを階層構造を維持して自動引き継ぎ
- **自動アーカイブ**: 古いTo-Doファイルをアーカイブフォルダに移動
- **アーカイブ整理**: 設定タブで基準日数を設定し、古いアーカイブファイルを削除（フォルダと日数を設定可能）

### P.A.R.A セットアップ

1. 設定 → Bedrock Assistant → **ボルト管理**セクションを開きます。
2. 「テンプレートフォルダ」の次にある「P.A.R.A セットアップ」ボタンをクリックします。
3. ボルトのルートに4つのフォルダが作成されます：`01. Projects`、`02. Areas`、`03. Resources`、`04. Archives`
4. 既存のノートがある場合、現在設定されているAIモデルが各ノートを適切なフォルダに自動分類します。
5. 進捗モーダルでリアルタイムの状態と完了時のサマリーを確認できます。

### MCPサーバー設定

設定 → MCPサーバー → 設定を編集:

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

`uvx`（Python）と`docker`の両方に対応しています。上記の `fetch` のような検索系MCPを設定すると、チャットのWeb検索トグルも使えるようになります。

## ネットワーク使用

このプラグインは以下の外部サービスにネットワークリクエストを送信します：

- **AWS Bedrock API** — Bedrockバックエンド使用時、チャット・埋め込み・モデル一覧取得のためにAWS Bedrockエンドポイントにリクエストします。設定されたAWSリージョンによりエンドポイントが決まります（例：`bedrock-runtime.us-east-1.amazonaws.com`）。
- **Google Gemini API** — Geminiバックエンド使用時、チャット・埋め込み・モデル一覧取得のために`generativelanguage.googleapis.com`にリクエストします。
- **OpenAI API** — OpenAIバックエンド使用時、チャット・埋め込み・モデル一覧取得のために`https://api.openai.com/v1`（または設定したBase URL）にリクエストします。
- **Ollama** — Ollamaバックエンド使用時、設定したサーバーアドレス（既定`http://localhost:11434`）にリクエストします。
- **Webクリッパー** — Webクリッパー機能使用時、要約のために対象URLのページコンテンツを取得します。
- **MCPサーバー** — MCPサーバーが設定されている場合、ローカルで起動されたMCPサーバープロセスとstdioで通信します。

ナレッジギャップレポートと復習キューはローカル計算のみで、ネットワークリクエストは発生しません。サードパーティの分析やトラッキングサービスにデータを送信することはありません。

## デスクトップ専用

このプラグインはデスクトップ専用（`isDesktopOnly: true`）です。MCPサーバー統合がローカルの子プロセスをstdioで生成する方式のため、モバイルプラットフォームでは使用できません。

## ライセンス

[MIT](LICENSE)
