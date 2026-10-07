// §69 issue 795 — the write_file command now answers the written file's mtime. The
// plugin API's `files.writeFile` is a public `Promise<void>` (types.ts), so that value
// must not reach a plugin.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  writeFile: vi.fn(async () => 1_700_000_000_123),
}));

import type { PluginManifest } from "../types";

import { writeFile } from "../../ipc/invoke";
import { createExtensionContext } from "../extension-context";

function manifest(): PluginManifest {
  return {
    author: "Test",
    capabilities: ["files"] as PluginManifest["capabilities"],
    description: "A test plugin",
    engines: { baram: ">=0.2.0" },
    id: "test-plugin",
    license: "MIT",
    main: "index.mjs",
    name: "Test Plugin",
    trust: "trusted",
    version: "1.0.0",
  };
}

describe("files.writeFile keeps the plugin API's void result", () => {
  // 이것을 실패시키는 것: extension-context.ts 가 `return writeFile(path, content)` 로 값을 넘긴다.
  it("resolves to undefined although the command answers an mtime", async () => {
    const ctx = createExtensionContext(manifest(), "/p");
    await expect(ctx.files.writeFile("/v/a.md", "x")).resolves.toBeUndefined();
    expect(writeFile).toHaveBeenCalledWith("/v/a.md", "x");
  });
});
