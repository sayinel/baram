// §260 Phase 6 — the release pipeline must carry `trust` into the registry index.
//
// WHY THIS FILE EXISTS: `scripts/update-registry-index.mjs` builds each entry from an
// allowlist of manifest fields, and `trust` was not in it. Both live entries therefore
// lacked `trust`, and Phase 5 reads a `trust`-less entry as LEGACY and disables Install —
// so the shipped registry had zero installable plugins. Nothing failed; the pipeline
// published a dead entry and said "upserted".
//
// The script is plain Node, run by the workflow, so it is exercised the way the workflow
// runs it: as a child process, asserting the exit code and what it wrote.
import type { RegistryEntry } from "../types";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isGithubLogin } from "../community-registry";

const SCRIPT = resolve(__dirname, "../../../scripts/update-registry-index.mjs");
const BASE_URL = "https://sayinel.github.io/baram-plugins/";
const CHECKSUM = "a".repeat(64);

/** A manifest the script accepts, so each test can break exactly one field. */
const VALID_MANIFEST = {
  author: "Baram",
  capabilities: ["editor:readonly", "events", "statusbar"],
  description: "Counts words.",
  engines: { baram: ">=0.4.0" },
  id: "baram-word-count",
  license: "Apache-2.0",
  main: "dist/index.mjs",
  name: "Word Count",
  trust: "sandboxed",
  version: "2.0.0",
};

function run(
  manifest: Record<string, unknown>,
  index: { plugins: unknown[] } = { plugins: [] },
): {
  entry?: RegistryEntry;
  indexText: string;
  status: null | number;
  stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "baram-registry-"));
  const manifestPath = join(dir, "baram-plugin.json");
  const indexPath = join(dir, "index.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(indexPath, JSON.stringify(index));

  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--index",
      indexPath,
      "--manifest",
      manifestPath,
      "--zip-name",
      `${String(manifest.id)}-${String(manifest.version)}.zip`,
      "--checksum",
      CHECKSUM,
      "--base-url",
      BASE_URL,
    ],
    { encoding: "utf8" },
  );

  // Read back only on success: a failing run must leave the index untouched, and parsing
  // it unconditionally would hide a partial write behind a JSON error.
  const written =
    result.status === 0
      ? (JSON.parse(readFileSync(indexPath, "utf8")) as {
          plugins: RegistryEntry[];
        })
      : undefined;
  return {
    entry: written?.plugins.find((p) => p.id === manifest.id),
    // Raw, so a refusal can be asserted to have written nothing at all.
    indexText: readFileSync(indexPath, "utf8"),
    status: result.status,
    stderr: result.stderr,
  };
}

