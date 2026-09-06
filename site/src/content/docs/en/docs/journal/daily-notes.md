---
title: "Journal and daily notes"
---


Baram includes a built-in journal system for maintaining daily notes with automatic creation and calendar navigation.

## Setup

1. Open **Settings** (`Cmd+,` / `Ctrl+,`) and go to the **General** tab
2. Enable the **Journal** toggle
3. Click **Browse** and select a folder for your journal files (must be an absolute path)
4. (Optional) Choose a filename format: `YYYY-MM-DD.md` (default) or `YYYYMMDD.md`
5. (Optional) Select a custom template file (`.md`)
6. Choose startup behavior: **Open today's journal** (auto-open on launch) or **Do nothing**

## Creating Daily Notes

There are three ways to create or open a daily note:

**Calendar sidebar:**

1. Switch to the Journal perspective (`Cmd+Alt+3` / `Ctrl+Alt+3`) or select the Calendar panel in the sidebar
2. Click any date in the mini calendar — if a journal entry doesn't exist, it is created from your template
3. Dates with existing entries are marked with a dot

**Date links:**

1. Write `[[2026-02-27]]` — a wikilink whose target is a date
2. Click it to open that day's entry; if none exists yet, Baram asks before creating it
3. From **inside** the journal a bare date link resolves to the entry directly. From another vault, name the space: `[[Journal::2026-02-27]]`

To write a date *without* linking to its entry, use `@` — see [@Dates](/baram/en/docs/linking/dates-references-and-navigation/#dates). Clicking an `@` chip opens a calendar to change the date, not the journal.

**Auto-creation on startup:**
When "Open today's journal" is enabled in settings, Baram automatically creates and opens today's entry every time you launch the app.

## Templates

Custom templates support the following variables:

| Variable        | Replaced With       | Example      |
| --------------- | ------------------- | ------------ |
| `{{date}}`      | Full date           | `2026-02-27` |
| `{{year}}`      | Year                | `2026`       |
| `{{month}}`     | Month (zero-padded) | `02`         |
| `{{day}}`       | Day (zero-padded)   | `27`         |
| `{{dayName}}`   | Day of the week     | `Friday`     |
| `{{monthName}}` | Month name          | `February`   |

If no custom template is set, Baram uses a default template with YAML frontmatter and a date heading.

## Periodic Notes

Beyond daily entries, Baram supports weekly, monthly, and yearly notes:

- Enable each type in **Settings > General > Journal**
- In the Calendar sidebar, click the week-number column for a weekly note, the month header for a monthly note, or the year for a yearly note
- Each periodic note type can have its own template

## Photo Journal

- Drag, paste, or use the `/photo` slash command to add images — they are auto-saved to an `assets/` folder next to your journal
- Open the **Photo Gallery** (`Cmd+Shift+I` / `Ctrl+Shift+I`) to browse your journal media grouped by **Day**, **Month**, or **Year**, with a keyboard-navigable lightbox (`←` / `→` to move, `Esc` to close)
- Video clips dropped into a journal entry appear in the gallery alongside photos and play in the lightbox. Filter the view with **All** / **Photos** / **Videos**
- Thumbnails and lightbox images are cached previews, so a year of camera-sized photos scrolls smoothly. In the lightbox, **원본 보기 / View original** opens the full-resolution file; `Esc` closes that view first and leaves the lightbox open

## Memories

- Open the **Memories** view (`Cmd+Shift+R` / `Ctrl+Shift+R`) to revisit past entries by year
- Two tabs: Journal (one-line or full) and Photos
- Edit the current year's one-line summaries inline

## Streaks & Stats

- Track consecutive-day **streaks** and view monthly/yearly stats plus a contribution heatmap

## Journal Themes

Choose a dedicated journal/calendar theme (independent of the app theme) in **Settings > General > Journal**.

---
