// §69 — the publish gate for `registry/index.json`.
//
// WHY THIS FILE EXISTS: the app was made deliberately forgiving about this document — an
// unreadable entry is dropped, an unknown tier is demoted, an unparseable floor is ignored.
// Each of those is right at runtime and each one turns an authoring mistake into silence.
// `scripts/validate-index.ts` is the only place that converts them back into a signal, so a
// hole in it is a hole in the entire arrangement: nothing else would ever report the entry.
//
// Run as a child process, the way the workflow runs it, asserting the exit code and what it
// said. Every failure case asserts the SPECIFIC message, not merely a non-zero exit — the
// script has eight ways to reject a document and "it rejected" would not tell them apart.
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PREVIEW_COLOR_KEYS } from "../../themes/theme-preview-palette";

const ROOT = resolve(__dirname, "../../..");
const SCRIPT = resolve(ROOT, "scripts/validate-index.ts");
const TSX = resolve(ROOT, "node_modules/.bin/tsx");

function run(document: unknown): {
  output: string;
  status: null | number;
} {
  const dir = mkdtempSync(join(tmpdir(), "baram-index-"));
  const path = join(dir, "index.json");
  writeFileSync(path, JSON.stringify(document));
  const result = spawnSync(TSX, [SCRIPT, path], { encoding: "utf8" });
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

function runAs(fileName: "community.json" | "index.json", document: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "baram-index-"));
  const path = join(dir, fileName);
  writeFileSync(path, JSON.stringify(document));
  const result = spawnSync(TSX, [SCRIPT, path], { encoding: "utf8" });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

/** Writes raw text verbatim under the given file name, unlike `runAs` which always emits valid JSON. */
function runAsRaw(fileName: "community.json" | "index.json", text: string) {
  const dir = mkdtempSync(join(tmpdir(), "baram-index-"));
  const path = join(dir, fileName);
  writeFileSync(path, text);
  const result = spawnSync(TSX, [SCRIPT, path], { encoding: "utf8" });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

/** A community.json entry (spec 0058 C1) the script accepts. */
function validCommunityEntry(overrides: Record<string, unknown> = {}) {
  return {
    ...validEntry({
      downloadUrl:
        "https://sayinel.github.io/baram-plugins/plugins/hello-counter-1.2.0.zip",
      id: "hello-counter",
      name: "Hello Counter",
    }),
    publisher: "octocat",
    publisherId: 583231,
    repoId: 555,
    repository: "https://github.com/octocat/baram-hello-counter",
    ...overrides,
  };
}

/** Writes the raw text verbatim, unlike `run` which always emits valid JSON. */
function runRaw(text: string): { output: string; status: null | number } {
  const dir = mkdtempSync(join(tmpdir(), "baram-index-"));
  const path = join(dir, "index.json");
  writeFileSync(path, text);
  const result = spawnSync(TSX, [SCRIPT, path], { encoding: "utf8" });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

/** An entry the script accepts, so each case can break exactly one thing. */
function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    author: "Baram",
    capabilities: ["statusbar"],
    checksum: "a".repeat(64),
    description: "Counts words.",
    downloadUrl: "https://sayinel.github.io/baram-plugins/plugins/w-1.0.0.zip",
    engines: { baram: ">=0.5.0" },
    id: "baram-word-count",
    license: "Apache-2.0",
    name: "Word Count",
    trust: "sandboxed",
    version: "1.0.0",
    ...overrides,
  };
}

/**
 * A theme entry the script accepts — no `trust`, empty `capabilities` (0090, L1).
 *
 * ‼️ The `trust` deletion happens BEFORE the overrides are applied, not after. The first
 * version deleted last and silently ate `{ trust: "sandboxed" }`, so the case that asserts
 * the warning had no tier to warn about and saw a clean ✓.
 */
