// §386 F1 — final review: the PDF dark-print hint and the exported palette
// must agree. `resolvedMode` used to call `appliedThemeMode` even when no
// theme resolved (Baram Default, `activeThemeId: "system"`), so a Mode-Dark
// setting produced `resolvedMode === "dark"` with no palette to carry —
// `themeTokensBlock(undefined, "dark")` returns `""` (export-theme-tokens.ts)
// so the PDF prints white, but this hint told the user it would print dark
// (contradicts `export.ts`'s `ThemeExportOptions` doc: "leave both undefined
// when there is no palette to carry").
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  detectPandoc: vi.fn(async () => ({
    available: false,
    path: "",
    version: "",
  })),
}));

import type { ThemeDef } from "../../../types/theme";

import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { defaultColorsForBase } from "../../../types/theme";
import { ExportDialog } from "../ExportDialog";

// en.json: "export.themeInExport.darkPrintHint" — matched by its distinctive
// fragment rather than the full sentence, so a copy edit does not break this.
const HINT_TEXT = /will print with a dark background/;

const PAIRED: ThemeDef = {
  id: "custom-paired",
  modes: {
    dark: { colors: defaultColorsForBase("dark") },
    light: { colors: defaultColorsForBase("light") },
  },
  name: "Paired",
  source: "custom",
};

afterEach(() => {
  useUIStore.setState({ exportDialogOpen: false });
  useSettingsStore.setState({
    activeThemeId: "system",
    colorModeSetting: "system",
    customThemes: [],
    themeInExport: "default",
  });
});

describe("ExportDialog PDF dark-print hint agrees with the exported palette (§386 F1)", () => {
  it("Baram Default + Mode Dark + tokens — no palette resolves, so the hint is not shown", async () => {
    useSettingsStore.setState({
      activeThemeId: "system",
      colorModeSetting: "dark",
      themeInExport: "tokens",
    });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "pdf" });
    render(<ExportDialog editor={null} />);
    // Flushes the mocked detectPandoc() promise the mount effect kicks off,
    // so its `setPandocInfo` lands inside `act` rather than after this test
    // returns.
    await act(async () => {});
    expect(screen.queryByText(HINT_TEXT)).toBeNull();
  });

  it("a two-mode custom theme + Mode Dark + tokens — a palette resolves, so the hint is shown", async () => {
    useSettingsStore.setState({
      activeThemeId: PAIRED.id,
      colorModeSetting: "dark",
      customThemes: [PAIRED],
      themeInExport: "tokens",
    });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "pdf" });
    render(<ExportDialog editor={null} />);
    await act(async () => {});
    expect(screen.getByText(HINT_TEXT)).toBeTruthy();
  });
});
