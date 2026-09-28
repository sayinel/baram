// §380 gate 3's pending-descriptor window (plan 0105 P24, spec 0058 §11) and §381 publish step
// 1 — `mergedPullRequest` and `pendingDescriptorConflict`.
import { describe, expect, it } from "vitest";

import {
  mergedPullRequest,
  pendingDescriptorConflict,
} from "../../../scripts/community-github";
import { fakeGithub, ok } from "./community-gate-fixtures";

const REGISTRY = "sayinel/baram-plugins";

describe("mergedPullRequest — who brought a commit to main", () => {
  const sha = "d".repeat(40);
  const path = `repos/${REGISTRY}/commits/${sha}/pulls`;
  const merged = {
    merge_commit_sha: sha,
    merged_at: "2026-09-24T00:00:00Z",
    number: 7,
    user: { id: 583231 },
  };

  it("answers with the one merged pull request whose merge commit this is", async () => {
    expect(
      await mergedPullRequest(
        fakeGithub({ [path]: ok([merged]) }),
        REGISTRY,
        sha,
      ),
    ).toEqual({ authorId: 583231, number: 7, ok: true });
  });

  it.each([
    [
      "an open pull request that merely contains it",
      [{ ...merged, merged_at: null }],
    ],
    [
      "a pull request merged as another commit",
      [{ ...merged, merge_commit_sha: "e".repeat(40) }],
    ],
    ["no pull request at all", []],
    ["two candidates", [merged, { ...merged, number: 8 }]],
    ["a pull request with no user recorded", [{ ...merged, user: null }]],
    ["a pull request numbered 0", [{ ...merged, number: 0 }]],
  ])("refuses %s", async (_label, body) => {
    const result = await mergedPullRequest(
      fakeGithub({ [path]: ok(body) }),
      REGISTRY,
      sha,
    );
    expect(result.ok ? "ok" : result.error).toBe(
      `no single merged pull request introduced ${sha} — a descriptor reaches main only through a reviewed pull request`,
    );
    expect(result.ok ? undefined : result.status).toBeUndefined();
  });

  // An unreadable 200 is not a definite answer: GitHub answered, but not with the array shape
  // this reads, so a caller must be able to tell it apart from a well-formed list that simply
  // names no single match (the it.each block above, whose `status` stays undefined).
  it("marks a 200 reply that is not an array with status 200 too", async () => {
    expect(
      await mergedPullRequest(fakeGithub({ [path]: ok({}) }), REGISTRY, sha),
    ).toEqual({
      error: `GitHub's answer listing pull requests for commit ${sha} could not be read`,
      ok: false,
      status: 200,
    });
  });

  it("marks a non-200 reply with its status, so a caller can tell a transient failure apart from a definite 'no match'", async () => {
    expect(
      await mergedPullRequest(
        fakeGithub({ [path]: { body: null, status: 502 } }),
        REGISTRY,
        sha,
      ),
    ).toEqual({
      error: `GitHub answered HTTP 502 listing pull requests for commit ${sha}`,
      ok: false,
      status: 502,
    });
  });
});