describe("update-registry-index carries the trust tier (§260 Phase 6)", () => {
  it("writes trust alongside capabilities", () => {
    const { entry, status } = run(VALID_MANIFEST);
    expect(status).toBe(0);
    // BOTH halves: consent is (trust, capabilities), and the shipped defect was one
    // present and the other absent — asserting only `trust` would have passed before too.
    expect(entry?.trust).toBe("sandboxed");
    expect(entry?.capabilities).toEqual([
      "editor:readonly",
      "events",
      "statusbar",
    ]);
  });

  it("carries the trusted tier too, not just the one the reference plugin uses", () => {
    const { entry, status } = run({ ...VALID_MANIFEST, trust: "trusted" });
    expect(status).toBe(0);
    expect(entry?.trust).toBe("trusted");
  });

  it("refuses a manifest with no trust field, naming it", () => {
    const noTrust: Record<string, unknown> = { ...VALID_MANIFEST };
    delete noTrust.trust;
    const { status, stderr } = run(noTrust);
    expect(status).toBe(1);
    // The MESSAGE is asserted, not just the exit code: the value check below would also
    // refuse `undefined`, so a bare exit-code assertion would still pass with `trust`
    // deleted from MANIFEST_REQUIRED — i.e. it would pin nothing.
    expect(stderr).toContain("missing required field: trust");
  });

  it("refuses an unknown tier", () => {
    const { status, stderr } = run({
      ...VALID_MANIFEST,
      trust: "semi-trusted",
    });
    expect(status).toBe(1);
    expect(stderr).toContain('must be one of "sandboxed", "trusted"');
    expect(stderr).toContain('"semi-trusted"'); // says what it got
  });

  it("refuses a non-string tier rather than coercing it", () => {
    const { status, stderr } = run({ ...VALID_MANIFEST, trust: true });
    expect(status).toBe(1);
    expect(stderr).toContain("must be one of");
  });

  it("replaces an existing entry for the same id, trust included", () => {
    // The upsert path is how a re-release lands, so it is the path that has to stop
    // carrying a stale tier forward.
    const stale = {
      capabilities: ["editor:readonly"],
      id: "baram-word-count",
      trust: "trusted",
      version: "1.0.1",
    };
    const { entry, status } = run(VALID_MANIFEST, { plugins: [stale] });
    expect(status).toBe(0);
    expect(entry?.trust).toBe("sandboxed");
    expect(entry?.version).toBe("2.0.0");
  });

  it("refuses to upsert into an index that already holds the id twice", () => {
    // ‼️ `findIndex` is first-match-wins, so with two copies present this release lands in
    // whichever sits higher and the genuine entry is left at its old version. The app's
    // `dropAmbiguousIds` then serves NEITHER, so the plugin silently vanishes from every
    // marketplace — an availability attack costing an attacker one inserted line.
    //
    // `validate-index.ts` runs after this in the workflow and rejects duplicates, so the
    // push was already blocked; this pins the invariant at the step that would otherwise
    // guess, rather than relying on the order of two steps.
    const decoy = {
      id: "baram-word-count",
      trust: "trusted",
      version: "9.9.9",
    };
    const real = {
      id: "baram-word-count",
      trust: "sandboxed",
      version: "1.0.1",
    };
    const { status, stderr } = run(VALID_MANIFEST, {
      plugins: [decoy, real],
    });
    expect(status).toBe(1);
    expect(stderr).toContain("already holds 2 entries for baram-word-count");
    expect(stderr).toContain("refusing to guess");
  });

  it("leaves the index byte-for-byte untouched when it refuses", () => {
    // The refusal above must not be a partial write: the workflow pushes whatever is on
    // disk, and a half-updated index is worse than a duplicated one.
    const before = {
      plugins: [
        { id: "baram-word-count", version: "9.9.9" },
        { id: "baram-word-count", version: "1.0.1" },
      ],
    };
    const { indexText, status } = run(VALID_MANIFEST, before);
    expect(status).toBe(1);
    // The RAW bytes, not a reparse (review LOW-7): comparing parsed objects would pass over
    // a rewrite that only changed formatting, which is still a write the workflow pushes.
    expect(indexText).toBe(JSON.stringify(before));
  });
});

const COMMUNITY_FLAGS = [
  "--publisher",
  "octocat",
  "--publisher-id",
  "583231",
  "--repo-id",
  "555",
  "--repository",
  "https://github.com/octocat/baram-hello-counter",
];
const COMMUNITY_MANIFEST = {
  ...VALID_MANIFEST,
  homepage: "https://octocat.example/hello",
  id: "hello-counter",
  name: "Hello Counter",
};

function runCommunity(
  manifest: Record<string, unknown>,
  index: unknown = { communityPlugins: [] },
  flags: string[] = COMMUNITY_FLAGS,
) {
  const dir = mkdtempSync(join(tmpdir(), "baram-registry-"));
  const manifestPath = join(dir, "baram-plugin.json");
  const indexPath = join(dir, "community.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(indexPath, JSON.stringify(index));
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--index",
      indexPath,
      "--manifest",
      manifestPath,
      "--zip-name",
      `${String(manifest.id)}-${String(manifest.version)}.zip`,
      "--checksum",
      CHECKSUM,
      "--base-url",
      BASE_URL,
      ...flags,
    ],
    { encoding: "utf8" },
  );
  return {
    indexText: readFileSync(indexPath, "utf8"),
    status: result.status,
    stderr: result.stderr,
  };
}

