#!/usr/bin/env bash
# issue 669 — record the `md::literal` parity corpus, or check the committed
# one against what the tests actually exercise.
#
#   scripts/literal-parity.sh regenerate         rewrite both generated files
#   scripts/literal-parity.sh check              compare them with a fresh dump
#   scripts/literal-parity.sh dump <out.jsonl>   record the corpus only
#
# The recorder lives in `src-tauri/src/md/literal/mod.rs` behind the
# `parity-dump` feature, so an ordinary `cargo test` compiles none of it. It
# appends one JSON line per document as the case runs; the recorder holds its
# lock across the write and the generator sorts, so the harness may run the
# cases in any order and on any number of threads.
#
# ‼️ The dump is written to a fresh file every time. An append to a stale file
# would look like a corpus that grew.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$repo/src-tauri/Cargo.toml"
inventory="$repo/src-tauri/src/md/fixtures/literal-parity-inventory.json"
fixture="$repo/src-tauri/src/md/fixtures/literal-parity.json"
# The Rust test that reads the committed fixture. Recording must not run it.
reader="the_literal_parity_corpus_holds"

dump_to() {
  local out="$1"
  # ‼️ The recorder appends, so a stale file would read as a corpus that grew
  # — and this deletes whatever is at that path first. Refuse the two
  # generated artifacts by name and anything that is not a `.jsonl`: following
  # the regeneration instructions with the wrong similarly-named argument
  # would otherwise overwrite a committed fixture.
  case "$out" in
    *.jsonl) ;;
    *) echo "literal-parity: the dump goes to a .jsonl file, not $out" >&2; exit 2 ;;
  esac
  if [ "$out" = "$inventory" ] || [ "$out" = "$fixture" ]; then
    echo "literal-parity: $out is a generated artifact, not a dump destination" >&2
    exit 2
  fi
  rm -f -- "$out"
  # ‼️ The reader of the committed fixture is skipped while recording. It is a
  # test of the fixture, not of the corpus, and leaving it in made the one
  # advertised recovery command unusable in the case that needs it: change the
  # grammar and the emulation together, and `regenerate` would fail on the old
  # fixture before it could write the new one. CI still runs that test in the
  # ordinary Rust job.
  #
  # A `--skip` that matches nothing fails open — the test would quietly return
  # to the dump and take the deadlock with it — so the name is confirmed
  # present first, the way the pandoc step confirms its filter matched.
  if ! cargo test --manifest-path "$manifest" --features parity-dump --lib -- \
    md::literal --list 2>/dev/null | grep -q "$reader"; then
    echo "literal-parity: $reader is not in the md::literal filter, so the skip below stopped meaning anything" >&2
    exit 1
  fi
  # ‼️ cargo's output is captured, not discarded. With the output on /dev/null
  # all that reached the log when a corpus test failed was `error: test failed,
  # to rerun pass --lib`, with no assertion message.
  local log
  log="$(mktemp "${TMPDIR:-/tmp}/literal-parity-cargo.XXXXXX")"
  if ! BARAM_PARITY_DUMP="$out" cargo test --manifest-path "$manifest" \
    --features parity-dump --lib -- md::literal --skip "$reader" > "$log" 2>&1; then
    echo "literal-parity: the corpus run failed before it could be compared:" >&2
    cat "$log" >&2
    rm -f -- "$log"
    exit 1
  fi
  rm -f -- "$log"
  # A filter that matches nothing is a green run of zero tests (the discipline
  # the pandoc smoke step in ci.yml states). An empty dump means the feature
  # did not compile in, the env var did not reach the recorder, or the module
  # path moved — each of which would silently switch this check off.
  if [ ! -s "$out" ]; then
    echo "literal-parity: the dump is empty — the recorder did not run" >&2
    exit 1
  fi
  echo "literal-parity: recorded $(wc -l < "$out" | tr -d ' ') documents" >&2
}

