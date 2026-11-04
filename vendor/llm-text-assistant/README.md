# 🤖 LLM Text Assistant – Obsidian Plugin

**Process, translate and refine text in your Obsidian notes with LLMs, directly in the editor**

<div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">
  <img src="https://img.shields.io/badge/Obsidian-Plugin-7C3AED?style=for-the-badge&logo=obsidian&logoColor=white" alt="Obsidian Plugin">
  <a href="LICENSE" target="_blank"><img src="https://img.shields.io/badge/License-GPL--3.0-blue?style=for-the-badge" alt="License GPL-3.0"></a>
  <a href="https://www.buymeacoffee.com/s1t5" target="_blank"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-s1t5-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee"></a>
  <a href="https://ko-fi.com/s1t5dev" target="_blank"><img src="https://img.shields.io/badge/Ko--Fi-s1t5dev-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
</div>

This is the **Obsidian edition** of LLM Text Assistant — the browser extension (Chrome/Firefox/Thunderbird) by the same author, with the same actions, prompts and streaming behaviour, adapted to the Obsidian editor.

## ✨ Key Features

### 📌 Core Features
- **Four built-in actions**: 🌐 Translate, ✍️ Expand, 📋 Summarize, ✅ Grammar & Spelling, available via the editor context menu (right-click), the command palette, the ribbon icon ✨ and its action menu
- **Custom actions**: Define your own actions with emoji, title and system prompt
- **Free Prompt (Chat mode)**: Open a chat window with the current selection as context and give iterative instructions with full context; apply the result back into the note — with ready-made preset chips (Shorter / More formal / As email / Bullet list) and an optional **note context** (note title, vault path, surrounding text)
- **Copy responses**: Hover any response for its ⧉ copy button, use "Copy last response", or press Ctrl/Cmd+C with nothing selected
- **Streaming results (live typing)**: Text appears token by token as the model generates it, no waiting for the full response
- **Selection or whole note**: Processes the selection — or the entire note when nothing is selected
- **Review before replacing** (optional): Show an old→new diff and only write the result after you confirm

### ⌨️ UX
- **Undo toast**: After every replacement a toast appears with an **Undo** button (8 seconds)
- **Cancel requests**: Abort a running request by clicking the "Processing…" toast or the stop button in chat, already received text is kept
- **Native Obsidian hotkeys**: Every action — the four built-in ones, every custom action and the free prompt — is a command; assign hotkeys via Obsidian's Hotkeys settings
- **Robust error handling**: Configurable timeout (default 60s), automatic retries on network errors and rate limits (429/5xx), clear error messages (e.g. "check your API key" on 401)

### 🔌 Provider Support
- Works with **any OpenAI-compatible Chat Completions API**:
  - **Cloud**: OpenAI, Mistral, Groq, Google Gemini (OpenAI-compat endpoint) and more
  - **Local**: Ollama, LM Studio, llama.cpp, vLLM; no API key required, data never leaves your machine
- **Flexible configuration**: API URL, API key, model, temperature, timeout
- **Model list from the endpoint**: "Load models" queries `GET <base>/models` and offers the available models as autocomplete for the model field
- **Customizable system prompts** for every built-in action (e.g. `{TARGET_LANGUAGE}` placeholder for translation)

### 🌍 Internationalization
- Full UI and default prompts in **English and German** (auto-selected by Obsidian language)
- Target language for translation is freely configurable

## 🚀 Quick Start

