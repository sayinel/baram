// §381 — delivering through a pull request, since the registry's ruleset lets only a deploy key
// bypass its pull request rule (plan 0105 P11). The branch push goes to a real bare remote; `gh`
// is a recorded fake (`community-pull-request-world.ts`), so nothing here runs gh or reaches the
// network.
import type { GhRunner } from "../../../scripts/community-pull-request";
import type { Fake } from "./community-pull-request-world";

import { afterAll, describe, expect, it } from "vitest";

import { reconcile } from "../../../scripts/community-publish";
import { deliverViaPullRequest } from "../../../scripts/community-pull-request";
import { cleanUpWorlds, gitIn } from "./community-gate-world";
import { options, registry } from "./community-publish-world";
import {
  branchExists,
  clone,
  moveMain,
  recorder,
  REPO,
} from "./community-pull-request-world";

afterAll(cleanUpWorlds);

/** The ruleset's refusal, as Task 1 measured it (dev-notes impl-notes 0071, M3d, 2026-09-27). */
const POLICY =
  "X Pull request sayinel/baram-plugins#42 is not mergeable: the base branch policy prohibits the merge.";
const CONFLICT =
  "X Pull request sayinel/baram-plugins#42 is not mergeable: the merge commit cannot be cleanly created.";
const CLOSE_FAILED =
  "closing pull request #42 failed (HTTP 502); close it by hand before anyone merges it";

const deliver = (gh: GhRunner, runId: string) =>
  deliverViaPullRequest({ gh, gitEnv: process.env, registryRepo: REPO, runId });

/** The commands the fake was given, as "pr close" / "status error" / … */
const commands = (calls: string[][]) =>
  calls.map((args) =>
    args[0] === "api"
      ? `status ${args.find((arg) => arg.startsWith("state="))?.slice(6)}`
      : `${args[0]} ${args[1]}`,
  );

