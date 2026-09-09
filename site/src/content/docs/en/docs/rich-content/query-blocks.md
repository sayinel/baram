---
title: "Query blocks"
---

## Query Blocks

A query block is a saved search that lives **inside a note** and renders its results in place. Point it at your notes or at your tasks, and the block shows a live list every time it runs — a project note can carry its own open-tasks list, and a Map of Content can list every note tagged `#reference` without you maintaining the list by hand.

### Inserting one

- Type `/query` in the slash menu, or use **Insert > Query Block**
- Or write the fenced block by hand in Source mode:

  ````markdown
  ```query
  source: tasks
  filter: state = "todo" AND due before "+7d"
  sort: due asc
  limit: 10
  ```
  ````

On disk a query block is nothing but a fenced code block with the `query` info string, so any other markdown tool shows it as a code block rather than losing it.

### The visual builder

Click a query block to open its builder. There is no save step — every change is written into the block as you make it, and the query re-runs when you click away (or press `Esc` in vim mode).

| Control     | What it sets                                                                  |
| ----------- | ----------------------------------------------------------------------------- |
| **Source**  | `Notes` or `Tasks` — what the query searches                                  |
| **Filters** | One or more `field · operator · value` rows, joined by `AND` / `OR`           |
| **Sort**    | A field and a direction (Ascending / Descending)                              |
| **Display** | `list`, `table`, or `card`                                                    |
| **Limit**   | Maximum number of results (default `20`)                                      |
| **Run query** | Runs it immediately without leaving the builder                             |

The header shows `{n} results`. Clicking a result opens that document.

> **Changing the source discards filters that no longer apply.** `tags` means something for notes but nothing for tasks, so switching from Notes to Tasks drops any filter or sort whose field does not exist on the new source. This is deliberate: a filter the executor can never match would leave the block permanently empty with nothing on screen explaining why.

### When a query runs

A query block does **not** watch your vault. It runs when:

- you close its builder (click away, or `Esc`),
- the query text changes while the builder is closed,
- you press **Run query**,
- you check off a task in its own results.

Opening a note therefore shows the results from its last run until one of those happens. This is a deliberate trade — `source: notes` reads every markdown file in the vault, so re-running on every keystroke or every cursor move would scan the vault continuously.

---

### The query language

Each line is `key: value`. Every line is optional, unknown keys are ignored, and lines left at their default are not written to the file at all.

| Key       | Values                              | Default |
| --------- | ----------------------------------- | ------- |
| `source`  | `files` (notes) or `tasks`          | `files` |
| `filter`  | filter expression (see below)       | none    |
| `sort`    | `<field> asc` or `<field> desc`     | none    |
| `display` | `list`, `table`, `card`             | `list`  |
| `limit`   | a number                            | `20`    |

**Filter grammar.** Segments are `field operator "value"`, joined by `AND` or `OR`. Values are quoted; the `empty` operator takes no value.

```query
filter: tags contains "project" AND state != "done"
```

`AND` binds tighter than `OR`. The expression is read as OR-separated groups, and a result matches if **every** condition in **any one** group holds:

```query
filter: priority > "0" AND due before "t" OR tags contains "urgent"
```

reads as `(priority > 0 AND due before today) OR (tags contains urgent)`.

---

### Querying notes (`source: files`)

| Field        | Operators                              | Notes                                              |
| ------------ | -------------------------------------- | -------------------------------------------------- |
| `tags`       | `contains`, `not_contains`             | `#tag` anywhere in the file, without the `#`        |
| `path`       | `starts`, `contains`, `regex`          | Vault-relative path                                 |
| `name`       | `contains`, `starts`, `=`              | File name                                           |
| `body`       | `contains`                             | Full-text, case-insensitive                         |
| `status`     | `=`, `!=`, `contains`, `empty`         | A frontmatter key                                   |
| `updated_at` | `before`, `after`                      | Value is a date the builder shows as a date picker  |
| `created_at` | `before`, `after`                      | Same                                                |

Any **other** field name is read as a frontmatter key, compared as text, and supports `=`, `!=`, `contains`, and `empty`. So `filter: author = "Kim"` matches `author: Kim` in the frontmatter.

Sortable fields: `updated_at`, `created_at`, `name`, `path`. (You cannot sort by `body`.)

**Example — recently touched project notes**

