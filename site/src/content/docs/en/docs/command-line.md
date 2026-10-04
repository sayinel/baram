---
title: "Command line"
---

`baram` — the same program that opens the editor — also answers questions about a vault from a terminal. It is meant for scripts and AI agents: they can search notes, list tasks and follow links without the app being open.

Every command **reads**. None of them changes a file in your vault.

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

Use a function or an alias rather than a symbolic link. If the app is ever started through a link, it cannot relaunch itself after an update.

Run with no arguments, `baram` opens the app as usual. `baram --help` lists the commands.

## Choosing a vault

A command reads one vault. It finds it in this order:

1. `--vault <path>` — a folder. The value is read as a path when it contains `/` or starts with `.` or `~`. The folder does not have to be registered in the app.
2. `--vault <name>` — the name or alias the app shows for a vault. Upper and lower case do not matter.
3. With no `--vault`, the registered vault that contains the current directory.

If none of these gives a vault, the command stops with `VAULT_NOT_FOUND` — or `VAULT_AMBIGUOUS` when two registered vaults answer to the name — and lists the vaults it could have meant. It never falls back to the vault that was last open in the app: run from somewhere else, that would quietly read the wrong notes. `baram vaults` shows what is registered.

When registered folders are nested, a vault wins over a plain folder, and of two vaults the outer one wins. Pass `--vault` to read the inner one.

## Commands

| Command | What it prints |
| --- | --- |
| `vaults` | The vaults and folders registered in the app. `*` marks the one this run would read. |
| `files [--folder <path>]` | The markdown files in the vault. |
| `read <path>` | One file, exactly as it is on disk. |
| `search <query> [--regex] [--case-sensitive] [--word] [--folder <path>] [--limit N]` | One item per match in `.md` files — a line with two matches appears twice. Stops after 100 matches unless `--limit` says otherwise. |
| `tags` | Each tag and how many times it occurs. |
| `tag <name>` | The files that carry a tag. A leading `#` is optional. |
| `tasks [--status open\|done\|cancelled\|all] [--file <path>]` | Tasks. `open` — the default — is to-do and in-progress. |
| `backlinks <path>` | The links that point at a note. |
| `links <path>` | The links a note holds, and where each one leads. |

`--vault` and `--json` work with every command.

## Paths and line numbers

A path you pass is relative to the **vault root**, not to the current directory, and uses `/`. The paths a command prints are written the same way, so one command's output can be the next one's argument. An absolute path is accepted when it is inside the vault; anything outside is refused with `PATH_OUTSIDE_VAULT`.

`--folder` does not accept a hidden folder or `node_modules`, `.git`, `.obsidian` or `.baram`. The app skips those when it reads a vault, and the commands report what the app sees.

Line numbers start at 1.

## Output

Without `--json`, each item is one line and its fields are separated by tabs. A tab, a newline, a carriage return or a backslash inside a field is written as `\t`, `\n`, `\r` or `\\`. `read` is the exception: it prints the file itself.

With `--json`, every command prints one object:

```json
{
  "vault": { "name": "Notes", "path": "/Users/me/Notes" },
  "truncated": false,
  "items": [{ "path": "docs/guide.md", "line": 12, "snippet": "…" }]
}
```

`truncated` is `true` when `search` stopped at its limit. A field with no value is `null` rather than left out. `vault` is `null` only for `vaults` run outside any vault.

## Errors and exit codes

| Exit code | Meaning |
| --- | --- |
| `0` | It worked. An empty result is still `0`. |
| `1` | The command could not finish. |
| `2` | The command was not written correctly. |

Results go to standard output; errors and warnings go to standard error. With `--json`, an error a command reports is an object too:

```json
{ "error": { "code": "FILE_NOT_FOUND", "message": "no file at notes/a.md", "candidates": [] } }
```

Branch on `code`, not on the wording of `message`: `VAULT_NOT_FOUND`, `VAULT_AMBIGUOUS`, `PATH_OUTSIDE_VAULT`, `FILE_NOT_FOUND`, `INVALID_ARGUMENT`, `IO`.

Two things on standard error are not that object. A command line the argument parser cannot read — an unknown command or flag, a missing argument, a value out of range — is rejected before `--json` is read, so that message is plain text (exit code `2`). And a warning — for example, app settings that could not be read — is its own line, `{"warning":{"message":"…"}}`, ahead of anything else.

## What differs from the app

- **Unsaved edits are not seen.** The commands read the files on disk.
- **`backlinks` goes by note name.** A link written with a folder, such as `[[notes/plan]]`, is not counted, and two links to the same note on one line are reported once — the same as the backlinks panel.
- **`links` resolves the way the graph does**, not the way a click does: a relative link like `[[./plan]]` and a journal date are not followed. A link into another vault is reported with that vault's alias and not resolved. It reads the index of the vault this run chose; when a registered folder sits inside a vault, the app's graph for that folder uses the folder's own index, so a note name that exists twice can resolve differently.
- **`tasks` reads one vault.** The task panel can show several, depending on its scope setting. The folders you excluded from tasks in the app's settings are excluded here too.
- **`search` reads `.md` files only.** The other commands also read `.markdown`.
- **`backlinks` and `links` index the vault's links on every call** — about half a second for 10,000 notes on a recent Mac.

## For AI agents

Tell the agent where the command is and that it is read-only. For example, in a project's `CLAUDE.md`:

```markdown
My notes are a Baram vault at ~/Notes. Query it with the `baram` CLI (read-only):

- `baram --vault ~/Notes --json search "<text>"` — find notes
- `baram --vault ~/Notes read <path>` — read one
- `baram --vault ~/Notes --json backlinks <path>` — what links to it
- `baram --vault ~/Notes --json tasks` — open tasks

Paths are relative to the vault root. Exit code 0 with no items means "nothing found".
```
