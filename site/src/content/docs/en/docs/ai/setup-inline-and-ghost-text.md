---
title: "Setup, inline edits, and Ghost Text"
---


Baram has built-in AI writing assistance powered by Claude, OpenAI, OpenRouter, Google Gemini, and Ollama (local).

## Setup

1. Open Settings with `Cmd+,` (macOS) or `Ctrl+,` (Windows/Linux)
2. Go to the **AI** tab
3. Select your AI provider (Claude, OpenAI, OpenRouter, Gemini, or Ollama)
4. Enter your API key (each provider has its own key field; Ollama requires no key)
5. Choose your preferred model (models are loaded dynamically from the provider)

## Privacy Mode

Enable Privacy Mode in **Settings > AI** to prevent document content from being sent to cloud AI providers. When Privacy Mode is on, only Ollama (local) is allowed.

Privacy can be set globally or per-file using frontmatter:

```yaml
---
privacy: true
---
```

---

## Inline AI Editing (`Cmd+J`)

Press `Cmd+J` (macOS) or `Ctrl+J` (Windows/Linux) to open the inline AI prompt:

1. Type your instruction (e.g., "make this more concise", "translate to Korean")
2. The AI processes your request with real-time streaming
3. Review the suggestion with **character-level diff** highlighting:
   - Green text = additions
   - Red text = deletions
4. Click **Accept** to apply or **Reject** to discard

## Ghost Text (AI Autocomplete)

AI-powered autocomplete suggestions appear as faded text ahead of your cursor as you type:

| Action                 | macOS       | Windows/Linux |
| ---------------------- | ----------- | ------------- |
| Accept Full Suggestion | `Tab`       | `Tab`         |
| Accept First Word      | `Cmd+Right` | `Ctrl+Right`  |
| Dismiss                | `Escape`    | `Escape`      |

Ghost Text can be enabled or disabled in **Settings > AI**.
