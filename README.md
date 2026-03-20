# Bedrock Assistant

[English](README.md) | [한국어](README-KR.md) | [日本語](README-JA.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/teinam)

An AI assistant sidebar plugin for Obsidian with dual backend support — AWS Bedrock and Google Gemini.

## Features

- **Dual AI Backend** — Switch between AWS Bedrock (Claude) and Google Gemini from settings
- **Streaming Chat** — Real-time streaming responses in the sidebar
- **Semantic Vault Search** — Index notes with embeddings and search by meaning
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
- **Obsidian Skills** — Built-in knowledge modules for accurate Obsidian syntax
- **Destructive Tool Confirmation** — Optional confirmation before file operations
- **Context Window Management** — Automatic token trimming

## Installation

### BRAT (Recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add this repository URL in BRAT settings: `https://github.com/teinam/obsidian-bedrock-assistant`
3. Enable the plugin

### Manual

1. Download `main.js`, `styles.css`, `manifest.json` from the latest [Release](../../releases)
2. Copy to `.obsidian/plugins/bedrock-assistant/`
3. Enable in Settings → Community Plugins

## Quick Start

### 1. Choose AI Backend

Settings → Bedrock Assistant → **AI Backend**:

- **Bedrock** — AWS Bedrock (Claude). Requires AWS Access Key / Secret Key.
- **Gemini** — Google Gemini. Requires API key from [Google AI Studio](https://aistudio.google.com/).

The sidebar icon, model list, and branding update dynamically when you switch.

### 2. Configure Credentials

**Bedrock:** Enter your AWS Access Key ID, Secret Access Key, and Region.

Required IAM permissions:
- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

**Gemini:** Enter your API key from [Google AI Studio](https://aistudio.google.com/).

> **Note:** Credentials are stored locally using OS keychain encryption and are NOT synced via iCloud. Configure on each device separately.

### 3. Open the Sidebar

Click the ribbon icon or use command palette: **"Open Assistant"**.

### 4. Index Your Vault (Optional)

Click 🔍 in the chat header to index notes for semantic search.

## Usage

### Chat

Type a message in the input area and press Enter. The AI responds in real-time streaming. Attach notes for context using the toolbar buttons:

- 📎 Attach current note
- 🔍 Search and attach any file
- 📁 Attach images/PDFs via file picker, drag-and-drop, or clipboard paste

### Web Clipper

Click the globe icon (🌐) in the chat header → enter a URL. The page is fetched, translated (if needed), and summarized as a markdown note with frontmatter.

### To-Do & Archive

- **To-Do**: Generates a daily note from a template with `{{date}}` / `{{prevDate}}` variables
- **Carry-over**: Incomplete tasks from the previous day are carried over with hierarchy preserved
- **Auto archive**: Old to-do files move to the archive folder
- **Archive cleanup**: Delete old archived files from the settings tab (configurable folder and day threshold)

### P.A.R.A Organizer

1. Open Settings → Bedrock Assistant → User Experience section
2. Click the "Set up P.A.R.A" button below the welcome greeting
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
- **Web Clipper** — When using the Web Clipper feature, the plugin fetches the target URL to retrieve page content for summarization.
- **MCP Servers** — When MCP servers are configured, the plugin communicates with locally spawned MCP server processes via stdio.

No data is sent to any third-party analytics or tracking services.

## License

[MIT](LICENSE)
