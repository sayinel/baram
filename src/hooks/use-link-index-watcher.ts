// §29 링크 index 를 워처가 본 변경에 맞춘다 — 바뀐 경로만 Rust 에 넘긴다.
import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type {
  FileCreatedPayload,
  FileWriteOrigin,
  IndexChanged,
} from "../ipc/types";

import { syncWatchedPaths } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { logger } from "../utils/logger";

/** 같은 쓰기가 올리는 이벤트 여럿(FSEvents)과 git checkout 같은 일괄 변경을 한 번에 받는다. */
const FLUSH_DELAY_MS = 300;

/**
 * 워처가 보고한 경로를 `sync_watched_paths` 로 링크 index 에 반영하고, Rust 가 알리는
 * `index:changed` 로 `indexVersion` 을 올린다.
 *
 * Graph 는 저장마다 index 를 통째로 다시 만들어서 다른 쓰기도 다음 저장에 따라왔다(issue 790).
 * 이제 Graph 는 index 를 읽기만 한다. 앱 자신의 쓰기는 그 명령이 돌아오기 전에 Rust 가 index 에
 * 넣고(#824) `index:changed` 를 한 번 낸다. 여기서 넘기는 것은 다른 프로그램의 쓰기다. 경로가
 * 무엇인지(노트 · 링크 대상 · 디렉터리 · 빌드가 걷지 않는 경로)는 Rust 가 판정한다.
 *
 * - flush 는 하나씩 돈다 — 다음 flush 는 앞의 것이 끝난 뒤에 시작한다.
 * - `indexVersion` 은 `index:changed` 에서만 오른다 — 명령 하나, flush 하나마다 한 번. 파일
 *   하나만 담긴 이벤트는 `invalidate(path)` 로 그 경로를 알린다 — 보고 있는 노트의 저장
 *   메아리가 Backlinks 의 mention 검색을 다시 부르지 않게(#791). 한 파일의 여러 표기(#797)는
 *   이벤트의 한 항목이고, 활성 탭의 표기가 그 안에 있으면 그것으로 알린다. 그 밖에는
 *   `invalidate()`.
 * - 반영하지 못한 경로는 다음 flush 에서 한 번만 다시 시도하고, 또 실패하면 버린다.
 *
 * 남는 것: 다른 프로그램의 쓰기는 이벤트가 여기를 거쳐 Rust 에 닿은 뒤에야(약 300 ms) index 에
 * 들어간다. Rust 쪽 applier 가 #824 의 다음 단계다.
 */
export function useLinkIndexWatcher(): void {
  useEffect(() => {
    const unlistens: UnlistenFn[] = [];
    const pending = new Set<string>();
    const retried = new Set<string>();
    let timer: null | ReturnType<typeof setTimeout> = null;
    let chain: Promise<void> = Promise.resolve();
    let cancelled = false;

    const flush = async (): Promise<void> => {
      const paths = [...pending];
      pending.clear();
      if (paths.length === 0) return;
      let failed: string[];
      try {
        failed = (await syncWatchedPaths(paths)).failed;
      } catch (err) {
        logger.error("§29 useLinkIndexWatcher: sync failed", err);
        failed = paths;
      }
      for (const p of paths) if (!failed.includes(p)) retried.delete(p);
      for (const p of failed) {
        if (retried.has(p)) {
          retried.delete(p);
          logger.error("§29 useLinkIndexWatcher: dropped after a retry", p);
        } else {
          retried.add(p);
          schedule(p);
        }
      }
      // #824 What reached the index is announced by Rust (`index:changed`, below).
    };

    /**
     * §29 #824 The indexes already reflect these paths — one event per command or
     * watcher batch. One file is named, in the spelling the active tab uses when it is
     * among the event's spellings (#797: one file can arrive under several), so
     * Backlinks can tell its own save (#791); anything else re-reads everything.
     */
    const onIndexChanged = (e: { payload: IndexChanged }): void => {
      const { entries, rebuilt } = e.payload;
      if (rebuilt.length === 0 && entries.length === 1) {
        useLinkStore.getState().invalidate(spellingShown(entries[0]));
      } else {
        useLinkStore.getState().invalidate();
      }
    };

    function spellingShown(entry: IndexChanged["entries"][number]): string {
      const { activeTabId, tabs } = useEditorStore.getState();
      const active = tabs.find((t) => t.id === activeTabId)?.filePath;
      if (
        active &&
        (entry.spellings.includes(active) || entry.canonical === active)
      ) {
        return active;
      }
      return entry.spellings[0] ?? entry.canonical;
    }

    function schedule(path: string): void {
      pending.add(path);
      if (timer !== null || cancelled) return;
      timer = setTimeout(() => {
        timer = null;
        chain = chain.then(flush);
      }, FLUSH_DELAY_MS);
    }

    const take = (e: { payload: { path: string } }): void =>
      schedule(e.payload.path);

    void (async () => {
      const results = await Promise.allSettled([
        listen<{ mtime: number; origin: FileWriteOrigin; path: string }>(
          "file:changed",
          take,
        ),
        listen<FileCreatedPayload>("file:created", take),
        listen<{ path: string }>("file:deleted", take),
        listen<IndexChanged>("index:changed", onIndexChanged),
      ]);
      const fns = results.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      if (cancelled || fns.length < results.length) {
        fns.forEach((f) => f());
        if (fns.length < results.length) {
          logger.error("§29 useLinkIndexWatcher: listen failed", results);
        }
        return;
      }
      unlistens.push(...fns);
    })().catch((err: unknown) =>
      logger.error("§29 useLinkIndexWatcher: setup failed", err),
    );

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      unlistens.forEach((f) => f());
    };
  }, []);
}
