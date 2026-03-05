# Bedrock Assistant

[English](README.md) | [한국어](README-KR.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED.svg)
![AWS](https://img.shields.io/badge/AWS-Bedrock-FF9900.svg)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-CI/CD-2088FF.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/teinam)

An AI assistant sidebar plugin for Obsidian, powered by AWS Bedrock.

## Features

- **Claude Chat** — Chat with AWS Bedrock Claude models directly from the sidebar
- **Semantic Vault Search** — Index notes with Titan Embedding and search by meaning
- **Auto Tag Generation** — Analyze note content and suggest relevant tags
- **Templates** — Create and apply custom templates with variable substitution
- **To-Do Management** — Daily to-do creation, automatic carry-over of incomplete items (preserving hierarchy), archiving old to-dos
- **Archive Cleanup** — Clean up old archived files with a modal UI (recursive subfolder scan, empty folder removal, creation-date based filtering)
- **Web Clipper** — Fetch any web page by URL, translate and summarize via AI, save as a markdown note with frontmatter
- **MCP Server Integration** — Connect Model Context Protocol servers (uvx, Docker supported)
- **File Management** — Create, edit, move, and delete notes through AI
- **Multilingual UI** — English, Korean (한국어), Japanese (日本語)
- **File Attachments** — Attach context via drag-and-drop, clipboard, or file search
- **Chat Session History** — Save and restore past conversations
- **System Prompt Modal** — Edit system prompt in a dedicated popup modal

## Installation

### BRAT (Recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add this repository URL in BRAT settings
3. Enable the plugin

### Manual Installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest [Release](../../releases)
2. Copy them to `.obsidian/plugins/bedrock-assistant/` in your vault
3. Enable the plugin in Settings → Community Plugins

## Configuration

### AWS Authentication (3 methods)

| Method | Description |
|--------|-------------|
| **Manual** | Enter Access Key / Secret Key directly |
| **Env / Profile** | Use environment variables or `~/.aws/credentials` profile |
| **API Key** | Bedrock API Key (Bearer token) |

### Required IAM Permissions

- `bedrock:InvokeModelWithResponseStream`
- `bedrock:InvokeModel`
- `bedrock:ListFoundationModels`

## Web Clipper

Fetch a web page, translate (if needed), and summarize it into a markdown note.

- Click the globe icon in the chat header → enter a URL
- Configurable save folder and dedicated AI model in settings
- Language-aware: same language = summary only, different language = translate + summary
- Saved with frontmatter (source URL, date, language)

## To-Do & Archive

- **To-Do creation**: generates a daily note from a template with `{{date}}` / `{{prevDate}}` variables
- **Carry-over**: incomplete tasks from the previous day are carried over with full hierarchy preserved
- **Auto archive**: old to-do files are moved to the archive folder when creating a new to-do
- **Archive cleanup**: dedicated button to delete old archived files (configurable folder and day threshold, based on file creation date)

## MCP Server Setup

Navigate to Settings → MCP Servers → Edit Config and configure in JSON format:

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

Both `uvx` (Python) and `docker` commands are supported. The plugin automatically resolves command paths for GUI environments.

## License

[MIT](LICENSE)
