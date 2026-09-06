---
title: "Journal and Zettelkasten"
---

## Zettel (Zettelkasten Notes)

### What is the Zettel space?

Zettel is a dedicated space for atomic, densely-linked notes, separate from the diary-oriented Journal. It supports two ways of working. Tag a capture with a note's name and it is appended straight into that note, so the thought is filed the moment you write it. Leave it untagged and it lands in `inbox/` as a fleeting note, to be refined later into a permanent, titled note in `notes/` and connected with links.

### How do I capture a quick note?

Press `Cmd+Shift+N` (or type `/capture`) to open Quick Capture. The body is the same WYSIWYG editor as a document — formatting, the `/` slash menu, and dropped images all work. `Cmd+Enter` saves. Add an optional source URL, and tags to say where it should go.

### Where does my capture go?

**A tag is an address.** A tag matching a note's title or one of its frontmatter `aliases:` (case does not matter) appends the capture to the top of that note's `## Captures` section, as a `### date time` entry with a block ID you can reference. Tags matching several notes append to all of them. A capture whose tags match nothing is saved as a fleeting note in `inbox/{id}.md`, exactly as before.

While you type, a line under the tag field shows where the capture will land; after you save, a toast names the note and offers **Open**.

Note that a tag matching no note is reported to you but **not written into the file** — in this workflow a tag is an address, not a classification. See [Where a capture lands](/baram/en/docs/journal/zettelkasten/#where-a-capture-lands) in the User Guide.

### How do I turn an inbox note into a permanent note?

Open the inbox note and press `Cmd+Shift+U` (Promote). Give it a title — it moves to `notes/{id} {title}.md`, keeping its body and tags. You can also create a permanent note directly with `Cmd+Shift+V` (New Zettel), or turn a selection into a new note with `Cmd+Shift+Y`.

### Why do links look like `[[id]]` on disk but show titles in the editor?

Zettel notes are addressed by a timestamp `id`, so links are stored as `[[id]]`. Baram renders the note's current title in the editor, so links never break when you rename a note. Type `[[` to search by title.

### How do I enable it?

Go to **Settings > General > Zettel**, toggle it on, and choose a directory. Then open the space from the space menu (status bar), the Command Palette ("Open Zettel"), or `Cmd+Alt+2`.

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
