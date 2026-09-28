// §380/§381 — the two community CLIs run as the workflows run them: a child process, its exit
// code, and what it leaves in `$GITHUB_OUTPUT`. Nothing here reaches the network: every child
// starts with a preload that replaces `fetch` with one that rejects.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { cleanUpWorlds, gitIn, tempDir } from "./community-gate-world";

afterAll(cleanUpWorlds);

const ROOT = resolve(__dirname, "../../..");

/** Loaded before the CLI: `fetch` rejects, so a request fails here instead of leaving the machine. */
const OFFLINE = `globalThis.fetch = () => Promise.reject(new Error("offline"));\n`;

/** As OFFLINE, and reading `limits.rs` throws — the app's source is not there to scrape. */
const NO_LIMITS = `${OFFLINE}import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const read = fs.readFileSync;
fs.readFileSync = (path, ...rest) => {
  if (String(path).endsWith("limits.rs")) throw new Error("limits.rs cannot be read");
  return read(path, ...rest);
};
syncBuiltinESMExports();
`;

/**
 * Runs `scripts/<script>` under `preload`, with only the environment given here (plus PATH and
 * HOME) — never this process's own, which on CI carries a real `GITHUB_OUTPUT`.
 */
function run(
  script: string,
  args: string[],
  env: Record<string, string>,
  preload: string = OFFLINE,
) {
  const dir = tempDir("baram-cli-run-");
  const preloadPath = join(dir, "preload.mjs");
  writeFileSync(preloadPath, preload);
  const output = join(dir, "github-output");
  writeFileSync(output, "");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      preloadPath,
      resolve(ROOT, "scripts", script),
      ...args,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        GITHUB_OUTPUT: output,
        HOME: process.env.HOME ?? "",
        PATH: process.env.PATH ?? "",
        ...env,
      },
    },
  );
  return {
    dir,
    outputs: readFileSync(output, "utf8"),
    status: child.status,
    stderr: child.stderr,
    stdout: child.stdout,
  };
}

describe("run-community-gate.ts", { timeout: 60_000 }, () => {
  const gateEnv = {
    BASE_SHA: "b".repeat(40),
    GITHUB_TOKEN: "token",
    HEAD_SHA: "a".repeat(40),
    PR_AUTHOR_ID: "583231",
    REGISTRY_REPO: "sayinel/baram-plugins",
  };
  const gateArgs = (dir: string) => [
    "--pr-root",
    dir,
    "--published-root",
    dir,
    "--base-url",
    "https://sayinel.github.io/baram-plugins/",
  ];

  it("exits 2, and writes no output, when the gate throws — a request that got no answer", () => {
    const dir = tempDir("baram-cli-gate-");
    const gate = run("run-community-gate.ts", gateArgs(dir), gateEnv);
    expect(gate.status).toBe(2);
    expect(gate.stderr).toContain(
      "✗ community gate: offline — a workflow or infrastructure error, not a verdict",
    );
    expect(gate.outputs).toBe("");
  });

  it("exits 2, not 1, when its setup cannot read the app's bounds", () => {
    const dir = tempDir("baram-cli-gate-");
    const gate = run(
      "run-community-gate.ts",
      gateArgs(dir),
      gateEnv,
      NO_LIMITS,
    );
    expect(gate.status).toBe(2);
    expect(gate.stderr).toContain(
      "✗ community gate: limits.rs cannot be read — a workflow or infrastructure error, not a verdict",
    );
    expect(gate.outputs).toBe("");
  });
});

describe("run-community-publish.ts reconcile", { timeout: 60_000 }, () => {
  /** A registry checkout with one commit, and a `gh` whose every call fails like a bad token. */
  function world() {
    const registry = tempDir("baram-cli-registry-");
    const git = gitIn(registry);
    git("init", "--quiet");
    writeFileSync(join(registry, "index.json"), '{ "plugins": [] }\n');
    git("add", "--", "index.json");
    git("commit", "--quiet", "-m", "seed");
    const bin = tempDir("baram-cli-bin-");
    writeFileSync(join(bin, "gh"), "#!/bin/sh\necho 'HTTP 401' >&2\nexit 1\n", {
      mode: 0o755,
    });
    return { bin, registry };
  }
  const env = (bin: string) => ({
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_RUN_ID: "7",
    GITHUB_TOKEN: "token",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    REGISTRY_REPO: "sayinel/baram-plugins",
  });
  const args = (registry: string, report: string) => [
    "reconcile",
    "--registry",
    registry,
    "--base-url",
    "https://sayinel.github.io/baram-plugins/",
    "--report",
    report,
    "--delivery",
    "pull-request",
  ];

  it("exits 2 for a run the sweep aborted, after writing the report and the counts", () => {
    const { bin, registry } = world();
    const report = join(tempDir("baram-cli-report-"), "report.json");
    const publish = run(
      "run-community-publish.ts",
      args(registry, report),
      env(bin),
    );
    expect(publish.status).toBe(2);
    expect(publish.outputs).toBe("failed=0\npublished=0\nstalled=0\n");
    expect(JSON.parse(readFileSync(report, "utf8"))).toEqual({
      aborted: "gh pr list failed: HTTP 401",
      failed: [],
      published: [],
      skipped: [],
    });
    expect(publish.stdout).toContain(
      "✗ aborted: gh pr list failed: HTTP 401 — no descriptor after it was handled",
    );
    expect(publish.stdout).toMatch(
      /^registry size \d+ bytes \(0\.0% of GitHub Pages' 1000000000\)$/mu,
    );
  });

  it("still writes the counts when the report cannot be written", () => {
    const { bin, registry } = world();
    // A directory where the report file should go: writing it throws.
    const report = tempDir("baram-cli-report-");
    mkdirSync(join(report, "report.json"));
    const publish = run(
      "run-community-publish.ts",
      args(registry, join(report, "report.json")),
      env(bin),
    );
    expect(publish.status).toBe(2);
    expect(publish.outputs).toBe("failed=0\npublished=0\nstalled=0\n");
  });

  it("exits 2 before anything runs when GITHUB_RUN_ATTEMPT is missing — it names the branches", () => {
    const { bin, registry } = world();
    const report = join(tempDir("baram-cli-report-"), "report.json");
    const withoutAttempt: Record<string, string> = { ...env(bin) };
    delete withoutAttempt.GITHUB_RUN_ATTEMPT;
    const publish = run(
      "run-community-publish.ts",
      args(registry, report),
      withoutAttempt,
    );
    expect(publish.status).toBe(2);
    expect(publish.stderr).toContain(
      "✗ community publish: GITHUB_RUN_ATTEMPT is not set — a bug in the workflow that runs this, not a verdict",
    );
    expect(existsSync(report)).toBe(false);
    expect(publish.outputs).toBe("");
  });
});
