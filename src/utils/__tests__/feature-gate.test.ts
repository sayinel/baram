import { beforeEach, describe, expect, it } from "vitest";

import { t } from "../../i18n";
import { useAIStore } from "../../stores/ai/ai";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { FEATURE_DISABLED_TOAST_KEY, featureReady } from "../feature-gate";

// ‼️ FEATURE_DISABLED_TOAST_KEY used to be Partial<Record<FeatureKey, string>>
// — no `space.tasks.disabled` copy existed — and a derived test here checked
// that every FeatureKey without a toast key was named, with a reason, in an
// exception list (fix-d-brief.md's "조건부 검사" in place of a type-level
// guarantee). Once `tasks.taskInput` needed the copy (use-keybinding-actions.ts)
// and it was created, the map narrowed to Record<FeatureKey, string> — tsc now
// catches a 5th FeatureKey missing an entry at compile time, so that runtime
// check would be re-proving what the type already guarantees. Deleted rather
// than kept as dead weight.

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

describe("featureReady", () => {
  it("returns true and does not toast when the feature is on", () => {
    expect(featureReady("ai")).toBe(true);
    expect(useUIStore.getState().toast).toBeNull();
  });

  it.each(["ai", "journal", "tasks", "zettelkasten"] as const)(
    "returns false and toasts the catalogue message for %s when off",
    (feature) => {
      useAIStore.setState({ aiEnabled: feature !== "ai" });
      useSettingsStore.setState({
        journalEnabled: feature !== "journal",
        tasksEnabled: feature !== "tasks",
        zettelkastenEnabled: feature !== "zettelkasten",
      });

      expect(featureReady(feature)).toBe(false);
      // Compared against the catalogue TEXT, not `t(...)` on both sides: `t`
      // falls back to the key, so a `t`-vs-`t` assertion would stay green
      // even if the catalogue entry were deleted.
      expect(useUIStore.getState().toast?.message).toBe(
        t(FEATURE_DISABLED_TOAST_KEY[feature], "en"),
      );
    },
  );
});
