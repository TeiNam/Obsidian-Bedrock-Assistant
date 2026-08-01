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

An AI assistant sidebar plugin for Obsidian with multi-provider backend support — AWS Bedrock, Google Gemini, OpenAI, and Ollama.

> **Note on command names:** the command palette labels shipped by this plugin are currently Korean only. This document quotes them verbatim so you can find them in the palette.

## Features

- **Multi-Provider AI Backend** — Switch between AWS Bedrock (Claude), Google Gemini, OpenAI, and Ollama from settings
- **Streaming Chat** — Real-time streaming responses in the sidebar
- **Graph RAG Vault Search** — Chunk-level embeddings combined with link traversal (outlinks and backlinks) and a minimum relevance threshold
- **Second Brain Layer** — Opt-in knowledge layer (off by default) that can write wiki notes into a dedicated folder, with sentinel blocks that preserve your own notes
- **Knowledge Gap Report** — Finds structural gaps in the vault from index data alone (0 LLM calls)
- **Review Queue** — Resurfaces 5 notes you have not opened in a while but that are well linked (0 LLM calls)
- **Conversation Harvest** — Extracts conclusions, decisions, rationale, and open questions from a saved chat session into a searchable note
- **Reasoning Effort** — Set reasoning depth per model; omitted on models that do not support it
- **Auto Tag Generation** — Analyze note content and suggest relevant tags
- **Templates** — Custom templates with variable substitution
- **To-Do Management** — Daily to-do, automatic carry-over of incomplete items, archiving
- **Archive Cleanup** — Clean up old archived files from the settings tab
- **P.A.R.A Organizer** — Set up the P.A.R.A folder structure (Projects, Areas, Resources, Archives) and use AI to classify existing notes
- **Web Clipper** — Fetch, translate, and summarize web pages as markdown notes
- **MCP Server Integration** — Model Context Protocol servers (uvx, Docker)
- **File Management** — Create, edit, move, and delete notes through AI
- **Multilingual UI** — English, 한국어, 日本語
- **File Attachments** — Drag-and-drop, clipboard, file search (images, PDFs, text)
- **Chat Session History** — Save and restore past conversations
- **Obsidian Skills** — Six built-in knowledge modules: `obsidian-markdown`, `obsidian-bases`, `json-canvas`, `korean-writing`, `business-english-writing`, `second-brain`
- **Chat Retrospective** — Type "회고", "retrospective", or "振り返り" in chat to auto-generate a daily retrospective, chained with the retrospective sections of the last 7 days so recurring problems stay visible
- **Chat Export** — Export conversations as markdown files
- **Response Regeneration** — Regenerate the last AI response
- **Conversation Search** — Search through saved chat sessions
- **MCP JSON Editor** — Real-time validation, auto-formatting, bracket matching, and templates
- **Destructive Tool Confirmation** — Optional confirmation before file operations
- **Context Window Management** — Automatic token trimming

## Installation

### BRAT (Recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add this repository URL in BRAT settings: `https://github.com/teinam/obsidian-ai-assistant`
3. Enable the plugin

### Manual

1. Download `main.js`, `styles.css`, `manifest.json` from the latest [Release](../../releases)
2. Copy to `.obsidian/plugins/ai-assistant/`
3. Enable in Settings → Community Plugins

### Upgrading from 0.2.x

Version 0.3.0 changes the plugin ID from `bedrock-assistant` to `ai-assistant`.

- **Disable the old plugin before enabling the new one.** If both are enabled simultaneously, the old plugin's index save can interleave with the new plugin's migration read, resulting in a torn copy (this self-heals through re-indexing but takes time).
- **The plugin folder changes, so reinstallation is required.** If you use BRAT, remove the old entry and add it again.
- **Settings (`data.json`)**, vault index, chat history, sessions, MCP config, and credentials **are automatically copied on first launch**. Your backend choice, models, region, Second Brain settings, and custom skills are all preserved. The old files remain in place, so rolling back to a previous version works seamlessly.
- **You must reopen the sidebar once.** Obsidian records view identifiers in the workspace layout, and the plugin cannot rewrite that for you.
- A notice appears once the migration completes. The old data files (`.bedrock-assistant-*.json`) are no longer used — you may delete them manually if vault size is a concern. The index file can be tens of MB due to embeddings.

If you were using the `kiro-edition` (Assistant Kiro), the same migration applies. That edition was merged into main in 0.3.0, and `.assistant-kiro-*.json` data is also migrated automatically.

## Quick Start

### 1. Choose AI Backend

Settings → AI Assistant → **AI Backend**:

