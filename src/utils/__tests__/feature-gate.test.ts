import { beforeEach, describe, expect, it } from "vitest";

import { t } from "../../i18n";
import { useAIStore } from "../../stores/ai/ai";
import { FEATURE_KEYS } from "../../stores/settings/feature-keys";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { FEATURE_DISABLED_TOAST_KEY, featureReady } from "../feature-gate";

/**
 * `FeatureKey`s with no entry in `FEATURE_DISABLED_TOAST_KEY`, named with a
 * reason — this is the "조건부 검사" fix-d-brief.md asked for in place of
 * narrowing the map to `Record<FeatureKey, string>`: a 5th `FeatureKey` added
 * without an entry here AND without a toast key fails "every FeatureKey is
 * accounted for" below, instead of silently falling through the map.
 */
const NO_TOAST_COPY: Partial<Record<(typeof FEATURE_KEYS)[number], string>> = {
  tasks: "no space.tasks.disabled copy exists — see fix-d-report.md",
};

function enableAll() {
  useAIStore.setState({ aiEnabled: true });
  useSettingsStore.setState({
    journalEnabled: true,
    tasksEnabled: true,
    zettelkastenEnabled: true,
    locale: "en",
  });
}

beforeEach(() => {
  enableAll();
  useUIStore.setState({ toast: null });
});

describe("FEATURE_DISABLED_TOAST_KEY", () => {
  it("every FeatureKey is accounted for — a toast key, or a named reason it has none", () => {
    const unaccounted = FEATURE_KEYS.filter(
      (f) => !(f in FEATURE_DISABLED_TOAST_KEY) && !(f in NO_TOAST_COPY),
    );
    expect(unaccounted).toEqual([]);
  });

  it("every NO_TOAST_COPY entry is still actually missing — not a stale exception", () => {
    const stale = Object.keys(NO_TOAST_COPY).filter(
      (f) => f in FEATURE_DISABLED_TOAST_KEY,
    );
    expect(stale).toEqual([]);
  });
});

describe("featureReady", () => {
  it("returns true and does not toast when the feature is on", () => {
    expect(featureReady("ai")).toBe(true);
    expect(useUIStore.getState().toast).toBeNull();
  });

  it.each(["ai", "journal", "zettelkasten"] as const)(
    "returns false and toasts the catalogue message for %s when off",
    (feature) => {
      useAIStore.setState({ aiEnabled: feature !== "ai" });
      useSettingsStore.setState({
        journalEnabled: feature !== "journal",
        zettelkastenEnabled: feature !== "zettelkasten",
      });

      expect(featureReady(feature)).toBe(false);
      // Compared against the catalogue TEXT, not `t(...)` on both sides: `t`
      // falls back to the key, so a `t`-vs-`t` assertion would stay green
      // even if the catalogue entry were deleted.
      expect(useUIStore.getState().toast?.message).toBe(
        t(FEATURE_DISABLED_TOAST_KEY[feature]!, "en"),
      );
    },
  );

  it("returns false and does NOT toast for tasks (no copy exists)", () => {
    useSettingsStore.setState({ tasksEnabled: false });

    expect(featureReady("tasks")).toBe(false);
    expect(useUIStore.getState().toast).toBeNull();
  });
});
