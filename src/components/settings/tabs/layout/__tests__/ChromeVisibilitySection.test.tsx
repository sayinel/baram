// §370 — the three chrome-visibility toggles.
//
// Two things this pins:
// (a) a click flips only that surface's own boolean through `toggleActivityBar` /
//     `toggleStatusBar` / `toggleTabBar` — NOT `setChromeVisibility` (the preset-only entry
//     point, task-5-brief.md 부록-5). A regression that swapped the toggle for
//     `setChromeVisibility` would still flip the clicked surface, so the untouched-siblings
//     assertion is what actually tells the two entry points apart.
// (b) the row label is the exact key `settings-registry.ts` declares for the matching search
//     entry (§365.4) — a drift here means a user who finds this setting through search lands on
//     a row with a different name than the one they searched for (0093's `editorPadding` gap).
import { render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { t } from "../../../../../i18n";
import { useUIStore } from "../../../../../stores/ui/ui";
import { useSettingsRegistry } from "../../../settings-registry";
import { ChromeVisibilitySection } from "../ChromeVisibilitySection";

beforeEach(() => {
  useUIStore.setState({
    activityBarVisible: true,
    statusBarVisible: true,
    tabBarVisible: true,
  });
});

describe("rendering (§370)", () => {
  it("reflects the current visibility of all three surfaces", () => {
    useUIStore.setState({
      activityBarVisible: true,
      statusBarVisible: false,
      tabBarVisible: true,
    });
    render(<ChromeVisibilitySection />);

    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(3);
    expect(switches.map((el) => el.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "true",
    ]);
  });
});

describe("flips the right entry point (§370 부록-5)", () => {
  it("activity bar switch touches only activityBarVisible", () => {
    render(<ChromeVisibilitySection />);
    const before = useUIStore.getState();

    screen.getAllByRole("switch")[0].click();

    expect(useUIStore.getState().activityBarVisible).toBe(
      !before.activityBarVisible,
    );
    expect(useUIStore.getState().statusBarVisible).toBe(
      before.statusBarVisible,
    );
    expect(useUIStore.getState().tabBarVisible).toBe(before.tabBarVisible);
  });

  it("status bar switch touches only statusBarVisible", () => {
    render(<ChromeVisibilitySection />);
    const before = useUIStore.getState();

    screen.getAllByRole("switch")[1].click();

    expect(useUIStore.getState().statusBarVisible).toBe(
      !before.statusBarVisible,
    );
    expect(useUIStore.getState().activityBarVisible).toBe(
      before.activityBarVisible,
    );
    expect(useUIStore.getState().tabBarVisible).toBe(before.tabBarVisible);
  });

  it("tab bar switch touches only tabBarVisible", () => {
    render(<ChromeVisibilitySection />);
    const before = useUIStore.getState();

    screen.getAllByRole("switch")[2].click();

    expect(useUIStore.getState().tabBarVisible).toBe(!before.tabBarVisible);
    expect(useUIStore.getState().activityBarVisible).toBe(
      before.activityBarVisible,
    );
    expect(useUIStore.getState().statusBarVisible).toBe(
      before.statusBarVisible,
    );
  });
});

describe("search label / row label parity (§365.4)", () => {
  it.each([["activityBarVisible"], ["statusBarVisible"], ["tabBarVisible"]])(
    "registry id=%s renders under the same label key",
    (id) => {
      const { result } = renderHook(() => useSettingsRegistry());
      const entry = result.current.find((s) => s.id === id);
      expect(entry).toBeDefined();

      render(<ChromeVisibilitySection />);

      expect(screen.getByText(t(entry!.label, "en"))).toBeInTheDocument();
    },
  );
});