```query
source: files
filter: tags contains "project" AND updated_at after "2026-01-01"
sort: updated_at desc
display: table
limit: 15
```

`display: table` gives a column per frontmatter key found in the results, plus `name` and `path`. `display: card` shows name, path, and up to five tags per card.

> `body contains` has to read every file in the vault, so keep it paired with a narrower filter, or with a small `limit`.

---

### Querying tasks (`source: tasks`)

Task queries search every task Baram has indexed **in the vault the note lives in** — not the scope the Tasks sidebar is set to. A note shows the same list to everyone who opens it, whatever their sidebar happens to be filtered to.

Tasks must be enabled (**Settings › Tasks**); if they are off the block says so instead of showing an empty list.

| Field        | Operators                              | Values                                              |
| ------------ | -------------------------------------- | --------------------------------------------------- |
| `state`      | `=`, `!=`                              | `todo`, `doing`, `done`, `cancelled`                |
| `due`        | `before`, `after`, `=`, `empty`        | a date (see below)                                  |
| `scheduled`  | `before`, `after`, `=`, `empty`        | a date                                              |
| `start`      | `before`, `after`, `=`, `empty`        | a date                                              |
| `created`    | `before`, `after`, `=`, `empty`        | a date                                              |
| `done`       | `before`, `after`, `=`, `empty`        | a date                                              |
| `priority`   | `=`, `!=`, `>`, `<`                    | a signed weight — see the warning below             |
| `text`       | `contains`                             | the task's text, case-insensitive                    |
| `tags`       | `contains`, `not_contains`             | a tag on the task line, without the `#`             |
| `links`      | `contains`                             | a `[[wikilink]]` target on the task line            |
| `path`       | `starts`, `contains`, `regex`          | the file the task lives in                          |
| `recurrence` | `empty`, `contains`                    | the `🔁` repeat rule                                 |

Sortable fields: `due`, `scheduled`, `start`, `created`, `priority`, `text`, `path`. Tasks with no value for the sort field always sort **last**, in either direction — so `sort: due asc` does not open with a block of undated rows.

**Dates accept the same shorthand as the editor**, resolved when the query runs:

| You write            | Means                          |
| -------------------- | ------------------------------ |
| `2026-09-30`         | that date                      |
| `t` / `today`        | today                          |
| `m` / `tomorrow`     | tomorrow                       |
| `y` / `yesterday`    | yesterday                      |
| `+7d` or `+7`        | 7 days from today              |
| `-3d` or `-3`        | 3 days ago                     |
| `9/30`               | Sep 30 this year, or next year if it has already passed |

So `due before "+7d"` means "due within the next week" and keeps meaning that tomorrow.

> **`priority` is a signed weight, not a P-number.** The values are `🔺 = 2`, `⏫ = 1`, none `= 0`, `🔽 = -1`, `⏬ = -2`. Write `priority > "0"` for "high or urgent", not `priority > "3"`. The `prio:1`…`prio:5` you type in the editor is a *rank* (P1 is the most urgent) and is converted to the emoji on the way in — the query side only ever sees the weight.

**Example — my open work, most urgent first**

```query
source: tasks
filter: state != "done" AND state != "cancelled" AND due before "+7d"
sort: priority desc
limit: 25
```

**Example — everything this note is responsible for**

```query
source: tasks
filter: links contains "Project Apollo" AND state = "todo"
sort: due asc
```

**Example — repeating tasks that have gone quiet**

```query
source: tasks
filter: recurrence empty AND tags contains "routine"
```

### How task results are displayed

- **`display: list`** (default) — the same rows as the Tasks sidebar. The checkbox works: checking a task **writes to its file** and the query re-runs. This is what turns a Map of Content into a working project board. Clicking a row jumps to the task's line in its own file.
- **`display: table`** — State, Task, Due, Priority, File.
- **`display: card`** — the task's text, its file, and up to five of its tags.

### Troubleshooting

| What you see                                   | Why                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `No vault open`                                | Query blocks search a vault; open one first                               |
| `Tasks are turned off. Settings › Tasks.` | `source: tasks` with the Tasks feature disabled                      |
| `No results` when you expect some              | A field/operator pair that is not in the tables above matches nothing rather than erroring. Re-pick the field in the builder — it always offers a valid operator set. |
| Results look stale                             | The block only re-runs on the triggers listed above; press **Run query**  |