describe("update-registry-index — community mode (§381, spec 0058 C1)", () => {
  it("writes the entry into communityPlugins with who published it", () => {
    const { indexText, status } = runCommunity(COMMUNITY_MANIFEST);
    expect(status).toBe(0);
    const written = JSON.parse(indexText) as {
      communityPlugins: unknown[];
      plugins?: unknown;
    };
    expect(written.plugins).toBeUndefined();
    expect(written.communityPlugins).toEqual([
      {
        author: "Baram",
        capabilities: ["editor:readonly", "events", "statusbar"],
        checksum: "a".repeat(64),
        description: "Counts words.",
        downloadUrl:
          "https://sayinel.github.io/baram-plugins/plugins/hello-counter-2.0.0.zip",
        engines: { baram: ">=0.4.0" },
        homepage: "https://octocat.example/hello",
        id: "hello-counter",
        license: "Apache-2.0",
        name: "Hello Counter",
        publisher: "octocat",
        publisherId: 583231,
        repoId: 555,
        repository: "https://github.com/octocat/baram-hello-counter",
        trust: "sandboxed",
        version: "2.0.0",
      },
    ]);
  });

  // Green before community mode existed, and stays green after: a pin of EXISTING behaviour
  // (`homepage` was never in the first-party field allowlist, spec 0058 §381), not a RED case
  // for community mode.
  it("leaves homepage out of a first-party entry, as before", () => {
    const { entry, status } = run({
      ...VALID_MANIFEST,
      homepage: "https://baram.ing",
    });
    expect(status).toBe(0);
    expect(entry?.homepage).toBeUndefined();
  });

  it.each([
    [
      "a partial flag set",
      COMMUNITY_MANIFEST,
      { communityPlugins: [] },
      ["--publisher", "octocat"],
      "community mode needs all of --publisher, --publisher-id, --repo-id, --repository",
    ],
    [
      "a trusted manifest",
      { ...COMMUNITY_MANIFEST, trust: "trusted" },
      { communityPlugins: [] },
      COMMUNITY_FLAGS,
      "a community entry must be sandboxed",
    ],
    [
      "a first-party id",
      { ...COMMUNITY_MANIFEST, id: "baram-hello" },
      { communityPlugins: [] },
      COMMUNITY_FLAGS,
      'ids starting with "baram-" are reserved for first-party plugins',
    ],
    [
      "an index-shaped file",
      COMMUNITY_MANIFEST,
      { plugins: [] },
      COMMUNITY_FLAGS,
      "has no communityPlugins array",
    ],
    [
      "a non-integer publisher id",
      COMMUNITY_MANIFEST,
      { communityPlugins: [] },
      COMMUNITY_FLAGS.map((f) => (f === "583231" ? "58x" : f)),
      "--publisher-id must be a positive integer",
    ],
    [
      "a non-integer repo id",
      COMMUNITY_MANIFEST,
      { communityPlugins: [] },
      COMMUNITY_FLAGS.map((f) => (f === "555" ? "5x" : f)),
      "--repo-id must be a positive integer",
    ],
    [
      "a plain-http repository",
      COMMUNITY_MANIFEST,
      { communityPlugins: [] },
      COMMUNITY_FLAGS.map((f) =>
        f === "https://github.com/octocat/baram-hello-counter"
          ? "http://github.com/octocat/baram-hello-counter"
          : f,
      ),
      "--repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "a repository owned by someone other than the publisher",
      COMMUNITY_MANIFEST,
      { communityPlugins: [] },
      COMMUNITY_FLAGS.map((f) =>
        f === "https://github.com/octocat/baram-hello-counter"
          ? "https://github.com/someone-else/baram-hello-counter"
          : f,
      ),
      "--repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "a repository name of just '..'",
      COMMUNITY_MANIFEST,
      { communityPlugins: [] },
      COMMUNITY_FLAGS.map((f) =>
        f === "https://github.com/octocat/baram-hello-counter"
          ? "https://github.com/octocat/.."
          : f,
      ),
      "--repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "a repository name of just '.'",
      COMMUNITY_MANIFEST,
      { communityPlugins: [] },
      COMMUNITY_FLAGS.map((f) =>
        f === "https://github.com/octocat/baram-hello-counter"
          ? "https://github.com/octocat/."
          : f,
      ),
      "--repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "a repository name with a query string",
      COMMUNITY_MANIFEST,
      { communityPlugins: [] },
      COMMUNITY_FLAGS.map((f) =>
        f === "https://github.com/octocat/baram-hello-counter"
          ? "https://github.com/octocat/x?y"
          : f,
      ),
      "--repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "an empty publisher",
      COMMUNITY_MANIFEST,
      { communityPlugins: [] },
      COMMUNITY_FLAGS.map((f) => (f === "octocat" ? "" : f)),
      "--publisher must be a GitHub login",
    ],
    [
      "an empty homepage",
      { ...COMMUNITY_MANIFEST, homepage: "" },
      { communityPlugins: [] },
      COMMUNITY_FLAGS,
      "manifest field 'homepage' must be a non-empty string when present",
    ],
    [
      "an index carrying both channels",
      COMMUNITY_MANIFEST,
      { communityPlugins: [], plugins: [] },
      COMMUNITY_FLAGS,
      "carries plugins — this entry belongs in the other file",
    ],
  ] as const)(
    "refuses %s, writing nothing",
    (_label, manifest, index, flags, message) => {
      const { indexText, status, stderr } = runCommunity(manifest, index, [
        ...flags,
      ]);
      expect(status).toBe(1);
      expect(stderr).toContain(message);
      expect(indexText).toBe(JSON.stringify(index));
    },
  );
});

