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

## Themes & Appearance

### How do I change the theme?

Open **Settings > Appearance** (`Cmd+,`). You'll see a gallery of theme cards — click any card to apply it. Select **System (Auto)** to follow your OS light/dark mode setting.

### What built-in themes are available?

Baram includes 8 built-in themes: Default Light, Default Dark, Tokyo Night, Solarized Light, Solarized Dark, Nord, Baram Garden Light, and Baram Garden Dark. Built-in themes cannot be deleted.

### How do I create a custom theme?

1. Go to **Settings > Appearance** and click **Customize...**
2. Enter a name for your theme
3. Choose a base mode (Light or Dark) — this determines how code blocks and diagrams render
4. Adjust the 25 colors using the color pickers (Background, Text, Border, Accent, Editor, Status, Graph)
5. Click **Save**

Your custom theme appears in the gallery with a "Custom" badge.

### How do I share themes with others?

In the theme editor, click **Export** to save your theme as a `.json` file. Others can import it by clicking **Import Theme...** in the Appearance tab.

### How do I delete a custom theme?

Hover over a custom theme card in the gallery and click the **x** button. Built-in themes cannot be deleted.

---

## Language

### What languages does Baram support?

Baram currently supports **English** and **Korean** for the entire user interface — menus, dialogs, settings, welcome screen, and all UI elements.

### How do I change the language?

Open **Settings > Language** (`Cmd+,` on macOS, `Ctrl+,` on Windows/Linux, then select the Language tab). Choose your preferred language — the UI updates immediately without restarting the app.

### Does the language setting affect my documents?

No. The language setting only changes the interface language. Your markdown documents are not affected.

---

## Keyboard Shortcuts

### Can I customize keyboard shortcuts?

Yes. Open **Settings > Keybindings** to see all shortcuts organized by category (File, Editing, Formatting, Blocks, View, Navigation, Tools, AI, Workspace). Click **Edit** on any shortcut, press the new key combination, and click **Apply**.

### What happens if I assign a key that's already in use?

Baram shows a conflict warning with the name of the command that already uses that key combination. You can choose to override (which removes the old binding) or cancel.

### How do I reset a shortcut to its default?

Click the reset button (↺) next to any customized shortcut to restore its default key combination. To reset all shortcuts at once, click **Reset All** at the bottom of the Keybindings tab.

---

## Editing

### How does the WYSIWYG mode work?

