// §380 gate 0's compare-diff classifier and gate 3's ownership judgment (plan 0105 Task 7).
// `githubGet` and `repoFacts` are covered in community-github-http.test.ts;
// `mergedPullRequest` and `pendingDescriptorConflict` in community-github-pending.test.ts.
import { describe, expect, it } from "vitest";

import { classifyChange, ownership } from "../../../scripts/community-github";
import { fakeGithub, ok, SUBMISSION } from "./community-gate-fixtures";

const REGISTRY = "sayinel/baram-plugins";
const BASE = "b".repeat(40);
const HEAD = "c".repeat(40);
const COMPARE = `repos/${REGISTRY}/compare/${BASE}...${HEAD}`;

const classify = (files: unknown[]) =>
  classifyChange(
    fakeGithub({ [COMPARE]: ok({ files }) }),
    REGISTRY,
    BASE,
    HEAD,
  );

describe("classifyChange — gate 0, at the two SHAs", () => {
  it("reads one added or modified descriptor as a submission", async () => {
    expect(
      await classify([
        { filename: "community/hello-counter.json", status: "added" },
      ]),
    ).toEqual({ id: "hello-counter", kind: "submission" });
    expect(
      await classify([
        { filename: "community/hello-counter.json", status: "modified" },
      ]),
    ).toEqual({ id: "hello-counter", kind: "submission" });
  });

  it("refuses a second file beside the descriptor", async () => {
    expect(
      await classify([
        { filename: "community/hello-counter.json", status: "added" },
        { filename: "index.json", status: "modified" },
      ]),
    ).toEqual({
      error:
        "a submission changes exactly one file, community/<id>.json — this one changes 2",
      kind: "refused",
    });
  });

  it("refuses a descriptor that was renamed", async () => {
    const result = await classify([
      {
        filename: "community/hello-counter.json",
        previous_filename: "community/old.json",
        status: "renamed",
      },
    ]);
    expect(result).toEqual({
      error:
        "community/hello-counter.json is renamed — a submission may only add or modify its descriptor",
      kind: "refused",
    });
  });

  it("leaves a pull request that only deletes descriptors to a person — the maintainer's lever (P24, P27)", async () => {
    expect(
      await classify([
        { filename: "community/hello-counter.json", status: "removed" },
      ]),
    ).toEqual({ kind: "maintenance" });
    expect(
      await classify([
        { filename: "community/a.json", status: "removed" },
        { filename: "community/b.json", status: "removed" },
        { filename: "README.md", status: "modified" },
      ]),
    ).toEqual({ kind: "maintenance" });
  });

  it("still judges a deletion that rides along with an addition — the twin", async () => {
    expect(
      await classify([
        { filename: "community/old.json", status: "removed" },
        { filename: "community/hello-counter.json", status: "added" },
      ]),
    ).toEqual({
      error:
        "a submission changes exactly one file, community/<id>.json — this one changes 2",
      kind: "refused",
    });
  });

  it("counts a rename OUT of community/ as touching it", async () => {
    expect(
      await classify([
        {
          filename: "elsewhere/x.json",
          previous_filename: "community/x.json",
          status: "renamed",
        },
      ]),
    ).toEqual({
      error:
        "elsewhere/x.json is renamed — a submission may only add or modify its descriptor",
      kind: "refused",
    });
  });

  it("refuses a path that is not community/<id>.json", async () => {
    expect(
      await classify([{ filename: "community/sub/x.json", status: "added" }]),
    ).toEqual({
      error: "community/sub/x.json is not community/<id>.json",
      kind: "refused",
    });
  });

  it("leaves a pull request that never touches community/ to a person", async () => {
    expect(
      await classify([{ filename: "README.md", status: "modified" }]),
    ).toEqual({ kind: "maintenance" });
  });

  it("refuses a file entry with no string filename or status — refusing to guess what it changed", async () => {
    expect(await classify([{ status: "added" }])).toEqual({
      error:
        "GitHub's comparison includes a file entry with no filename or status — refusing to guess what it changed",
      kind: "refused",
    });
    expect(
      await classify([{ filename: "community/hello-counter.json" }]),
    ).toEqual({
      error:
        "GitHub's comparison includes a file entry with no filename or status — refusing to guess what it changed",
      kind: "refused",
    });
  });

  it("refuses when GitHub cannot compare the two SHAs", async () => {
    expect(await classifyChange(fakeGithub({}), REGISTRY, BASE, HEAD)).toEqual({
      error: `GitHub answered HTTP 404 comparing ${BASE}...${HEAD}`,
      kind: "refused",
    });
  });

  // GitHub's compare API docs, under "Working with large comparisons … When using pagination:"
  // (https://docs.github.com/en/rest/commits/commits#compare-two-commits, read 2026-09-28):
  // "The list of changed files is only shown on the first page of results, and it includes up to
  // 300 changed files for the entire comparison." This call never paginates (no `page` or
  // `per_page`), which IS the first page. A separate, earlier sentence in the endpoint's own
  // description (not under that heading) bounds `commits` instead: "When calling this endpoint
  // without any paging parameter (per_page or page), the returned list is limited to 250
  // commits" — `files` and `commits` are two different lists with two different limits.
  // Re-measured directly against an unpaged, real large comparison (`gh api repos/cli/cli/compare/
  // v2.0.0...v2.60.0`, 2026-09-28): `files.length` is exactly 300, `total_commits` 4076 — nothing
  // in the response marks the file list as cut off, no total-file count beside it to compare
  // against.
  //
  // At the cap, a VISIBLE non-removal touch under community/ still refuses (plan 0105 P3: it's a
  // submission, and more than one file is always "exactly one file"); only the absence of any
  // such visible touch falls to maintenance, since the truncated part might hide one.
  it("refuses — not maintenance — at GitHub's 300-file cap when a visible entry touches community/", async () => {
    const files = [
      { filename: "community/hello-counter.json", status: "added" },
      ...Array.from({ length: 299 }, (_, index) => ({
        filename: `unrelated/${index}.txt`,
        status: "modified",
      })),
    ];
    expect(await classify(files)).toEqual({
      error:
        "a submission changes exactly one file, community/<id>.json — this one changes 300",
      kind: "refused",
    });
  });

  it("falls to maintenance at the cap only when nothing visible touches community/ — the twin", async () => {
    const files = Array.from({ length: 300 }, (_, index) => ({
      filename: `unrelated/${index}.txt`,
      status: "modified",
    }));
    expect(await classify(files)).toEqual({ kind: "maintenance" });
  });

  it("still falls to maintenance at the cap when the only visible community/ touch is a removal — P27's lever survives the cap", async () => {
    const files = [
      { filename: "community/old-id.json", status: "removed" },
      ...Array.from({ length: 299 }, (_, index) => ({
        filename: `unrelated/${index}.txt`,
        status: "modified",
      })),
    ];
    expect(await classify(files)).toEqual({ kind: "maintenance" });
  });

  it("still applies the ordinary rules one file below the cap — the twin", async () => {
    const files = [
      { filename: "community/hello-counter.json", status: "added" },
      ...Array.from({ length: 298 }, (_, index) => ({
        filename: `unrelated/${index}.txt`,
        status: "modified",
      })),
    ];
    expect(await classify(files)).toEqual({
      error:
        "a submission changes exactly one file, community/<id>.json — this one changes 299",
      kind: "refused",
    });
  });
});

