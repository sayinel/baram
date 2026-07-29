import type { PluginOp } from "../sandbox/plugin-op";
// §260 Phase 6 — #260's last completion criterion: "a malicious plugin fixture verifies the
// deny paths in CI."
//
// WHAT THIS HALF PROVES, AND WHAT IT DOES NOT. A sandboxed plugin's capabilities are enforced
// in two different places, and the split is architectural, not a testing compromise:
// `sandbox-client.ts` exposes the brokered members (`storage`, `network`, `files`)
// unconditionally ON PURPOSE, because the Rust authorizer keyed on the Tauri-verified
// `window.label()` is the real gate. So:
//
//   • HOST-MEDIATED attacks (`ai`, `editor`, `settings`, `ui`) are refused by real TS code
//     here — `capability-gate.ts` — and this suite asserts the refusal AND its wording.
//   • BROKERED attacks are refused in Rust. This suite asserts REACHABILITY and PROPAGATION
//     (the op left the sandbox, carried no forgeable identity, and its refusal reached plugin
//     code un-softened); `authorizer.rs`'s adversary sweep asserts the DECISION.
//
// The broker below is a recorder that denies. It is NOT pretending to be the authorizer, and
// it must not grow into one: a second capability model in TS is a second thing to drift.
import type { PluginManifest, SandboxContext } from "../types";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { validateManifest } from "../manifest";
import { pluginTrustOf } from "../plugin-trust";
import { createChannelPair } from "../sandbox/__tests__/channel-pair";
import { createHostRequestHandler } from "../sandbox/host-request-router";
import { startSandboxClient } from "../sandbox/sandbox-client";
import { SandboxSession } from "../sandbox/sandbox-session";

const DIR = resolve(__dirname, "../../../examples/plugins/malicious-fixture");
const manifest = JSON.parse(
  readFileSync(resolve(DIR, "baram-plugin.json"), "utf8"),
) as PluginManifest;

/** Every attack the fixture makes, in the order it makes them. */
const EXPECTED_ATTACKS = [
  "storage_write",
  "storage_read",
  "storage_list",
  "storage_remove",
  "storage_read_crossplugin",
  "http_fetch",
  "files_list",
  "files_read",
  "files_write",
  "files_read_absolute",
  "files_read_traversal",
  "files_read_app_state",
  "ai_complete",
  "ai_stream",
  "ai_list_models",
  "editor_get_markdown",
  "editor_get_selection",
  "editor_set_markdown",
  "editor_insert_text",
  "settings_get_all",
] as const;

/**
 * Every `PluginOp` variant, classified. Keyed on the discriminant, so **adding a variant
 * fails typecheck** until someone decides whether the adversary attacks it — chosen over a
 * source scan because four guards in Phase 5 were hollow from scanning for *a* match rather
 * than *the* match. `authorizer.rs` has the same device as a wildcard-free `match`.
 */
const OP_COVERAGE: Record<PluginOp["kind"], "attacked" | { exempt: string }> = {
  files_list: "attacked",
  files_read: "attacked",
  files_write: "attacked",
  http_fetch: "attacked",
  source_read: {
    exempt:
      "needs no grant — reading one's own bundle is how the sandbox boots, and the op names no file",
  },
  staged_read: {
    exempt:
      "reachable only AFTER a host-mediated read was authorized, so a plugin holding nothing never gets there; asserted below by its absence",
  },
  storage_list: "attacked",
  storage_read: "attacked",
  storage_remove: "attacked",
  storage_write: "attacked",
};

const ATTACKED_OPS = Object.entries(OP_COVERAGE)
  .filter(([, v]) => v === "attacked")
  .map(([kind]) => kind)
  .sort();

/** Fields an op may legitimately carry. An identity field here would be forgeable. */
const OP_FIELDS = [
  "content",
  "context",
  "init",
  "key",
  "kind",
  "path",
  "url",
  "value",
];

