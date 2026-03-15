// App startup side effects — migration, onLaunch restore, file open events
import { useEffect, useRef } from "react";

import { listen } from "@tauri-apps/api/event";

import { getOpenedUrls } from "../ipc/invoke";
import { openFolder } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { migrateFromLocalStorage } from "../stores/system/tauri-storage";

interface UseAppStartupParams {
  handleNewFile: () => void;
  handleOpenFilePath: (path: string) => Promise<void>;
}

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
      if (onLaunch === "restoreLastFolder" && lastOpenedFolder) {
        try {
          await openFolder(lastOpenedFolder);
          useSettingsStore.getState().addRecentFolder(lastOpenedFolder);
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
    })();
  }, [handleOpenFilePath]);

  // Listen for file open events from macOS (Finder "Open With" / double-click)
  useEffect(() => {
    // Cold start: check for files queued before frontend was ready
    getOpenedUrls()
      .then((paths) => {
        for (const path of paths) {
          handleOpenFilePath(path);
        }
      })
      .catch(() => {});

    // Hot open: listen for files opened while app is running
    const unlisten = listen<string>("file:open-request", (event) => {
      handleOpenFilePath(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenFilePath]);
}
