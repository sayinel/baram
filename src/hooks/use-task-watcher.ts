// §304 갱신 모델 — file:* 이벤트로 변경된 파일만 다시 읽는다.
import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { refreshFileTasks, useTaskStore } from "../stores/tasks/task-store";

/**
 * 파일트리 스토어와 결합하지 않고 같은 Tauri 이벤트를 독립적으로 구독한다.
 * 전체 스캔은 패널이 담당한다 — 여기서는 증분만.
 */
export function useTaskWatcher(): void {
  const tasksEnabled = useSettingsStore((s) => s.tasksEnabled);

  useEffect(() => {
    if (!tasksEnabled) return;
    const unlistens: UnlistenFn[] = [];
    let cancelled = false;

    void (async () => {
      const fns = await Promise.all([
        listen<{ path: string }>("file:changed", (e) => {
          if (isMarkdown(e.payload.path)) refreshChangedFile(e.payload.path);
        }),
        listen<{ isDir?: boolean; path: string }>("file:created", (e) => {
          if (!e.payload.isDir && isMarkdown(e.payload.path)) {
            refreshChangedFile(e.payload.path);
          }
        }),
        listen<{ path: string }>("file:deleted", (e) => {
          useTaskStore.getState().removeFile(e.payload.path);
        }),
      ]);
      if (cancelled) {
        fns.forEach((f) => f());
        return;
      }
      unlistens.push(...fns);
    })();

    return () => {
      cancelled = true;
      unlistens.forEach((f) => f());
    };
  }, [tasksEnabled]);
}

function isMarkdown(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".markdown");
}

/** 최신 rootPath/exclude로 증분 재스캔한다 — vault가 없으면 스킵. */
function refreshChangedFile(path: string): void {
  const { rootPath } = useFileStore.getState();
  if (!rootPath) return;
  const { tasksExcludePaths } = useSettingsStore.getState();
  void refreshFileTasks(path, rootPath, tasksExcludePaths);
}
