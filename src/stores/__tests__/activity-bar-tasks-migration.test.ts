import type { ActivityBarItemConfig } from "../settings/store";

// §306 settings-store migration test — v17 → v18 backfills "tasks" into a
// persisted activity-bar config that predates it. This reuses the exact same
// backfill helper already exercised end-to-end by
// activity-bar-config-migration.test.ts (v16 → v17) — positional-insert,
// preserved-order, idempotency, and corrupt-input behavior are covered there
// and not re-proven here. This file only proves the NEW version gate wires
// that shared logic through for "tasks".
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACTIVITY_BAR_CONFIG,
  useSettingsStore,
} from "../settings/store";

// The migration mutates its input array in place (splice), so every test
// needs its own fresh copy rather than a shared module-level array.
function configMissingIds(...ids: string[]): ActivityBarItemConfig[] {
  return DEFAULT_ACTIVITY_BAR_CONFIG.filter(
    (item) => !ids.includes(item.id),
  ).map((item) => ({ ...item }));
}

function migrate(persisted: unknown, version: number): ActivityBarItemConfig[] {
  const { migrate } = useSettingsStore.persist.getOptions();
  if (typeof migrate !== "function") {
    throw new Error("persist migrate is not configured");
  }
  const result = migrate(persisted, version) as {
    activityBarConfig: ActivityBarItemConfig[];
  };
  return result.activityBarConfig;
}

describe("settings store v17 -> v18 migration (§306 tasks backfill)", () => {
  it("adds 'tasks' right after its default predecessor 'tags'", () => {
    const result = migrate(
      { activityBarConfig: configMissingIds("tasks") },
      17,
    );
    const ids = result.map((c) => c.id);

    expect(ids).toContain("tasks");
    const tagsIdx = ids.indexOf("tags");
    expect(ids[tagsIdx + 1]).toBe("tasks");

    const tasks = result.find((c) => c.id === "tasks");
    expect(tasks?.section).toBe("top");
    expect(tasks?.visible).toBe(true);
  });

  it("does not add anything when already at version 18", () => {
    const result = migrate(
      { activityBarConfig: configMissingIds("tasks") },
      18,
    );
    expect(result.map((c) => c.id)).not.toContain("tasks");
  });

  it("does not throw when activityBarConfig is missing or corrupt", () => {
    expect(() => migrate({}, 17)).not.toThrow();
    expect(() => migrate({ activityBarConfig: "corrupt" }, 17)).not.toThrow();
  });
});
