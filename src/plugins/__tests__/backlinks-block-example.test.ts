// §394 spec 0073 §8 — `examples/plugins/backlinks-block`, the reference code block renderer: a
// sandboxed plugin that draws a ```backlinks block as the note's backlinks, each row a `data-note`
// link, and draws again on `vault:changed`. This pins what an author copies: the manifest, a
// `dist/` rebuilt from its source, and the behaviour through the real client, session and queue.
import type { PluginOp } from "../sandbox/plugin-op";
import type { PluginManifest, SandboxContext } from "../types";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { validateManifest } from "../manifest";
import { pluginTrustOf } from "../plugin-trust";
import {
  __resetCodeBlockRegistry,
  codeBlockRendererFor,
} from "../rendered/code-block-registry";
import {
  claimCodeBlocks,
  invalidateDeclared,
  wireSandboxCodeBlocks,
} from "../rendered/code-blocks-api";
import { __resetRenderQueue, requestRender } from "../rendered/render-queue";
import { createChannelPair } from "../sandbox/__tests__/channel-pair";
import { createHostRequestHandler } from "../sandbox/host-request-router";
import { startSandboxClient } from "../sandbox/sandbox-client";
import { SandboxSession } from "../sandbox/sandbox-session";

const DIR = resolve(__dirname, "../../../examples/plugins/backlinks-block");
const manifest = JSON.parse(
  readFileSync(resolve(DIR, "baram-plugin.json"), "utf8"),
) as PluginManifest;
const built = readFileSync(resolve(DIR, manifest.main), "utf8");

afterEach(() => {
  __resetCodeBlockRegistry();
  __resetRenderQueue();
});

describe("baram-backlinks-block — the reference code block renderer (§394)", () => {
  it("is a valid sandboxed manifest holding exactly what its code uses", () => {
    const result = validateManifest(manifest);
    expect(
      result.valid ? [] : result.errors.map((e) => `${e.field}: ${e.message}`),
    ).toEqual([]);
    expect(pluginTrustOf(manifest)).toBe("sandboxed");
    // `codeblocks` draws; `files:readonly` opens `ctx.index` and `vault:changed`.
    expect([...manifest.capabilities].sort()).toEqual([
      "codeblocks",
      "files:readonly",
    ]);
    expect(manifest.contributions?.codeBlocks).toEqual([{ lang: "backlinks" }]);
  });

  it("ships a dist/ that was rebuilt from the current source", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(DIR, "package.json"), "utf8"),
    ) as { scripts: { build: string } };
    const args = pkg.scripts.build.trim().split(/\s+/);
    expect(args[0]).toBe("esbuild");
    const out = join(mkdtempSync(join(tmpdir(), "baram-bb-")), "index.mjs");
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

  /** What fails this: rows that are not `data-note` links, a line's text drawn as markup, an empty
   *  list that is not the fixed line, a list outside its sideways-scrolling box, or no `invalidate`
   *  on `vault:changed` (the second render would hit the cache). */
  it("draws the note's backlinks as note links, says so when there are none, and draws again on vault:changed", async () => {
    let linking = 2;
    const ops: PluginOp[] = [];
    const broker = async (op: PluginOp) => {
      ops.push(op);
      if (op.kind === "source_read") return "// module injected directly";
      if (op.kind === "index_backlinks") {
        return JSON.stringify(
          Array.from({ length: linking }, (_, i) => ({
            blockId: null,
            line: 1,
            path: `notes/src-${i}.md`,
            snippet: `see <b>${i}</b>`,
            type: "wikilink",
          })),
        );
      }
      throw new Error(`unexpected op ${op.kind}`);
    };
    const mod = (await import(
      pathToFileURL(resolve(DIR, manifest.main)).href
    )) as {
      activate: (ctx: SandboxContext) => void;
    };
    const langs = claimCodeBlocks(manifest, "sandboxed");
    const { host, sandbox } = createChannelPair();
    startSandboxClient(sandbox, async () => mod, broker);
    const session: SandboxSession = new SandboxSession(
      host,
      createHostRequestHandler({
        capabilities: manifest.capabilities,
        declaredSettings: [],
        declaredStatusBarIds: [],
        invalidate: (lang) => invalidateDeclared(manifest.id, langs, lang),
        pluginId: manifest.id,
        pluginName: manifest.name,
        renderSource: (id) => session.renderSource(id),
      }),
    );
    await session.activate(manifest.id, manifest.contributions ?? {}, langs);
    wireSandboxCodeBlocks(manifest.id, langs, session, []);
    const binding = codeBlockRendererFor("backlinks")!;
    const info = { context: "ctx-1", lang: "backlinks", path: "notes/a.md" };
    const html = async () => {
      const outcome = await requestRender(
        codeBlockRendererFor("backlinks")!,
        "",
        info,
      );
      if (outcome.kind !== "drawn") return `(${outcome.kind})`;
      const div = document.createElement("div");
      div.append(outcome.content.fragment.cloneNode(true));
      return div.innerHTML;
    };
    const first = await html();
    expect(first).toContain('data-note="notes/src-0.md"');
    // The line's text stays text. A tag, because the HTML parser reads `<` before a digit as text:
    // `see <0>` came out `&lt;0&gt;` with the escape removed too.
    expect(first).toContain("see &lt;b&gt;0&lt;/b&gt;");
    // The host clips what is wider than the block (`.plugin-block-host`), so the list sits in a box
    // of its own that scrolls sideways — what an author copies for wide output.
    expect(first).toMatch(/^<div class="rows"><ul>/);
    const again = await requestRender(binding, "", info);
    expect(again.kind === "drawn" ? again.content.css : again.kind).toContain(
      ".rows{overflow-x:auto}",
    );
    // One read for both requests: the second came from the cache.
    expect(ops.filter((op) => op.kind === "index_backlinks")).toEqual([
      { context: "ctx-1", kind: "index_backlinks", path: "notes/a.md" },
    ]);
    linking = 0;
    session.deliverEvent("vault:changed", [{ context: "ctx-1" }]);
    await vi.waitFor(
      async () => expect(await html()).toContain("No backlinks"),
      { timeout: 2_000 },
    );
    expect(binding.pluginId).toBe(manifest.id);
    session.dispose();
  });
});
