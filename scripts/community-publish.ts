/**
 * §381 — the community publish job's reconcile run (spec 0058 §8.1–§8.2).
 *
 * ‼️ ONE RUN RECONCILES EVERYTHING; IT DOES NOT PUBLISH "THE ONE THAT WAS MERGED". GitHub keeps
 * one pending run per concurrency group, so a dispatch can be dropped. Every run therefore
 * compares each `community/*.json` request with what `community.json` publishes and publishes
 * whatever is behind — a dropped dispatch is picked up by the next push, dispatch or schedule.
 *
 * Gate steps 0 and 3 need a pull request; here the COMMIT that brought the descriptor to main
 * stands in for it (spec 0058 §8.2 step 1): it changed nothing else, and the merged pull request
 * behind it was opened by the repository's owner — for an update, the account already recorded
 * as its publisher. Everything else is re-judged from the bytes, so an asset replaced between
 * review and merge stops here.
 *
 * Nothing from a plugin runs: its ZIP is downloaded, hashed, read as data and copied.
 */
import type { AssetFetch } from "./community-download";
import type { PublishedCommunityEntry } from "./community-files";
import type { GithubGet } from "./community-github";
import type { Submission, Verdict } from "./community-submission";
import type { PluginArchive } from "./community-zip";
import type { PluginArchiveLimits } from "./rust-constants";

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareVersions } from "../src/plugins/version-range";
import { downloadReleaseAsset, releaseAssetUrl, sha256Hex } from "./community-download";
import {
  EMPTY_COMMUNITY,
  firstDescriptorCommit,
  readDescriptor,
  readRegistryState,
  upsertCommunityEntry,
  validateRegistryAssets,
  validateRegistryDocument,
} from "./community-files";
import { judgeManifest } from "./community-gate";
import { mergedPullRequest, ownership, pendingDescriptorConflict, repoFacts } from "./community-github";
import { descriptorIdFromPath, idConflict, parseSubmission, tagVersion } from "./community-submission";
import { readPluginArchive } from "./community-zip";
import { label } from "./gha-label";

/** Spec 0058 §8.2 step 5: at most three retries — four deliveries in all (plan 0105 P13). */
export const MAX_PUSH_RETRIES = 3;

/**
 * Lands the TREE of the registry clone's HEAD on main — by pushing that commit
 * (`deliverByPush`), or through a pull request that main takes as another commit with the same
 * tree (a squash merge). "stale" = main moved first and nothing landed; `reconcile` retries on
 * the new main. After "delivered", `reconcile` resets the clone to what main now is, so the next
 * descriptor is built on main itself, whichever commit main made of this one.
 */
export type Delivery = (dir: string) => Promise<"delivered" | "stale">;

export interface Failure {
  id: string;
  /** The pull request that brought the descriptor; null when the failure came before one was known. */
  pr: null | number;
  reason: string;
  /** The release asset changed after review — the author is told on the pull request. */
  stalled: boolean;
}

export interface PublishedItem {
  checksum: string;
  downloadUrl: string;
  id: string;
  version: string;
}

export interface ReconcileOptions {
  api: GithubGet;
  archiveCap: number;
  baseUrl: string;
  deliver: Delivery;
  fetch: AssetFetch;
  limits: PluginArchiveLimits;
  /** The app's `readmeByteCap` — the README published beside the archive is bounded as gate 6 bounds it. */
  readmeCap: number;
  registryCap: number;
  /** The registry clone: main, with full history, checked out clean. */
  registryDir: string;
  registryRepo: string;
  root: string;
}

export interface ReconcileReport {
  /**
   * Why the run stopped early, as "<id>: <message>", or null. Set when handling one descriptor
   * THREW — a GitHub request with no answer at all, a push the remote refused for a reason other
   * than a lost race, a git or file error — and descriptors after it were not handled. What came
   * before it is in the lists as usual; a delivered release stays in `published`.
   */
  aborted: null | string;
  failed: Failure[];
  published: PublishedItem[];
  skipped: { id: string; reason: string }[];
}

