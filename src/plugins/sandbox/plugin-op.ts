// §260 — TS mirror of the Rust `PluginOp` (authorizer.rs). Internally tagged on
// `kind`, snake_case, so it serializes to exactly what the broker deserializes.
// 3c-1 covers storage + network; files/ai variants are added in Phase 3c-2.
import type { PluginFetchInit } from "../types";

export type PluginOp =
  | { init?: PluginFetchInit; kind: "http_fetch"; url: string; }
  | { key: string; kind: "storage_read"; }
  | { key: string; kind: "storage_remove"; }
  | { key: string; kind: "storage_write"; value: string }
  | { kind: "storage_list" };
