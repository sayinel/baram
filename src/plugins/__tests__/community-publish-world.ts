// §381 — the registry the publish tests reconcile (plan 0105 Task 10, spec 0058 §8.2, §12
// "로컬 bare repo 로 재현").
//
// A harness, not a fixture: each registry is a real `origin.git` holding a seed commit, the
// descriptor commits a test puts before its own, and the commit that brings
// community/hello-counter.json (with `second`, one more after it for community/word-counter.json);
// `reconcile` runs against a clone of it with the real
// update/validate CLIs. Only GitHub's API and the release download are faked, and what GitHub
// answers about each descriptor commit — its parents, what it changed, the merged pull request
// and its author — is read back from that history. It never judges: expected values stay
// hand-written literals in the tests. A test file that calls `registry()` registers
// `afterAll(cleanUpWorlds)` (`community-gate-world.ts`), which removes what this made too.
import type { GithubGet, GithubReply } from "../../../scripts/community-github";
import type {
  Delivery,
  ReconcileOptions,
} from "../../../scripts/community-publish";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { deliverByPush } from "../../../scripts/community-publish";
import {
  assetFetch,
  fakeGithub,
  ok,
  pluginZip,
  REAL_LIMITS,
  REAL_README_CAP,
  repoReply,
  sha,
  SUBMISSION,
  validManifest,
} from "./community-gate-fixtures";
import { BASE, gitIn, tempDir } from "./community-gate-world";

export const REGISTRY = "sayinel/baram-plugins";
export const ZIP = pluginZip();
export const ZIP_SHA = sha(ZIP);
const ASSET =
  "https://github.com/octocat/baram-hello-counter/releases/download/v1.2.0/hello-counter-1.2.0.zip";
const CDN =
  "https://release-assets.githubusercontent.com/github-production-release-asset/1/2";
const DESCRIPTOR_PATH = "community/hello-counter.json";
const DESCRIPTOR = {
  ...SUBMISSION,
  release: { ...SUBMISSION.release, sha256: ZIP_SHA },
};
/** A second plugin by the same account — `Setup.second` — for runs that handle two descriptors. */
export const WORD_ZIP = pluginZip(
  validManifest({ id: "word-counter", name: "Word Counter" }),
);
export const WORD_ZIP_SHA = sha(WORD_ZIP);
const WORD_ASSET =
  "https://github.com/octocat/baram-word-counter/releases/download/v1.2.0/word-counter-1.2.0.zip";
const WORD_CDN =
  "https://release-assets.githubusercontent.com/github-production-release-asset/3/4";
const WORD_DESCRIPTOR = {
  id: "word-counter",
  publisher: "octocat",
  release: {
    asset: "word-counter-1.2.0.zip",
    sha256: WORD_ZIP_SHA,
    tag: "v1.2.0",
  },
  repo: "octocat/baram-word-counter",
};
/** The account id whose pull request merged a pending descriptor version, keyed by the publisher it names. */
const ACCOUNT_IDS: Record<string, number> = {
  octocat: 583231,
  someone: 424242,
};
/** git's one-letter `--name-status` codes, as GitHub's commit API spells a file's status. */
const STATUS: Record<string, string> = {
  A: "added",
  D: "removed",
  M: "modified",
};

export interface Registry {
  api: GithubGet;
  base: string;
  /** The commit that brought community/hello-counter.json as the test wrote it. */
  descriptorSha: string;
  origin: string;
  work: string;
}

export interface Setup {
  /** Who opened the pull request that merged the descriptor commit. Default 583231 (octocat). */
  authorId?: number;
  descriptor?: object;
  extraInDescriptorCommit?: Record<string, string>;
  /** Seed without community.json — a registry before contract C2's seed. */
  omitCommunity?: boolean;
  /**
   * Commits to community/hello-counter.json on main between the seed and the descriptor commit,
   * oldest first — merged, not yet published (plan 0105 P24), each by the pull request of the
   * account its publisher names. `null` is a maintainer's pull request deleting the file (P27).
   */
  pendingHistory?: (null | Record<string, unknown>)[];
  /** Files in the seed commit — before any descriptor commit. */
  preexisting?: Record<string, string | Uint8Array>;
  /** The seed community.json's entries. Default none. */
  published?: unknown[];
  /** Replaces GitHub's whole answer listing the descriptor commit's pull requests. */
  pulls?: GithubReply;
  /** A second descriptor, community/word-counter.json, merged after hello-counter's (#8). */
  second?: boolean;
}

let competitors = 0;

/**
 * Another writer pushes to main — a first-party release, a maintainer's deletion — from its own
 * clone. A `null` content deletes that path. Returns main's new SHA.
 */
export function competitor(
  r: Registry,
  files: Record<string, null | string | Uint8Array>,
  subject: string,
): string {
  competitors += 1;
  const other = join(r.base, `other-${competitors}`);
  gitIn(r.base)("clone", "--quiet", r.origin, other);
  const git = gitIn(other);
  for (const [path, content] of Object.entries(files)) {
    if (content === null) git("rm", "--quiet", "--", path);
    else git("add", "--", ...write(other, { [path]: content }));
  }
  git("commit", "--quiet", "-m", subject);
  git("push", "--quiet", "origin", "HEAD:main");
  return git("rev-parse", "HEAD").trim();
}

