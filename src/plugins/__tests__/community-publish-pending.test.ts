// §381 publish step 1, the window before publishing (plan 0105 P24, spec 0058 §11) — the publish
// job re-judges who holds an id merged into main but not yet published, as the gate does: the
// numeric author of the pull request that FIRST added its descriptor since the last deletion.
// Each registry builds main's history as real commits; GitHub's answer about each commit (its
// parents, its files, the merged pull request and its author) comes from
// `community-publish-world.ts`.
import { afterAll, describe, expect, it } from "vitest";

import { reconcile } from "../../../scripts/community-publish";
import { communityEntry } from "./community-fixture";
import { sha, SUBMISSION } from "./community-gate-fixtures";
import { BASE, cleanUpWorlds } from "./community-gate-world";
import { options, registry } from "./community-publish-world";

afterAll(cleanUpWorlds);

const theirs = {
  ...SUBMISSION,
  publisher: "someone",
  repo: "someone/baram-hello-counter",
};
const TAKEOVER =
  "hello-counter is already submitted and not yet published, first added by account id 424242; a pull request from id 583231 may not replace it — only a maintainer can release hello-counter, by merging a pull request that deletes community/hello-counter.json";

describe(
  "reconcile — a merged, unpublished descriptor (plan 0105 P24)",
  { timeout: 120_000 },
  () => {
    it("refuses a descriptor another account first added and octocat's pull request rewrote", async () => {
      // someone (424242) submitted hello-counter first; it is on main but not in community.json.
      // octocat's later pull request pointed the same file at octocat's repository.
      const r = registry({ pendingHistory: [theirs] });
      expect((await reconcile(options(r))).failed).toEqual([
        { id: "hello-counter", pr: 7, reason: TAKEOVER, stalled: false },
      ]);
      // The twin: the earlier descriptor was octocat's own — the rewrite publishes.
      const own = registry({ pendingHistory: [{ ...SUBMISSION }] });
      expect(
        (await reconcile(options(own))).published.map((p) => p.id),
      ).toEqual(["hello-counter"]);
    });

    it("refuses the takeover two commits deep — the FIRST add decides, not the commit just before", async () => {
      // someone added it; a commit in between already pointed it at octocat; octocat's pull
      // request is the one being published. Looking one version back would see octocat.
      const r = registry({ pendingHistory: [theirs, { ...SUBMISSION }] });
      expect((await reconcile(options(r))).failed[0]?.reason).toBe(TAKEOVER);
    });

    it("publishes an id a maintainer released by deleting the earlier descriptor", async () => {
      // someone's descriptor was merged, then a maintainer's pull request deleted it; octocat's
      // descriptor commit is the first add after that deletion. Without the deletion this is the
      // refusal two tests up.
      const released = registry({ pendingHistory: [theirs, null] });
      expect(
        (await reconcile(options(released))).published.map((p) => p.id),
      ).toEqual(["hello-counter"]);
      // The twin: the same account deleting and re-adding its own descriptor still publishes.
      const own = registry({ pendingHistory: [{ ...SUBMISSION }, null] });
      expect(
        (await reconcile(options(own))).published.map((p) => p.id),
      ).toEqual(["hello-counter"]);
    });

    it("refuses when someone re-added the id after the deletion — only the NEWEST deletion releases", async () => {
      const r = registry({ pendingHistory: [{ ...SUBMISSION }, null, theirs] });
      expect((await reconcile(options(r))).failed[0]?.reason).toBe(TAKEOVER);
    });

    it("does not judge a published id by its first add — a maintainer may have transferred it (spec 0058 §8.5)", async () => {
      // someone first added hello-counter; the published 1.1.0 now records octocat (583231), and
      // octocat's pull request brings 1.2.0.
      const old = new Uint8Array([1, 2, 3]);
      const r = registry({
        pendingHistory: [theirs],
        preexisting: { "plugins/hello-counter-1.1.0.zip": old },
        published: [
          communityEntry({
            checksum: sha(old),
            downloadUrl: `${BASE}plugins/hello-counter-1.1.0.zip`,
            publisherId: 583231,
            repoId: 555,
            version: "1.1.0",
          }),
        ],
      });
      expect(
        (await reconcile(options(r))).published.map((p) => p.version),
      ).toEqual(["1.2.0"]);
    });
  },
);
