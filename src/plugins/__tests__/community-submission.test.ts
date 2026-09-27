// §380 gates 1, 2, 4 and 9 — the descriptor and the pure judgments over it (plan 0105 Task 5).
import { describe, expect, it } from "vitest";

import {
  descriptorIdFromPath,
  idConflict,
  MAX_SUBMISSION_BYTES,
  parseSubmission,
  tagVersion,
  versionAdvances,
} from "../../../scripts/community-submission";
import { applyCommunityRules } from "../community-registry";
import { communityEntry } from "./community-fixture";
import { descriptorBytes, SUBMISSION } from "./community-gate-fixtures";

const parse = (value: unknown, expectedId = "hello-counter") =>
  parseSubmission(descriptorBytes(value), expectedId);

describe("parseSubmission", () => {
  it("accepts the canonical descriptor — the twin every refusal below edits one field of", () => {
    expect(parse(SUBMISSION)).toEqual({ ok: true, submission: SUBMISSION });
  });

  it.each([
    [
      "an unknown field",
      { ...SUBMISSION, version: "1.2.0" },
      'unknown field(s) "version"',
    ],
    [
      "an id unlike its file name",
      { ...SUBMISSION, id: "other-plugin" },
      "does not match the file name community/hello-counter.json",
    ],
    [
      "an uppercase id",
      { ...SUBMISSION, id: "Hello" },
      "id must match /^[a-z0-9][a-z0-9-]*$/",
    ],
    [
      "a publisher that is not a login",
      { ...SUBMISSION, publisher: "-octocat" },
      "publisher must be a GitHub login",
    ],
    [
      "a repo someone else owns",
      { ...SUBMISSION, repo: "someone/baram-hello-counter" },
      'the repo\'s owner "someone" must be the publisher "octocat"',
    ],
    [
      "a repo with a path",
      { ...SUBMISSION, repo: "octocat/a/b" },
      'repo must be "<owner>/<name>"',
    ],
    [
      "a tag that is not a version",
      { ...SUBMISSION, release: { ...SUBMISSION.release, tag: "latest" } },
      "release.tag must be <version> or v<version>",
    ],
    [
      "an asset that is not a zip",
      {
        ...SUBMISSION,
        release: { ...SUBMISSION.release, asset: "hello.tar.gz" },
      },
      "release.asset must be a .zip file name",
    ],
    [
      "an uppercase sha256",
      {
        ...SUBMISSION,
        release: { ...SUBMISSION.release, sha256: "A".repeat(64) },
      },
      "release.sha256 must be 64 lowercase hex characters",
    ],
    [
      "an extra release field",
      { ...SUBMISSION, release: { ...SUBMISSION.release, url: "https://x" } },
      'unknown release field(s) "url"',
    ],
  ])("refuses %s at gate 2", (_label, value, message) => {
    const verdict = parse(value);
    if (verdict.ok) throw new Error("accepted");
    expect(verdict.step).toBe(2);
    expect(verdict.error).toContain(message);
  });

  it("refuses an oversized descriptor at gate 1, before parsing it", () => {
    expect(MAX_SUBMISSION_BYTES).toBe(4096);
    const over = parseSubmission(
      new Uint8Array(4097).fill(0x20),
      "hello-counter",
    );
    expect(over.ok ? null : [over.step, over.error]).toEqual([
      1,
      "the descriptor is 4097 bytes, over the 4096-byte limit",
    ]);
    // The twin: at exactly the limit it is parsed — and refused for being blank, at gate 2.
    const exact = parseSubmission(
      new Uint8Array(4096).fill(0x20),
      "hello-counter",
    );
    expect(exact.ok ? null : exact.step).toBe(2);
  });
});

describe("descriptorIdFromPath", () => {
  it.each([
    ["community/hello-counter.json", "hello-counter"],
    ["community/Hello.json", null],
    ["community/sub/x.json", null],
    ["community/x.JSON", null],
    ["other/x.json", null],
    ["community/.json", null],
  ])("%s → %s", (path, id) => {
    expect(descriptorIdFromPath(path)).toBe(id);
  });
});

