// src/utils/export/__tests__/theme-export-options.test.ts
// §362 — exportAsHTML/exportAsPDF are the two entry points, and the thing
// this task produces is that they hand `themeInExport` to the SAME place:
// generateStandaloneHTML's third argument. Spec §11 only names
// HTMLExportOptions, but exportAsPDF's parameter is
// `FontExportOptions & PdfOptions & ThemeExportOptions`, not that type
// (export.ts:138) — so a fix that only touched exportAsHTML would leave PDF
// silently stuck on "default" forever. generateStandaloneHTML itself is
// stubbed: what it DOES with themeInExport (the actual palette) is Task 2's
// output, not this task's.
//
// captureEditorHTML and buildFontFaceCSS are stubbed too — no shared
// fakeEditor helper exists in this directory (export-font-wiring.test.ts
// defines its own the same way), and exportAsPDF always calls
// buildFontFaceCSS (§353, unconditional embed), which would otherwise reach
// for a real `fetch`.
import type { Editor } from "@tiptap/core";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => "/tmp/baram-theme-export-test-out"),
}));
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  exportBinaryFile: vi.fn(async () => undefined),
  exportPdf: vi.fn(async () => undefined),
}));
vi.mock("../export-font-embed", () => ({
  buildFontFaceCSS: vi.fn(async () => ""),
}));

// Typed with the real signature's arity (rather than inferred as a 0-arg
// function) so `.mock.calls[0][2]` below type-checks as the options arg.
const generateStandaloneHTML = vi.fn(
  (_editorHTML: string, _title: string, _options?: Record<string, unknown>) =>
    "<html></html>",
);
vi.mock("../export-html", () => ({
  captureEditorHTML: vi.fn(async () => "<p>hello</p>"),
  generateStandaloneHTML,
}));

function fakeEditor(): Editor {
  return {} as unknown as Editor;
}

afterEach(() => {
  generateStandaloneHTML.mockClear();
});

describe("themeInExport reaches both export paths", () => {
  it("HTML 경로가 옵션을 넘긴다", async () => {
    const { exportAsHTML } = await import("../export");
    await exportAsHTML(fakeEditor(), "t", { themeInExport: "tokens" });
    expect(generateStandaloneHTML.mock.calls[0][2]).toMatchObject({
      themeInExport: "tokens",
    });
  });

  it("PDF 경로도 같은 옵션을 넘긴다 — 스펙이 HTMLExportOptions 만 말했지만 PDF 의 타입은 다르다", async () => {
    const { exportAsPDF } = await import("../export");
    await exportAsPDF(fakeEditor(), "t", { themeInExport: "tokens" });
    expect(generateStandaloneHTML.mock.calls[0][2]).toMatchObject({
      themeInExport: "tokens",
    });
  });

  it("옵션이 없으면 default 다", async () => {
    const { exportAsHTML } = await import("../export");
    await exportAsHTML(fakeEditor(), "t");
    expect(generateStandaloneHTML.mock.calls[0][2]).toMatchObject({
      themeInExport: "default",
    });
  });
});
