// §381 — the registry clone and the recorded `gh` the pull request delivery tests use (plan 0105
// P11). A harness, not a fixture: the clone is real git over a local bare `origin.git`, and the
// fake `gh` keeps a small model of the pull requests it was asked about. It never judges —
// expected values stay hand-written literals in the tests. A test file that calls `clone()`
// registers `afterAll(cleanUpWorlds)` (`community-gate-world.ts`), which removes what this made.
import type { GhRunner } from "../../../scripts/community-pull-request";

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { gitIn, tempDir } from "./community-gate-world";

export const REPO = "sayinel/baram-plugins";

export type Answer = ReturnType<GhRunner>;

export type Command =
  | "pr close"
  | "pr create"
  | "pr list"
  | "pr merge"
  | "pr view"
  | "status error"
  | "status success";

export interface Fake {
  /** Runs as a merge starts — another writer moving main between the base check and the merge. */
  onMerge?: () => void;
  /** Pull requests already open — what a run that was killed mid-delivery left. */
  open?: OpenPullRequest[];
  /** Answers that replace the model's. A string is stderr with exit status 1. */
  refuse?: Partial<Record<Command, Answer | string>>;
}

export interface OpenPullRequest {
  /** Its commits, oldest first, as `gh pr view --json commits` lists them. Default: the head alone. */
  commits?: string[];
  headRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  number: number;
}

let movers = 0;

export function branchExists(origin: string, branch: string): boolean {
  try {
    gitIn(origin)("rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

/** A registry clone whose HEAD is one release commit (`a`: 1 → 2) on top of origin's main. */
export function clone(): { origin: string; work: string } {
  const base = tempDir("baram-pr-");
  const origin = join(base, "origin.git");
  gitIn(base)("init", "--quiet", "--bare", origin);
  const work = join(base, "work");
  gitIn(base)("clone", "--quiet", origin, work);
  const git = gitIn(work);
  writeFileSync(join(work, "a"), "1");
  git("add", "--", "a");
  git("commit", "--quiet", "-m", "seed");
  git("push", "--quiet", "origin", "HEAD:main");
  writeFileSync(join(work, "a"), "2");
  git("commit", "--quiet", "-am", "community: hello-counter 1.2.0");
  return { origin, work };
}

/** Another writer commits `path` = `content` to origin's main from its own clone. */
export function moveMain(origin: string, path: string, content: string): void {
  movers += 1;
  const other = join(origin, "..", `other-${movers}`);
  gitIn(join(origin, ".."))("clone", "--quiet", origin, other);
  writeFileSync(join(other, path), content);
  gitIn(other)("add", "--", path);
  gitIn(other)("commit", "--quiet", "-m", `another writer changes ${path}`);
  gitIn(other)("push", "--quiet", "origin", "HEAD:main");
}

/**
 * A recorded fake `gh` over origin. It opens a pull request only for a branch origin has
 * (numbered from 42), and keeps the latest `validate` state posted on each SHA. A merge refuses a
 * head that is not the branch's tip with the text Task 1 measured (0071 M4), and a head whose
 * latest `validate` is not success with the ruleset's measured refusal (0071 M3d). Otherwise it
 * squashes the tree `git merge-tree --write-tree main <tip>` produces onto main — the validated
 * tree when main has not moved — and answers a conflict with gh 2.101.0's "cannot be cleanly
 * created" text. That is gh's refusal BEFORE a merge; a conflict GitHub finds only during the
 * merge more likely comes back as a GraphQL error (not measured), which the delivery does not
 * retry — it stops the run, the safe direction. That is a model of GitHub, not GitHub: nothing
 * here was compared with a real squash beyond those texts. `pr view` answers `--json commits`
 * with the pull request's `commits` (its head alone by default), and anything else with the
 * last squash.
 */
export function recorder(
  origin: string,
  fake: Fake = {},
): { calls: string[][]; gh: GhRunner; open: () => number[] } {
  const calls: string[][] = [];
  const git = gitIn(origin);
  const pulls = new Map(
    (fake.open ?? []).map((pr) => [pr.number, { ...pr, isOpen: true }]),
  );
  const latest = new Map<string, string>();
  let next = 42;
  let squash = "";
  const fail = (stderr: string): Answer => ({ status: 1, stderr, stdout: "" });
  const ok = (stdout = ""): Answer => ({ status: 0, stderr: "", stdout });
  const value = (args: string[], name: string) => args[args.indexOf(name) + 1];
  const merge = (args: string[]): Answer => {
    const number = Number(args[2]);
    const pr = pulls.get(number);
    const head = value(args, "--match-head-commit");
    fake.onMerge?.();
    if (
      pr === undefined ||
      git("rev-parse", `refs/heads/${pr.headRefName}`).trim() !== head
    ) {
      return fail(
        "GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)",
      );
    }
    if (latest.get(head) !== "success") {
      return fail(
        `X Pull request ${REPO}#${number} is not mergeable: the base branch policy prohibits the merge.`,
      );
    }
    let tree: string;
    try {
      tree = execFileSync(
        "git",
        ["-C", origin, "merge-tree", "--write-tree", "main", head],
        { encoding: "utf8" },
      ).split("\n")[0];
    } catch {
      return fail(
        `X Pull request ${REPO}#${number} is not mergeable: the merge commit cannot be cleanly created.`,
      );
    }
    squash = git(
      "commit-tree",
      tree,
      "-p",
      "main",
      "-m",
      `squash (#${number})`,
    ).trim();
    git("update-ref", "refs/heads/main", squash);
    pr.isOpen = false;
    return ok();
  };
  const gh: GhRunner = (args) => {
    calls.push(args);
    const state = args
      .find((arg) => arg.startsWith("state="))
      ?.slice("state=".length);
    const command = (
      args[0] === "api" ? `status ${state}` : `${args[0]} ${args[1]}`
    ) as Command;
    const replaced = fake.refuse?.[command];
    if (typeof replaced === "string") return fail(replaced);
    if (replaced !== undefined) return replaced;
    if (command === "pr create") {
      const head = value(args, "--head");
      if (!branchExists(origin, head))
        return fail(`no branch ${head} on the remote`);
      const oid = git("rev-parse", `refs/heads/${head}`).trim();
      pulls.set(next, {
        headRefName: head,
        headRefOid: oid,
        isCrossRepository: false,
        isOpen: true,
        number: next,
      });
      next += 1;
      return ok(`https://github.com/${REPO}/pull/${next - 1}\n`);
    }
    if (command === "status error" || command === "status success") {
      latest.set(
        args[3].split("/").at(-1) ?? "",
        command.slice("status ".length),
      );
      return ok();
    }
    if (command === "pr close") {
      const pr = pulls.get(Number(args[2]));
      if (pr !== undefined) pr.isOpen = false;
      return ok();
    }
    if (command === "pr list") {
      const listed = [...pulls.values()].filter((pr) => pr.isOpen);
      return ok(
        JSON.stringify(
          listed.map((pr) => ({
            headRefName: pr.headRefName,
            headRefOid: pr.headRefOid,
            isCrossRepository: pr.isCrossRepository,
            number: pr.number,
          })),
        ),
      );
    }
    if (command === "pr view") {
      const pr = pulls.get(Number(args[2]));
      if (!args.includes("commits")) return ok(`${squash}\n`);
      return ok(
        (pr?.commits ?? [pr?.headRefOid]).map((oid) => `${oid}\n`).join(""),
      );
    }
    return merge(args);
  };
  return {
    calls,
    gh,
    open: () =>
      [...pulls.values()].filter((pr) => pr.isOpen).map((pr) => pr.number),
  };
}
