/**
 * §381 — delivery through a pull request (plan 0105 P11).
 *
 * The registry's ruleset lets only a deploy key bypass "changes through a pull request", and the
 * rulesets API refused GitHub Actions as a bypass actor on a user-owned repository with a 422
 * (Task 1's lab, dev-notes impl-notes 0071, 2026-09-27). So the publish job opens a pull request.
 * Nothing else produces the required `validate` check for it: plan 0105 P11 expects a pull request
 * opened with GITHUB_TOKEN to start no `pull_request_target` run, and in the lab the one whose run
 * posted no status was refused by the ruleset and stayed BLOCKED (0071, M3d). This job has just
 * validated the commit itself (`writeRelease` runs every validator), so it posts the `validate`
 * commit status on that exact SHA and merges only that SHA (`--match-head-commit`). In the lab the
 * posted status satisfied the required check in each of three runs (M3d).
 *
 * ‼️ THE HEAD IS PINNED; THE BASE IS NOT (plan 0105 P11). `--match-head-commit` fixes what is
 * merged, but with `strict_required_status_checks_policy: false` GitHub squashes it onto whatever
 * main is at merge time — a tree nobody validated if main moved. So the validated commit's parent
 * must BE origin's main before anything is posted (otherwise "stale", and `reconcile` rebuilds on
 * the new main), and after the merge the tree that landed must be the tree that was validated.
 * The window between those two checks cannot be closed from here — GitHub's merge takes no base —
 * so the second check fails loudly instead of passing as success.
 *
 * ‼️ ONCE THE STATUS IS POSTED, AN OPEN PULL REQUEST LOOKS MERGEABLE. Every path below that
 * pushed the branch tries to delete it before returning. Every path that has the pull request's
 * number and did not merge it withdraws the status and closes it (`abandon`), and rejects, saying
 * so, when either fails. A `gh pr create` that prints no number leaves a pull request this run
 * cannot name — but the status is posted only after the number is read, so it carries none of
 * ours, and the next run's `sweepAbandonedPullRequests` closes it if it is still open. That sweep
 * is also what closes a pull request left by a run killed between the status and the close.
 *
 * RESIDUAL (plan 0105 P25): the required `validate` check can now be met by a commit status,
 * which any job holding `statuses: write` in the registry repository can post.
 */
import type { Delivery } from "./community-publish";

import { execFileSync, spawnSync } from "node:child_process";

/** Runs `gh` with these arguments. The CLI's runner sets LC_ALL=C: its stderr is read below. */
export type GhRunner = (args: string[]) => { status: number; stderr: string; stdout: string };

export interface PullRequestDelivery {
  gh: GhRunner;
  /** The environment of every git child: the fetches and pushes need its credentials. */
  gitEnv: NodeJS.ProcessEnv;
  registryRepo: string;
  /**
   * Names the branches — `community-publish/<runId>-<n>`, n counting this run's deliveries. The
   * CLI passes "<run id>-<run attempt>", so a re-run never meets a branch an earlier attempt left.
   */
  runId: string;
}

export interface Sweep {
  gh: GhRunner;
  gitEnv: NodeJS.ProcessEnv;
  /** The registry clone — the branch deletions are pushes from it. */
  registryDir: string;
  registryRepo: string;
}

interface Abandon {
  dir: string;
  gh: GhRunner;
  gitEnv: NodeJS.ProcessEnv;
  registryRepo: string;
}

const BRANCH_PREFIX = "community-publish/";
/** The most open pull requests the sweep reads; a list this long may have been cut. */
const SWEEP_LIMIT = 1000;

