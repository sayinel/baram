/**
 * §380/§381 — the registry files as the gate and the publish job read and write them.
 *
 * ‼️ WRITES GO THROUGH THE EXISTING CLIs, as child processes — the same three scripts
 * `plugin-release.yml` runs: `update-registry-index.mjs` to upsert, `validate-index.ts` and
 * `validate-registry-assets.ts` to judge. There is no second implementation of either, so what
 * the gate accepts is what the publish job can write, and what it writes is what CI and the app
 * already agree on.
 *
 * Every function that runs one of those CLIs takes the repository `root` (where `scripts/` and
 * `node_modules/` live) as an argument instead of deriving it from `import.meta`: vitest runs
 * these under jsdom, where `import.meta.url` does not resolve to a file (plan 0105 Global
 * Constraints).
 */
import type { RegistryEntry } from "../src/plugins/types";
import type { Verdict } from "./community-submission";

import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { MAX_SUBMISSION_BYTES } from "./community-submission";

/**
 * What an absent community.json reads as — the same bytes as this repository's seed
 * `registry/community.json` (compared with `od -c`: `{ "communityPlugins": [] }` and a
 * newline). The app reads that file's 404 as the same empty list (`fetch_community_registry` in
 * `src-tauri/src/plugin/fetch.rs`, spec 0058 §9.1).
 */
export const EMPTY_COMMUNITY = '{ "communityPlugins": [] }\n';

export interface CommunityUpsert {
  baseUrl: string;
  checksum: string;
  communityPath: string;
  manifestPath: string;
  publisher: string;
  publisherId: number;
  readmeName: null | string;
  repoId: number;
  repository: string;
  zipName: string;
}

/** A community.json entry as contract C1 shapes it: the four identity fields are present. */
export type PublishedCommunityEntry = RegistryEntry & {
  publisher: string;
  publisherId: number;
  repoId: number;
  repository: string;
};

export interface RegistryState {
  community: PublishedCommunityEntry[];
  /** The file's bytes as text, so the gate can stage an upsert against exactly this document. */
  communityText: string;
  /** Every id in index.json — plugins AND themes (gate 4 counts both). */
  firstPartyIds: string[];
}

/**
 * The first-parent commit on main that first added `community/<id>.json` SINCE ITS LAST
 * DELETION, or null when main holds no such add (plan 0105 P24). A deletion reaches main only
 * through a maintenance pull request a person merges (P27), so a deletion is how a maintainer
 * releases an unpublished id; adds older than it no longer decide whose the id is. The commit is
 * what `pendingDescriptorConflict` asks GitHub about — which pull request merged it, and whose.
 *
 * `dir` must be a clone with full history — a workflow checks it out with `fetch-depth: 0` —
 * and a shallow one THROWS: the oldest commit of a shallow clone shows every file it holds as
 * added, so "the first add" would be wherever the clone was cut. Any other git failure throws
 * too (`execFileSync` throws on a non-zero exit): "no add since the last deletion" is the only
 * answer that may mean "nothing to check".
 *
 * `--no-follow` because git's `log.follow` setting turns a single-path log into `--follow`,
 * which walks a rename back to the file it came from and reports THAT file's add — another
 * path's commit, chosen by whatever git config the machine running this has. Only lines naming
 * the path itself count, so no other path's add or deletion can end or set the search.
 */
export function firstDescriptorCommit(dir: string, id: string): null | string {
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  const path = `community/${id}.json`;
  if (git("rev-parse", "--is-shallow-repository").trim() !== "false") {
    throw new Error(
      `${dir} is a shallow clone, so the commit that first added ${path} cannot be told from where the clone was cut — check it out with fetch-depth: 0`,
    );
  }
  // Newest first: a commit id line, then that commit's `A\t<path>` or `D\t<path>`.
  const log = git("log", "--no-follow", "--first-parent", "--diff-filter=AD", "--format=%H", "--name-status", "HEAD", "--", path);
  let sha = "";
  let first: null | string = null;
  for (const line of log.split("\n")) {
    if (/^[0-9a-f]{40,64}$/u.test(line)) sha = line;
    else if (line === `D\t${path}`) break;
    else if (line === `A\t${path}`) first = sha;
  }
  return first;
}

/**
 * `community/<id>.json` in a plain directory, refused before it is read if it is not a small
 * regular file. The gate reads with `readDescriptorAt` instead, from a commit.
 */
export function readDescriptor(dir: string, id: string): Verdict<{ bytes: Uint8Array }> {
  const path = join(dir, "community", `${id}.json`);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile()) return { error: `community/${id}.json is not a regular file`, ok: false };
  if (stat.size > MAX_SUBMISSION_BYTES) {
    return { error: `the descriptor is ${stat.size} bytes, over the ${MAX_SUBMISSION_BYTES}-byte limit`, ok: false };
  }
  return { bytes: new Uint8Array(readFileSync(path)), ok: true };
}

