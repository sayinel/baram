import { describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

describe("settings store vimMode migration (§298, v18 after the merge renumber)", () => {
  it("adds vimMode=false when migrating from an older persisted state", () => {
    const migrate = useSettingsStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();
    const result = migrate!({ theme: "dark" }, 16) as { vimMode?: boolean };
    expect(result.vimMode).toBe(false);
  });

  it("preserves an already-persisted vimMode value", () => {
    const migrate = useSettingsStore.persist.getOptions().migrate;
    const result = migrate!({ vimMode: true }, 16) as { vimMode?: boolean };
    expect(result.vimMode).toBe(true);
  });

  it("does not touch vimMode when already at version 18", () => {
    const migrate = useSettingsStore.persist.getOptions().migrate;
    const result = migrate!({}, 18) as { vimMode?: boolean };
    expect(result.vimMode).toBeUndefined();
  });

  it("BACKFILLS vimMode for main's v17 users (renumbered migration)", () => {
    // The branch's vim migration was v17 until main's v17 (activity-bar
    // backfill) shipped first — the merge renumbered ours to v18, so a
    // persisted v17 state from a main release must still receive the field.
    const migrate = useSettingsStore.persist.getOptions().migrate;
    const result = migrate!({}, 17) as { vimMode?: boolean };
    expect(result.vimMode).toBe(false);
  });

  it("runs the full chain from a very old version without clobbering vimMode default", () => {
    const migrate = useSettingsStore.persist.getOptions().migrate;
    const result = migrate!({ theme: "dark" }, 1) as { vimMode?: boolean };
    expect(result.vimMode).toBe(false);
  });

  it("persists vimMode through partialize (whitelist — Codex plan-review finding)", () => {
    // partialize is a whitelist: a migrated value that is not listed there is
    // silently dropped on the NEXT write, so the setting would reset on every
    // restart while all migration tests still pass.
    const partialize = useSettingsStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();
    const out = partialize!({
      ...useSettingsStore.getState(),
      vimMode: true,
    }) as { vimMode?: boolean };
    expect(out.vimMode).toBe(true);
  });
});
