# Bedrock Assistant

[English](README.md) | [한국어](README-KR.md) | [日本語](README-JA.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/teinam)

AWS BedrockとGoogle Geminiのデュアルバックエンドに対応したObsidian AIアシスタントサイドバープラグインです。

## 主な機能

- **デュアルAIバックエンド** — 設定でAWS Bedrock (Claude)とGoogle Geminiを切り替え
- **ストリーミングチャット** — サイドバーでリアルタイムストリーミング応答
- **ボルトセマンティック検索** — 埋め込みでノートをインデックスし意味ベースで検索
- **タグ自動生成** — ノート内容を分析してタグを推薦
- **テンプレート** — 変数置換対応のカスタムテンプレート
- **To-Do管理** — 日次To-Do作成、未完了タスクの自動引き継ぎ、アーカイブ
- **アーカイブ整理** — モーダルUIで古いアーカイブファイルを整理
- **Webクリッパー** — URLからWebページを取得、翻訳・要約してマークダウンノートに保存
- **MCPサーバー連携** — Model Context Protocolサーバー（uvx、Docker対応）
- **ファイル管理** — AIによるノートの作成・編集・移動・削除
- **多言語対応** — English、한국어、日本語
- **ファイル添付** — ドラッグ＆ドロップ、クリップボード、ファイル検索（画像、PDF、テキスト）
- **チャットセッション履歴** — 過去の会話を保存・復元
- **Obsidianスキル** — AIがObsidian構文を正確に使用するための知識モジュール
- **破壊的ツール確認** — ファイル操作前のオプション確認ダイアログ
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

- **Bedrock** — AWS Bedrock (Claude)。AWS Access Key / Secret Keyが必要。
- **Gemini** — Google Gemini。[Google AI Studio](https://aistudio.google.com/)からAPIキーを取得。

バックエンドを切り替えると、サイドバーアイコン、モデルリスト、ブランディングが自動的に更新されます。

### 2. 資格情報を設定

**Bedrock:** AWS Access Key ID、Secret Access Key、Regionを入力します。

必要なIAM権限:
- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

**Gemini:** [Google AI Studio](https://aistudio.google.com/)から取得したAPIキーを入力します。

> **注意:** 資格情報はOSキーチェーン暗号化を使用して各デバイスにローカル保存され、iCloudでは同期されません。各デバイスで個別に設定してください。

### 3. サイドバーを開く

リボンアイコンをクリックするか、コマンドパレットで**「アシスタントを開く」**を実行します。

### 4. ボルトインデックス（オプション）

チャットヘッダーの🔍アイコンをクリックしてセマンティック検索用のノートインデックスを実行します。

## 使い方

### チャット

入力エリアにメッセージを入力してEnterを押すと、AIがリアルタイムストリーミングで応答します。ツールバーボタンでノートをコンテキストとして添付できます:

- 📎 現在のノートを添付
- 🔍 ファイルを検索して添付
- 📁 画像/PDFをファイル選択、ドラッグ＆ドロップ、クリップボード貼り付けで添付

### Webクリッパー

チャットヘッダーの地球アイコン（🌐）をクリック → URLを入力。Webページを取得し、翻訳（必要に応じて）・要約してフロントマター付きのマークダウンノートとして保存します。

### To-Do & アーカイブ

- **To-Do作成**: `{{date}}` / `{{prevDate}}`変数対応のテンプレートで日次ノートを生成
- **未完了引き継ぎ**: 前日の未完了タスクを階層構造を維持して自動引き継ぎ
- **自動アーカイブ**: 古いTo-Doファイルをアーカイブフォルダに移動
- **アーカイブ整理**: ゴミ箱ボタンで古いアーカイブファイルを削除（フォルダと日数を設定可能）

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

`uvx`（Python）と`docker`の両方に対応しています。

## ライセンス

[MIT](LICENSE)
