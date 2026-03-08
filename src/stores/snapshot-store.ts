// §71 스냅샷 상태 관리 스토어
import { create } from "zustand";
import type { SnapshotEntry, DiffResult } from "../ipc/types";
import {
  createSnapshot,
  listSnapshots,
  getSnapshotDiff,
  restoreSnapshot,
  deleteSnapshot,
  getFileHistory,
  readFile,
} from "../ipc/invoke";
import { useFileStore } from "./file-store";
import { useEditorStore } from "./editor-store";

interface SnapshotState {
  // List
  snapshots: SnapshotEntry[];
  loading: boolean;
  error: string | null;

  // Selected snapshot
  selectedSnapshotId: string | null;
  selectedFiles: string[];

  // Diff
  activeDiff: { filePath: string; diff: DiffResult } | null;
  diffLoading: boolean;

  // File history mode
  fileHistoryPath: string | null;
  fileHistory: SnapshotEntry[];

  // Restore
  restoring: boolean;
  restoreMessage: string | null;

  // Creating
  creating: boolean;

  // Actions
  loadSnapshots: (vaultPath: string) => Promise<void>;
  selectSnapshot: (id: string | null) => void;
  toggleFileSelection: (filePath: string) => void;
  selectAllFiles: () => void;
  deselectAllFiles: () => void;
  loadDiff: (vaultPath: string, snapshotId: string, filePath: string) => Promise<void>;
  closeDiff: () => void;
  performRestore: (vaultPath: string, snapshotId: string, files?: string[]) => Promise<void>;
  performCreate: (vaultPath: string, label?: string) => Promise<string>;
  performDelete: (vaultPath: string, snapshotId: string) => Promise<void>;
  loadFileHistory: (vaultPath: string, filePath: string) => Promise<void>;
  clearFileHistory: () => void;
}

export const useSnapshotStore = create<SnapshotState>((set, get) => ({
  snapshots: [],
  loading: false,
  error: null,
  selectedSnapshotId: null,
  selectedFiles: [],
  activeDiff: null,
  diffLoading: false,
  fileHistoryPath: null,
  fileHistory: [],
  restoring: false,
  restoreMessage: null,
  creating: false,

  loadSnapshots: async (vaultPath) => {
    set({ loading: true, error: null });
    try {
      const snapshots = await listSnapshots(vaultPath);
      set({ snapshots, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectSnapshot: (id) => {
    set({ selectedSnapshotId: id, selectedFiles: [], activeDiff: null, restoreMessage: null });
  },

  toggleFileSelection: (filePath) => {
    const { selectedFiles } = get();
    if (selectedFiles.includes(filePath)) {
      set({ selectedFiles: selectedFiles.filter((f) => f !== filePath) });
    } else {
      set({ selectedFiles: [...selectedFiles, filePath] });
    }
  },

  selectAllFiles: () => {
    const { selectedSnapshotId, snapshots } = get();
    const snap = snapshots.find((s) => s.id === selectedSnapshotId);
    if (snap) {
      set({ selectedFiles: snap.files.map((f) => f.path) });
    }
  },

  deselectAllFiles: () => set({ selectedFiles: [] }),

  loadDiff: async (vaultPath, snapshotId, filePath) => {
    set({ diffLoading: true });
    try {
      const diff = await getSnapshotDiff(vaultPath, snapshotId, filePath);
      set({ activeDiff: { filePath, diff }, diffLoading: false });
    } catch (e) {
      set({ diffLoading: false, error: String(e) });
    }
  },

  closeDiff: () => set({ activeDiff: null }),

  performRestore: async (vaultPath, snapshotId, files) => {
    set({ restoring: true, error: null, restoreMessage: null });
    try {
      await restoreSnapshot(vaultPath, snapshotId, files);

      // §71 Re-read restored files that are currently open in the editor
      const restoredPaths = files ?? get().snapshots
        .find((s) => s.id === snapshotId)?.files.map((f) => f.path) ?? [];
      const { openFiles } = useFileStore.getState();
      const { tabs, markDirty } = useEditorStore.getState();

      let reloadedCount = 0;
      for (const relPath of restoredPaths) {
        const fullPath = vaultPath + "/" + relPath;
        if (openFiles.has(fullPath)) {
          try {
            const content = await readFile(fullPath);
            useFileStore.getState().setFileContent(fullPath, content);
            // Clear dirty flag so auto-save doesn't overwrite the restored file
            const tab = tabs.find((t) => t.filePath === fullPath);
            if (tab) markDirty(tab.id, false);
            reloadedCount++;
          } catch {
            // file may have been deleted in snapshot; ignore
          }
        }
      }

      // Signal editor to re-render with updated content
      if (reloadedCount > 0) {
        useEditorStore.getState().requestContentRefresh();
      }

      // Reload snapshots after restore (a new auto-snapshot was created)
      await get().loadSnapshots(vaultPath);

      const fileCount = restoredPaths.length;
      const msg = `Restored ${fileCount} file${fileCount !== 1 ? "s" : ""}`;
      set({ restoring: false, selectedFiles: [], restoreMessage: msg });
    } catch (e) {
      set({ restoring: false, error: String(e) });
    }
  },

  performCreate: async (vaultPath, label) => {
    set({ creating: true, error: null });
    try {
      const id = await createSnapshot(vaultPath, "manual", label);
      await get().loadSnapshots(vaultPath);
      set({ creating: false });
      return id;
    } catch (e) {
      set({ creating: false, error: String(e) });
      throw e;
    }
  },

  performDelete: async (vaultPath, snapshotId) => {
    set({ error: null });
    try {
      await deleteSnapshot(vaultPath, snapshotId);
      const { selectedSnapshotId } = get();
      if (selectedSnapshotId === snapshotId) {
        set({ selectedSnapshotId: null, selectedFiles: [], activeDiff: null });
      }
      await get().loadSnapshots(vaultPath);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadFileHistory: async (vaultPath, filePath) => {
    set({ loading: true, error: null, fileHistoryPath: filePath });
    try {
      const fileHistory = await getFileHistory(vaultPath, filePath);
      set({ fileHistory, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  clearFileHistory: () => set({ fileHistoryPath: null, fileHistory: [] }),
}));
