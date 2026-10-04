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

Only the form you used is tried: a name that matches nothing is not looked for as a folder, and a `--vault` that fails does not fall back to the current directory. When the form finds nothing, the command stops with `VAULT_NOT_FOUND`; when a name fits more than one registered vault or folder, with `VAULT_AMBIGUOUS`. For a name or for the current directory, the error lists the vaults and folders it could have meant; for a `--vault` path that is not a folder, it lists none. Nothing falls back to the vault that was last open in the app: run from somewhere else, that would quietly read the wrong notes.

`baram vaults` shows what is registered, and it does not stop on these errors: when no vault resolves, it still lists every registered vault and folder, with none of them marked.

When the current directory is inside more than one registered vault or folder, a vault wins over a folder, and of two vaults the outer one wins. Pass `--vault` to read the inner one.

## Commands

| Command | What it prints |
| --- | --- |
| `vaults` | The vaults and folders registered in the app. `*` marks the one this run would read (`current` in JSON). |
| `files [--folder <path>]` | The markdown files in the vault — `.md` and `.markdown`. |
| `read <path>` | One file, exactly as it is on disk. A file that is not UTF-8 text is an `IO` error. |
| `search <query> [--regex] [--case-sensitive] [--word] [--folder <path>] [--limit N]` | One item per match in `.md` files — a line with two matches appears twice. Stops after 100 matches unless `--limit` says otherwise. |
| `tags` | Each tag and how many times it occurs. |
| `tag <name>` | The files that carry a tag. A leading `#` is optional. |
| `tasks [--status open\|done\|cancelled\|all] [--file <path>]` | Tasks. `open`, the default, is `todo` and `doing`. |
| `backlinks <path>` | The links that point at a note. |
| `links <path>` | The links a note holds, and where each one leads: `resolved` with its `path`, `unresolved`, or `otherVault` with the vault's alias. |

`--vault` and `--json` work with every command, before or after its name.

## Paths and line numbers

A note or folder path you pass — to `read`, `backlinks`, `links`, `--folder` or `--file` — is relative to the **vault root**, not to the current directory, and uses `/`. The paths in results are written the same way, so one command's output can be the next one's argument. An absolute path is accepted when it is inside the vault; one that leads outside — through `../`, as an absolute path elsewhere or by a symbolic link that points out — is refused with `PATH_OUTSIDE_VAULT`. A vault's own path is absolute: `vault.path` in JSON and the paths `vaults` lists.

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

Without `--json`, the same error is `error[FILE_NOT_FOUND]: no file at notes/a.md`, followed by one indented line per candidate: its name, a tab and its path. Branch on `code`, not on the wording of `message`:

| Code | When | Exit code |
| --- | --- | --- |
| `VAULT_NOT_FOUND` | Nothing answers to `--vault`, or the current directory is in no registered vault or folder. | `1` |
| `VAULT_AMBIGUOUS` | More than one registered vault or folder answers to the name. | `1` |
| `PATH_OUTSIDE_VAULT` | The path leads out of the vault. | `1` |
| `FILE_NOT_FOUND` | Nothing is at the path, or a folder is where a file is wanted. | `1` |
| `INVALID_ARGUMENT` | The command does not take the value — for example an empty query or tag name, a bad regular expression, or a folder or note it refuses (see above). | `2` |
| `IO` | Something that is there could not be read — for example a file or folder you have no permission for, a file that is not UTF-8, or the current directory. | `1` |

A command that walks the vault stops with `IO` at a folder it cannot read, and the message names that folder. `search` skips such a folder instead. Messages are in English, except what they quote: the paths and names they repeat, and the operating system's own description of a failure in an `IO` message — on Windows, that description follows the system's language.

Not everything on standard error is that error. A command line the argument parser cannot read — an unknown command or flag, a missing argument, a value out of range — is rejected before `--json` is read, so that message is plain text starting with `error:` (exit code `2`). And a warning — for example, app settings that could not be read — comes before anything else and does not change the exit code. It is a line of its own: `warning: …`, or `{"warning":{"message":"…"}}` with `--json`. With `BARAM_LOG` set in the environment, diagnostic lines such as `[DEBUG] cli: 5 registered roots` go there too.

## What differs from the app

- **Unsaved edits are not seen.** The commands read the files on disk.
- **`backlinks` goes by note name**, as the backlinks panel does. `[[plan]]` counts for a note named `plan` in any folder, and so does a link into another vault, such as `[[journal::plan]]`. A link written with a path, such as `[[notes/plan]]` or `[[./plan]]`, does not count. The links to the note on one line are reported once. You can ask about a note that does not exist yet, but not about a folder. Ask about notes only: for another file, such as `papers/Paper.pdf`, it goes by the name without the extension, so it misses `[[Paper.pdf]]`, a link that `links` does resolve to that file.
- **`links` resolves the way the graph view does**, not the way a click does. A path in a link is followed only from the vault root: `[[./plan]]`, or a path that leads nowhere, is looked up by its last name, wherever a note of that name is. A journal date gets no special treatment. A link into another vault is reported as `otherVault` with the alias, where the graph view draws it to a local note of the same name, or to a placeholder node when there is none. `links` reads the index of the vault this run chose; when a registered folder sits inside a vault, the app's graph for that folder uses the folder's own index, so a note name that exists twice can resolve differently.
- **`tasks` reads one vault.** The task panel can show several, depending on its scope setting. The folders you excluded from tasks in the app's settings are excluded here too: `tasks --file` on a note inside one prints no tasks, not an error.
- **`search` reads `.md` files only.** The other commands also read `.markdown`. And `search` reads a hidden file inside an ordinary folder, such as `notes/.draft.md`, which `files` does not list.
- **`backlinks` and `links` index the vault's links on every call** — a little under half a second for 10,000 notes, measured on an Apple M5 Pro.

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