export function deliverViaPullRequest(o: PullRequestDelivery): Delivery {
  let attempt = 0;
  return async (dir) => {
    attempt += 1;
    const branch = `${BRANCH_PREFIX}${o.runId}-${attempt}`;
    // Not `community-files.ts`'s `git`: every git child here runs with `gitEnv`, the credentials
    // the fetch and the push need, and each answer is read trimmed.
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: o.gitEnv }).trim();
    // The refspec and the ref are spelled out, as `reconcile` spells them: a checkout may
    // configure no fetch refspec, and `origin/main` names `refs/tags/origin/main` before
    // `refs/remotes/origin/main` when both exist.
    const fetchMain = () => git("fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main");
    const sha = git("rev-parse", "HEAD");
    const tree = git("rev-parse", "HEAD^{tree}");
    const subject = git("log", "-1", "--format=%s");
    fetchMain();
    if (git("rev-parse", "refs/remotes/origin/main") !== git("rev-parse", "HEAD^1")) return "stale";

    const push = spawnSync("git", ["-C", dir, "push", "--quiet", "origin", `HEAD:refs/heads/${branch}`], {
      encoding: "utf8",
      env: o.gitEnv,
    });
    if (push.status !== 0) throw new Error(`git push of ${branch} failed: ${push.stderr.trim()}`);
    const created = o.gh([
      "pr", "create", "--repo", o.registryRepo, "--base", "main", "--head", branch, "--title", subject,
      "--body", "Published by publish-community.yml (spec 0058 §381). This run validated the commit and posts the `validate` status itself.",
    ]);
    const number = /\/pull\/(\d+)\s*$/u.exec(created.stdout)?.[1];
    if (created.status !== 0 || number === undefined) {
      deleteBranch(o.gitEnv, dir, branch);
      throw new Error(`gh pr create failed: ${created.stderr.trim()}`);
    }
    const giveUp = (said: string) =>
      new Error([said, ...abandon({ dir, gh: o.gh, gitEnv: o.gitEnv, registryRepo: o.registryRepo }, number, sha, branch)].join(" — "));
    // A fixed text: nothing the pull request or the descriptor chose goes into the status.
    const status = o.gh([
      "api", "-X", "POST", `repos/${o.registryRepo}/statuses/${sha}`,
      "-f", "state=success", "-f", "context=validate",
      "-f", "description=validated by publish-community before this pull request was opened",
    ]);
    if (status.status !== 0) throw giveUp(`posting the validate status failed: ${status.stderr.trim()}`);
    const merged = o.gh(["pr", "merge", number, "--repo", o.registryRepo, "--squash", "--match-head-commit", sha]);
    if (merged.status !== 0) {
      // A LOST RACE is retried; anything else is not. The gh 2.101.0 binary installed where this
      // was written holds the format "%s Pull request %s#%d is not mergeable: %s." and these three
      // reasons (`strings`, 2026-09-28): "the merge commit cannot be cleanly created" and "the
      // head branch is not up to date with the base branch" say main moved, and are retried as
      // "stale"; "the base branch policy prohibits the merge" is what the ruleset answered in
      // Task 1's lab when no `validate` status was posted (0071 M3d), so it is a policy refusal
      // and stops the run, as any other text does. M3d met no transient refusal after the status
      // was posted, in three runs. This matches text, so a wording the pattern does not know
      // stops the run rather than being retried.
      if (!/the merge commit cannot be cleanly created|the head branch is not up to date with the base branch/u.test(merged.stderr)) {
        throw giveUp(`gh pr merge failed: ${merged.stderr.trim()}`);
      }
      const failed = abandon({ dir, gh: o.gh, gitEnv: o.gitEnv, registryRepo: o.registryRepo }, number, sha, branch);
      if (failed.length === 0) return "stale";
      throw new Error([`main moved before pull request #${number} merged (${merged.stderr.trim()})`, ...failed].join(" — "));
    }
    deleteBranch(o.gitEnv, dir, branch);
    // The release is on main from here. Whatever fails before the tree comparison says so: the
    // next run would skip this version as already published, with its landed tree never checked.
    let landed: string;
    let landedTree: string;
    try {
      const view = o.gh(["pr", "view", number, "--repo", o.registryRepo, "--json", "mergeCommit", "--jq", ".mergeCommit.oid"]);
      landed = view.stdout.trim();
      if (view.status !== 0 || !/^[0-9a-f]{40}$/u.test(landed)) {
        throw new Error(`gh pr view named no merge commit (exit ${view.status}: ${view.stderr.trim() || landed})`);
      }
      fetchMain();
      landedTree = git("rev-parse", `${landed}^{tree}`);
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error);
      throw new Error(
        `pull request #${number} merged, but the tree it landed was not checked against the validated tree ${tree} — check main by hand: ${said}`,
        { cause: error },
      );
    }
    // "events triggered by the GITHUB_TOKEN will not create a new workflow run", except
    // `workflow_dispatch` and `repository_dispatch` (GitHub's docs on GITHUB_TOKEN, read
    // 2026-09-28) — so the squash's push starts no `validate` run, and a dispatch does.
    if (landedTree !== tree) {
      throw new Error(
        `the squash commit ${landed} landed tree ${landedTree}, which is not the validated tree ${tree} (commit ${sha}) — main moved between the base check and the merge. A merge made with GITHUB_TOKEN starts no push workflow, so nothing re-validates main on its own: run \`gh workflow run validate.yml --repo ${o.registryRepo}\` by hand before trusting it`,
      );
    }
    return "delivered";
  };
}

