import type { SnapshotEntry } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import { distinctFileVersions } from "../snapshot-versions";

const snap = (id: string, ts: string, cksum: null | string): SnapshotEntry =>
  ({
    id,
    timestamp: ts,
    type: "auto",
    label: null,
    totalSizeBytes: 0,
    files: cksum
      ? [{ path: "a.md", checksum: cksum, sizeBytes: 1 }]
      : [{ path: "other.md", checksum: "x", sizeBytes: 1 }],
  }) as unknown as SnapshotEntry;

describe("distinctFileVersions", () => {
  it("collapses consecutive same-checksum snapshots, newest first", () => {
    const entries = [
      snap("s1", "2026-01-01T00-00-00", "A"),
      snap("s2", "2026-01-02T00-00-00", "A"),
      snap("s3", "2026-01-03T00-00-00", "B"),
    ];
    const out = distinctFileVersions(entries, "a.md");
    // newest first: s3(B) kept, s2(A) kept (differs from B), s1(A) collapsed into s2
    expect(out.map((e) => e.id)).toEqual(["s3", "s2"]);
  });

  it("preserves an A→B→A history (non-consecutive repeats)", () => {
    const entries = [
      snap("s1", "2026-01-01T00-00-00", "A"),
      snap("s2", "2026-01-02T00-00-00", "B"),
      snap("s3", "2026-01-03T00-00-00", "A"),
    ];
    const out = distinctFileVersions(entries, "a.md");
    expect(out.map((e) => e.id)).toEqual(["s3", "s2", "s1"]);
  });

  it("skips snapshots that do not contain the file", () => {
    const entries = [
      snap("s1", "2026-01-01T00-00-00", "A"),
      snap("s2", "2026-01-02T00-00-00", null), // only other.md
    ];
    const out = distinctFileVersions(entries, "a.md");
    expect(out.map((e) => e.id)).toEqual(["s1"]);
  });

  it("returns empty for a file with no versions", () => {
    expect(distinctFileVersions([], "a.md")).toEqual([]);
  });
});