/** A published community entry for "hello-counter", so an upsert test can vary its identity. */
function existingCommunityEntry(overrides: Record<string, unknown> = {}) {
  return {
    author: "Baram",
    capabilities: ["editor:readonly", "events", "statusbar"],
    checksum: "b".repeat(64),
    description: "Counts words.",
    downloadUrl:
      "https://sayinel.github.io/baram-plugins/plugins/hello-counter-1.0.0.zip",
    engines: { baram: ">=0.4.0" },
    id: "hello-counter",
    license: "Apache-2.0",
    name: "Hello Counter",
    publisher: "octocat",
    publisherId: 583231,
    repoId: 555,
    repository: "https://github.com/octocat/baram-hello-counter",
    trust: "sandboxed",
    version: "1.0.0",
    ...overrides,
  };
}

describe("update-registry-index — community upsert cannot change identity (spec 0058 §8.5)", () => {
  it("refuses to upsert a release whose publisherId/repoId differ from the recorded entry", () => {
    const existing = existingCommunityEntry({ publisherId: 999999 });
    const { indexText, status, stderr } = runCommunity(COMMUNITY_MANIFEST, {
      communityPlugins: [existing],
    });
    expect(status).toBe(1);
    // Names the id, the recorded ids and the new ids, and says why this is refused rather
    // than silently applied.
    expect(stderr).toContain("hello-counter");
    expect(stderr).toContain("publisherId 999999");
    expect(stderr).toContain("repoId 555");
    expect(stderr).toContain("publisherId 583231");
    expect(stderr).toContain("manual maintenance commit");
    expect(indexText).toBe(JSON.stringify({ communityPlugins: [existing] }));
  });

  it("refuses to upsert when only repoId differs (publisherId unchanged)", () => {
    // The identity check is an OR of two fields — a probe that only ever varies publisherId
    // would not catch a mutation that dropped the repoId half of the comparison.
    const existing = existingCommunityEntry({ repoId: 777777 });
    const { indexText, status, stderr } = runCommunity(COMMUNITY_MANIFEST, {
      communityPlugins: [existing],
    });
    expect(status).toBe(1);
    expect(stderr).toContain("repoId 777777");
    expect(stderr).toContain("repoId 555");
    expect(stderr).toContain("manual maintenance commit");
    expect(indexText).toBe(JSON.stringify({ communityPlugins: [existing] }));
  });

  it("upserts normally when publisherId/repoId already match (the twin)", () => {
    const existing = existingCommunityEntry();
    const { indexText, status } = runCommunity(COMMUNITY_MANIFEST, {
      communityPlugins: [existing],
    });
    expect(status).toBe(0);
    const written = JSON.parse(indexText) as {
      communityPlugins: RegistryEntry[];
    };
    expect(written.communityPlugins).toHaveLength(1);
    expect(written.communityPlugins[0].version).toBe("2.0.0");
  });
});

describe("update-registry-index — --publisher matches isGithubLogin (boundary corpus)", () => {
  // Mirrors `community-submission.test.ts`'s FIRST_PARTY_PREFIX boundary corpus: not only the
  // single obviously-valid or obviously-invalid login, but the ones a naive charset check
  // (or a naive length check) would get wrong.
  it.each([
    "octocat",
    "a",
    "a-b",
    "-abc",
    "abc-",
    "a--b",
    "A1",
    "under_score",
    "has space",
    "x".repeat(39),
    "x".repeat(40),
    "",
  ])("agrees with isGithubLogin on %j", (login) => {
    const flags = [
      "--publisher",
      login,
      "--publisher-id",
      "583231",
      "--repo-id",
      "555",
      "--repository",
      `https://github.com/${login}/baram-hello-counter`,
    ];
    const { status } = runCommunity(
      COMMUNITY_MANIFEST,
      { communityPlugins: [] },
      flags,
    );
    expect(status === 0).toBe(isGithubLogin(login));
  });
});
