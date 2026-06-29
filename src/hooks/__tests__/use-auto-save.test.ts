// §3.6 Phase 4: unit tests for shouldDeferSave mtime guard
import { describe, expect, it } from "vitest";

import { shouldDeferSave } from "../use-auto-save";

describe("shouldDeferSave", () => {
  // ── no entry ──────────────────────────────────────────────────────────────

  it("returns false when mtimeEntry is undefined (file not tracked)", () => {
    expect(shouldDeferSave(undefined)).toBe(false);
  });

  // ── canReloadMtime = 0 (no external change seen yet) ─────────────────────

  it("returns false when canReloadMtime is 0 (watcher not yet fired)", () => {
    expect(shouldDeferSave({ canReloadMtime: 0, lastSaveMtime: 0 })).toBe(
      false,
    );
  });

  it("returns false when canReloadMtime is 0 even if lastSaveMtime is non-zero", () => {
    expect(shouldDeferSave({ canReloadMtime: 0, lastSaveMtime: 1000 })).toBe(
      false,
    );
  });

  // ── canReloadMtime <= lastSaveMtime (external change already handled) ─────

  it("returns false when canReloadMtime equals lastSaveMtime (change already saved)", () => {
    expect(shouldDeferSave({ canReloadMtime: 1000, lastSaveMtime: 1000 })).toBe(
      false,
    );
  });

  it("returns false when canReloadMtime is older than lastSaveMtime", () => {
    // External event was older than the last local save — no pending conflict
    expect(shouldDeferSave({ canReloadMtime: 500, lastSaveMtime: 1000 })).toBe(
      false,
    );
  });

  // ── canReloadMtime > lastSaveMtime (pending external change) ──────────────

  it("returns true when canReloadMtime > lastSaveMtime (external change pending)", () => {
    expect(shouldDeferSave({ canReloadMtime: 2000, lastSaveMtime: 1000 })).toBe(
      true,
    );
  });

  it("returns true when lastSaveMtime is 0 and canReloadMtime > 0 (first external change before any save)", () => {
    expect(shouldDeferSave({ canReloadMtime: 1000, lastSaveMtime: 0 })).toBe(
      true,
    );
  });

  it("returns true for a large mtime difference", () => {
    expect(
      shouldDeferSave({
        canReloadMtime: 1_700_000_000_000,
        lastSaveMtime: 1_699_999_990_000,
      }),
    ).toBe(true);
  });
});

// ── Integration: auto-save deferred while conflict pending ────────────────────
//
// The full save() function lives inside the React hook (not independently
// callable without a renderer). The integration contract is therefore verified
// by asserting the guard's behaviour at the boundaries that save() uses:
//
//   1. getFileMtime() returns an entry where canReloadMtime > lastSaveMtime
//      → shouldDeferSave returns true → save() returns early (no writeFile)
//
//   2. After a successful save, updateLastSaveMtime is called with Date.now(),
//      so the next call to shouldDeferSave with that updated entry returns false.
//
// These contracts are validated via shouldDeferSave unit tests above.
// End-to-end coverage of the full save() flow (writeFile mock, markDirty, etc.)
// is deferred to E2E/Playwright where the hook runs inside a real React tree.

describe("shouldDeferSave — post-save baseline contract", () => {
  it("returns false immediately after save resets lastSaveMtime to >= canReloadMtime", () => {
    const canReloadMtime = 1000;
    // Simulate what updateLastSaveMtime(path, Date.now()) produces right after save
    const lastSaveMtime = canReloadMtime + 1; // save happened after external change
    expect(shouldDeferSave({ canReloadMtime, lastSaveMtime })).toBe(false);
  });

  it("returns false when lastSaveMtime exactly matches canReloadMtime (reload resolved)", () => {
    // After conflict resolution (reload), lastSaveMtime is set to externalMtime
    const mtime = 5000;
    expect(
      shouldDeferSave({ canReloadMtime: mtime, lastSaveMtime: mtime }),
    ).toBe(false);
  });
});
