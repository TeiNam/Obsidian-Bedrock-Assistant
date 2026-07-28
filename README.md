# Assistant Kiro

[English](README.md) | [한국어](README-KR.md) | [日本語](README-JA.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/teinam)

An AI assistant sidebar plugin for Obsidian powered by **AWS Bedrock**.
Built and maintained with [Kiro](https://kiro.dev), an AI-powered IDE.

## Features

- **AWS Bedrock Backend** — Powered by AWS Bedrock (Claude) models, with three authentication methods: access key, Bedrock API key, or a `~/.aws` shared profile
- **Streaming Chat** — Real-time streaming responses in the sidebar
- **Graph RAG Vault Search** — Chunk-level embeddings combined with link-graph traversal, filtered by a minimum relevance threshold
- **Second Brain Layer (opt-in, off by default)** — Thinking tools that only read your notes, plus generation tools that write into a single wiki folder
- **Knowledge Gaps Report** — Structural gaps computed locally from index data (0 LLM calls)
- **Review Queue** — Surfaces well-linked notes you have not opened in a while (0 LLM calls)
- **Conversation Harvest** — Extract conclusions, decisions, rationale, and open questions from a saved chat session into a searchable note
- **Daily Retrospective** — Type `회고`, `retrospective`, or `振り返り` in chat to generate a review of today's To-Do. The prompt also carries the retrospective sections of the previous 7 days, with no extra LLM calls
- **Auto Tag Generation** — Analyze note content and suggest relevant tags
- **To-Do Management** — Daily to-do creation from templates, automatic carry-over of incomplete items (preserving hierarchy), archiving
- **Archive Cleanup** — Clean up old archived files from the settings tab
- **P.A.R.A Organizer** — Set up the P.A.R.A folder structure (Projects, Areas, Resources, Archives) and use AI to classify existing notes
- **Web Clipper** — Fetch a web page by URL, translate and summarize via AI, save as markdown
- **MCP Server Integration** — Connect Model Context Protocol servers (uvx, Docker)
- **File Management** — Create, edit, move, and delete notes through AI tool calls
- **Multilingual UI** — English, Korean (한국어), Japanese (日本語)
- **File Attachments** — Attach context via drag-and-drop, clipboard, file search, or images/PDFs
- **Chat Session History** — Save and restore past conversations with search
- **Chat Export** — Export conversations as markdown files
- **MCP JSON Editor** — Real-time validation, auto-formatting, bracket matching, and templates
- **Context Window Indicator** — Visual ring showing token usage
- **Obsidian Skills** — Obsidian Markdown, Obsidian Bases, and JSON Canvas knowledge is always part of the system prompt; the Korean writing, business English writing, and Second Brain packs are toggles, and you can add your own custom skills
- **Destructive Tool Confirmation** — Optional confirmation dialog before file-modifying operations

## Installation

### BRAT (Recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add this repository URL in BRAT settings
3. Enable the plugin

### Manual Installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest [Release](../../releases)
2. Copy them to `.obsidian/plugins/assistant-kiro/` in your vault
3. Enable the plugin in Settings → Community Plugins

## Quick Start

1. Open Settings → Assistant Kiro Settings
2. Under **AWS Bedrock**, pick an authentication method and fill in the fields it shows
3. Enter your AWS Region (e.g. `us-east-1`), then pick a chat model from the dropdown
4. Click the Assistant Kiro icon in the left ribbon to open the sidebar
5. Start chatting!

## AWS Bedrock Configuration

This edition uses AWS Bedrock as its only backend. There is no backend selector.

### Authentication Methods

Choose one in Settings → Assistant Kiro Settings → AWS Bedrock → Authentication Method. Only the fields for the selected method are shown.

| Method | Fields | Notes |
|--------|--------|-------|
| Access key | Access Key ID, Secret Access Key | Standard IAM credentials. If both are left empty, the AWS SDK default credential chain (environment variables, IAM role) is used instead. |
| Bedrock API key | Bedrock API Key | A long-term Bedrock API key, sent as a bearer token instead of SigV4 signing. |
| AWS profile (`~/.aws`) | Profile (dropdown) | Reads a profile from `~/.aws/config` or `~/.aws/credentials`. Static-credential and SSO profiles are both supported. For an SSO profile, run `aws sso login --profile <name>` in a terminal first — the plugin does not run the browser login flow itself, and it reports when the cached token is missing or expired. |

A **Region** is required for all three methods.

### Settings

| Setting | Description |
|---------|-------------|
| Region | AWS region for the Bedrock API (e.g. `us-east-1`) |
| Chat Model | Select from available Bedrock models (dropdown) |
| Embedding Model | Model used for vault indexing. Selected from a dropdown of available Bedrock embedding models; there is no default, so pick one before indexing |
| Max Tokens | Maximum response tokens |
| Reasoning Effort | Reasoning depth. Shown only for models that accept it; for models that do not, a temperature slider is shown instead |

#### Required IAM Permissions

```
bedrock:InvokeModelWithResponseStream
bedrock:InvokeModel
bedrock:ListFoundationModels
```

## Usage Guide

### Chat

- Type a message and press Enter (Shift+Enter for newline)
- The AI responds with streaming text, rendered as markdown
- Click the regenerate button to get a different response
- Press Escape to stop generation mid-stream

### File Attachments

| Method | Description |
|--------|-------------|
| Auto-attach | Current note is automatically included as context (toggle in settings) |
| Manual attach | Click the file-plus icon or search icon in the input toolbar |
| Drag & drop | Drag files directly into the input area |
| Clipboard paste | Paste screenshots or images from clipboard |
| Binary files | Attach images (PNG, JPG, GIF, WebP) and PDFs via the paperclip icon |

### Graph RAG Vault Search

Notes are split into chunks and embedded, then a search walks outlinks and backlinks
from the best matches to pull in related neighbours. Start indexing from the search icon
in the sidebar header, or the `볼트 인덱싱` command. Edited files are re-indexed automatically.

Details: [Graph RAG & Second Brain](docs/second-brain-en.md)

### Second Brain Layer

A layer that creates and maintains wiki notes grounded in your existing notes.
It is **off by default** — enable it explicitly under Settings → Second Brain.

- Read-only tools (challenge, connect, emerge, reconcile) never create notes; they only return analysis.
- Generation tools (synthesize, architect, and others) write only inside the wiki folder you configure.
- Generated regions are wrapped in `<!-- @generated:KEY -->` markers, so regenerating **keeps any notes you wrote yourself in the same file**.

Details: [Graph RAG & Second Brain](docs/second-brain-en.md)

### Tag Generation

1. Open a note in the editor
2. Click the tag icon in the sidebar action toolbar
3. The AI analyzes the note and suggests 3–5 tags
4. Tags are automatically added to the note's frontmatter

### To-Do Management

1. Configure a To-Do folder and template in settings
2. Click the check-square icon to create today's To-Do
3. Incomplete tasks from the previous day are automatically carried over (hierarchy preserved)
4. Old To-Do files are auto-archived based on the configured day threshold

### Daily Retrospective

Type `회고`, `retrospective`, or `振り返り` into the chat input and send it. The message is intercepted before any normal chat request, so it works in any UI language. The AI generates a retrospective summary and appends it to today's To-Do.

The prompt also includes the retrospective sections from the previous 7 days (up to 1000 characters each), so recurring problems and whether they improved stay visible instead of resetting every day. Only the retrospective section is included, not the whole daily note, and this adds **no extra LLM calls**. With no past retrospectives present, behaviour is the same as before.

### Web Clipper

1. Click the globe icon in the action toolbar
2. Enter a URL
3. The AI fetches the page, translates (if needed), and summarizes it
4. Saved as a markdown note with frontmatter: `source`, `created`, `type: web-clip`, and `tags: [web-clip]`

### Archive Cleanup

1. Open Settings → Assistant Kiro Settings → To-Do section
2. Set the archive cleanup threshold (days) and click the cleanup button next to it
3. Files older than the threshold are listed for deletion from the archive folder

### P.A.R.A Organizer

1. Open Settings → Assistant Kiro Settings → Vault section
2. Click the "Set Up P.A.R.A" button, just below the Template Folder setting
3. The plugin creates four root folders: `01. Projects`, `02. Areas`, `03. Resources`, `04. Archives`
4. If existing notes are found, the currently configured AI model classifies each note into the appropriate folder
5. A progress modal shows real-time status and a summary when complete
6. Notes already inside a P.A.R.A folder are skipped automatically

### Web Search

Web search requires a search MCP server — one whose server or tool name contains `fetch`, `exa`, or `brave`. Configure it under Settings → MCP Servers first; without one, the globe button in the input toolbar shows a notice and stays off.

Once a search MCP is connected, toggle the globe button in the input toolbar to enable web search. The AI then searches the web for up-to-date information and includes source URLs.

## MCP Server Setup

Navigate to Settings → MCP Servers → Edit Config:

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

Both `uvx` (Python) and `docker` commands are supported. The plugin automatically resolves command paths for GUI environments. Connected servers show a status indicator at the bottom of the chat input.

## Credential Storage

Credentials are stored in a **local-only path** (`~/Library/Application Support/obsidian/`) that is **not synced by iCloud**. All other settings sync normally via `data.json`.

> **Note:** API keys are stored per-device. If you use iCloud vault sync, configure credentials on each device separately.

## Network Usage

This plugin makes network requests to the following external services:

- **AWS Bedrock API** — Requests are sent to AWS Bedrock endpoints for chat, embedding, and model listing. The specific region endpoint depends on your configured AWS Region (e.g., `bedrock-runtime.us-east-1.amazonaws.com`).
- **AWS SSO** — With AWS profile authentication and an SSO profile, the plugin calls the SSO portal to exchange the access token cached by `aws sso login` for temporary credentials.
- **Web Clipper** — When using the Web Clipper feature, the plugin fetches the target URL to retrieve page content for summarization.
- **MCP Servers** — When MCP servers are configured, the plugin communicates with locally spawned MCP server processes via stdio.

No data is sent to any third-party analytics or tracking services.

## Desktop Only

This plugin is desktop-only (`isDesktopOnly: true`) because MCP server integration relies on spawning local child processes via stdio, which is not available on mobile platforms.

## License

[MIT](LICENSE)
