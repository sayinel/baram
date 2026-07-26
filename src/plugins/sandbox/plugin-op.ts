// §260 — TS mirror of the Rust `PluginOp` (authorizer.rs). Internally tagged on
// `kind`, snake_case, so it serializes to exactly what the broker deserializes.
// Covers storage + network (3c-1), the plugin's own source (3c-2b) and vault files
// (3c-2c). `ai` is deliberately NOT here — it is host-mediated (`SandboxHostRequest`
// in protocol.ts) because its policy is frontend state.
//
// ‼️ Per-variant notes live INSIDE the variant's braces: `perfectionist` sorts union
// members alphabetically on every lint run, so a comment written above a member gets
// left behind when the member moves — reattached to whatever sorts into that slot.
// (It happened to the `source_read` note twice.)
import type { PluginFetchInit } from "../types";

export type PluginOp =
  | {
      // §260 3c-2b — this sandbox's OWN bundle. No path field exists by design: Rust
      // reads it from the directory the host BOUND at registration, so the op cannot
      // be pointed at another plugin's file or anywhere else on disk.
      kind: "source_read";
    }
  | {
      // §260 3c-2c — entry NAMES in one directory (not recursive, no metadata).
      kind: "files_list";
      path: string;
    }
  | {
      // §260 3c-2c — vault-bounded read, admitted by `files` or `files:readonly`.
      kind: "files_read";
      path: string;
    }
  | {
      // §260 3c-2c — vault-bounded write. Same vault rule as `write_file`, minus the
      // app's `.baram` state, size-capped, and performed on the canonical path.
      content: string;
      kind: "files_write";
      path: string;
    }
  | { init?: PluginFetchInit; kind: "http_fetch"; url: string }
  | { key: string; kind: "storage_read" }
  | { key: string; kind: "storage_remove" }
  | { key: string; kind: "storage_write"; value: string }
  | { kind: "storage_list" };
