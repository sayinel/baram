// §381 publish step 6 and §8.5 (spec 0058 §8.2) — what the run reports and what Pages serves:
// the size of what main holds, the live check that waits for Pages, and the lines and
// `$GITHUB_OUTPUT` values the CLI writes from a report.
import type { ReconcileReport } from "../../../scripts/community-publish";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  publishOutputs,
  publishReportLines,
  registryBytes,
  registrySize,
  waitForLive,
} from "../../../scripts/community-live";
import { pluginZip, sha } from "./community-gate-fixtures";
import { BASE, gitIn, tempDir } from "./community-gate-world";

const ZIP = pluginZip();
const expected = new TextEncoder().encode('{"communityPlugins":[]}\n');
const item = {
  checksum: sha(ZIP),
  downloadUrl: `${BASE}plugins/hello-counter-1.2.0.zip`,
  id: "hello-counter",
  version: "1.2.0",
};
const LIST = `${BASE}community.json`;

describe("registryBytes", () => {
  it("sums the blobs main holds, and nothing for a submodule entry", () => {
    const dir = tempDir("baram-bytes-");
    const git = gitIn(dir);
    git("init", "--quiet");
    mkdirSync(join(dir, "b"));
    writeFileSync(join(dir, "a"), "abc");
    writeFileSync(join(dir, "b", "c"), "hello");
    git("add", "--", "a", "b/c");
    // A gitlink: `ls-tree -l` lists it as type "commit" with size "-".
    git("update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},sub`);
    git("commit", "--quiet", "-m", "x");
    expect(registryBytes(dir)).toBe(8);
  });
});

describe("registrySize", () => {
  it("warns once main holds 70% of GitHub Pages' limit, and not a byte before", () => {
    expect(registrySize(700_000_000)).toEqual({
      line: "registry size 700000000 bytes (70.0% of GitHub Pages' 1000000000)",
      percent: "70.0",
      warning:
        "⚠ the registry is at 70.0% of GitHub Pages' site limit (spec 0058 §8.5)",
    });
    // One byte short: the percentage rounds to 70.0, the warning still waits for the limit.
    expect(registrySize(699_999_999)).toEqual({
      line: "registry size 699999999 bytes (70.0% of GitHub Pages' 1000000000)",
      percent: "70.0",
      warning: null,
    });
  });
});

describe("waitForLive", () => {
  const check = (
    fetchBytes: Parameters<typeof waitForLive>[0]["fetchBytes"],
    attempts: number,
  ) =>
    waitForLive({
      attempts,
      baseUrl: BASE,
      expectedCommunity: expected,
      fetchBytes,
      intervalMs: 0,
      published: [item],
      sleep: () => Promise.resolve(),
    });

  it("waits out a stale Pages and succeeds once both files are this run's", async () => {
    let listFetches = 0;
    const result = await check((url) => {
      if (url === LIST) {
        listFetches += 1;
        return Promise.resolve({
          bytes: listFetches < 3 ? new Uint8Array([123, 125]) : expected,
          status: 200,
        });
      }
      return Promise.resolve({ bytes: ZIP, status: 200 });
    }, 5);
    expect(result).toEqual({ attempts: 3, ok: true });
  });

  it("treats a wrong ZIP as a retry, and names it when time runs out", async () => {
    const result = await check(
      (url) =>
        Promise.resolve({
          bytes: url === LIST ? expected : new Uint8Array([9]),
          status: 200,
        }),
      2,
    );
    expect(result.ok ? "ok" : result.error).toMatch(
      /^after 2 attempts: https:\/\/sayinel\.github\.io\/baram-plugins\/plugins\/hello-counter-1\.2\.0\.zip hashes to [0-9a-f]{64}, not [0-9a-f]{64}$/u,
    );
  });

  it("treats a request that throws — a timeout, a reset — as a retry", async () => {
    let fetches = 0;
    const result = await check((url) => {
      fetches += 1;
      if (fetches === 1)
        return Promise.reject(
          new Error("The operation was aborted due to timeout"),
        );
      return Promise.resolve({
        bytes: url === LIST ? expected : ZIP,
        status: 200,
      });
    }, 2);
    expect(result).toEqual({ attempts: 2, ok: true });
  });

  it("does not take a non-200 answer as the list, even with the expected bytes", async () => {
    const result = await check(
      (url) =>
        Promise.resolve({
          bytes: url === LIST ? expected : ZIP,
          status: url === LIST ? 404 : 200,
        }),
      1,
    );
    expect(result).toEqual({
      error: `after 1 attempts: ${LIST} answered HTTP 404`,
      ok: false,
    });
  });
});

describe("publishReportLines and publishOutputs", () => {
  const report: ReconcileReport = {
    aborted: "word-counter: boom\n::error::forged",
    failed: [
      { id: "a", pr: 7, reason: "bad\n::error::forged", stalled: true },
      { id: "b", pr: null, reason: "no pull request", stalled: true },
      { id: "c", pr: 3, reason: "refused", stalled: false },
    ],
    published: [item],
    skipped: [{ id: "d", reason: "later\n::warning::forged" }],
  };

  it("prints every untrusted fragment defanged, the abort included", () => {
    const lines = publishReportLines(report);
    expect(lines.filter((line) => line.startsWith("::"))).toEqual([]);
    expect(lines).toEqual([
      "✓ published hello-counter 1.2.0",
      "· d: later⏎∷warning∷forged",
      "✗ a: bad⏎∷error∷forged",
      "✗ b: no pull request",
      "✗ c: refused",
      "✗ aborted: word-counter: boom⏎∷error∷forged — no descriptor after it was handled",
    ]);
    // The twin: a run that did not abort prints no abort line.
    expect(publishReportLines({ ...report, aborted: null })).toHaveLength(5);
  });

  it("counts published, failed, and stalled failures that name a pull request", () => {
    expect(publishOutputs(report)).toEqual([
      "failed=3",
      "published=1",
      "stalled=1",
    ]);
  });
});