describe("deliverViaPullRequest", { timeout: 120_000 }, () => {
  it("opens a pull request from its own branch, posts validate on the validated commit, merges exactly that commit and reads the squash back", async () => {
    const { origin, work } = clone();
    const sha = gitIn(work)("rev-parse", "HEAD").trim();
    const { calls, gh, open } = recorder(origin);
    expect(await deliver(gh, "900-1")(work)).toBe("delivered");
    expect(calls).toEqual([
      [
        "pr",
        "create",
        "--repo",
        REPO,
        "--base",
        "main",
        "--head",
        "community-publish/900-1-1",
        "--title",
        "community: hello-counter 1.2.0",
        "--body",
        "Published by publish-community.yml (spec 0058 §381). This run validated the commit and posts the `validate` status itself.",
      ],
      [
        "api",
        "-X",
        "POST",
        `repos/${REPO}/statuses/${sha}`,
        "-f",
        "state=success",
        "-f",
        "context=validate",
        "-f",
        "description=validated by publish-community before this pull request was opened",
      ],
      [
        "pr",
        "merge",
        "42",
        "--repo",
        REPO,
        "--squash",
        "--match-head-commit",
        sha,
      ],
      [
        "pr",
        "view",
        "42",
        "--repo",
        REPO,
        "--json",
        "mergeCommit",
        "--jq",
        ".mergeCommit.oid",
      ],
    ]);
    expect(open()).toEqual([]);
    expect(branchExists(origin, "community-publish/900-1-1")).toBe(false);
  });

  it.each([
    ["", false],
    [", in a checkout that configures no fetch refspec", true],
  ])(
    "reports stale WITHOUT pushing a branch or opening a pull request when main moved first%s",
    async (_label, bare) => {
      const { origin, work } = clone();
      if (bare) gitIn(work)("config", "--unset-all", "remote.origin.fetch");
      moveMain(origin, "b", "first-party");
      const { calls, gh } = recorder(origin);
      expect(await deliver(gh, "903-1")(work)).toBe("stale");
      expect(calls).toEqual([]);
      expect(branchExists(origin, "community-publish/903-1-1")).toBe(false);
    },
  );

  it("fails loudly when main moved between the base check and the merge and another tree landed", async () => {
    const { origin, work } = clone();
    const { gh } = recorder(origin, {
      onMerge: () => moveMain(origin, "b", "first-party"),
    });
    await expect(deliver(gh, "904-1")(work)).rejects.toThrow(
      `run \`gh workflow run validate.yml --repo ${REPO}\` by hand before trusting it`,
    );
    expect(branchExists(origin, "community-publish/904-1-1")).toBe(false);
  });

  it.each<[string, Fake["refuse"], string]>([
    ["fails", { "pr view": "HTTP 502" }, "exit 1: HTTP 502"],
    [
      "prints no commit",
      { "pr view": { status: 0, stderr: "", stdout: "null\n" } },
      "exit 0: null",
    ],
  ])(
    "says the release merged unchecked when gh pr view %s after the merge",
    async (_label, refuse, said) => {
      const { origin, work } = clone();
      const tree = gitIn(work)("rev-parse", "HEAD^{tree}").trim();
      const { gh } = recorder(origin, { refuse });
      await expect(deliver(gh, "908-1")(work)).rejects.toThrow(
        `pull request #42 merged, but the tree it landed was not checked against the validated tree ${tree} — check main by hand: gh pr view named no merge commit (${said})`,
      );
      expect(branchExists(origin, "community-publish/908-1-1")).toBe(false);
    },
  );

  it.each<[string, (origin: string) => Fake]>([
    [
      "into a conflict",
      (origin) => ({ onMerge: () => moveMain(origin, "a", "3") }),
    ],
    [
      "ahead of the head",
      () => ({
        refuse: {
          "pr merge":
            "X Pull request sayinel/baram-plugins#42 is not mergeable: the head branch is not up to date with the base branch.",
        },
      }),
    ],
  ])(
    "withdraws validate, closes the pull request, deletes its branch and reports stale when main moved %s",
    async (_label, fake) => {
      const { origin, work } = clone();
      const { calls, gh, open } = recorder(origin, fake(origin));
      expect(await deliver(gh, "901-1")(work)).toBe("stale");
      expect(commands(calls).slice(-3)).toEqual([
        "pr merge",
        "status error",
        "pr close",
      ]);
      expect(open()).toEqual([]);
      expect(branchExists(origin, "community-publish/901-1-1")).toBe(false);
    },
  );

  it.each([
    ["a ruleset refusal", POLICY],
    [
      "a head that is not the validated commit",
      "GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)",
    ],
    // 0071 M4's first attempt got this, in a twin that changed the actor, the SHA and the time
    // at once — it was never measured as a moved base. Retrying it would be safe as well; the
    // retry set stays the two gh 2.101.0 reasons that say main moved.
    [
      'GitHub\'s "Base branch was modified"',
      "GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)",
    ],
    ["a permission failure", "GraphQL: Resource not accessible by integration"],
  ])(
    "withdraws validate, closes the pull request and throws on %s instead of retrying it",
    async (_label, stderr) => {
      const { origin, work } = clone();
      const { calls, gh, open } = recorder(origin, {
        refuse: { "pr merge": stderr },
      });
      await expect(deliver(gh, "902-1")(work)).rejects.toThrow(
        `gh pr merge failed: ${stderr}`,
      );
      expect(commands(calls).slice(-3)).toEqual([
        "pr merge",
        "status error",
        "pr close",
      ]);
      expect(open()).toEqual([]);
      expect(branchExists(origin, "community-publish/902-1-1")).toBe(false);
    },
  );

  it.each<[string, Fake["refuse"], string]>([
    [
      "a refused merge",
      { "pr merge": POLICY },
      `gh pr merge failed: ${POLICY}`,
    ],
    [
      "a lost race",
      { "pr merge": CONFLICT },
      `main moved before pull request #42 merged (${CONFLICT})`,
    ],
    [
      "a status that was not posted",
      { "status success": "HTTP 403" },
      "posting the validate status failed: HTTP 403",
    ],
  ])(
    "rejects, naming the pull request left open, when it cannot close it after %s",
    async (_label, refuse, said) => {
      const { origin, work } = clone();
      const { gh } = recorder(origin, {
        refuse: { ...refuse, "pr close": "HTTP 502" },
      });
      await expect(deliver(gh, "907-1")(work)).rejects.toThrow(
        `${said} — ${CLOSE_FAILED}`,
      );
    },
  );

  it("rejects, naming the commit, when it cannot withdraw the validate status it posted", async () => {
    const { origin, work } = clone();
    const sha = gitIn(work)("rev-parse", "HEAD").trim();
    const { gh, open } = recorder(origin, {
      refuse: { "pr merge": POLICY, "status error": "HTTP 500" },
    });
    await expect(deliver(gh, "909-1")(work)).rejects.toThrow(
      `gh pr merge failed: ${POLICY} — withdrawing the validate status on ${sha} failed (HTTP 500)`,
    );
    expect(open()).toEqual([]);
  });

  it.each<[string, Fake["refuse"]]>([
    ["exits 1", { "pr create": "HTTP 403" }],
    [
      "exits 1 though it printed a URL",
      {
        "pr create": {
          status: 1,
          stderr: "HTTP 403",
          stdout: "https://github.com/sayinel/baram-plugins/pull/42\n",
        },
      },
    ],
  ])(
    "deletes its branch and posts nothing when gh pr create %s",
    async (_label, refuse) => {
      const { origin, work } = clone();
      const { calls, gh } = recorder(origin, { refuse });
      await expect(deliver(gh, "905-1")(work)).rejects.toThrow(
        "gh pr create failed: HTTP 403",
      );
      expect(calls).toHaveLength(1);
      expect(branchExists(origin, "community-publish/905-1-1")).toBe(false);
    },
  );

  it("withdraws, closes the pull request and deletes its branch when the validate status cannot be posted", async () => {
    const { origin, work } = clone();
    const { calls, gh, open } = recorder(origin, {
      refuse: { "status success": "HTTP 403" },
    });
    await expect(deliver(gh, "906-1")(work)).rejects.toThrow(
      "posting the validate status failed: HTTP 403",
    );
    expect(commands(calls)).toEqual([
      "pr create",
      "status success",
      "status error",
      "pr close",
    ]);
    expect(open()).toEqual([]);
    expect(branchExists(origin, "community-publish/906-1-1")).toBe(false);
  });
});

