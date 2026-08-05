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
  chmodSync,
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

/**
 * The `run: |` body of a named step: every line indented deeper than the `run:` key.
 *
 * ‼️ THE `run:` MUST BELONG TO THE NAMED STEP (code review, then reproduced). This used to take
 * the first `run: |` at or after the step's name with no upper bound, so a step written in the
 * one-line `run: rm -f …` form made the window slide silently into the NEXT step that used the
 * block form — and the assertion then ran against a body from somewhere else entirely. Every
 * existing call site happened to survive it because each checks the content it expects; the case
 * that exposed it was a new assertion about a one-line step, which is not a shape a caller should
 * have to know about.
 */
function stepScript(workflow: string, stepName: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex(
    (line) => line.includes(stepName) && line.trimStart().startsWith("- name:"),
  );
  expect(start, `step not found: ${stepName}`).toBeGreaterThan(-1);
  const stepIndent = lines[start].length - lines[start].trimStart().length;
  const end = lines.findIndex(
    (line, i) =>
      i > start &&
      line.length - line.trimStart().length === stepIndent &&
      /^- (name|uses):/u.test(line.trimStart()),
  );
  const runAt = lines.findIndex(
    (line, i) =>
      i >= start && (end === -1 || i < end) && line.trim() === "run: |",
  );
  expect(
    runAt,
    `step "${stepName}" has no \`run: |\` block of its own`,
  ).toBeGreaterThan(-1);
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
 * The real pair frozen when the key was armed — the only bytes in the repo whose signature
 * actually verifies.
 *
 * ‼️ NEEDED BECAUSE THE GATE NOW VERIFIES THE REGISTRY'S SIGNATURE (code review MEDIUM-2). While
 * the step only ran `test -f`, a fixture of `"not checked here"` was enough, and that is exactly
 * why no case could tell a present signature from a valid one. Deciding `publish` on validity
 * means the "nothing to publish" case has to be a pair that genuinely verifies, and synthetic
 * documents cannot be signed here — there is no key.
 */
const FROZEN = resolve(
  ROOT,
  "src-tauri/src/plugin/testdata/revoked-at-arming.json",
);
const FROZEN_BODY = readFileSync(FROZEN);
const FROZEN_SIG = readFileSync(`${FROZEN}.sig`);

/**
 * The counter cases, which vary documents rather than bytes.
 *
 * Formatted the way prettier writes the real file, so `cmp` compares realistic bytes — the
 * trailing newline is part of what "byte-identical" has to mean in practice. The signature is the
 * frozen one: these cases all differ from `previous`, so the gate never reaches the branch that
 * reads it, and handing it a valid signature keeps that true if the branch order ever changes.
 */
function gate(ours: Doc, previous: Doc | null): GateRun {
  const serialise = (doc: Doc): Buffer =>
    Buffer.from(`${JSON.stringify(doc, null, 2)}\n`);
  return gateRaw(
    serialise(ours),
    previous === null ? null : serialise(previous),
    FROZEN_SIG,
  );
}

/**
 * Runs the gate with `ours` in the workspace and `previous` in the registry clone.
 *
 * ‼️ TWO DIRECTORIES, because the step reads `registry/revoked.json` relative to the workspace
 * AND `$RUNNER_TEMP/registry/revoked.json` from the clone. Pointing both at one directory —
 * which the previous harness could get away with — makes them the same file, and every case
 * would then compare a document with itself.
 *
 * `previous: null` is the bootstrap state: the registry has no list yet. `sig: null` is the state
 * before the first signing publish — list present, signature missing.
 */
function gateRaw(
  ours: Buffer,
  previous: Buffer | null,
  sig: Buffer | null,
  { unreadableSig = false }: { unreadableSig?: boolean } = {},
): GateRun {
  const dir = mkdtempSync(join(tmpdir(), "baram-gate-"));
  const workspace = join(dir, "workspace");
  const temp = join(dir, "temp");
  mkdirSync(join(workspace, "registry"), { recursive: true });
  mkdirSync(join(temp, "registry"), { recursive: true });
  writeFileSync(join(workspace, "registry/revoked.json"), ours);
  if (previous !== null) {
    writeFileSync(join(temp, "registry/revoked.json"), previous);
    if (sig !== null) {
      const path = join(temp, "registry/revoked.json.sig");
      writeFileSync(path, sig);
      // Present to `[ -f ]`, unreadable to the verifier — which is how exit 2 is reached.
      if (unreadableSig) chmodSync(path, 0o000);
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
  it("treats a byte-identical list with a VERIFYING signature as nothing to publish", () => {
    // ‼️ HIGH-3. This is the STEADY STATE, and the manual re-sync hits it every time. The pair is
    // the frozen one, so "nothing to publish" is reached through a signature that really verifies
    // rather than through a file that merely exists.
    const { output, publish, status } = gateRaw(
      FROZEN_BODY,
      FROZEN_BODY,
      FROZEN_SIG,
    );
    expect(status).toBe(0);
    expect(output).toContain("nothing to publish");
    // The flag is the whole consequence: it is what keeps the signing key out of the run.
    expect(publish).toBe("false");
  });

  it("re-signs an unchanged list whose signature is missing from the registry", () => {
    // ‼️ Security review MEDIUM-2, now visible to a test. Identical bytes with no `.sig` was
    // permanently unrecoverable: the change check said "nothing to publish", verification then
    // failed on every re-run, and the documented re-sync could not repair it.
    const { output, publish, status } = gateRaw(FROZEN_BODY, FROZEN_BODY, null);
    expect(status).toBe(0);
    expect(output).toContain("re-signing");
    expect(publish).toBe("true");
  });

  it("re-signs an unchanged list whose signature does NOT verify", () => {
    // ‼️ THE CASE `test -f` COULD NOT SEE (code review MEDIUM-2). A corrupt-but-present signature
    // used to mean "nothing to publish", so nothing re-signed — and the post-publish check added
    // in this same change then failed on every re-run, with no path back that this review chain
    // accepts. Detection without repair is worse than neither.
    const { output, publish, status } = gateRaw(
      FROZEN_BODY,
      FROZEN_BODY,
      Buffer.from("this is not a signature\n"),
    );
    expect(status).toBe(0);
    // ‼️ The two branches say different things now, so this is only satisfied by the invalid-signature
    // path (code review LOW-8). The old shared notice — "no signature or one that does not verify" —
    // made this assertion weaker than it read.
    expect(output).toContain("signature does not verify");
    expect(publish).toBe("true");
    // ‼️ NO ANNOTATION ON A GREEN STEP (code review MEDIUM-3). `::error::` is a workflow command, so
    // GitHub renders it whatever the exit status — and this is the SELF-REPAIR path, the one the
    // verification was added to enable. An operator reading an error annotation on a green run
    // learns the wrong thing, and once they are normal a real one carries nothing.
    expect(output).not.toContain("::error::");
  });

  it("FAILS rather than deciding when the verifier itself cannot run", () => {
    // ‼️ EXIT 2 IS NOT "THE SIGNATURE IS BAD" (security review L-2). Folding it into the re-sign
    // branch blamed the registry for a broken verifier of our own AND loaded the signing key into a
    // runner for a run that had nothing to publish. An unreadable signature file is the reachable
    // case: `[ -f ]` passes, `readFileSync` does not.
    const run = gateRaw(FROZEN_BODY, FROZEN_BODY, FROZEN_SIG, {
      unreadableSig: true,
    });
    expect(run.status).toBe(1);
    expect(run.output).toContain("the verifier could not run");
    expect(run.publish).toBeNull();
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

  it("counts a malformed PREVIOUS counter as 0, so a real advance is not refused", () => {
    // The mirror of the case above: a document whose counter no client can read is one no client
    // has advanced past, so publishing 2 is a genuine advance and must not be refused as a
    // rollback.
    //
    // ‼️ The earlier version of this comment said "every client is sitting at 0", which is FALSE
    // post-arming (security review LOW-3, code review LOW-4): a client starts every session at
    // `max(MINIMUM_REVOCATION_SEQUENCE, high-water)` — 1 today — so a published 2 is above the
    // floor for a different reason than this test's rationale claimed. The gate's behaviour is
    // right; the sentence justifying it was not.
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

  it("references no secret this file does not list, and signs in exactly one step", () => {
    // ‼️ WHAT THIS PROTECTS, STATED HONESTLY (security re-review M-3). It is a DRIFT GUARD for this
    // workflow: it catches an accidental widening, which is what it was written for. It is NOT an
    // anti-attacker control — capability to land a commit also covers adding a whole new workflow
    // file this test never reads. The only control for that is a protected `environment:` with a
    // required reviewer, recorded in `dev/backlog.md`. The first version of this comment invited the
    // attacker reading; the guard does not support it.
    //
    // ‼️ AN ALLOWLIST OVER EVERY `secrets` REFERENCE, not a search for the one spelling I thought of.
    // Matching `secrets.BARAM_REVOCATION_SIGNING_KEY` left three evasions green — bracket indexing
    // (`secrets['NAME']`), a case variant (Actions property lookups are case-insensitive), and
    // `toJSON(secrets)`, which dumps EVERY secret including the registry deploy key. Enumerating the
    // dangerous spellings is `enumerated-denylist-over-open-set`; enumerate the permitted lines and
    // let anything new fail instead.
    const lines = workflow.split("\n");
    const refs = lines
      .map((line, index) => ({ index, line }))
      .filter(({ line }) =>
        /secrets\s*[.[]|toJSON\s*\(\s*secrets/iu.test(line),
      );
    expect(refs.map(({ line }) => line.trim())).toEqual([
      "DEPLOY_KEY: ${{ secrets.PLUGINS_DEPLOY_KEY }}",
      "TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.BARAM_REVOCATION_SIGNING_KEY }}",
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.BARAM_REVOCATION_SIGNING_KEY_PASSWORD }}",
      "DEPLOY_KEY: ${{ secrets.PLUGINS_DEPLOY_KEY }}",
    ]);
    expect(refs.map(({ index }) => stepContaining(index))).toEqual([
      "Clone the registry",
      "Sign the list",
      "Sign the list",
      "Commit and push",
    ]);
    // ‼️ FIRST TOKENS, NOT WHOLE LINES (code review LOW-4). Whole-line equality fired on a cosmetic
    // reformat — a line continuation, `${RUNNER_TEMP}`, an added `set -euo pipefail` — and reported
    // three shell strings instead of "a command was added to the step holding the signing key".
    const body = stepScript(workflow, "Sign the list");
    const commands = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    expect(commands.map((line) => line.split(" ")[0])).toEqual(["cp", "npx"]);
    expect(body).toContain("tauri signer sign");
  });

  it("removes the deploy key it wrote, even when a step before it failed", () => {
    // A failed gate or a failed signature must not leave a key with push access to the registry
    // on a runner that goes on to execute repository TypeScript. Without `always()` the cleanup
    // is skipped on exactly the runs where it matters most.
    const cleanup = stepMeta(workflow, "Remove the deploy key from the runner");
    const push = stepMeta(workflow, "Commit and push");
    expect(cleanup.condition).toBe("always()");
    expect(cleanup.index).toBeGreaterThan(push.index);
    // ‼️ THE BODY IS READ, AND THE PATH IS DERIVED FROM THE STEP THAT WROTE IT (security review
    // MEDIUM-4). Asserting only `always()` and the position left the cleanup free to remove some
    // other path — the step would still be present, still `always()`, still after the push, and
    // the key would still be on disk. The path is taken from the clone step so the two cannot
    // drift apart silently.
    // ‼️ THE KEY IS WRITTEN TWICE NOW (security re-review M-4): the clone drops it immediately and
    // the push restores it, so its on-disk life no longer spans the gate, the signing step and the
    // pre-push verify — three steps that run `npx`, where a compromised dependency would have walked
    // off with push access to the registry without any merged commit. Both write sites are derived,
    // and the clone is asserted to remove it again.
    const writePattern = /> (~\/\.ssh\/[A-Za-z0-9_-]+)$/gmu;
    const clone = stepScript(workflow, "Clone the registry");
    const writes = [
      ...clone.matchAll(writePattern),
      ...stepScript(workflow, "Commit and push").matchAll(writePattern),
    ].map((match) => match[1]);
    expect(writes.length, "both registry steps must write the deploy key").toBe(
      2,
    );
    expect(new Set(writes).size, "both must write the same path").toBe(1);
    expect(
      stepScript(workflow, "Remove the deploy key from the runner"),
    ).toContain(`rm -f ${writes[0]}`);
    expect(
      clone,
      "the clone must not leave the key for the steps between",
    ).toContain(`rm -f ${writes[0]}`);
  });

  it("refuses to read a step that has no `run: |` block of its own", () => {
    // ‼️ THE HARDENING HAD NO TEST, and the workflow was reshaped in the same commit so nothing could
    // reach it (code review LOW-5). "Validate the list with the shipping validator" is still written
    // in the one-line `run:` form, so it is the caller that would have slid into the NEXT step's body
    // and then asserted against text from somewhere else entirely.
    expect(() =>
      stepScript(workflow, "Validate the list with the shipping validator"),
    ).toThrow(/no `run: \|` block of its own/u);
  });

  it("verifies the signature BEFORE pushing and again on what Pages serves", () => {
    // ‼️ TWO CHECKS, TWO WINDOWS. The post-publish one is the ONLY check that covers a run which
    // publishes nothing — the steady state, and the state every pair published before this gate
    // existed is in. The pre-push one earns its place on TIMING (an unverifiable pair never
    // reaches Pages) plus exactly one coverage row: when Pages lags past the retry loop the
    // post-publish step is skipped and the pre-push check is the only verification that ran. The
    // first version of this comment claimed neither subsumes the other, which overstates it — on
    // every publishing path the post-publish check is a coverage superset (code review).
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
