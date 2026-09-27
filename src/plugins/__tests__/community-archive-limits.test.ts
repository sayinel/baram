// §380 gates 5–6 — the community gate reads the app's archive bounds out of `limits.rs` and
// `fetch.rs` (plan 0105 Task 3), each pinned by its own Rust anchor test. What makes this fail:
// a changed bound in Rust without a matching edit here (the literal table), a second
// declaration of the same identifier (the count), a declaration respelled past its scrape
// pattern (a "found 0 declarations" refusal), or — for the compression-method list — an
// element that isn't a bare `zip::CompressionMethod::<Variant>` (a comment, for one).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  pluginArchiveByteCap,
  pluginArchiveLimits,
  readmeByteCap,
} from "../../../scripts/rust-constants";

const LIMITS = readFileSync(
  resolve(__dirname, "../../../src-tauri/src/plugin/limits.rs"),
  "utf8",
);
const FETCH = readFileSync(
  resolve(__dirname, "../../../src-tauri/src/plugin/fetch.rs"),
  "utf8",
);

/** The six numeric bounds `pluginArchiveLimits` reads via its internal `bound()` helper. */
const NUMERIC_BOUNDS: ReadonlyArray<{
  name: string;
  type: "u64" | "usize";
}> = [
  { name: "MAX_COMPRESSION_RATIO", type: "u64" },
  { name: "MAX_ARCHIVE_ENTRIES", type: "usize" },
  { name: "MAX_ENTRY_BYTES", type: "u64" },
  { name: "MAX_PATH_DEPTH", type: "usize" },
  { name: "MAX_TOTAL_EXPANDED_BYTES", type: "u64" },
  { name: "RATIO_FLOOR_BYTES", type: "u64" },
];

describe("§380 — archive bounds scraped from limits.rs and fetch.rs", () => {
  it("reads the values that ship", () => {
    // Hand-written, and the two Rust anchors (`limits.rs`, `fetch.rs`) assert the same
    // literals — a change to either side without the other goes red somewhere. That is
    // necessary but not sufficient for the compression-method LIST specifically: see the
    // dedicated "commented-out entry" test below for the failure mode it does not cover.
    expect(pluginArchiveByteCap(LIMITS)).toBe(32 * 1024 * 1024);
    expect(pluginArchiveLimits(LIMITS)).toEqual({
      allowedMethods: [0, 8],
      maxCompressionRatio: 100,
      maxEntries: 2000,
      maxEntryBytes: 64 * 1024 * 1024,
      maxPathDepth: 16,
      maxTotalExpandedBytes: 256 * 1024 * 1024,
      ratioFloorBytes: 1024 * 1024,
    });
    expect(readmeByteCap(FETCH)).toBe(256 * 1024);
  });

  it("refuses to guess between two declarations", () => {
    expect(() => pluginArchiveByteCap(`${LIMITS}\n${LIMITS}`)).toThrow(
      "found 2 declarations of MAX_PLUGIN_ARCHIVE_BYTES",
    );
    // ‼️ M1, fix round 1: doubling the WHOLE file exercises ALLOWED_COMPRESSION's own count
    // assertion specifically, because `pluginArchiveLimits` scrapes it before any numeric
    // `bound()` call — a mutation that only breaks a numeric bound's count would not make
    // THIS assertion fail, so it is checked on its own below too.
    expect(() => pluginArchiveLimits(`${LIMITS}\n${LIMITS}`)).toThrow(
      "found 2 declarations of ALLOWED_COMPRESSION",
    );
    expect(() => readmeByteCap(`${FETCH}\n${FETCH}`)).toThrow(
      "found 2 declarations of MAX_README_BYTES",
    );
  });

  // ‼️ M1, fix round 1: a reviewer mutated `soleDeclaration` to silently take the LAST match
  // instead of throwing on a count other than 1, and every test above still passed — none of
  // them appended a second declaration of any of the six numeric bounds `bound()` reads. Each
  // case here appends exactly one extra declaration of its own identifier, so only that
  // bound's `soleDeclaration` call sees a count of 2.
  it.each(NUMERIC_BOUNDS)(
    "refuses two declarations of $name",
    ({ name, type }) => {
      expect(() =>
        pluginArchiveLimits(
          `${LIMITS}\npub(super) const ${name}: ${type} = 99;`,
        ),
      ).toThrow(`found 2 declarations of ${name}`);
    },
  );

  it("refuses a declaration respelled past the pattern", () => {
    expect(() =>
      pluginArchiveLimits(
        LIMITS.replace("MAX_ENTRY_BYTES: u64", "MAX_ENTRY_BYTES: u32"),
      ),
    ).toThrow("found 0 declarations of MAX_ENTRY_BYTES");
  });

  it("refuses a compression method it has no ZIP code for", () => {
    const lzma = LIMITS.replace(
      "zip::CompressionMethod::Deflated,",
      "zip::CompressionMethod::Deflated,\n    zip::CompressionMethod::Lzma,",
    );
    expect(() => pluginArchiveLimits(lzma)).toThrow("CompressionMethod::Lzma");
    // The twin: the shipped list parses (first test).
  });

  // ‼️ I1, fix round 1. Before the fix, `CompressionMethod::(\w+)` matched this text exactly
  // as readily inside a `//` comment as inside live code, so commenting an entry out (which
  // by itself leaves the array's declared LENGTH stale — a compile error a developer would
  // then "fix" by editing the length down) left this function still reporting the
  // commented-out method as allowed. The gate would then accept archives every client
  // refuses. The twin: the shipped list, with nothing commented out, parses (first test).
  it("refuses a compression method entry that is commented out", () => {
    const commented = LIMITS.replace(
      "zip::CompressionMethod::Stored,",
      "// zip::CompressionMethod::Stored,",
    );
    expect(() => pluginArchiveLimits(commented)).toThrow(
      "// zip::CompressionMethod::Stored",
    );
  });

  // ‼️ M8, fix round 1. Before the fix, `ZIP_METHOD_CODES` was a plain object, and looking up
  // a method literally named `constructor` walked the prototype chain to
  // `Object.prototype.constructor` (a function) instead of missing the lookup — so
  // `code === undefined` never caught it.
  it("refuses a compression method name that collides with Object.prototype", () => {
    const collision = LIMITS.replace(
      "zip::CompressionMethod::Deflated,",
      "zip::CompressionMethod::Deflated,\n    zip::CompressionMethod::constructor,",
    );
    expect(() => pluginArchiveLimits(collision)).toThrow(
      "CompressionMethod::constructor",
    );
  });
});
