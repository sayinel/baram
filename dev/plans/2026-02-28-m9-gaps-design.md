# M9 Spec Gaps — Design Document

**Date**: 2026-02-28
**Scope**: 4 issues from spec-check (registry sync, global search gaps, mermaid gaps)

---

## 1. Registry Sync

### 1a. IPC Registry (`src-tauri/ipc-registry.json`)

Add 16 missing commands based on actual `lib.rs` invoke_handler:

| Module | Commands to Add |
|--------|----------------|
| fs | `copy_file`, `extract_zip` |
| export | `detect_pandoc`, `export_pandoc`, `run_custom_export` |
| git | `git_stage`, `git_unstage`, `git_diff_file`, `git_branches`, `git_switch_branch`, `git_discard`, `git_create_branch` |
| keyring | `keyring_store`, `keyring_get`, `keyring_delete` |
| llm | `llm_cancel` |

Also fix:
- Remove `create_snapshot` (unimplemented stub)
- Update `git_status` and `git_commit` status: `"stub"` → `"implemented"`
- Update `search_files` status: `"stub"` → `"implemented"`

### 1b. Extension Registry (`src/extensions/registry.json`)

Add `mentionSuggest` plugin entry:
```json
{
  "name": "mentionSuggest",
  "file": "plugins/mention-suggest.ts",
  "spec": "§57",
  "phase": 2,
  "milestone": "M9",
  "status": "implemented",
  "shortcuts": { "@": "mention autocomplete" }
}
```

Update `mermaidBlock` templates array to include 4 new types.

---

## 2. Global Search — Replace + File Filter

### 2a. Replace (Frontend-based)

**UI**: Expandable replace row below search input, toggled via button.

- **Replace input field** + **Replace** / **Replace All** buttons
- Single replace: open file → find match → replace text → save
- Replace all: iterate all results, batch by file

**File handling**:
- Opened file (in editor tabs): Use ProseMirror `state.tr.replaceWith()` via `editor.commands`
  - Maintains undo history, dirty state, autosave
- Unopened file: `readFile(path)` → string replace → `writeFile(path, newContent)`

**State additions to GlobalSearch.tsx**:
```typescript
const [replaceText, setReplaceText] = useState("");
const [showReplace, setShowReplace] = useState(false);
```

### 2b. File/Folder Filter

**UI**: Include/Exclude input fields below toggles row.

- Include glob: e.g. `*.md`, `docs/**` (default: `*.md`)
- Exclude glob: e.g. `drafts/`, `archive/**`

**Rust changes**: Add `include_glob` / `exclude_glob` to `SearchOptions` + `SearchOptionsInput`. Apply glob matching in `collect_md_files()` using the `glob` crate or manual pattern matching against relative paths.

**TypeScript changes**: Add `includeGlob?` / `excludeGlob?` to `SearchOptions` type.

---

## 3. Mermaid Context Menu

**Trigger**: Right-click on mermaid preview (non-selected state).

**Menu items**:
| Item | Action | Condition |
|------|--------|-----------|
| Copy as SVG | `copyMermaidSvg(svgHtml)` | svgHtml exists |
| Copy as PNG | `copyMermaidPng(svgHtml)` | svgHtml exists |
| Copy Source | `copyMermaidSource(code)` | always |
| Edit Fullscreen | open fullscreen modal | always |
| Delete | delete block | always |

**Implementation**: `onContextMenu` handler on preview `NodeViewWrapper`. Absolute-positioned dropdown near cursor. Dismiss on click-outside or Escape.

**CSS**: Reuse existing `.context-menu` pattern from the codebase.

---

## 4. Mermaid Templates (4 additions)

Add to `MERMAID_TEMPLATES` in `mermaid-utils.ts`:

| Key | Label | Mermaid Source |
|-----|-------|---------------|
| `mindmap` | Mind Map | `mindmap\n  root((Topic))\n    Branch A\n      Leaf 1\n      Leaf 2\n    Branch B` |
| `timeline` | Timeline | `timeline\n  title History\n  2024 : Event A\n  2025 : Event B\n  2026 : Event C` |
| `journey` | User Journey | `journey\n  title User Journey\n  section Sign Up\n    Visit page: 5: User\n    Fill form: 3: User\n    Submit: 5: User` |
| `gitgraph` | Git Graph | `gitGraph\n  commit\n  branch develop\n  commit\n  checkout main\n  merge develop\n  commit` |

Update `detectMermaidType()` to add `journey` and `gitgraph` patterns.

Update `registry.json` templates array: add `mindmap`, `timeline`, `journey`, `gitgraph`.
