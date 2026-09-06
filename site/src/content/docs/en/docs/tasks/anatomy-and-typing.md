---
title: "Writing a task"
---


Every `- [ ]` checkbox in your vault is a task. Baram indexes them all, lets you give them dates, priorities and repeat rules without typing a single emoji, and gathers them into an agenda — while the task stays a plain markdown line in the note where you wrote it.

Tasks are on by default. Turn them off in **Settings > General > Tasks > Enable Tasks**; the Tasks sidebar icon disappears with them.

## Anatomy of a task line

```markdown
- [ ] Draft the Q3 report #work [[Project Apollo]] ➕2026-09-01 🛫2026-09-03 ⏳2026-09-05 📅2026-09-10 ⏫ 🔁every week
```

**The four states**

| Written  | Means       | Shown as      |
| -------- | ----------- | ------------- |
| `- [ ]`  | To do       | empty box     |
| `- [/]`  | In progress | half-filled   |
| `- [x]`  | Done        | checked       |
| `- [-]`  | Cancelled   | struck through |

Clicking the checkbox cycles **To do → In progress → Done**. `Cancelled` is deliberately off that ring — reach it with `/cancel-task` in the editor, or **Cancel task** in the agenda's triage menu — so you can never land on it by clicking one time too many.

> `[/]` and `[-]` are not part of GFM. A viewer that doesn't know them shows the raw `[/]` instead of a checkbox; the line itself is never lost.

**The fields**

Text first, then any `#tags` and `[[links]]`, then the fields in a fixed order — so a line built by the app always looks the same. `🔁` is last because its value runs to the end of the line:

| Field       | Marker | Value                                    |
| ----------- | ------ | ---------------------------------------- |
| Created     | `➕`   | `YYYY-MM-DD`                             |
| Start       | `🛫`   | `YYYY-MM-DD`                             |
| Scheduled   | `⏳`   | `YYYY-MM-DD`                             |
| Due         | `📅`   | `YYYY-MM-DD`                             |
| Completed   | `✅`   | `YYYY-MM-DD`                             |
| Cancelled   | `❌`   | `YYYY-MM-DD`                             |
| Priority    | `🔺` `⏫` `🔽` `⏬` | (no marker = normal)         |
| Time spent  | `⏱`   | `1h27m`, or `1h27m+2026-09-01T14:03` while running |
| Repeat      | `🔁`   | a rule such as `every week on Monday`    |

This is the same emoji vocabulary the Obsidian Tasks plugin uses, so a vault shared between the two reads the same either way. Any marker Baram doesn't recognize is left alone and pushed to the end of the line rather than reordered.

## Typing a task

You never have to type an emoji. Inside a task line, type a **word trigger** followed by a space and it becomes the field:

| You type      | You get         |
| ------------- | --------------- |
| `due:2026-09-30 ` | `📅2026-09-30` |
| `due:t `      | `📅` today       |
| `due:m `      | `📅` tomorrow    |
| `due:+3 `     | `📅` three days from now |
| `due:9/30 `   | `📅` Sep 30 (next year if it has already passed) |
| `sched:m `    | `⏳` tomorrow    |
| `start:t `    | `🛫` today       |
| `prio:1 ` or `!1 ` | `🔺` urgent |
| `prio:2 ` or `!2 ` | `⏫` high   |
| `prio:3 ` or `!3 ` | normal (trigger disappears, no marker) |
| `prio:4 ` or `!4 ` | `🔽` low    |
| `prio:5 ` or `!5 ` | `⏬` lowest |

Pressing `Enter` instead of space works too — it converts the field *and* starts the next task in one undo step.

> Note the two priority scales. What you **type** is a rank, P1 (most urgent) to P5. What a **query** filters on is a signed weight: `🔺 = 2`, `⏫ = 1`, normal `= 0`, `🔽 = -1`, `⏬ = -2`.

**Dates in plain language.** Write a date the way you'd say it and Baram underlines what it recognized; press `Tab` to turn it into a field. It understands English and Korean:

- `today`, `tomorrow`, `yesterday`, `오늘`, `내일`, `모레`, `어제`
- `friday`, `next monday`, `금요일`, `다음 주 월요일`, and `금요일까지`
- `in 3 days`, `3일 후`
- `2026-09-15`, `9/15`, `9월 15일`
- a leading `by` is absorbed, so `Send the draft by friday` + `Tab` leaves `Send the draft 📅2026-09-18`

Only an expression that **ends at the cursor** is recognized, so `Tab` still indents everywhere else.
