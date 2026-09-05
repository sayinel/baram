# Keyboard Shortcuts Reference

Complete list of keyboard shortcuts available in Baram.

> **Platform Note:** On Windows and Linux, replace `Cmd` with `Ctrl` and `Option` with `Alt` unless otherwise noted.

---

## File

<!-- colwidths:160,130,153 -->

| Action          | macOS         | Windows / Linux |
| --------------- | ------------- | --------------- |
| New File        | `Cmd+N`       | `Ctrl+N`        |
| Open File       | `Cmd+O`       | `Ctrl+O`        |
| Open Folder     | `Cmd+Shift+O` | `Ctrl+Shift+O`  |
| Save            | `Cmd+S`       | `Ctrl+S`        |
| Save As         | `Cmd+Shift+S` | `Ctrl+Shift+S`  |
| Close Tab       | `Cmd+W`       | `Ctrl+W`        |
| Close Workspace | `Cmd+Shift+W` | `Ctrl+Shift+W`  |
| Export...       | `Cmd+Shift+E` | `Ctrl+Shift+E`  |
| Quick Switcher  | `Cmd+K`       | `Ctrl+K`        |
| Command Palette | `Cmd+P`       | `Ctrl+P`        |
| Settings        | `Cmd+,`       | `Ctrl+,`        |

## Editing

<!-- colwidths:113,165,173 -->

| Action      | macOS             | Windows / Linux    |
| ----------- | ----------------- | ------------------ |
| Undo        | `Cmd+Z`           | `Ctrl+Z`           |
| Redo        | `Cmd+Shift+Z`     | `Ctrl+Y`           |
| Cut         | `Cmd+X`           | `Ctrl+X`           |
| Copy        | `Cmd+C`           | `Ctrl+C`           |
| Paste       | `Cmd+V`           | `Ctrl+V`           |
| Select All  | `Cmd+A`           | `Ctrl+A`           |
| Find        | `Cmd+F`           | `Ctrl+F`           |
| Replace     | `Cmd+H`           | `Ctrl+H`           |
| Toggle Fold | `Cmd+Shift+[`     | `Ctrl+Shift+[`     |
| Fold All    | `Cmd+Shift+Alt+[` | `Ctrl+Shift+Alt+[` |
| Unfold All  | `Cmd+Shift+Alt+]` | `Ctrl+Shift+Alt+]` |

## Inline Formatting

<!-- colwidths:128,130,153 -->

| Action        | macOS         | Windows / Linux |
| ------------- | ------------- | --------------- |
| Bold          | `Cmd+B`       | `Ctrl+B`        |
| Italic        | `Cmd+I`       | `Ctrl+I`        |
| Underline     | `Cmd+U`       | `Ctrl+U`        |
| Strikethrough | `Cmd+Shift+X` | `Ctrl+Shift+X`  |
| Highlight     | `Cmd+Shift+H` | `Ctrl+Shift+H`  |
| Inline Code   | `Cmd+E`       | `Ctrl+E`        |

## Block Formatting

<!-- colwidths:208,130,153 -->

| Action                 | macOS         | Windows / Linux |
| ---------------------- | ------------- | --------------- |
| Heading 1              | `Cmd+1`       | `Ctrl+1`        |
| Heading 2              | `Cmd+2`       | `Ctrl+2`        |
| Heading 3              | `Cmd+3`       | `Ctrl+3`        |
| Heading 4              | `Cmd+4`       | `Ctrl+4`        |
| Heading 5              | `Cmd+5`       | `Ctrl+5`        |
| Heading 6              | `Cmd+6`       | `Ctrl+6`        |
| Code Block             | `Cmd+Alt+C`   | `Ctrl+Alt+C`    |
| Math Block             | `Cmd+Shift+M` | `Ctrl+Shift+M`  |
| Blockquote             | `Cmd+Shift+B` | `Ctrl+Shift+B`  |
| Bullet List            | `Cmd+Shift+8` | `Ctrl+Shift+8`  |
| Ordered List           | `Cmd+Shift+7` | `Ctrl+Shift+7`  |
| Task List              | `Cmd+Shift+9` | `Ctrl+Shift+9`  |
| Table                  | `Cmd+T`       | `Ctrl+T`        |
| Mermaid Diagram        | `Cmd+Shift+D` | `Ctrl+Shift+D`  |
| Toggle Open/Close      | `Cmd+Enter`   | `Ctrl+Enter`    |
| Indent                 | `Tab`         | `Tab`           |
| Outdent                | `Shift+Tab`   | `Shift+Tab`     |

