// src/utils/export/__tests__/export-font-wiring.test.ts
// §353 리뷰 Important 2 — 체크박스/서체 설정이 ExportDialog가 채우는 자리
// (exportAsHTML/exportAsPDF의 옵션 인자)에서 실제로 generateStandaloneHTML까지
// 닿는지를 검증한다.
//
// export-font-embed.test.ts는 exportFontVariables/buildFontFaceCSS를 격리해서
// 보고, export-html.test.ts는 이미 조립된 옵션을 받은 generateStandaloneHTML만
// 본다 — 그 사이, 즉 ExportDialog가 채운 bodyFont/codeFont/embedFonts가
// export.ts의 두 함수를 거쳐 실제로 도달하는지는 아무 테스트도 없었다. 이름이
// 바뀌거나 bodyFont/codeFont가 뒤바뀌어도 기존 498개 테스트가 전부 초록이었을
// 것이다.
//
// captureEditorHTML은 통짜로 스텁한다 — 이 파일의 관심사는 "옵션이 어디로
// 흘러가는가"이지 DOM 캡처가 아니다(그건 이미 export-html.test.ts가 본다).
// 그 대신 generateStandaloneHTML은 실제 구현을 그대로 쓴다 — export.ts가 실제로
// 부르는 것과 같은 함수여야, 이 테스트가 "옵션이 조립기까지 닿는다"를 진짜로
// 증명한다.
import type { Editor } from "@tiptap/core";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => "/tmp/baram-export-test-out"),
}));
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  exportBinaryFile: vi.fn(async () => undefined),
  exportPdf: vi.fn(async () => undefined),
}));
vi.mock("../export-html", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../export-html")>()),
  captureEditorHTML: vi.fn(async () => "<p>hello</p>"),
}));

import { exportBinaryFile, exportPdf } from "../../../ipc/invoke";
import { exportAsHTML, exportAsPDF } from "../export";

// captureEditorHTML is stubbed above, so the editor's own content never
// matters to this file — only the options bag does.
const fakeEditor = {} as unknown as Editor;

function htmlPrinted(): string {
  return vi.mocked(exportPdf).mock.calls[0]?.[0] ?? "";
}

function htmlWritten(): string {
  const bytes = vi.mocked(exportBinaryFile).mock.calls[0]?.[1] ?? [];
  return new TextDecoder().decode(new Uint8Array(bytes));
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      ok: true,
    })),
  );
});

afterEach(() => {
  vi.mocked(exportBinaryFile).mockClear();
  vi.mocked(exportPdf).mockClear();
  vi.unstubAllGlobals();
});

describe("exportAsHTML — options reach the assembled document (§353 review Important 2)", () => {
  it("puts bodyFont on --font-family-editor and codeFont on --font-family-mono, not swapped", async () => {
    await exportAsHTML(fakeEditor, "t", {
      bodyFont: "Noto Sans KR",
      codeFont: "D2Coding",
    });

    const html = htmlWritten();
    expect(html).toContain("--font-family-editor:&quot;Noto Sans KR&quot;");
    expect(html).toContain("--font-family-mono:&quot;D2Coding&quot;");
    // Discriminates a swap: neither family may show up under the other's variable.
    expect(html).not.toContain("--font-family-editor:&quot;D2Coding&quot;");
    expect(html).not.toContain("--font-family-mono:&quot;Noto Sans KR&quot;");
  });

  it("does not fetch or embed font bytes when embedFonts is left off (the dialog's default)", async () => {
    await exportAsHTML(fakeEditor, "t", {
      bodyFont: "Pretendard Variable",
      codeFont: "",
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(htmlWritten()).not.toContain("data:font/woff2");
  });

  it("embeds the bundled face as a data URI once embedFonts is checked", async () => {
    await exportAsHTML(fakeEditor, "t", {
      bodyFont: "Pretendard Variable",
      codeFont: "",
      embedFonts: true,
    });

    expect(fetch).toHaveBeenCalled();
    expect(htmlWritten()).toContain("data:font/woff2;base64,");
  });
});

describe("exportAsPDF — always embeds, no checkbox to gate it (§353 review Important 2)", () => {
  it("embeds the bundled face even though the caller passed no embedFonts flag", async () => {
    await exportAsPDF(fakeEditor, "t", {
      bodyFont: "Pretendard Variable",
      codeFont: "",
    });

    expect(fetch).toHaveBeenCalled();
    expect(htmlPrinted()).toContain("data:font/woff2;base64,");
  });

  it("keeps bodyFont/codeFont out of the PdfOptions object handed to the Rust IPC call", async () => {
    await exportAsPDF(fakeEditor, "t", {
      bodyFont: "Noto Sans KR",
      codeFont: "D2Coding",
      paperSize: "a4",
    });

    const pdfOptions = vi.mocked(exportPdf).mock.calls[0][2];
    expect(pdfOptions).not.toHaveProperty("bodyFont");
    expect(pdfOptions).not.toHaveProperty("codeFont");
    expect(pdfOptions).toMatchObject({ paperSize: "a4" });
  });

  it("puts bodyFont/codeFont on the right variables in the printed HTML, not swapped", async () => {
    await exportAsPDF(fakeEditor, "t", {
      bodyFont: "Noto Sans KR",
      codeFont: "D2Coding",
    });

    const html = htmlPrinted();
    expect(html).toContain("--font-family-editor:&quot;Noto Sans KR&quot;");
    expect(html).toContain("--font-family-mono:&quot;D2Coding&quot;");
  });
});
