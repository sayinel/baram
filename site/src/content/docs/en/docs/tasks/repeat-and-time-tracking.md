---
title: "Repeat rules and time tracking"
---

## Slash commands

With the cursor on a task line:

| Command        | Does                                                       |
| -------------- | ---------------------------------------------------------- |
| `/due`         | Pick a due date (text field + calendar)                     |
| `/sched`       | Pick a scheduled date                                       |
| `/start`       | Pick a start date                                           |
| `/priority`    | Choose one of the five levels from a list                   |
| `/repeat`      | Set a repeat rule — the **only** way to enter one, because its value contains spaces |
| `/cancel-task` | Mark the task cancelled, keeping the line                   |

`/extract-tasks` (**Extract Action Items**) works anywhere, not just on a task line — see [AI Features](/en/docs/ai/templates-commands-and-skills/#extract-action-items).

The date dialogs carry a three-layer calendar: click the centre label to widen from days to months to years, pick a cell to narrow back down. Typing in the text field returns you to the day view. Picking a month or a year only moves the view — only choosing a day sets the value.

## Editing an existing task

Every field renders as a **chip** in the editor. Click a chip to edit that field, or clear it to remove the field. `Cmd+Alt+T` (**Task input**, remappable) opens the full dialog — **Edit task** on an existing task line, **New task** anywhere else. It shows every field, a tag box, and a live preview of the resulting line. Somewhere a task can't go (a heading, a table, a code block) it closes itself.

If the line changed underneath you — another window, an external editor — the write is refused rather than overwriting, and the dialog tells you so.

## Repeat rules

A `🔁` rule is written in English (so other tools read it the same) and must match this shape:

```
every [N] day|days|week|weeks|weekday|month|months|year|years [on <anchor>]
```

| Example                    | Means                          |
| -------------------------- | ------------------------------ |
| `every day`                | daily                          |
| `every 2 weeks`            | fortnightly                    |
| `every weekday`            | next business day              |
| `every week on Monday`     | Mondays                        |
| `every month on the 15th`  | the 15th of each month         |
| `every year`               | annually                       |

Anchors only attach to their own unit: `on Monday` needs `week`, `on the 15th` needs `month`, and `every weekday` takes neither an interval nor an anchor.

**Completing or cancelling a repeating task rolls it forward** instead of closing it: the start/scheduled/due dates all move to the next occurrence, the state returns to `[ ]`, and a toast shows the new date. The line stays a single line.

A rule that can't do that says so on its chip:

- *repeats … (no date to move)* — the task has a `🔁` but no date to roll
- *repeats … (not understood)* — the rule doesn't match the grammar above

## Time tracking

Off by default. Turn on **Settings › Tasks > Track time on tasks in progress** and a task writes a `⏱` field while it sits in `[/]`, banking the elapsed time when it leaves that state:

```
⏱1h27m                      stopped — an hour and 27 minutes so far
⏱1h27m+2026-09-01T14:03     running — counting again from that moment
```

It is off by default on purpose: switching a task to "in progress" would otherwise add a field to a file that other apps also read.