function validThemeEntry(overrides: Record<string, unknown> = {}) {
  const base = validEntry({
    capabilities: [],
    id: "dracula-theme",
    kind: "theme",
    name: "Dracula",
  });
  delete (base as { trust?: unknown }).trust;
  return { ...base, ...overrides };
}

describe('validate-index and a kind:"theme" entry (0090 final review, L1/M2/L5)', () => {
  it("accepts one with no trust tier at all", () => {
    // The gate used to make this an ERROR, with a message about Phase 5 disabling Install —
    // false for a theme, whose install path never reads `trust`. The plan's out-of-code
    // precondition is publishing exactly this entry.
    const { output, status } = run({ plugins: [validThemeEntry()] });
    expect(status).toBe(0);
    expect(output).toContain("✓");
  });

  it("still requires a plugin entry to carry one", () => {
    // The sibling that keeps the fix from being "trust is never required": the branch is on
    // `kind`, not a removal.
    const entry = validEntry();
    delete (entry as { trust?: unknown }).trust;
    const { output, status } = run({ plugins: [entry] });
    expect(status).toBe(1);
    expect(output).toContain("no trust tier");
  });

  it("warns, without failing, about a trust tier on a theme", () => {
    const { output, status } = run({
      plugins: [validThemeEntry({ trust: "sandboxed" })],
    });
    expect(status).toBe(0);
    expect(output).toContain("it is a plugin field");
  });

  it("still requires capabilities, because Rust cannot deserialize without it", () => {
    const entry = validThemeEntry();
    delete (entry as { capabilities?: unknown }).capabilities;
    const { output, status } = run({ plugins: [entry] });
    expect(status).toBe(1);
    expect(output).toContain("capabilities is missing");
  });

  it.each(["nord", "default-light", "system"])(
    "rejects the reserved id %s",
    (id) => {
      // M2 — `findThemeById` resolves these to the shipped theme, so an entry using one
      // could be consented to and installed and then never applied.
      const { output, status } = run({ plugins: [validThemeEntry({ id })] });
      expect(status).toBe(1);
      expect(output).toContain("a built-in theme already uses");
    },
  );

  it("leaves a plugin free to use an id a built-in theme has", () => {
    // The namespaces are separate: `findThemeById` never looks at installed plugins. Checked
    // in community.json now that first-party plugin ids carry the "baram-" prefix (§381) —
    // "nord" can only be a valid, unreserved id on the community side.
    expect(
      runAs("community.json", {
        communityPlugins: [validCommunityEntry({ id: "nord" })],
      }).status,
    ).toBe(0);
  });
});

describe("validate-index checks the name the consent dialog renders (L5)", () => {
  it.each([
    ["a bidi override", "Drac\u202eula"],
    ["a control character", "Drac\u0007ula"],
  ])("rejects %s", (_label, name) => {
    const { output, status } = run({ plugins: [validThemeEntry({ name })] });
    expect(status).toBe(1);
    expect(output).toContain("control or bidi-override character");
  });

  it("rejects a name past the length limit", () => {
    const { output, status } = run({
      plugins: [validThemeEntry({ name: "a".repeat(101) })],
    });
    expect(status).toBe(1);
    expect(output).toContain("must be 1-100 characters");
  });

  it("rejects an empty name", () => {
    const { output, status } = run({
      plugins: [validThemeEntry({ name: "  " })],
    });
    expect(status).toBe(1);
    expect(output).toContain("must be 1-100 characters");
  });

  it("applies to a PLUGIN entry too", () => {
    // `PluginConsentDialog` renders the entry's name for the same reason; the check is not
    // theme-specific and a test per kind is what keeps it that way.
    const { output, status } = run({
      plugins: [validEntry({ name: "Word\u202eCount" })],
    });
    expect(status).toBe(1);
    expect(output).toContain("control or bidi-override character");
  });

  it("accepts an ordinary name with non-Latin characters", () => {
    // The limits are about control and bidi-OVERRIDE codepoints, not about scripts. A
    // Korean or Arabic theme name must publish.
    const { status } = run({
      plugins: [validThemeEntry({ name: "바람 테마" })],
    });
    expect(status).toBe(0);
  });
});

