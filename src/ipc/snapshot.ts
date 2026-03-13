// §71 Snapshot IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { DiffResult, SnapshotEntry } from "./types";

export async function createSnapshot(
  vaultPath: string,
  snapshotType: string,
  label?: string,
): Promise<string> {
  return invoke<string>("create_snapshot", {
    vaultPath,
    snapshotType,
    label: label ?? null,
  });
}

export async function deleteSnapshot(
  vaultPath: string,
  snapshotId: string,
): Promise<void> {
  return invoke<void>("delete_snapshot", { vaultPath, snapshotId });
}

export async function getFileHistory(
  vaultPath: string,
  filePath: string,
): Promise<SnapshotEntry[]> {
  return invoke<SnapshotEntry[]>("get_file_history", { vaultPath, filePath });
}

export async function getSnapshotDiff(
  vaultPath: string,
  snapshotId: string,
  filePath: string,
): Promise<DiffResult> {
  return invoke<DiffResult>("get_snapshot_diff", {
    vaultPath,
    snapshotId,
    filePath,
  });
}

export async function listSnapshots(
  vaultPath: string,
): Promise<SnapshotEntry[]> {
  return invoke<SnapshotEntry[]>("list_snapshots", { vaultPath });
}

export async function restoreSnapshot(
  vaultPath: string,
  snapshotId: string,
  files?: string[],
): Promise<void> {
  return invoke<void>("restore_snapshot", {
    vaultPath,
    snapshotId,
    files: files ?? null,
  });
}
