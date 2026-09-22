#!/usr/bin/env bash
# issue 669 — record the `md::literal` parity corpus, or check the committed
# one against what the tests actually exercise.
#
#   scripts/literal-parity.sh dump <out.jsonl>   record the corpus
#   scripts/literal-parity.sh check              compare with the committed inventory
#
# The recorder lives in `src-tauri/src/md/literal/mod.rs` behind the
# `parity-dump` feature, so an ordinary `cargo test` compiles none of it. It
# appends one JSON line per document as the case runs, which is why this runs
# single-threaded: one writer keeps the records ordered and whole.
#
# ‼️ The dump is written to a fresh file every time. An append to a stale file
# would look like a corpus that grew.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$repo/src-tauri/Cargo.toml"
inventory="$repo/src-tauri/src/md/fixtures/literal-parity-inventory.json"

dump_to() {
  local out="$1"
  rm -f "$out"
  BARAM_PARITY_DUMP="$out" cargo test --manifest-path "$manifest" \
    --features parity-dump --lib -- md::literal --test-threads=1 >/dev/null
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
  check)
    tmp="$(mktemp -t literal-parity)"
    trap 'rm -f "$tmp" "$tmp.now"' EXIT
    dump_to "$tmp"
    [ -f "$inventory" ] || { echo "literal-parity: $inventory is missing" >&2; exit 1; }
    # Compare identity only — test, ordinal, sha256, bytes — never the
    # document body, so an inventory drift reads as a short list rather than
    # a diff of megabytes.
    node -e '
      const fs = require("node:fs");
      const now = fs.readFileSync(process.argv[1], "utf8").trim().split("\n")
        .map((l) => { const r = JSON.parse(l); return {test: r.test, ordinal: r.ordinal, sha256: r.sha256, bytes: r.bytes}; });
      const committed = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).documents;
      const key = (r) => `${r.test}#${r.ordinal}`;
      const a = new Map(committed.map((r) => [key(r), r]));
      const b = new Map(now.map((r) => [key(r), r]));
      const added = [...b.keys()].filter((k) => !a.has(k));
      const removed = [...a.keys()].filter((k) => !b.has(k));
      const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k).sha256 !== b.get(k).sha256);
      if (added.length || removed.length || changed.length) {
        console.error("literal-parity: the corpus the tests exercise no longer matches the committed inventory.");
        for (const k of added) console.error(`  added    ${k}`);
        for (const k of removed) console.error(`  removed  ${k}`);
        for (const k of changed) console.error(`  changed  ${k}`);
        console.error("Regenerate: scripts/literal-parity.sh dump /tmp/corpus.jsonl  (then rebuild the fixture)");
        process.exit(1);
      }
      console.error(`literal-parity: ${now.length} documents match the committed inventory`);
    ' "$tmp" "$inventory"
    ;;
  *)
    echo "usage: $0 {dump <out.jsonl>|check}" >&2
    exit 2
    ;;
esac