describe("validate-index", () => {
  it("accepts a well-formed index", () => {
    const { output, status } = run({ plugins: [validEntry()] });
    expect(output).toContain("✓");
    expect(status).toBe(0);
  });

  it("rejects a document with no plugins array", () => {
    const { output, status } = run({ updatedAt: "2026-01-01" });
    expect(output).toContain("cannot read this as an index at all");
    expect(status).toBe(1);
  });

  it("rejects an entry missing a field Rust requires, naming the consequence", () => {
    const entry = validEntry();
    delete (entry as { license?: unknown }).license;
    const { output, status } = run({ plugins: [entry] });
    expect(output).toContain("license is missing");
    // The point of the message: a missing field makes the plugin INVISIBLE, which is not
    // what an operator would guess from "invalid entry".
    expect(output).toContain("invisible in the marketplace");
    expect(status).toBe(1);
  });

  it("locates an entry by position when the id is what is missing", () => {
    const entry = validEntry();
    delete (entry as { id?: unknown }).id;
    const { output, status } = run({ plugins: [validEntry(), entry] });
    expect(output).toContain("entry #2");
    expect(status).toBe(1);
  });

  it("rejects an entry with no engines.baram", () => {
    const entry = validEntry();
    delete (entry as { engines?: unknown }).engines;
    const { output, status } = run({ plugins: [entry] });
    expect(output).toContain("no engines.baram");
    expect(status).toBe(1);
  });

  it("rejects a floor the app would silently ignore", () => {
    // `^0.6.0` is legal semver and reads as NO FLOOR to `parseBaramFloor` — the exact
    // silent-protection-loss this check exists for, so it must not be confused with a typo.
    const { output, status } = run({
      plugins: [validEntry({ engines: { baram: "^0.6.0" } })],
    });
    expect(output).toContain('must be of the form ">=X.Y.Z"');
    expect(output).toContain("reads as no floor");
    expect(status).toBe(1);
  });

  it("rejects an entry with no trust tier", () => {
    const entry = validEntry();
    delete (entry as { trust?: unknown }).trust;
    const { output, status } = run({ plugins: [entry] });
    expect(output).toContain("no trust tier");
    expect(status).toBe(1);
  });

  it("rejects an unknown trust tier", () => {
    const { output, status } = run({
      plugins: [validEntry({ trust: "fully-trusted" })],
    });
    expect(output).toContain("unknown trust tier");
    expect(status).toBe(1);
  });

  // §360 fix round 1 (MAJOR) — `kind` had a type check but no value check, so a typo like
  // `"themes"` was a valid string, passed this gate, and only failed at the door of every
  // client (`dropUnknownKinds` in `registry-client.ts`), silently, via a `logger.warn`
  // nobody reads. This is the test that would have caught it.
  it("rejects an unknown kind, naming the consequence (dropped, not demoted)", () => {
    const { output, status } = run({
      plugins: [validEntry({ kind: "themes" })],
    });
    expect(output).toContain("unknown kind");
    expect(output).toContain("DROPPED from the index entirely");
    expect(status).toBe(1);
  });

  it("accepts an entry with no kind at all — every index published before §360 has none", () => {
    const { output, status } = run({ plugins: [validEntry()] });
    expect(output).toContain("✓");
    expect(status).toBe(0);
  });

  it("accepts a `theme` kind", () => {
    const { output, status } = run({
      plugins: [validEntry({ kind: "theme" })],
    });
    expect(output).toContain("✓");
    expect(status).toBe(0);
  });

  it("rejects duplicate ids, which shadow each other silently", () => {
    const { output, status } = run({
      plugins: [validEntry(), validEntry({ version: "2.0.0" })],
    });
    expect(output).toContain("duplicate id");
    expect(status).toBe(1);
  });

  it("rejects a checksum that is not sha256 hex", () => {
    const { output, status } = run({
      plugins: [validEntry({ checksum: "not-a-checksum" })],
    });
    expect(output).toContain("64 lowercase hex");
    expect(status).toBe(1);
  });

  it("WARNS about a placeholder checksum without failing the publish", () => {
    // The committed seed carries all zeros on purpose (it names the next release), so this
    // must stay a warning — but it must still be said, because on the live index it means
    // every install fails verification.
    const { output, status } = run({
      plugins: [validEntry({ checksum: "0".repeat(64) })],
    });
    expect(output).toContain("placeholder all-zero checksum");
    expect(status).toBe(0);
  });

  it("rejects a capability this build does not know", () => {
    // Was a warning on the theory that "the index may be newer than the app". Neither place
    // this runs fits that: in `plugin-release.yml` the checkout IS the tag being released,
    // so its capability list is the newest in existence and a name unknown there is unknown
    // to every shipped app; in `lint:frontend` the seed and the list come from one tree.
    const { output, status } = run({
      plugins: [validEntry({ capabilities: ["statusbar", "telepathy"] })],
    });
    expect(output).toContain("unknown to this build");
    expect(output).toContain("telepathy");
    expect(status).toBe(1);
  });

  // ‼️ THE HOLE THIS CLOSES (code review HIGH-2): the first version of the script tested
  // `entry[field] === undefined`, so a field present with the WRONG TYPE sailed through —
  // while serde drops such an entry exactly as hard as a missing one. `"license": null`
  // passed `npm run validate:index`, published, and vanished from every marketplace.
  // `a_wrong_typed_field_drops_the_entry_even_when_optional` (Rust) pins the other half:
  // that these really do drop, including the `#[serde(default)]` ones.
  it.each([
    ["license", null],
    ["version", 123],
    ["name", ["N"]],
    ["id", 7],
    ["capabilities", [1, 2]],
    // `#[serde(default)]` fields — `default` covers an ABSENT key, never a wrong-typed one.
    ["downloads", "many"],
    ["keywords", "word"],
    ["repository", 5],
    ["kind", 5],
    // `downloads` is `u64` in Rust and JS has one numeric type, so "a number" was still
    // too loose — review round 3 caught these three surviving the presence-vs-type fix.
    ["downloads", 1.5],
    ["downloads", -1],
    ["downloads", 1e20],
  ])(
    "rejects a wrong-typed %s, which serde drops the entry over",
    (field, bad) => {
      const { output, status } = run({
        plugins: [validEntry({ [field]: bad })],
      });
      expect(output).toContain(`${field} must be`);
      expect(output).toContain("invisible in the marketplace");
      expect(status).toBe(1);
    },
  );

  it("still accepts an entry that OMITS the optional fields", () => {
    // The contrast that keeps the check above honest: absence is fine, wrong type is not.
    const entry = validEntry();
    for (const field of [
      "downloads",
      "keywords",
      "repository",
      "icon",
      "homepage",
      "kind",
    ]) {
      delete (entry as Record<string, unknown>)[field];
    }
    const { status } = run({ plugins: [entry] });
    expect(status).toBe(0);
  });

  it("rejects a downloadUrl scheme the app refuses outright", () => {
    // `validate_http_url` allows only http and https, so this is un-installable — a
    // different failure from the http-vs-https warning it used to be lumped in with.
    const { output, status } = run({
      plugins: [validEntry({ downloadUrl: "ftp://example.test/p.zip" })],
    });
    expect(output).toContain("scheme is not http(s)");
    expect(output).toContain("can never be installed");
    expect(status).toBe(1);
  });

  it("only WARNS about plain http, which installs and is checksum-guarded", () => {
    const { output, status } = run({
      plugins: [validEntry({ downloadUrl: "http://example.test/p.zip" })],
    });
    expect(output).toContain("not https");
    expect(status).toBe(0);
  });

  it("neutralises an id that tries to write GitHub Actions commands", () => {
    // §69 security review (LOW-1), reproduced against the shipped script before the fix:
    // this runs inside `plugin-release.yml`, Actions parses workflow commands out of step
    // output, and the id is echoed back. A newline plus `::error title=…::` forged an
    // annotation on the release job, and `::stop-commands::` silenced every real one after
    // it. The document being judged must not get to write the verdict.
    const { output, status } = run({
      plugins: [
        validEntry({
          id: "inject\n::error title=SPOOFED::forged\n::stop-commands::deadbeef\nx",
          trust: "nonsense",
        }),
      ],
    });
    // No line may BEGIN with a workflow command — that is the only form Actions parses.
    for (const line of output.split("\n")) {
      expect(line.trimStart()).not.toMatch(/^::/u);
    }
    expect(output).toContain("∷error"); // defanged, still legible to a human
    expect(status).toBe(1);
  });

  it("reports a duplicate of an entry that is itself broken", () => {
    // The first entry takes the early return for its missing field. If the id were recorded
    // only after that, fixing the first error would reveal a second one — two publish
    // failures for one review.
    const broken = validEntry({ id: "baram-dup" });
    delete (broken as { license?: unknown }).license;
    const { output, status } = run({
      plugins: [broken, validEntry({ id: "baram-dup" })],
    });
    expect(output).toContain("license is missing");
    expect(output).toContain("duplicate id");
    expect(status).toBe(1);
  });

  it("reports every broken entry in one run, not just the first", () => {
    // An operator fixing a community index should see the whole list, not discover it one
    // failed publish at a time.
    const { output, status } = run({
      plugins: [
        validEntry({ id: "baram-a", trust: "nonsense" }),
        validEntry({ engines: { baram: "^1.0.0" }, id: "baram-b" }),
      ],
    });
    expect(output).toContain("2 problem(s)");
    expect(output).toContain("baram-a: unknown trust tier");
    expect(output).toContain("baram-b: engines.baram");
    expect(status).toBe(1);
  });

  it("accepts an entry with no readme, and one with an https readme", () => {
    // ABSENT IS LEGAL AND PERMANENT: a plugin whose archive has no README, and every entry
    // published before the field existed. A required field here would delist them.
    expect(run({ plugins: [validEntry()] }).status).toBe(0);
    expect(
      run({
        plugins: [
          validEntry({
            readme: "https://sayinel.github.io/baram-plugins/readme/w-1.0.0.md",
          }),
        ],
      }).status,
    ).toBe(0);
  });

  it("refuses a readme that is not https — an ERROR, unlike the download's warning", () => {
    // ‼️ THE ASYMMETRY IS THE POINT, and asserting only the exit code would not show it. A
    // plain-http `downloadUrl` is a WARNING because the checksum still attests the bytes; a
    // readme has nothing attesting it and is rendered as markdown on the screen a user reads
    // to decide about full trust. So this one fails the publish.
    const { output, status } = run({
      plugins: [
        validEntry({
          readme: "http://sayinel.github.io/baram-plugins/readme/w-1.0.0.md",
        }),
      ],
    });
    expect(status).toBe(1);
    expect(output).toContain("readme must be an https URL");

    // The control that makes the asymmetry a measurement rather than a claim: the same
    // scheme on `downloadUrl` is accepted, with a warning.
    const download = run({
      plugins: [
        validEntry({
          downloadUrl:
            "http://sayinel.github.io/baram-plugins/plugins/w-1.0.0.zip",
        }),
      ],
    });
    expect(download.status).toBe(0);
    expect(download.output).toContain("downloadUrl is not https");
  });

  it("refuses a readme that is not a string", () => {
    const { output, status } = run({
      plugins: [validEntry({ readme: 42 })],
    });
    expect(status).toBe(1);
    expect(output).toContain("readme");
  });

  it("validates the committed seed", () => {
    // The file this repo actually ships, through the same gate CI uses.
    const result = spawnSync(
      TSX,
      [SCRIPT, resolve(ROOT, "registry/index.json")],
      {
        encoding: "utf8",
      },
    );
    expect(`${result.stdout}${result.stderr}`).toContain("✓");
    expect(result.status).toBe(0);
  });
});

