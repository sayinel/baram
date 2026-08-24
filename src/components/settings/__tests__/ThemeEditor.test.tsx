// §54 / #330 follow-up — leaving the theme editor must not PIN the preview.
//
// The editor restored by SETTING the source colours back, but `system`,
// `default-light` and `default-dark` apply no inline variables at all: their values
// come from src/styles/generated/. So opening the editor on `system` (which falls
// back to the default-light palette) and pressing Cancel wrote 28 light variables
// inline, where they outranked the dark media query — a `system` user on an OS dark
// theme was left with a light UI, and only switching themes recovered it, because
// the settings effect depends on [activeThemeId, customThemes] and cancel changes
// neither.
import { useState } from "react";

import type { ThemeDef } from "../../../types/theme";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsEffects } from "../../../hooks/use-settings-effects";
import { useSettingsStore } from "../../../stores/settings/store";
import { BUILT_IN_THEMES, THEME_COLOR_KEYS } from "../../../types/theme";
import { ThemeEditor } from "../ThemeEditor";

// ‼️ `useSettingsEffects` syncs two native menus through a LAZY `import()` (§82). This file
// calls that hook, so those loads start here — and one of them resolved after vitest tore
// this file's environment down, failing the whole run with an `EnvironmentTeardownError`
// while all 4,407 tests passed. Mocking both modules makes that structurally impossible:
// the dynamic import resolves from the mock registry and never reaches the loader.
//
// The paths must keep matching the ones `use-settings-effects.ts` imports — if the hook
// moves a module, these mocks silently stop applying and the flake comes back. That is what
// `keeps the native-menu IPC modules out of the loader` below pins.
const menuIpc = vi.hoisted(() => ({
  syncMenuLocale: vi.fn(() => Promise.resolve()),
  syncRecentMenu: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../../ipc/menu-locale", () => ({
  syncMenuLocale: menuIpc.syncMenuLocale,
}));
vi.mock("../../../ipc/recent-menu", () => ({
  syncRecentMenu: menuIpc.syncRecentMenu,
}));

const NORD = BUILT_IN_THEMES.find((t) => t.id === "nord")!;

const ACCENT = "--color-accent-default";
const ACCENT_LABEL = THEME_COLOR_KEYS.find((e) => e.key === ACCENT)!.label;
const SENTINEL = "#123456";

function accentValue(): string {
  return document.documentElement.style.getPropertyValue(ACCENT);
}

/** Edit the accent swatch the way a user does, so a restore has something to undo. */
function editAccent(): void {
  // Scoped to the row label: the category heading carries the same text.
  const label = screen.getByText(ACCENT_LABEL, {
    selector: ".theme-editor-label",
  });
  const input = label
    .closest(".theme-editor-row")!
    .querySelector<HTMLInputElement>('input[type="color"]')!;
  fireEvent.change(input, { target: { value: SENTINEL } });
  expect(accentValue()).toBe(SENTINEL);
}

const CUSTOM: ThemeDef = {
  base: "dark",
  builtIn: false,
  colors: { ...NORD.colors },
  id: "custom-1730000000000",
  name: "Mine",
};

function inlineVarCount(): number {
  return document.documentElement.style.length;
}

describe("ThemeEditor — leaving the editor", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
    // The Cancel button is queried by its label, so pin the locale rather than
    // inherit whatever the store defaults to.
    useSettingsStore.setState({
      activeThemeId: "system",
      customThemes: [],
      locale: "en",
    });
  });

  it.each(["system", "default-light", "default-dark"])(
    "clears the preview rather than pinning it when %s is active",
    (id) => {
      useSettingsStore.setState({ activeThemeId: id });
      render(<ThemeEditor onClose={() => {}} />);
      // The live preview does write inline variables — that is what makes the
      // editor usable, and what has to be undone by removal, not by overwrite.
      expect(inlineVarCount()).toBeGreaterThan(0);

      fireEvent.click(screen.getByText("Cancel"));

      expect(inlineVarCount()).toBe(0);
    },
  );

  it("clears the preview when the editor unmounts on a cascade-only theme", () => {
    // Navigating away instead of pressing Cancel reaches a second restore site.
    const { unmount } = render(<ThemeEditor onClose={() => {}} />);
    expect(inlineVarCount()).toBeGreaterThan(0);

    unmount();

    expect(inlineVarCount()).toBe(0);
  });

  it("restores the ORIGINAL colour after an edit when a custom theme is active", () => {
    // The other direction: a theme whose colours only exist inline must get them
    // back, or cancelling would strip the user's active theme down to the cascade.
    // The edit is what makes this test able to fail: without it the preview already
    // holds the source colours, so a restore that does nothing — or one that reads
    // the live `colors` state instead of the captured original, deleting the only
    // reason originalColorsRef exists — would pass just the same.
    // Boundary (measured): swapping in `colors`/`base` while leaving handleCancel's
    // deps at [onClose] is an EQUIVALENT mutant — the stale closure still holds the
    // first render's colours. This test kills that swap only once the deps follow,
    // which is the form a real "simplification" takes.
    useSettingsStore.setState({
      activeThemeId: CUSTOM.id,
      customThemes: [CUSTOM],
    });
    render(<ThemeEditor onClose={() => {}} />);
    editAccent();

    fireEvent.click(screen.getByText("Cancel"));

    expect(accentValue()).toBe(NORD.colors[ACCENT]);
  });

  it("restores the ORIGINAL colour after an edit when the editor unmounts", () => {
    useSettingsStore.setState({
      activeThemeId: CUSTOM.id,
      customThemes: [CUSTOM],
    });
    const { unmount } = render(<ThemeEditor onClose={() => {}} />);
    editAccent();

    unmount();

    expect(accentValue()).toBe(NORD.colors[ACCENT]);
  });

  it("keeps a saved theme applied when the editor closes in a later commit", () => {
    // handleSave does not restore anything: it relies on the unmount cleanup running
    // BEFORE the settings effect re-applies the newly saved theme, which holds only
    // because React flushes passive destroys before creates within ONE commit. Close
    // the editor in a later commit — what a transition or a deferred onClose would do
    // — and the cleanup lands last, undoing a preview that has since become a real
    // theme: `data-theme` set, palette gone, and the settings effect will not re-run
    // to repair it because [activeThemeId, customThemes] no longer change.
    let closeEditor = (): void => {};
    function Host() {
      useSettingsEffects(null);
      const [open, setOpen] = useState(true);
      closeEditor = () => setOpen(false);
      return open ? <ThemeEditor onClose={() => {}} /> : null;
    }

    render(<Host />);
    editAccent();
    fireEvent.click(screen.getByText("Save"));

    act(() => closeEditor());

    expect(accentValue()).toBe(SENTINEL);
  });

  it("keeps the native-menu IPC modules out of the loader", async () => {
    // Not a theme assertion — it pins the mocks above to the paths the hook actually
    // imports. Reaching the MOCK is the observable proof that the real module was not
    // loaded, and it is the only thing that fails if `use-settings-effects.ts` renames one
    // of those imports: the `vi.mock` would then apply to nothing, this file would start
    // loading Tauri IPC again, and the teardown race would return with no other test
    // noticing.
    function Host() {
      useSettingsEffects(null);
      return null;
    }

    render(<Host />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(menuIpc.syncMenuLocale).toHaveBeenCalled();
    expect(menuIpc.syncRecentMenu).toHaveBeenCalled();
  });
});
