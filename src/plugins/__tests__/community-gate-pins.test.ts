// §380 — gate checks no other test would miss (plan 0105 Task 9): gate 1's registry size cap,
// gate 7's engines floor, the reason an update of a published entry that is not sandboxed gives,
// and the label on every reason line the CLI prints. Each refusal has its twin beside it.
import { statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { gateReport, runGate } from "../../../scripts/community-gate";
import { validManifest } from "./community-gate-fixtures";
import {
  cleanUpWorlds,
  gate,
  outcome,
  published,
  world,
} from "./community-gate-world";

afterAll(cleanUpWorlds);

describe("runGate — checks pinned one by one", { timeout: 60_000 }, () => {
  it("1: a community.json larger than the app's registry fetch reads, and one exactly at it", async () => {
    const w = world();
    const size = statSync(join(w.input.publishedRoot, "community.json")).size;
    expect(
      await runGate(w.input, { ...w.deps, registryCap: size - 1 }),
    ).toEqual({
      kind: "refused",
      reason: `community.json is ${size} bytes, over the app's ${size - 1}-byte registry limit`,
      step: 1,
    });
    expect(
      (await runGate(w.input, { ...w.deps, registryCap: size })).kind,
    ).toBe("passed");
  });

  it('7: an engines.baram that is not a ">=X.Y.Z" floor — the passing world\'s ">=0.6.1" is the twin', async () => {
    expect(
      await outcome({
        manifest: validManifest({ engines: { baram: "^0.6.1" } }),
      }),
    ).toBe('7: engines.baram "^0.6.1" must be ">=X.Y.Z"');
    expect(await outcome()).toBe("auto-merge");
  });

  it("sends an update of a published entry that is not sandboxed to a person, saying why", async () => {
    expect(
      await gate({ community: [published({ trust: "trusted" })] }),
    ).toMatchObject({
      decision: "needs-review",
      reasons: [
        "the published entry is not sandboxed — nothing to compare an update against",
      ],
    });
    // The twin: the same update over the sandboxed entry merges itself.
    expect(await gate()).toMatchObject({
      decision: "auto-merge",
      reasons: [],
    });
  });
});

describe("gateReport — reason lines", () => {
  it("labels every reason it prints, and cuts none of them", () => {
    const reason = `name changed\n::error title=forged::${"x".repeat(80)}`;
    expect(
      gateReport({
        decision: "needs-review",
        id: "hello-counter",
        kind: "passed",
        reasons: [reason],
        version: "1.2.0",
      }),
    ).toEqual([
      "✓ community gate: hello-counter 1.2.0 → needs-review",
      `    name changed⏎∷error title=forged∷${"x".repeat(80)}`,
    ]);
  });
});