describe("the malicious fixture is refused everywhere (§260 Phase 6)", () => {
  let report: Record<string, string>;
  let brokerOps: PluginOp[];
  let statusBar: [string, string][];
  let toasts: string[];
  const aiFactory = vi.fn();
  const editorHandle = vi.fn();
  const stage = vi.fn();

  beforeAll(async () => {
    brokerOps = [];
    statusBar = [];
    toasts = [];

    const broker = async (op: PluginOp) => {
      brokerOps.push(op);
      if (op.kind === "source_read") return "// module injected directly";
      // Stands in for the Rust authorizer's refusal — see the header. The message says so,
      // so a reader cannot mistake this for the enforcement point.
      throw new Error(
        `Plugin ${manifest.id} is not authorized for "${op.kind}" (test stand-in for the Rust authorizer)`,
      );
    };

    // The REAL fixture module, imported from disk. Not a hand-written stub: the point is that
    // the shipped fixture's own code is what gets refused.
    const mod = (await import(
      pathToFileURL(resolve(DIR, manifest.main)).href
    )) as { activate: (ctx: SandboxContext) => Promise<void> };

    const { host, sandbox } = createChannelPair();
    startSandboxClient(sandbox, async () => mod, broker);
    const session = new SandboxSession(
      host,
      createHostRequestHandler({
        aiFactory: aiFactory as never,
        capabilities: manifest.capabilities,
        // A DECLARED field with a real value behind it: if the settings gate ever failed,
        // this is what would leak, and `stage` never being called is what proves it did not.
        declaredSettings: [
          { default: "", key: "apiKey", label: "API key", type: "string" },
        ],
        declaredStatusBarIds: (manifest.contributions?.statusBar ?? []).map(
          (i) => i.id,
        ),
        editor: editorHandle as never,
        persisted: () => ({ apiKey: "sk-live-do-not-leak" }),
        pluginId: manifest.id,
        pluginName: manifest.name,
        setStatusBarText: (id, text) => void statusBar.push([id, text]),
        showToast: (message) => void toasts.push(message),
        stage,
        surfaceBlocked: () => null,
      }),
    );

    await session.activate(manifest.id, manifest.contributions ?? {});
    report = (await session.invokeCommand("attack")) as Record<string, string>;
    // `ui` is fire-and-forget; let the last frame round-trip before asserting on the bar.
    await new Promise((r) => setTimeout(r, 0));
    session.dispose();
  });

  it("attempts every attack it declares, and no fewer", () => {
    // Pinned as an exact set: a fixture that silently stopped attacking would otherwise pass
    // this whole suite by attacking nothing.
    expect(Object.keys(report).sort()).toEqual([...EXPECTED_ATTACKS].sort());
  });

  it("is refused every single time", () => {
    const admitted = Object.entries(report).filter(
      ([, outcome]) => !outcome.startsWith("denied("),
    );
    expect(admitted, "an admitted call is the trust boundary failing").toEqual(
      [],
    );
  });

  it("is refused by the capability gate, not by a broken transport or a full budget", () => {
    // THE LOAD-BEARING ASSERTION for the host-mediated half. Every one of these would also
    // "fail" if the transport were broken or the in-flight budget exhausted, and the report
    // would look identical. Matching the gate's wording is what distinguishes a real refusal
    // from a coincidental one.
    for (const id of ["ai_complete", "ai_stream", "ai_list_models"]) {
      expect(report[id], id).toContain('requires the "ai" capability');
    }
    expect(report.settings_get_all).toContain(
      'requires the "settings" capability',
    );
    for (const id of ["editor_get_markdown", "editor_get_selection"]) {
      expect(report[id], id).toContain('requires one of "editor"');
      expect(report[id], id).toContain('"editor:readonly"');
    }
    for (const id of ["editor_set_markdown", "editor_insert_text"]) {
      // The write half names only the rw grant: `editor:readonly` must not admit it.
      expect(report[id], id).toContain('requires one of "editor"');
      expect(report[id], id).not.toContain('"editor:readonly"');
    }
    // …and each names the plugin, so a user reading a log learns who asked.
    expect(report.ai_complete).toContain(manifest.id);
  });

  it("never reaches the subject of any refused call", () => {
    // The gate runs BEFORE the bridge touches what it protects. Were the order reversed, the
    // refusal would still be reported while the document had already been read and staged.
    expect(
      aiFactory,
      "no AI provider may be constructed",
    ).not.toHaveBeenCalled();
    expect(
      editorHandle,
      "the document must not be read",
    ).not.toHaveBeenCalled();
    expect(
      stage,
      "nothing may be staged for this plugin",
    ).not.toHaveBeenCalled();
  });

  it("writes only the status-bar item it declared", () => {
    // The host namespaces the id, and refuses one that was never declared.
    expect(statusBar).toEqual([[`${manifest.id}:sb:probe`, "😈 armed"]]);
    expect(statusBar.map(([id]) => id).join()).not.toContain("undeclared");
    // Its own toast surface went unused; a refusal must not become a user-facing message
    // attributed to the plugin.
    expect(toasts).toEqual([]);
  });

  it("propagates broker refusals to plugin code un-softened", () => {
    // A sandbox that turned a deny into `undefined` would let the plugin proceed as though
    // the call had landed. Every brokered attack must therefore be a `denied(...)` carrying
    // the broker's own message.
    for (const id of [
      "files_list",
      "files_read",
      "files_write",
      "http_fetch",
      "storage_list",
      "storage_read",
      "storage_remove",
      "storage_write",
    ]) {
      expect(report[id], id).toContain("is not authorized for");
    }
  });

  it("sends every attacked op to the broker, and nothing that needs no grant", () => {
    const kinds = [...new Set(brokerOps.map((o) => o.kind))].sort();
    expect(kinds.filter((k) => k !== "source_read")).toEqual(ATTACKED_OPS);
    // `source_read` is the one op it legitimately made — the bundle it booted from.
    expect(brokerOps.filter((o) => o.kind === "source_read")).toHaveLength(1);
    // `staged_read` is unreachable for a plugin with nothing staged: the host-mediated read
    // that would stage something was refused first, so the pull never happens.
    expect(kinds).not.toContain("staged_read");
  });

  it("cannot name a victim: no op carries a forgeable identity", () => {
    // Storage namespacing and file rooting are derived from `window.label()` in Rust. If an
    // op ever carried a `pluginId`/`label`/`namespace`, a sandbox could ask for someone
    // else's data and the authorizer would have to be trusted to ignore it.
    for (const op of brokerOps) {
      for (const field of Object.keys(op)) {
        expect(OP_FIELDS, `op "${op.kind}" carries "${field}"`).toContain(
          field,
        );
      }
    }
  });

  it("sends hostile paths verbatim, because sanitizing them is Rust's job", () => {
    // Documents where the boundary IS. The client deliberately does not pre-validate, so
    // these shapes really do arrive at the broker — which is why `authorizer.rs` and
    // `plugin_cmd`'s path guards are load-bearing rather than belt-and-braces.
    const paths = brokerOps
      .filter((o) => "path" in o)
      .map((o) => (o as { path: string }).path);
    expect(paths).toContain("/etc/passwd");
    expect(paths).toContain("../../../etc/passwd");
    expect(paths).toContain(".baram/config.json");
    // …and the cross-plugin storage key likewise leaves as written.
    const keys = brokerOps
      .filter((o) => "key" in o)
      .map((o) => (o as { key: string }).key);
    expect(keys).toContain("../baram-word-count/config.json");
  });
});

