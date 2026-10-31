// §395 spec 0074 D12 — every registered vault or folder context whose tree holds a path. The gate on
// `vault:changed` holds each of them while the app moves or deletes that path: a note in a nested vault is
// in its parent too, and each context gets its own `vault:changed`. `getContextForPath` answers one
// context — the innermost, and a file context before any — so it cannot serve. File contexts are left out:
// the backend sends `vault:changed` for vault and folder contexts only (`buildable` in
// `src-tauri/src/index/service/keys.rs`). Lexical, as `getContextForPath` is: a root registered through a
// symlink, or another spelling of the same folder, does not match — a gap spec 0074 D12 accepts and the
// plugin docs state. "Under the root" is the shared `isUnderRoot` (`utils/path-utils.ts`), case kept: it
// strips the root's trailing separators as `contextRootOf` does (both through `stripTrailingSeparators`)
// and takes either separator at the boundary, as `getContextForPath` does.
import type { ContextInfo } from "../../ipc/types";

import { isUnderRoot } from "../../utils/path-utils";
import { contextRootOf, useContextStore } from "./context";

/** The vault and folder contexts whose root is `path`, or under whose root `path` lies. */
export function contextsContaining(
  path: string,
  contexts: readonly ContextInfo[] = useContextStore.getState().contexts,
): ContextInfo[] {
  return contexts.filter(
    (context) =>
      context.contextType !== "file" &&
      (path === contextRootOf(context.path) || isUnderRoot(path, context.path)),
  );
}
