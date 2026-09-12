---
title: "Export"
---


Export your documents from the **File > Export** menu or the Export dialog.

## HTML

Generates clean, self-contained HTML with inline styles. The exported file includes all formatting, math rendering, and code highlighting.

## PDF

Creates a print-ready PDF via the system print dialog. Supports customization of paper size (A4 / Letter), margins, and layout.

## Fonts

HTML and PDF carry the fonts you chose in **Settings > Editor**. The Markdown-based formats
below do not — for Word, fonts come from the reference template instead (see below).

PDF always embeds the bundled faces, and there is no option to turn that off: the renderer
works from a temporary directory that a relative font URL cannot resolve against. For HTML
the Export dialog offers **Embed fonts (+2.7MB)**, off by default. Turn it on when the file
has to keep its typeface on a machine that does not have the font installed. Left off, the
document still asks for the font by name and falls back wherever it is missing.

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

Baram automatically converts its extended syntax to Pandoc-compatible format before export: wikilinks become standard links, callouts become bold-prefixed blockquotes, highlight becomes bold, and subscript, superscript and underline are written in Pandoc's own syntax (`~x~`, `^x^`, `[x]{.underline}`), which Word, EPUB and LaTeX all render.

**Images:**

Word and EPUB embed images, so Pandoc has to read the image files. Baram only lets it read images that live inside the vault or folder the note belongs to — the narrowest one you have open that contains it — whether the note refers to them by a relative path (`![alt](img/diagram.png)`) or by an absolute one; it copies them next to the document it hands to Pandoc, so Pandoc never opens a path from your note directly. Everything else — a path that leads outside that vault or folder, a `file:` URL, a web URL — is replaced by the image's alt text, so a Markdown image never makes a network request during export, and a notice tells you how many images were left out. An image you resized in the editor is stored as an `<img>` tag; it is embedded the same way, at that size, and line breaks inside table cells are kept. If a path that looks like it stays inside the vault turns out to lead outside it (a symbolic link, for example), the export stops and names the image rather than quietly leaving it out. An image file that cannot be found is replaced by its alt text as well. An unsaved document has no folder for relative paths to start from, so its relative images are replaced too; the same goes for a file opened on its own rather than as part of a vault or folder — open its folder to embed its images. LaTeX and RST do not embed images — Pandoc writes the reference and opens no file — so for those formats image destinations are not filtered by this rule. Raw markup written into a note — HTML such as `<video>` or `<iframe>`, LaTeX such as `\newpage` or `\href{…}{…}` — is left out of every Pandoc output (a toggle block is converted to a blockquote first, so it survives). Word never rendered raw HTML; in EPUB it could name files the same way an image does; and raw TeX is a language, so no list of allowed commands could tell a harmless one from a link or a file read. LaTeX and RST output are source files that you compile yourself: image references and math are written into them as they are, and what your TeX run does with them is outside this policy. Frontmatter keys that hand Pandoc a file, such as `cover-image` and `css`, are ignored for the same reason.

---
