// §29 #824 The frontend's sync of watcher events (`sync_watched_paths`) is gone: Rust's
// watcher applier brings other programs' writes into the link index itself. §393 main's
// later sync of the same events (`sync_index_paths`) was not taken in the merge, for the same
// reason. Each place
// that makes a command callable is read the way its consumer reads it — the barrel as
// a module, the capability and the registry as JSON, the handler list and the ACL
// build list as the macro and array they are — and each still holds a command that
// stays (`refresh_index`), so an emptied or unreadable file cannot pass.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as ipc from "../ipc/invoke";

const root = join(__dirname, "..", "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

/** The body of the first `name![ … ]` or `name: [ … ]` list after `anchor` in `text`. */
function list(text: string, anchor: string): string {
  const start = text.indexOf(anchor);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("[", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") depth++;
    if (text[i] === "]" && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error(`unclosed list after ${anchor}`);
}

/** The removed commands: the Rust name, the frontend wrapper, and the types it carried. */
const REMOVED = [
  {
    command: "sync_watched_paths",
    types: [/\bWatchedSync\b/],
    wrapper: "syncWatchedPaths",
  },
  // §393 main's watcher sync, not taken by the merge: the applier above is the one path.
  {
    command: "sync_index_paths",
    types: [/\bIndexSyncAnswer\b/, /\bIndexSyncPath\b/],
    wrapper: "syncIndexPaths",
  },
];

describe.each(REMOVED)("the removed $command command", (removed) => {
  // 이것을 실패시키는 것: 다섯 자리 중 하나에 그 명령(또는 wrapper · 타입)을 되돌린다 — 예: capability 에
  // `allow-sync-watched-paths` 나 `allow-sync-index-paths` 만 다시 넣는다.
  it("is not invokable from any place a command is made callable", () => {
    const permission = `allow-${removed.command.replaceAll("_", "-")}`;
    const handlers = list(read("src-tauri/src/lib.rs"), "generate_handler!");
    expect(handlers).toContain("index_cmd::refresh_index");
    expect(handlers).not.toContain(removed.command);

    const acl = list(read("src-tauri/build.rs"), "commands(&[");
    expect(acl).toContain('"refresh_index"');
    expect(acl).not.toContain(`"${removed.command}"`);

    const capability = JSON.parse(
      read("src-tauri/capabilities/default.json"),
    ) as {
      permissions: (string | { identifier: string })[];
    };
    const permitted = capability.permissions.map((p) =>
      typeof p === "string" ? p : p.identifier,
    );
    expect(permitted).toContain("allow-refresh-index");
    expect(permitted).not.toContain(permission);

    const registry = JSON.parse(read("src-tauri/ipc-registry.json")) as {
      commands: { name: string }[];
    };
    const names = registry.commands.map((c) => c.name);
    expect(names).toContain("refresh_index");
    expect(names).not.toContain(removed.command);

    expect("refreshIndex" in ipc).toBe(true);
    expect(removed.wrapper in ipc).toBe(false);

    const types = read("src/ipc/types.ts");
    expect(types).toContain("export interface IndexChanged");
    for (const type of removed.types) expect(types).not.toMatch(type);
  });
});
