// §260 — TS mirror of the Rust `PluginOp` (authorizer.rs). Internally tagged on
// `kind`, snake_case, so it serializes to exactly what the broker deserializes.
// 3c-1 covers storage + network; files/ai variants are added in Phase 3c-2.
import type { PluginFetchInit } from "../types";

export type PluginOp =
  // §260 3c-2c — vault-bounded file ops. The path is the plugin's to name and
  // Rust's to judge: it goes through the same vault rule as `read_file`, minus the
  // app's `.baram` state, capped, and acted on as its canonical form.
  | { content: string; kind: "files_write"; path: string }
  | { init?: PluginFetchInit; kind: "http_fetch"; url: string }
  | { key: string; kind: "storage_read" }
  | { key: string; kind: "storage_remove" }
  | { key: string; kind: "storage_write"; value: string }
  // §260 3c-2b — this sandbox's OWN bundle. No path field exists by design: Rust
  // reads it from the directory the host BOUND at registration, so the op cannot be
  // pointed at another plugin's file or anywhere else on disk. (Comment sits with
  // its variant — union members are lint-sorted alphabetically, which once carried
  // the members away and left this behind.)
  | { kind: "files_list"; path: string }
  | { kind: "files_read"; path: string }
  | { kind: "source_read" }
  | { kind: "storage_list" };