describe("pendingDescriptorConflict — a merged, unpublished descriptor belongs to whoever GitHub merged its first-add pull request for, once that commit is confirmed single-file (P24, spec 0058 §11)", () => {
  const firstAddSha = "e".repeat(40);
  const commitPath = `repos/${REGISTRY}/commits/${firstAddSha}`;
  const pullsPath = `${commitPath}/pulls`;
  const validCommit = ok({
    files: [{ filename: "community/hello-counter.json", status: "added" }],
    parents: [{ sha: "f".repeat(40) }],
  });
  const merged = {
    merge_commit_sha: firstAddSha,
    merged_at: "2026-09-20T00:00:00Z",
    number: 3,
    user: { id: 583231 },
  };
  const api = fakeGithub({
    [commitPath]: validCommit,
    [pullsPath]: ok([merged]),
  });

  it("lets the first-add pull request's own author change it — the twin of every refusal below", async () => {
    expect(
      await pendingDescriptorConflict(
        api,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBeNull();
  });

  it("refuses another author", async () => {
    expect(
      await pendingDescriptorConflict(
        api,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        42,
      ),
    ).toBe(
      "hello-counter is already submitted and not yet published, first added by account id 583231; a pull request from id 42 may not replace it — only a maintainer can release hello-counter, by merging a pull request that deletes community/hello-counter.json",
    );
  });

  // Account 583231 renames itself or is deleted, and account 999999 registers the freed login
  // and recreates the repository under the same name (spec 0058 §11). A lookup by repository
  // NAME would resolve to 999999's repository and let it pass; comparing the numeric author id
  // of the pull request that first added the descriptor does not, because that id is still
  // 583231's, whatever login 999999 now holds.
  it("refuses a different account holding the reused login — numeric identity defeats it", async () => {
    expect(
      await pendingDescriptorConflict(
        api,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        999999,
      ),
    ).toBe(
      "hello-counter is already submitted and not yet published, first added by account id 583231; a pull request from id 999999 may not replace it — only a maintainer can release hello-counter, by merging a pull request that deletes community/hello-counter.json",
    );
  });

  const singleFileRefusal =
    "hello-counter is already submitted and not yet published; the first version of its descriptor did not arrive as a single-file submission, so its owner cannot be established — only a maintainer can release hello-counter, by merging a pull request that deletes community/hello-counter.json";

  it("refuses when the first-add commit changed more than one file", async () => {
    const twoFiles = fakeGithub({
      [commitPath]: ok({
        files: [
          { filename: "community/hello-counter.json", status: "added" },
          { filename: "other.txt", status: "added" },
        ],
        parents: [{ sha: "f".repeat(40) }],
      }),
      [pullsPath]: ok([merged]),
    });
    expect(
      await pendingDescriptorConflict(
        twoFiles,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBe(singleFileRefusal);
  });

  it("refuses when the first-add commit's one file is a different path", async () => {
    const wrongPath = fakeGithub({
      [commitPath]: ok({
        files: [{ filename: "community/other.json", status: "added" }],
        parents: [{ sha: "f".repeat(40) }],
      }),
      [pullsPath]: ok([merged]),
    });
    expect(
      await pendingDescriptorConflict(
        wrongPath,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBe(singleFileRefusal);
  });

  it("refuses when the first-add commit's one file was not added", async () => {
    const modified = fakeGithub({
      [commitPath]: ok({
        files: [
          { filename: "community/hello-counter.json", status: "modified" },
        ],
        parents: [{ sha: "f".repeat(40) }],
      }),
      [pullsPath]: ok([merged]),
    });
    expect(
      await pendingDescriptorConflict(
        modified,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBe(singleFileRefusal);
  });

  it("refuses when the first-add commit has more than one parent — a merge commit, not a squash", async () => {
    const twoParents = fakeGithub({
      [commitPath]: ok({
        files: [{ filename: "community/hello-counter.json", status: "added" }],
        parents: [{ sha: "f".repeat(40) }, { sha: "1".repeat(40) }],
      }),
      [pullsPath]: ok([merged]),
    });
    expect(
      await pendingDescriptorConflict(
        twoParents,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBe(singleFileRefusal);
  });

  const unreadableRefusal = `hello-counter is already submitted and not yet published; GitHub's answer about commit ${firstAddSha}, where its descriptor first arrived, could not be read — re-run this check`;

  it("refuses, without the lever, when the first-add commit's answer cannot be read at all", async () => {
    const unreadable = fakeGithub({
      [commitPath]: ok(null),
      [pullsPath]: ok([merged]),
    });
    expect(
      await pendingDescriptorConflict(
        unreadable,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBe(unreadableRefusal);
  });

  it("refuses, without the lever, when the first-add commit's files list is not an array", async () => {
    const malformed = fakeGithub({
      [commitPath]: ok({
        files: "not-an-array",
        parents: [{ sha: "f".repeat(40) }],
      }),
      [pullsPath]: ok([merged]),
    });
    expect(
      await pendingDescriptorConflict(
        malformed,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBe(unreadableRefusal);
  });

  // One field wrong at a time, the rest valid: a `null` body fails both the parents and the files
  // check, and a string `files` fails both the files check and the entry check, so neither case
  // above shows any one check standing alone.
  it.each([
    [
      "has no parents list",
      {
        files: [{ filename: "community/hello-counter.json", status: "added" }],
      },
    ],
    [
      "has a files field that is an object, not a list",
      { files: {}, parents: [{ sha: "f".repeat(40) }] },
    ],
    [
      "lists a file entry with no filename",
      { files: [{ status: "added" }], parents: [{ sha: "f".repeat(40) }] },
    ],
  ])(
    "refuses, without the lever, when the first-add commit's answer %s",
    async (_label, body) => {
      const malformed = fakeGithub({
        [commitPath]: ok(body),
        [pullsPath]: ok([merged]),
      });
      expect(
        await pendingDescriptorConflict(
          malformed,
          REGISTRY,
          firstAddSha,
          "hello-counter",
          583231,
        ),
      ).toBe(unreadableRefusal);
    },
  );

  it("refuses, without the lever, when GitHub cannot answer 200 for the first-add commit itself — a transient failure to re-run", async () => {
    const down = fakeGithub({
      [commitPath]: { body: null, status: 502 },
      [pullsPath]: ok([merged]),
    });
    expect(
      await pendingDescriptorConflict(
        down,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBe(
      "hello-counter is already submitted and not yet published; GitHub answered HTTP 502 reading how its descriptor first arrived — re-run this check",
    );
  });

  it("refuses, without the lever, when GitHub cannot list pull requests for the first-add commit — a transient failure to re-run", async () => {
    const down = fakeGithub({ [commitPath]: validCommit }); // no pulls route: 404
    expect(
      await pendingDescriptorConflict(
        down,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBe(
      `hello-counter is already submitted and not yet published; GitHub answered HTTP 404 listing pull requests for commit ${firstAddSha} — re-run this check`,
    );
  });

  it("refuses, without the lever, when GitHub's 200 listing pull requests for the first-add commit is not a list — unread, not a definite 'no pull request'", async () => {
    const unreadable = fakeGithub({
      [commitPath]: validCommit,
      [pullsPath]: ok(null),
    });
    expect(
      await pendingDescriptorConflict(
        unreadable,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBe(
      `hello-counter is already submitted and not yet published; GitHub's answer listing pull requests for commit ${firstAddSha} could not be read — re-run this check`,
    );
  });

  it("refuses, with the lever, when GitHub definitely finds no pull request for the first-add commit — e.g. it reached main by a direct push", async () => {
    const noMatch = fakeGithub({
      [commitPath]: validCommit,
      [pullsPath]: ok([]),
    });
    expect(
      await pendingDescriptorConflict(
        noMatch,
        REGISTRY,
        firstAddSha,
        "hello-counter",
        583231,
      ),
    ).toBe(
      `hello-counter is already submitted and not yet published, and the pull request that first added its descriptor cannot be identified (no single merged pull request introduced ${firstAddSha} — a descriptor reaches main only through a reviewed pull request) — only a maintainer can release hello-counter, by merging a pull request that deletes community/hello-counter.json`,
    );
  });
});
