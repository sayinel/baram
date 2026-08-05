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
// this whole file exists to prevent. Nothing is substituted any more: the gate's baseline is the
// registry clone rather than a Pages URL, so the step has no IO left to stub.
//
// The second block of cases asserts the workflow's SHAPE — step order, conditions, and which
// step holds the signing key. Each case above extracts one step and runs it alone, so a step
// moved or a condition changed alters what the workflow means while every one of them stays
// green; three of the findings this file exists for were exactly that.
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

import { MINIMUM_REVOCATION_SEQUENCE } from "../revocation";

const ROOT = resolve(__dirname, "../../..");
const WORKFLOW = resolve(ROOT, ".github/workflows/revocation-publish.yml");
const STEP = "A changed list must carry a higher counter than the registry's";

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

// ‼️ RUN VERBATIM, WITH NOTHING SUBSTITUTED (code review MEDIUM-1 follow-on). The gate used to
// curl Pages for its baseline, so the harness had to rewrite that one line — a test of the step
// with its only IO replaced. Comparing against the registry CLONE instead made the step
// hermetic: two files and the shipping counter reader, no network, so what runs below is the
// text that runs on main.
const SCRIPT = stepScript(readFileSync(WORKFLOW, "utf8"), STEP);
// Proof the block extracted — deliberately NOT a check on what it contains. Asserting on
// `cmp -s` here made an earlier harness REFUSE a mutant that deleted it, which reads as a kill
// and is not one.
expect(SCRIPT).toContain("revocation-sequence.ts");

interface Doc {
  revoked: unknown[];
  sequence?: unknown;
  version: number;
}

interface GateRun {
  output: string;
  publish: null | string;
  status: null | number;
}

/**
 * Runs the gate with `ours` in the workspace and `previous` in the registry clone.
 *
 * ‼️ TWO DIRECTORIES, because the step reads `registry/revoked.json` relative to the workspace
 * AND `$RUNNER_TEMP/registry/revoked.json` from the clone. Pointing both at one directory —
 * which the previous harness could get away with — makes them the same file, and every case
 * would then compare a document with itself.
 *
 * `previous: null` is the bootstrap state: the registry has no list yet. `signed: false` is the
 * state before the first signing publish — list present, signature missing.
 */
function gate(
  ours: Doc,
  previous: Doc | null,
  { signed = true }: { signed?: boolean } = {},
): GateRun {
  const dir = mkdtempSync(join(tmpdir(), "baram-gate-"));
  const workspace = join(dir, "workspace");
  const temp = join(dir, "temp");
  mkdirSync(join(workspace, "registry"), { recursive: true });
  mkdirSync(join(temp, "registry"), { recursive: true });
  // Formatted the way prettier writes the real file, so `cmp` compares realistic bytes —
  // the trailing newline is part of what "byte-identical" has to mean in practice.
  writeFileSync(
    join(workspace, "registry/revoked.json"),
    `${JSON.stringify(ours, null, 2)}\n`,
  );
  if (previous !== null) {
    writeFileSync(
      join(temp, "registry/revoked.json"),
      `${JSON.stringify(previous, null, 2)}\n`,
    );
    if (signed) {
      writeFileSync(
        join(temp, "registry/revoked.json.sig"),
        "not checked here",
      );
    }
  }
  // `registry/revoked.json` is a relative path in the workflow, so the gate runs from the
  // workspace with the real scripts reachable from it.
  for (const name of ["scripts", "src", "node_modules"]) {
    symlinkSync(join(ROOT, name), join(workspace, name));
  }
  // The step decides whether signing happens by writing to `$GITHUB_OUTPUT`, so the file is
  // real and its contents are part of what these cases assert.
  const outputFile = join(dir, "step-output");
  writeFileSync(outputFile, "");
  // `bash -e` is what Actions uses for a `run:` block on ubuntu — the failure semantics are
  // part of the behaviour under test.
  const result = spawnSync("bash", ["-e", "-c", SCRIPT], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: temp,
    },
  });
  return {
    output: `${result.stdout}${result.stderr}`,
    publish:
      /publish=(\w+)/u.exec(readFileSync(outputFile, "utf8"))?.[1] ?? null,
    status: result.status,
  };
}

