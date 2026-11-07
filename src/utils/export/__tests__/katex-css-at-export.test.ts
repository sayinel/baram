// §5.12 issue 799 — HTML and PDF export load KaTeX's font-embedded stylesheet
// at export time and hand it to generateStandaloneHTML. The fonts are no longer
// imported by export-html.ts (that put them in a chunk the app loads at
// startup), so each export path has to bring them itself. Harness modeled on
// theme-export-options.test.ts: the real export.ts, with the dialog, IPC,
// capture and generateStandaloneHTML stubbed.
import type { Editor } from "@tiptap/core";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => "/tmp/baram-katex-export-test-out"),
}));
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  exportBinaryFile: vi.fn(async () => undefined),
  exportPdf: vi.fn(async () => undefined),
}));
vi.mock("../export-font-embed", () => ({
  buildFontFaceCSS: vi.fn(async () => ""),
}));

const captured = { html: "" };
const generateStandaloneHTML = vi.fn(
  (_editorHTML: string, _title: string, _options?: Record<string, unknown>) =>
    "<html></html>",
);
vi.mock("../export-html", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../export-html")>()),
  captureEditorHTML: vi.fn(async () => captured.html),
  generateStandaloneHTML,
}));

const MATH = '<p><span class="katex">E</span></p>';

function embeddedFaces(css: string | undefined): number {
  return css?.match(/url\("data:font\/woff2;base64,/g)?.length ?? 0;
}

function fakeEditor(): Editor {
  return {} as unknown as Editor;
}

/** The `katexCSS` the export handed generateStandaloneHTML. */
function katexCSSHandedOver(): string | undefined {
  const options = generateStandaloneHTML.mock.calls[0]?.[2] as {
    katexCSS?: string;
  };
  return options.katexCSS;
}

afterEach(() => {
  generateStandaloneHTML.mockClear();
});

describe("KaTeX's stylesheet reaches both export paths at export time", () => {
  // 이것을 실패시키는 것: exportAsHTML 의 옵션에서 `katexCSS: await katexCSSFor(editorHTML)` 를 뺀다.
  it("HTML export of a document with math carries all 20 embedded faces", async () => {
    captured.html = MATH;
    const { exportAsHTML } = await import("../export");
    await exportAsHTML(fakeEditor(), "t");
    expect(embeddedFaces(katexCSSHandedOver())).toBe(20);
  });

  // 이것을 실패시키는 것: exportAsPDF 의 옵션에서 `katexCSS` 를 뺀다.
  it("PDF export of a document with math carries all 20 embedded faces", async () => {
    captured.html = MATH;
    const { exportAsPDF } = await import("../export");
    await exportAsPDF(fakeEditor(), "t");
    expect(embeddedFaces(katexCSSHandedOver())).toBe(20);
  });

  // 이것을 실패시키는 것: `katexCSSFor` 의 `needsKatexStylesheet` 관문을 지운다(수식 없는 문서도
  // 폰트 chunk 를 읽는다).
  it("does not load the stylesheet for a document with no math", async () => {
    captured.html = "<p>no math</p>";
    const { exportAsHTML } = await import("../export");
    await exportAsHTML(fakeEditor(), "t");
    expect(katexCSSHandedOver()).toBeUndefined();
  });
});
