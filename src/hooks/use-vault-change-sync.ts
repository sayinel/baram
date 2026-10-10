// §393 Keep the link index in step with the vault, and announce `vault:changed` (spec 0072 §6).
//
// Hears the same three watcher events as `useFileWatcher` and `useTaskWatcher`, on its own (it
// shares neither's state). Mounted in `useEditorFeatures`, which only the main window runs —
// `AppRoot` routes a file-mode window to `FileEditorLayout` — so one window syncs.
import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { syncIndexPaths } from "../ipc/invoke";
import {
  createVaultChangeBatcher,
  type VaultEventKind,
} from "../services/vault-change-batcher";
import { publishVaultChange } from "../services/vault-changes";
import { useLinkStore } from "../stores/editor/link";
import { logger } from "../utils/logger";

export function useVaultChangeSync(): void {
  useEffect(() => {
    const batcher = createVaultChangeBatcher({
      onSynced: announce,
      sync: syncIndexPaths,
    });
    const hear =
      (kind: VaultEventKind) => (event: { payload: { path: string } }) =>
        batcher.touch(event.payload.path, kind);
    const unlistens: UnlistenFn[] = [];
    let cancelled = false;
    void (async () => {
      const results = await Promise.allSettled([
        listen<{ path: string }>("file:changed", hear("changed")),
        listen<{ path: string }>("file:created", hear("created")),
        listen<{ path: string }>("file:deleted", hear("deleted")),
      ]);
      const fns = results.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      const failed = results.length - fns.length;
      if (failed > 0) {
        logger.warn(
          "[vault-sync] watcher listen failed; sync stopped",
          results,
        );
      }
      if (cancelled || failed > 0) {
        fns.forEach((f) => f());
        return;
      }
      unlistens.push(...fns);
    })();
    return () => {
      cancelled = true;
      unlistens.forEach((f) => f());
      batcher.dispose();
    };
  }, []);
}

/** The backlinks panel re-reads on `indexVersion`; plugins hear `vault:changed` per context. */
function announce(contextIds: string[]): void {
  useLinkStore.getState().invalidate();
  contextIds.forEach(publishVaultChange);
}