## View

<!-- colwidths:182,130,153 -->

| Action              | macOS         | Windows / Linux |
| ------------------- | ------------- | --------------- |
| Reload              | `Cmd+R`       | `Ctrl+R`        |
| Source Mode Toggle  | `Cmd+/`       | `Ctrl+/`        |
| Toggle Left Sidebar | `Cmd+Shift+L` | `Ctrl+Shift+L`  |
| Zoom In             | `Cmd+=`       | `Ctrl+=`        |
| Zoom Out            | `Cmd+-`       | `Ctrl+-`        |
| Reset Zoom          | `Cmd+0`       | `Ctrl+0`        |

Zoom scales the editor content, not the whole window. Trackpad pinch works too, and the level is
shared with the built-in image/SVG viewer and the PDF reader.

Reload has no native OS-level shortcut on Windows/Linux — `Ctrl+R` is already vim mode's redo
there, and menu accelerators can't defer to it. Instead, `Ctrl+R` is a customizable app shortcut
(Settings > Keybindings > View > Reload) that steps aside automatically: it only reloads when vim
isn't actively handling the key (vim mode off, or outside a vim redo context), so a real vim redo
is never shadowed. On macOS, `Cmd+R` is the native menu accelerator and vim mode never sees it
(`Cmd` isn't vim's redo modifier there), so there's no such handoff to make.

## Navigation

<!-- colwidths:193,156,156 -->

| Action                | macOS            | Windows / Linux  |
| --------------------- | ---------------- | ---------------- |
| Quick Switcher        | `Cmd+K`          | `Ctrl+K`         |
| Navigate Back         | `Cmd+[`          | `Ctrl+[`         |
| Navigate Forward      | `Cmd+]`          | `Ctrl+]`         |
| Tab Switcher (MRU)    | `Ctrl+Tab`       | `Ctrl+Tab`       |
| Previous Tab (MRU)    | `Ctrl+Shift+Tab` | `Ctrl+Shift+Tab` |
| Bookmark Current File | `Cmd+D`          | `Ctrl+D`         |
| Backlink Panel        | `Cmd+Shift+B`    | `Ctrl+Shift+B`   |

## Tools

<!-- colwidths:243,130,153 -->

| Action                      | macOS         | Windows / Linux |
| --------------------------- | ------------- | --------------- |
| Command Palette             | `Cmd+P`       | `Ctrl+P`        |
| Command Palette (alternate) | `Cmd+Shift+P` | `Ctrl+Shift+P`  |
| Global Search               | `Cmd+Shift+F` | `Ctrl+Shift+F`  |
| Settings                    | `Cmd+,`       | `Ctrl+,`        |

## AI & Skills

<!-- colwidths:144,130,153 -->

| Action            | macOS         | Windows / Linux |
| ----------------- | ------------- | --------------- |
| Inline AI Prompt  | `Cmd+J`       | `Ctrl+J`        |
| AI Chat Panel     | `Cmd+Shift+A` | `Ctrl+Shift+A`  |
| Toggle Ghost Text | `Cmd+Shift+G` | `Ctrl+Shift+G`  |
| Skill Test        | `Cmd+Shift+T` | `Ctrl+Shift+T`  |

## Workspace

<!-- colwidths:188,139,153 -->

| Action             | macOS          | Windows / Linux |
| ------------------ | -------------- | --------------- |
| Workspace: Writing | `Cmd+Option+1` | `Ctrl+Alt+1`    |
| Workspace: Zettel  | `Cmd+Option+2` | `Ctrl+Alt+2`    |
| Workspace: Journal | `Cmd+Option+3` | `Ctrl+Alt+3`    |
| Workspace: Skills  | `Cmd+Option+4` | `Ctrl+Alt+4`    |

> All four workspace presets are customizable in **Settings > Keybindings**. Switching to a space never force-closes an open folder tree.

## Journal

> Journal shortcuts use dedicated `Cmd+Shift` letters chosen to avoid the editor and app shortcuts (Mermaid, Math Block, Export, Command Palette), so there are no conflicts.

| Action               | macOS         | Windows / Linux |
| -------------------- | ------------- | --------------- |
| Open Today's Journal | `Cmd+Shift+J` | `Ctrl+Shift+J`  |
| Toggle Memories View | `Cmd+Shift+R` | `Ctrl+Shift+R`  |
| Photo Gallery        | `Cmd+Shift+I` | `Ctrl+Shift+I`  |

## Zettel

