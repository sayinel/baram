---
title: "Tasks and query blocks"
---

## Tasks

### How do I turn tasks on or off?

They are on by default. **Settings > General > Tasks > Enable Tasks** controls both the vault-wide index and the Tasks icon in the activity bar.

### What are the four checkbox states?

`- [ ]` to do, `- [/]` in progress, `- [x]` done, `- [-]` cancelled. Clicking the checkbox cycles through the first three. Cancelled is deliberately off that ring — use `/cancel-task` in the editor or **Cancel task** in the agenda's row menu — so a stray extra click can never land there.

`[/]` and `[-]` are not part of GitHub Flavored Markdown, so an editor that doesn't know them shows the raw `[/]` instead of a checkbox. The line itself is never lost.

### How do I set a due date without typing an emoji?

Three ways, all of which write the same `📅2026-09-30`:

- **Word trigger** — type `due:2026-09-30` (or `due:t`, `due:m`, `due:+3`, `due:9/30`) followed by a space
- **Plain language** — write "by friday" or "내일"; Baram underlines what it recognized and `Tab` confirms it
- **Slash command** — `/due` opens a calendar

`sched:` / `/sched` sets `⏳` and `start:` / `/start` sets `🛫` the same way.

### How do I set a priority?

Type `prio:1` through `prio:5` (or the short `!1`…`!5`) followed by a space, or use `/priority`. P1 is the most urgent: `🔺 ⏫` (nothing) `🔽 ⏬`.

### How do I make a task repeat?

`/repeat` — it's the only entry point, because the rule contains spaces and so can't be a word trigger. Rules look like `every day`, `every 2 weeks`, `every weekday`, `every week on Monday`, `every month on the 15th`.

Completing or cancelling a repeating task **rolls it forward**: the dates move to the next occurrence and the state returns to `[ ]`, all on the same line. If the chip says *(no date to move)* the task has a rule but no date to roll; *(not understood)* means the rule doesn't match the grammar above.

### Where does the Tasks panel get its tasks from?

Every markdown file in the roots covered by **Agenda scope** (**Settings > General > Tasks**), which defaults to All vaults. Folders listed under **Exclude folders** are skipped. Query blocks are different — they always search the vault the note lives in, so a note shows everyone the same list.

### Why is my task in "Past scheduled" instead of "Overdue"?

Overdue means a missed `📅` **due** date — a commitment you made. Past scheduled means a missed `⏳` **scheduled** date — a day you meant to start, which is a much softer signal. Keeping them apart stops every undated capture from turning the panel red.

### Does completing a task record the date?

Yes, `✅` with today's date, controlled by **Record completion date** (on by default). **Record created date** does the same with `➕` when you finish typing a new task line.

### Can Baram track how long a task takes?

Turn on **Settings > General > Tasks > Track time on tasks in progress**. While a task sits in `[/]` it carries a `⏱` field, and the elapsed time is banked when it leaves that state. It's off by default because switching a task to "in progress" would otherwise write a new field into a file other apps also read.

### What happens to old completed tasks?

Nothing, until you ask. **Archive completed tasks** in the panel moves anything finished more than *N* days ago (default 30) into `tasks/archive/YYYY-MM.md`. Archived tasks stay indexed and searchable. Nothing is ever archived automatically.

### Where else do tasks show up besides the Tasks panel?

Two places. The **Backlinks** panel has a **Tasks in this note** section listing every task in your vault whose line links to the open note. The **Zettel hub** shows a compact Tasks section — overdue and due today only, up to seven rows, with **See all** opening the full agenda. Both use the same rows as the agenda, so you can check tasks off from either.

### What do the `−5d` and `12d` badges on a task row mean?

`−5d` counts days past the date that put the task in its bucket — the due date in **Overdue**, the scheduled date in **Past scheduled**. `12d` with a *Stale* tooltip means the task has gone 30 days or more since its `➕` created date without being finished; it's there to surface things quietly rotting in the inbox.

### Can AI pull tasks out of my meeting notes?

Yes — select the prose and run `/extract-tasks` (**Extract Action Items**). The proposed task lines go through the usual AI diff preview, so nothing is written until you accept.

---

## Query Blocks

### What is a query block?

A saved search that lives inside a note and renders its results there. Insert one with `/query`, or write a ` ```query ` fenced code block by hand. It can list **notes** or **tasks**.

### Do query results update by themselves?

Not continuously. A block re-runs when you close its builder, when the query text changes, when you press **Run query**, and when you check off a task in its own results. A note query reads every markdown file in the vault, so running it on every keystroke would mean scanning the vault non-stop.

### How do I write a query by hand?

Each line is `key: value` — `source`, `filter`, `sort`, `display`, `limit`. All are optional:

````markdown
```query
source: tasks
filter: state = "todo" AND due before "+7d"
sort: due asc
display: list
limit: 10
```
````

The full field and operator tables are in the [User Guide](/baram/en/docs/rich-content/query-blocks/#query-blocks).

### Why does my query return nothing?

Most often a field/operator combination that doesn't exist — an unknown pair matches nothing rather than raising an error, so the block just looks empty. Open the builder and re-pick the field; it only ever offers operators that work. The other common cause is `priority`: queries filter on a signed weight (`🔺`=2, `⏫`=1, normal=0, `🔽`=-1, `⏬`=-2), not on the P1–P5 rank you type, so high-priority tasks are `priority > "0"`.

### Can I check off a task from inside a query block?

Yes, in the default `display: list`. The checkbox writes to the task's own file and the block re-runs. That's what makes a Map of Content usable as a project board. Clicking a row jumps to the task in its source file.

### Do query blocks break my file for other editors?

No. On disk a query block is an ordinary fenced code block with the `query` info string, so other tools show it as a code block.

---
