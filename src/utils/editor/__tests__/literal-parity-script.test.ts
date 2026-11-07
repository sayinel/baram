// issue 669 — `scripts/literal-parity.sh` itself, run end to end with a fake
// `cargo` first on PATH. The real cargo is never called: the fake answers the
// two calls `dump_to` makes (the `--list` that confirms the reader's name, then
// the recording run) and the test reads what the script decided.
//
// ‼️ Local macOS `bash` is 3.2 — the script stays inside it, and so does the fake.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/literal-parity.sh");
const READER = "the_literal_parity_corpus_holds";

/**
 * How the fake answers `--list`:
 * - `pauses`: the reader's line, then a pause, then the rest — the test binary
 *   writes its listing line by line, so a reader that stops at the match
 *   leaves it writing into a closed pipe. It exits 101 then, as libtest does.
 * - `without-reader`: a listing that does not name the reader.
 * - `fails`: the listing itself fails, as a compile error would.
 */
type Listing = "fails" | "pauses" | "without-reader";

const FAKE_CARGO = [
  "#!/bin/bash",
  "list=",
  'for a in "$@"; do [ "$a" = "--list" ] && list=1; done',
  'if [ -n "$list" ]; then',
  '  case "$LISTING" in',
  "    fails) echo 'error: could not compile `baram` (lib test)' >&2; exit 101 ;;",
  "    without-reader)",
  "      printf '%s\\n' 'md::literal::tests::a_first_test: test' '' '1 tests, 0 benchmarks' || exit 101 ;;",
  "    pauses)",
  `      printf '%s\\n' 'md::literal::tests::a_first_test: test' 'md::literal::tests::${READER}: test' || exit 101`,
  "      sleep 0.5",
  "      printf '%s\\n' 'md::literal::tests::z_last_test: test' '' '3 tests, 0 benchmarks' || exit 101 ;;",
  "  esac",
  "  exit 0",
  "fi",
  'echo "$*" >> "$RECORDED"',
  `printf '%s\\n' '{"test":"t","ordinal":0}' >> "$BARAM_PARITY_DUMP"`,
  "exit 0",
].join("\n");

let dir = "";

afterEach(() => {
  if (dir) rmSync(dir, { force: true, recursive: true });
  dir = "";
});

function dump(listing: Listing) {
  dir = mkdtempSync(join(tmpdir(), "literal-parity-script-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "cargo"), FAKE_CARGO, { mode: 0o755 });
  const recorded = join(dir, "recorded.log");
  const out = join(dir, "corpus.jsonl");
  const result = spawnSync("bash", [SCRIPT, "dump", out], {
    encoding: "utf8",
    env: {
      ...process.env,
      LISTING: listing,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      RECORDED: recorded,
      TMPDIR: dir,
    },
  });
  return {
    recorded: existsSync(recorded) ? readFileSync(recorded, "utf8") : "",
    status: result.status,
    stderr: result.stderr,
  };
}

describe("literal-parity.sh confirms the reader's name before it records (issue 669)", () => {
  it("reads the whole listing, so a binary still writing after the name does not fail it", () => {
    const r = dump("pauses");
    expect(r.stderr).not.toContain("is not in the md::literal filter");
    expect(r.status).toBe(0);
    // The recording run happened, and with the skip the name check protects.
    expect(r.recorded).toContain(`--skip ${READER}`);
    expect(r.stderr).toContain("literal-parity: recorded 1 documents");
  });

  it("still stops before recording when the listing does not name the reader", () => {
    const r = dump("without-reader");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      `literal-parity: ${READER} is not in the md::literal filter`,
    );
    expect(r.recorded).toBe("");
  });

  it("says the listing failed, with cargo's error, instead of calling the name missing", () => {
    const r = dump("fails");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "literal-parity: listing the md::literal tests failed:",
    );
    expect(r.stderr).toContain("error: could not compile `baram` (lib test)");
    expect(r.stderr).not.toContain("is not in the md::literal filter");
    expect(r.recorded).toBe("");
  });
});