describe(
  "reconcile through deliverViaPullRequest",
  { timeout: 120_000 },
  () => {
    const heads = (calls: string[][]) =>
      calls
        .filter((args) => args[1] === "create")
        .map((args) => args[args.indexOf("--head") + 1]);

    it("publishes each descriptor through its own pull request, built on the squash the last one made", async () => {
      const r = registry({ second: true });
      const { calls, gh } = recorder(r.origin);
      const report = await reconcile(options(r, deliver(gh, "910-1")));
      expect(report.aborted).toBeNull();
      expect(report.published.map((item) => item.id)).toEqual([
        "hello-counter",
        "word-counter",
      ]);
      expect(heads(calls)).toEqual([
        "community-publish/910-1-1",
        "community-publish/910-1-2",
      ]);
    });

    it("aborts the run at a refused merge and delivers nothing after it", async () => {
      const r = registry({ second: true });
      const { calls, gh } = recorder(r.origin, {
        refuse: { "pr merge": POLICY },
      });
      expect(await reconcile(options(r, deliver(gh, "911-1")))).toEqual({
        aborted: `hello-counter: gh pr merge failed: ${POLICY}`,
        failed: [],
        published: [],
        skipped: [],
      });
      expect(heads(calls)).toEqual(["community-publish/911-1-1"]);
    });
  },
);
