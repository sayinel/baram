import { describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

describe("settings store v15 -> v16 migration (§206 autoCheckUpdates)", () => {
  it("adds autoCheckUpdates=true when migrating from an older persisted state", () => {
    const migrate = useSettingsStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();
    const result = migrate!({ theme: "dark" }, 15) as {
      autoCheckUpdates?: boolean;
    };
    expect(result.autoCheckUpdates).toBe(true);
  });

  it("preserves an already-persisted autoCheckUpdates value", () => {
    const migrate = useSettingsStore.persist.getOptions().migrate;
    const result = migrate!({ autoCheckUpdates: false }, 15) as {
      autoCheckUpdates?: boolean;
    };
    expect(result.autoCheckUpdates).toBe(false);
  });

  it("does not add autoCheckUpdates when already at version 16", () => {
    const migrate = useSettingsStore.persist.getOptions().migrate;
    const result = migrate!({}, 16) as { autoCheckUpdates?: boolean };
    expect(result.autoCheckUpdates).toBeUndefined();
  });
});