// ‼️ The floor step is extracted the same way and run the same way, because it has the same
// property that made the counter gate dangerous: it is shell, so nothing but a push to main ever
// executes it. It takes no arguments — the floor comes from the SHIPPED constant via
// `revocation-floor.ts` — so these cases vary the published counter and read the real floor.
const FLOOR_STEP = "The app's floor must track the list just verified live";
const FLOOR_SCRIPT = stepScript(readFileSync(WORKFLOW, "utf8"), FLOOR_STEP);
expect(FLOOR_SCRIPT).toContain("revocation-floor.ts");

// ‼️ FIXTURES ARE DERIVED, NOT HARD-CODED (security review MEDIUM-3). The first version pinned
// them to floor 1 and lag 5, so the NEXT release — the one that does the single thing this whole
// mechanism asks for, raising the floor — would arrive to two red tests of its own making, and
// the path of least resistance would be to edit the assertions instead of the constant. Both
// numbers now come from the things under test: the shipped constant, and the step's own MAX_LAG.
const FLOOR = MINIMUM_REVOCATION_SEQUENCE;
const MAX_LAG = Number(/MAX_LAG=(\d+)/u.exec(FLOOR_SCRIPT)?.[1]);
expect(
  Number.isSafeInteger(MAX_LAG),
  "MAX_LAG must be readable from the step",
).toBe(true);
// The "floor above live" case needs a counter BELOW the floor to exist, which needs a floor above
// zero. True since arming; asserted so the case cannot quietly become vacuous if that changes.
expect(FLOOR, "these cases assume an armed floor").toBeGreaterThan(0);

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

/**
 * A named step's line index and its single `if:` condition.
 *
 * ‼️ WINDOWED, AND THE MATCH COUNT IS ASSERTED. A bare search for `if: success()` would find *a*
 * condition rather than *the* one — the mistake `source-scan-guards-find-a-match` is about, and one
 * this feature has already made four times.
 */