> The Zettel space (atomic Zettelkasten notes) uses `Cmd+Shift` letters that are free in both the app keybindings and the native menu. Quick Capture lands in the Zettel `inbox/`.

| Action                    | macOS         | Windows / Linux |
| ------------------------- | ------------- | --------------- |
| Quick Capture (→ inbox)   | `Cmd+Shift+N` | `Ctrl+Shift+N`  |
| Save capture (in dialog)  | `Cmd+Enter`   | `Ctrl+Enter`    |
| New Zettel                | `Cmd+Shift+V` | `Ctrl+Shift+V`  |
| Promote to Permanent Note | `Cmd+Shift+U` | `Ctrl+Shift+U`  |
| New Note from Selection   | `Cmd+Shift+Y` | `Ctrl+Shift+Y`  |
| New MOC                   | `Cmd+Shift+C` | `Ctrl+Shift+C`  |

## Tasks

> The Tasks feature must be on (**Settings > General > Tasks**). `Cmd+Alt+T` does two jobs: in the editor it opens the task dialog — editing the task line the cursor is on, or creating a new one; in Quick Capture it switches that dialog into task mode.

| Action                    | macOS         | Windows / Linux |
| ------------------------- | ------------- | --------------- |
| Task input / edit task    | `Cmd+Alt+T`   | `Ctrl+Alt+T`    |
| Quick Capture             | `Cmd+Shift+N` | `Ctrl+Shift+N`  |
| Confirm a recognized date | `Tab`         | `Tab`           |

> A **global capture shortcut** that opens Quick Capture in task mode even when Baram is in the background can be assigned in **Settings > General > Tasks**. It has no default — a global shortcut is intercepted system-wide.

### Task rows

These work on a focused row in the **Tasks panel** and in the **Weekly review** — one table, so a key learned in one place means the same thing in the other.

| Keys                    | Action                              |
| ----------------------- | ----------------------------------- |
| `j` / `k` (or `↑` / `↓`) | Move between rows                  |
| `X`                     | Advance to the next state           |
| `T`                     | Due today                           |
| `S`                     | Defer to `#someday`                 |
| `D`                     | Open the triage menu                |
| `Delete` / `Backspace`  | Delete the line (asks first)        |

> The two destructive-adjacent bindings are deliberate: only `Delete`/`Backspace` removes a line, because a letter key is too easy to brush against. Korean keyboard layouts are handled by physical key position, so `X` works while the IME is active.

### In the editor

| Keys                   | Action                                                    |
| ---------------------- | --------------------------------------------------------- |
| `Space` (vim, normal)  | Toggle the task under the cursor                          |
| `Tab`                  | Confirm the underlined date Baram recognized in your text |

## Ghost Text (AI Autocomplete)

<!-- colwidths:199,113,153 -->

| Action                 | macOS       | Windows / Linux |
| ---------------------- | ----------- | --------------- |
| Accept Full Suggestion | `Tab`       | `Tab`           |
| Accept First Word      | `Cmd+Right` | `Ctrl+Right`    |
| Dismiss                | `Escape`    | `Escape`        |

## Table (inside tables)

<!-- colwidths:163,113,153 -->

| Action              | macOS       | Windows / Linux |
| ------------------- | ----------- | --------------- |
| Next Cell           | `Tab`       | `Tab`           |
| Previous Cell       | `Shift+Tab` | `Shift+Tab`     |
| Merge / Split Cells | `Cmd+M`     | `Ctrl+M`        |

## Math Editing (inside math blocks)

<!-- colwidths:174,130,153 -->

| Action             | macOS         | Windows / Linux |
| ------------------ | ------------- | --------------- |
| Confirm Block Math | `Shift+Enter` | `Shift+Enter`   |
| Cancel / Exit      | `Esc`         | `Esc`           |

## PDF Reader (inside a PDF tab)

<!-- colwidths:200,120,153 -->

| Action                     | macOS           | Windows / Linux  |
| -------------------------- | --------------- | ---------------- |
| Find in PDF                | `Cmd+F`         | `Ctrl+F`         |
| Next / Previous Match      | `Enter` / `Shift+Enter` | `Enter` / `Shift+Enter` |
| Close Find                 | `Esc`           | `Esc`            |
| Zoom In / Out              | `Cmd+=` / `Cmd+-` | `Ctrl+=` / `Ctrl+-` |
| Area Highlight (temporary) | `Alt+drag`      | `Alt+drag`       |
| Cancel Area Drag           | `Esc`           | `Esc`            |

