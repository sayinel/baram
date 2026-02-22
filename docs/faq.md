# Frequently Asked Questions

---

## General

### What is Baram?

Baram(바람) is a lightweight desktop WYSIWYG markdown editor built with Tauri 2.0, React, and Tiptap/ProseMirror. It combines Typora-style "disappearing syntax" WYSIWYG editing with bidirectional links and AI-powered writing assistance.

### What platforms does Baram support?

Baram runs on macOS (Apple Silicon and Intel), Windows (x64 and ARM), and Linux (x64).

### Is Baram free?

The editor core is licensed under MIT. The application is licensed under AGPL-3.0.

### What makes Baram different from other markdown editors?

- **WYSIWYG with lossless roundtrip** — Formatting syntax disappears as you type, but your `.md` files stay 100% standard markdown with no data loss
- **Bidirectional links** — Wikilinks, backlinks, hover preview, block references, and auto-rename — like Obsidian, but with true WYSIWYG
- **AI-native editing** — Built-in inline AI editing with character-level diff review
- **Lightweight** — Under 15MB binary size, powered by Tauri instead of Electron
- **Rich content** — KaTeX math, CodeMirror 6 code blocks, Mermaid diagrams, GFM tables, callouts, toggles, all within the WYSIWYG experience

---

## Editing

### How does the WYSIWYG mode work?

