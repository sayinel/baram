<p align="center">
  <img src="src/assets/baram-symbol.png" alt="Baram" width="130" />
</p>

<h1 align="center">Baram</h1>

<p align="center">
  <a href="https://github.com/sayinel/baram/releases"><img src="https://img.shields.io/github/v/release/sayinel/baram?style=flat-square&label=release" alt="Release" /></a>
  <a href="https://github.com/sayinel/baram/releases"><img src="https://img.shields.io/github/downloads/sayinel/baram/total?style=flat-square" alt="Downloads" /></a>
  <a href="https://github.com/sayinel/baram/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/sayinel/baram/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://github.com/sayinel/baram/stargazers"><img src="https://img.shields.io/github/stars/sayinel/baram?style=flat-square" alt="Stars" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Tauri-2.0-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Rust-stable-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License" />
</p>

<p align="center">
  A lightweight, beautiful WYSIWYG markdown editor with AI integration.
</p>

<p align="center">
  <strong>Beautiful WYSIWYG &middot; Lossless Markdown &middot; AI-native Editing &middot; Bidirectional Links</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> &nbsp;|&nbsp;
  <a href="#features">Features</a> &nbsp;|&nbsp;
  <a href="#keyboard-shortcuts">Shortcuts</a> &nbsp;|&nbsp;
  <a href="#ai-integration">AI</a> &nbsp;|&nbsp;
  <a href="#build-from-source">Build</a> &nbsp;|&nbsp;
  <a href="docs/user-guide.md">User Guide</a> &nbsp;|&nbsp;
  <a href="docs/keyboard-shortcuts.md">Shortcut Reference</a> &nbsp;|&nbsp;
  <a href="docs/faq.md">FAQ</a>
</p>

---

## What is Baram?

Baram(바람) is a desktop markdown editor where formatting syntax disappears as you type. Move your cursor into a heading and the `## ` prefix reappears for editing; move away and only the styled text remains. This experience extends to bold, italic, links, images, math, and more — all while maintaining **lossless markdown roundtrip fidelity**.

Your `.md` files stay 100% standard markdown. No proprietary format, no lock-in.

## Installation

### Download

