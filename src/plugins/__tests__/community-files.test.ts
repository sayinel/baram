// §380/§381 — the registry file helpers the gate and the publish job share (plan 0105 Task 9):
// what they refuse to read, which commit they name, and how a missing tool surfaces.
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  EMPTY_COMMUNITY,
  firstDescriptorCommit,
  readAppBounds,
  readDescriptor,
  readDescriptorAt,
  validateRegistryDocument,
} from "../../../scripts/community-files";
import { cleanUpWorlds, gitIn, tempDir } from "./community-gate-world";

afterAll(cleanUpWorlds);

const ROOT = resolve(__dirname, "../../..");
const TEXT = '{"id":"hello-counter"}';

describe("readDescriptor — a descriptor in a plain directory", () => {
  it("refuses a symlink at the descriptor's path, even one pointing at a regular file", () => {
    const dir = tempDir("baram-files-link-");
    mkdirSync(join(dir, "community"));
    writeFileSync(join(dir, "target.json"), TEXT);
    symlinkSync("../target.json", join(dir, "community", "hello-counter.json"));
    expect(readDescriptor(dir, "hello-counter")).toEqual({
      error: "community/hello-counter.json is not a regular file",
      ok: false,
    });
  });

  it("reads a regular file's bytes", () => {
    const dir = tempDir("baram-files-plain-");
    mkdirSync(join(dir, "community"));
    writeFileSync(join(dir, "community", "hello-counter.json"), TEXT);
    const read = readDescriptor(dir, "hello-counter");
    expect(read.ok ? Buffer.from(read.bytes).toString("utf8") : read).toBe(
      TEXT,
    );
  });
});

describe("readDescriptorAt — a descriptor at one named commit", () => {
  it("throws on a ref or an abbreviated SHA, and reads the same commit named in full", () => {
    const dir = tempDir("baram-files-at-");
    const git = gitIn(dir);
    git("init", "--quiet");
    mkdirSync(join(dir, "community"));
    writeFileSync(join(dir, "community", "hello-counter.json"), TEXT);
    git("add", "--all");
    git("commit", "--quiet", "-m", "descriptor");
    const full = git("rev-parse", "HEAD").trim();
    for (const named of ["HEAD", "main", full.slice(0, 7)]) {
      expect(() => readDescriptorAt(dir, named, "hello-counter")).toThrow(
        `readDescriptorAt takes a full 40-character commit SHA, not ${JSON.stringify(named)}`,
      );
    }
    // The twin: the full SHA of that very commit reads its descriptor.
    const read = readDescriptorAt(dir, full, "hello-counter");
    expect(read.ok ? Buffer.from(read.bytes).toString("utf8") : read).toBe(
      TEXT,
    );
  });
});

describe("readDescriptorAt — what it refuses to read", () => {
  /** A repository whose one commit holds `community/hello-counter.json` = `text`. */
  const committed = (text: string, executable = false) => {
    const dir = tempDir("baram-files-refuse-");
    const git = gitIn(dir);
    git("init", "--quiet");
    mkdirSync(join(dir, "community"));
    writeFileSync(join(dir, "community", "hello-counter.json"), text);
    git("add", "--all");
    if (executable) {
      git("update-index", "--chmod=+x", "community/hello-counter.json");
    }
    git("commit", "--quiet", "-m", "descriptor");
    return { dir, git, sha: git("rev-parse", "HEAD").trim() };
  };

  it("refuses a blob over the descriptor cap by its size, and reads one exactly at it", () => {
    const over = committed("x".repeat(4097));
    expect(readDescriptorAt(over.dir, over.sha, "hello-counter")).toEqual({
      error: "the descriptor is 4097 bytes, over the 4096-byte limit",
      ok: false,
    });
    const at = committed("x".repeat(4096));
    const read = readDescriptorAt(at.dir, at.sha, "hello-counter");
    expect(read.ok ? read.bytes.length : read).toBe(4096);
  });

  it("refuses an executable descriptor (mode 100755) — its twin is the 100644 read above", () => {
    const { dir, git, sha } = committed(TEXT, true);
    expect(git("ls-tree", sha, "--", "community/hello-counter.json")).toMatch(
      /^100755 /u,
    );
    expect(readDescriptorAt(dir, sha, "hello-counter")).toEqual({
      error: "community/hello-counter.json is not a regular file",
      ok: false,
    });
  });

  it("throws on a full SHA that names a blob, not a commit", () => {
    const { dir, git } = committed(TEXT);
    const blob = git("rev-parse", "HEAD:community/hello-counter.json").trim();
    expect(() => readDescriptorAt(dir, blob, "hello-counter")).toThrow(
      `${dir} holds no commit ${blob} — check out the pull request's head commit before running the gate`,
    );
  });
});

describe("firstDescriptorCommit — where the path itself first appeared", () => {
  it("names the commit that created community/<id>.json, not the file it was renamed from, even with log.follow set", () => {
    const dir = tempDir("baram-files-rename-");
    const git = gitIn(dir);
    git("init", "--quiet");
    mkdirSync(join(dir, "community"));
    writeFileSync(join(dir, "community", "a.json"), TEXT);
    git("add", "--all");
    git("commit", "--quiet", "-m", "add a");
    const addedA = git("rev-parse", "HEAD").trim();
    git("mv", "community/a.json", "community/hello-counter.json");
    git("commit", "--quiet", "-m", "rename a");
    const renamed = git("rev-parse", "HEAD").trim();
    git("config", "log.follow", "true");
    // The setting is live: a plain `git log` on the path now follows it back to a.json.
    expect(
      git(
        "log",
        "--diff-filter=A",
        "--format=%H",
        "--",
        "community/hello-counter.json",
      ).trim(),
    ).toBe(addedA);
    expect(firstDescriptorCommit(dir, "hello-counter")).toBe(renamed);
  });
});

describe(
  "validateRegistryDocument — a tool that cannot start",
  { timeout: 60_000 },
  () => {
    it("throws when the validator cannot be spawned, instead of returning a refusal", () => {
      const empty = tempDir("baram-files-noroot-");
      const path = join(empty, "community.json");
      writeFileSync(path, EMPTY_COMMUNITY);
      expect(() => validateRegistryDocument(empty, path)).toThrow(/ENOENT/u);
      // The twin: the same document, validated from this repository, passes.
      expect(validateRegistryDocument(ROOT, path)).toEqual({ ok: true });
    });
  },
);

describe("readAppBounds — the app's bounds, read once for both CLIs", () => {
  it("reads the archive and registry bounds the app ships", () => {
    expect(readAppBounds(ROOT)).toEqual({
      archiveCap: 32 * 1024 * 1024,
      limits: {
        allowedMethods: [0, 8],
        maxCompressionRatio: 100,
        maxEntries: 2000,
        maxEntryBytes: 64 * 1024 * 1024,
        maxPathDepth: 16,
        maxTotalExpandedBytes: 256 * 1024 * 1024,
        ratioFloorBytes: 1024 * 1024,
      },
      readmeCap: 256 * 1024,
      registryCap: 4 * 1024 * 1024,
    });
  });

  it("throws when the Rust it reads is not there", () => {
    expect(() => readAppBounds(tempDir("baram-files-nobounds-"))).toThrow(
      /ENOENT/u,
    );
  });
});
