// src/hooks/use-auto-snapshot.ts
import { useEffect } from "react";

import { useSnapshotStore } from "../stores/editor/snapshot";
import { useFileStore } from "../stores/file/file";
import { useResolvedSettings } from "./use-resolved-settings";

/**
 * §71 Periodic auto-snapshot. While a vault is open and `snapshotIntervalMinutes`
 * is > 0, fires `performAutoSnapshot` every interval; the store no-ops the tick
 * unless a file was saved since the last snapshot (the dirty gate).
 */
export function useAutoSnapshot(): void {
  const rootPath = useFileStore((s) => s.rootPath);
  const { snapshotIntervalMinutes } = useResolvedSettings();

  useEffect(() => {
    if (!rootPath) return;
    const minutes = snapshotIntervalMinutes ?? 30;
    if (minutes <= 0) return;
    const id = setInterval(
      () => {
        void useSnapshotStore.getState().performAutoSnapshot(rootPath);
      },
      minutes * 60 * 1000,
    );
    return () => clearInterval(id);
  }, [rootPath, snapshotIntervalMinutes]);
}
