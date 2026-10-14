// §393 — `examples/plugins/link-count`, the reference reader of `ctx.index` (spec 0072 §9).
//
// An example is what an author copies, so this pins what it teaches: the manifest a sandboxed
// index reader needs, a `dist/` rebuilt from its source, and the behaviour — read on `file:open`,
// read again on `vault:changed` for the same context only, clear the item on a tab that is not a
// note — run through the real sandbox client and session with a broker that answers.
import type { PluginOp } from "../sandbox/plugin-op";
import type { PluginManifest, SandboxContext } from "../types";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { validateManifest } from "../manifest";
import { pluginTrustOf } from "../plugin-trust";
import { createChannelPair } from "../sandbox/__tests__/channel-pair";
import { createHostRequestHandler } from "../sandbox/host-request-router";
import { startSandboxClient } from "../sandbox/sandbox-client";
import { SandboxSession } from "../sandbox/sandbox-session";

const DIR = resolve(__dirname, "../../../examples/plugins/link-count");
const manifest = JSON.parse(
  readFileSync(resolve(DIR, "baram-plugin.json"), "utf8"),
) as PluginManifest;
const built = readFileSync(resolve(DIR, manifest.main), "utf8");

const TASK = {
  cancelled: null,
  created: null,
  done: null,
  due: null,
  line: 3,
  links: [],
  path: "notes/a.md",
  priority: 0,
  recurrence: null,
  scheduled: null,
  start: null,
  state: "todo",
  tags: [],
  text: "t",
};

describe("baram-link-count — the reference reader of ctx.index (§393)", () => {
  it("is a valid sandboxed manifest holding exactly the capabilities its code uses", () => {
    const result = validateManifest(manifest);
    expect(
      result.valid ? [] : result.errors.map((e) => `${e.field}: ${e.message}`),
    ).toEqual([]);
    expect(pluginTrustOf(manifest)).toBe("sandboxed");
    // `files:readonly` opens `ctx.index` and `vault:changed`; `events` is for `file:open`.
    expect([...manifest.capabilities].sort()).toEqual([
      "events",
      "files:readonly",
      "statusbar",
    ]);
    expect(
      (manifest.contributions?.statusBar ?? []).map((item) => item.id),
    ).toEqual(["links"]);
  });

  it("ships a dist/ that was rebuilt from the current source", () => {
    // The word-count guard's method (`reference-plugins.test.ts`): rebuild with the example's
    // own build flags into a temp file and compare bytes, running the root esbuild binary with
    // the example as cwd so the embedded `// src/index.ts` comment matches.
    const pkg = JSON.parse(
      readFileSync(resolve(DIR, "package.json"), "utf8"),
    ) as {
      scripts: { build: string };
    };
    const args = pkg.scripts.build.trim().split(/\s+/);
    expect(args[0]).toBe("esbuild");
    const out = join(mkdtempSync(join(tmpdir(), "baram-lc-")), "index.mjs");
    const result = spawnSync(
      resolve(__dirname, "../../../node_modules/esbuild/bin/esbuild"),
      args
        .slice(1)
        .map((a) => (a.startsWith("--outfile=") ? `--outfile=${out}` : a)),
      { cwd: DIR, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    expect(
      readFileSync(out, "utf8"),
      "dist/index.mjs is stale — run the example's build and commit dist/",
    ).toBe(built);
  });

  it("reads on file:open, again on vault:changed for its context only, and clears on a tab that is not a note", async () => {
    const ops: PluginOp[] = [];
    const statusBar: string[] = [];
    let linking = 2;
    const broker = async (op: PluginOp) => {
      ops.push(op);
      if (op.kind === "source_read") return "// module injected directly";
      if (op.kind === "index_backlinks")
        return JSON.stringify(
          Array.from({ length: linking }, (_, i) => ({
            blockId: null,
            line: 1,
            path: `src-${i}.md`,
            snippet: "",
            type: "wikilink",
          })),
        );
      if (op.kind === "index_tasks") return JSON.stringify([TASK]);
      throw new Error(`unexpected op ${op.kind}`);
    };
    const mod = (await import(
      pathToFileURL(resolve(DIR, manifest.main)).href
    )) as {
      activate: (ctx: SandboxContext) => void;
    };
    const { host, sandbox } = createChannelPair();
    startSandboxClient(sandbox, async () => mod, broker);
    const session = new SandboxSession(
      host,
      // Only the status bar is wired: every other host service is optional, and this plugin
      // asks for none (its manifest holds no `editor`, `ai` or `settings`).
      createHostRequestHandler({
        capabilities: manifest.capabilities,
        declaredSettings: [],
        declaredStatusBarIds: ["links"],
        pluginId: manifest.id,
        pluginName: manifest.name,
        setStatusBarText: (_id, text) => void statusBar.push(text),
      }),
    );
    await session.activate(manifest.id, manifest.contributions ?? {});
    const last = () => statusBar[statusBar.length - 1];
    const reads = () =>
      ops.filter((op) => op.kind === "index_backlinks").length;

    session.deliverEvent("file:open", [
      { context: "ctx-1", path: "notes/a.md" },
    ]);
    await vi.waitFor(() => expect(last()).toBe("← 2 · ☐ 1"));
    expect(
      ops
        .filter((op) => op.kind !== "source_read")
        .map((op) => JSON.parse(JSON.stringify(op)) as unknown),
    ).toStrictEqual([
      { context: "ctx-1", kind: "index_backlinks", path: "notes/a.md" },
      { context: "ctx-1", file: "notes/a.md", kind: "index_tasks" },
    ]);

    // Another context's change is not this note's: no read. Then one in this context is.
    // Delivered in that order, so when the second answer shows, a read for the first would
    // already have been counted.
    linking = 3;
    session.deliverEvent("vault:changed", [{ context: "ctx-2" }]);
    session.deliverEvent("vault:changed", [{ context: "ctx-1" }]);
    await vi.waitFor(() => expect(last()).toBe("← 3 · ☐ 1"));
    expect(reads()).toBe(2);

    // A tab that is not a note: the item is cleared and nothing is read.
    session.deliverEvent("file:open", [{ context: "ctx-1", path: "img.png" }]);
    await vi.waitFor(() => expect(last()).toBe(""));
    expect(reads()).toBe(2);
    session.dispose();
  });
});