// Boundary corpus (plan 0105 P20, fix round 1): the app's `applyCommunityRules` and this
// gate's `parseSubmission` must agree on which ids the "baram-" prefix reserves, checked
// against ids that survive one commonly-mutated prefix ("b" or "baram") but not the real one —
// not only the single id that happens to be caught by all three.
describe("first-party prefix — gate and app agree across a boundary corpus", () => {
  it.each([
    ["baram-hello", true],
    ["baram-", true],
    ["baram", false],
    ["baramx", false],
    ["bob", false],
    ["hello", false],
    ["my-baram-x", false],
  ] as const)("id %s is reserved: %s", (id, reserved) => {
    const verdict = parse({ ...SUBMISSION, id }, id);
    expect(verdict.ok).toBe(!reserved);
    if (!verdict.ok) {
      expect(verdict.error).toBe(
        'ids starting with "baram-" are reserved for first-party plugins',
      );
    }
    const appAccepts =
      applyCommunityRules([communityEntry({ id })]).length === 1;
    expect(appAccepts).toBe(!reserved);
    expect(verdict.ok).toBe(appAccepts);
  });
});

describe("gate 2 boundary refusals — fix round 1", () => {
  it.each([
    [
      "a repo with a .. segment",
      { ...SUBMISSION, repo: "octocat/.." },
      'repo must be "<owner>/<name>"',
    ],
    [
      "a repo with a . segment",
      { ...SUBMISSION, repo: "octocat/." },
      'repo must be "<owner>/<name>"',
    ],
    [
      "a repo name with a space",
      { ...SUBMISSION, repo: "octocat/a b" },
      'repo must be "<owner>/<name>"',
    ],
    [
      "a repo name over 100 characters",
      { ...SUBMISSION, repo: `octocat/${"a".repeat(101)}` },
      'repo must be "<owner>/<name>"',
    ],
    [
      "a repo that is not a string",
      { ...SUBMISSION, repo: 1 },
      'repo must be "<owner>/<name>"',
    ],
    [
      "a release that is not an object",
      { ...SUBMISSION, release: null },
      "release must be an object with tag, asset and sha256",
    ],
    [
      "a tag wrapped in an array",
      { ...SUBMISSION, release: { ...SUBMISSION.release, tag: ["v1.2.0"] } },
      "release.tag must be <version> or v<version>",
    ],
    [
      "a tag with a prerelease suffix",
      { ...SUBMISSION, release: { ...SUBMISSION.release, tag: "v1.2.0-beta" } },
      "release.tag must be <version> or v<version>",
    ],
    [
      "a sha256 wrapped in an array",
      {
        ...SUBMISSION,
        release: { ...SUBMISSION.release, sha256: ["0".repeat(64)] },
      },
      "release.sha256 must be 64 lowercase hex characters",
    ],
    [
      "a sha256 one character short",
      {
        ...SUBMISSION,
        release: { ...SUBMISSION.release, sha256: "0".repeat(63) },
      },
      "release.sha256 must be 64 lowercase hex characters",
    ],
    [
      "a sha256 one character over",
      {
        ...SUBMISSION,
        release: { ...SUBMISSION.release, sha256: "0".repeat(65) },
      },
      "release.sha256 must be 64 lowercase hex characters",
    ],
    [
      "an asset with a path segment",
      { ...SUBMISSION, release: { ...SUBMISSION.release, asset: "a/b.zip" } },
      "release.asset must be a .zip file name",
    ],
    ["a top-level array", [], "the descriptor must be a JSON object"],
    ["a top-level null", null, "the descriptor must be a JSON object"],
  ])("refuses %s at gate 2", (_label, value, message) => {
    const verdict = parse(value);
    if (verdict.ok) throw new Error("accepted");
    expect(verdict.step).toBe(2);
    expect(verdict.error).toContain(message);
  });

  it("accepts a repo name that merely starts with a dot — the twin of octocat/. and octocat/..", () => {
    expect(parse({ ...SUBMISSION, repo: "octocat/.github" }).ok).toBe(true);
  });

  it("refuses bytes that are not valid UTF-8, before JSON.parse ever sees them", () => {
    const verdict = parseSubmission(new Uint8Array([0xff]), "hello-counter");
    expect(verdict.ok ? null : [verdict.step, verdict.error]).toEqual([
      2,
      "the descriptor is not valid UTF-8 JSON",
    ]);
  });
});

