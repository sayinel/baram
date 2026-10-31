// §395 spec 0074 D17 (A) — `examples/plugins/tree-badges`, the reference file tree decorator: open-task
// counts as blue badges, counted again on `vault:changed`, removed when a note's last open task closes.
// Pins what an author copies: the manifest, a `dist/` rebuilt from its source, and the behaviour through
// the real client, session, host bridge and store.
import type { PluginOp } from "../sandbox/plugin-op";
import type { PluginManifest, SandboxContext } from "../types";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useContextStore } from "../../stores/context/context";
import { __resetDecorationHost } from "../file-decorations/decoration-host";
import { useFileDecorationStore } from "../file-decorations/file-decoration-store";
import { validateManifest } from "../manifest";
import { pluginTrustOf } from "../plugin-trust";
import { createChannelPair } from "../sandbox/__tests__/channel-pair";
import { createHostRequestHandler } from "../sandbox/host-request-router";
import { startSandboxClient } from "../sandbox/sandbox-client";
import { SandboxSession } from "../sandbox/sandbox-session";

const DIR = resolve(__dirname, "../../../examples/plugins/tree-badges");
const manifest = JSON.parse(
  readFileSync(resolve(DIR, "baram-plugin.json"), "utf8"),
) as PluginManifest;
const built = readFileSync(resolve(DIR, manifest.main), "utf8");

beforeEach(() => {
  useContextStore.setState({
    activeContextId: "ctx-1",
    contexts: [{ contextType: "vault", id: "ctx-1", path: "/v" }] as never,
  });
});
afterEach(() => {
  __resetDecorationHost();
});

describe("baram-tree-badges — the reference file tree decorator (§395)", () => {
  it("is a valid sandboxed manifest holding exactly what its code uses", () => {
    const result = validateManifest(manifest);
    expect(
      result.valid ? [] : result.errors.map((e) => `${e.field}: ${e.message}`),
    ).toEqual([]);
    expect(pluginTrustOf(manifest)).toBe("sandboxed");
    // `filetree` decorates; `files:readonly` opens `ctx.index` and `vault:changed`.
    expect([...manifest.capabilities].sort()).toEqual([
      "files:readonly",
      "filetree",
    ]);
  });

  it("ships a dist/ that was rebuilt from the current source", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(DIR, "package.json"), "utf8"),
    ) as { scripts: { build: string } };
    const args = pkg.scripts.build.trim().split(/\s+/);
    expect(args[0]).toBe("esbuild");
    const out = join(mkdtempSync(join(tmpdir(), "baram-tb-")), "index.mjs");
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

  /** What fails this: no badge on `activate`, a count of more than two characters (12 must read "9+"),
   *  no recount on `vault:changed`, or a note whose tasks all closed keeping its badge. */
  it("badges open-task counts, counts again on vault:changed, and clears a note left without any", async () => {
    let rows: { path: string }[] = [
      ...Array.from({ length: 2 }, () => ({ path: "notes/a.md" })),
      ...Array.from({ length: 12 }, () => ({ path: "notes/b.md" })),
    ];
    const broker = async (op: PluginOp) => {
      if (op.kind === "source_read") return "// module injected directly";
      if (op.kind === "index_tasks") return JSON.stringify(rows);
      throw new Error(`unexpected op ${op.kind}`);
    };
    const mod = (await import(
      pathToFileURL(resolve(DIR, manifest.main)).href
    )) as { activate: (ctx: SandboxContext) => void };
    const { host, sandbox } = createChannelPair();
    startSandboxClient(sandbox, async () => mod, broker);
    const session = new SandboxSession(
      host,
      createHostRequestHandler({
        capabilities: manifest.capabilities,
        declaredSettings: [],
        declaredStatusBarIds: [],
        pluginId: manifest.id,
        pluginName: manifest.name,
      }),
    );
    await session.activate(manifest.id, manifest.contributions ?? {});
    const merged = () => useFileDecorationStore.getState().merged;
    await vi.waitFor(
      () => expect(merged().get("/v/notes/b.md")?.badges[0]?.text).toBe("9+"),
      { timeout: 2_000 },
    );
    expect(merged().get("/v/notes/a.md")).toEqual({
      badges: [
        {
          color: "var(--color-status-info)",
          label: "Tree Badges: 2 open tasks",
          text: "2",
        },
      ],
      title: "Tree Badges: 2 open tasks",
    });
    rows = Array.from({ length: 3 }, () => ({ path: "notes/b.md" }));
    session.deliverEvent("vault:changed", [{ context: "ctx-1" }]);
    await vi.waitFor(() => expect(merged().has("/v/notes/a.md")).toBe(false), {
      timeout: 2_000,
    });
    expect(merged().get("/v/notes/b.md")?.badges[0]?.text).toBe("3");
    session.dispose();
  });
});
