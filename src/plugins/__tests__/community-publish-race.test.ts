// §381 publish step 5 — a push that lost the race to another writer (spec 0058 §8.2). Each case
// lets a competitor push to origin during the first delivery; the retry resets to the new main
// and judges again what it is about to publish (`community-publish-world.ts`).
import type { Delivery } from "../../../scripts/community-publish";

import { afterAll, describe, expect, it } from "vitest";

import { deliverByPush, reconcile } from "../../../scripts/community-publish";
import { communityEntry } from "./community-fixture";
import { BASE, cleanUpWorlds, gitIn } from "./community-gate-world";
import {
  competitor,
  options,
  originLog,
  registry,
  ZIP,
  ZIP_SHA,
} from "./community-publish-world";

afterAll(cleanUpWorlds);

/** A push delivery that lets `race` push to origin first, on the first call only. */
function racing(race: () => void): { calls: () => number; deliver: Delivery } {
  let calls = 0;
  return {
    calls: () => calls,
    deliver: (dir) => {
      calls += 1;
      if (calls === 1) race();
      return deliverByPush(process.env)(dir);
    },
  };
}

describe(
  "reconcile — push races (spec 0058 §8.2 step 5)",
  { timeout: 120_000 },
  () => {
    it("retries after another writer lands first, and publishes on the new main", async () => {
      const r = registry();
      const run = racing(() =>
        competitor(r, { "README.md": "maintenance\n" }, "maintenance"),
      );
      const report = await reconcile(options(r, run.deliver));
      expect(report.published.map((p) => p.version)).toEqual(["1.2.0"]);
      expect(run.calls()).toBe(2);
      expect(originLog(r)).toEqual([
        "community: hello-counter 1.2.0",
        "maintenance",
        "Add hello-counter (#7)",
        "seed",
      ]);
    });

    it("retries onto the new main whatever the checkout's remote config and tags say", async () => {
      const r = registry();
      // No fetch refspec configured, and a tag that `origin/main` would resolve to before the
      // remote-tracking branch does.
      gitIn(r.work)("config", "--unset-all", "remote.origin.fetch");
      gitIn(r.work)("tag", "origin/main", "HEAD^");
      const run = racing(() =>
        competitor(r, { "README.md": "maintenance\n" }, "maintenance"),
      );
      const report = await reconcile(options(r, run.deliver));
      expect(report.published.map((p) => p.version)).toEqual(["1.2.0"]);
      expect(run.calls()).toBe(2);
    });

    it("does not move a plugin back when a newer version was published meanwhile — in this run or the next", async () => {
      const r = registry();
      const newer = communityEntry({
        checksum: "e".repeat(64),
        downloadUrl: `${BASE}plugins/hello-counter-1.3.0.zip`,
        id: "hello-counter",
        publisherId: 583231,
        repoId: 555,
        version: "1.3.0",
      });
      const run = racing(() =>
        competitor(
          r,
          {
            "community.json": `${JSON.stringify({ communityPlugins: [newer] }, null, 2)}\n`,
          },
          "community: hello-counter 1.3.0",
        ),
      );
      const report = await reconcile(options(r, run.deliver));
      expect(report.skipped).toEqual([
        {
          id: "hello-counter",
          reason:
            "a newer version (1.3.0) was published meanwhile — not moving hello-counter back to 1.2.0",
        },
      ]);
      expect(
        gitIn(r.origin)("ls-tree", "-r", "--name-only", "main"),
      ).not.toContain("hello-counter-1.2.0.zip");
      // The next run meets 1.3.0 before it downloads anything.
      const head = gitIn(r.origin)("rev-parse", "main");
      expect(await reconcile(options(r))).toEqual({
        aborted: null,
        failed: [],
        published: [],
        skipped: [
          {
            id: "hello-counter",
            reason:
              "the descriptor asks for 1.2.0, not newer than the published 1.3.0",
          },
        ],
      });
      expect(gitIn(r.origin)("rev-parse", "main")).toBe(head);
    });

    it("does not publish an id a maintainer released by deleting its descriptor while the push raced", async () => {
      const r = registry();
      let released = "";
      const run = racing(() => {
        released = competitor(
          r,
          { "community/hello-counter.json": null },
          "a maintainer releases hello-counter",
        );
      });
      expect(await reconcile(options(r, run.deliver))).toEqual({
        aborted: null,
        failed: [],
        published: [],
        skipped: [
          {
            id: "hello-counter",
            reason:
              "community/hello-counter.json changed on main meanwhile — the next run judges it",
          },
        ],
      });
      expect(run.calls()).toBe(1);
      expect(gitIn(r.origin)("rev-parse", "main").trim()).toBe(released);
    });

    it("skips what another run published meanwhile with the same bytes", async () => {
      const r = registry();
      const same = communityEntry({
        checksum: ZIP_SHA,
        publisherId: 583231,
        repoId: 555,
        version: "1.2.0",
      });
      const run = racing(() =>
        competitor(
          r,
          {
            "community.json": `${JSON.stringify({ communityPlugins: [same] }, null, 2)}\n`,
            "plugins/hello-counter-1.2.0.zip": ZIP,
          },
          "community: hello-counter 1.2.0 (another run)",
        ),
      );
      expect((await reconcile(options(r, run.deliver))).skipped).toEqual([
        {
          id: "hello-counter",
          reason: "published meanwhile by another run: hello-counter 1.2.0",
        },
      ]);
    });

    it("refuses an id index.json took meanwhile", async () => {
      const r = registry();
      const run = racing(() =>
        competitor(
          r,
          { "index.json": '{\n  "plugins": [{ "id": "hello-counter" }]\n}\n' },
          "first-party hello-counter",
        ),
      );
      expect((await reconcile(options(r, run.deliver))).failed).toEqual([
        {
          id: "hello-counter",
          pr: 7,
          reason: 'id "hello-counter" is already taken in index.json',
          stalled: false,
        },
      ]);
    });

    it("gives up after four deliveries, and takes its unpushed commit back", async () => {
      const r = registry();
      let calls = 0;
      const never: Delivery = () => {
        calls += 1;
        return Promise.resolve("stale");
      };
      const report = await reconcile(options(r, never));
      expect(calls).toBe(4);
      expect(report.failed[0].reason).toBe(
        "the delivery lost the race to main 4 times — another writer kept moving it",
      );
      // A commit left behind would ride along with the next descriptor's push.
      expect(gitIn(r.work)("rev-parse", "HEAD")).toBe(
        gitIn(r.origin)("rev-parse", "main"),
      );
      expect(gitIn(r.work)("status", "--porcelain")).toBe("");
    });
  },
);