describe("validate-index — the file is the channel (§380/§381, spec 0058 §8.3)", () => {
  it("accepts a community entry in community.json", () => {
    const { output, status } = runAs("community.json", {
      communityPlugins: [validCommunityEntry()],
    });
    expect(status).toBe(0);
    expect(output).toContain("✓");
  });

  it.each([
    [
      "an id with the first-party prefix",
      { id: "baram-hello" },
      'community ids may not start with "baram-"',
    ],
    ["a trusted tier", { trust: "trusted" }, 'trust must be "sandboxed"'],
    ["a theme", { kind: "theme" }, "community.json carries plugins only"],
    [
      "no publisherId",
      { publisherId: undefined },
      "publisherId must be a positive integer",
    ],
    ["a string repoId", { repoId: "555" }, "repoId must be a positive integer"],
    [
      "a publisher that is not a login",
      { publisher: "-octocat" },
      "publisher must be a GitHub login",
    ],
    [
      "a repository outside the publisher",
      { repository: "https://github.com/someone/x" },
      "repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "a zero publisherId",
      { publisherId: 0 },
      "publisherId must be a positive integer",
    ],
    ["a float repoId", { repoId: 1.5 }, "repoId must be a positive integer"],
    [
      "a repository with an extra path segment",
      { repository: "https://github.com/octocat/x/y" },
      "repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "a repository with a query string",
      { repository: "https://github.com/octocat/baram-hello-counter?x=1" },
      "repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "a repository with a fragment",
      { repository: "https://github.com/octocat/baram-hello-counter#x" },
      "repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "a repository name of just '..'",
      { repository: "https://github.com/octocat/.." },
      "repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "a repository name of just '.'",
      { repository: "https://github.com/octocat/." },
      "repository must be https://github.com/<publisher>/<name>",
    ],
    [
      "an id with an uppercase letter",
      { id: "Baram-word-count" },
      "id must match",
    ],
    ["an id starting with a hyphen", { id: "-foo" }, "id must match"],
  ])("refuses %s in community.json", (_label, overrides, message) => {
    const { output, status } = runAs("community.json", {
      communityPlugins: [validCommunityEntry(overrides)],
    });
    expect(status).toBe(1);
    expect(output).toContain(message);
  });

  it("does not claim a leading hyphen cannot be installed — gate 2 refuses it, but the app installs it", () => {
    const { output, status } = runAs("community.json", {
      communityPlugins: [validCommunityEntry({ id: "-foo" })],
    });
    expect(status).toBe(1);
    expect(output).not.toContain("cannot be installed");
  });

  it("claims an uppercase id cannot be installed — it is outside the app's own charset too", () => {
    const { output, status } = runAs("community.json", {
      communityPlugins: [validCommunityEntry({ id: "Baram-word-count" })],
    });
    expect(status).toBe(1);
    expect(output).toContain("cannot be installed");
  });

  it("names community.json and the entry id together in a failure message", () => {
    // `validate-registry-assets.ts` runs over community.json too (spec 0058 §8.2 step 4), and
    // `plugin-release.yml` runs it before every first-party push. A broken community entry
    // must not read as an anonymous failure in that log.
    const { output, status } = runAs("community.json", {
      communityPlugins: [validCommunityEntry({ trust: "trusted" })],
    });
    expect(status).toBe(1);
    expect(output).toContain("hello-counter (community.json): trust must be");
  });

  it("accepts a community id made of digits and hyphens (the twin of the charset refusal)", () => {
    const { status } = runAs("community.json", {
      communityPlugins: [validCommunityEntry({ id: "hello-counter-2" })],
    });
    expect(status).toBe(0);
  });

  it("refuses a first-party plugin id without the prefix, and leaves themes alone", () => {
    const refused = runAs("index.json", {
      plugins: [validEntry({ id: "word-count" })],
    });
    expect(refused.status).toBe(1);
    expect(refused.output).toContain(
      'a first-party plugin id starts with "baram-"',
    );
    expect(runAs("index.json", { plugins: [validEntry()] }).status).toBe(0);
    expect(runAs("index.json", { plugins: [validThemeEntry()] }).status).toBe(
      0,
    );
  });

  it.each([
    [
      "community.json",
      { plugins: [] },
      "community.json must hold `communityPlugins`",
    ],
    ["index.json", { communityPlugins: [] }, "index.json must hold `plugins`"],
    [
      "index.json",
      { communityPlugins: [], plugins: [] },
      "carries both `plugins` and `communityPlugins`",
    ],
  ] as const)("refuses %s shaped as %j", (file, document, message) => {
    const { output, status } = runAs(file, document);
    expect(status).toBe(1);
    expect(output).toContain(message);
  });

  it.each([
    [
      "index.json",
      { plugins: [validEntry({ description: "Counts\u202ewords" })] },
      "description contains a control or bidi-override character",
    ],
    [
      "community.json",
      { communityPlugins: [validCommunityEntry({ author: "Octo\u0007Cat" })] },
      "author contains a control or bidi-override character",
    ],
  ] as const)("refuses a hidden character in %s", (file, document, message) => {
    const { output, status } = runAs(file, document);
    expect(status).toBe(1);
    expect(output).toContain(message);
  });

  // `publisherId`/`repoId` are Rust `u64`, and JS collapses a decimal-point or exponent
  // spelling to the same integer value before this script ever sees it, so only the RAW JSON
  // TEXT (not the parsed number) can catch a spelling Rust's serde refuses outright, dropping
  // the whole entry.
  describe("validate-index — publisherId/repoId's raw JSON text", () => {
    function withRawPublisherId(rawNumber: string): string {
      return JSON.stringify({
        communityPlugins: [validCommunityEntry()],
      }).replace('"publisherId":583231', `"publisherId":${rawNumber}`);
    }

    function withRawRepoId(rawNumber: string): string {
      return JSON.stringify({
        communityPlugins: [validCommunityEntry()],
      }).replace('"repoId":555', `"repoId":${rawNumber}`);
    }

    it.each(["583231.0", "5.55e2", "1e3"])(
      "refuses publisherId spelled %s, which Rust's u64 deserializer refuses outright",
      (spelling) => {
        const { output, status } = runAsRaw(
          "community.json",
          withRawPublisherId(spelling),
        );
        expect(status).toBe(1);
        expect(output).toContain(
          "Rust's u64 deserializer refuses any decimal point or exponent",
        );
      },
    );

    it("accepts publisherId spelled as a plain integer (the twin)", () => {
      const { status } = runAsRaw(
        "community.json",
        withRawPublisherId("583231"),
      );
      expect(status).toBe(0);
    });

    // The reviver keys on both `publisherId` AND `repoId` — a probe on `publisherId` alone
    // would not catch a mutation that dropped `repoId` from that key check.
    it("refuses repoId spelled 555.0, which Rust's u64 deserializer refuses outright", () => {
      const { output, status } = runAsRaw(
        "community.json",
        withRawRepoId("555.0"),
      );
      expect(status).toBe(1);
      expect(output).toContain(
        "Rust's u64 deserializer refuses any decimal point or exponent",
      );
    });

    it("accepts repoId spelled as a plain integer (the twin)", () => {
      const { status } = runAsRaw("community.json", withRawRepoId("555"));
      expect(status).toBe(0);
    });
  });

  it("validates the committed community seed", () => {
    const result = spawnSync(
      TSX,
      [SCRIPT, resolve(ROOT, "registry/community.json")],
      { encoding: "utf8" },
    );
    expect(`${result.stdout}${result.stderr}`).toContain("✓");
    expect(result.status).toBe(0);
  });
});

