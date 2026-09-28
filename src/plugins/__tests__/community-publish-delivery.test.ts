// §381 — one run over two descriptors, and how a delivery ends (spec 0058 §8.2): main may take
// the release as another commit with the same tree, a remote may refuse a push outright, and a
// lookup may throw. None of these may cost a later descriptor a delivery or drop the report of
// an earlier one (`community-publish-world.ts`).
import type { Delivery } from "../../../scripts/community-publish";

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { deliverByPush, reconcile } from "../../../scripts/community-publish";
import { BASE, cleanUpWorlds, gitIn, tempDir } from "./community-gate-world";
import {
  competitor,
  options,
  originLog,
  registry,
  ZIP_SHA,
} from "./community-publish-world";

afterAll(cleanUpWorlds);

const HELLO = {
  checksum: ZIP_SHA,
  downloadUrl: `${BASE}plugins/hello-counter-1.2.0.zip`,
  id: "hello-counter",
  version: "1.2.0",
};

describe(
  "reconcile — deliveries and a run over two descriptors",
  { timeout: 120_000 },
  () => {
    it("spends one delivery per descriptor when main takes each tree as a new commit", async () => {
      const r = registry({ second: true });
      let calls = 0;
      // A pull request squash-merged: main gets the clone's tree under another commit.
      const squash: Delivery = (dir) => {
        calls += 1;
        const commit = gitIn(dir)(
          "commit-tree",
          "HEAD^{tree}",
          "-p",
          "HEAD^",
          "-m",
          `Publish (#${100 + calls})`,
        ).trim();
        const pushed = spawnSync("git", [
          "-C",
          dir,
          "push",
          "--quiet",
          "origin",
          `${commit}:refs/heads/main`,
        ]);
        return Promise.resolve(pushed.status === 0 ? "delivered" : "stale");
      };
      const report = await reconcile(options(r, squash));
      expect(report.published.map((p) => p.id)).toEqual([
        "hello-counter",
        "word-counter",
      ]);
      expect(calls).toBe(2);
      expect(originLog(r).slice(0, 2)).toEqual([
        "Publish (#102)",
        "Publish (#101)",
      ]);
    });

    it("aborts on a push the remote refuses, instead of retrying it as a lost race", async () => {
      const r = registry();
      writeFileSync(
        join(r.origin, "hooks", "pre-receive"),
        "#!/bin/sh\nexit 1\n",
        { mode: 0o755 },
      );
      let calls = 0;
      const counted: Delivery = (dir) => {
        calls += 1;
        return deliverByPush(process.env)(dir);
      };
      const report = await reconcile(options(r, counted));
      expect(calls).toBe(1);
      expect(report.aborted).toMatch(/^hello-counter: git push failed: /u);
      expect(report.aborted).toContain(
        "[remote rejected] HEAD -> main (pre-receive hook declined)",
      );
      expect(report.failed).toEqual([]);
      expect(report.published).toEqual([]);
      // Back on main after the abort: no commit main refused is left for `live` or the size count.
      expect(gitIn(r.work)("rev-parse", "HEAD")).toBe(
        gitIn(r.origin)("rev-parse", "main"),
      );
      expect(gitIn(r.work)("status", "--porcelain")).toBe("");
    });

    it("keeps a delivered release in the report when the reset after it throws", async () => {
      const r = registry();
      const cut: Delivery = async (dir) => {
        const landed = await deliverByPush(process.env)(dir);
        // origin now names nothing, so the fetch that follows a delivery throws.
        gitIn(dir)("remote", "set-url", "origin", join(r.base, "gone.git"));
        return landed;
      };
      const report = await reconcile(options(r, cut));
      expect(report.published).toEqual([HELLO]);
      expect(report.aborted).toMatch(/^hello-counter: Command failed: git /u);
    });

    it("reads git's refusal in English whatever the runner's language — the push runs with LC_ALL=C", async () => {
      // A git that answers in German unless LC_ALL=C, first on the child's PATH.
      const bin = tempDir("baram-fake-git-");
      writeFileSync(
        join(bin, "git"),
        [
          "#!/bin/sh",
          'if [ "$LC_ALL" = "C" ]; then',
          "  echo ' ! [rejected]        HEAD -> main (fetch first)' >&2",
          "else",
          "  echo ' ! [abgelehnt]       HEAD -> main (zuerst holen)' >&2",
          "fi",
          "exit 1",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const env = {
        ...process.env,
        LC_ALL: "de_DE.UTF-8",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      };
      expect(await deliverByPush(env)(bin)).toBe("stale");
    });

    it("stops at a lookup that throws, and still reports what it published before", async () => {
      const r = registry({ second: true });
      const report = await reconcile({
        ...options(r),
        api: (path) =>
          path === "repos/octocat/baram-word-counter"
            ? Promise.reject(new Error("fetch failed"))
            : r.api(path),
      });
      expect(report).toEqual({
        aborted: "word-counter: fetch failed",
        failed: [],
        published: [HELLO],
        skipped: [],
      });
    });

    it("skips a descriptor that left main while an earlier one was being published", async () => {
      const r = registry({ second: true });
      let calls = 0;
      const racing: Delivery = (dir) => {
        calls += 1;
        if (calls === 1)
          competitor(
            r,
            { "community/word-counter.json": null },
            "a maintainer releases word-counter",
          );
        return deliverByPush(process.env)(dir);
      };
      expect(await reconcile(options(r, racing))).toEqual({
        aborted: null,
        failed: [],
        published: [HELLO],
        skipped: [
          {
            id: "word-counter",
            reason:
              "community/word-counter.json was removed from main meanwhile",
          },
        ],
      });
    });
  },
);
