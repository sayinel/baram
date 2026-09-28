// §381 — the sweep a pull request delivery runs first: a run killed between posting `validate` and
// closing its pull request leaves that pull request open, and its status green (plan 0105 P11).
// `gh` is the recorded fake (`community-pull-request-world.ts`); nothing here reaches the network.
import type { OpenPullRequest } from "./community-pull-request-world";

import { afterAll, describe, expect, it } from "vitest";

import { sweepAbandonedPullRequests } from "../../../scripts/community-pull-request";
import { cleanUpWorlds, gitIn } from "./community-gate-world";
import {
  branchExists,
  clone,
  recorder,
  REPO,
} from "./community-pull-request-world";

afterAll(cleanUpWorlds);

const LIST = [
  "pr",
  "list",
  "--repo",
  REPO,
  "--state",
  "open",
  "--json",
  "number,headRefName,headRefOid,isCrossRepository",
  "--limit",
  "1000",
];

/**
 * A registry clone whose origin holds the branches of two abandoned deliveries (#7, #8), besides
 * a contributor's pull request (#5) and a fork's branch with the same prefix (#6).
 */
function leftovers(): {
  open: OpenPullRequest[];
  origin: string;
  sha: string;
  work: string;
} {
  const { origin, work } = clone();
  const git = gitIn(work);
  const sha = git("rev-parse", "HEAD").trim();
  git("push", "--quiet", "origin", "HEAD:refs/heads/community-publish/1-1-1");
  git("push", "--quiet", "origin", "HEAD:refs/heads/community-publish/1-2-1");
  const pr = (
    number: number,
    headRefName: string,
    isCrossRepository = false,
  ) => ({
    headRefName,
    headRefOid: sha,
    isCrossRepository,
    number,
  });
  return {
    open: [
      pr(5, "add-hello-counter"),
      pr(6, "community-publish/from-a-fork", true),
      pr(7, "community-publish/1-1-1"),
      pr(8, "community-publish/1-2-1"),
    ],
    origin,
    sha,
    work,
  };
}

/** The commits of pull request `number`, as the sweep asks for them. */
const view = (number: number) => [
  "pr",
  "view",
  String(number),
  "--repo",
  REPO,
  "--json",
  "commits",
  "--jq",
  ".commits[].oid",
];

const status = (sha: string) => [
  "api",
  "-X",
  "POST",
  `repos/${REPO}/statuses/${sha}`,
  "-f",
  "state=error",
  "-f",
  "context=validate",
  "-f",
  "description=withdrawn by publish-community: this commit was not merged",
];

