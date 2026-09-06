---
title: "The Tasks panel and task queries"
---

## The Tasks panel

Open **Tasks** in the activity bar (the check-circle icon). It gathers every indexed task into buckets, in this order:

| Bucket             | Holds                                                     |
| ------------------ | --------------------------------------------------------- |
| **Overdue**        | a `📅` due date in the past                                |
| **Past scheduled** | a `⏳` scheduled date in the past, but no missed due date  |
| **Today**          | due today                                                 |
| **This week**      | due before the end of the week                            |
| **Later**          | due after that                                            |
| **No date**        | no date at all                                            |
| **Finished this week** / **Done** | completed                                  |
| **Cancelled**      | `[-]`                                                     |

Overdue and past-scheduled are separate on purpose: a missed **due** date is a broken promise, a missed **scheduled** date is only a plan that slipped. Which day the week starts on is **Settings > General > Tasks > Week starts on** (default Monday). The buckets roll over at midnight without a restart.

In-progress tasks stay in their date bucket rather than getting one of their own — being held doesn't change when a thing is due — and the state is shown on the row.

**Filters** across the top: free-text filter, state, priority (`⏫ High+` / `Normal` / `🔽 Low−`), tag, linked note, and a **Someday** toggle. **Agenda scope** decides which roots are scanned — All vaults (default), Current vault, or Tasks home.

**Working from the panel**

- The checkbox completes a task in place, writing to its file.
- Clicking a row jumps to that line in its own note.
- Two badges sit at the end of a row: **`−Nd`** is how many days past the date that put the task in its bucket (the due date in Overdue, the scheduled date in Past scheduled), and **`Nd`** with a *Stale* tooltip appears once a task has gone **30 days** since its `➕` created date without being finished.
- The **triage menu** on a row offers Due today, Due tomorrow, Pick a date…, Defer to `#someday`, Cancel/Reopen, and Delete line.
- **Reschedule overdue tasks to today** moves everything overdue in one confirmed step.
- **Weekly review** walks the backlog one task at a time — `j`/`k` to move, `x` done, `t` today, `s` someday, `⌫` delete.
- **Archive completed tasks** moves anything finished more than *N* days ago (default 30, configurable) into `tasks/archive/YYYY-MM.md`. Nothing is archived automatically, and archived tasks stay indexed and searchable. Archiving is only offered in the Tasks home scope, and it needs a tasks home set.

## Tasks in this note

The **Backlinks** panel carries a **Tasks in this note** section underneath it, listing every task anywhere in your vault whose line links to the note you have open (`- [ ] Review the draft [[Project Apollo]]` shows up while `Project Apollo` is open). Rows behave exactly like the agenda's — check them off, jump to them, or use the triage keys.

The **Zettel hub** has its own compact Tasks section showing only what needs attention now — overdue and due today, at most seven rows, with **See all** handing off to the full agenda.

## Capturing tasks

Open **Quick Capture** with `Cmd+Shift+N`, then press `Cmd+Alt+T` to switch it into task mode. What you write lands in your capture file: `inbox.md` inside the `tasks/` subfolder of your **Tasks home**, which defaults to your Zettel directory.

You can also assign a **global capture shortcut** (**Settings > General > Tasks**) that opens Quick Capture in task mode even while Baram is in the background. It has no default, because a global shortcut is intercepted system-wide and could take a key combination another app already uses.

## Tasks in a query block

A ` ```query ` block with `source: tasks` embeds any slice of your task list into a note, and the results stay checkable. See [Query Blocks](/baram/en/docs/rich-content/query-blocks/#query-blocks) for the full field and operator reference.

## Task settings

All under **Settings > General > Tasks**:

| Setting                          | Default            | What it does                                                        |
| -------------------------------- | ------------------ | ------------------------------------------------------------------- |
| Enable Tasks                     | on                 | Index checkboxes across the vault and show the Tasks panel          |
| Exclude folders                  | none               | Comma-separated folders to skip when indexing                       |
| Week starts on                   | Monday             | Decides what falls in the **This week** bucket                      |
| Record completion date           | on                 | Append `✅` with today's date when a task is checked                 |
| Record created date              | on                 | Add `➕` to a task line you finish typing in the editor              |
| Track time on tasks in progress  | off                | Write `⏱` while a task is `[/]`                                     |
| Tasks home                       | Zettel directory   | Folder holding captured tasks and their archive                     |
| Capture file                     | `inbox.md`         | File name inside `{tasks home}/tasks/`                              |
| Agenda scope                     | All vaults         | Which roots the agenda scans                                        |
| Archive after                    | 30 days            | How old a completed task must be for **Archive completed tasks**    |
| Global capture shortcut          | not set            | Opens Quick Capture in task mode from anywhere                      |

---