`Cmd+F` in a PDF tab opens **Find in PDF** rather than the editor's find bar. Holding `Alt` while
dragging draws an area highlight without switching the toolbar into area mode. Page navigation,
the side panel, and the two highlight modes are toolbar buttons — see the
[User Guide](user-guide.md#pdf-reading--highlights).

## File Tree

<!-- colwidths:151,81,153 -->

| Action         | macOS   | Windows / Linux |
| -------------- | ------- | --------------- |
| Rename File    | `F2`    | `F2`            |
| Confirm Rename | `Enter` | `Enter`         |
| Cancel Rename  | `Esc`   | `Esc`           |

---

## Tips

- **Slash Commands**: Type `/` at the start of an empty line to open the block insertion menu
- **Wikilinks**: Type `[[` to start a wikilink with autocomplete
- **@Mentions**: Type `@` to mention a page or date — select from Quick Dates (Today/Yesterday/Tomorrow) or workspace pages
- **Footnotes**: Type `[^id]` to insert a footnote reference — the definition is auto-created at the end of the document
- **Markdown Shortcuts**: You can always type raw markdown syntax (e.g., `**bold**`, `# Heading`) — Baram converts it automatically
- **Floating Toolbar**: Select text to see a floating toolbar with formatting options
- **Tab Switcher**: Hold `Ctrl` while pressing `Tab` to cycle through recently used tabs; release `Ctrl` to select
- **Ghost Text**: AI autocomplete appears as faded text — press `Tab` to accept, `Cmd+Right` for just the first word, `Escape` to dismiss
- **Find & Replace**: Use `Cmd+F` to find text, `Cmd+H` to find and replace. Press `Enter`/`Shift+Enter` to navigate between matches
- **Folding**: Hover over a heading or nested list item to see a fold arrow. Click it or press `Cmd+Shift+[` to collapse/expand. Use `Cmd+Shift+Alt+[` / `]` to fold/unfold all
- **Date Mentions**: Type `@` and select Today/Yesterday/Tomorrow to insert a date mention chip linked to that day's journal entry
- **Tags**: Type `#tag` (autocompletes vault-wide); `Cmd/Ctrl+click` a tag to search every file that uses it
- **Quick Capture**: Press `Cmd+Shift+N` to jot an idea/link/quote/note, or use `/idea`, `/link`, `/quote`, `/note`

---

## Vim Mode

Enable **Settings > Editor > Vim Keybindings** (off by default). One switch turns vim on across **three editing surfaces**, and the status bar shows the current mode (`-- NORMAL --`, `-- INSERT --`, `-- VISUAL --`; `-- INSERT (math) --` while a block editor holds the keys).

| Surface | How you get there | What is available |
| ------- | ----------------- | ----------------- |
| **Source Mode** | `Cmd+/` / `Ctrl+/`, and code-file tabs (JSON, Python, …) | Full vim: modal editing, motions, operators, counts, text objects (`ciw`, `di"`), `.` repeat, search (`/`, `n`), marks, macros, registers |
| **WYSIWYG** | The normal rich-text editor | Modal editing on the rendered document — see the command list below |
| **Code blocks** | Click into (or move into) a code block in a WYSIWYG document | Full vim, as in Source Mode, plus boundary crossing back to the document |

### WYSIWYG commands

| Group | Keys |
| ----- | ---- |
| Modes | `i` `a` `I` `A` · `o` `O` · `v` (charwise) `V` (linewise) · `Esc` |
| Motions | `h` `j` `k` `l` and the arrow keys · `0` `$` `^` (Home/End) · `w` `b` · `gg` `G` (first / last line — use `:N` for a specific line) |
| Find in line | `f` `F` `t` `T` + a character · `;` `,` to repeat |
| Search | `/` forward · `?` backward · `n` `N` repeat — see [Search](#search-wysiwyg) |
| Operators | `d` `c` `y` with a motion (`dw`, `cw`, `dj`, `d$`, `dfx`, `dgg`) · doubled for whole lines (`dd` `yy` `cc`) |
| Counts | Any motion or operator (`3j`, `2d3w` = six words) |
| Edit | `x` · `p` `P` · `u` `Ctrl+r` · `Space` toggles the task item under the cursor |
| Visual | `d`/`x` delete · `y` yank · `v`/`V` switch charwise ↔ linewise · `Esc` |
| View | `zz` `z.` center the cursor line (also in visual mode) |
| Ex | `:w` save · `:q` close tab · `:N` / `:$` go to a line |

Structure-aware behavior: tables, math blocks, images and hard-break segments each count as one line for `j`/`k`; a code block counts as one line from the outside. Inside a table, `h`/`l` cross cell boundaries so every cell in a row is reachable, while `j`/`k` move down a row keeping the column; `dd` on a table row deletes the row (the header row and the only remaining data row are protected); `dd` inside a list keeps nested children. The cursor is kept on screen after every command.

Not in WYSIWYG yet — these work in Source Mode and code blocks today: text objects (`ciw`, `di"`), `.` repeat, `r`, `e`/`E`/`W`/`B`, `J`, `~`, `>>`/`<<`, `%`, `{`/`}`, `zt`/`zb`, the `Ctrl+D`/`Ctrl+U`/`Ctrl+F`/`Ctrl+B` scroll motions, marks, macros and named registers. Visual block (`Ctrl+V`) is intentionally not planned for the rich-text surface.

### Search (WYSIWYG)

`/` and `?` open a search line in the status bar; `Enter` jumps, `Esc` cancels, `n`/`N` repeat in the same/opposite direction, and an empty `Enter` reuses the last pattern.

- The pattern is a JavaScript regular expression matched line by line (`^`/`$` anchor to a line, `.` does not cross lines), case-insensitive unless it contains an uppercase letter (smartcase). The search wraps around the document.
- It searches only the open document and is independent of the app's `Cmd+F` find bar. It moves the cursor; matches are not highlighted.
- A match inside a code block lands the cursor in that block. Korean can be typed into the search line with the IME.

### Code block boundaries

| Keys | Action |
| ---- | ------ |
| `j` / `k` (or arrows) into a block | Enter the block on its first / last line, keeping the column |
| Arrow keys in insert mode | Enter the block and keep typing — insert mode carries over |
| `Esc` (in normal mode) | Leave the block and return to document-level vim |
| `j` / `k` (or arrows) on the last / first line | Leave the block downward / upward |
| `u` / `Ctrl+r` | Undo/redo the **document** history, so edits inside and outside the block share one stack |

Your mode follows the cursor across the boundary in both directions, whether you move by keyboard or click with the mouse: leave a block in insert and the document is in insert; press `Esc` inside a block and the document is in normal when you come out. Clicking between blocks or back into the document works in every mode. `:` and `/` open vim's own prompt inside the block; keys typed there stay in the prompt. Known limitation: `zz`/`z.` do nothing inside a code block (the block scrolls with the document, not by itself).

### Block editors (math, Mermaid, SVG, HTML, query)

These blocks are atoms in the document: `j`/`k` treat each as one line and `dd` deletes the whole block. With a block selected, `i` opens its editor (the status bar shows `-- INSERT (math) --` and so on), `Esc` returns to the block in normal mode with the block still selected, and a click in normal mode selects the block without opening it.

### Ex commands

Available on all three surfaces. The command line appears in the status bar as you type; `Enter` runs it, `Esc` abandons it, and `Backspace` on an empty line closes it.

| Command | Action |
| ------- | ------------------------ |
| `:w` / `:write` | Save the current file    |
| `:q` / `:quit`  | Close the current tab (unsaved-changes guard applies) |
| `:N` (e.g. `:42`) | Go to line N — lines are counted the way `j`/`k` count them, so a hard-break segment or a table row is one line and a code block is one line; out-of-range numbers land on the last line |
| `:$`            | Go to the last line |

Source Mode and code blocks also accept the CodeMirror adapter's own ex commands and `/` search; WYSIWYG recognises only the four above.

**Korean IME**: vim commands work with the Korean input source active on every surface — in normal/visual mode keys are resolved by physical position (pressing the `j` key moves down even when it would type `ㅓ`), and stray jamo insertion is blocked. Insert mode types Korean normally. In WYSIWYG, `f` followed by a consonant jamo jumps by 초성 (`f` `ㄱ` finds 강, 김, 그). This behavior is verified on macOS; Windows/Linux are not yet validated.

The vim register is shared app-wide (like the clipboard) and is not written to disk; a yank inside a code block cannot yet be pasted outside it, or vice versa. Vim key sequences are not remappable via Settings > Keybindings.

---

## Customization

All keyboard shortcuts can be remapped in **Settings > Keybindings**. Search for a shortcut by name or key, click **Edit**, then press the new key combination. Conflicts are detected automatically. Use the ↺ button to reset individual shortcuts, or **Reset All Keybindings** to restore defaults. Vim key sequences (see above) are a separate layer and are not remappable here.

---

See the full [User Guide](user-guide.md) for detailed feature descriptions.