/**
 * Closes what publish runs left open: every open pull request from a `community-publish/` branch
 * of the registry itself (a fork's branch of that name is not ours) is abandoned as a delivery
 * abandons one. Returns a line per pull request, for the log.
 *
 * ‼️ ASSUMES no other publish job is mid-delivery — `publish-community.yml` runs this job in one
 * concurrency group with `cancel-in-progress: false` (plan 0105 Task 13) and calls this before
 * `reconcile`. Every such pull request is then a leftover: a run killed between posting
 * `validate` and closing, or a `gh pr create` whose number was never read.
 *
 * Listing that fails, or that returns SWEEP_LIMIT entries (the list may have been cut), throws. A
 * pull request whose withdrawal or close fails does not stop the sweep; after trying them all it
 * throws naming each, since an open pull request with a green status must not be left silently.
 * A branch that could not be deleted stays, unreported: without its pull request it is inert.
 */
export function sweepAbandonedPullRequests(o: Sweep): string[] {
  const listed = o.gh([
    "pr", "list", "--repo", o.registryRepo, "--state", "open",
    "--json", "number,headRefName,headRefOid,isCrossRepository", "--limit", String(SWEEP_LIMIT),
  ]);
  if (listed.status !== 0) throw new Error(`gh pr list failed: ${listed.stderr.trim()}`);
  const open = JSON.parse(listed.stdout) as unknown;
  if (!Array.isArray(open) || !open.every(isListedPullRequest)) {
    throw new Error("gh pr list printed something other than a list of pull requests");
  }
  if (open.length >= SWEEP_LIMIT) {
    throw new Error(`gh pr list returned ${open.length} open pull requests, its limit — a leftover beyond it would go unseen`);
  }
  const lines: string[] = [];
  const failures: string[] = [];
  const context = { dir: o.registryDir, gh: o.gh, gitEnv: o.gitEnv, registryRepo: o.registryRepo };
  for (const pr of open) {
    if (pr.isCrossRepository || !pr.headRefName.startsWith(BRANCH_PREFIX)) continue;
    const failed = abandon(context, String(pr.number), pr.headRefOid, pr.headRefName);
    if (failed.length > 0) {
      failures.push(`#${pr.number}: ${failed.join("; ")}`);
      continue;
    }
    lines.push(`closed pull request #${pr.number} (${pr.headRefName}) and withdrew its validate status on ${pr.headRefOid}`);
  }
  if (failures.length > 0) {
    throw new Error(`pull requests a publish run left open could not all be closed: ${failures.join("; ")}`);
  }
  return lines;
}

/**
 * Withdraws the `validate` status on `sha`, closes pull request `number` and deletes `branch`, in
 * that order: if the close then fails, the status is already not green. Returns what failed, one
 * clause each. A failed branch deletion is not among them: without its pull request it is inert.
 *
 * Why an `error` status withdraws the `success` one: GitHub's REST docs for commit statuses
 * ("Get the combined status for a specific reference", read 2026-09-28) give the combined state
 * as "failure if any of the contexts report as error or failure" and "success if the latest
 * status for all contexts is success", and list statuses "in reverse chronological order. The
 * first status in the list will be the latest one." That a ruleset's required check reads the
 * latest status of its context the same way was not measured.
 */
function abandon(o: Abandon, number: string, sha: string, branch: string): string[] {
  const withdrawn = o.gh([
    "api", "-X", "POST", `repos/${o.registryRepo}/statuses/${sha}`,
    "-f", "state=error", "-f", "context=validate",
    "-f", "description=withdrawn by publish-community: this commit was not merged",
  ]);
  const closed = o.gh(["pr", "close", number, "--repo", o.registryRepo]);
  deleteBranch(o.gitEnv, o.dir, branch);
  return [
    ...(withdrawn.status === 0 ? [] : [`withdrawing the validate status on ${sha} failed (${withdrawn.stderr.trim()})`]),
    ...(closed.status === 0
      ? []
      : [`closing pull request #${number} failed (${closed.stderr.trim()}); close it by hand before anyone merges it`]),
  ];
}

function deleteBranch(env: NodeJS.ProcessEnv, dir: string, branch: string): void {
  spawnSync("git", ["-C", dir, "push", "--quiet", "origin", "--delete", branch], { env });
}

function isListedPullRequest(value: unknown): value is { headRefName: string; headRefOid: string; isCrossRepository: boolean; number: number } {
  if (typeof value !== "object" || value === null) return false;
  const pr = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(pr.number) &&
    typeof pr.headRefName === "string" &&
    typeof pr.headRefOid === "string" &&
    /^[0-9a-f]{40}$/u.test(pr.headRefOid) &&
    typeof pr.isCrossRepository === "boolean"
  );
}
