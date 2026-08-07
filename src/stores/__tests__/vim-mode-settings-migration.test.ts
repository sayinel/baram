import { describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

describe("settings store v16 -> v17 migration (§298 vimMode)", () => {
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

  it("does not touch vimMode when already at version 17", () => {
    const migrate = useSettingsStore.persist.getOptions().migrate;
    const result = migrate!({}, 17) as { vimMode?: boolean };
    expect(result.vimMode).toBeUndefined();
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
