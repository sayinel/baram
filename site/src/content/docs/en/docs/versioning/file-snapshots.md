---
title: "Version history"
---


Baram includes an automatic file versioning system independent of Git. It provides a safety net for your work — even if you don't use Git.

## How It Works

Baram periodically saves snapshots of changed `.md` files in your workspace. Only files that have actually changed since the last snapshot are stored, keeping storage efficient.

## Version History Sidebar

Click the **clock icon** in the Activity Bar (left sidebar) to open the Version History panel.

The panel shows a **timeline** of all snapshots:

- **●** Auto snapshots (created automatically by timer)
- **★** Manual snapshots (created by you, optionally with a label)
- Each entry shows the time, type, number of files, and total size

## Viewing Diffs

1. Click a snapshot in the timeline to see its file list
2. Click any file name to see a **line-by-line diff** comparing the snapshot version with the current file
3. Additions are highlighted in green, deletions in red

## Restoring Files

1. Select a snapshot from the timeline
2. Use **checkboxes** to select which files to restore (or use "Restore All")
3. Click **Restore** — Baram saves the current state as an auto-snapshot first, so you can always undo

## Creating Manual Snapshots

Click the **+** button in the Version History panel header. Optionally enter a label (e.g., "Before refactoring") to make the snapshot easy to find later. Manual snapshots with labels are never auto-deleted.

## Settings

Configure snapshots in **Settings > General**:

| Setting            | Default    | Description                                         |
| ------------------ | ---------- | --------------------------------------------------- |
| Snapshot Interval  | 30 minutes | How often auto-snapshots are created (0 = disabled) |
| Max Snapshot Count | 50         | Maximum number of snapshots to keep                 |

## Retention Policy

Old snapshots are automatically thinned to save space:

- **Last 24 hours** — All snapshots kept
- **1–7 days** — Max 1 per hour
- **7–30 days** — Max 1 per day
- **30+ days** — Max 1 per week

Manual snapshots with labels are never auto-deleted. The max count and max storage (500 MB) limits are enforced when new snapshots are created.

## Git Users

Version History works alongside Git but is independent. If you prefer using Git for version control, you can disable snapshots by setting the interval to 0 in Settings.

---
