# File Version History (file-mode UI + auto-snapshot) — Design

**Date:** 2026-07-19
**Spec section:** §71 (File Snapshots / Version History), §7.5 (part7-data-models). Completes the M10 snapshot-UI deliverable and the file-tree series' deferred "version history" item.

## Problem

The snapshot backend + a *vault-level* Version History UI are fully built. But:
1. The *per-file* history data path (`get_file_history` → `loadFileHistory` → `fileHistory`/`fileHistoryPath`/`clearFileHistory`) is fully implemented **yet dead** — zero consumers, no entry point, no file-mode branch in `VersionHistoryPanel`.
2. **No auto-snapshot exists.** Snapshots are created only manually (panel "+") or as a pre-restore backup. The `snapshotInterval` setting (default 30 min) exists but nothing consumes it. So a file's history would be empty for most users.

## Decisions (approved)

- **Scope:** file-mode UI **and** auto-snapshot (so history actually accumulates).
- **Entry point:** reuse the existing left **Snapshots** sidebar panel, extended with a file-scoped mode (not a new right panel).
- **Auto-snapshot trigger:** periodic interval (consumes `snapshotInterval`), gated by a "changed since last snapshot" flag — NOT on-save-per-file (snapshots are vault-wide; per-save would be far too frequent/expensive).
- **Diff:** reuse the existing unified `DiffView` (same component the vault mode uses); side-by-side is out of scope.

## Design

### 1. Auto-snapshot (periodic, dirty-gated)

- A new app-level hook `use-auto-snapshot` runs while a vault is open. It reads the resolved `snapshotInterval` (minutes; default 30) and sets an interval timer.
- **Dirty gate:** a boolean signal ("a file was saved since the last auto-snapshot") is set in the save path and cleared when an auto-snapshot is created. On each tick, the hook creates an auto-snapshot **only if** the gate is set — avoiding identical, wasteful snapshots.
  - Save path signal: `use-auto-save`'s `save()` and the non-md save in `App.tsx` mark the gate. The gate lives in the snapshot store (e.g. `pendingAutoSnapshot: boolean` + `markPendingAutoSnapshot()` / consumed by the tick).
- On tick with gate set: `createSnapshot(vaultPath, "auto", null)` then clear the gate. The Rust `create_snapshot` already runs the **retention policy** (24h/1-7d/7-30d/30d+ thinning, max 50, manual-labeled preserved), so no extra pruning is needed.
- `snapshotInterval === 0` (or unset) disables the timer (opt-out).
- Non-goal: on-save-immediate snapshots, before-risky-op snapshots (Agent Mode / global replace) — deferred.

### 2. File-mode entry point

- Add a **"Version History"** action to the file-tree context menu (single-file only) via `use-file-tree-actions.ts` + `file-tree-context-menu.tsx`.
- The action: set the target file path into the snapshot store (`loadFileHistory(vaultPath, filePath)` — which sets `fileHistoryPath` and fetches `fileHistory`), and open the left Snapshots panel (`setSidebarPanel("snapshots")`). This activates the currently-dead file-mode store path.

### 3. File-mode panel (VersionHistoryPanel branch)

- When `fileHistoryPath` is set, `VersionHistoryPanel` renders **file mode** instead of the vault list:
  - Header: the file's basename + a "← All snapshots" control that calls `clearFileHistory()` to return to vault mode.
  - **Version list = distinct content versions.** `get_file_history` returns *every* snapshot containing the file (snapshots are vault-wide, so a file appears in all of them). The panel collapses this to versions where the file's **checksum changed** (from `SnapshotFileEntry.checksum`) — showing only snapshots where the file's content actually differs from the next-newer kept version. Rust query + its tests are untouched; the dedup is a display-layer derivation.
  - Click a version → `getSnapshotDiff(vault, snapshotId, filePath)` → existing `DiffView` (snapshot version vs current file).
  - "Restore this version" → `restoreSnapshot(vault, snapshotId, [filePath])` (single-file restore; the backend writes a pre-restore auto-backup first).
- Vault mode is unchanged; the two modes coexist in the same panel via the `fileHistoryPath` branch.

### Reuse (minimal new surface)

Reused as-is: `DiffView`, the snapshot store's four dead file-mode actions/fields, the Snapshots sidebar panel + ActivityBar toggle, the Rust `get_file_history` / `get_snapshot_diff` / `restore_snapshot`, and the retention policy. New: the auto-snapshot hook + save-path gate, one context-menu action, and the panel's file-mode branch + checksum-dedup helper.

### Data flow

```
save → markPendingAutoSnapshot()            [gate set]
interval tick (snapshotInterval) → if gate: createSnapshot("auto") → clear gate → retention prune
right-click file → "Version History" → loadFileHistory(vault, file) + open Snapshots panel
panel (fileHistoryPath set) → dedup by checksum → version list
  → click version → getSnapshotDiff → DiffView
  → restore → restoreSnapshot(vault, snapshotId, [file])
```

## Out of scope (backlog)

- Side-by-side diff (unified `DiffView` kept).
- On-save-immediate / before-risky-op auto-snapshots.
- Command palette "Snapshot: Browse History" / "Snapshot: Create".
- Right-panel version-history mode.

## Testing strategy

- Rust: existing snapshot tests cover `find_file_history`, retention, diff. No Rust changes (only the auto-snapshot trigger is TS-side calling the existing `create_snapshot`), so no new Rust tests required beyond confirming green.
- TS: unit-test the checksum-dedup helper (distinct-version derivation) and the auto-snapshot gate logic (tick with/without gate). Component test for the panel's file-mode branch (renders file versions, back control, restore wiring). The save-path gate + interval timer are integration-wired; cover the pure gate logic and the hook's tick decision.
- GUI (user): auto-snapshot accumulates over the interval after edits; right-click → Version History shows the file's changed versions; diff + single-file restore work; "← All snapshots" returns to vault mode; non-vault / interval=0 disables cleanly.