export function options(
  r: Registry,
  deliver: Delivery = deliverByPush(process.env),
  served: Uint8Array = ZIP,
): ReconcileOptions {
  return {
    api: r.api,
    archiveCap: 32 * 1024 * 1024,
    baseUrl: BASE,
    deliver,
    fetch: assetFetch({
      [ASSET]: { location: CDN, status: 302 },
      [CDN]: { bytes: served, status: 200 },
      [WORD_ASSET]: { location: WORD_CDN, status: 302 },
      [WORD_CDN]: { bytes: WORD_ZIP, status: 200 },
    }),
    limits: REAL_LIMITS,
    readmeCap: REAL_README_CAP,
    registryCap: 4 * 1024 * 1024,
    registryDir: r.work,
    registryRepo: REGISTRY,
    root: resolve(__dirname, "../../.."),
  };
}

export const originFile = (r: Registry, path: string) =>
  gitIn(r.origin)("show", `main:${path}`);

export const originLog = (r: Registry) =>
  gitIn(r.origin)("log", "--format=%s", "main").trim().split("\n");

export function registry(setup: Setup = {}): Registry {
  const base = tempDir("baram-publish-");
  const origin = join(base, "origin.git");
  gitIn(base)("init", "--quiet", "--bare", origin);
  const seed = join(base, "seed");
  gitIn(base)("clone", "--quiet", origin, seed);
  const git = gitIn(seed);
  git(
    "add",
    "--",
    ...write(seed, {
      ...(setup.omitCommunity === true
        ? {}
        : {
            "community.json": `${JSON.stringify({ communityPlugins: setup.published ?? [] }, null, 2)}\n`,
          }),
      "index.json": '{\n  "plugins": []\n}\n',
      ...setup.preexisting,
    }),
  );
  git("commit", "--quiet", "-m", "seed");
  const routes: Record<string, GithubReply> = {
    "repos/octocat/baram-hello-counter": repoReply(),
    "repos/octocat/baram-word-counter": repoReply({
      fullName: "octocat/baram-word-counter",
      id: 556,
    }),
    "repos/someone/baram-hello-counter": repoReply({
      fullName: "someone/baram-hello-counter",
      ownerId: 424242,
    }),
  };
  for (const [n, version] of (setup.pendingHistory ?? []).entries()) {
    if (version === null) {
      git("rm", "--quiet", "--", DESCRIPTOR_PATH);
      git(
        "commit",
        "--quiet",
        "-m",
        `a maintainer deletes the descriptor (${n + 1})`,
      );
      continue;
    }
    git(
      "add",
      "--",
      ...write(seed, { [DESCRIPTOR_PATH]: JSON.stringify(version) }),
    );
    git("commit", "--quiet", "-m", `descriptor ${n + 1}`);
    describeCommit(git, routes, n + 1, ACCOUNT_IDS[String(version.publisher)]);
  }
  git(
    "add",
    "--",
    ...write(seed, {
      [DESCRIPTOR_PATH]: JSON.stringify(setup.descriptor ?? DESCRIPTOR),
      ...setup.extraInDescriptorCommit,
    }),
  );
  git("commit", "--quiet", "-m", "Add hello-counter (#7)");
  const descriptorSha = describeCommit(
    git,
    routes,
    7,
    setup.authorId ?? 583231,
  );
  if (setup.pulls !== undefined) {
    routes[`repos/${REGISTRY}/commits/${descriptorSha}/pulls`] = setup.pulls;
  }
  if (setup.second === true) {
    git(
      "add",
      "--",
      ...write(seed, {
        "community/word-counter.json": JSON.stringify(WORD_DESCRIPTOR),
      }),
    );
    git("commit", "--quiet", "-m", "Add word-counter (#8)");
    describeCommit(git, routes, 8, 583231);
  }
  git("push", "--quiet", "origin", "HEAD:main");
  const work = join(base, "work");
  gitIn(base)("clone", "--quiet", origin, work);
  return { api: fakeGithub(routes), base, descriptorSha, origin, work };
}

/**
 * What GitHub answers about the commit at HEAD, read back from git: its parents and every file
 * it changed (so an add is "added" and an edit "modified"), and the one merged pull request,
 * number `pr`, opened by `authorId`, whose merge commit it is. Returns the commit's SHA.
 */
function describeCommit(
  git: (...args: string[]) => string,
  routes: Record<string, GithubReply>,
  pr: number,
  authorId: number,
): string {
  const commit = git("rev-parse", "HEAD").trim();
  const files = git(
    "show",
    "--format=",
    "--no-renames",
    "--name-status",
    "HEAD",
  )
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [code, filename] = line.split("\t");
      return { filename, status: STATUS[code] };
    });
  const parents = git("rev-list", "--parents", "-n", "1", "HEAD")
    .trim()
    .split(" ")
    .slice(1);
  routes[`repos/${REGISTRY}/commits/${commit}`] = ok({
    files,
    parents: parents.map((parent) => ({ sha: parent })),
  });
  routes[`repos/${REGISTRY}/commits/${commit}/pulls`] = ok([
    {
      merge_commit_sha: commit,
      merged_at: "2026-09-24T00:00:00Z",
      number: pr,
      user: { id: authorId },
    },
  ]);
  return commit;
}

function write(
  dir: string,
  files: Record<string, string | Uint8Array>,
): string[] {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return Object.keys(files);
}
