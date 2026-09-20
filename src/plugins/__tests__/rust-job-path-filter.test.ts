// The rust CI job runs only when `ci.yml`'s paths filter says a PR touched Rust. That filter
// is a list of globs, and the crate has build inputs the list cannot guess: `include_str!`
// compiles a file's CONTENTS in, so editing that file changes what the Rust tests assert
// against — from outside every `src-tauri/**` glob.
//
// ‼️ THIS IS A POST-MORTEM, NOT A PRECAUTION. `registry/index.json` is compiled into
// `registry.rs`'s seed test. PR #695 added an entry to it, touched no Rust, and CI reported
// `rust  skipping`. It merged green. The test it had broken failed one PR later, against
// changes that had nothing to do with it — which is the worst shape this can take, because
// the failure points at the wrong author.
//
// `src/plugins/revocation-client.ts` had the same exposure the whole time and had simply not
// been edited in a Rust-free PR yet.
//
// So the filter now names both, and this keeps that honest: a hand-maintained list is exactly
// what failed, so the next `include_str!` out of the crate fails here instead of shipping a
// job that quietly does not run.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const CI = resolve(ROOT, ".github/workflows/ci.yml");

/**
 * Every `include_str!`/`include_bytes!` target in the crate, as a repo-relative path.
 *
 * Read with `git ls-files` rather than a recursive walk: it is the same set of files CI
 * checks out, it skips `target/`, and it cannot wander into a symlinked directory.
 */
function compiledInFiles(): { from: string; target: string }[] {
  const listed = execFileSync("git", ["ls-files", "src-tauri/src"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => p.endsWith(".rs"));

  const found: { from: string; target: string }[] = [];
  for (const file of listed) {
    const source = readFileSync(resolve(ROOT, file), "utf8");
    for (const match of source.matchAll(
      /include_(?:str|bytes)!\s*\(\s*"([^"]+)"\s*\)/gu,
    )) {
      // Resolved against the including FILE's directory, the way rustc resolves it.
      const target = relative(
        ROOT,
        resolve(resolve(ROOT, file), "..", match[1]),
      );
      found.push({ from: file, target });
    }
  }
  return found;
}

/** The glob list under the `rust:` filter in `ci.yml`. */
function rustFilterGlobs(): string[] {
  const ci = readFileSync(CI, "utf8");
  const at = ci.indexOf("            rust:\n");
  if (at < 0) throw new Error("no `rust:` filter block in ci.yml");
  const rest = ci.slice(at + "            rust:\n".length);
  const globs: string[] = [];
  for (const line of rest.split("\n")) {
    const entry = /^\s{14}- '([^']+)'\s*$/u.exec(line);
    if (entry) {
      globs.push(entry[1]);
      continue;
    }
    // Comments and blank lines belong to the block; anything else ends it.
    if (/^\s*#/u.test(line) || line.trim() === "") continue;
    break;
  }
  return globs;
}

/** Whether `path` is covered by one of the globs, for the shapes this filter uses. */
function covered(path: string, globs: string[]): boolean {
  return globs.some((glob) => {
    if (glob.endsWith("/**")) return path.startsWith(glob.slice(0, -2));
    if (glob.endsWith("*")) return path.startsWith(glob.slice(0, -1));
    return path === glob;
  });
}

describe("the rust job runs whenever a file it compiles in changes", () => {
  const inclusions = compiledInFiles();
  const globs = rustFilterGlobs();

  it("reads both sides (either being empty would make this vacuous)", () => {
    // The scan found real inclusions…
    expect(inclusions.length).toBeGreaterThan(0);
    // …and the filter block was located, not silently missed by a reformat.
    expect(globs).toContain("src-tauri/**");
  });

  it("covers every include_str! target that lives outside the crate", () => {
    // Targets inside `src-tauri/` are already covered by `src-tauri/**`; the interesting ones
    // are the escapes. Reported with the including file, so a failure says what to add.
    const escapes = inclusions.filter(
      (i) => !i.target.startsWith("src-tauri/"),
    );
    const uncovered = escapes.filter((i) => !covered(i.target, globs));
    expect(
      uncovered.map((i) => `${i.target} (compiled in by ${i.from})`),
      "add these to the `rust:` paths filter in ci.yml, or the rust job will skip a PR that changes what it tests",
    ).toEqual([]);
  });

  it("still finds the two known escapes, so the scan cannot pass by finding nothing", () => {
    // ‼️ The previous test is satisfied by an EMPTY escape list, which is what a broken
    // regex or a wrong root would produce. These two are the ones that exist today; if one is
    // legitimately removed, delete it here in the same commit.
    const escapes = inclusions
      .filter((i) => !i.target.startsWith("src-tauri/"))
      .map((i) => i.target)
      .sort();
    expect(escapes).toEqual([
      "registry/index.json",
      "src/plugins/revocation-client.ts",
    ]);
  });
});
