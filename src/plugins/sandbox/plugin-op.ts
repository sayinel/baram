// §260 — TS mirror of the Rust `PluginOp` (authorizer.rs). Internally tagged on
// `kind`, snake_case, so it serializes to exactly what the broker deserializes.
// 3c-1 covers storage + network; files/ai variants are added in Phase 3c-2.
import type { PluginFetchInit } from "../types";

export type PluginOp =
  | { init?: PluginFetchInit; kind: "http_fetch"; url: string }
  // §260 3c-2b — this sandbox's OWN bundle. No path field exists by design: Rust
  // resolves the caller's directory from its window label, so the op cannot be
  // pointed at another plugin's file or anywhere else on disk.
  | { key: string; kind: "storage_read" }
  | { key: string; kind: "storage_remove" }
  | { key: string; kind: "storage_write"; value: string }
  | { kind: "source_read" }
  | { kind: "storage_list" };
