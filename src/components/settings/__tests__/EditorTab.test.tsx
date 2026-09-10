// §351 review Important 3 — clicking "Browse…" must not blank the whole
// Editor settings tab with no way back. The report's original justification
// ("mirrors AppearanceTab's editingTheme → <ThemeEditor/> pattern") was
// inaccurate: that pattern renders a component that owns its own close;
// rendering `null` is not that pattern. This pins the fix: a working back
// control, and the tab's normal content returns after using it.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
import { EditorTab } from "../tabs/EditorTab";

const initialState = useSettingsStore.getState();

afterEach(() => {
  useSettingsStore.setState(initialState, true);
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("EditorTab — Browse placeholder", () => {
  it("shows a working back control instead of a blank pane, and returns to the font rows", async () => {
    useSettingsStore.setState({ ...initialState, locale: "en" });
    render(<EditorTab />);
    await flush();

    const [browse] = screen.getAllByRole("button", { name: "Browse…" });
    act(() => {
      browse.click();
    });

    // Not blank: a back control and an explanatory message are on screen,
    // and the tab's normal font rows are gone while the placeholder is up.
    const back = screen.getByRole("button", { name: "Close" });
    expect(
      screen.getByText("The font browser isn't available yet."),
    ).toBeTruthy();
    expect(screen.queryByText("Font Family")).toBeNull();

    act(() => {
      back.click();
    });

    expect(screen.getByText("Font Family")).toBeTruthy();
    expect(
      screen.queryByText("The font browser isn't available yet."),
    ).toBeNull();
  });
});