type Outcome =
  | { item: PublishedItem; kind: "published" }
  | { kind: "failed"; pr: null | number; reason: string; stalled: boolean }
  | { kind: "skipped"; reason: string };

interface Release {
  archive: PluginArchive;
  bytes: Uint8Array;
  checksum: string;
  id: string;
  owner: { publisherId: number; repoId: number };
  submission: Submission;
  version: string;
}

type Standing = "behind" | "immutable" | "no-op" | "publish";

export function deliverByPush(env: NodeJS.ProcessEnv): Delivery {
  return (dir) => {
    // LC_ALL=C so the text the pattern below reads cannot come back in the runner's language.
    const push = spawnSync("git", ["-C", dir, "push", "--quiet", "origin", "HEAD:refs/heads/main"], {
      encoding: "utf8",
      env: { ...env, LC_ALL: "C" },
    });
    if (push.status === 0) return Promise.resolve("delivered");
    // Only an ordinary lost race is retried. A ruleset refusal ("[remote rejected] … GH013") or
    // an auth failure is not a race, and retrying it three times would only hide it.
    if (/\[rejected\].*\((?:fetch first|non-fast-forward)\)/u.test(push.stderr)) return Promise.resolve("stale");
    return Promise.reject(new Error(`git push failed: ${push.stderr.trim()}`));
  };
}

/** The `$GITHUB_OUTPUT` lines the CLI writes — counts only, never text a descriptor chose. */
export function publishOutputs(report: ReconcileReport): string[] {
  return [
    `failed=${report.failed.length}`,
    `published=${report.published.length}`,
    // Only a stalled failure that names a pull request can be told on one.
    `stalled=${report.failed.filter((item) => item.stalled && item.pr !== null).length}`,
  ];
}

/** The lines a workflow step prints. Every untrusted fragment goes through `label`; no reason is cut. */
export function publishReportLines(report: ReconcileReport): string[] {
  return [
    ...report.published.map((item) => `✓ published ${label(item.id)} ${label(item.version)}`),
    ...report.skipped.map((item) => `· ${label(item.id)}: ${label(item.reason, Infinity)}`),
    ...report.failed.map((item) => `✗ ${label(item.id)}: ${label(item.reason, Infinity)}`),
    ...(report.aborted === null
      ? []
      : [`✗ aborted: ${label(report.aborted, Infinity)} — no descriptor after it was handled`]),
  ];
}

export async function reconcile(options: ReconcileOptions): Promise<ReconcileReport> {
  const report: ReconcileReport = { aborted: null, failed: [], published: [], skipped: [] };
  let handling: null | string = null;
  try {
    for (const id of descriptorIds(options.registryDir)) {
      handling = id;
      const outcome = await publishOne(options, id);
      if (outcome.kind === "published") {
        report.published.push(outcome.item);
        // Recorded first: if this reset throws, the release main already holds stays reported.
        syncToMain(options.registryDir);
      } else if (outcome.kind === "skipped") {
        report.skipped.push({ id, reason: outcome.reason });
      } else {
        report.failed.push({ id, pr: outcome.pr, reason: outcome.reason, stalled: outcome.stalled });
      }
    }
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    report.aborted = handling === null ? said : `${handling}: ${said}`;
  }
  return report;
}

/**
 * Gates 0 and 3 without a pull request (spec 0058 §8.2 step 1): the last first-parent commit
 * that touched the descriptor, which must have changed nothing else against its first parent.
 */
function descriptorCommit(dir: string, id: string): Verdict<{ sha: string }> {
  const path = `community/${id}.json`;
  const sha = git(dir, ["log", "-1", "--first-parent", "--format=%H", "HEAD", "--", path]).trim();
  if (!/^[0-9a-f]{40}$/u.test(sha)) return { error: `no commit on main introduced ${path}`, ok: false };
  const parents = git(dir, ["rev-list", "--parents", "-n", "1", sha]).trim().split(" ").slice(1);
  if (parents.length === 0) return { error: `${path} arrived in a root commit — it must come through a pull request`, ok: false };
  const changed = git(dir, ["diff", "--no-renames", "--name-only", `${sha}^1`, sha])
    .split("\n")
    .filter((line) => line !== "");
  if (changed.length !== 1 || changed[0] !== path) {
    return {
      error: `the commit that brought ${path} (${sha}) also changed ${changed.filter((p) => p !== path).join(", ")} — a descriptor must arrive alone`,
      ok: false,
    };
  }
  return { ok: true, sha };
}