describe("validate-index and the size the app will fetch", () => {
  // The app's `fetch_registry` refuses a body over MAX_REGISTRY_BYTES (4 MiB) — `buf.len() +
  // chunk.len() > cap`, so exactly the cap is fetched. Trailing whitespace keeps the JSON valid
  // while the size moves one byte at a time.
  const CAP = 4 * 1024 * 1024;
  const doc = JSON.stringify({ plugins: [validEntry()] });

  it("accepts an index of exactly the cap", () => {
    const { output, status } = runRaw(doc + " ".repeat(CAP - doc.length));
    expect(output).not.toContain("exceeds");
    expect(status).toBe(0);
  });

  it("REFUSES an index one byte over the cap", () => {
    const { output, status } = runRaw(doc + " ".repeat(CAP - doc.length + 1));
    expect(output).toContain("exceeds the 4194304 bytes the app will fetch");
    expect(status).toBe(1);
  });

  it("refuses index.json as a symlink to a regular file elsewhere", () => {
    // `statSync` FOLLOWS a symlink, so a PR that replaces index.json with a link to a FIFO
    // or /dev/zero would report whatever size the LINK's target claims (0, for a FIFO) and
    // pass this guard, then hang or grow without bound on the read that follows. `lstatSync`
    // sees the link itself, and this script must refuse it rather than resolve it — the
    // passing twin is "accepts an index of exactly the cap" above, a real regular file.
    const dir = mkdtempSync(join(tmpdir(), "baram-index-"));
    const outside = join(dir, "outside-index.json");
    writeFileSync(outside, doc);
    const path = join(dir, "index.json");
    symlinkSync(outside, path);
    const result = spawnSync(TSX, [SCRIPT, path], { encoding: "utf8" });
    expect(`${result.stdout}${result.stderr}`).toContain(
      "is not a regular file",
    );
    expect(result.status).toBe(1);
  });
});

