// §352 (Task 6) — the font browser replaces the placeholder this test
// originally pinned (§351 review Important 3: clicking "Browse…" must not
// blank the whole Editor settings tab with no way back). Updated to verify
// the real component: <FontBrowser/> owns its own back control the way
// AppearanceTab's <ThemeEditor/> does, and using it restores the tab's
// normal font rows.
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

describe("EditorTab — Browse…", () => {
  it("swaps in the font browser instead of a blank pane, and returns to the font rows", async () => {
    useSettingsStore.setState({ ...initialState, locale: "en" });
    render(<EditorTab />);
    await flush();

    const [browse] = screen.getAllByRole("button", { name: "Browse…" });
    act(() => {
      browse.click();
    });

    // Not blank: the browser's own chrome (back control, slot segment) is on
    // screen, and the tab's normal font rows are gone while it is up.
    const back = screen.getByRole("button", { name: "← Editor settings" });
    expect(screen.getByRole("button", { name: "Body" })).toBeTruthy();
    expect(screen.queryByText("Font Family")).toBeNull();

    act(() => {
      back.click();
    });

    expect(screen.getByText("Font Family")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Body" })).toBeNull();
  });
});
