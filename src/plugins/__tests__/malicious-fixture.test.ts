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

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

function metaStepScript(): string {
  return stepScript("Parse and verify tag");
}

/**
 * The shell script of `plugin-release.yml`'s "Parse and verify tag" step.
 *
 * Extracted by text rather than with a YAML parser on purpose: `js-yaml` is only transitively
 * present in this repo, not a declared dependency, so importing it here would make this test
 * hostage to an unrelated dependency bump. The callers assert the extraction found real anchors,
 * so a broken extraction fails loudly instead of running an empty script.
 */
function stepScript(stepName: string): string {
  const workflow = readFileSync(
    resolve(__dirname, "../../../.github/workflows/plugin-release.yml"),
    "utf8",
  );
  const step = workflow.indexOf(`- name: ${stepName}`);
  if (step < 0) throw new Error(`no workflow step named "${stepName}"`);
  const runAt = workflow.indexOf("run: |", step);
  const lines = workflow.slice(runAt).split("\n").slice(1);
  const body: string[] = [];
  for (const line of lines) {
    // The block ends at the first non-blank line that is not part of it.
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

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

  it("is refused by the release workflow — verified by RUNNING it, not reading it", () => {
    // §260 Phase 6 code review round 3 (HIGH-2). This guard has been displaced three times, and
    // every version of it was a text scan of a shell script: pattern list → call site → the text
    // "exit 1" inside `fail()`'s braces. The last one was defeated four ways, each of which
    // published the fixture: commenting out `exit 1` (`[^}]*` spans newlines and ignores `#`),
    // adding a SECOND `fail()` after the good one (the scan finds *a* definition, bash uses the
    // last), `return 0; exit 1`, and `: exit 1`.
    //
    // A fourth displacement exists for as long as the guard is a scan. So stop scanning: extract
    // the step's script and RUN it, under the same `bash -e` GitHub Actions uses, and assert the
    // exit status. The allowlist runs before any `node`/`git` call, so nothing external is
    // needed for the refusal cases.
    const script = metaStepScript();
    // The extraction must have found the real thing — otherwise every case below "passes" by
    // running an empty script.
    expect(script).toContain('case "$DIR" in');
    expect(script).toContain("GITHUB_REF_NAME");

    const runFor = (tag: string) => {
      const out = mkdtempSync(join(tmpdir(), "baram-meta-"));
      const result = spawnSync("bash", ["-e", "-c", script], {
        cwd: resolve(__dirname, "../../.."),
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_OUTPUT: join(out, "output"),
          GITHUB_REF_NAME: tag,
          GITHUB_SHA: "HEAD",
        },
      });
      return { output: result.stderr + result.stdout, status: result.status };
    };

    // The fixtures, and — the round-3 finding — the plugin Phase 6 deliberately withdrew. A
    // `plugin-ai-summary-v1.0.0` tag passed every check the previous denylist had, including the
    // release-order gate (its floor is older than the app), and would have published a
    // `trust: "trusted"` plugin.
    for (const tag of [
      "plugin-malicious-fixture-v1.0.0",
      "plugin-sandbox-smoke-v1.2.0",
      "plugin-ai-summary-v1.0.0",
    ]) {
      const { output, status } = runFor(tag);
      expect(status, `${tag} must abort the step`).not.toBe(0);
      expect(output, `${tag} must be refused by the allowlist`).toContain(
        "publishable allowlist",
      );
    }

    // A malformed tag is refused too, and by the tag rule rather than the allowlist.
    const bad = runFor("plugin-word-count-vNOPE");
    expect(bad.status).not.toBe(0);
    expect(bad.output).toContain("does not match");

    // §260 Phase 6 code review round 3 (MEDIUM-1) — the step's OTHER checks had no guard at all;
    // deleting them left the suite green. Each executable one gets a case here.
    const mismatched = runFor("plugin-word-count-v9.9.9");
    expect(mismatched.status).not.toBe(0);
    expect(mismatched.output).toContain("!= manifest version");

    // The remaining check — `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`, the "a tag
    // must be on main" control — cannot be reached from here: it runs after the release-order
    // gate, which correctly refuses while the app is behind the floor. So its PRESENCE is
    // asserted rather than its behaviour, and the distinction is stated so nobody reads this as
    // proof that it works. Round 3 found its only in-repo mention was a comment in a test.
    expect(
      script,
      "the tag-on-main check must exist (presence only — unreachable in this harness)",
    ).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');

    // …and the one allowlisted plugin gets PAST the allowlist and the tier check. It still stops
    // at the release-order gate while the app is behind the floor, which is that gate working —
    // asserted here so this case cannot silently become a refusal for the wrong reason.
    const allowed = runFor("plugin-word-count-v2.0.0");
    expect(allowed.output).not.toContain("publishable allowlist");
    expect(allowed.output).not.toContain(
      "only sandboxed plugins are published",
    );
    if (allowed.status !== 0) {
      // §260 Phase 6 code review round 4 (MEDIUM-1) — this asserted `engines.baram` alone, which
      // was calibrated to TODAY (app 0.4.1 vs floor >=0.5.0). Bump the app to 0.5.0 and the
      // script gets one check further, to `git merge-base --is-ancestor … origin/main`, which
      // fails on a feature branch and fails harder in PR CI, where the checkout has no
      // `origin/main` ref at all. That is the same self-defeating shape the floor guard in
      // `reference-plugins.test.ts` documents avoiding, one file over.
      //
      // Both later stopping points are legitimate here; what must NOT happen is stopping for one
      // of the reasons excluded above. The order gate keeps its own executable coverage in the
      // synthetic-cwd test below, independent of the repo's version.
      expect(allowed.output).toMatch(
        /engines\.baram|is not on main|Not a valid object name/,
      );
    }
  });

  it("re-verifies the packaged ARCHIVE, so a wandering later step cannot publish another plugin", () => {
    // §260 Phase 6 code review round 5 (HIGH-1). Five rounds of guarding this workflow with text
    // scans, and each round found the next way past: a hardcoded `working-directory`, then a
    // rebound `DIR:` env (which fed the trusted example's manifest to the index script and
    // published `trust: "trusted"` with the suite green), and `cd` / `defaults.run` were never
    // covered at all. A scan cannot enumerate the ways a shell step can wander.
    //
    // So the workflow now re-checks the ARTIFACT: it unzips the manifest that is actually about to
    // be published and requires it to be the plugin the gates verified. That holds however the
    // bytes got there — and the index is built from the SAME extracted manifest, so the published
    // entry and the published archive cannot disagree.
    //
    // Tested by EXECUTION against real archives, for the reason this whole file exists.
    const script = stepScript(
      "Verify the packaged artifact is the plugin that was verified",
    );
    expect(script).toContain("unzip -p");

    const runFor = (manifest: null | Record<string, unknown>) => {
      const tmp = mkdtempSync(join(tmpdir(), "baram-artifact-"));
      const stage = join(tmp, "stage");
      mkdirSync(stage, { recursive: true });
      if (manifest !== null) {
        writeFileSync(
          join(stage, "baram-plugin.json"),
          // A raw string passes through verbatim, so a malformed archive can be built.
          typeof manifest.__raw === "string"
            ? manifest.__raw
            : JSON.stringify(manifest),
        );
      } else {
        writeFileSync(join(stage, "other.txt"), "no manifest here");
      }
      const zipName = "baram-word-count-2.0.0.zip";
      const zipped = spawnSync("zip", ["-r", join(tmp, zipName), "."], {
        cwd: stage,
        encoding: "utf8",
      });
      expect(
        zipped.status,
        `building the fixture archive: ${zipped.stderr}`,
      ).toBe(0);

      const result = spawnSync("bash", ["-e", "-c", script], {
        cwd: resolve(__dirname, "../../.."),
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_OUTPUT: join(tmp, "output"),
          PLUGIN_ID: "baram-word-count",
          RUNNER_TEMP: tmp,
          VERSION: "2.0.0",
          ZIP_NAME: zipName,
        },
      });
      return { output: result.stderr + result.stdout, status: result.status };
    };

    const good = {
      capabilities: ["events"],
      engines: { baram: ">=0.5.0" },
      id: "baram-word-count",
      trust: "sandboxed",
      version: "2.0.0",
    };

    // The control: the archive really is the verified plugin.
    const ok = runFor(good);
    expect(ok.status, ok.output).toBe(0);

    // THE ROUND-5 VECTOR: the archive holds the trusted example instead. Whatever wandered —
    // a rebound env, a `cd`, a job-level default — this refuses.
    const trusted = runFor({
      ...good,
      id: "baram-ai-summary",
      trust: "trusted",
    });
    expect(trusted.status).not.toBe(0);
    // Refused on identity first, which is the more specific complaint.
    expect(trusted.output).toContain("was verified");

    // …and the tier is re-asserted on the bytes even when the id matches.
    const wrongTier = runFor({ ...good, trust: "trusted" });
    expect(wrongTier.status).not.toBe(0);
    expect(wrongTier.output).toContain("only sandboxed plugins are published");

    const wrongVersion = runFor({ ...good, version: "9.9.9" });
    expect(wrongVersion.status).not.toBe(0);
    expect(wrongVersion.output).toContain("was verified");

    // An archive with no manifest at its root, and one whose manifest is unparseable, both fail
    // with a real annotation rather than a raw Node stack (the round-5 LOW-2 class).
    const noManifest = runFor(null);
    expect(noManifest.status).not.toBe(0);
    expect(noManifest.output).toContain("::error::");

    const malformed = runFor({ __raw: '{"id": "baram-word-count",}' });
    expect(malformed.status).not.toBe(0);
    expect(malformed.output).toContain("::error::");
    expect(malformed.output).not.toContain("node:internal");
  });

  it("ties every publish step to the directory the meta step verified", () => {
    // §260 Phase 6 code review round 4 (MEDIUM-2). The gates all live in the meta step, and the
    // later steps consume `steps.meta.outputs.dir`. Nothing asserted that: hardcoding
    // `working-directory: examples/plugins/ai-summary` in `Package ZIP`, or `DIR: ai-summary` in
    // the push step, published the trusted manifest and its ZIP with the whole suite green — the
    // verified directory and the built directory simply parted company.
    const workflow = readFileSync(
      resolve(__dirname, "../../../.github/workflows/plugin-release.yml"),
      "utf8",
    );
    const build = workflow.indexOf("- name: Build plugin");
    expect(build).toBeGreaterThan(0);
    // Everything from the build step on must reach the plugin tree only through that output.
    const references = [
      ...workflow
        .slice(build)
        .matchAll(/examples\/plugins\/(\$\{\{[^}]*\}\}|\$\{?\w+\}?|[\w.-]+)/g),
    ].map((m) => m[1]);
    expect(references.length).toBeGreaterThan(0);
    for (const ref of references) {
      expect(
        ref,
        `a publish step names examples/plugins/${ref} directly; it must use the meta step's verified dir`,
      ).toMatch(
        // Anchored at BOTH ends (round-5 LOW-3): `^\$DIR` alone also admitted `$DIRECTORY`,
        // bound to anything.
        /^\$\{\{\s*steps\.meta\.outputs\.dir\s*\}\}$|^\$DIR$|^\$\{DIR\}$/,
      );
    }
  });

  it("refuses a non-sandboxed manifest, a bad id, and a behind app — by RUNNING the step", () => {
    // §260 Phase 6 code review round 4 (HIGH-1). The previous round's commit claimed the
    // executing guard caught "widening the allowlist OR deleting the tier check". The second half
    // was false, structurally: no tag in the harness above reaches the tier check, because
    // `word-count` is the only allowlisted directory and it IS sandboxed. So the tier check's
    // whole guard was a `toContain` on its own error MESSAGE, while any mutation lives in the
    // CONDITION — weakening `[[ "$TRUST" == "sandboxed" ]]` to `[[ -n "$TRUST" ]]` left all 27
    // tests green. The plugin-id regex and the release-order gate had no executable guard either.
    //
    // The step reads exactly two files, both relative to cwd: `package.json` and
    // `examples/plugins/$DIR/baram-plugin.json`. So a SYNTHETIC cwd makes every one of these
    // reachable without touching the repo — and without the guard being calibrated to the repo's
    // current version, which is what made the `allowed` case above fragile (see MEDIUM-1 below).
    const script = metaStepScript();

    const runSynthetic = (opts: {
      appVersion?: string;
      manifest: Record<string, unknown>;
      tag: string;
    }) => {
      const root = mkdtempSync(join(tmpdir(), "baram-meta-syn-"));
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ version: opts.appVersion ?? "9.9.9" }),
      );
      // Always the allowlisted directory: this exercises the checks AFTER the allowlist.
      const pluginDir = join(root, "examples", "plugins", "word-count");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "baram-plugin.json"),
        JSON.stringify(opts.manifest),
      );
      const result = spawnSync("bash", ["-e", "-c", script], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_OUTPUT: join(root, "output"),
          GITHUB_REF_NAME: opts.tag,
          GITHUB_SHA: "HEAD",
        },
      });
      return { output: result.stderr + result.stdout, status: result.status };
    };

    const base = {
      capabilities: ["events"],
      engines: { baram: ">=0.5.0" },
      id: "baram-word-count",
      trust: "sandboxed",
      version: "1.0.0",
    };
    const TAG = "plugin-word-count-v1.0.0";

    // 1. The tier check, executed. This is the assertion that was missing.
    const trusted = runSynthetic({
      manifest: { ...base, trust: "trusted" },
      tag: TAG,
    });
    expect(trusted.status).not.toBe(0);
    expect(trusted.output).toContain("only sandboxed plugins are published");

    // …and its control: the same manifest, sandboxed, must get PAST the tier check. (It stops
    // later at `git merge-base`, since a temp dir is not a git repo — that is fine and expected.)
    const sandboxed = runSynthetic({ manifest: base, tag: TAG });
    expect(sandboxed.output).not.toContain(
      "only sandboxed plugins are published",
    );

    // 2. The plugin-id regex, which had no guard at all.
    const badId = runSynthetic({
      manifest: { ...base, id: "../../evil" },
      tag: TAG,
    });
    expect(badId.status).not.toBe(0);
    expect(badId.output).toContain("must match");

    // 3. The release-order gate, pinned independently of the repo's real version — so it keeps
    //    its coverage after the app is bumped to 0.5.0 (round-4 MEDIUM-1).
    const behind = runSynthetic({
      appVersion: "0.4.1",
      manifest: base,
      tag: TAG,
    });
    expect(behind.status).not.toBe(0);
    expect(behind.output).toContain("release the app first");

    const atFloor = runSynthetic({
      appVersion: "0.5.0",
      manifest: base,
      tag: TAG,
    });
    expect(atFloor.output).not.toContain("release the app first");

    // …a prerelease app fails CLOSED: it is not the release that ships the floor.
    const prerelease = runSynthetic({
      appVersion: "0.5.0-beta.1",
      manifest: base,
      tag: TAG,
    });
    expect(prerelease.status).not.toBe(0);
    expect(prerelease.output).toContain("not a plain release version");

    // 4. Malformed inputs are reported AS malformed, not as "release the app first"
    //    (round-4 LOW-2), and an absent `engines` produces a real annotation rather than a raw
    //    Node stack with no `::error::` (LOW-1).
    const caretRange = runSynthetic({
      manifest: { ...base, engines: { baram: "^0.5.0" } },
      tag: TAG,
    });
    expect(caretRange.status).not.toBe(0);
    expect(caretRange.output).toContain("cannot compare versions");
    expect(caretRange.output).not.toContain("release the app first");

    // §260 Phase 6 code review round 5 (MEDIUM-1) — `engines` ABSENT, not `engines: {}`. LOW-1
    // was about an absent `engines`, and with `{}` the pre-fix `require(…).engines.baram` works
    // fine — so this case could not fail if the fix were reverted, which the reviewer verified.
    // And the assertion names the message: `toContain("::error::")` is satisfied by every `fail`
    // path, so it proved only "some annotation printed".
    const noEngines = { ...base };
    delete (noEngines as { engines?: unknown }).engines;
    const missing = runSynthetic({ manifest: noEngines, tag: TAG });
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("cannot compare versions");
    // …and it is a refusal, not a crash: no raw Node stack from the `-e` script.
    expect(missing.output).not.toContain("[eval]");
    // ‼️ An EXPLICIT budget, because this test spawns bash and node several times over and
    // vitest's 5 s default left it 1.9× headroom (2.66 s alone on a 10-core machine). Adding a
    // second process-spawning file to the suite — `revocation-publish-gate.test.ts`, which runs
    // the revocation gate's real shell — was enough to push it to 5.3 s and fail. Nothing here
    // got slower; the budget was never sized for what this test does, and a CI runner has
    // fewer cores than the machine that number came from.
  }, 30_000);

  it("names only the sandboxed tier as publishable", () => {
    // An independent condition from the allowlist, and it fails for a different reason: the
    // allowlist answers "is this directory meant to ship", this answers "is this tier fit to
    // ship". Exercised by pointing the step at the trusted example, which IS a real manifest.
    const script = metaStepScript();
    expect(script).toContain("only sandboxed plugins are published");
    // …and this step runs before anything is built. Asserted as STEP ORDER in the workflow, not
    // as the absence of a string in the script: the first draft of this checked that the script
    // does not contain "npm ci", which failed the moment a comment in the script mentioned it.
    const workflow = readFileSync(
      resolve(__dirname, "../../../.github/workflows/plugin-release.yml"),
      "utf8",
    );
    const meta = workflow.indexOf("- name: Parse and verify tag");
    const build = workflow.indexOf("- name: Build plugin");
    expect(meta).toBeGreaterThan(0);
    expect(build).toBeGreaterThan(meta);
  });

  it("ships a single self-contained ESM with no build step", () => {
    const source = readFileSync(resolve(DIR, manifest.main), "utf8");
    expect(manifest.main).toBe("index.mjs");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    // §260 Phase 6 code review (L2) — `export { x } from "./sibling.mjs"` is a static bare
    // import that both patterns above miss, and it fails the same way from a blob: URL.
    expect(source).not.toMatch(/^\s*export\b[^;]*\bfrom\s/m);
    expect(source).toMatch(/export async function activate\s*\(/);
  });
});
