// §395 spec 0074 D17 — `examples/plugins/tree-badges`, the reference file tree decorator: open-task counts as
// blue badges, counted again on `vault:changed` (A), and notes pinned from the file tree's menu (B).
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
import {
  deliverFileNoticeToSandbox,
  watchFileNotices,
} from "../file-decorations/file-notice-delivery";
import {
  notifyDeleted,
  notifyRenamed,
} from "../file-decorations/operation-notices";
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
/** Unsubscribers and sessions `start` opened. */
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  __resetDecorationHost();
});

describe("baram-tree-badges — the reference file tree decorator (§395)", () => {
  it("is a valid sandboxed manifest holding exactly what its code uses", () => {
    const result = validateManifest(manifest);
    expect(
      result.valid ? [] : result.errors.map((e) => `${e.field}: ${e.message}`),
    ).toEqual([]);
    expect(pluginTrustOf(manifest)).toBe("sandboxed");
    // `filetree` decorates and draws the menu; `files:readonly` opens `ctx.index`, `vault:changed` and the file
    // notices; `storage` keeps the pins. No `commands`: the sandboxed tier registers declared commands without
    // it — `registerEntryContributions` reads it for a trusted plugin only (spec 0074 D17, pre-flight F9).
    expect([...manifest.capabilities].sort()).toEqual([
      "files:readonly",
      "filetree",
      "storage",
    ]);
    expect(manifest.contributions?.fileMenu).toEqual([
      { command: "pin", id: "pin", title: "Pin", when: "file" },
      { command: "unpin", id: "unpin", title: "Unpin", when: "file" },
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

  /** What fails this: no badge on `activate`, a count above nine not reading "9+",
   *  no recount on `vault:changed`, or a note whose tasks all closed keeping its badge. */
  it("badges open-task counts, counts again on vault:changed, and clears a note left without any", async () => {
    let rows: { path: string }[] = [
      ...Array.from({ length: 2 }, () => ({ path: "notes/a.md" })),
      ...Array.from({ length: 12 }, () => ({ path: "notes/b.md" })),
    ];
    const broker = async (op: PluginOp) => {
      if (op.kind === "source_read") return "// module injected directly";
      if (op.kind === "index_tasks") return JSON.stringify(rows);
      if (op.kind === "storage_read") return null;
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

  /** Starts the plugin against `rows` over `store` (its `ctx.storage`), hearing Baram's renames and deletions as
   *  `wireSandboxContributions` wires them. `hold` may hand an `index_tasks` read a promise to wait on, `holdWrite` a `storage_write`; `rejectSet`
   *  names the `setFileDecorations` calls (counted from 1) the host refuses; `settled(n)` waits until the host has
   *  taken `n` of them and applied every one it took. */
  async function start(
    rows: () => { path: string }[],
    options: {
      hold?: () => Promise<void> | undefined;
      holdWrite?: () => Promise<void> | undefined;
      rejectSet?: number[];
      store?: Map<string, string>;
    } = {},
  ) {
    const ops: PluginOp[] = [];
    const store = options.store ?? new Map<string, string>();
    const broker = async (op: PluginOp) => {
      ops.push(op);
      if (op.kind === "source_read") return "// module injected directly";
      if (op.kind === "index_tasks") {
        await options.hold?.(); // a read the test holds open
        return JSON.stringify(rows());
      }
      if (op.kind === "storage_read") return store.get(op.key) ?? null;
      if (op.kind === "storage_write") {
        await options.holdWrite?.(); // a write the test holds open
        store.set(op.key, op.value);
        return null;
      }
      throw new Error(`unexpected op ${op.kind}`);
    };
    const mod = (await import(
      pathToFileURL(resolve(DIR, manifest.main)).href
    )) as {
      activate: (ctx: SandboxContext) => Promise<void>;
    };
    const { host, sandbox } = createChannelPair();
    startSandboxClient(sandbox, async () => mod, broker);
    const inner = createHostRequestHandler({
      capabilities: manifest.capabilities,
      declaredSettings: [],
      declaredStatusBarIds: [],
      pluginId: manifest.id,
      pluginName: manifest.name,
    });
    let sets = 0;
    const applied: Promise<unknown>[] = [];
    const session = new SandboxSession(host, (request, onToken) => {
      if (request.kind !== "filetree_set_decorations")
        return inner(request, onToken);
      sets += 1;
      if (options.rejectSet?.includes(sets))
        return Promise.reject(new Error("injected host refusal"));
      const result = inner(request, onToken);
      applied.push(result);
      return result;
    });
    await session.activate(manifest.id, manifest.contributions ?? {});
    const unwatch = watchFileNotices({
      capabilities: manifest.capabilities,
      deliver: (notice) =>
        deliverFileNoticeToSandbox(
          (event, args) => session.deliverEvent(event, args),
          notice,
        ),
      label: "Sandbox",
      pluginId: manifest.id,
    });
    stops.push(unwatch, () => session.dispose());
    const settled = async (count: number): Promise<void> => {
      await vi.waitFor(() => expect(sets).toBe(count), { timeout: 2_000 });
      await Promise.allSettled(applied);
    };
    return { ops, session, settled, store };
  }
  const pins = (store: Map<string, string>) =>
    JSON.parse(store.get("pins") ?? "null") as unknown;
  const note = (path: string, isDir = false) => ({
    context: "ctx-1",
    isDir,
    path,
  });
  const PIN_ICON = { color: "var(--color-status-info)", glyph: "📌" };
  const merged = () => useFileDecorationStore.getState().merged;

  /** What fails this (I1): a recount that sends only what changed leaves the tree without the badges of
   *  a refused call for good. */
  it("repairs a refused call on the next count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rows = [{ path: "notes/a.md" }, { path: "notes/b.md" }];
    const { session } = await start(() => rows, { rejectSet: [1] });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 2_000 });
    expect(merged().size).toBe(0);
    session.deliverEvent("vault:changed", [{ context: "ctx-1" }]);
    await vi.waitFor(
      () => {
        expect(merged().get("/v/notes/a.md")?.badges[0]?.text).toBe("1");
        expect(merged().get("/v/notes/b.md")?.badges[0]?.text).toBe("1");
      },
      { timeout: 2_000 },
    );
    warn.mockRestore();
    session.dispose();
  });

  /** What fails this (I1): narrowing the sent set before the call resolved — a `null` that was refused
   *  would never be sent again. */
  it("sends the clearing null again when its call was refused", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let rows = [{ path: "notes/a.md" }, { path: "notes/b.md" }];
    // The second call — the one that carries a's `null` — is refused; the third must carry it again.
    const { session } = await start(() => rows, { rejectSet: [2] });
    await vi.waitFor(() => expect(merged().size).toBe(2), { timeout: 2_000 });
    rows = [{ path: "notes/b.md" }];
    session.deliverEvent("vault:changed", [{ context: "ctx-1" }]);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 2_000 });
    expect(merged().has("/v/notes/a.md")).toBe(true);
    session.deliverEvent("vault:changed", [{ context: "ctx-1" }]);
    await vi.waitFor(() => expect(merged().has("/v/notes/a.md")).toBe(false), {
      timeout: 2_000,
    });
    warn.mockRestore();
    session.dispose();
  });

  /** What fails this (I2): a `\` in a note's name refuses the whole call it travels in. */
  it("skips a note whose name holds a backslash and badges the rest", async () => {
    const rows = [
      { path: "notes/a.md" },
      { path: "notes/we\\ird.md" },
      { path: "notes/b.md" },
    ];
    const { session } = await start(() => rows);
    await vi.waitFor(
      () => {
        expect(merged().get("/v/notes/a.md")?.badges[0]?.text).toBe("1");
        expect(merged().get("/v/notes/b.md")?.badges[0]?.text).toBe("1");
      },
      { timeout: 2_000 },
    );
    session.dispose();
  });

  /** What fails this (M2): the cap off by one, a plural "1 open tasks", or a count that asks for more than
   *  the open tasks. */
  it("reads 9 as 9 and 10 as 9+, says '1 open task', and asks for the default (open) tasks", async () => {
    const rows = [
      ...Array.from({ length: 9 }, () => ({ path: "nine.md" })),
      ...Array.from({ length: 10 }, () => ({ path: "ten.md" })),
      { path: "one.md" },
    ];
    const { ops, session } = await start(() => rows);
    await vi.waitFor(() => expect(merged().size).toBe(3), { timeout: 2_000 });
    expect(merged().get("/v/nine.md")?.badges[0]?.text).toBe("9");
    expect(merged().get("/v/ten.md")?.badges[0]?.text).toBe("9+");
    expect(merged().get("/v/one.md")?.title).toBe("Tree Badges: 1 open task");
    const read = ops.find((op) => op.kind === "index_tasks");
    expect(read).toBeDefined();
    expect((read as { status?: unknown }).status).toBeUndefined();
    session.dispose();
  });

  /** What fails this: pins that do not follow `file:rename` — the next count sends the pin to the old path,
   *  where no row is, and the renamed note loses it (R19: counts first, pins after). */
  it("pins a note from the menu with its count kept, and the pin follows a rename", async () => {
    let rows = [{ path: "notes/a.md" }, { path: "notes/a.md" }];
    const { session, settled, store } = await start(() => rows);
    await settled(1);
    await session.invokeCommand("pin", [[note("notes/a.md")]]);
    await settled(3); // Pin's own count: the count, then the pins
    const label = "Tree Badges: Pinned · 2 open tasks";
    const pinned = {
      badges: [{ color: "var(--color-status-info)", label, text: "2" }],
      icon: PIN_ICON,
      title: label,
    };
    expect(merged().get("/v/notes/a.md")).toEqual(pinned);
    expect(pins(store)).toEqual([{ context: "ctx-1", path: "notes/a.md" }]);
    notifyRenamed("/v/notes/a.md", "/v/notes/z.md", false);
    await vi.waitFor(() =>
      expect(pins(store)).toEqual([{ context: "ctx-1", path: "notes/z.md" }]),
    );
    rows = [{ path: "notes/z.md" }, { path: "notes/z.md" }];
    session.deliverEvent("vault:changed", [{ context: "ctx-1" }]);
    await settled(5);
    expect(merged().get("/v/notes/z.md")).toEqual(pinned);
    expect(merged().has("/v/notes/a.md")).toBe(false);
  });

  /** What fails this (review r1 I1): a count still reading when a newer one started that sends anyway — the `runs`
   *  stop removed: the held count's calls land after the Pin's count, five in all, not three. (Taking `pins` before
   *  the reads does not fail this row — Pin's own count moves `runs`; the next row pins that order.) */
  it("keeps a pin made while a count is reading", async () => {
    let hold: Promise<void> | undefined;
    let release = (): void => undefined;
    const take = () => {
      const held = hold;
      hold = undefined; // one read only
      return held;
    };
    const { session, settled } = await start(() => [{ path: "notes/a.md" }], {
      hold: take,
    });
    await settled(1);
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.deliverEvent("vault:changed", [{ context: "ctx-1" }]);
    await vi.waitFor(() => expect(hold).toBeUndefined()); // that count's first read now waits
    await session.invokeCommand("pin", [[note("notes/a.md")]]);
    release();
    // The plan's one timer (Global Constraints, pre-flight F4). What is left of the held count is microtask-only —
    // `createChannelPair` sends with `Promise.resolve().then` and the broker is a plain async function — and the
    // plugin exposes no end of a count to await, so one macrotask runs after all of it and lets it send, if it would.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settled(3);
    expect(merged().get("/v/notes/a.md")?.icon).toEqual(PIN_ICON);
  });

  /** What fails this (R19, pre-flight F5): a count that takes `pins` before its reads. An Unpin heard while that
   *  count's read is held does not move `runs`, so the count still sends — and with `pins` taken first it draws 📌
   *  again (five calls, not four). */
  it("drops a pin unpinned while a count is reading", async () => {
    let hold: Promise<void> | undefined;
    let release = (): void => undefined;
    const take = () => {
      const held = hold;
      hold = undefined; // one read only
      return held;
    };
    const store = new Map([
      ["pins", JSON.stringify([{ context: "ctx-1", path: "notes/a.md" }])],
    ]);
    const { session, settled } = await start(() => [{ path: "notes/a.md" }], {
      hold: take,
      store,
    });
    await settled(2); // the first count, then the stored pin
    expect(merged().get("/v/notes/a.md")?.icon).toEqual(PIN_ICON);
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.deliverEvent("vault:changed", [{ context: "ctx-1" }]);
    await vi.waitFor(() => expect(hold).toBeUndefined()); // that count's first read now waits
    await session.invokeCommand("unpin", [[note("notes/a.md")]]);
    await settled(3); // Unpin's own call: the count, no pin
    release();
    await settled(4); // the held count: the counts, and no pin call
    expect(merged().get("/v/notes/a.md")?.icon).toBeUndefined();
    expect(merged().get("/v/notes/a.md")?.badges[0]?.text).toBe("1");
    expect(pins(store)).toEqual([]);
  });

  /** What fails this: an Unpin that leaves the icon or drops the count; a folder rename or delete that matches
   *  only the exact path, not what the folder held. */
  it("unpins with the count kept, and follows a folder's rename and deletion", async () => {
    const { session, settled, store } = await start(() => [
      { path: "notes/a.md" },
      { path: "docs/b.md" },
    ]);
    await settled(1);
    await session.invokeCommand("pin", [
      [note("notes/a.md"), note("docs/b.md")],
    ]);
    await session.invokeCommand("unpin", [[note("notes/a.md")]]);
    await settled(4);
    expect(merged().get("/v/notes/a.md")?.icon).toBeUndefined();
    expect(merged().get("/v/notes/a.md")?.badges[0]?.text).toBe("1");
    expect(merged().get("/v/docs/b.md")?.icon).toEqual(PIN_ICON);
    notifyRenamed("/v/docs", "/v/papers", true);
    await vi.waitFor(() =>
      expect(pins(store)).toEqual([{ context: "ctx-1", path: "papers/b.md" }]),
    );
    notifyDeleted("/v/papers", true);
    await vi.waitFor(() => expect(pins(store)).toEqual([]));
  });

  /** What fails this: pins kept in memory only, or not sent again on `activate` (Baram keeps no decoration). */
  it("shows the stored pins again when it starts again", async () => {
    const store = new Map<string, string>();
    const first = await start(() => [], { store });
    await first.session.invokeCommand("pin", [[note("notes/a.md")]]);
    await first.settled(1);
    first.session.dispose();
    __resetDecorationHost();
    expect(merged().size).toBe(0);
    const second = await start(() => [], { store });
    await second.settled(1);
    expect(merged().get("/v/notes/a.md")).toEqual({
      badges: [],
      icon: { glyph: "📌" },
      title: "Tree Badges: Pinned",
    });
  });

  /** What fails this: one call for every vault's pins — the unknown vault refuses it whole (spec D7, R18). */
  it("keeps a removed vault's pin, refused alone, while the others show", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stored = [
      { context: "ctx-gone", path: "x.md" },
      { context: "ctx-1", path: "notes/a.md" },
    ];
    const { settled, store } = await start(() => [], {
      store: new Map([["pins", JSON.stringify(stored)]]),
    });
    await settled(2);
    expect(merged().get("/v/notes/a.md")?.icon).toEqual({ glyph: "📌" });
    expect(warn).toHaveBeenCalledWith(
      "[tree-badges] a pin call was refused",
      expect.anything(),
    );
    expect(pins(store)).toEqual(stored);
    warn.mockRestore();
  });

  /** What fails this: a handler that trusts its argument — a folder, the palette's nothing, junk, or a path
   *  with a "\", a ".." or empty name, a leading or trailing "/", or over 4,096 units would be pinned — and the
   *  host refuses the whole call such a path travels in. */
  it("pins nothing for a folder, no argument, a malformed one or a path the host would refuse", async () => {
    const { session, settled, store } = await start(() => []);
    for (const args of [
      [[note("docs", true)]],
      [],
      [["junk"]],
      [[note("a\\b.md")]],
      [[note("../x.md")]],
      [[note("a//b.md")]],
      [[note("/a.md")]],
      [[note("a.md/")]],
      [[note(`${"a".repeat(4096)}.md`)]],
    ]) {
      await session.invokeCommand("pin", args);
    }
    await settled(0);
    expect(store.has("pins")).toBe(false);
  });

  /** What fails this: pin writes that are not chained. Pin of `a` starts its write and the host holds it; a rename
   *  of `a` writes the moved list meanwhile; the held write then lands last and storage keeps the old path. */
  it("keeps the last pin list when an earlier write finishes later", async () => {
    let hold: Promise<void> | undefined;
    let release = (): void => undefined;
    const take = () => {
      const held = hold;
      hold = undefined; // one write only
      return held;
    };
    const { session, store } = await start(() => [], { holdWrite: take });
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pinning = session.invokeCommand("pin", [[note("notes/a.md")]]);
    await vi.waitFor(() => expect(hold).toBeUndefined()); // that write now waits
    notifyRenamed("/v/notes/a.md", "/v/notes/z.md", false);
    // A command that does nothing: its answer comes back after the rename has been handled (frames are handled in
    // the order sent), so an unchained rename write has reached the broker by now.
    await session.invokeCommand("pin", []);
    release();
    await pinning;
    await vi.waitFor(() =>
      expect(pins(store)).toEqual([{ context: "ctx-1", path: "notes/z.md" }]),
    );
    // `await pinning` returns only once Pin's own write — the held one — has landed, so the list read above is
    // the one left after it; with unchained writes that is `[a]`.
  });

  /** What fails this: a stored pin the host refuses (`../x.md`) sent beside a good one — the whole vault's call
   *  is refused and the good pin is not shown. Its positive pair: the good pin is drawn. */
  it("sends only the stored pins the host would take", async () => {
    const stored = [
      { context: "ctx-1", path: "../x.md" },
      { context: "ctx-1", path: "notes/a.md" },
    ];
    const { settled } = await start(() => [], {
      store: new Map([["pins", JSON.stringify(stored)]]),
    });
    await settled(1);
    expect(merged().get("/v/notes/a.md")?.icon).toEqual({ glyph: "📌" });
    expect(merged().size).toBe(1);
  });

  /** What fails this: a pin path check stricter than the host's. An external file's own context is the file, and the
   *  menu hands it as `path: ""`, which the host takes; a Pin that drops it does nothing and says nothing. */
  it("pins an external file whose context is the file itself", async () => {
    useContextStore.setState({
      activeContextId: "ctx-1",
      contexts: [
        { contextType: "vault", id: "ctx-1", path: "/v" },
        { contextType: "file", id: "ctx-file", path: "/ext/f.md" },
      ] as never,
    });
    const { session, settled, store } = await start(() => []);
    await session.invokeCommand("pin", [
      [{ context: "ctx-file", isDir: false, path: "" }],
    ]);
    await settled(1);
    expect(merged().get("/ext/f.md")?.icon).toEqual({ glyph: "📌" });
    expect(pins(store)).toEqual([{ context: "ctx-file", path: "" }]);
  });
});
