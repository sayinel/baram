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

  // ‼️ final review I3, at the artifact rather than at a prop. The test
  // environment's `invoke` mock answers `font_list` with `undefined`, so
  // `listFonts()` really does take its fallback path here — the same state a
  // machine whose fonts cannot be enumerated is in. It used to reach this tab
  // as the identical `null` that "still loading" produced, and the browser
  // then said "Loading fonts…" with nothing behind it, for good.
  //
  // Note what this cannot be replaced by: a unit test on `listFonts` passes
  // today and did while this was broken — `FALLBACK_FONTS` satisfied its own
  // test and no surface. The claim has to be checked where the user is.
  it("shows the fallback list, not a permanent loading pane, when the enumeration falls back", async () => {
    useSettingsStore.setState({ ...initialState, locale: "en" });
    render(<EditorTab />);
    await flush();

    const [browse] = screen.getAllByRole("button", { name: "Browse…" });
    act(() => {
      browse.click();
    });

    expect(screen.queryByTestId("font-browser-list-loading")).toBeNull();
    expect(screen.getByTestId("font-browser-list-fallback")).toBeTruthy();
    // FALLBACK_FONTS reaches a surface — the bundled body face is offered.
    expect(
      screen.getAllByRole("button", { name: "Pretendard Variable" }).length,
    ).toBeGreaterThan(0);
  });

  // The other half of the three-state ruling, and the half the browser's own
  // fix must not cost: a fallback list is not authority for "this machine does
  // not have it". Claiming that about an installed font is the lie §351's badge
  // was built to end, so `fallback` must reach the badge as `null`.
  it("makes no missing claim about a chosen font while the enumeration is a fallback", async () => {
    useSettingsStore.setState({
      ...initialState,
      fontFamily: "Comic Sans MS",
      locale: "en",
    });
    render(<EditorTab />);
    await flush();

    // Non-vacuous: the value is on screen, so a badge for it would be too.
    expect(
      screen.getAllByRole("button", { name: "Comic Sans MS" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Not on this machine")).toBeNull();
  });
});
