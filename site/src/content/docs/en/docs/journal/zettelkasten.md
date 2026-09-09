---
title: "Zettelkasten notes"
---


The **Zettel** space is a dedicated home for atomic, densely-linked notes. Unlike the diary-oriented Journal, it is built around ID-based `[[links]]` and two ways of getting a thought into the vault: tag a capture with a note's name and it is appended straight into that note, or leave it untagged and it waits in the inbox as a fleeting note until you promote it.

## Setup

1. Open **Settings** (`Cmd+,`) → **Zettel**
2. Enable the **Zettel** toggle and **Browse** for a directory (absolute path)
3. Open the space from the space menu (status bar), the Command Palette (**Zettel Perspective**), or `Cmd+Alt+2`. Baram creates the `inbox/` and `notes/` folders automatically.

> If you select the Zettel space before enabling it or setting a directory, Baram shows a hint instead of switching into an empty space.

## The hub panel

In the Zettel space the sidebar is a dedicated **hub** instead of the plain file tree:

- **Actions** — New Zettel, Quick Capture, and New MOC, one click away (same as `Cmd+Shift+V` / `Cmd+Shift+N` / `Cmd+Shift+C`).
- **Inbox queue** — every fleeting note in `inbox/`, newest first, showing its first line as the title plus up to two tags. Click a row to open it; hover to reveal **↑ Promote** (opens the promote dialog pre-filled with the note's first line) and **✕ Delete** (asks for confirmation first).
- **MOCs** — your `#moc`-tagged index notes.
- **Recent** — the notes you touched most recently in `notes/`.

The three lists are collapsible, and the hub refreshes itself automatically whenever you capture, promote, create, or delete a note — including captures made from outside the panel. If the space isn't set up yet, the hub shows a short "set up Zettel" hint with a link into Settings.

## Quick Capture

Press `Cmd+Shift+N` (or the `/capture` slash command) to open Quick Capture — a small window for the thought you do not want to lose while you are doing something else.

- The body is the **same WYSIWYG editor as a document**: headings, lists, code, math, and the `/` slash menu all work. `Cmd+Enter` saves. `Esc` closes the window while it is empty, but once you have typed anything only **Cancel** dismisses it — an accidental key cannot throw away what you wrote.
- **Drop an image** onto the window to attach it. Nothing is written to disk until you save, so closing the window leaves no stray files behind.
- Drag the grip below the editor to **resize** it — the height you choose is remembered for next time.
- **Source** takes an optional URL. Written as `Title https://…` it becomes a link. (Task mode hides this field: a task is a single line with nowhere to carry a source.)
- The **tags** field decides where the capture goes — see below.

> Quick Capture also has a task mode (`Cmd+Alt+T`) that appends a task line to your capture file instead of writing a note. See [Capturing tasks](/en/docs/tasks/panel-and-queries/#capturing-tasks).

## Where a capture lands

**A tag is an address.** Tag a capture `#Inspiration` and it is appended to the note called *Inspiration*, into the document body itself — nothing to promote, no inbox to drain later.

Matching looks at a note's **title and its frontmatter `aliases:`**, ignoring case. It deliberately does not look at the note's own tags, so a hub note carrying its own tag cannot match itself by two different routes. Since a tag cannot contain spaces, a note whose title has spaces is only reachable through an alias:

```yaml
---
aliases: [Baram-Dev-Note]
---
```

| What you tag                        | Where it lands                                        |
| ----------------------------------- | ----------------------------------------------------- |
| One tag matching one note           | Appended to that note                                 |
| Tags matching several notes         | Appended to **every** one of them                     |
| Title and alias of the same note    | Appended once — targets are de-duplicated             |
| A tag matching nothing              | Reported as unmatched, and **not written anywhere**   |
| No tag matches at all               | Saved as a fleeting note in `inbox/{id}.md`, as before |

Two things tell you where a capture is going:

- **While you type**, a line under the tag field previews the destination — `→ Inspiration (12 captures)` for a single note, `→ 3 notes: …` for several, or `→ No matching note · saved to inbox`. It stays silent until the notes folder has actually been read, so a correct tag is never briefly accused of matching nothing.
- **After you save**, a toast names the note and offers **Open**. With more than one target it reports the count instead, because there is no way to know which one you meant to open.

The tag field autocompletes from the names that can actually address a note — titles and aliases — alongside tags already used in the space.

> ⚠️ **A tag that matches no note is not stored anywhere.** The toast tells you (`#typo matches no note`), but the tag itself does not survive into the file. This is a deliberate change from earlier versions, where every capture became an inbox note and its tags were kept in frontmatter. Here a tag is an address, not a classification.

If a target note is open in a tab with **unsaved changes**, that note is skipped and the dialog stays open naming it — save that tab and try again. Notes that were already written keep their entry, so retrying does not duplicate them.

## Hub notes and the Captures section

A capture is appended to the **top** of the note's `## Captures` section, newest first. If the note has no such section, one is created at the end of the file:

```markdown
## Captures

### 2026-09-06 15:30 ^m2609061530

The thought you captured, with all its formatting intact.

Source: [Title](https://example.com)
```

- `## Captures` is a **fixed, untranslated heading**. It does not follow the interface language, so switching languages never leaves a note with two capture sections.
- Each entry is one `###` heading carrying the local date and time, plus a **block ID** (`^m…`) at the end of the heading line. That ID is an ordinary block anchor: point at the entry from anywhere with `((NoteName#^m2609061530))`, or pull it in with `{{embed ((NoteName#^m2609061530))}}`.
- Nothing else in the note is touched. Your own headings and prose, and any section that follows `## Captures`, stay exactly where they were.

A note that collects captures this way is a **hub note** — one document you write into constantly and read as a whole, instead of a folder of fragments you have to open one at a time. Any note can become one: tag a capture with its name, and the section appears.

## Promoting to permanent notes

- Open an inbox note and press `Cmd+Shift+U` to **Promote** it: give it a title and it moves to `notes/{id} {title}.md`, carrying its body and tags forward.
- To create a permanent note directly, press `Cmd+Shift+V` (**New Zettel**).
- To turn a text selection into a new note, press `Cmd+Shift+Y` (**New Note from Selection**) — the selection is replaced with an `[[id]]` link to the new note.

## Linking notes

- Notes are stored as `{id} {title}.md`, where `id` is a timestamp. Links are stored as `[[id]]` but render the note's **live title** in the editor, so links never break when you rename a note.
- Type `[[` and search by title; selecting a note inserts its `[[id]]` link. `Cmd+click` a link to open the target.

## Maps of Content (MOC)

- Press `Cmd+Shift+C` (**New MOC**) to create a `#moc`-tagged index note — a curated entry point that links to related notes. Find your MOCs by searching the `#moc` tag.

---
