// §29 링크 index 를 워처가 본 변경에 맞춘다 — 바뀐 경로만 Rust 에 넘긴다.
import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type { FileCreatedPayload, FileWriteOrigin } from "../ipc/types";

import { syncWatchedPaths } from "../ipc/invoke";
import { useLinkStore } from "../stores/editor/link";
import { logger } from "../utils/logger";

/** 같은 쓰기가 올리는 이벤트 여럿(FSEvents)과 git checkout 같은 일괄 변경을 한 번에 받는다. */
const FLUSH_DELAY_MS = 300;

/**
 * 워처가 보고한 경로를 `sync_watched_paths` 로 링크 index 에 반영하고 `indexVersion` 을 올린다.
 *
 * Graph 는 저장마다 index 를 통째로 다시 만들어서 다른 쓰기도 다음 저장에 따라왔다(issue 790).
 * 이제 Graph 는 index 를 읽기만 하므로 그 일을 여기서 한다. 앱 자신의 쓰기도 넘긴다 — 저장은
 * 스스로 `updateFileIndex` 를 부르지만 Quick Capture · 전역 검색 바꾸기 · journal 처럼 부르지 않는
 * 쓰기가 있다. 경로가 무엇인지(노트 · 링크 대상 · 디렉터리 · 빌드가 걷지 않는 경로)는 Rust 가
 * 판정한다.
 *
 * - flush 는 하나씩 돈다 — 다음 flush 는 앞의 것이 끝난 뒤에 시작한다.
 * - 경로 하나만 담긴 flush 는 `invalidate(path)` 로 그 경로를 알린다 — 보고 있는 노트의 저장
 *   메아리가 Backlinks 의 mention 검색을 다시 부르지 않게(#791). 그 밖에는 `invalidate()`.
 * - 반영하지 못한 경로는 다음 flush 에서 한 번만 다시 시도하고, 또 실패하면 버린다.
 *
 * 남는 것: 쓰기는 이벤트가 여기를 거쳐 Rust 에 닿은 뒤에야(약 300 ms) index 에 들어간다 — 그
 * 사이에 rename 이 판정하면 그 쓰기를 모른다. #823 의 후속 sub-issue 가 이 보장을 Rust 로 옮긴다.
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
      let applied = 0;
      try {
        const result = await syncWatchedPaths(paths);
        failed = result.failed;
        applied = result.applied;
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
      if (applied === 0) return;
      if (paths.length === 1) useLinkStore.getState().invalidate(paths[0]);
      else useLinkStore.getState().invalidate();
    };

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
