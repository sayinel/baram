// §29 링크 index 를 앱 밖의 변경에 맞춘다 — file:* 이벤트로 바뀐 노트만 다시 읽는다.
import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { refreshIndex, updateFileIndex } from "../ipc/invoke";
import { useLinkStore } from "../stores/editor/link";
import { useFileStore } from "../stores/file/file";
import { findEntryByPath } from "../stores/file/file-tree-ops";
import { logger } from "../utils/logger";

/** 같은 쓰기가 올리는 이벤트 여럿(FSEvents)과 git checkout 같은 일괄 변경을 한 번에 받는다. */
const FLUSH_DELAY_MS = 300;

/**
 * 앱 밖에서 만들거나 고치거나 지운 노트를 링크 index 에 반영하고 `indexVersion` 을 한 번 올린다.
 *
 * Graph 는 저장마다 index 를 통째로 다시 만들어서 밖의 변경도 다음 저장에 따라왔다(issue 790).
 * 이제 Graph 는 index 를 읽기만 하므로 그 일을 여기서 파일 하나 갱신으로 한다.
 *
 * - 앱 자신의 쓰기(`origin === "app"`)는 건너뛴다 — 저장이 이미 `updateFileIndex` 를 불렀다.
 * - 노트(`.md`·`.markdown`, index build 가 읽는 것과 같은 규칙)는 경로마다 `updateFileIndex`
 *   한 번. Rust 가 없는 파일을 제거로, context 밖의 경로를 no-op 으로 다룬다.
 * - 디렉터리가 생기거나 지워지면 vault 를 한 번 다시 build 한다. 옮기거나 휴지통으로 보낸 폴더는
 *   폴더 하나의 이벤트로만 온다. 지워진 경로는 디스크에서 물을 수 없어 파일 트리로 판정하는데,
 *   앱 안의 폴더 삭제는 그 이벤트보다 먼저 트리에서 뺄 수 있어 `use-file-tree-crud.ts` 가 직접
 *   다시 build 한다. 앱이 만든 새 노트도 그 파일이 직접 index 에 넣는다.
 * - 노트가 아닌 파일(§278 의 PDF 같은 링크 대상)은 여기서 반영하지 않는다 — 다음 build 까지
 *   이전 상태로 남는다.
 */
export function useLinkIndexWatcher(): void {
  useEffect(() => {
    const unlistens: UnlistenFn[] = [];
    const pending = new Set<string>();
    let rebuild = false;
    let timer: null | ReturnType<typeof setTimeout> = null;
    let cancelled = false;

    const flush = async (): Promise<void> => {
      timer = null;
      const paths = [...pending];
      const full = rebuild;
      pending.clear();
      rebuild = false;
      const rootPath = useFileStore.getState().rootPath;
      try {
        if (full && rootPath) await refreshIndex(rootPath);
        else await Promise.all(paths.map((p) => updateFileIndex(p)));
      } catch (err) {
        logger.error("§29 useLinkIndexWatcher: index update failed", err);
      }
      useLinkStore.getState().invalidate();
    };

    const schedule = (path: null | string): void => {
      if (path === null) rebuild = true;
      else pending.add(path);
      if (timer === null)
        timer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
    };

    void (async () => {
      const fns = await Promise.all([
        listen<{ origin?: string; path: string }>("file:changed", (e) => {
          if (e.payload.origin === "app") return;
          if (isNote(e.payload.path)) schedule(e.payload.path);
        }),
        listen<{ isDir?: boolean; origin?: string; path: string }>(
          "file:created",
          (e) => {
            if (e.payload.origin === "app") return;
            if (e.payload.isDir) schedule(null);
            else if (isNote(e.payload.path)) schedule(e.payload.path);
          },
        ),
        listen<{ path: string }>("file:deleted", (e) => {
          const p = e.payload.path;
          if (isNote(p)) schedule(p);
          else if (findEntryByPath(useFileStore.getState().fileTree, p)?.isDir)
            schedule(null);
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
      if (timer !== null) clearTimeout(timer);
      unlistens.forEach((f) => f());
    };
  }, []);
}

function isNote(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".markdown");
}
