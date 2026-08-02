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
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("reports a duplicate of an entry that is itself broken", () => {
    // The first entry takes the early return for its missing field. If the id were recorded
    // only after that, fixing the first error would reveal a second one — two publish
    // failures for one review.
    const broken = validEntry({ id: "dup" });
    delete (broken as { license?: unknown }).license;
    const { output, status } = run({
      plugins: [broken, validEntry({ id: "dup" })],
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
        validEntry({ id: "a", trust: "nonsense" }),
        validEntry({ engines: { baram: "^1.0.0" }, id: "b" }),
      ],
    });
    expect(output).toContain("2 problem(s)");
    expect(output).toContain("a: unknown trust tier");
    expect(output).toContain("b: engines.baram");
    expect(status).toBe(1);
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