function stepMeta(
  workflow: string,
  stepName: string,
): { condition: null | string; index: number } {
  const lines = workflow.split("\n");
  const index = lines.findIndex(
    (line) => line.includes(stepName) && line.trimStart().startsWith("- name:"),
  );
  expect(index, `step not found: ${stepName}`).toBeGreaterThan(-1);
  const indent = lines[index].length - lines[index].trimStart().length;
  const next = lines.findIndex(
    (line, i) =>
      i > index &&
      line.length - line.trimStart().length === indent &&
      /^- (name|uses):/u.test(line.trimStart()),
  );
  const block = lines.slice(index, next === -1 ? undefined : next);
  const conditions = block.filter((line) => /^if:/u.test(line.trim()));
  // Zero is legitimate — most steps have no condition — but MORE than one means the window caught
  // a neighbouring step, and then "the condition" is whichever one happened to come first.
  expect(
    conditions.length,
    `ambiguous window: ${conditions.length} \`if:\` lines in "${stepName}"`,
  ).toBeLessThan(2);
  return {
    condition: conditions[0]?.trim().slice(3).trim() ?? null,
    index,
  };
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
  it("treats a byte-identical signed list as nothing to publish, not as a rollback", () => {
    // ‼️ HIGH-3. This is the STEADY STATE, and the manual re-sync hits it every time.
    const { output, publish, status } = gate(EMPTY, EMPTY);
    expect(status).toBe(0);
    expect(output).toContain("nothing to publish");
    // The flag is the whole consequence: it is what keeps the signing key out of the run.
    expect(publish).toBe("false");
  });

  it("re-signs an unchanged list whose signature is missing from the registry", () => {
    // ‼️ Security review MEDIUM-2, now visible to a test. Identical bytes with no `.sig` was
    // permanently unrecoverable: the change check said "nothing to publish", verification then
    // failed on every re-run, and the documented re-sync could not repair it.
    const { output, publish, status } = gate(EMPTY, EMPTY, { signed: false });
    expect(status).toBe(0);
    expect(output).toContain("re-signing");
    expect(publish).toBe("true");
  });

  it("publishes without a comparison when the registry has no list yet", () => {
    // The bootstrap path the workflow header documents. Nothing to roll back over.
    const { output, publish, status } = gate(EMPTY, null);
    expect(status).toBe(0);
    expect(output).toContain("bootstrap");
    expect(publish).toBe("true");
  });

  it("passes a changed list whose counter advances", () => {
    const { output, publish, status } = gate(
      { ...CHANGED, sequence: 2 },
      EMPTY,
    );
    expect(status).toBe(0);
    expect(output).toContain("registry sequence=1, publishing=2");
    expect(publish).toBe("true");
  });

  it("REFUSES a changed list that reuses the registry's counter", () => {
    // The gate's actual job: the content moved and the counter did not, so every armed
    // client would refuse the list as a rollback and the revocation would do nothing.
    const { output, publish, status } = gate(CHANGED, EMPTY);
    expect(status).toBe(1);
    expect(output).toContain("sequence must increase");
    // ‼️ Asserted, not assumed: a refusal that still wrote `publish=true` would sign and push
    // the list the step just called a rollback, since the flag and the exit code are separate.
    expect(publish).toBeNull();
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

  it("REFUSES a counter written as a JSON string, which clients read as 0", () => {
    // ‼️ HIGH-2 at the gate. The python this replaced compared it as 2 and published; the
    // shipping reader makes the gate lose exactly what a client loses.
    const { output, status } = gate({ ...CHANGED, sequence: "2" }, EMPTY);
    expect(status).toBe(1);
    expect(output).toContain("publishing=0");
  });

  it("runs AFTER the step that proves the repo copy is what Pages serves", () => {
    // ‼️ THIS ORDERING IS LOAD-BEARING AND NOTHING ELSE CAN SEE IT. The step reads the counter from
    // `registry/revoked.json`, which is only the PUBLISHED counter because the verify step above it
    // has already `cmp`d that file against what Pages serves — and only when `success()` means that
    // comparison held. Move this step above verify, or restore `always()`, and its name becomes a
    // claim it no longer measures, silently. The cases below extract the step by name and run it in
    // isolation, so they structurally cannot notice either change.
    const workflow = readFileSync(WORKFLOW, "utf8");
    const verify = stepMeta(
      workflow,
      "Verify the live list is served and readable",
    );
    const floor = stepMeta(workflow, FLOOR_STEP);
    expect(floor.index).toBeGreaterThan(verify.index);
    expect(floor.condition).toBe("success()");
  });

  it("passes when the floor equals what was published", () => {
    // Steady state right after a release that raised the floor.
    const { output, status } = floorStep({ ...EMPTY, sequence: FLOOR });
    expect(status).toBe(0);
    expect(output).toContain(`app floor=${FLOOR}`);
  });

  it("REFUSES a floor above the published counter, which bricks every client", () => {
    // ‼️ The direction with no tolerance. A floor above the live counter makes every client
    // refuse the REAL list, and it presents as the feature working. Reached here by publishing a
    // counter BELOW the shipped floor, which is the same inequality.
    const { output, status } = floorStep({ ...EMPTY, sequence: FLOOR - 1 });
    expect(status).toBe(1);
    expect(output).toContain("is ABOVE the published counter");
  });

  it("REFUSES a floor that has fallen too far behind", () => {
    // The silent direction, and the reason this step exists: revocations keep being published
    // while no release carries the floor forward, so every restart accepts a replayed older
    // signed list and nothing anywhere says so.
    const { output, status } = floorStep({
      ...EMPTY,
      sequence: FLOOR + MAX_LAG + 1,
    });
    expect(status).toBe(1);
    expect(output).toContain("lags the published counter");
  });

  it("tolerates a gap exactly at the limit, because the floor moves only at release time", () => {
    // A gate that demanded equality would fail every publish between releases, so the boundary
    // itself has to pass — and it is the boundary that a `>` / `>=` slip moves.
    const { status } = floorStep({ ...EMPTY, sequence: FLOOR + MAX_LAG });
    expect(status).toBe(0);
  });

  it("counts a malformed PREVIOUS counter as 0, the value clients hold", () => {
    // The mirror of the case above: if the published document's counter is unreadable then
    // every client is sitting at 0, so publishing 2 is a genuine advance and must not be
    // refused.
    const { output, status } = gate(
      { ...CHANGED, sequence: 2 },
      {
        ...EMPTY,
        sequence: "9",
      },
    );
    expect(status).toBe(0);
    expect(output).toContain("registry sequence=0, publishing=2");
  });
});

// ‼️ THESE ASSERT THE WORKFLOW'S SHAPE, WHICH NO CASE ABOVE CAN SEE. Each step is extracted and
// run in isolation, so a step moved, deleted, or given the wrong condition changes what the
// workflow means while every behavioural case stays green — and three of the findings this file
// exists for were exactly that: a claim in a step's name that its position no longer supported.
describe("the revocation publish workflow's shape", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");

  /** The `- name:` of the step a given line falls inside. */
  function stepContaining(line: number): string {
    const lines = workflow.split("\n");
    for (let i = line; i >= 0; i--) {
      const match = /^- name: (.+)$/u.exec(lines[i].trim());
      if (match) return match[1];
    }
    throw new Error(`line ${line} is not inside a named step`);
  }

  it("puts the signing key in exactly one step, and that step only signs", () => {
    // ‼️ THE BLAST RADIUS IS THE PROPERTY (security review LOW). Any merge touching
    // `registry/revoked.json` runs this workflow with the revocation signing key available, and
    // the same merge can land arbitrary repository TypeScript. Job-level env, or one more step
    // inside the block that holds it, silently hands the key to `npx tsx` — so the count is
    // asserted rather than the placement being left to review.
    const lines = workflow.split("\n");
    // ‼️ Anchored at the line start and ending at the colon: `TAURI_SIGNING_PRIVATE_KEY` is a
    // PREFIX of `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, so a substring search finds two lines and
    // "exactly one" would be unsatisfiable for a correct workflow.
    const keyLines = lines
      .map((line, index) => ({ index, line }))
      .filter(({ line }) => /^TAURI_SIGNING_PRIVATE_KEY:/u.test(line.trim()));
    expect(keyLines).toHaveLength(1);
    const owner = stepContaining(keyLines[0].index);
    expect(owner).toBe("Sign the list");
    const body = stepScript(workflow, owner);
    expect(body).toContain("tauri signer sign");
    // The two things that must NOT share the environment: this repository's scripts, and the
    // push. Both were in this step before it was split.
    expect(body).not.toContain("npx tsx");
    expect(body).not.toContain("git push");
  });

  it("removes the deploy key even when a step before it failed", () => {
    // A failed gate or a failed signature must not leave a key with push access to the registry
    // on a runner that goes on to execute repository TypeScript. Without `always()` the cleanup
    // is skipped on exactly the runs where it matters most.
    const cleanup = stepMeta(workflow, "Remove the deploy key from the runner");
    const push = stepMeta(workflow, "Commit and push");
    expect(cleanup.condition).toBe("always()");
    expect(cleanup.index).toBeGreaterThan(push.index);
  });

  it("verifies the signature BEFORE pushing and again on what Pages serves", () => {
    // ‼️ TWO CHECKS, TWO WINDOWS, AND NEITHER SUBSUMES THE OTHER. The pre-push one keeps an
    // unverifiable pair off Pages; the post-publish one is the ONLY check that covers a run
    // which publishes nothing, which is the steady state and the state every pair published
    // before this gate existed is in. Collapse them into one and one of those goes uncovered.
    const beforePush = stepMeta(
      workflow,
      "An armed client must accept the signed list",
    );
    const push = stepMeta(workflow, "Commit and push");
    const served = stepMeta(
      workflow,
      "An armed client must accept what Pages serves",
    );
    const verify = stepMeta(
      workflow,
      "Verify the live list is served and readable",
    );
    expect(beforePush.index).toBeLessThan(push.index);
    // Gated on there being something to publish — it reads the freshly signed file, which only
    // the signing step creates.
    expect(beforePush.condition).toBe("steps.gate.outputs.publish == 'true'");
    // Reads `$RUNNER_TEMP/live.*`, which only the verify step above it downloads.
    expect(served.index).toBeGreaterThan(verify.index);
    expect(served.condition).toBeNull();
  });

  it("signs and pushes only when the gate says there is something to publish", () => {
    // The flag is what keeps an ordinary re-run from re-signing and re-pushing an unchanged
    // list — and, since minisign stamps a timestamp, from rebuilding Pages on every run.
    for (const step of [
      "Sign the list",
      "An armed client must accept the signed list",
      "Commit and push",
    ]) {
      expect(stepMeta(workflow, step).condition).toBe(
        "steps.gate.outputs.publish == 'true'",
      );
    }
  });
});
