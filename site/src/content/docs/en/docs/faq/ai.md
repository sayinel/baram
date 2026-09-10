---
title: "AI"
---


## Where do I get an API key?

Baram supports multiple AI providers. Get your API key from the respective provider:

| Provider               | Where to Get Key                                                     |
| ---------------------- | -------------------------------------------------------------------- |
| **Claude** (Anthropic) | [console.anthropic.com](https://console.anthropic.com/)              |
| **OpenAI**             | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **OpenRouter**         | [openrouter.ai/keys](https://openrouter.ai/keys)                     |
| **Google Gemini**      | [aistudio.google.com/apikey](https://aistudio.google.com/apikey)     |
| **Ollama** (local)     | No API key required — runs locally on your machine                   |

Each provider has its own API key field in **Settings > AI**.

**OpenRouter** is a gateway rather than a model vendor: one key reaches models from many vendors, and you choose the model by its qualified id (`anthropic/claude-sonnet-4.5`, `openai/gpt-4o`) or let `openrouter/auto` pick one. Because the request travels through OpenRouter, what is retained is governed by your OpenRouter account settings, not by Baram.

## What AI models are supported?

Baram dynamically loads available models from your selected provider. Go to **Settings > AI**, select a provider, and the model dropdown shows the available models for that provider.

## How much does AI usage cost?

AI usage is billed by your API provider. Baram itself does not charge for AI features — you pay only for the API calls based on your provider's pricing. **Ollama** is free as it runs models locally on your machine.

## How do I use the AI inline editing?

Press `Cmd+J` (macOS) / `Ctrl+J` (Windows/Linux) to open the inline AI prompt. Type a natural language instruction (e.g., "translate to English", "fix grammar"), review the diff (green = added, red = removed), then accept or reject the changes.

## What is the ✨ (Sparkles) button?

The ✨ button provides contextual AI actions that adapt to the content you're working with. It appears in three places:

1. **Floating Toolbar** — Select text and click ✨ for text-aware actions (Improve, Shorten, Translate, etc.)
2. **Block Handle** — Hover near the left edge of a block, click ⋮, then hover ✨ for block-level actions
3. **NodeView Buttons** — Hover over code blocks, math blocks, tables, images, callouts, or Mermaid diagrams to see a ✨ button with specialized actions (e.g., "Find Bugs" for code, "Fix LaTeX" for math)

## What are Smart Templates?

Type `/ai-template` in the slash menu to generate structured documents from AI. Choose a preset template (Meeting Notes, Project Plan, etc.) or write a custom description. The AI generates formatted content (headings, lists, tables) and inserts it directly as WYSIWYG blocks.

## What is Ghost Text?

Ghost Text is AI-powered autocomplete that shows suggestions as faded text ahead of your cursor as you type. Press `Tab` to accept the full suggestion, `Cmd+Right` (macOS) / `Ctrl+Right` (Windows/Linux) for just the first word, or `Escape` to dismiss. Enable or disable it in **Settings > AI**.

## What is the AI Chat Panel?

Press `Cmd+Shift+A` (macOS) or `Ctrl+Shift+A` (Windows/Linux) to open a chat panel where you can converse with AI about your documents. Use `@references` to provide context: `@selection` (selected text), `@current` (current file), `@file` (any file), `@clipboard` (clipboard contents). Use **Apply to Editor** to insert AI responses directly into your document as formatted content.

## What are Custom AI Commands?

Create your own reusable AI commands in **Settings > AI > Custom Commands**. Each command has a name, description, and prompt template with variable substitution (`{selection}`, `{document}`, `{clipboard}`). Custom commands appear in the slash menu alongside built-in AI commands.

## What are Slash AI commands?

Type `/` to open the slash menu and scroll to the AI section, or type `/ai-` to filter. Available commands: write, brainstorm, summarize, expand, fix grammar, translate, explain, and smart templates. Custom AI commands also appear here.

## Can I use AI without sending data to the cloud?

Yes. Select **Ollama** as your provider and enable **Privacy Mode** in **Settings > AI**. Ollama runs models locally on your machine — no data leaves your computer. When Privacy Mode is enabled, only Ollama is allowed.

## What is Privacy Mode?

When enabled, Privacy Mode prevents your document content from being sent to cloud AI providers. Only Ollama (local) is allowed. Enable it globally in **Settings > AI**, or per-file by adding `privacy: true` to the YAML frontmatter.

## Can I turn AI off completely?

Yes. Turn off **Enable AI** in **Settings > AI**. Every AI surface goes with it — the chat panel, the ✨ buttons, slash AI commands, Ghost Text, and inline AI. The AI tab itself stays, dimmed, so you can turn it back on. AI keyboard shortcuts stay bound: pressing one tells you AI is off rather than doing nothing.

## How do I search and replace text?

Press `Cmd+F` (macOS) / `Ctrl+F` (Windows/Linux) to open Find. Press `Cmd+H` / `Ctrl+H` for Find & Replace. Use `Enter` / `Shift+Enter` to navigate matches. Replace one or all matches.

## The AI features don't work. What should I check?

1. **API key** — Make sure you've entered a valid API key for your selected provider in **Settings > AI**
2. **Provider** — Verify the correct provider is selected
3. **Network** — Cloud providers (Claude, OpenAI, OpenRouter, Gemini) need internet access; Ollama needs to be running locally
4. **Model selection** — Ensure a valid model is selected
5. **Privacy Mode** — When Privacy Mode is enabled, only Ollama works. Check that it is not enabled unintentionally

---
