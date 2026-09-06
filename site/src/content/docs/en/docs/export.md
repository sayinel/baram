---
title: "Export"
---


Export your documents from the **File > Export** menu or the Export dialog.

## HTML

Generates clean, self-contained HTML with inline styles. The exported file includes all formatting, math rendering, and code highlighting.

## PDF

Creates a print-ready PDF via the system print dialog. Supports customization of paper size (A4 / Letter), margins, and layout.

## Notion

Exports a Notion-compatible Markdown file. Automatically converts Baram-specific syntax that Notion doesn't understand:

| Baram Syntax               | Notion Output                      |
| -------------------------- | ---------------------------------- |
| `[[page]]` wikilinks       | `[page](page.md)` standard links   |
| `> [!type]` callouts       | Emoji-prefixed blockquotes         |
| `$inline$` math            | `$$inline$$` block math            |
| `==text==` highlight       | `**text**` bold                    |
| `~text~` subscript         | Unicode subscript or `$_{text}$`   |
| `^text^` superscript       | Unicode superscript or `$^{text}$` |
| `[^id]` footnotes          | Inline `(id)` with Notes section   |
| `((ref))` block references | Stripped                           |
| Definition lists           | `**Term**: Definition` format      |

## Pandoc Formats (Word, LaTeX, EPUB, RST)

With [Pandoc](https://pandoc.org/) installed, Baram supports additional export formats:

| Format    | Extension | Description                                                          |
| --------- | --------- | -------------------------------------------------------------------- |
| **Word**  | `.docx`   | Editable Word document, with optional reference template for styling |
| **LaTeX** | `.tex`    | Typesetting format for academic/scientific documents                 |
| **EPUB**  | `.epub`   | E-book format for Kindle, Apple Books, etc.                          |
| **RST**   | `.rst`    | reStructuredText for Sphinx documentation                            |

**Setup:**

1. Install [Pandoc](https://pandoc.org/installing.html) on your system
2. Baram auto-detects Pandoc from your PATH — the Export dialog shows Pandoc formats when available
3. The Export dialog lets you pick a Word reference template and (when needed) resolves the Pandoc executable automatically

**Word Templates:**

When exporting to Word (DOCX), you can select a reference template (`.docx` file). Pandoc applies the template's styles — headings, fonts, colors, headers/footers — to the exported document.

**Markdown preprocessing:**

Baram automatically converts its extended syntax to Pandoc-compatible format before export: wikilinks become standard links, callouts become bold-prefixed blockquotes, highlight becomes bold, and subscript/superscript use HTML tags.

---
