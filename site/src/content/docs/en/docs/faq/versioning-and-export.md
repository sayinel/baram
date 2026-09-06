---
title: "Versioning and export"
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

## Git Integration

### Does Baram support Git?

Yes. When your workspace is a Git repository, Baram shows a **Source Control** section in the left sidebar. You can view changes, stage/unstage files, write commit messages, view diffs, and switch branches — all without leaving the editor.

### How do I commit changes?

Open the Source Control sidebar, stage the files you want to commit (click the `+` button), type a commit message, and click the commit button.

### How do I switch branches?

Click the branch name in the Status Bar at the bottom of the editor. A dropdown appears where you can switch to an existing branch or create a new one.

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

There isn't one anymore. Open the **Help** menu and select **User Guide**, **Keyboard Shortcuts**, or **FAQ** — each opens the corresponding page in your browser instead of an in-app panel.

---