describe("ownership — gate 3, by numeric id", () => {
  const facts = {
    fullName: "octocat/baram-hello-counter",
    isPrivate: false,
    ownerId: 583231,
    ownerType: "User",
    repoId: 555,
  };
  const recorded = { publisherId: 583231, repoId: 555 };

  it("accepts the owner's own pull request, new or update — the twin of every refusal", () => {
    expect(ownership(SUBMISSION, facts, 583231, undefined)).toEqual({
      ok: true,
      publisherId: 583231,
      repoId: 555,
    });
    expect(ownership(SUBMISSION, facts, 583231, recorded)).toEqual({
      ok: true,
      publisherId: 583231,
      repoId: 555,
    });
  });

  it("refuses a pull request from someone who does not own the repository", () => {
    expect(ownership(SUBMISSION, facts, 999, undefined)).toEqual({
      error:
        "the pull request author (id 999) does not own octocat/baram-hello-counter (owner id 583231)",
      ok: false,
    });
  });

  it("refuses the same login held by a different account", () => {
    // octocat renamed or deleted; someone else registered "octocat" (id 777777) and recreated
    // the repository. Login and repo name match the published entry; the ids do not.
    const successor = { ...facts, ownerId: 777777, repoId: 888 };
    const result = ownership(SUBMISSION, successor, 777777, recorded);
    expect(result.ok ? "ok" : result.error).toBe(
      "hello-counter was published by account id 583231; this pull request comes from id 777777 — identity is the numeric id, which a reused login does not carry",
    );
  });

  it("refuses a repository transferred to a new owner, even with the same repository id", () => {
    // The repository itself (id 555) moved to a new owner (777777) via GitHub's transfer
    // feature, rather than being deleted and recreated — repoId is unchanged, only ownerId is.
    const transferred = { ...facts, ownerId: 777777 };
    const result = ownership(SUBMISSION, transferred, 777777, recorded);
    expect(result.ok ? "ok" : result.error).toBe(
      "hello-counter was published by account id 583231; this pull request comes from id 777777 — identity is the numeric id, which a reused login does not carry",
    );
  });

  it("refuses a recreated repository under the same owner", () => {
    const result = ownership(
      SUBMISSION,
      { ...facts, repoId: 556 },
      583231,
      recorded,
    );
    expect(result.ok ? "ok" : result.error).toBe(
      "hello-counter was published from repository id 555; octocat/baram-hello-counter is id 556 — a recreated repository is a new repository",
    );
  });

  it.each([
    [
      { fullName: "Octocat/baram-hello-counter" },
      'the descriptor says "octocat/baram-hello-counter" but GitHub calls it "Octocat/baram-hello-counter" — write the canonical name, so the publisher users see is current',
    ],
    [
      { ownerType: "Organization" },
      "the repository must belong to a personal account — organization-owned repositories are not accepted yet",
    ],
    [{ isPrivate: true }, "the repository must be public"],
  ])("refuses %j", (over, message) => {
    const result = ownership(
      SUBMISSION,
      { ...facts, ...over },
      583231,
      undefined,
    );
    expect(result.ok ? "ok" : result.error).toBe(message);
  });
});