describe("sweepAbandonedPullRequests", { timeout: 60_000 }, () => {
  it("withdraws validate on, closes and deletes the branch of every pull request a delivery left open", () => {
    const { open: before, origin, sha, work } = leftovers();
    const { calls, gh, open } = recorder(origin, { open: before });
    expect(
      sweepAbandonedPullRequests({
        gh,
        gitEnv: process.env,
        registryDir: work,
        registryRepo: REPO,
      }),
    ).toEqual([
      `closed pull request #7 (community-publish/1-1-1) and withdrew its validate status on ${sha}`,
      `closed pull request #8 (community-publish/1-2-1) and withdrew its validate status on ${sha}`,
    ]);
    expect(calls).toEqual([
      LIST,
      view(7),
      status(sha),
      ["pr", "close", "7", "--repo", REPO],
      view(8),
      status(sha),
      ["pr", "close", "8", "--repo", REPO],
    ]);
    expect(open()).toEqual([5, 6]);
    expect(branchExists(origin, "community-publish/1-1-1")).toBe(false);
    expect(branchExists(origin, "community-publish/1-2-1")).toBe(false);
  });

  it("withdraws validate on every commit of a leftover someone pushed to, not only its head", () => {
    const { origin, sha, work } = leftovers();
    const pushed = "c".repeat(40);
    const { calls, gh, open } = recorder(origin, {
      open: [
        {
          commits: [sha, pushed],
          headRefName: "community-publish/1-1-1",
          headRefOid: pushed,
          isCrossRepository: false,
          number: 7,
        },
      ],
    });
    expect(
      sweepAbandonedPullRequests({
        gh,
        gitEnv: process.env,
        registryDir: work,
        registryRepo: REPO,
      }),
    ).toEqual([
      `closed pull request #7 (community-publish/1-1-1) and withdrew its validate status on ${sha}, ${pushed}`,
    ]);
    expect(calls).toEqual([
      LIST,
      view(7),
      status(sha),
      status(pushed),
      ["pr", "close", "7", "--repo", REPO],
    ]);
    expect(open()).toEqual([]);
  });

  it("still withdraws the head and closes when the commits cannot be read, then throws naming it", () => {
    const { open: before, origin, sha, work } = leftovers();
    const { calls, gh, open } = recorder(origin, {
      open: before.slice(2, 3),
      refuse: { "pr view": "HTTP 502" },
    });
    expect(() =>
      sweepAbandonedPullRequests({
        gh,
        gitEnv: process.env,
        registryDir: work,
        registryRepo: REPO,
      }),
    ).toThrow(
      `pull requests a publish run left open could not all be closed: #7: reading the commits of pull request #7 failed (HTTP 502), so only its head ${sha} was withdrawn; post state=error context=validate on its other commits by hand`,
    );
    expect(calls).toEqual([
      LIST,
      view(7),
      status(sha),
      ["pr", "close", "7", "--repo", REPO],
    ]);
    expect(open()).toEqual([]);
  });

  it("makes no call beyond the list when nothing was left open", () => {
    const { open: before, origin, work } = leftovers();
    const { calls, gh, open } = recorder(origin, { open: before.slice(0, 2) });
    expect(
      sweepAbandonedPullRequests({
        gh,
        gitEnv: process.env,
        registryDir: work,
        registryRepo: REPO,
      }),
    ).toEqual([]);
    expect(calls).toEqual([LIST]);
    expect(open()).toEqual([5, 6]);
  });

  it("tries every leftover before it throws on one it could not close", () => {
    const { open: before, origin, work } = leftovers();
    const { calls, gh } = recorder(origin, {
      open: before,
      refuse: { "pr close": "HTTP 502" },
    });
    expect(() =>
      sweepAbandonedPullRequests({
        gh,
        gitEnv: process.env,
        registryDir: work,
        registryRepo: REPO,
      }),
    ).toThrow(
      "pull requests a publish run left open could not all be closed: #7: closing pull request #7 failed (HTTP 502); close it by hand before anyone merges it; #8: closing pull request #8 failed (HTTP 502); close it by hand before anyone merges it",
    );
    expect(calls.filter((args) => args[1] === "close")).toHaveLength(2);
  });

  it("throws when the open pull requests cannot be listed", () => {
    const { origin, work } = leftovers();
    const { gh } = recorder(origin, { refuse: { "pr list": "HTTP 401" } });
    expect(() =>
      sweepAbandonedPullRequests({
        gh,
        gitEnv: process.env,
        registryDir: work,
        registryRepo: REPO,
      }),
    ).toThrow("gh pr list failed: HTTP 401");
  });

  it("throws when gh pr list prints something other than a list of pull requests", () => {
    const { origin, work } = leftovers();
    const { gh } = recorder(origin, {
      refuse: {
        "pr list": { status: 0, stderr: "", stdout: '[{"number":7}]' },
      },
    });
    expect(() =>
      sweepAbandonedPullRequests({
        gh,
        gitEnv: process.env,
        registryDir: work,
        registryRepo: REPO,
      }),
    ).toThrow(
      "gh pr list printed something other than a list of pull requests",
    );
  });

  it("throws when the list may have been cut at its limit", () => {
    const { origin, sha, work } = leftovers();
    const full = Array.from({ length: 1000 }, (_, n) => ({
      headRefName: `add-plugin-${n}`,
      headRefOid: sha,
      isCrossRepository: true,
      number: 100 + n,
    }));
    const { gh } = recorder(origin, { open: full });
    expect(() =>
      sweepAbandonedPullRequests({
        gh,
        gitEnv: process.env,
        registryDir: work,
        registryRepo: REPO,
      }),
    ).toThrow(
      "gh pr list returned 1000 open pull requests, its limit — a leftover beyond it would go unseen",
    );
  });
});