/** 스펙 0063 §5.1 — 계약의 16키를 모두 같은 색으로 채운 한 모드. */
const PALETTE = Object.fromEntries(
  PREVIEW_COLOR_KEYS.map((key) => [key, "#123456"]),
);

describe("validate-index and a theme entry's preview (스펙 0063 §5.3)", () => {
  it("accepts a preview the app's own filter accepts", () => {
    const { output, status } = run({
      plugins: [
        validThemeEntry({ preview: { dark: PALETTE, light: PALETTE } }),
      ],
    });
    expect(status).toBe(0);
    expect(output).not.toContain("no preview");
  });

  it.each([
    [
      "a missing key",
      { light: { ...PALETTE, "--color-bg-default": undefined } },
    ],
    ["an extra key", { light: { ...PALETTE, "--color-extra": "#000000" } }],
    ["a non-hex value", { light: { ...PALETTE, "--color-bg-default": "red" } }],
    ["an unknown mode", { sepia: PALETTE }],
  ])(
    "refuses a preview with %s — the app drops the whole preview",
    (_label, preview) => {
      const { output, status } = run({
        plugins: [validThemeEntry({ preview })],
      });
      expect(status).toBe(1);
      expect(output).toContain("preview does not match the contract");
    },
  );

  it("refuses a preview on a plugin entry", () => {
    const { output, status } = run({
      plugins: [validEntry({ preview: { light: PALETTE } })],
    });
    expect(status).toBe(1);
    expect(output).toContain("preview on a non-theme entry");
  });

  it("warns, without failing, about a theme with no preview", () => {
    const { output, status } = run({ plugins: [validThemeEntry()] });
    expect(status).toBe(0);
    expect(output).toContain("no preview");
  });
});
