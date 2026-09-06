---
title: "Dates, block references, and navigation"
---

## @Dates

`@` writes a **date** — a day named in your prose, as a styled inline chip:

1. **Type&#x20;**`@` — A suggestion popup appears with Quick Dates
2. **Quick Dates** — Today, Yesterday, Tomorrow (with resolved dates shown)
3. **Pick a date…** — Opens a calendar for any other day
4. **Or type it** — A full `YYYY-MM-DD` is accepted directly

**Syntax in markdown:**

| Syntax            | Description         |
| ----------------- | ------------------- |
| `@[[2026-02-27]]` | A specific date     |

**Clicking a date chip opens the calendar and changes the date in place.** It does not navigate — a date mention names a day, it does not point at a document.

**To open that day's journal entry, link it instead:** `[[2026-02-27]]`. See [Journal / Daily Notes](/baram/en/docs/journal/daily-notes/) for how date links resolve.

**Dates vs. wikilinks:**

| | Means | Click |
| --- | --- | --- |
| `@[[2026-02-27]]` | a date **value** | opens the calendar to change it |
| `[[2026-02-27]]` | a **reference** to that day's entry | opens it |
| `[[My Note]]` | a **reference** to a page | opens it |

Only `[[…]]` links are collected into the link index, so only they appear in backlinks and the Graph View.

> **Page mentions.** Earlier versions also offered `@[[My Note]]` for pages. That pointed at the same file `[[My Note]]` does while never appearing in backlinks, so `@` is now dates only. Page mentions already written keep rendering and still navigate on Cmd+click (Ctrl+click on Windows/Linux); use `[[…]]` for new ones.

## Block References

Reference specific blocks from other documents:

1. **Create a Block ID** — Add `^my-id` at the end of any paragraph or heading
2. **Insert a Block Reference** — Type `((file#^my-id))` to create an inline reference
3. **Insert a Block Embed** — Type `{{embed ((file#^my-id))}}` to embed the block's content

Block references appear as inline chips that you can `Cmd+click` to navigate to the source. Block embeds show a live, read-only preview of the referenced block — and you can edit the embedded content directly, with changes syncing back to the source file.

**References to PDF highlights** are block references too, produced by **Copy reference** in the
PDF reader. They render as the quoted sentence, or as the cropped region for an area highlight,
and take an optional width — `((target#^id|w=60))`, an integer percentage from 10 to 100 — which
you can also set by dragging the reference's right edge. See
[PDF Reading & Highlights](/baram/en/docs/pdf/toolbar-zoom-and-find/).

## Backlinks

The Backlink Panel shows all documents that link to the current file:

1. Press `Cmd+Shift+B` (macOS) or `Ctrl+Shift+B` (Windows/Linux) to open the backlinks sidebar
2. Each backlink shows the source file name and surrounding context
3. Click a backlink to navigate to the source file

**Unlinked Mentions:** Below the backlinks, a separate section shows files that mention the current file name in their text but don't include a wikilink. Click to convert them to links.

## Navigation History

Navigate between recently visited locations:

| Action     | macOS          | Windows/Linux |
| ---------- | -------------- | ------------- |
| Go Back    | `Cmd+[`        | `Ctrl+[`      |
| Go Forward | `Cmd+]`        | `Ctrl+]`      |

## Bookmarks

Bookmark frequently accessed files for quick access:

1. Press `Cmd+D` (macOS) or `Ctrl+D` (Windows/Linux) to bookmark the current file
2. Bookmarked files appear in the Bookmarks section of the left sidebar
3. Press again to remove the bookmark

## Graph View

A visual map of your note connections. Nodes represent files, edges represent wikilinks between them. Use the Graph View to explore the structure of your workspace and discover clusters of related notes.

---