### Prerequisites
- [Obsidian](https://obsidian.md) 1.8.7 or newer (Restricted Mode off for community plugins)
- An OpenAI-compatible API endpoint (cloud or local)

### 🛠️ Installation

Install the plugin directly from the **Obsidian Community directory**:

👉 **https://community.obsidian.md/plugins/llm-text-assistant**

Or from within Obsidian: **Settings → Community Plugins → Browse** → search for **LLM Text Assistant** → Install.

Then:
1. Enable **LLM Text Assistant** under Settings → Community Plugins
2. Configure your endpoint under Settings → LLM Text Assistant

<details>
<summary>Manual install (if the directory is temporarily unavailable)</summary>

1. Download `main.js`, `styles.css` and `manifest.json` from the latest [release](../../releases)
2. Create the folder `<your-vault>/.obsidian/plugins/llm-text-assistant/` and copy the three files into it — or use Obsidian 1.8+: **Settings → Community Plugins → Install from files**
3. Enable the plugin and configure your endpoint as above
</details>

## ⚙️ Configuration

Open **Settings → LLM Text Assistant**:

| Setting | Description |
|---------|-------------|
| **API URL** | Chat Completions endpoint, e.g. `https://api.openai.com/v1/chat/completions` |
| **API Key** | Your API key (leave empty for local endpoints) |
| **Model** | e.g. `gpt-4o-mini`, `llama3.1`, `mistral`. **Load models** fetches the endpoint's model list as autocomplete |
| **Temperature** | Creativity (0–2, default: 0.3) |
| **Timeout (seconds)** | Max wait time per attempt (default: 60). Retries twice on timeout. |
| **Target language (Translate)** | Language to translate into (e.g. English, German, French) |
| **System prompts** | Per-action instructions, e.g. `{TARGET_LANGUAGE}` placeholder for translation |
| **Custom actions** | Your own actions with emoji, title and prompt |
| **Free prompt** | Show/hide the 💬 Free prompt entry |
| **Pass note context to the chat** | Also give the free prompt the note title, vault path and the surrounding text (default: off) |
| **Max note-context characters** | Cap for the note context (`0` = off, default: 600) |
| **Confirm result before replacing** | Show an old→new diff and only write the result after you confirm (default: off) |

Hotkeys: every action — built-in, custom and the free prompt — appears in Obsidian's command palette; assign hotkeys under **Settings → Hotkeys**.

### Local endpoint examples

| Provider | URL | API Key |
|----------|-----|---------|
| **Ollama** | `http://localhost:11434/v1/chat/completions` | leave empty |
| **LM Studio** | `http://localhost:1234/v1/chat/completions` | leave empty |

## 📖 Usage

1. Select text in the editor (or select nothing to process the **whole note**)
2. Choose an action via right-click context menu, command palette (`Ctrl/Cmd+P`), the ribbon icon ✨ or its action menu
3. The processed text replaces the selection **live** (streaming)
4. **Cancel**: click the "Processing…" toast or ⏹ Stop in the chat
5. **Undo**: use the button in the toast (8 seconds)
6. **Copy**: in the free prompt chat, hover a response and click ⧉, use "Copy last response", or press Ctrl/Cmd+C with nothing selected

### 💬 Free Prompt (Chat mode)

Open it via the context menu or the action menu. Your current selection is loaded as context — give instructions one after another, e.g. "Improve the text" or "Translate into English". **✓ Apply** writes the result into the editor, **⧉** copies it to the clipboard, **↺ Reset** restarts the chat with fresh context.

- **Preset chips** (Shorter / More formal / As email / Bullet list) drop a ready-made instruction into the input field — they never send on their own
- **Note context**: The "Note context" switch in the chat header adds the note title, its vault path and the surrounding text to every request. It starts from the setting *Pass note context to the chat* and can be toggled per chat session

### ✅ Review before replacing

With *Confirm result before replacing* enabled, every action shows a **Review changes** window after the result has streamed in: removed words are struck through in red, added words are highlighted in green. **Apply** keeps the result (the undo toast still works), **Discard** (or Esc) restores the original text — nothing is ever written without your confirmation.

## 🔒 Privacy & Security Notes

- **No data collection**: The plugin collects nothing. API calls go directly from Obsidian to the endpoint you configured, there is no intermediate server
- **API key storage**: Your API key is stored in the plugin settings of your vault (`.obsidian/plugins/llm-text-assistant/data.json`) and only sent as `Authorization` header to the configured endpoint

## 🏗️ Development

Prerequisites: Node.js ≥ 20 and npm.

```bash
npm install
npm run build      # type-check (tsc) + bundle main.js
npm run typecheck  # TypeScript check only
npm run smoke      # core tests without an Obsidian runtime (streaming, retry, abort, i18n)
npm run dev        # watch mode for development
```

The smoke tests mock Obsidian's `requestUrl` via a Node loader hook (`scripts/smoke-hook.mjs`) — no Obsidian installation required. See `AGENTS.md` for conventions and release details.

## 🤝 Contributing

We welcome contributions from the community!

For code changes by third parties, please coordinate with us via email at mail@s1t5.dev before making any changes.

You can also:
- Open an Issue for bug reports or feature requests
- Submit a Pull Request for improvements
- Help improve documentation

## 💖 Support the Project

If you find this project useful and would like to support its continued development, you can buy me a coffee! Your support helps me dedicate more time and resources to improving the application and adding new features. While financial support is not required, it is greatly appreciated and helps ensure the project's ongoing maintenance and development.

<div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">
  <a href="https://www.buymeacoffee.com/s1t5" target="_blank"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-s1t5-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee"></a>
  <a href="https://ko-fi.com/s1t5dev" target="_blank"><img src="https://img.shields.io/badge/Ko--Fi-s1t5dev-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
  <a href="https://github.com/sponsors/s1t5" target="_blank"><img src="https://img.shields.io/badge/GitHub%20Sponsors-s1t5-FF9A00?style=for-the-badge&logo=github-sponsors&logoColor=white" alt="GitHub Sponsors"></a>
</div>

---

📄 *License: GNU GENERAL PUBLIC LICENSE Version 3 (see LICENSE file)*