function descriptorIds(dir: string): string[] {
  const community = join(dir, "community");
  if (!existsSync(community)) return [];
  return readdirSync(community)
    .map((name) => descriptorIdFromPath(`community/${name}`))
    .filter((id): id is string => id !== null)
    .sort();
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

async function publishOne(o: ReconcileOptions, id: string): Promise<Outcome> {
  const failed = (reason: string, pr: null | number = null, stalled = false): Outcome => ({ kind: "failed", pr, reason, stalled });
  const skipped = (reason: string): Outcome => ({ kind: "skipped", reason });

  // The ids were listed once, before the run; a reset for an earlier id may have brought in a
  // main without this one.
  if (lstatSync(join(o.registryDir, "community", `${id}.json`), { throwIfNoEntry: false }) === undefined) {
    return skipped(`community/${id}.json was removed from main meanwhile`);
  }
  // The working tree, not `readDescriptorAt`: it is HEAD's — every refusal below rolls back what
  // it wrote, every delivery and lost race ends in a reset, and a throw ends the run before
  // another descriptor is read — and `descriptorCommit` names the last first-parent commit that
  // changed this path, so HEAD holds that commit's bytes. Reading them first lets an
  // already-published version be skipped before any history walk or GitHub request.
  const read = readDescriptor(o.registryDir, id);
  if (!read.ok) return failed(read.error);
  const parsed = parseSubmission(read.bytes, id);
  if (!parsed.ok) return failed(parsed.error);
  const submission = parsed.submission;
  const registry = readRegistryState(o.registryDir, o.registryCap);
  if (!registry.ok) return failed(registry.error);
  const requested = tagVersion(submission.release.tag);
  const current = registry.state.community.find((entry) => entry.id === id);
  const early = standing(current, requested, submission.release.sha256);
  if (early === "no-op") return skipped(`already published: ${id} ${requested}`);
  if (early === "behind") {
    return skipped(`the descriptor asks for ${requested}, not newer than the published ${current?.version ?? "?"}`);
  }
  if (early === "immutable") {
    return failed(`${id} ${requested} is already published with checksum ${current?.checksum ?? "?"} — a published version's bytes never change`);
  }

  const commit = descriptorCommit(o.registryDir, id);
  if (!commit.ok) return failed(commit.error);
  // A failure carrying `status` is GitHub not answering, not a verdict on the author: it keeps
  // GitHub's own message, names no pull request and stalls nothing, so the next run asks again.
  const pr = await mergedPullRequest(o.api, o.registryRepo, commit.sha);
  if (!pr.ok) return failed(pr.error);
  const facts = await repoFacts(o.api, submission.repo);
  if (!facts.ok) return failed(facts.error, pr.number);
  const owner = ownership(
    submission,
    facts.facts,
    pr.authorId,
    current === undefined ? undefined : { publisherId: current.publisherId, repoId: current.repoId },
  );
  if (!owner.ok) return failed(owner.error, pr.number);
  // P24, mirrored from the gate: nobody holds a publisherId for an unpublished id, so the numeric
  // author of the pull request that merged the descriptor's first add since its last deletion
  // decides whose it is — and `pendingDescriptorConflict` accepts that commit only if it has one
  // parent and added `community/<id>.json` and nothing else. When no earlier add counts, the
  // first add is this very descriptor commit, and the check confirms its own pull request.
  // A published id is not judged here: its identity is the recorded `publisherId`, which a
  // maintainer can transfer (spec 0058 §8.5).
  if (current === undefined) {
    const firstAddSha = firstDescriptorCommit(o.registryDir, id);
    // HEAD holds the descriptor, so some commit added it. git showing none — `log.showRoot=false`
    // hides what a root commit added, for one — leaves the first owner unknown: refused, never
    // read as "nothing to check".
    if (firstAddSha === null) {
      return failed(
        `community/${id}.json is on main, but git shows no commit that added it since its last deletion — its first owner cannot be established, so it is not published`,
        pr.number,
      );
    }
    const takeover = await pendingDescriptorConflict(o.api, o.registryRepo, firstAddSha, id, pr.authorId);
    if (takeover !== null) return failed(takeover, pr.number);
  }
  const conflict = idConflict(id, registry.state.firstPartyIds, registry.state.community.map((entry) => entry.id));
  if (conflict !== null) return failed(conflict, pr.number);

  const download = await downloadReleaseAsset(releaseAssetUrl(submission), o.archiveCap, o.fetch);
  if (!download.ok) return failed(download.error, pr.number);
  const checksum = sha256Hex(download.bytes);
  if (checksum !== submission.release.sha256) {
    return failed(
      `the release asset changed after review: it hashes to ${checksum}, the reviewed descriptor says ${submission.release.sha256}`,
      pr.number,
      true,
    );
  }
  const archive = await readPluginArchive(download.bytes, o.limits, o.readmeCap);
  if (!archive.ok) return failed(archive.error, pr.number);
  const manifest = judgeManifest(archive.archive.manifest, submission);
  if (!manifest.ok) return failed(manifest.error, pr.number);
  const release: Release = {
    archive: archive.archive,
    bytes: download.bytes,
    checksum,
    id,
    owner,
    submission,
    version: manifest.manifest.version,
  };

  for (let attempt = 0; attempt <= MAX_PUSH_RETRIES; attempt += 1) {
    if (attempt > 0) {
      // Step 5: back to main, and judge again. First the descriptor: a maintainer's deletion (how
      // an unpublished id is released, plan 0105 P24/P27) or a newer merged version makes another
      // commit the last to change it, and what was judged above is no longer what main asks for.
      syncToMain(o.registryDir);
      const moved = descriptorCommit(o.registryDir, id);
      if (!moved.ok || moved.sha !== commit.sha) {
        return skipped(`community/${id}.json changed on main meanwhile — the next run judges it`);
      }
      // Then the VERSION — the run that beat us may have published this plugin, or a newer one.
      const again = readRegistryState(o.registryDir, o.registryCap);
      if (!again.ok) return failed(again.error, pr.number);
      const now = again.state.community.find((entry) => entry.id === id);
      const judged = standing(now, release.version, checksum);
      if (judged === "no-op") return skipped(`published meanwhile by another run: ${id} ${release.version}`);
      if (judged === "immutable") {
        return failed(`${id} ${release.version} was published meanwhile with other bytes — a published version's bytes never change`, pr.number);
      }
      if (judged === "behind") {
        return skipped(`a newer version (${now?.version ?? "?"}) was published meanwhile — not moving ${id} back to ${release.version}`);
      }
      const clash = idConflict(id, again.state.firstPartyIds, again.state.community.map((entry) => entry.id));
      if (clash !== null) return failed(clash, pr.number);
    }
    const base = git(o.registryDir, ["rev-parse", "HEAD"]).trim();
    const written = writeRelease(o, release);
    if (!written.ok) return failed(written.error, pr.number);
    if ((await o.deliver(o.registryDir)) === "delivered") {
      return {
        item: { checksum, downloadUrl: `${o.baseUrl}plugins/${id}-${release.version}.zip`, id, version: release.version },
        kind: "published",
      };
    }
    if (attempt === MAX_PUSH_RETRIES) {
      // The commit never reached main. Left in the clone, it would ride along with the next
      // descriptor's push while this report calls it failed.
      git(o.registryDir, ["reset", "--quiet", "--hard", base]);
    }
  }
  return failed(`the push was rejected ${MAX_PUSH_RETRIES + 1} times — another writer kept moving main`, pr.number);
}

/** Where a requested (version, sha256) stands against what community.json publishes. */
function standing(current: PublishedCommunityEntry | undefined, version: string, sha256: string): Standing {
  if (current === undefined) return "publish";
  const order = compareVersions(version, current.version);
  if (order === null || order < 0) return "behind";
  if (order > 0) return "publish";
  return current.checksum === sha256 ? "no-op" : "immutable";
}

/**
 * Resets the clone to what origin's main is now. The refspec and the ref are spelled out: a
 * checkout may configure no fetch refspec, and `origin/main` names `refs/tags/origin/main` before
 * `refs/remotes/origin/main` when both exist.
 */
function syncToMain(dir: string): void {
  git(dir, ["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  git(dir, ["reset", "--quiet", "--hard", "refs/remotes/origin/main"]);
}

/**
 * Steps 2–5 up to the commit: the archive and README beside the first-party ones, the entry
 * upserted by the same script the gate staged it with, both documents and every archive
 * re-validated, one commit. A refusal anywhere puts the clone back where it was.
 */
function writeRelease(o: ReconcileOptions, r: Release): Verdict {
  const dir = o.registryDir;
  const head = git(dir, ["rev-parse", "HEAD"]).trim();
  const zipName = `${r.id}-${r.version}.zip`;
  const readmeName = r.archive.readme === null ? null : `${r.id}-${r.version}.md`;
  const zipPath = join(dir, "plugins", zipName);
  const existing = lstatSync(zipPath, { throwIfNoEntry: false });
  if (existing !== undefined && (!existing.isFile() || sha256Hex(new Uint8Array(readFileSync(zipPath))) !== r.checksum)) {
    return { error: `plugins/${zipName} already exists with different bytes — a published archive never changes`, ok: false };
  }
  const scratch = mkdtempSync(join(tmpdir(), "baram-publish-"));
  const rollback = (error: string): Verdict => {
    git(dir, ["reset", "--quiet", "--hard", head]);
    // `community.json` too: when the seed was absent this run CREATED it, untracked — `reset
    // --hard` leaves untracked files alone.
    git(dir, ["clean", "-fdq", "--", "plugins", "readme", "community.json"]);
    return { error, ok: false };
  };
  try {
    mkdirSync(join(dir, "plugins"), { recursive: true });
    writeFileSync(zipPath, r.bytes);
    if (readmeName !== null && r.archive.readme !== null) {
      mkdirSync(join(dir, "readme"), { recursive: true });
      writeFileSync(join(dir, "readme", readmeName), r.archive.readme);
    }
    const communityPath = join(dir, "community.json");
    if (!existsSync(communityPath)) writeFileSync(communityPath, EMPTY_COMMUNITY);
    const manifestPath = join(scratch, "baram-plugin.json");
    writeFileSync(manifestPath, JSON.stringify(r.archive.manifest));
    const steps = [
      () =>
        upsertCommunityEntry(o.root, {
          baseUrl: o.baseUrl,
          checksum: r.checksum,
          communityPath,
          manifestPath,
          publisher: r.submission.publisher,
          publisherId: r.owner.publisherId,
          readmeName,
          repoId: r.owner.repoId,
          repository: `https://github.com/${r.submission.repo}`,
          zipName,
        }),
      () => validateRegistryDocument(o.root, join(dir, "index.json")),
      () => validateRegistryDocument(o.root, communityPath),
      () => validateRegistryAssets(o.root, dir, o.baseUrl),
    ];
    for (const step of steps) {
      const result = step();
      if (!result.ok) return rollback(result.error);
    }
    git(dir, ["add", "--", `plugins/${zipName}`, "community.json", ...(readmeName === null ? [] : [`readme/${readmeName}`])]);
    git(dir, [
      "-c", "user.name=github-actions[bot]",
      "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "commit", "--quiet", "-m", `community: ${r.id} ${r.version}`,
    ]);
    return { ok: true };
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}
