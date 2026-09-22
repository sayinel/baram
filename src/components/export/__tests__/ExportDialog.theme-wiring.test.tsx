// §362 fix round 1, Major 2 (task-2-review.md) — nothing pinned that
// ExportDialog actually wires the resolved theme through to exportAsHTML/
// exportAsPDF. Deleting `activeTheme: resolvedTheme,`/`activeThemeMode:
// resolvedMode,` from BOTH call sites left every existing test green
// (reviewer's mutation M3): the only ExportDialog test in the repo
// (ExportDialog.unsaved-note.test.tsx) covers the Pandoc unsaved-note hint,
// and export-font-wiring.test.ts calls export.ts directly, never through the
// dialog — it tests the slot ExportDialog fills, not the filling.
//
// ‼️ This only closes the "wiring is live" direction. It intentionally picks
// `themeInExport: "tokens"` for both cases here — the opposite direction
// ("default" must NOT carry an active theme even though the dialog resolves
// one unconditionally) is Major 1, pinned separately in
// theme-export-options.test.ts at the export.ts level, where the production
// call shape (`{ activeTheme, activeThemeMode, themeInExport: "default" }`)
// is constructed directly. A single test asserting only "theme reaches when
// tokens is selected" would leave that direction unguarded.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  detectPandoc: vi.fn(async () => ({
    available: false,
    path: "",
    version: "",
  })),
}));

// ‼️ `vi.hoisted`, not a plain top-level `const` — `ExportDialog` is a
// STATIC import below, and static imports are themselves hoisted above
// ordinary module code by the JS spec, so a plain `const` here would still
// run after the mock factory that references it (`ReferenceError: Cannot
// access 'exportAsHTMLMock' before initialization`, measured). This is
// unlike `theme-export-options.test.ts`, where `export.ts` is reached via a
// dynamic `await import(...)` inside each test — by then module-top-level
// code has already run, so a plain `const` there is fine.
// Typed with the real 3-arg arity (rather than inferred as 0-arg) so
// `.mock.calls[0]?.[2]` below type-checks as the options arg.
const { exportAsHTMLMock, exportAsPDFMock } = vi.hoisted(() => ({
  exportAsHTMLMock: vi.fn(
    async (
      _editor: unknown,
      _title: string,
      _options?: Record<string, unknown>,
    ) => undefined,
  ),
  exportAsPDFMock: vi.fn(
    async (
      _editor: unknown,
      _title: string,
      _options?: Record<string, unknown>,
    ) => undefined,
  ),
}));
vi.mock("../../../utils/export/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/export/export")>()),
  exportAsHTML: exportAsHTMLMock,
  exportAsPDF: exportAsPDFMock,
}));

import type { Editor } from "@tiptap/react";

import { useEditorStore } from "../../../stores/editor/editor";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { ExportDialog } from "../ExportDialog";

// A truthy stand-in only: handleExport's `if (!editor || exporting) return;`
// guard is all that reads it before exportAsHTML/exportAsPDF are (mocked)
// called — captureEditorHTML never runs because exportAsHTML/exportAsPDF
// themselves are stubbed above.
const fakeEditor = {} as unknown as Editor;

afterEach(() => {
  useUIStore.setState({ exportDialogOpen: false });
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useSettingsStore.setState({
    activeThemeId: "system",
    themeInExport: "default",
  });
  exportAsHTMLMock.mockClear();
  exportAsPDFMock.mockClear();
});

describe("ExportDialog wires the resolved theme through to export.ts (§362)", () => {
  it("HTML — tokens 선택 시 활성 테마가 exportAsHTML 에 실제로 닿는다", async () => {
    // tokyo-night is dark-only (one declared mode), so resolveThemeMode
    // returns "dark" unconditionally — no dependency on the jsdom
    // matchMedia stub's answer for prefers-color-scheme.
    useSettingsStore.setState({
      activeThemeId: "tokyo-night",
      themeInExport: "tokens",
    });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "html" });
    render(<ExportDialog editor={fakeEditor} />);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(exportAsHTMLMock).toHaveBeenCalledOnce());
    const options = exportAsHTMLMock.mock.calls[0]?.[2] as {
      activeTheme?: { id?: string };
      activeThemeMode?: string;
    };
    expect(options.activeTheme?.id).toBe("tokyo-night");
    expect(options.activeThemeMode).toBe("dark");
  });

  it("PDF — tokens 선택 시 활성 테마가 exportAsPDF 에 실제로 닿는다", async () => {
    useSettingsStore.setState({
      activeThemeId: "tokyo-night",
      themeInExport: "tokens",
    });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "pdf" });
    render(<ExportDialog editor={fakeEditor} />);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(exportAsPDFMock).toHaveBeenCalledOnce());
    const options = exportAsPDFMock.mock.calls[0]?.[2] as {
      activeTheme?: { id?: string };
      activeThemeMode?: string;
    };
    expect(options.activeTheme?.id).toBe("tokyo-night");
    expect(options.activeThemeMode).toBe("dark");
  });
});
