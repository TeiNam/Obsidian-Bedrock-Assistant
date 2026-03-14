# Assistant Kiro

[English](README.md) | [한국어](README-KR.md) | [日本語](README-JA.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![Google](https://img.shields.io/badge/Google-Gemini-4285F4.svg)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-CI/CD-2088FF.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/teinam)

An AI assistant sidebar plugin for Obsidian with dual backend support — **AWS Bedrock** and **Google Gemini**.
Switch between backends from the settings tab without reinstalling. Built and maintained with [Kiro](https://kiro.dev), an AI-powered IDE.

## Features

- **Dual AI Backend** — Switch between AWS Bedrock (Claude) and Google Gemini from settings
- **Streaming Chat** — Real-time streaming responses in the sidebar
- **Semantic Vault Search** — Index notes with embeddings (Titan / Gemini) and search by meaning
- **Auto Tag Generation** — Analyze note content and suggest relevant tags
- **To-Do Management** — Daily to-do creation from templates, automatic carry-over of incomplete items (preserving hierarchy), archiving
- **Archive Cleanup** — Clean up old archived files with a modal UI
- **Web Clipper** — Fetch a web page by URL, translate and summarize via AI, save as markdown
- **MCP Server Integration** — Connect Model Context Protocol servers (uvx, Docker)
- **File Management** — Create, edit, move, and delete notes through AI tool calls
- **Multilingual UI** — English, Korean (한국어), Japanese (日本語)
- **File Attachments** — Attach context via drag-and-drop, clipboard, file search, or images/PDFs
- **Chat Session History** — Save and restore past conversations with search
- **Daily Retrospective** — Generate an AI-powered daily review based on your To-Do
- **Context Window Indicator** — Visual ring showing token usage
- **Obsidian Skills** — Enable Obsidian-specific knowledge (Dataview, Tasks, Templater) in the system prompt
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
2. Choose your AI backend (Gemini or Bedrock)
3. Enter your credentials:
   - **Gemini**: Paste your API key from [Google AI Studio](https://aistudio.google.com/apikey)
   - **Bedrock**: Enter AWS Access Key, Secret Key, and Region
4. Click the Assistant Kiro icon in the left ribbon to open the sidebar
5. Start chatting!

## AI Backend Configuration

### Switching Backends

Open Settings → Assistant Kiro Settings → AI Backend dropdown. Switching instantly updates the sidebar icon, branding, and model list. Your credentials for each backend are saved independently.

### Google Gemini

| Setting | Description |
|---------|-------------|
| API Key | Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) |
| Chat Model | Select from available Gemini models (dropdown) |
| Embedding Model | Model for vault indexing (default: `text-embedding-004`) |

### AWS Bedrock

| Setting | Description |
|---------|-------------|
| Access Key ID | AWS IAM access key |
| Secret Access Key | AWS IAM secret key |
| Region | AWS region (e.g. `us-east-1`) |
| Chat Model | Select from available Bedrock models (dropdown) |
| Embedding Model | Model for vault indexing (default: `amazon.titan-embed-text-v2:0`) |

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

### Vault Indexing

1. Click the search icon in the sidebar header (or use the command palette: "Index vault")
2. The plugin indexes all markdown files using embeddings
3. Once indexed, the AI can search your vault semantically when answering questions
4. Files are automatically re-indexed when modified (2-second debounce)

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

1. Click the book icon in the action toolbar
2. Confirm that you've finished today's tasks
3. The AI generates a retrospective summary and appends it to today's To-Do

### Web Clipper

1. Click the globe icon in the action toolbar
2. Enter a URL
3. The AI fetches the page, translates (if needed), and summarizes it
4. Saved as a markdown note with frontmatter (source URL, date, language)

### Archive Cleanup

1. Click the trash icon in the action toolbar
2. Select files to delete from the archive folder
3. Filtering is based on file creation date and the configured day threshold

### Web Search

Toggle the globe button in the input toolbar to enable web search. When enabled, the AI will search the web for up-to-date information and include source URLs.

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

## License

[MIT](LICENSE)
