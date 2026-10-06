---
title: "Folders Baram leaves out"
---

A vault can hold more than notes. A code repository opened as a vault carries build output — `target`, `build`, `dist` — that can run to hundreds of thousands of files. Baram does not walk into those folders when it looks for notes, so they cost no memory in the link index and no time in search.

## The default list

Baram leaves out folders with these names, at any depth below the vault root:

| Folder | Usually holds |
| -- | -- |
| `node_modules` | JavaScript packages |
| `target` | Rust build output |
| `build` | build output of many tools |
| `dist` | packaged build output |
| `__pycache__` | Python bytecode |
| `.next` | Next.js build output |
| `.git` | Git's own data |

Folders whose names start with `.` are left out as well, and so are such files everywhere except search across all files. That rule is separate from the list and cannot be turned off.

Only folders **below** the vault root are judged. A vault whose own folder is named `build` opens and indexes like any other; a `build` folder inside it is left out.

## What a left-out folder is missing from

A note inside a left-out folder can still be opened with **File > Open File** (`Cmd+O` / `Ctrl+O`), edited and saved. It is missing from:

- [search across all files](/en/docs/faq/editing/#how-do-i-search-across-all-files)
- links, [backlinks](/en/docs/linking/dates-references-and-navigation/#backlinks) and the [graph](/en/docs/linking/dates-references-and-navigation/#graph-view). A link to a note in a left-out folder does not resolve
- [renaming](/en/docs/linking/wikilinks-and-tags/#auto-rename): a link written inside a left-out note is not rewritten when its target is renamed
- [tags](/en/docs/linking/wikilinks-and-tags/#tags), including renaming a tag
- the [Tasks panel](/en/docs/tasks/panel-and-queries/#the-tasks-panel)
- the [command line](/en/docs/command-line/): `files`, `search`, `tags`, `tasks`, `backlinks` and `links`

Saving a note in a left-out folder does not bring it back into any of these.

## Changing the list for one vault: `.baramignore`

Put a file named `.baramignore` in the vault root to change what is left out in that vault. It uses the same syntax as `.gitignore`:

```text
# Notes in build folders are mine: bring them back
!build/

# Leave out drafts and exported logs
drafts/
*.log
```

- A line names a folder (with a trailing `/`) or a file pattern. A pattern without `/` in the middle matches at any depth; one that starts with `/` matches only directly under the vault root.
- A line that starts with `!` brings back something an earlier line left out, including a folder from the default list. The defaults count as earlier lines, so `!build/` works.
- A file inside a left-out folder cannot be brought back by itself: Baram never looks inside that folder, so `!drafts/keep.md` under `drafts/` has no effect. Bring the folder back instead.
- Lines starting with `#` are comments.

Baram reads only the `.baramignore` in the vault root. One in a subfolder, or in a folder above the vault, is not read.

### Your `.gitignore` is not used

Baram does not read `.gitignore`, `.ignore` or Git's global excludes. Notes you keep out of Git — a private journal, for example — still appear in search and links.

### When a change takes effect

Search, tags and the command line read the file each time they run. The link index — links, backlinks, the graph and renaming — reads it when it is built, when the vault is opened. After editing `.baramignore`, close and reopen the vault to see the change everywhere.

## Where `.baramignore` does not reach

- The **file tree** in the sidebar hides the folders of the default list only. A folder you bring back with `!build/` still does not appear in the tree, and a folder you leave out with `.baramignore` still does.
- **Version history** snapshots skip the default list only. Leaving a folder out of search does not drop it from history.