- **Bedrock** — AWS Bedrock (Claude and other Bedrock-hosted models)
- **Gemini** — Google Gemini. Requires an API key from [Google AI Studio](https://aistudio.google.com/).
- **OpenAI** — OpenAI or any OpenAI-compatible endpoint
- **Ollama** — A local Ollama server

The sidebar icon, model list, and branding update dynamically when you switch.

> **Backend support policy:** This plugin relies on embedding APIs for Graph RAG vault search, so only providers with embedding endpoints are supported. The Anthropic direct API is excluded because it offers no embedding endpoint — use the Bedrock backend to access Claude models.

### 2. Configure Credentials

**Bedrock:** Choose one of three authentication methods, then set the AWS Region.

| Method | What you provide |
|--------|------------------|
| Access Key | AWS Access Key ID and Secret Access Key |
| Bedrock API Key | A long-term Bedrock API key, sent as a bearer token |
| AWS Profile | A profile name from `~/.aws/config` or `~/.aws/credentials`. For SSO profiles, run `aws sso login --profile <name>` in a terminal first. |

Required IAM permissions:
- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

**Gemini:** Enter your API key from [Google AI Studio](https://aistudio.google.com/).

**OpenAI:** Enter your API key. To use an OpenAI-compatible endpoint, set the base URL including `/v1`; leave it empty for the official API.

**Ollama:** Enter the server base URL, or leave it empty to use `http://localhost:11434`. No API key is needed.

> **Note:** Credentials are stored locally using OS keychain encryption and are NOT synced via iCloud. Configure on each device separately.

### 3. Open the Sidebar

Click the ribbon icon, or run the command **어시스턴트 열기** ("Open Assistant") from the command palette.

### 4. Index Your Vault (Optional)

Click 🔍 in the chat header to index notes for semantic search, or run **볼트 인덱싱**. Indexing is required for Graph RAG search and for the Second Brain tools that search the vault. `emerge` needs the index too, because it enumerates index entries. `architect` and `update_index` read the vault file list directly and work without an index.

## Usage

### Chat

Type a message in the input area and press Enter. The AI responds in real-time streaming. Attach notes for context using the toolbar buttons:

- 📎 Attach current note
- 🔍 Search and attach any file
- 📁 Attach images/PDFs via file picker, drag-and-drop, or clipboard paste

The web search toggle (globe icon) in the input toolbar only turns on if a search MCP (`fetch`, `exa`, or `brave`) is configured, or if you are on the Gemini backend, which has native Google Search grounding. Otherwise clicking it shows a notice and the toggle stays off.

### Reasoning Effort

Settings → AI Assistant → **Generation Settings** → **Reasoning Effort** sets how much reasoning the model does.

Allowed values depend on the selected provider and model (for example, Anthropic models on Bedrock accept `xhigh` and `max`; Gemini Pro models accept only `low` and `high`). The setting is only shown for models that support reasoning effort, and requests to models that do not support it fall back to the provider's default sampling behavior. If you switch to a model that does not allow your saved value, it is clamped to the nearest allowed level.

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

### Web Clipper

Click the globe icon (🌐) in the action toolbar above the chat input → enter a URL. The page is fetched, translated (if needed), and summarized as a markdown note.

The generated frontmatter has four fields: `source` (the URL), `created` (the date), `type: web-clip`, and `tags: [web-clip]`.

### To-Do & Archive

- **To-Do**: Generates a daily note from a template with `{{date}}` / `{{prevDate}}` variables
- **Carry-over**: Incomplete tasks from the previous day are carried over with hierarchy preserved
- **Auto archive**: Old to-do files move to the archive folder
- **Archive cleanup**: Delete old archived files from the settings tab (configurable folder and day threshold)

### P.A.R.A Organizer

1. Open Settings → AI Assistant and scroll to the **Vault** section
2. Click the **Set Up P.A.R.A** button, directly below the Template Folder setting
3. The plugin creates four root folders: `01. Projects`, `02. Areas`, `03. Resources`, `04. Archives`
4. If existing notes are found, the currently configured AI model classifies each note into the appropriate folder
5. A progress modal shows real-time status and a summary when complete

### MCP Server

Settings → MCP Servers → Edit Config:

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

Both `uvx` (Python) and `docker` are supported.

## Network Usage

This plugin makes network requests to the following external services:

- **AWS Bedrock API** — When using the Bedrock backend, requests are sent to AWS Bedrock endpoints for chat, embedding, and model listing. The specific region endpoint depends on your configured AWS Region (e.g., `bedrock-runtime.us-east-1.amazonaws.com`).
- **Google Gemini API** — When using the Gemini backend, requests are sent to `generativelanguage.googleapis.com` for chat, embedding, and model listing.
- **OpenAI API** — When using the OpenAI backend, requests are sent to `https://api.openai.com/v1` for chat, embedding, and model listing, or to the OpenAI-compatible base URL you configure.
- **Ollama** — When using the Ollama backend, requests are sent to your Ollama server (default `http://localhost:11434`), which is local unless you point it elsewhere.
- **Web Clipper** — When using the Web Clipper feature, the plugin fetches the target URL to retrieve page content for summarization.
- **MCP Servers** — When MCP servers are configured, the plugin communicates with locally spawned MCP server processes via stdio.

No data is sent to any third-party analytics or tracking services.

## Desktop Only

This plugin is desktop-only (`isDesktopOnly: true`) because MCP server integration relies on spawning local child processes via stdio, which is not available on mobile platforms.

## License

[MIT](LICENSE)
