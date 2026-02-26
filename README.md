# Bedrock Assistant

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
- **To-Do Management** — Daily to-do creation, automatic carry-over of incomplete items, archiving
- **MCP Server Integration** — Connect Model Context Protocol servers (uvx, Docker supported)
- **File Management** — Create, edit, move, and delete notes through AI
- **Multilingual UI** — English and Korean
- **File Attachments** — Attach context via drag-and-drop, clipboard, or file search
- **Chat Session History** — Save and restore past conversations

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
