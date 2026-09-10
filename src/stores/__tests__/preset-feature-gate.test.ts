// §338/I-8 — the preset id set `applyPreset` gates on a feature must be
// EXACTLY `PRESET_FEATURE`'s key set — the same map also drives the
// StatusBar dropdown filter and the AppearanceTab list filter
// (isPresetVisible), so a mismatch here would mean a preset that renders in
// one surface's list still refuses to apply (or vice versa: applies from a
// place it should have been hidden).
//
// Derived, not listed: this iterates PRESET_FEATURE's own keys and
// BUILTIN_PRESETS' own ids rather than writing "journal" and "zettelkasten"
// literals twice, so adding a 3rd gated preset — or removing a gate — shows
// up here without anyone updating this file by hand.
import { beforeEach, describe, expect, it } from "vitest";

import { t } from "../../i18n";
import { useFileStore } from "../file/file";
import {
  BUILTIN_PRESETS,
  PRESET_FEATURE,
  useWorkspaceStore,
} from "../file/workspace";
import { useSettingsStore } from "../settings/store";
import { useUIStore } from "../ui/ui";

const GATED_IDS = Object.keys(PRESET_FEATURE);
const UNGATED_IDS = BUILTIN_PRESETS.map((p) => p.id).filter(
  (id) => !(id in PRESET_FEATURE),
);

/** Enough directory config for whichever gated preset is under test to reach
 *  "the feature is on" rather than fail its own directory check next. */
function configureDirectories() {
  useFileStore.getState().setRootPath("/vault");
  useSettingsStore.setState({
    journalDirectory: "/vault/journal",
    zettelkastenDirectory: "/vault/zettel",
  });
}

function enableAllGates() {
  useSettingsStore.setState({
    journalEnabled: true,
    zettelkastenEnabled: true,
  });
}

beforeEach(() => {
  useWorkspaceStore.setState({ activePresetId: null, customPresets: [] });
  useUIStore.setState({ toast: null });
  configureDirectories();
  enableAllGates();
});

describe("PRESET_FEATURE / BUILTIN_PRESETS — the sets this task cares about are not vacuous", () => {
  it("gates at least one preset and leaves at least one ungated", () => {
    expect(GATED_IDS.length).toBeGreaterThanOrEqual(2);
    expect(GATED_IDS).toEqual(
      expect.arrayContaining(["journal", "zettelkasten"]),
    );
    expect(UNGATED_IDS).toEqual(expect.arrayContaining(["writing", "skills"]));
  });
});

describe.each(GATED_IDS)("applyPreset(%s) — gated on its feature", (id) => {
  const feature = PRESET_FEATURE[id]!;

  it(`blocks and toasts when ${feature} is off`, () => {
    useSettingsStore.setState({ [`${feature}Enabled`]: false });

    useWorkspaceStore.getState().applyPreset(id);

    expect(useWorkspaceStore.getState().activePresetId).not.toBe(id);
    const message = useUIStore.getState().toast?.message;
    const toastKey =
      feature === "journal"
        ? "space.journal.disabled"
        : "space.zettel.disabled";
    expect(message).toBe(t(toastKey, "en"));
  });

  it(`applies (no toast) when ${feature} is on and configured — positive control`, () => {
    useWorkspaceStore.getState().applyPreset(id);

    expect(useWorkspaceStore.getState().activePresetId).toBe(id);
    expect(useUIStore.getState().toast).toBeNull();
  });
});

describe.each(UNGATED_IDS)(
  "applyPreset(%s) — not in PRESET_FEATURE, applies regardless of any flag",
  (id) => {
    it("applies even with every feature flag off", () => {
      useSettingsStore.setState({
        journalEnabled: false,
        zettelkastenEnabled: false,
      });

      useWorkspaceStore.getState().applyPreset(id);

      expect(useWorkspaceStore.getState().activePresetId).toBe(id);
      expect(useUIStore.getState().toast).toBeNull();
    });
  },
);
