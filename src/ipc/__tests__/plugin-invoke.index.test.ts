import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

import { pluginIndexRead } from "../plugin-invoke";

// §393 — the one place the trusted tier's command name and argument keys are executed. Tauri
// binds `context` and `read` by name (`plugin_index_cmd.rs`), and `invoke` takes a
// `Record<string, unknown>`, so a typo here typechecks and `extension-context.index.test.ts`
// (which mocks this module whole) still passes while every trusted `ctx.index` read fails.
// What fails this: renaming the command string, or reshaping the args (a key other than
// `context` / `read`, or `read` nested under another key).
describe("pluginIndexRead", () => {
  it("sends plugin_index_read with { context, read } for a read that names a context", async () => {
    invoke.mockResolvedValueOnce([{ count: 1, tag: "a" }]);
    const read = { read: "tags" } as const;
    await expect(pluginIndexRead("ctx-7", read)).resolves.toStrictEqual([
      { count: 1, tag: "a" },
    ]);
    expect(invoke).toHaveBeenLastCalledWith("plugin_index_read", {
      context: "ctx-7",
      read,
    });
  });

  it("sends the same two keys for a read with no context", async () => {
    invoke.mockResolvedValueOnce([]);
    const read = { path: "/v/a.md", read: "backlinks" } as const;
    await pluginIndexRead(undefined, read);
    expect(invoke).toHaveBeenLastCalledWith("plugin_index_read", {
      context: undefined,
      read,
    });
    expect(
      Object.keys(invoke.mock.lastCall?.[1] as object).sort(),
    ).toStrictEqual(["context", "read"]);
  });
});
