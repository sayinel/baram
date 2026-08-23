import type { ActivityBarItemConfig } from "../settings/store";

// §90-ish settings-store migration test — v16 → v17 backfills any id present
// in DEFAULT_ACTIVITY_BAR_CONFIG but missing from a persisted config. Driven
// through the REAL migrate function (see plugin-builtin-disabled.test.ts for
// the same pattern) so a deleted migration fails this test, not just a copy
// of its logic.
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

describe("settings store v16 -> v17 migration (activity bar backfill)", () => {
  it("adds a config missing 'plugins' at its default position and section", () => {
    const result = migrate(
      { activityBarConfig: configMissingIds("plugins") },
      16,
    );
    const ids = result.map((c) => c.id);

    expect(ids).toContain("plugins");
    // Lands right after its default predecessor, "skills-gallery" — not
    // appended at the end of the array.
    const skillsIdx = ids.indexOf("skills-gallery");
    expect(ids[skillsIdx + 1]).toBe("plugins");

    const plugins = result.find((c) => c.id === "plugins");
    expect(plugins?.section).toBe("top");
    expect(plugins?.visible).toBe(true);
  });

  it("adds several missing items, each at its default position", () => {
    const missingSeveral = configMissingIds(
      "tags",
      "zettel",
      "plugins",
      "snapshots",
    );

    const result = migrate({ activityBarConfig: missingSeveral }, 16);
    const ids = result.map((c) => c.id);

    expect(ids).toEqual(
      expect.arrayContaining(["tags", "zettel", "plugins", "snapshots"]),
    );
    // Relative order matches the default sequence: calendar < tags < zettel <
    // skills-gallery < plugins < chat < memories < snapshots < help.
    expect(ids.indexOf("calendar")).toBeLessThan(ids.indexOf("tags"));
    expect(ids.indexOf("tags")).toBeLessThan(ids.indexOf("zettel"));
    expect(ids.indexOf("zettel")).toBeLessThan(ids.indexOf("skills-gallery"));
    expect(ids.indexOf("skills-gallery")).toBeLessThan(ids.indexOf("plugins"));
    expect(ids.indexOf("memories")).toBeLessThan(ids.indexOf("snapshots"));
    expect(ids.indexOf("snapshots")).toBeLessThan(ids.indexOf("help"));
  });

  it("preserves the user's visible flags and order for items they already have", () => {
    const customised = configMissingIds("plugins").map((item) =>
      item.id === "files" ? { ...item, visible: false } : item,
    );
    // Reorder: move "graph" to the very front of the persisted array.
    const graphIdx = customised.findIndex((c) => c.id === "graph");
    const [graph] = customised.splice(graphIdx, 1);
    customised.unshift(graph);

    const result = migrate({ activityBarConfig: customised }, 16);

    expect(result.find((c) => c.id === "files")?.visible).toBe(false);
    expect(result[0].id).toBe("graph");
    // graph still precedes git, which still precedes calendar — the user's
    // relative order among their own items is untouched.
    const ids = result.map((c) => c.id);
    expect(ids.indexOf("graph")).toBeLessThan(ids.indexOf("git"));
    expect(ids.indexOf("git")).toBeLessThan(ids.indexOf("calendar"));
  });

  it("is idempotent — running the migration body twice changes nothing the second time", () => {
    // Both calls target version 16 so the v16 -> v17 block actually runs
    // both times, rather than relying on zustand's own version gate to skip
    // the second run.
    const once = migrate(
      { activityBarConfig: configMissingIds("plugins") },
      16,
    );
    const twice = migrate({ activityBarConfig: once }, 16);
    expect(twice).toEqual(once);
  });

  // §306 added a second gate (v17 -> v18, see
  // activity-bar-tasks-migration.test.ts) that calls this exact same
  // backfill again. So "17" is no longer the terminal version — anyone
  // handed version 17 now also runs the v17 -> v18 gate and gets backfilled
  // by it. This test moves its input to 18, the new terminal version, to
  // keep testing what it always meant to test: nothing gets added once
  // you're fully migrated.
  it("does not add anything when already at version 18", () => {
    const result = migrate(
      { activityBarConfig: configMissingIds("plugins") },
      18,
    );
    expect(result.map((c) => c.id)).not.toContain("plugins");
  });

  it.each([
    ["undefined", undefined],
    ["not an array", "corrupt"],
    ["null", null],
  ])("does not throw when activityBarConfig is %s", (_label, planted) => {
    expect(() => migrate({ activityBarConfig: planted }, 16)).not.toThrow();
  });

  it("does not throw when activityBarConfig is absent entirely", () => {
    expect(() => migrate({}, 16)).not.toThrow();
  });
});
