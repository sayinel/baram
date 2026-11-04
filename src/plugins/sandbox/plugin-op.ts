// §260 — TS mirror of the Rust `PluginOp` (authorizer.rs). Internally tagged on
// `kind`, snake_case, so it serializes to exactly what the broker deserializes.
// Covers storage + network (3c-1), the plugin's own source (3c-2b) and vault files
// (3c-2c). `ai` is deliberately NOT here — it is host-mediated (`SandboxHostRequest`
// in protocol.ts) because its policy is frontend state.
//
// §260 Phase 4a — every `files_*` op's `path` is RELATIVE to a context root this realm
// is never told; Rust refuses an absolute path or a `..` outright
// (`plugin_cmd::vault_relative`), which is what keeps the user's home directory out of
// the sandboxed tier. `context` names which registered context to anchor to (a plugin
// learns ids from delivered events); omitting it means the active one.
//
// ‼️ Per-variant notes live INSIDE the variant's braces: `perfectionist` sorts union
// members alphabetically on every lint run, so a comment written above a member gets
// left behind when the member moves — reattached to whatever sorts into that slot.
// (It happened to the `source_read` note twice.)
import type {
  IndexSearchOptions,
  IndexTaskOptions,
  PluginFetchInit,
} from "../types";

export type PluginOp =
  | {
      // §260 Phase 4b — collect the payload the HOST staged for this sandbox. No handle:
      // Rust resolves the slot from the caller's window label, so a sandbox cannot name
      // whose payload it wants, and the slot is consumed by the read.
      kind: "staged_read";
    }
  | {
      // §393 `ctx.index.backlinks` — `path` is context-relative and meets the files gate in Rust.
      context?: string;
      kind: "index_backlinks";
      path: string;
    }
  | {
      // §393 `ctx.index.links`.
      context?: string;
      kind: "index_links";
      path: string;
    }
  | {
      // §393 `ctx.index.notesWithTag`. A walk.
      context?: string;
      kind: "index_tag_notes";
      tag: string;
    }
  | {
      // §393 `ctx.index.search` — `options.folder` is a path and meets the same gate; the rest
      // are values. A walk: it spends the `Walk` budget.
      context?: string;
      kind: "index_search";
      options: Omit<IndexSearchOptions, "context">;
      query: string;
    }
  | {
      // §393 `ctx.index.tags`. A walk.
      context?: string;
      kind: "index_tags";
    }
  | {
      // §393 `ctx.index.tasks` — `file` is a path and meets the same gate. A walk.
      context?: string;
      file?: string;
      kind: "index_tasks";
      status?: IndexTaskOptions["status"];
    }
  | {
      // §260 3c-2b — this sandbox's OWN bundle. No path field exists by design: Rust
      // reads it from the directory the host BOUND at registration, so the op cannot
      // be pointed at another plugin's file or anywhere else on disk.
      kind: "source_read";
    }
  | {
      // §260 3c-2c — entry NAMES in one directory (not recursive, no metadata).
      // Phase 4a: `path` is context-relative, `""` being the context root.
      context?: string;
      kind: "files_list";
      path: string;
    }
  | {
      // §260 3c-2c — vault-bounded read, admitted by `files` or `files:readonly`.
      context?: string;
      kind: "files_read";
      path: string;
    }
  | {
      // §260 3c-2c — vault-bounded write. Same vault rule as `write_file`, minus the
      // app's `.baram` state, size-capped, and performed on the canonical path.
      content: string;
      context?: string;
      kind: "files_write";
      path: string;
    }
  | { init?: PluginFetchInit; kind: "http_fetch"; url: string }
  | { key: string; kind: "storage_read" }
  | { key: string; kind: "storage_remove" }
  | { key: string; kind: "storage_write"; value: string }
  | { kind: "storage_list" };
