// §380/§381 — the two community CLIs run as the workflows run them: a child process, its exit
// code, and what it leaves in `$GITHUB_OUTPUT`. Nothing here reaches the network: every child
// starts with a preload that replaces `fetch` with one that rejects.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { cleanUpWorlds, tempDir } from "./community-gate-world";

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
