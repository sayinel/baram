import type { SnapshotEntry } from "../../ipc/types";

/**
 * §71 Reduce the raw per-file snapshot list (every snapshot containing the file)
 * to DISTINCT content versions: newest-first, keeping an entry only when the
 * file's checksum differs from the previous kept entry. Snapshots that don't
 * contain the file are skipped.
 */
export function distinctFileVersions(
  entries: SnapshotEntry[],
  filePath: string,
): SnapshotEntry[] {
  const withChecksum = entries
    .map((entry) => ({
      entry,
      checksum: entry.files.find((f) => f.path === filePath)?.checksum,
    }))
    .filter(
      (x): x is { checksum: string; entry: SnapshotEntry; } =>
        x.checksum != null,
    )
    .sort((a, b) => b.entry.timestamp.localeCompare(a.entry.timestamp));

  const result: SnapshotEntry[] = [];
  let prev: null | string = null;
  for (const { entry, checksum } of withChecksum) {
    if (checksum !== prev) {
      result.push(entry);
      prev = checksum;
    }
  }
  return result;
}
