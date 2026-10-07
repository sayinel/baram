// §3.6 §3.2 A standalone file window's watch on its file's folder (#797).
import { useEffect } from "react";

import type { WatchHandle } from "../services/watch-leases";

import { want } from "../services/watch-leases";
import { containingFolder } from "../utils/path-utils";

/**
 * Watch the folder of `filePath`, non-recursively and for that file, while mounted —
 * asked for only once `registered()` (the window's `ensureFileContext`, the same promise
 * the file load awaits) has succeeded: before then Rust refuses it, since no context
 * holds the file. A registration that fails leaves nothing to watch; the window shows
 * the load error. A refused or ended watch stays wanted (`services/watch-leases`).
 */
export function useFileWindowWatch(
  filePath: string,
  registered: () => Promise<unknown>,
): void {
  useEffect(() => {
    const dir = containingFolder(filePath);
    if (!dir) return;
    let cancelled = false;
    let handle: undefined | WatchHandle;
    registered().then(
      () => {
        if (!cancelled) {
          handle = want(dir, { focus: filePath, recursive: false });
        }
      },
      () => {},
    );
    return () => {
      cancelled = true;
      handle?.release();
    };
  }, [filePath, registered]);
}