describe("the malicious fixture stays a fixture (§260 Phase 6)", () => {
  it("is a valid sandboxed manifest, or it would not load to be refused", () => {
    const result = validateManifest(manifest);
    expect(
      result.valid ? [] : result.errors.map((e) => `${e.field}: ${e.message}`),
    ).toEqual([]);
    expect(pluginTrustOf(manifest)).toBe("sandboxed");
  });

  it("holds only the two capabilities it needs to report", () => {
    // Widening this silently weakens every assertion above: a granted capability turns an
    // attack into a legitimate call, and the suite would still pass by refusing less.
    expect([...manifest.capabilities].sort()).toEqual([
      "commands",
      "statusbar",
    ]);
  });

  it("is refused by the release workflow, by directory name", () => {
    // A mistyped `plugin-malicious-fixture-v1.0.0` tag is the only way an attack plugin could
    // reach the public registry. The denylist is in the tag-parsing step, before any build.
    const workflow = readFileSync(
      resolve(__dirname, "../../../.github/workflows/plugin-release.yml"),
      "utf8",
    );
    const denied = /case "\$DIR" in\s*\n\s*([a-z|-]+)\)/.exec(workflow)?.[1];
    expect(denied?.split("|").sort()).toEqual([
      "malicious-fixture",
      "sandbox-smoke",
    ]);
  });

  it("ships a single self-contained ESM with no build step", () => {
    const source = readFileSync(resolve(DIR, manifest.main), "utf8");
    expect(manifest.main).toBe("index.mjs");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).toMatch(/export async function activate\s*\(/);
  });
});