Baram hides markdown delimiters (like `**`, `*`, `` ` ``) when your cursor is outside the formatted text. When you move your cursor into a bold word, the `**` markers reappear for editing. Move away, and only the styled text remains. This gives you a clean writing experience while maintaining full markdown access.

### Does Baram preserve my markdown exactly?

Yes. Baram's core principle is **lossless roundtrip fidelity**. When you open a markdown file, edit it, and save it, the formatting and structure of the original file are preserved exactly. No proprietary format, no hidden changes.

### What file formats does Baram support?

Baram works with standard markdown files (`.md`, `.markdown`). It supports CommonMark, GitHub Flavored Markdown (GFM) extensions (tables, task lists, strikethrough), and additional syntax for math (`$`, `$$`), YAML frontmatter, callouts (`> [!type]`), and wikilinks (`[[page]]`).

### How do I insert a table?

Four ways:

1. **Pipe input** — Type `| Header 1 | Header 2 |` and press Enter — a table is created with the headers filled in
2. **Grid Picker** — Type `/table` or press `Cmd+T` to select dimensions from a visual 10×10 grid
3. **TSV Paste** — Copy cells from a spreadsheet and paste — Baram auto-creates a table
4. Write GFM pipe table syntax directly

Once created, navigate cells with `Tab` and `Shift+Tab`. Drag column borders to resize (session only). Hover over the table to see ⊕ buttons for adding rows and columns. Right-click for alignment, header toggle, and copy options.

### How do I merge table cells?

1. Select the cells you want to merge by clicking and dragging across them
2. Press `Cmd+M` (macOS) / `Ctrl+M` (Windows/Linux), or right-click and select **Merge Cells**
3. To split a merged cell back, place your cursor in it and press `Cmd+M` again

**Persistence:** Cell merges are saved in your markdown file using `<` (colspan) and `^` (rowspan) markers inside the pipe table. This means merges survive source mode toggle (`Cmd+/`), file close/reopen, and are compatible with Obsidian Sheets Extended. In non-supporting markdown viewers, the markers simply appear as cell text.

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

### How do I use footnotes?

Type `[^id]` (e.g., `[^1]` or `[^note]`) anywhere in your text to insert a footnote reference. A footnote definition block is automatically created at the end of the document — click into it to type the footnote content. References display as sequential numbers (1, 2, 3…) based on document order. Hover a reference to see a tooltip preview, click to navigate between reference and definition.

### How do I search across all files?

Press `Cmd+Shift+F` (macOS) or `Ctrl+Shift+F` (Windows/Linux) to open Global Search. It searches all files in your workspace using full-text search. Supports regex, file/folder filters, and replace across files.

### How do I fold/collapse a heading section?

Hover over any heading (H1–H6) to reveal a fold arrow in the left gutter. Click the arrow to collapse all content below that heading until the next heading of equal or higher level. Click again (or click the `...` indicator) to expand. You can also use `Cmd+Shift+[` (macOS) / `Ctrl+Shift+[` (Windows/Linux) to toggle fold at the cursor position.

### How do I fold a nested list?

List items that contain nested sub-lists (bullet, ordered, or task) show a fold arrow on hover. Click the arrow to collapse the nested children. This works at any nesting depth.

### How do I fold/unfold everything at once?

Use `Cmd+Shift+Alt+[` (macOS) / `Ctrl+Shift+Alt+[` (Windows/Linux) to fold all headings and nested list items. Use `Cmd+Shift+Alt+]` / `Ctrl+Shift+Alt+]` to unfold all.

### Does folding change my markdown file?

No. Folding is purely a view-level feature — it does not modify the document, affect undo history, or change the saved file. Fold state is preserved per file across tab switches.

### What is Source Mode?

Press `Cmd+/` (macOS) or `Ctrl+/` (Windows/Linux) to toggle Source Mode. This shows the raw markdown in a CodeMirror editor with full undo/redo support, useful for precise editing or troubleshooting formatting.

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

### What are @mentions and how are they different from wikilinks?

@Mentions (`@[[page]]`) and wikilinks (`[[page]]`) both link to pages in your workspace, but they serve different purposes:

- **Wikilinks** (`[[page]]`) render as styled inline text links — ideal for flowing prose
- **Mentions** (`@[[page]]`) render as chip badges with icons (📅 for dates, 📄 for pages) — visually distinct for quick scanning

Type `@` to open the mention popup with Quick Dates (Today, Yesterday, Tomorrow) at the top and workspace pages below. Mentions are especially useful for referencing dates (journal entries) and for cases where you want a more prominent visual indicator.

In markdown, mentions serialize as `@[[value]]` — the `@` prefix distinguishes them from regular wikilinks.

### How do tags work?

Type `#tag` inline (with autocomplete) or add a `tags:` list to YAML frontmatter — both are indexed across the whole vault. Use `#parent/child` for nested tags. `Cmd/Ctrl+click` a tag to search every file that uses it. The Tags panel (from the Activity Bar) shows a tree or a frequency-sized cloud where you can rename a tag vault-wide, assign colors, filter the file tree by tag, or get AI tag suggestions for the current note.

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

| Provider               | Where to Get Key                                                     |
| ---------------------- | -------------------------------------------------------------------- |
| **Claude** (Anthropic) | [console.anthropic.com](https://console.anthropic.com/)              |
| **OpenAI**             | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Google Gemini**      | [aistudio.google.com/apikey](https://aistudio.google.com/apikey)     |
| **Ollama** (local)     | No API key required — runs locally on your machine                   |

Each provider has its own API key field in **Settings > AI**.

### What AI models are supported?

Baram dynamically loads available models from your selected provider. Go to **Settings > AI**, select a provider, and the model dropdown shows the available models for that provider.

### How much does AI usage cost?

AI usage is billed by your API provider. Baram itself does not charge for AI features — you pay only for the API calls based on your provider's pricing. **Ollama** is free as it runs models locally on your machine.

### How do I use the AI inline editing?

Press `Cmd+J` (macOS) / `Ctrl+J` (Windows/Linux) to open the inline AI prompt. Type a natural language instruction (e.g., "translate to English", "fix grammar"), review the diff (green = added, red = removed), then accept or reject the changes.

### What is the ✨ (Sparkles) button?

The ✨ button provides contextual AI actions that adapt to the content you're working with. It appears in three places:

1. **Floating Toolbar** — Select text and click ✨ for text-aware actions (Improve, Shorten, Translate, etc.)
2. **Block Handle** — Hover near the left edge of a block, click ⋮, then hover ✨ for block-level actions
3. **NodeView Buttons** — Hover over code blocks, math blocks, tables, images, callouts, or Mermaid diagrams to see a ✨ button with specialized actions (e.g., "Find Bugs" for code, "Fix LaTeX" for math)

### What are Smart Templates?

Type `/ai-template` in the slash menu to generate structured documents from AI. Choose a preset template (Meeting Notes, Project Plan, etc.) or write a custom description. The AI generates formatted content (headings, lists, tables) and inserts it directly as WYSIWYG blocks.

### What is Ghost Text?

Ghost Text is AI-powered autocomplete that shows suggestions as faded text ahead of your cursor as you type. Press `Tab` to accept the full suggestion, `Cmd+Right` (macOS) / `Ctrl+Right` (Windows/Linux) for just the first word, or `Escape` to dismiss. Enable or disable it in **Settings > AI**.

### What is the AI Chat Panel?

Press `Cmd+Shift+A` (macOS) or `Ctrl+Shift+A` (Windows/Linux) to open a chat panel where you can converse with AI about your documents. Use `@references` to provide context: `@selection` (selected text), `@current` (current file), `@file` (any file), `@clipboard` (clipboard contents). Use **Apply to Editor** to insert AI responses directly into your document as formatted content.

### What are Custom AI Commands?

Create your own reusable AI commands in **Settings > AI > Custom Commands**. Each command has a name, description, and prompt template with variable substitution (`{selection}`, `{document}`, `{clipboard}`). Custom commands appear in the slash menu alongside built-in AI commands.

### What are Slash AI commands?

Type `/` to open the slash menu and scroll to the AI section, or type `/ai-` to filter. Available commands: write, brainstorm, summarize, expand, fix grammar, translate, explain, and smart templates. Custom AI commands also appear here.

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

## Git Integration

### Does Baram support Git?

Yes. When your workspace is a Git repository, Baram shows a **Source Control** section in the left sidebar. You can view changes, stage/unstage files, write commit messages, view diffs, and switch branches — all without leaving the editor.

### How do I commit changes?

Open the Source Control sidebar, stage the files you want to commit (click the `+` button), type a commit message, and click the commit button.

### How do I switch branches?

Click the branch name in the Status Bar at the bottom of the editor. A dropdown appears where you can switch to an existing branch or create a new one.

---

## Version History (File Snapshots)

### What is Version History?

Baram automatically saves snapshots of your changed `.md` files at regular intervals (default: every 30 minutes). This provides a safety net independent of Git — you can browse past versions, view diffs, and restore files at any time.

### How do I open Version History?

Click the **clock icon** in the Activity Bar (left sidebar) to open the Version History panel. It shows a timeline of all snapshots.

### How do I create a manual snapshot?

Click the **+** button in the Version History panel header. You can optionally enter a label (e.g., "Before refactoring"). Manual snapshots with labels are never automatically deleted.

### How do I restore a file from a snapshot?

1. Click a snapshot in the timeline to see its file list
2. Check the files you want to restore (or use "Restore All")
3. Click **Restore** — Baram saves the current state first, so the restore itself is undoable

### How do I view a diff between a snapshot and the current file?

Click a snapshot in the timeline, then click any file name. A line-by-line diff appears showing additions (green) and deletions (red).

### How long are snapshots kept?

Snapshots are automatically thinned over time: all kept for the last 24 hours, then hourly for 1–7 days, daily for 7–30 days, and weekly beyond 30 days. The default limit is 50 snapshots and 500 MB total. Manual snapshots with labels are never auto-deleted.

### Can I disable automatic snapshots?

Yes. Go to **Settings > General** and set the **Snapshot Interval** to 0 minutes.

### How is Version History different from Git?

Version History is automatic and file-level — it silently saves changed files without requiring commits or messages. Git is intentional and semantic — you decide when and what to commit. Both systems work independently; Git users who prefer commits can disable snapshots.

---

## Workspace Presets

### What are Workspace Presets?

Workspace Presets save your current layout (sidebar panel, right panel, theme) as a named configuration that you can quickly apply later. Think of them as "workspace snapshots."

### How do I switch workspace presets?

Three ways:

1. **Keyboard shortcuts** — `Cmd+Alt+1` (Writing), `Cmd+Alt+2` (Journal), `Cmd+Alt+3` (Zettel), `Cmd+Alt+4` (Skills Editing)
2. **Command Palette** — `Cmd+Shift+P` then search for "Workspace"
3. **Workspace menu** — Use the menu bar

### Can I create custom presets?

Yes. Go to **Settings > Appearance**, arrange your layout, and click **Save Current Layout**. Custom presets can be renamed or deleted.

---

## Zettel (Zettelkasten Notes)

### What is the Zettel space?

Zettel is a dedicated space for atomic, densely-linked notes, separate from the diary-oriented Journal. It centers on the fleeting → permanent workflow: quickly capture ideas into an `inbox/`, then refine the good ones into permanent, titled notes in `notes/` and connect them with links.

### How do I capture a quick note?

Press `Cmd+Shift+N` (or type `/capture`) to open Quick Capture. Your thought is saved as a fleeting note in the Zettel `inbox/`. Add tags (stored in the note's frontmatter) and an optional source URL.

### How do I turn an inbox note into a permanent note?

Open the inbox note and press `Cmd+Shift+U` (Promote). Give it a title — it moves to `notes/{id} {title}.md`, keeping its body and tags. You can also create a permanent note directly with `Cmd+Shift+V` (New Zettel), or turn a selection into a new note with `Cmd+Shift+Y`.

### Why do links look like `[[id]]` on disk but show titles in the editor?

Zettel notes are addressed by a timestamp `id`, so links are stored as `[[id]]`. Baram renders the note's current title in the editor, so links never break when you rename a note. Type `[[` to search by title.

### How do I enable it?

Go to **Settings > General > Zettel**, toggle it on, and choose a directory. Then open the space from the space menu (status bar), the Command Palette ("Open Zettel"), or `Cmd+Alt+3`.

---

## Journal / Daily Notes

### What is the Journal feature?

Baram includes a built-in journal system that automatically creates daily notes, provides a calendar sidebar for browsing, and supports @mentions for quick date linking.

### How do I enable the Journal?

Open **Settings > General > Journal**, enable the toggle, and select a folder for your journal files. The journal directory must be an absolute path (e.g., `/Users/me/journals`).

### How do I create a daily note?

Three ways:

1. **Calendar** — Open the Calendar sidebar (`Cmd+Alt+2`) and click any date
2. **@Mention** — Type `@` in the editor and select Today/Yesterday/Tomorrow from the popup, then click the resulting 📅 date chip
3. **Auto-create** — Set "On Startup" to "Open today's journal" in Settings — today's entry auto-opens when you launch Baram

### Can I use a custom template for daily notes?

Yes. In **Settings > General > Journal**, select a `.md` template file. Templates support variables: `{{date}}`, `{{year}}`, `{{month}}`, `{{day}}`, `{{dayName}}`, `{{monthName}}`. If no template is set, Baram generates a default entry with frontmatter and a date heading.

### How do I navigate between journal entries?

Use the Calendar sidebar. Days with existing entries are marked with a dot. Click any date to open or create that day's journal.

---

## Export

### What export formats are supported?

Baram supports seven export formats:

- **HTML** — Self-contained HTML with inline styles, math rendering, and code highlighting
- **PDF** — Print-ready PDF via the system print dialog
- **Notion** — Notion-compatible Markdown that converts Baram-specific syntax
- **Word (DOCX)** — Editable Word document via Pandoc, with optional template
- **LaTeX** — Typesetting format for academic/scientific documents via Pandoc
- **EPUB** — E-book format via Pandoc
- **RST** — reStructuredText for Sphinx documentation via Pandoc

The last four formats require [Pandoc](https://pandoc.org/) to be installed.

### How do I export a document?

Go to **File > Export** to open the Export dialog. Select your desired format, enter a title, and click Export. You can also use the Command Palette (`Cmd+Shift+P`) and search for "Export".

### What is Pandoc and do I need it?

[Pandoc](https://pandoc.org/) is a free document converter. You only need it if you want to export to Word, LaTeX, EPUB, or RST. Baram auto-detects Pandoc — if it's installed, the Pandoc formats become available in the Export dialog. If not, those formats are grayed out.

### How do I install Pandoc?

Visit [pandoc.org/installing.html](https://pandoc.org/installing.html) for your platform. On macOS: `brew install pandoc`. On Windows: download the installer. On Linux: `apt install pandoc` or equivalent.

### Can I use a Word template for DOCX export?

Yes. When you select the Word format in the Export dialog, a template browser appears. Select a `.docx` reference template and Pandoc will apply its styles (headings, fonts, colors, headers/footers) to the exported document.

### What does "Export for Notion" convert?

It automatically converts Baram-specific markdown syntax that Notion can't import directly: `[[wikilinks]]` become standard `[links](url)`, callouts become emoji-prefixed blockquotes, inline math `$...$` becomes block math `$$...$$`, highlight `==text==` becomes bold, subscript/superscript use Unicode characters or math fallback, and footnotes are converted to inline references with a Notes section.

### Are images included in exports?

Images referenced by URL are included in HTML exports as links. For PDF exports, images are rendered via the system print engine.

---

### Where is the Help panel?

Open the **Help** menu and select **User Guide**, **Keyboard Shortcuts**, or **FAQ**. The Help panel opens in the right sidebar with three tabs for quick in-app reference.

---

## Vault & Context

### What is a vault?

A vault is a folder that contains a `.baram/config.json` file. When Baram detects this file, it treats the folder as a fully initialized workspace with vault-level settings, a configurable Journal directory, and a vault alias for cross-vault linking. A plain folder without `.baram/config.json` still works as a normal workspace — vaults simply unlock extra features.

To turn any folder into a vault, open it in Baram, then go to **Settings > Vault** and click **Initialize as Vault**.

### Can I use multiple vaults simultaneously?

Yes. Each vault (or plain folder) you open appears as a tab in the **Context Tab Bar** at the top of the left sidebar. Click any tab to switch between contexts. Each context has its own file tree, tab history, and settings.

### How do I link files across vaults?

Use the cross-vault wikilink syntax: `[[alias::filename]]`. Replace `alias` with the target vault's short name (configured in **Settings > Vault > Alias**) and `filename` with the file name (without `.md`). For example, `[[research::climate-data]]` links to `climate-data.md` in the vault aliased `research`. If the target vault is not open, Baram prompts you to open it.

### What happens when I open a file outside a vault?

The file opens as a **File context** tab, indicated by a 📎 icon. The left sidebar is hidden — only the editor is shown. This is ideal for quick edits to files that don't belong to any workspace. There is no file tree, backlinks, or vault-level settings in this mode.

### How do I convert a folder to a vault?

1. Open the folder in Baram with **File > Open Folder**
2. Go to **Settings > Vault**
3. Click **Initialize as Vault**

Baram creates a `.baram/config.json` file inside the folder. Your existing files are not changed. To revert back to a plain folder, click **Revert to Folder** — this removes `.baram/config.json` but leaves all your markdown files intact.

### How is Journal related to vaults?

Each vault can have its own journal directory set in **Settings > Vault > Journal Directory**. When you are working in a vault context, the Calendar sidebar and @mention date chips (Today/Yesterday/Tomorrow) create journal entries in that vault's configured directory. Switching vault contexts switches the active journal, so you can maintain separate journals per vault (e.g., personal vs. work).

---

## Plugins

### Does Baram support plugins?

Yes. Open **Settings > Plugins** to browse, install, update, and manage community plugins. The tab has three sections: Browse (discover plugins), Installed (configure your plugins), and Updates (apply new versions).

### Are plugins safe?

Plugins are capability-gated: each declares the permissions it needs (editor, files, commands, UI, etc.), and you review and approve them before installing. Plugins run in isolation with crash protection, and downloads are verified with a SHA-256 checksum.

### How do I build a plugin?

See the [Plugin Development Guide](plugin-development.md). A plugin is a directory with a `baram-plugin.json` manifest and an ESM entry point, using the `ExtensionContext` API to add commands, Tiptap extensions, UI, and more.

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
