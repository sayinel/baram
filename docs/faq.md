# Frequently Asked Questions

---

## General

### What is Baram?

Baram(바람) is a lightweight desktop WYSIWYG markdown editor built with Tauri 2.0, React, and Tiptap/ProseMirror. It combines Typora-style "disappearing syntax" WYSIWYG editing with AI-powered writing assistance.

### What platforms does Baram support?

Baram runs on macOS (Apple Silicon and Intel), Windows (x64 and ARM), and Linux (x64).

### Is Baram free?

The editor core is licensed under MIT. The application is licensed under AGPL-3.0.

### What makes Baram different from other markdown editors?

- **WYSIWYG with lossless roundtrip** — Formatting syntax disappears as you type, but your `.md` files stay 100% standard markdown with no data loss
- **AI-native editing** — Built-in inline AI editing with character-level diff review
- **Lightweight** — Under 15MB binary size, powered by Tauri instead of Electron
- **Rich content** — KaTeX math, CodeMirror 6 code blocks, GFM tables, all within the WYSIWYG experience

---

## Editing

### How does the WYSIWYG mode work?

Baram hides markdown delimiters (like `**`, `*`, `` ` ``) when your cursor is outside the formatted text. When you move your cursor into a bold word, the `**` markers reappear for editing. Move away, and only the styled text remains. This gives you a clean writing experience while maintaining full markdown access.

### Does Baram preserve my markdown exactly?

Yes. Baram's core principle is **lossless roundtrip fidelity**. When you open a markdown file, edit it, and save it, the formatting and structure of the original file are preserved exactly. No proprietary format, no hidden changes.

### What file formats does Baram support?

Baram works with standard markdown files (`.md`, `.markdown`). It supports CommonMark, GitHub Flavored Markdown (GFM) extensions (tables, task lists, strikethrough), and additional syntax for math (`$`, `$$`) and YAML frontmatter.

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

### What is Source Mode?

Press `Cmd+/` (macOS) or `Ctrl+/` (Windows/Linux) to toggle Source Mode. This shows the raw markdown in a CodeMirror editor, useful for precise editing or troubleshooting formatting.

---

## AI

### Where do I get an API key?

Baram supports the Claude API by Anthropic. Get your API key at [console.anthropic.com](https://console.anthropic.com/).

### What AI models are supported?

Baram supports Claude models from Anthropic. You can select your preferred model in **Settings > AI**.

### How much does AI usage cost?

AI usage is billed by your API provider (Anthropic). Baram itself does not charge for AI features — you pay only for the API calls based on your provider's pricing.

### How do I use the AI inline editing?

1. Select text in the editor
2. Press `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux)
3. Type a natural language instruction (e.g., "translate to English", "fix grammar")
4. Review the diff: green = added text, red = removed text
5. Accept or reject the changes

### What are Slash AI commands?

Type `/` to open the slash menu and scroll to the AI section, or type `/ai-` to filter. Available commands: summarize, expand, grammar fix, translate, tone change, simplify, and continue writing.

### What is Privacy Mode?

When enabled, Privacy Mode prevents your document content from being sent to the AI provider. Enable it globally in **Settings > AI**, or per-file by adding `privacy: true` to the YAML frontmatter.

### The AI features don't work. What should I check?

1. **API key** — Make sure you've entered a valid API key in **Settings > AI**
2. **Network** — Baram needs internet access to reach the AI provider
3. **Model selection** — Ensure a valid model is selected
4. **Privacy Mode** — Check that Privacy Mode is not enabled for the file you're editing

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
- Some shortcuts change behavior based on context: `Cmd+K` opens AI inline editing when text is selected, and the Command Palette when nothing is selected

### My markdown file looks different after editing

Baram preserves your markdown with lossless roundtrip fidelity. If something looks different, it may be because:
- Trailing whitespace was normalized
- The file used non-standard markdown syntax that Baram doesn't support

If you believe there's a roundtrip bug, please [report it on GitHub](https://github.com/sayinel/baram/issues).

---

See the [User Guide](user-guide.md) and [Keyboard Shortcuts](keyboard-shortcuts.md) for more information.