case "${1:-}" in
  dump)
    [ $# -eq 2 ] || { echo "usage: $0 dump <out.jsonl>" >&2; exit 2; }
    dump_to "$2"
    ;;
  regenerate)
    # One command, so the two generated files are always written from the same
    # dump. Every drift message points here.
    dir="$(mktemp -d "${TMPDIR:-/tmp}/literal-parity.XXXXXX")"
    trap 'rm -rf -- "$dir"' EXIT
    dump_to "$dir/corpus.jsonl"
    npx tsx "$repo/scripts/build-literal-parity.ts" "$dir/corpus.jsonl"
    ;;
  check)
    # `mktemp -d` and a fresh name inside it: deleting the file mktemp made
    # and reopening the name would hand the window to whoever guessed it.
    # `-t` without a template is not portable, so the template is explicit.
    dir="$(mktemp -d "${TMPDIR:-/tmp}/literal-parity.XXXXXX")"
    trap 'rm -rf -- "$dir"' EXIT
    tmp="$dir/corpus.jsonl"
    dump_to "$tmp"
    for f in "$inventory" "$fixture"; do
      [ -f "$f" ] || { echo "literal-parity: $f is missing" >&2; exit 1; }
    done
    # Compare identities — test, ordinal, digest — never the document body,
    # so a drift reads as a short list rather than a diff of megabytes.
    node -e '
      const crypto = require("node:crypto");
      const fs = require("node:fs");
      const now = fs.readFileSync(process.argv[1], "utf8").trim().split("\n")
        .map((l) => { const r = JSON.parse(l); return {test: r.test, ordinal: r.ordinal, sha256: r.sha256, bytes: r.bytes}; });
      const committed = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).documents;
      const key = (r) => `${r.test}#${r.ordinal}`;
      const a = new Map(committed.map((r) => [key(r), r]));
      const b = new Map(now.map((r) => [key(r), r]));
      // ‼️ Before any comparison: a duplicate key collapses inside these maps,
      // and every check below would then run on one entry while the file holds
      // two. The reason reported must be the duplicate, not the drift it hides.
      const fixture = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
      const cases = new Map(fixture.cases.map((c) => [key(c), c]));
      // Duplicate keys would be collapsed by these maps and the collapse would
      // look like agreement.
      for (const [what, list, map] of [["the dump", now, b], ["the inventory", committed, a], ["the fixture", fixture.cases, cases]]) {
        if (map.size !== list.length) {
          console.error(`literal-parity: ${what} holds ${list.length - map.size} duplicate identit(ies)`);
          process.exit(1);
        }
      }

      const added = [...b.keys()].filter((k) => !a.has(k));
      const removed = [...a.keys()].filter((k) => !b.has(k));
      const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k).sha256 !== b.get(k).sha256);
      if (added.length || removed.length || changed.length) {
        console.error("literal-parity: the corpus the tests exercise no longer matches the committed inventory.");
        for (const k of added) console.error(`  added    ${k}`);
        for (const k of removed) console.error(`  removed  ${k}`);
        for (const k of changed) console.error(`  changed  ${k}`);
        console.error("Regenerate: scripts/literal-parity.sh regenerate");
        process.exit(1);
      }
      // ‼️ The inventory says which documents exist; the fixture says what
      // each marker in them should be. Comparing only the first leaves the
      // second free to shrink: deleting cases from the fixture was measured
      // to pass this check, the Rust reader (its floor is a count, not the
      // corpus) and — by luck of a second count — almost the vitest one too.
      // Every document the inventory names is either excluded or a case.
      // ‼️ `excluded` is a claim the committed file makes about itself. Taken
      // on trust, deleting a case and marking its entry excluded would pass
      // every check below. The fresh dump decides instead: only a document
      // the recorder just measured as oversized may carry the flag.
      const limit = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).maxDocumentBytes;
      // The threshold is data in a file this check is checking, so it is not
      // free to move: a larger one would let a case be dropped as "oversized".
      if (limit !== 8192) {
        console.error(`literal-parity: the inventory says maxDocumentBytes=${JSON.stringify(limit)}, expected 8192`);
        process.exit(1);
      }
      const wrongly = committed.filter(
        (r) => Boolean(r.excluded) !== (b.get(key(r)).bytes > limit),
      );
      if (wrongly.length) {
        console.error(`literal-parity: ${wrongly.length} document(s) carry an exclusion the recorded size does not support.`);
        for (const r of wrongly) console.error(`  ${key(r)}  ${b.get(key(r)).bytes} bytes, excluded=${JSON.stringify(r.excluded ?? null)}`);
        process.exit(1);
      }
      const missing = committed.filter((r) => !r.excluded && !cases.has(key(r)));
      const orphaned = [...cases.keys()].filter((k) => !a.has(k));
      // ‼️ Identity alone is not enough: a document can change while its key
      // does not. Recomputing the digest from what the fixture will actually
      // be tested against is what ties the two files together — without it,
      // updating the inventory hash and leaving the fixture stale passes.
      const stale = [...cases.values()].filter((c) => {
        const body = Buffer.from(c.markdown, "utf8");
        const digest = crypto.createHash("sha256").update(body).digest("hex");
        const entry = a.get(key(c));
        return (
          digest !== c.sha256 ||
          body.length !== c.bytes ||
          (entry && (entry.sha256 !== digest || entry.bytes !== body.length))
        );
      });
      if (missing.length || orphaned.length || stale.length) {
        console.error("literal-parity: the fixture and the recorded corpus disagree.");
        for (const r of missing) console.error(`  no case for      ${key(r)}`);
        for (const k of orphaned) console.error(`  no document      ${k}`);
        for (const c of stale) console.error(`  stale document   ${key(c)}`);
        console.error("Regenerate: scripts/literal-parity.sh regenerate");
        process.exit(1);
      }
      console.error(`literal-parity: ${now.length} documents match the committed inventory, ${cases.size} of them with a case whose digest checks out`);
    ' "$tmp" "$inventory" "$fixture"
    # ‼️ Last: rebuild both files from the same dump and compare bytes. The
    # comparison above reports WHICH document drifted, which is why it runs
    # first; this one is the catch-all — it covers everything the generator
    # derives and the identities do not reach, contract text included.
    mkdir -p "$dir/rebuilt"
    npx tsx "$repo/scripts/build-literal-parity.ts" "$tmp" "$dir/rebuilt" >/dev/null
    for f in literal-parity.json literal-parity-inventory.json; do
      if ! cmp -s "$dir/rebuilt/$f" "$repo/src-tauri/src/md/fixtures/$f"; then
        echo "literal-parity: $f is not what the generator produces from this corpus." >&2
        # Cut the lines: the contract is a single long string and an
        # untrimmed diff of it buries the change it is reporting.
        diff "$repo/src-tauri/src/md/fixtures/$f" "$dir/rebuilt/$f" \
          | head -20 | cut -c1-160 >&2 || true
        echo "Regenerate: scripts/literal-parity.sh regenerate" >&2
        exit 1
      fi
    done
    echo "literal-parity: both generated files match a rebuild from this corpus" >&2
    ;;
  *)
    echo "usage: $0 {dump <out.jsonl>|check|regenerate}" >&2
    exit 2
    ;;
esac
