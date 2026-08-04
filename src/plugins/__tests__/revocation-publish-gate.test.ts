// §69 — the revocation publish gate's shell, run for real against fixtures.
//
// WHY THIS FILE EXISTS: two consecutive review rounds found defects in this one YAML step, and
// nothing in the repo could see either. The counter comparison lived in a `run:` block, so the
// only thing that ever executed it was a push to main — after the mistake had shipped.
//
// - HIGH-3: the gate errored whenever the counter did not advance, but in steady state the
//   repo, the registry and the live file ARE the same list. Every ordinary re-run, including
//   the `workflow_dispatch` re-sync the workflow documents as its own bootstrap path, hit
//   `NEW == OLD` and hard-failed — and it made the "nothing to publish" exit further down
//   unreachable.
// - HIGH-2: the counter was read with a line of python, `d.get("sequence") or 0`, which
//   accepts a JSON string. `sequence: "2"` compared as 2 and published, while every client
//   ran it through `readSequence`, saw a non-number and read 0.
//
// The step's script is EXTRACTED from the workflow rather than retyped here. A copy would
// verify a file nobody ships, and drift between the two would be invisible in exactly the way
// this whole file exists to prevent. Only the network call is substituted.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const WORKFLOW = resolve(ROOT, ".github/workflows/revocation-publish.yml");
const STEP = "A changed list must carry a higher counter than the live one";

/** The `run: |` body of a named step: every line indented deeper than the `run:` key. */
function stepScript(workflow: string, stepName: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex(
    (line) => line.includes(stepName) && line.trimStart().startsWith("- name:"),
  );
  expect(start, `step not found: ${stepName}`).toBeGreaterThan(-1);
  const runAt = lines.findIndex(
    (line, i) => i >= start && line.trim() === "run: |",
  );
  const indent = lines[runAt].length - lines[runAt].trimStart().length + 2;
  const body: string[] = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.length - line.trimStart().length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

const RAW = stepScript(readFileSync(WORKFLOW, "utf8"), STEP);
// Proof the block extracted — deliberately NOT a check on what it contains. Asserting on
// `cmp -s` here made an earlier harness REFUSE a mutant that deleted it, which reads as a kill
// and is not one.
expect(RAW).toContain("revocation-sequence.ts");

// The gate's one network call, replaced by a copy from a fixture. Everything else — the
// byte comparison, both counter reads, the shell's numeric test — runs as written.
const SCRIPT = RAW.replace(
  /if ! curl -fsS -o "\$RUNNER_TEMP\/live-before\.json" "[^"]+"; then/u,
  'if ! cp "$FAKE_LIVE" "$RUNNER_TEMP/live-before.json" 2>/dev/null; then',
);
expect(SCRIPT).toContain("FAKE_LIVE");

interface Doc {
  revoked: unknown[];
  sequence?: unknown;
  version: number;
}

/** Runs the gate with `ours` in the repo and `live` served, or nothing served for null. */
function gate(
  ours: Doc,
  live: Doc | null,
): { output: string; status: null | number } {
  const dir = mkdtempSync(join(tmpdir(), "baram-gate-"));
  mkdirSync(join(dir, "registry"));
  // Formatted the way prettier writes the real file, so `cmp` compares realistic bytes —
  // the trailing newline is part of what "byte-identical" has to mean in practice.
  writeFileSync(
    join(dir, "registry/revoked.json"),
    `${JSON.stringify(ours, null, 2)}\n`,
  );
  let fakeLive = "/nonexistent/live.json";
  if (live !== null) {
    fakeLive = join(dir, "live.json");
    writeFileSync(fakeLive, `${JSON.stringify(live, null, 2)}\n`);
  }
  // `registry/revoked.json` is a relative path in the workflow, so the gate runs from the
  // fixture root with the real scripts reachable from it.
  for (const name of ["scripts", "src", "node_modules"]) {
    symlinkSync(join(ROOT, name), join(dir, name));
  }
  // `bash -e` is what Actions uses for a `run:` block on ubuntu — the failure semantics are
  // part of the behaviour under test.
  const result = spawnSync("bash", ["-e", "-c", SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, FAKE_LIVE: fakeLive, RUNNER_TEMP: dir },
  });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

// ‼️ The floor step is extracted the same way and run the same way, because it has the same
// property that made the counter gate dangerous: it is shell, so nothing but a push to main ever
// executes it. It takes no arguments — the floor comes from the SHIPPED constant via
// `revocation-floor.ts` — so these cases vary the published counter and read the real floor.
const FLOOR_STEP = "The app's floor must track what has been published";
const FLOOR_SCRIPT = stepScript(readFileSync(WORKFLOW, "utf8"), FLOOR_STEP);
expect(FLOOR_SCRIPT).toContain("revocation-floor.ts");