Baram hides markdown delimiters (like `**`, `*`, `` ` ``) when your cursor is outside the formatted text. When you move your cursor into a bold word, the `**` markers reappear for editing. Move away, and only the styled text remains. This gives you a clean writing experience while maintaining full markdown access.

### Does Baram preserve my markdown exactly?

Yes. Baram's core principle is **lossless roundtrip fidelity**. When you open a markdown file, edit it, and save it, the formatting and structure of the original file are preserved exactly. No proprietary format, no hidden changes.

### What file formats does Baram support?

Baram works with standard markdown files (`.md`, `.markdown`). It supports CommonMark, GitHub Flavored Markdown (GFM) extensions (tables, task lists, strikethrough), and additional syntax for math (`$`, `$$`), YAML frontmatter, callouts (`> [!type]`), and wikilinks (`[[page]]`).

### How do I insert a table?

Three ways:
1. Type `/table` and select from the slash menu
2. Use the **Insert > Table** menu
3. Write GFM pipe table syntax directly

Once created, navigate cells with `Tab` and `Shift+Tab`. Hover over the table to see buttons for adding rows and columns.

### How do I insert math formulas?

- **Block math**: Type `$$` and press Enter, or use `Cmd+Shift+M`
- **Inline math**: Type `$formula$`

Math is rendered using KaTeX. A live preview shows while you type.

### How do I use code blocks?

Type ` ``` ` followed by a language name (e.g., `python`, `javascript`) and press Enter. Baram creates a CodeMirror 6 editor with syntax highlighting for that language. 14 languages are supported.

### How do I create a callout block?

Type `> [!info]` at the start of a line, or use the slash command `/callout`. Baram supports 12 callout types: `info`, `tip`, `warning`, `danger`, `note`, `abstract`, `todo`, `success`, `question`, `failure`, `example`, `quote`. Add `-` after the type for a collapsible callout.

### How do I create a toggle (collapsible) block?

Use the slash command `/toggle` or `/toggle heading 1` for a toggle with heading summary. Click the triangle indicator or press `Cmd+Enter` to open/close. In markdown, toggles use the HTML `<details>` / `<summary>` syntax.

### How do I insert a Mermaid diagram?

Use the slash command `/mermaid` or press `Cmd+Shift+D`. Write Mermaid syntax and a live preview renders below. Supports flowcharts, sequence diagrams, class diagrams, and more.

### What is Source Mode?

Press `Cmd+/` (macOS) or `Ctrl+/` (Windows/Linux) to toggle Source Mode. This shows the raw markdown in a CodeMirror editor, useful for precise editing or troubleshooting formatting.

---

## Linking & Navigation

### How do wikilinks work?

Type `[[` to start a wikilink. An autocomplete popup appears with matching files from your workspace. Select a file to insert a link like `[[My Note]]`. Cmd+click (or Ctrl+click on Windows) to navigate to the linked page.

Advanced syntax:
- `[[page|custom text]]` — Display custom text
- `[[page#heading]]` — Link to a specific heading
- `[[page#^block-id]]` — Link to a specific block

### What are backlinks?

Backlinks are the reverse of wikilinks — they show you which documents link *to* the current file. Press `Cmd+Shift+B` to open the backlinks panel in the sidebar. Each backlink shows the source file and context.

### What are unlinked mentions?

Unlinked mentions show files that contain the current file's name in their text, but don't include an actual `[[wikilink]]`. This helps you discover connections you might want to formalize.

### What are block references and block embeds?

- **Block reference** `((file#^id))` — An inline reference to a specific block in another file. Cmd+click to navigate.
- **Block embed** `{{embed ((file#^id))}}` — Embeds a live preview of the referenced block. You can edit the embedded content directly.

To create a referenceable block, add `^my-id` at the end of a paragraph or heading.

### What happens when I rename a file?

When you rename a file in the file tree (press `F2`), all wikilinks pointing to that file are automatically updated across your workspace. No broken links.

### How do I navigate between recently viewed files?

Use `Ctrl+-` (macOS) or `Alt+Left` (Windows/Linux) to go back, and `Ctrl+Shift+-` or `Alt+Right` to go forward. This works like browser navigation history.

### How do I bookmark files?

Press `Cmd+D` (macOS) or `Ctrl+D` (Windows/Linux) to bookmark the current file. Bookmarked files appear in the Bookmarks section of the left sidebar. Press again to remove.

### How do I quickly switch between files?

Press `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux) to open the Quick Switcher. Type to search files by name. Type `#` to search by heading. The switcher also supports `Ctrl+Tab` for MRU (Most Recently Used) tab switching.

---

## AI

### Where do I get an API key?

Baram supports multiple AI providers. Get your API key from the respective provider:

| Provider | Where to Get Key |
|----------|-----------------|
| **Claude** (Anthropic) | [console.anthropic.com](https://console.anthropic.com/) |
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Ollama** (local) | No API key required — runs locally on your machine |

Each provider has its own API key field in **Settings > AI**.

### What AI models are supported?

Baram dynamically loads available models from your selected provider. Go to **Settings > AI**, select a provider, and the model dropdown shows the available models for that provider.

### How much does AI usage cost?

AI usage is billed by your API provider. Baram itself does not charge for AI features — you pay only for the API calls based on your provider's pricing. **Ollama** is free as it runs models locally on your machine.

### How do I use the AI inline editing?

1. Select text in the editor
2. Click the **AI button** in the Floating Toolbar, or use a slash AI command
3. Type a natural language instruction (e.g., "translate to English", "fix grammar")
4. Review the diff: green = added text, red = removed text
5. Accept or reject the changes

### What is Ghost Text?

Ghost Text is AI-powered autocomplete that shows suggestions as faded text ahead of your cursor as you type. Press `Tab` to accept the full suggestion, `Cmd+Right` (macOS) / `Ctrl+Right` (Windows/Linux) for just the first word, or `Escape` to dismiss. Enable or disable it in **Settings > AI**.

### What is the AI Chat Panel?

Press `Cmd+Shift+A` (macOS) or `Ctrl+Shift+A` (Windows/Linux) to open a chat panel where you can converse with AI about your documents. Use `@references` to provide context: `@selection` (selected text), `@current` (current file), `@file` (any file), `@clipboard` (clipboard contents).

### What are Custom AI Commands?

Create your own reusable AI commands in **Settings > AI > Custom Commands**. Each command has a name, description, and prompt template with variable substitution (`{selection}`, `{document}`, `{clipboard}`). Custom commands appear in the slash menu alongside built-in AI commands.

### What are Slash AI commands?

Type `/` to open the slash menu and scroll to the AI section, or type `/ai-` to filter. Available commands: summarize, expand, grammar fix, translate, tone change, simplify, and continue writing. Custom AI commands also appear here.

### Can I use AI without sending data to the cloud?

Yes. Select **Ollama** as your provider and enable **Privacy Mode** in **Settings > AI**. Ollama runs models locally on your machine — no data leaves your computer. When Privacy Mode is enabled, only Ollama is allowed.

### What is Privacy Mode?

When enabled, Privacy Mode prevents your document content from being sent to cloud AI providers. Only Ollama (local) is allowed. Enable it globally in **Settings > AI**, or per-file by adding `privacy: true` to the YAML frontmatter.

### How do I search and replace text?

Press `Cmd+F` (macOS) / `Ctrl+F` (Windows/Linux) to open Find. Press `Cmd+H` / `Ctrl+H` for Find & Replace. Use `Enter` / `Shift+Enter` to navigate matches. Replace one or all matches.

### The AI features don't work. What should I check?

1. **API key** — Make sure you've entered a valid API key for your selected provider in **Settings > AI**
2. **Provider** — Verify the correct provider is selected
3. **Network** — Cloud providers (Claude, OpenAI, Gemini) need internet access; Ollama needs to be running locally
4. **Model selection** — Ensure a valid model is selected
5. **Privacy Mode** — When Privacy Mode is enabled, only Ollama works. Check that it is not enabled unintentionally

---

## Export

### What export formats are supported?

Baram currently supports:
- **HTML** — Self-contained HTML with inline styles, math rendering, and code highlighting
- **PDF** — Print-ready PDF via the system print dialog

### How do I export a document?

Go to **File > Export** and select your desired format.

### Are images included in exports?

Images referenced by URL are included in HTML exports as links. For PDF exports, images are rendered via the system print engine.

---

## Troubleshooting

### The app won't start

- **macOS**: If you see a "damaged" warning, open **System Preferences > Security & Privacy** and click "Open Anyway"
- **Windows**: If SmartScreen blocks the app, click "More info" then "Run anyway"
- **Linux**: Make sure the AppImage has execute permissions: `chmod +x Baram-*.AppImage`

### The editor feels slow

- **Large files**: Files over 10,000 lines may take up to 1 second to open. Consider splitting very large files
- **Many code blocks**: Each code block runs a CodeMirror instance. Documents with many code blocks use more memory
- **Math rendering**: Complex LaTeX formulas render quickly (under 50ms), but documents with hundreds of math blocks may affect scrolling performance

### Keyboard shortcuts aren't working

- Make sure you're focused on the editor area (click in the editor first)
- On macOS, check that the system hasn't assigned the same shortcut to another action in **System Preferences > Keyboard > Shortcuts**
- Some shortcuts change behavior based on context: `Cmd+K` opens the Quick Switcher, and AI inline editing is accessed via the Floating Toolbar when text is selected

### My markdown file looks different after editing

Baram preserves your markdown with lossless roundtrip fidelity. If something looks different, it may be because:
- Trailing whitespace was normalized
- The file used non-standard markdown syntax that Baram doesn't support

If you believe there's a roundtrip bug, please [report it on GitHub](https://github.com/sayinel/baram/issues).

### Wikilinks aren't working

- Make sure you have a workspace (folder) open — wikilinks link to files within your workspace
- File names are matched case-insensitively
- If autocomplete doesn't show a file, check that the file exists in your workspace folder

---

See the [User Guide](user-guide.md) and [Keyboard Shortcuts](keyboard-shortcuts.md) for more information.
