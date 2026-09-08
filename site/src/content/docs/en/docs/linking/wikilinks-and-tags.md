---
title: "Wikilinks and tags"
---


## Wikilinks

Connect your notes using `[[wikilinks]]`:

1. **Type&#x20;**`[[` — An autocomplete popup appears with matching files
2. **Select a file** — The wikilink is inserted (e.g., `[[My Note]]`)
3. **Cmd+click** — Navigate to the linked page

**Advanced wikilink syntax:**

| Syntax                   | Description                   |
| ------------------------ | ----------------------------- |
| `[[page]]`               | Basic link to a page          |
| `[[page\|display text]]` | Link with custom display text |
| `[[page#heading]]`       | Link to a specific heading    |
| `[[page#^block-id]]`     | Link to a specific block      |
| `[[paper.pdf]]`          | Link to a non-markdown file Baram can view |

**Linking to other file types:** A wikilink can name any file Baram opens as a document — PDFs,
HTML, code files, and plain text (`.txt`, `.csv`, `.tsv`, `.log`) — by writing the extension:
`[[paper.pdf]]`, `[[schema.sql]]`. The autocomplete offers these alongside your notes and labels
each one with its type, so you can tell a `report.pdf` from a `report.md` before you pick. Images
and SVG are not offered, because markdown embeds those with `![](…)` — but `[[diagram.svg]]` still
resolves if you write it yourself. Plain markdown links work too: `[the paper](papers/attention.pdf)`
opens in Baram rather than handing the file to your operating system.

Only `[[…]]` links are collected into the link index, so a wikilink to a PDF you cite appears in
backlinks and as a node in the Graph View — a plain markdown link to the same file does not.

**Hover Preview:** Hover over any wikilink to see a preview of the target document's content without navigating away.

## Auto-Rename

When you rename a file in the file tree (select a file and press `F2`), all wikilinks pointing to that file are automatically updated across your workspace.

## Tags

Organize notes with `#tags`, indexed across the entire vault:

1. **Type `#tag`** inline (autocomplete suggests existing tags), or add a `tags:` list to YAML frontmatter
2. **Nested tags** — Use `#parent/child` for hierarchy
3. **Cmd/Ctrl+click** a tag to search every file that uses it

**Tag panel:** Open the Tags panel from the Activity Bar to browse tags as a tree or a frequency-sized cloud. From here you can:

- **Rename** a tag across the whole vault
- Assign **colors** to tags
- **Filter the file tree** by tag
- Get **AI tag suggestions** for the current note