/**
 * `community/<id>.json` as commit `sha` holds it — read from git objects, never from the working
 * tree, because the decision the gate writes names `sha`, so the bytes it judged must be that
 * commit's whatever the checkout's files say.
 *
 * Refused as "not a regular file" unless `git ls-tree` lists exactly one entry at the path and
 * it is a `100644` blob: a symlink (`120000`), an executable (`100755`), a submodule, a directory
 * or no entry at all is refused the way `readDescriptor` refuses its own. Refused too when the
 * blob is larger than `MAX_SUBMISSION_BYTES`, measured with `git cat-file -s` before it is read.
 *
 * A `sha` that `dir` holds no commit for THROWS: the workflow checked out something other than
 * the pull request's head, which is its own bug, not a verdict about the submission.
 */
export function readDescriptorAt(dir: string, sha: string, id: string): Verdict<{ bytes: Uint8Array }> {
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" });
  const path = `community/${id}.json`;
  const has = spawnSync("git", ["-C", dir, "cat-file", "-e", `${sha}^{commit}`]);
  if (has.error !== undefined) throw has.error;
  if (has.status !== 0) {
    throw new Error(`${dir} holds no commit ${sha} — check out the pull request's head commit before running the gate`);
  }
  // `<mode> SP <type> SP <object> TAB <path>`, one line per entry.
  const listed = git("ls-tree", "--full-tree", sha, "--", path).split("\n").filter((line) => line !== "");
  const entry = listed.length === 1 ? /^(\d{6}) ([a-z]+) ([0-9a-f]{40,64})\t(.+)$/u.exec(listed[0]) : null;
  if (entry?.[1] !== "100644" || entry[2] !== "blob" || entry[4] !== path) {
    return { error: `${path} is not a regular file`, ok: false };
  }
  const size = Number(git("cat-file", "-s", entry[3]).trim());
  if (size > MAX_SUBMISSION_BYTES) {
    return { error: `the descriptor is ${size} bytes, over the ${MAX_SUBMISSION_BYTES}-byte limit`, ok: false };
  }
  return { bytes: new Uint8Array(execFileSync("git", ["-C", dir, "cat-file", "blob", entry[3]], { stdio: "pipe" })), ok: true };
}

/**
 * Both registry documents, each no larger than the app fetches (gate 1). An absent
 * community.json reads as `EMPTY_COMMUNITY`.
 */
export function readRegistryState(dir: string, cap: number): Verdict<{ state: RegistryState }> {
  const index = readBounded(join(dir, "index.json"), cap, null);
  if (!index.ok) return index;
  const community = readBounded(join(dir, "community.json"), cap, EMPTY_COMMUNITY);
  if (!community.ok) return community;
  let plugins: unknown;
  let entries: unknown;
  try {
    plugins = (JSON.parse(index.text) as null | { plugins?: unknown })?.plugins;
    entries = (JSON.parse(community.text) as null | { communityPlugins?: unknown })?.communityPlugins;
  } catch {
    return { error: "index.json or community.json is not valid JSON", ok: false };
  }
  if (!Array.isArray(plugins) || !Array.isArray(entries)) {
    return { error: "index.json needs a plugins array and community.json a communityPlugins array", ok: false };
  }
  const firstPartyIds = plugins
    .map((entry: unknown) => (entry as null | { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string");
  return {
    ok: true,
    state: { community: entries as PublishedCommunityEntry[], communityText: community.text, firstPartyIds },
  };
}

export function upsertCommunityEntry(root: string, upsert: CommunityUpsert): Verdict {
  return run(process.execPath, [
    resolve(root, "scripts/update-registry-index.mjs"),
    "--index", upsert.communityPath,
    "--manifest", upsert.manifestPath,
    "--zip-name", upsert.zipName,
    "--checksum", upsert.checksum,
    "--base-url", upsert.baseUrl,
    "--publisher", upsert.publisher,
    "--publisher-id", String(upsert.publisherId),
    "--repo-id", String(upsert.repoId),
    "--repository", upsert.repository,
    ...(upsert.readmeName === null ? [] : ["--readme-name", upsert.readmeName]),
  ]);
}

export function validateRegistryAssets(root: string, registryDir: string, baseUrl: string): Verdict {
  return run(resolve(root, "node_modules/.bin/tsx"), [
    resolve(root, "scripts/validate-registry-assets.ts"),
    registryDir,
    "--base-url",
    baseUrl,
  ]);
}

export function validateRegistryDocument(root: string, path: string): Verdict {
  return run(resolve(root, "node_modules/.bin/tsx"), [resolve(root, "scripts/validate-index.ts"), path]);
}

function readBounded(path: string, cap: number, whenAbsent: null | string): Verdict<{ text: string }> {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) {
    return whenAbsent === null ? { error: `${basename(path)} is missing`, ok: false } : { ok: true, text: whenAbsent };
  }
  if (!stat.isFile()) return { error: `${basename(path)} is not a regular file`, ok: false };
  if (stat.size > cap) {
    return { error: `${basename(path)} is ${stat.size} bytes, over the app's ${cap}-byte registry limit`, ok: false };
  }
  return { ok: true, text: readFileSync(path, "utf8") };
}

/**
 * A tool's verdict: exit 0 is ok, any other exit is a refusal carrying what it printed. A tool
 * that could not be started at all (a missing `node_modules/.bin/tsx`, say) THROWS — that is the
 * workflow's setup, not a verdict about the submission.
 */
function run(command: string, args: string[]): Verdict {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return { ok: true };
  const said = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { error: said === "" ? `${basename(command)} exited ${String(result.status)}` : said, ok: false };
}