describe("gate 2 — duplicate and escaped keys are refused before JSON.parse can hide them", () => {
  it("refuses a descriptor with a duplicated id key", () => {
    const text = `{"id":"baram-evil",${JSON.stringify(SUBMISSION).slice(1)}`;
    const verdict = parseSubmission(
      new TextEncoder().encode(text),
      "hello-counter",
    );
    expect(verdict.ok ? null : [verdict.step, verdict.error]).toEqual([
      2,
      'duplicate key "id" in the descriptor — a PR reviewer reads its first occurrence, but JSON.parse silently keeps the last',
    ]);
  });

  it("refuses a descriptor with a duplicated release key", () => {
    const text = `{"release":${JSON.stringify(SUBMISSION.release)},${JSON.stringify(SUBMISSION).slice(1)}`;
    const verdict = parseSubmission(
      new TextEncoder().encode(text),
      "hello-counter",
    );
    expect(verdict.ok ? null : [verdict.step, verdict.error]).toEqual([
      2,
      'duplicate key "release" in the descriptor — a PR reviewer reads its first occurrence, but JSON.parse silently keeps the last',
    ]);
  });

  it("refuses a descriptor with an escaped key spelling", () => {
    const text = JSON.stringify(SUBMISSION).replace('"id"', '"i\\u0064"');
    const verdict = parseSubmission(
      new TextEncoder().encode(text),
      "hello-counter",
    );
    expect(verdict.ok ? null : [verdict.step, verdict.error]).toEqual([
      2,
      "the descriptor may not contain a backslash — an escaped key would let this gate and a PR reviewer read a different field",
    ]);
  });

  // The twin: the plain SUBMISSION, unmodified, is still accepted (see "accepts the canonical
  // descriptor" above) — these checks refuse only text that actually contains a backslash or a
  // repeated key.
});

describe("gate 4 — id uniqueness across both files", () => {
  it("refuses an id index.json already uses, theme or plugin", () => {
    expect(idConflict("hello-counter", ["hello-counter"], [])).toBe(
      'id "hello-counter" is already taken in index.json',
    );
  });

  it("lets an update speak for its own single entry, and refuses an ambiguous one", () => {
    expect(
      idConflict("hello-counter", ["baram-word-count"], ["hello-counter"]),
    ).toBeNull();
    expect(
      idConflict("hello-counter", [], ["hello-counter", "hello-counter"]),
    ).toBe(
      'community.json already holds 2 entries for "hello-counter" — refusing to guess which one this updates',
    );
  });
});

describe("gate 9 — versions only move up", () => {
  it.each([
    ["1.2.0", undefined, true],
    ["1.2.0", "1.1.9", true],
    ["1.2.0", "1.2.0", false],
    ["1.2.0", "1.10.0", false],
    ["garbage", "1.0.0", false],
    ["garbage", undefined, false],
  ] as const)("%s over %s → %s", (next, published, expected) => {
    expect(versionAdvances(next, published)).toBe(expected);
  });

  it("reads the version out of a tag with or without v", () => {
    expect(tagVersion("v1.2.0")).toBe("1.2.0");
    expect(tagVersion("1.2.0")).toBe("1.2.0");
    expect(() => tagVersion("latest")).toThrow("not a release tag: latest");
  });
});