Pre-built binaries for macOS, Windows, and Linux are available on the [Releases](https://github.com/sayinel/baram/releases) page.

| Platform | Architecture | Format |
|----------|-------------|--------|
| macOS | Apple Silicon (M1+) | `.dmg` |
| Windows | x64 | `.msi`, `.exe` |
| Linux | x64 | `.deb`, `.AppImage`, `.rpm` |

### Build from Source

**Prerequisites:**
- [Node.js](https://nodejs.org/) v20+
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

```bash
git clone https://github.com/sayinel/baram.git
cd baram
npm install
npm run tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

## Features

Baram pairs a **beautiful WYSIWYG** editor with **lossless markdown**, **AI-native editing**, and **bidirectional links** — in a ~10MB desktop app.

### Editing

- **Disappearing syntax** — Markdown delimiters (`**`, `*`, `` ` ``, `~~`, `==`, `~`, `^`, links) show only when your cursor enters the range and vanish when you leave.
- **Lossless roundtrip** — MD → editor → MD preserves your document exactly. Files stay 100% standard markdown — no proprietary format, no lock-in.
- **Source mode** — Toggle raw markdown editing (CodeMirror 6) with `Cmd+/`.
- **Rich blocks** — Headings, lists, tables (with cell merge & virtual scroll), task lists, Obsidian-compatible callouts, toggles, footnotes, definition lists, and YAML frontmatter — created by typing markdown, `/` slash commands, or shortcuts.
- **Math, code & diagrams** — Inline/block LaTeX (KaTeX), syntax highlighting for 14+ languages (CodeMirror 6), and Mermaid diagrams — all with live preview.
- **Images** — Drag-and-drop, paste from clipboard, resize, and edit alt text inline.

### Knowledge & Navigation

- **Wikilinks** — `[[links]]` with autocomplete, heading/block links, aliases, and relative/namespace paths.
- **Backlinks & unlinked mentions** — See what links here; links auto-update on rename.
- **Block references & embeds** — Reference `((file#^id))` or embed `{{embed ((file#^id))}}` any block; embeds stay editable.
- **@Mentions & tags** — Inline `@[[...]]` page/date chips and `#nested/tags` with a vault-wide index.
- **Graph view & global search** — Visual map of your connections, plus full-text search (tantivy) with regex and replace.
- **Query blocks** — Embed live, self-updating result lists with a visual query builder.

### Workspaces

- **Vaults & multi-context** — Open multiple vaults, folders, and files at once, each with its own tree, tabs, and settings; link across vaults with `[[alias::file]]`.
- **Journal & Zettelkasten** — A diary-focused daily-notes space (calendar, photos, streaks, templates) and an atomic-notes space (inbox capture, fleeting→permanent promotion, `[[id]]` links, MOCs).
- **Version history** — Automatic file snapshots with timeline, diff, and selective restore — independent of Git.
- **Git integration** — Stage, commit, diff, branch, stash, and push/pull from the sidebar.

### Sharing & Customization

- **Export** — HTML, PDF, and — via Pandoc — Word, LaTeX, EPUB, and RST, plus Notion-compatible markdown.
- **Themes** — 8 built-in themes, system auto light/dark, and a full color editor with import/export.
- **Plugins** — Install community plugins from a built-in, capability-gated marketplace.
- **Keyboard-first & i18n** — Command palette, quick switcher, slash commands, fully customizable shortcuts, and English/Korean UI.

> 📖 See the **[User Guide](docs/user-guide.md)** for detailed usage of every feature.

## AI Integration

Baram has built-in AI writing assistance powered by Claude, OpenAI, Google Gemini, and Ollama (local).

### Setup

1. Open Settings with `Cmd+,`
2. Go to the **AI** tab
3. Select your AI provider (Claude, OpenAI, Gemini, or Ollama)
4. Enter your API key (per-provider — each provider has its own key field; Ollama requires no key)
5. Choose your preferred model (models are loaded dynamically from the provider)

### Inline AI Editing (`Cmd+J`)

Press `Cmd+J` to open the inline AI prompt anywhere in your document:

1. Type your instruction (e.g., "make this more concise", "translate to Korean")
2. The AI processes your request with real-time streaming
3. Review the suggestion with **character-level diff** highlighting
4. **Accept** or **Reject** the changes

### Contextual AI Actions (✨ Sparkles)

AI actions appear contextually throughout the editor via the ✨ button:

- **Floating Toolbar** — Select text and click ✨ for actions like Improve, Shorten, Expand, Translate, Tone Change, Explain
- **Block Handle** — Hover near the left gutter, click ⋮, then ✨ for block-level AI actions
- **NodeView Buttons** — Hover over code blocks, math blocks, tables, images, callouts, and Mermaid diagrams for specialized AI actions

Actions are content-aware — code blocks show "Add Comments", "Optimize", "Find Bugs"; math blocks show "Show Steps", "Fix LaTeX"; tables show "Analyze Data", "Fill Cells", etc.

### Ghost Text (AI Autocomplete)

AI-powered autocomplete suggestions appear as you type:

- **Tab** — Accept the full suggestion
- **Cmd+Right** — Accept only the first word
- **Escape** — Dismiss the suggestion

Enable or disable Ghost Text in **Settings > AI**.

### AI Chat Panel (`Cmd+Shift+A`)

A dedicated chat panel for conversing with AI about your documents:

- **@references** — Mention context: `@selection`, `@current` (current file), `@file` (any file), `@clipboard`
- **Apply to Editor** — Insert AI responses directly into the editor as WYSIWYG content
- Streaming responses with markdown rendering
- Conversation history per session

### Smart Templates (`/ai-template`)

Type `/ai-template` in the slash menu to generate document content from AI-powered templates:

- Choose from template categories (e.g., Meeting Notes, Project Plan, Technical Spec)
- Or write a custom description for any template
- Generated content is inserted as fully rendered WYSIWYG blocks

### Slash AI Commands

Type `/` to open the slash menu. AI-powered commands include:

| Command | Description |
|---------|-------------|
| `/ai-write` | Write or continue from current context |
| `/ai-brainstorm` | Brainstorm ideas from current context |
| `/ai-summarize` | Summarize selected text |
| `/ai-expand` | Expand and elaborate on selected text |
| `/ai-fix-grammar` | Fix grammar and spelling |
| `/ai-translate` | Translate to another language |
| `/ai-explain` | Explain selected text in simple terms |
| `/ai-template` | Generate content from AI templates |

### Custom AI Commands

Create your own slash commands in **Settings > AI > Custom Commands**. Use variable substitution (`{selection}`, `{document}`, `{clipboard}`) to build reusable AI workflows.

## Keyboard Shortcuts

> On Windows/Linux, replace `Cmd` with `Ctrl`. Every shortcut is remappable in **Settings > Keybindings**.

| Action | Shortcut |
|--------|----------|
| Bold / Italic / Inline Code | `Cmd+B` / `Cmd+I` / `Cmd+E` |
| Link | `Cmd+K` |
| Heading 1–6 | `Cmd+1` – `Cmd+6` |
| Code Block / Math Block | `Cmd+Alt+C` / `Cmd+Shift+M` |
| Table | `Cmd+T` |
| Source Mode | `Cmd+/` |
| Command Palette | `Cmd+P` |
| Global Search | `Cmd+Shift+F` |
| Find / Replace | `Cmd+F` / `Cmd+H` |
| AI Inline Edit / AI Chat | `Cmd+J` / `Cmd+Shift+A` |
| Toggle Sidebar | `Cmd+Shift+L` |
| Settings | `Cmd+,` |

> 📖 See the full **[Keyboard Shortcuts reference](docs/keyboard-shortcuts.md)** for every binding.

## User Interface

### 3-Column Layout

- **Context Tab Bar** — Switch between open vaults, folders, and files
- **Left Sidebar** — File tree, Search, Backlinks, Bookmarks, Tags, Calendar, Git, and Version History (`Cmd+Shift+L` to toggle)
- **Editor** — Main editing area with WYSIWYG or Source mode
- **Right Sidebar** — Document outline, AI Chat, Memories, Photo Gallery, or Help panel

### Toolbar & Menus

- **Floating Toolbar** — Appears on text selection with formatting buttons
- **Block Handle** — Drag handle on the left side of each block for reordering
- **Slash Commands** — Type `/` at the start of a line for quick block insertion
- **Command Palette** — `Cmd+P` or `Cmd+Shift+P` for searching and running any command
- **Quick Switcher** — `Cmd+K` for quickly opening files and jumping to headings
- **Context Menu** — Right-click for context-aware options (copy, paste, block type, pin tab, etc.)

### Tabs

- **Multiple tabs** — Open several files at once
- **Tab Pin** — Right-click a tab to pin it (pinned tabs show as icons, can't be accidentally closed)
- **Tab Switcher** — `Ctrl+Tab` opens MRU (Most Recently Used) tab switcher
- **Undo history preserved** — Switching tabs preserves your undo/redo history per tab

### Help Panel

Access built-in documentation from the **Help** menu:

- **User Guide** — Feature overview and usage instructions
- **Keyboard Shortcuts** — Complete shortcut reference
- **FAQ** — Frequently asked questions

The Help panel opens in the right sidebar.

### Status Bar

Shows word count, line count, cursor position, and current Git branch at the bottom of the editor.

## Contributing

Contributions are welcome! Baram is built with Tauri, React, and Rust.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for how to set up your development environment, run the test suite, and submit changes.

## Support & Community

- 🐛 **Found a bug or have a feature request?** Open an [issue](https://github.com/sayinel/baram/issues).
- 💬 **Questions or ideas?** Start a [discussion](https://github.com/sayinel/baram/discussions).
- 📖 **Documentation** — [User Guide](docs/user-guide.md) &middot; [Keyboard Shortcuts](docs/keyboard-shortcuts.md) &middot; [FAQ](docs/faq.md)

## License

Baram is licensed under the **[Apache License 2.0](LICENSE)**.

Third-party open-source components and their licenses are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
