---
title: "MCP server"
---

`baram mcp` serves the [command line](/en/docs/command-line/)'s commands to an AI client — Claude Code, Claude Desktop, or another client that speaks the Model Context Protocol (MCP). The client starts the server and calls its tools to search and read your notes. The tools only **read**: none of them changes a file in your vault or the app's settings.

## Adding it to a client

The server is the app's own executable, run with `mcp`. On macOS that is `/Applications/Baram.app/Contents/MacOS/baram`; with the Linux `.deb` package it is `baram`, on your `PATH`. On Windows it has not been verified yet.

Name the vaults the client may read with `--vault` — see [which vaults it reads](#which-vaults-it-reads).

**Claude Code** — add it once, for every project:

```sh
claude mcp add --scope user baram -- /Applications/Baram.app/Contents/MacOS/baram mcp --vault ~/Notes
```

With `--scope project` instead, it is written to the project's `.mcp.json`, to share with everyone who works on the project. Your shell has already turned `~/Notes` into a path in your own home folder by then. Quote it — `'~/Notes'` — and the `~` is kept: the server expands it to the home folder of whoever runs it. Or give a path that exists for each of them.

**Claude Desktop** — add it to `claude_desktop_config.json` (on macOS, in `~/Library/Application Support/Claude/`), then restart the app:

```json
{
  "mcpServers": {
    "baram": {
      "command": "/Applications/Baram.app/Contents/MacOS/baram",
      "args": ["mcp", "--vault", "/Users/you/Notes"]
    }
  }
}
```

## Which vaults it reads

- **Without `--vault`, every vault and folder registered in the app is open to the client.** The default is then the registered vault or folder that contains the project directory Claude Code gives the server, or else the one that contains the directory the server was started in. A vault inside the project folder does not contain the project directory, so it is not picked from it: pass `--vault` to read it by default.
- **With `--vault`**, the tools read only the vaults you name. Give it once for each vault; the first is the default. A value is a path when it is absolute, is `~` alone, or starts with `~/` (on Windows, `~\` too), and that folder does not have to be registered in the app. A folder inside a registered vault is read as a vault of its own: as on the [command line](/en/docs/command-line/#what-differs-from-the-app), a link written outside it is not counted. Any other value — `.notes` and `~notes` included — is the name or alias of a registered vault or folder.
- Each tool takes a `vault` argument to pick one of these by name, by alias, or by a path of the same forms. A path is compared by its letters, not looked up on disk: it must spell the folder's own path, the path the app registered it under, or the path a `--vault` gave for it. A symbolic link to the folder is not the vault, and neither is the folder written in another case — except, on Windows, for the case of the letters A to Z. A vault outside them cannot be picked, and a path that does not exist gets the same answer as a path outside them.
- The vaults are read again on each call: a vault you register, rename or remove in the app shows on the next call. With `--vault`, the folders stay the ones you named, but what the app calls them is read again: a name or alias changed in the app shows on the next call, and a folder the app no longer registers is listed as `unregistered`.

When a `--vault` does not resolve — for example a path with no folder, or a name that no vault has or that two vaults share — the server stops before the client connects and writes the reason to its standard error. Claude Desktop keeps that in a log for each server — on macOS, `~/Library/Logs/Claude/mcp-server-baram.log`.

## Tools

| Tool             | What it returns                                         | Command     |
| ---------------- | ------------------------------------------------------- | ----------- |
| `list_vaults`    | The vaults the server reads, and the one a call reads   | `vaults`    |
| `list_files`     | The notes in the vault or in one folder                 | `files`     |
| `read_note`      | The text of one note                                    | `read`      |
| `search`         | The lines that match a text or a regular expression     | `search`    |
| `list_tags`      | The tags, with how often each occurs                    | `tags`      |
| `notes_with_tag` | The notes that carry a tag                              | `tag`       |
| `list_tasks`     | The tasks, by status or in one note                     | `tasks`     |
| `backlinks`      | The links that point at a note                          | `backlinks` |
| `outgoing_links` | The links a note holds, and where each one leads        | `links`     |

Each tool's description and arguments are written for the model, and the client passes them on. The rows a tool returns are the rows of the command's `--json` output; `list_vaults` also lists a `--vault` the app does not register, as type `unregistered`.

## Pages

The tools that return a list, all but `list_vaults`, return one page at a time: `items`, `truncated` when more follow, and `nextOffset` — the `offset` that asks for the next page. Each of them has its own default and largest `limit`, given in its arguments.

`read_note` pages a note by lines the same way. `offset` is the number of lines to skip, so to read from a `search` match on line 12, pass `offset: 11`. A page of a long note can also end early, at the end of a line.

A vault can change between two calls, so a later page can shift.

## What differs from the command line

- **`read_note` reads notes only** — the `.md` and `.markdown` files `list_files` lists, the ones the app's walk finds for tags, tasks and links. Hidden files, files in hidden folders or in `node_modules`, and all other files are refused. The command line's `read` reads any text file in the vault, hidden ones included.
- **`search` also reads hidden `.md` files inside ordinary folders**, such as `notes/.draft.md`, as the command does. `read_note` cannot open them.
- **`backlinks` takes a note that does not exist yet**, as the command does, and refuses a path that is a folder. Inside a vault the server reads, the tools do not hide whether a path is there: an error can differ for a file or folder that exists and one that does not. For example, `backlinks` answers for a missing note but refuses a folder, and `list_files` gives a `folder` that is a file a different error from one that is not there. An absolute path argument must start with one of the paths a `vault` argument takes for the vault that call reads, and a relative one that ends outside the vault once its `..` are applied is outside, wherever a link there would lead; after that, a path that resolves through a symbolic link inside the vault to another place in it is accepted, so it shows that the link is there. An error never shows a file's content.
- **A `vault` that starts with `.` is a name**, not a path: `.notes` is the vault the app lists under that name. Relative paths are not accepted — not every client says which directory it starts the server in.
- **Errors are the command line's.** A tool that fails returns `error[CODE]: message` with the [same codes](/en/docs/command-line/#errors-and-exit-codes). Calling a tool the server does not have is a protocol error instead, and a line that is not JSON gets no answer.
