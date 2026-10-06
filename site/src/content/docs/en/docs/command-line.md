---
title: "Command line"
---

`baram` — the same program that opens the editor — also answers questions about a vault from a terminal. It is meant for scripts and AI agents: they can search notes, list tasks and follow links without the app being open.

Every command **reads**. None of them changes a file in your vault or the app's settings.

## Running it

The command is the app's own executable. There is nothing extra to install.

| Platform        | How to run it                                                             |
| --------------- | ------------------------------------------------------------------------- |
| macOS           | `/Applications/Baram.app/Contents/MacOS/baram`                            |
| Linux (`.deb`)  | `baram` — the package puts it on your `PATH`                              |
| Windows         | Not verified yet. The commands are built in, but nobody has confirmed that their output reaches a terminal. |

On macOS, a shell function saves typing the full path. Add it to `~/.zshrc`:

```sh
baram() { /Applications/Baram.app/Contents/MacOS/baram "$@"; }
```

A function or an alias exists only in shells that read `~/.zshrc`. For scripts, call the full path, or put a small script named `baram` on your `PATH`:

```sh
#!/bin/sh
exec /Applications/Baram.app/Contents/MacOS/baram "$@"
```

Use one of these rather than a symbolic link. If the app is ever started through a link, it cannot relaunch itself after an update.

With no arguments, or when its first argument is an absolute path or a URL, `baram` opens the app as usual. `baram --help` lists the commands.

## Choosing a vault

A command reads one vault. `--vault` names it in one of two forms; without the flag, the current directory decides:

1. `--vault <path>` — a folder. The value is read as a path when it contains `/` (or `\` on Windows) or starts with `.` or `~`. A relative path starts from the current directory. The folder does not have to be registered in the app.
2. `--vault <name>` — any other value is a name: the name or alias the app shows for a registered vault or folder. Upper and lower case do not matter.
3. No `--vault` — the registered vault that contains the current directory or, when no vault does, the registered folder that does.

Only the form you used is tried: a name that matches nothing is not looked for as a folder, and a `--vault` that fails does not fall back to the current directory. When the form finds nothing, the command stops with `VAULT_NOT_FOUND`. When a name fits more than one registered vault or folder, it stops with `VAULT_AMBIGUOUS` — but only entries whose folder exists are counted, and entries that point at the same folder count as one. For a name or for the current directory, the error lists the vaults and folders it could have meant; for a `--vault` path that is not a folder, it lists none. Nothing falls back to the vault that was last open in the app: run from somewhere else, that would quietly read the wrong notes.

`baram vaults` shows what is registered, and it does not stop on these errors: when no vault resolves, it still lists every registered vault and folder, with none of them marked.

When the current directory is inside more than one registered vault or folder, a vault wins over a folder, and of two vaults the outer one wins. Pass `--vault` to read the inner one.

## Commands

| Command | What it prints |
| --- | --- |
| `vaults` | The vaults and folders registered in the app. `*` marks the row of the vault this run would read (`current` in JSON); when a vault and a folder are registered for that same folder, both rows are marked. |
| `files [--folder <path>]` | The markdown files in the vault — `.md` and `.markdown`. |
| `read <path>` | One file, exactly as it is on disk. A file that is not UTF-8 text is an `IO` error. |
| `search <query> [--regex] [--case-sensitive] [--word] [--folder <path>] [--limit N]` | One item per match in `.md` files — a line with two matches appears twice. Upper and lower case match each other unless you pass `--case-sensitive`. Stops after 100 matches unless `--limit` says otherwise. |
| `tags` | Each tag and how many times it occurs. |
| `tag <name>` | The files that carry a tag. A leading `#` is optional. |
| `tasks [--status open\|done\|cancelled\|all] [--file <path>]` | Tasks. `open`, the default, is `todo` and `doing`. |
| `backlinks <path>` | The links that point at a note. |
| `links <path>` | The links a note holds, and where each one leads: `resolved` with its `path`, `unresolved`, or `otherVault` with the vault's alias. |

`--vault` and `--json` work with every command, before or after its name.

## Paths and line numbers

A note or folder path you pass — to `read`, `backlinks`, `links`, `--folder` or `--file` — is relative to the **vault root**, not to the current directory, and uses `/`. The paths in results are written the same way, so one command's output can be the next one's argument. They keep the spelling the file system stores: a name with Korean or accented letters may be stored decomposed (Unicode NFD), as some tools on macOS write it, and then differs byte for byte from the same name typed. An absolute path is accepted when it is inside the vault; one that leads outside — through `../`, as an absolute path elsewhere or by a symbolic link that points out — is refused with `PATH_OUTSIDE_VAULT`. A `..` is applied to the path as written, before any symbolic link in it is followed: `read out-link/../tabs.md` reads the vault's own `tabs.md`, where a shell would follow `out-link` first. A vault's own path is absolute: `vault.path` in JSON and the paths `vaults` lists.

`--folder` does not accept a file, a hidden folder or `node_modules`, `.git`, `.obsidian` or `.baram`. The app skips those folders when it walks a vault, and the commands report what the app sees. For the same reason, `tasks --file` and `links` take only a note the walk reaches — a `.md` or `.markdown` file, not hidden itself and not inside those folders. Another file is refused with `INVALID_ARGUMENT`.

Line numbers start at 1.

## Output

Without `--json`, each item is one line and its fields are separated by tabs. A tab, a newline, a carriage return or a backslash inside a field is written as `\t`, `\n`, `\r` or `\\`. A line carries an item's main fields; `--json` carries all of them, such as a task's dates and a link's block id. `read` is the exception: it prints the file itself.

With `--json`, every command prints one JSON object on one line. Spread out, it looks like this:

```json
{
  "vault": { "name": "Notes", "path": "/Users/me/Notes" },
  "truncated": false,
  "items": [{ "path": "docs/guide.md", "line": 12, "snippet": "…" }]
}
```

`truncated` is `true` when `search` found more matches than its limit and left the rest out. A field with no value is `null` rather than left out. `vault` is `null` only for `vaults`, when no vault resolves.

Items come in a fixed order: `vaults` by name, `tags` by count (highest first) and then by name, `links` by line, and the other commands by path and then line. Within one line, `links` lists wikilinks first, then block embeds, then block references, whatever order they are written in.

## Errors and exit codes

| Exit code | Meaning |
| --- | --- |
| `0` | It worked. An empty result is still `0`, and so is a run whose reader stopped early, as in `baram read big.md \| head`. |
| `1` | The command could not finish — every error code below except `INVALID_ARGUMENT`. |
| `2` | The command was not written correctly — `INVALID_ARGUMENT`, or a command line the argument parser cannot read. |

Results go to standard output; errors and warnings go to standard error. With `--json`, an error a command reports is one line too:

```json
{"error":{"candidates":[],"code":"FILE_NOT_FOUND","message":"no file at notes/a.md"}}
```

Without `--json`, the same error is `error[FILE_NOT_FOUND]: no file at notes/a.md` — always one line, because the message is escaped the way a field is — followed by one indented line per candidate: its name, a tab and its path. Branch on `code`, not on the wording of `message`:

| Code | When | Exit code |
| --- | --- | --- |
| `VAULT_NOT_FOUND` | Nothing answers to `--vault`, or the current directory is in no registered vault or folder. | `1` |
| `VAULT_AMBIGUOUS` | More than one registered vault or folder answers to the name — counting only those whose folder exists, and entries for the same folder once. | `1` |
| `PATH_OUTSIDE_VAULT` | The path leads out of the vault. | `1` |
| `FILE_NOT_FOUND` | Nothing is at the path, or a folder is where a file is wanted. | `1` |
| `INVALID_ARGUMENT` | The command does not take the value — for example an empty query or tag name, a bad regular expression, or a folder or note it refuses (see above). A regular expression that is only too large, such as `k{50000}`, can get past this check and end as `IO` `cannot search …` with exit code `1`. | `2` |
| `IO` | Something that is there could not be read — for example a file or folder you have no permission for, a file that is not UTF-8, or the current directory. | `1` |

A command that walks the vault stops with `IO` at a folder it cannot read, and the message names that folder. `search` skips such a folder instead. Messages are in English, except what they quote: the paths and names they repeat, and the operating system's own description of a failure in an `IO` message — on Windows, that description is expected to follow the system's language (not yet checked on Windows).

Not everything on standard error is that error. A command line the argument parser cannot read — an unknown command or flag, a missing argument, a value out of range — is rejected before `--json` is read, so that message is plain text starting with `error:` (exit code `2`). And a warning — for example, app settings that could not be read — comes before anything else and does not change the exit code. It is a line of its own: `warning: …`, or `{"warning":{"message":"…"}}` with `--json`. With `BARAM_LOG` set in the environment, diagnostic lines such as `[DEBUG] cli: 5 registered roots` go there too.

## What differs from the app

- **Unsaved edits are not seen.** The commands read the files on disk.
- **`backlinks` counts links the way the backlinks panel does.** A link can name the note by its name — `[[plan]]` counts for a note named `plan` in any folder — by its path — `[[notes/plan]]`, `((notes/plan#^id))`, or `[[./plan]]` written in the note's own folder — or, for a Zettel note stored as `{id} {title}.md`, by `[[id]]`. It can also start with the name of a registered vault or folder that holds the note: its alias, and `Journal` or `Zettel` for the journal or Zettel space — so in the journal space, `[[journal::plan]]` counts. An alias counts only when no other registered vault, folder or file has it. A space name counts only when no registered vault, folder or file has it as its alias and no other space of the same kind is registered: an alias wins over a space name, so in a vault whose alias is `journal`, `[[journal::plan]]` counts even with a journal space registered. Vaults, folders and files you have not approved are left out, as the app leaves them out. A link that starts with the name of a vault that does not hold the note does not count. The links to the note on one line are reported once. You can ask about a note that does not exist yet, but not about a folder. When registered vaults or folders are nested, the panel asks the index of each one that holds the note and merges the answers, so it can list more than this command, which reads only the vault this run chose. Ask about notes only: for another file, such as `papers/Paper.pdf`, `[[papers/Paper.pdf]]` counts, but a bare name is looked up without the extension, so `[[Paper]]` counts and `[[Paper.pdf]]` does not — the other way round from `links`.
- **`links` resolves the way the graph view does**, not the way a click does. A path in a link is followed only from the vault root: `[[./plan]]`, or a path that leads nowhere, is looked up by its last name, wherever a note of that name is. So the two commands can disagree on a relative link: `[[./plan]]` written in `b/` is a backlink of `b/plan.md`, while `links` may resolve it to `a/plan.md`, and one that leads where no note is counts only for a note not yet written at that path. A journal date gets no special treatment. A link into another vault is reported as `otherVault` with the alias, where the graph view draws it to a local note of the same name, or to a placeholder node when there is none. So is a link that starts with the vault's own name — `[[journal::plan]]` in the journal space — which `backlinks` counts. `links` reads the index of the vault this run chose; when a registered folder sits inside a vault, the app's graph for that folder uses the folder's own index, so a note name that exists twice can resolve differently.
- **Names match whether they are stored composed (NFC) or decomposed (NFD).** For `backlinks` and `links`, `[[회의록]]` typed in a note names `회의록.md` even when the file system stores that name decomposed (NFD). The paths they print keep the stored spelling.
- **`tasks` reads one vault.** The task panel can show several, depending on its scope setting. The folders you excluded from tasks in the app's settings are excluded here too: `tasks --file` on a note inside one prints no tasks, not an error.
- **`search` reads `.md` files only.** The other commands also read `.markdown`. And `search` reads a hidden file inside an ordinary folder, such as `notes/.draft.md`, which `files` does not list.
- **`backlinks` and `links` index the vault's links on every call** — a little under half a second for 10,000 notes, measured on an Apple M5 Pro with a release build and a warm cache.

## For AI agents

Tell the agent where the command is and that it is read-only. For example, in a project's `CLAUDE.md` on a Mac:

```markdown
My notes are a Baram vault at ~/Notes. Query them with Baram's read-only CLI,
/Applications/Baram.app/Contents/MacOS/baram — call it by that full path
(it is shortened to `baram` below).

- `baram --vault ~/Notes --json search "<text>"` — find notes
- `baram --vault ~/Notes read <path>` — read one
- `baram --vault ~/Notes --json backlinks <path>` — what links to it
- `baram --vault ~/Notes --json tasks` — open tasks

Paths are relative to the vault root. Exit code 0 with no items means "nothing found";
1 or 2 is an error, reported on standard error.
```

On Linux with the `.deb` package, `baram` is already on the `PATH`, so the full path is not needed.
