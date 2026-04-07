// App startup side effects — migration, onLaunch restore, file open events
import { useEffect, useRef } from "react";

import { listen } from "@tauri-apps/api/event";

import {
  setActiveContext as reActivateInRust,
  addContext as reRegisterInRust,
} from "../ipc/context";
import { getOpenedUrls } from "../ipc/invoke";
import { useContextStore } from "../stores/context/context";
import { openFolder, useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { migrateFromLocalStorage } from "../stores/system/tauri-storage";
import { resolveJournalDir } from "../utils/journal/journal";
import { logger } from "../utils/logger";

interface UseAppStartupParams {
  handleNewFile: () => void;
  handleOpenFilePath: (path: string) => Promise<void>;
}

/** §89 Track whether queued file-open URLs have been processed (prevents double-open). */
let openedUrlsProcessed = false;

export function useAppStartup({
  handleOpenFilePath,
  handleNewFile,
}: UseAppStartupParams): void {
  // §3.2 One-time migration: localStorage → Tauri app_data_dir
  useEffect(() => {
    migrateFromLocalStorage().catch(() => {});
  }, []);

  // onLaunch — restore folder/file on startup
  const onLaunchDone = useRef(false);
  // Capture latest handleNewFile in a ref so the mount-only effect does not need
  // it as a dep (handleNewFile changes identity when `tabs` changes, which would
  // incorrectly re-run the startup restore logic on every tab mutation).
  const handleNewFileRef = useRef(handleNewFile);
  handleNewFileRef.current = handleNewFile;
  useEffect(() => {
    if (onLaunchDone.current) return;
    onLaunchDone.current = true;

    const { onLaunch, lastOpenedFolder, lastOpenedFile } =
      useSettingsStore.getState();

    (async () => {
      // §81 Re-register persisted contexts in Rust backend BEFORE any file operations.
      // After app restart, Rust ContextManager is empty while Zustand has persisted
      // contexts. Without this, check_vault (via validate_path_any) would fail because
      // no contexts are registered in Rust.
      const contextStore = useContextStore.getState();
      if (contextStore.contexts.length > 0) {
        // §89 Clean up persisted FileContexts — they should not survive restart
        const fileCtxIds = contextStore.contexts
          .filter((c) => c.contextType === "file")
          .map((c) => c.id);
        for (const id of fileCtxIds) {
          await contextStore.removeContext(id).catch(() => {});
        }

        const staleIds: string[] = [];
        for (const ctx of contextStore.contexts) {
          try {
            await reRegisterInRust(ctx);
          } catch {
            // §90 Path no longer valid — mark for removal
            logger.warn(
              `§90 Stale context removed: ${ctx.label} (${ctx.path})`,
            );
            staleIds.push(ctx.id);
          }
        }
        // §90 Remove stale contexts whose paths are no longer valid
        for (const id of staleIds) {
          await contextStore.removeContext(id).catch(() => {});
        }
        // Re-activate the active context in Rust
        if (contextStore.activeContextId) {
          await reActivateInRust(contextStore.activeContextId).catch(() => {
            logger.warn("§81 Startup re-activation of active context failed");
          });
        }
      }

      // §81 Migration: if contextStore has persisted contexts from previous session,
      // restore them in the backend. If not, fall through to lastOpenedFolder.
      // §81 Restore contexts only if there are vault/folder contexts remaining
      // (FileContexts were already cleaned up above)
      const remainingContexts = useContextStore.getState().contexts;
      if (
        remainingContexts.length > 0 &&
        useContextStore.getState().activeContextId
      ) {
        const activeCtx = useContextStore.getState().activeContext();
        if (activeCtx) {
          try {
            await openFolder(activeCtx.path);
            // Restore last opened file if it's inside the vault (not external)
            if (lastOpenedFile) {
              const parentCtx = useContextStore
                .getState()
                .getContextForPath(lastOpenedFile);
              if (parentCtx && parentCtx.contextType !== "file") {
                await handleOpenFilePath(lastOpenedFile);
              }
            }
            // §85 M2b: Journal startup behavior
            const { journalEnabled, journalStartupBehavior, journalDirectory } =
              useSettingsStore.getState();
            if (
              journalEnabled &&
              journalStartupBehavior === "openJournal" &&
              journalDirectory
            ) {
              const resolvedDir = resolveJournalDir(
                useFileStore.getState().rootPath ?? "",
                journalDirectory,
              );
              if (resolvedDir) {
                try {
                  await useContextStore
                    .getState()
                    .ensureJournalContext(resolvedDir);
                } catch {
                  // Non-fatal
                }
              }
            }

            // §89 Process queued file-open requests AFTER vault restoration
            await processOpenedUrls(handleOpenFilePath);
            return; // Done — context restored
          } catch {
            // Path may be invalid; fall through to legacy restore
            logger.warn(
              "§81 Context restore failed, falling back to lastOpenedFolder",
            );
          }
        }
      }

      // Legacy restore path (also serves as first-run migration)
      // §90 Auto-migrate lastOpenedFolder to context if no contexts exist
      if (onLaunch === "restoreLastFolder" && lastOpenedFolder) {
        try {
          await openFolder(lastOpenedFolder);
          useSettingsStore.getState().addRecentFolder(lastOpenedFolder);

          // §90 Migration: create context from legacy lastOpenedFolder
          if (useContextStore.getState().contexts.length === 0) {
            const { getVaultConfigByPath } = await import("../ipc/context");
            try {
              const config = await getVaultConfigByPath(lastOpenedFolder);
              // .baram/config.json exists → VaultContext
              const alias =
                config.vault?.alias ??
                lastOpenedFolder.split("/").pop() ??
                "vault";
              await useContextStore
                .getState()
                .addContext("vault", lastOpenedFolder, { alias });
            } catch {
              // No .baram/config.json → FolderContext
              await useContextStore
                .getState()
                .addContext("folder", lastOpenedFolder);
            }
          }
        } catch {
          /* folder may have been deleted */
        }
      } else if (onLaunch === "restoreLastFile" && lastOpenedFile) {
        try {
          if (lastOpenedFolder) {
            await openFolder(lastOpenedFolder);
            useSettingsStore.getState().addRecentFolder(lastOpenedFolder);
          }
          await handleOpenFilePath(lastOpenedFile);
        } catch {
          /* ignore */
        }
      } else if (onLaunch === "newFile") {
        handleNewFileRef.current();
      }

      // §89 Process any remaining queued file-open URLs (legacy/no-vault path)
      await processOpenedUrls(handleOpenFilePath);
    })();
  }, [handleOpenFilePath]);

  // Listen for file open events from macOS (Finder "Open With" while app is running)
  useEffect(() => {
    // Cold start URLs are now handled inside the first useEffect via
    // processOpenedUrls() — called AFTER vault restoration completes.
    // This effect only handles hot-open events (file opened while running).
    const unlisten = listen<string>("file:open-request", (event) => {
      handleOpenFilePath(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenFilePath]);
}

/** §89 Process queued file-open requests from macOS file association. */
async function processOpenedUrls(
  handleOpenFilePath: (path: string) => Promise<void>,
): Promise<void> {
  if (openedUrlsProcessed) return;
  openedUrlsProcessed = true;

  let paths: string[];
  try {
    paths = await getOpenedUrls();
  } catch {
    return;
  }
  if (!paths.length) return;

  for (const path of paths) {
    await handleOpenFilePath(path);
  }
}
