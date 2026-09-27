// §380 — the passing world the gate tests edit one option at a time (plan 0105 Task 9).
//
// A harness, not a fixture: it builds real git repositories for the pull request's head and for
// main, and the fake GitHub and asset routes that answer for them. It never judges — expected
// values stay hand-written literals in the tests. A test file that calls `world()` registers
// `afterAll(cleanUpWorlds)` so the repositories it made are removed.
import type { GateDeps, GateInput } from "../../../scripts/community-gate";
import type { GithubReply } from "../../../scripts/community-github";

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runGate } from "../../../scripts/community-gate";
import { communityEntry } from "./community-fixture";
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

export const BASE = "https://sayinel.github.io/baram-plugins/";
const REGISTRY = "sayinel/baram-plugins";
const BASE_SHA = "b".repeat(40);
const CDN =
  "https://release-assets.githubusercontent.com/github-production-release-asset/1/2";
const DESCRIPTOR = "community/hello-counter.json";
/** The account id whose pull request merges a pending descriptor version, keyed by the publisher it names. */
const ACCOUNT_IDS: Record<string, number> = {
  octocat: 583231,
  someone: 424242,
};

const made: string[] = [];

export interface World {
  authorId?: number;
  changed?: unknown[];
  community?: unknown[];
  /** Replaces the descriptor outright — its `sha256` is then the test's to write. */
  descriptor?: Record<string, unknown>;
  /** Fields merged over the passing descriptor, which keeps the served archive's `sha256`. */
  descriptorEdit?: Record<string, unknown>;
  descriptorText?: string;
  /** The SHA the gate is told to judge, when it is not the pull request's own head commit. */
  headSha?: string;
  indexPlugins?: unknown[];
  manifest?: Record<string, unknown>;
  /**
   * Commits to community/hello-counter.json on main, oldest first — merged, not yet published
   * (plan 0105 P24). `null` is a maintainer's pull request deleting the file (P27).
   */
  pendingHistory?: (null | Record<string, unknown>)[];
  /** Commit the descriptor path as a symlink (mode 120000) to a file holding the descriptor. */
  prSymlink?: boolean;
  repo?: Parameters<typeof repoReply>[0];
  served?: Uint8Array;
  /** Written over the descriptor AFTER the commit — what the checkout shows, not what it holds. */
  workingTree?: string;
}

export function cleanUpWorlds(): void {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
}

export async function gate(o?: World) {
  const w = world(o);
  return runGate(w.input, w.deps);
}

/** A git command in `dir`, with an identity and a branch name that do not depend on the machine. */
export function gitIn(dir: string): (...args: string[]) => string {
  return (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "-c",
        "init.defaultBranch=main",
        "-C",
        dir,
        ...args,
      ],
      { encoding: "utf8" },
    );
}

/** "<step>: <reason>" for a refusal, the decision otherwise — one string to compare. */
export async function outcome(o?: World): Promise<string> {
  const result = await gate(o);
  if (result.kind === "refused") return `${result.step}: ${result.reason}`;
  return result.kind === "passed" ? result.decision : result.kind;
}

/** hello-counter 1.1.0 as community.json publishes it — the entry an update is judged against. */
export function published(over: Record<string, unknown> = {}) {
  return communityEntry({
    author: "Octo Cat",
    capabilities: ["editor:readonly", "events", "statusbar"],
    description: "Counts characters in the status bar.",
    downloadUrl: `${BASE}plugins/hello-counter-1.1.0.zip`,
    name: "Hello Counter",
    publisherId: 583231,
    repoId: 555,
    version: "1.1.0",
    ...over,
  });
}

export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

