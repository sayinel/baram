// §393 `ctx.index` for the sandboxed tier (spec 0072 §5.2): six broker ops, answered by Rust as
// JSON strings (`BrokerResult::encoded`) and parsed by the client's `brokerJson`. Nothing is
// decided here — the grant (`files` or `files:readonly`), the context, the path gate and every
// refusal are Rust's, and a refusal reaches the plugin as the broker's own error.
import type {
  IndexAPI,
  IndexBacklink,
  IndexLink,
  IndexSearchOptions,
  IndexSearchResult,
  IndexTag,
  IndexTask,
} from "../types";
import type { PluginOp } from "./plugin-op";

export function createSandboxIndexAPI(
  brokerJson: <T>(op: PluginOp) => Promise<T>,
): IndexAPI {
  return {
    backlinks: (path, opts) =>
      brokerJson<IndexBacklink[]>({
        context: opts?.context,
        kind: "index_backlinks",
        path,
      }),
    links: (path, opts) =>
      brokerJson<IndexLink[]>({
        context: opts?.context,
        kind: "index_links",
        path,
      }),
    notesWithTag: (tag, opts) =>
      brokerJson<string[]>({
        context: opts?.context,
        kind: "index_tag_notes",
        tag,
      }),
    search: (query, opts) => {
      const { context, ...options }: IndexSearchOptions = opts ?? {};
      return brokerJson<IndexSearchResult>({
        context,
        kind: "index_search",
        options,
        query,
      });
    },
    tags: (opts) =>
      brokerJson<IndexTag[]>({ context: opts?.context, kind: "index_tags" }),
    tasks: (opts) =>
      brokerJson<IndexTask[]>({
        context: opts?.context,
        file: opts?.file,
        kind: "index_tasks",
        status: opts?.status,
      }),
  };
}
