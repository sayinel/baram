---
title: "Linking and navigation"
---


## How do wikilinks work?

Type `[[` to start a wikilink. An autocomplete popup appears with matching files from your workspace. Select a file to insert a link like `[[My Note]]`. Cmd+click (or Ctrl+click on Windows) to navigate to the linked page.

Advanced syntax:

- `[[page|custom text]]` — Display custom text
- `[[page#heading]]` — Link to a specific heading
- `[[page#^block-id]]` — Link to a specific block
- `[[paper.pdf]]` — Link to a non-markdown file Baram can view

A wikilink can also point at a file Baram opens as a document — a PDF, an HTML file, a code file
or plain text — by writing its extension. The autocomplete offers those files and labels each with
its type, so `report.pdf` is distinguishable from `report.md` before you pick; images and SVG are
not offered, since markdown embeds those with `![](…)`. Plain markdown links such as
`[the paper](papers/attention.pdf)` open in Baram too — but only `[[…]]` links are collected into
the link index, so a markdown link produces no backlink and no graph edge. A wikilink to the same
PDF does.

## What are backlinks?

Backlinks are the reverse of wikilinks — they show you which documents link *to* the current file. Press `Cmd+Shift+B` to open the backlinks panel in the sidebar. Each backlink shows the source file and context.

## What are unlinked mentions?

Unlinked mentions show files that contain the current file's name in their text, but don't include an actual `[[wikilink]]`. This helps you discover connections you might want to formalize.

## What are block references and block embeds?

- **Block reference** `((file#^id))` — An inline reference to a specific block in another file. Cmd+click to navigate.
- **Block embed** `{{embed ((file#^id))}}` — Embeds a live preview of the referenced block. You can edit the embedded content directly.

To create a referenceable block, add `^my-id` at the end of a paragraph or heading.

## What are @mentions and how are they different from wikilinks?

@Mentions (`@[[page]]`) and wikilinks (`[[page]]`) both link to pages in your workspace, but they serve different purposes:

- **Wikilinks** (`[[page]]`) render as styled inline text links — ideal for flowing prose
- **Mentions** (`@[[page]]`) render as chip badges with icons (📅 for dates, 📄 for pages) — visually distinct for quick scanning

Type `@` to open the mention popup with Quick Dates (Today, Yesterday, Tomorrow) at the top and workspace pages below. Mentions are especially useful for referencing dates (journal entries) and for cases where you want a more prominent visual indicator.

In markdown, mentions serialize as `@[[value]]` — the `@` prefix distinguishes them from regular wikilinks.

## How do tags work?

Type `#tag` inline (with autocomplete) or add a `tags:` list to YAML frontmatter — both are indexed across the whole vault. Use `#parent/child` for nested tags. `Cmd/Ctrl+click` a tag to search every file that uses it. The Tags panel (from the Activity Bar) shows a tree or a frequency-sized cloud where you can rename a tag vault-wide, assign colors, filter the file tree by tag, or get AI tag suggestions for the current note.

## What happens when I rename a file?

When you rename a file in the file tree (press `F2`), all wikilinks pointing to that file are automatically updated across your workspace. No broken links.

## How do I navigate between recently viewed files?

Use `Cmd+[` (macOS) or `Ctrl+[` (Windows/Linux) to go back, and `Cmd+]` / `Ctrl+]` to go forward. This works like browser navigation history.

## How do I bookmark files?

Press `Cmd+D` (macOS) or `Ctrl+D` (Windows/Linux) to bookmark the current file. Bookmarked files appear in the Bookmarks section of the left sidebar. Press again to remove.

## How do I quickly switch between files?

Press `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux) to open the Quick Switcher. Type to search files by name. Type `#` to search by heading. The switcher also supports `Ctrl+Tab` for MRU (Most Recently Used) tab switching.

---