export function world(o: World = {}): { deps: GateDeps; input: GateInput } {
  const served = o.served ?? pluginZip(o.manifest ?? validManifest());
  const descriptor = o.descriptor ?? {
    ...SUBMISSION,
    release: { ...SUBMISSION.release, sha256: sha(served) },
    ...o.descriptorEdit,
  };
  const repo = String(descriptor.repo);
  const release = descriptor.release as { asset: string; tag: string };
  const assetUrl = `https://github.com/${repo}/releases/download/${release.tag}/${release.asset}`;
  const text = o.descriptorText ?? JSON.stringify(descriptor);
  // The pull request's head as a real repository: the gate reads the descriptor from its commit.
  const prRoot = tempDir("baram-gate-pr-");
  const pr = gitIn(prRoot);
  pr("init", "--quiet");
  mkdirSync(join(prRoot, "community"));
  if (o.prSymlink === true) {
    writeFileSync(join(prRoot, "target.json"), text);
    symlinkSync("../target.json", join(prRoot, DESCRIPTOR));
  } else {
    writeFileSync(join(prRoot, DESCRIPTOR), text);
  }
  pr("add", "--all");
  pr("commit", "--quiet", "-m", "submission");
  const headSha = o.headSha ?? pr("rev-parse", "HEAD").trim();
  if (o.workingTree !== undefined) {
    writeFileSync(join(prRoot, DESCRIPTOR), o.workingTree);
  }
  const routes: Record<string, GithubReply> = {
    [`repos/${REGISTRY}/compare/${BASE_SHA}...${headSha}`]: ok({
      files: o.changed ?? [{ filename: DESCRIPTOR, status: "modified" }],
    }),
    [`repos/${repo}`]: repoReply({ fullName: repo, ...o.repo }),
  };
  const publishedRoot = tempDir("baram-gate-main-");
  mainWithHistory(publishedRoot, o, routes);
  return {
    deps: {
      api: fakeGithub(routes),
      archiveCap: 32 * 1024 * 1024,
      fetch: assetFetch({
        [assetUrl]: { location: CDN, status: 302 },
        [CDN]: { bytes: served, status: 200 },
      }),
      limits: REAL_LIMITS,
      readmeCap: REAL_README_CAP,
      registryCap: 4 * 1024 * 1024,
    },
    input: {
      authorId: o.authorId ?? 583231,
      baseSha: BASE_SHA,
      baseUrl: BASE,
      headSha,
      prRoot,
      publishedRoot,
      registryRepo: REGISTRY,
      root: resolve(__dirname, "../../.."),
    },
  };
}

/**
 * main as a real repository — P24 reads the FIRST commit that added a descriptor — and, for each
 * descriptor commit, what GitHub answers about it: its one parent, what it did to the file (read
 * back from git, so an add is "added" and an edit "modified"), and the merged pull request that
 * brought it to main, authored by the account the version's publisher names.
 */
function mainWithHistory(
  dir: string,
  o: World,
  routes: Record<string, GithubReply>,
): void {
  const git = gitIn(dir);
  git("init", "--quiet");
  writeFileSync(
    join(dir, "index.json"),
    JSON.stringify({ plugins: o.indexPlugins ?? [] }),
  );
  writeFileSync(
    join(dir, "community.json"),
    JSON.stringify({ communityPlugins: o.community ?? [published()] }),
  );
  git("add", "--", "index.json", "community.json");
  git("commit", "--quiet", "-m", "seed");
  for (const [n, version] of (o.pendingHistory ?? []).entries()) {
    if (version === null) {
      git("rm", "--quiet", "--", DESCRIPTOR);
      git(
        "commit",
        "--quiet",
        "-m",
        `a maintainer deletes the descriptor (${n + 1})`,
      );
      continue;
    }
    mkdirSync(join(dir, "community"), { recursive: true });
    writeFileSync(join(dir, DESCRIPTOR), JSON.stringify(version));
    git("add", "--", DESCRIPTOR);
    git("commit", "--quiet", "-m", `descriptor ${n + 1}`);
    const commit = git("rev-parse", "HEAD").trim();
    const did = git("show", "--format=", "--name-status", "HEAD").trim();
    routes[`repos/${REGISTRY}/commits/${commit}`] = ok({
      files: [
        {
          filename: DESCRIPTOR,
          status: did.startsWith("A\t") ? "added" : "modified",
        },
      ],
      parents: [{ sha: git("rev-parse", "HEAD^").trim() }],
    });
    routes[`repos/${REGISTRY}/commits/${commit}/pulls`] = ok([
      {
        merge_commit_sha: commit,
        merged_at: "2026-09-24T00:00:00Z",
        number: n + 1,
        user: { id: ACCOUNT_IDS[String(version.publisher)] },
      },
    ]);
  }
}
