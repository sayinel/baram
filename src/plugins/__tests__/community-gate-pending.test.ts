// §380 gate 3, the window before publishing (plan 0105 P24, spec 0058 §11) — an id merged into
// main but not yet published belongs to whoever's pull request FIRST added its descriptor since
// the last deletion. Each world builds main's history as real commits; GitHub's answer about
// each commit (its parent, its file status, the merged pull request and its author) comes from
// `community-gate-world.ts`.
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

import { runGate } from "../../../scripts/community-gate";
import { SUBMISSION } from "./community-gate-fixtures";
import { cleanUpWorlds, outcome, tempDir, world } from "./community-gate-world";

afterAll(cleanUpWorlds);

const theirs = {
  ...SUBMISSION,
  publisher: "someone",
  repo: "someone/baram-hello-counter",
};
const TAKEOVER =
  "3: hello-counter is already submitted and not yet published, first added by account id 424242; a pull request from id 583231 may not replace it — only a maintainer can release hello-counter, by merging a pull request that deletes community/hello-counter.json";

describe(
  "runGate — a merged, unpublished descriptor",
  { timeout: 60_000 },
  () => {
    it("3: taking over another account's merged but unpublished descriptor", async () => {
      expect(await outcome({ community: [], pendingHistory: [theirs] })).toBe(
        TAKEOVER,
      );
      // The twin: the pending descriptor is the author's own (octocat) — an ordinary new registration.
      expect(
        await outcome({ community: [], pendingHistory: [{ ...SUBMISSION }] }),
      ).toBe("needs-review");
    });

    it("3: taking over even two commits deep — the FIRST add decides, not the latest commit", async () => {
      // someone added hello-counter; a later commit on main already points it at octocat's
      // repository. A rule that looked only at the latest commit would see octocat's edit.
      expect(
        await outcome({
          community: [],
          pendingHistory: [theirs, { ...SUBMISSION }],
        }),
      ).toBe(TAKEOVER);
    });

    it("3: a maintainer's deletion releases the id — adds before the NEWEST deletion stop counting", async () => {
      // someone's descriptor was merged, then a maintainer's pull request deleted it: octocat may register the id.
      expect(
        await outcome({ community: [], pendingHistory: [theirs, null] }),
      ).toBe("needs-review");
      // The twin: the same account deleting and re-adding its own descriptor still owns it.
      expect(
        await outcome({
          community: [],
          pendingHistory: [{ ...SUBMISSION }, null, { ...SUBMISSION }],
        }),
      ).toBe("needs-review");
      // Only what came before the deletion is released: someone re-added the id after it, and holds it.
      expect(
        await outcome({
          community: [],
          pendingHistory: [{ ...SUBMISSION }, null, theirs],
        }),
      ).toBe(TAKEOVER);
    });

    it("3: throws on a shallow clone of main instead of reading a first add it cannot see", async () => {
      // Two commits deep, so a depth-1 clone would show octocat's edit as the first add.
      const w = world({
        community: [],
        pendingHistory: [theirs, { ...SUBMISSION }],
      });
      const shallow = tempDir("baram-gate-shallow-");
      execFileSync("git", [
        "clone",
        "--quiet",
        "--depth",
        "1",
        `file://${w.input.publishedRoot}`,
        shallow,
      ]);
      await expect(
        runGate({ ...w.input, publishedRoot: shallow }, w.deps),
      ).rejects.toThrow(/fetch-depth: 0/u);
      // The twin: the same main, cloned whole, is judged — and refused as the takeover it is.
      const full = tempDir("baram-gate-full-");
      execFileSync("git", [
        "clone",
        "--quiet",
        `file://${w.input.publishedRoot}`,
        full,
      ]);
      const judged = await runGate({ ...w.input, publishedRoot: full }, w.deps);
      expect(
        judged.kind === "refused"
          ? `${judged.step}: ${judged.reason}`
          : judged.kind,
      ).toBe(TAKEOVER);
    });
  },
);