/** Runs the floor step with `published` as the repo's list. */
function floorStep(published: Doc): { output: string; status: null | number } {
  const dir = mkdtempSync(join(tmpdir(), "baram-floor-"));
  mkdirSync(join(dir, "registry"));
  writeFileSync(
    join(dir, "registry/revoked.json"),
    `${JSON.stringify(published, null, 2)}\n`,
  );
  for (const name of ["scripts", "src", "node_modules"]) {
    symlinkSync(join(ROOT, name), join(dir, name));
  }
  const result = spawnSync("bash", ["-e", "-c", FLOOR_SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, RUNNER_TEMP: dir },
  });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

const EMPTY: Doc = { revoked: [], sequence: 1, version: 1 };
const CHANGED: Doc = {
  revoked: [{ id: "x", reason: "r", severity: "unlisted", versions: "*" }],
  sequence: 1,
  version: 1,
};

// ‼️ An explicit budget for the whole block: every case spawns bash, and five of them spawn
// `npx tsx` twice inside it. Vitest's 5 s default is not sized for that under a saturated
// suite, and this file is what pushed `malicious-fixture.test.ts` — the other test that runs a
// workflow step for real — past its own default. A ceiling, not a delay.
describe("the revocation publish gate", { timeout: 30_000 }, () => {
  it("treats a byte-identical list as nothing to publish, not as a rollback", () => {
    // ‼️ HIGH-3. This is the STEADY STATE, and the manual re-sync hits it every time.
    const { output, status } = gate(EMPTY, EMPTY);
    expect(status).toBe(0);
    expect(output).toContain("byte-identical");
  });

  it("passes a changed list whose counter advances", () => {
    const { output, status } = gate({ ...CHANGED, sequence: 2 }, EMPTY);
    expect(status).toBe(0);
    expect(output).toContain("live sequence=1, publishing=2");
  });

  it("REFUSES a changed list that reuses the live counter", () => {
    // The gate's actual job: the content moved and the counter did not, so every armed
    // client would refuse the list as a rollback and the revocation would do nothing.
    const { output, status } = gate(CHANGED, EMPTY);
    expect(status).toBe(1);
    expect(output).toContain("sequence must increase");
  });

  it("REFUSES a changed list whose counter goes backwards", () => {
    const { status } = gate(
      { ...CHANGED, sequence: 0 },
      {
        ...EMPTY,
        sequence: 5,
      },
    );
    expect(status).toBe(1);
  });

  it("skips the gate when the live list is unreachable", () => {
    // Permissive on purpose: a Pages outage must not block an urgent revocation. The real
    // protection is the client refusing a rollback, which does not need this step at all.
    const { output, status } = gate(EMPTY, null);
    expect(status).toBe(0);
    expect(output).toContain("unreachable");
  });

  it("REFUSES a counter written as a JSON string, which clients read as 0", () => {
    // ‼️ HIGH-2 at the gate. The python this replaced compared it as 2 and published; the
    // shipping reader makes the gate lose exactly what a client loses.
    const { output, status } = gate({ ...CHANGED, sequence: "2" }, EMPTY);
    expect(status).toBe(1);
    expect(output).toContain("publishing=0");
  });

  it("passes when the floor equals what was published", () => {
    // Steady state right after a release that raised the floor.
    const { output, status } = floorStep({ ...EMPTY, sequence: 1 });
    expect(status).toBe(0);
    expect(output).toContain("app floor=1");
  });

  it("REFUSES a floor above the published counter, which bricks every client", () => {
    // ‼️ The direction with no tolerance. A floor above the live counter makes every client
    // refuse the REAL list, and it presents as the feature working. Reached here by publishing a
    // counter BELOW the shipped floor, which is the same inequality.
    const { output, status } = floorStep({ ...EMPTY, sequence: 0 });
    expect(status).toBe(1);
    expect(output).toContain("is ABOVE the published counter");
  });

  it("REFUSES a floor that has fallen too far behind", () => {
    // The silent direction, and the reason this step exists: revocations keep being published
    // while no release carries the floor forward, so every restart accepts a replayed older
    // signed list and nothing anywhere says so.
    const { output, status } = floorStep({ ...EMPTY, sequence: 7 });
    expect(status).toBe(1);
    expect(output).toContain("lags the published counter");
  });

  it("tolerates a gap, because the floor can only move at release time", () => {
    // Exactly at the limit: publishing 6 against a floor of 1 is a gap of 5, which must pass —
    // a gate that demanded equality would fail every publish between releases.
    const { status } = floorStep({ ...EMPTY, sequence: 6 });
    expect(status).toBe(0);
  });

  it("counts a malformed LIVE counter as 0, the value clients hold", () => {
    // The mirror of the case above: if the live document's counter is unreadable then every
    // client is sitting at 0, so publishing 2 is a genuine advance and must not be refused.
    const { output, status } = gate(
      { ...CHANGED, sequence: 2 },
      {
        ...EMPTY,
        sequence: "9",
      },
    );
    expect(status).toBe(0);
    expect(output).toContain("live sequence=0, publishing=2");
  });
});
