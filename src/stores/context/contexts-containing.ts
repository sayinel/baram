// §395 spec 0074 D12 — every registered vault or folder context whose tree holds a path. The gate on
// `vault:changed` holds each of them while the app moves or deletes that path: a note in a nested vault is
// in its parent too, and each context gets its own `vault:changed`. `getContextForPath` answers one
// context — the innermost, and a file context before any — so it cannot serve. File contexts are left out:
// the backend sends `vault:changed` for vault and folder contexts only (`buildable` in
// `src-tauri/src/index/service/keys.rs`). Lexical, as `getContextForPath` is: a root registered through a
// symlink, or another spelling of the same folder, does not match — a gap spec 0074 D12 accepts and spec
// §9 requires the plugin docs to state. "Under the root" is tested here, not through `isUnderRoot`
// (`utils/path-utils.ts`): that refuses an empty base, and a context registered at `/` has the root
// `contextRootOf("/") === ""` (the registry keeps `/` — `_addContextTracked` falls back to the raw path),
// so it would never match. The test is `isUnderRoot`'s own: the root with trailing separators stripped
// (`contextRootOf`), case kept, and either separator at the boundary — with an empty root the boundary is
// the path's first character, so `/` holds every absolute POSIX path and nothing relative.
import type { ContextInfo } from "../../ipc/types";

import { contextRootOf, useContextStore } from "./context";

function holds(path: string, contextPath: string): boolean {
  const root = contextRootOf(contextPath);
  if (path === root) return true;
  if (!path.startsWith(root)) return false;
  const boundary = path[root.length];
  return boundary === "/" || boundary === "\\";
}

/** The vault and folder contexts whose root is `path`, or under whose root `path` lies. */
export function contextsContaining(
  path: string,
  contexts: readonly ContextInfo[] = useContextStore.getState().contexts,
): ContextInfo[] {
  return contexts.filter(
    (context) => context.contextType !== "file" && holds(path, context.path),
  );
}
