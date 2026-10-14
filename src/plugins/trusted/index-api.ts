// §393 `ctx.index` for the trusted tier (spec 0072 §5.3). Each read goes to the host-only
// `plugin_index_read` command, which runs the Rust reads the sandboxed broker ops run, so the two
// tiers' rows cannot drift. Paths are absolute, as in this tier's `FilesAPI`.
import type {
  IndexAPI,
  IndexBacklink,
  IndexLink,
  IndexSearchOptions,
  IndexSearchResult,
  IndexTag,
  IndexTask,
} from "../types";

import { pluginIndexRead } from "../../ipc/plugin-invoke";

export function createIndexAPI(): IndexAPI {
  return {
    backlinks: (path, opts) =>
      pluginIndexRead<IndexBacklink[]>(opts?.context, {
        path,
        read: "backlinks",
      }),
    links: (path, opts) =>
      pluginIndexRead<IndexLink[]>(opts?.context, { path, read: "links" }),
    notesWithTag: (tag, opts) =>
      pluginIndexRead<string[]>(opts?.context, { read: "notesWithTag", tag }),
    search: (query, opts) => {
      const { context, ...options }: IndexSearchOptions = opts ?? {};
      return pluginIndexRead<IndexSearchResult>(context, {
        options,
        query,
        read: "search",
      });
    },
    tags: (opts) =>
      pluginIndexRead<IndexTag[]>(opts?.context, { read: "tags" }),
    tasks: (opts) =>
      pluginIndexRead<IndexTask[]>(opts?.context, {
        file: opts?.file,
        read: "tasks",
        status: opts?.status,
      }),
  };
}
