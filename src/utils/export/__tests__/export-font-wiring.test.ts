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
import { bundledFont } from "../../font/bundled-fonts";
import { exportAsHTML, exportAsPDF } from "../export";
import { captureEditorHTML } from "../export-html";
import { buildCodeBlockExport } from "../export-html-code-block";

// captureEditorHTML is stubbed above, so the editor's own content never
// matters to this file — only the options bag does. The one exception is the
// code-block journey at the bottom, which overrides the stub for one call.
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

  // ‼️ final review C1 — THE DEFAULT, which is the state every install and
  // every upgrading user is actually in and which no test exercised. `""` is
  // not "no font chosen": §348 made it mean "use the token stack", whose head
  // is the bundled face, and the exported document names that family through
  // the inlined primitives.css regardless. Keying the embed on the literal
  // setting value therefore shipped a file that was neither bigger nor
  // carrying the typeface while the checkbox promised both.
  //
  // The case above pins the opposite (a bundled name explicitly selected) and
  // reads, at a glance, as though it covered this one.
  it("embeds BOTH bundled faces for two empty slots, because empty means the bundled stack", async () => {
    await exportAsHTML(fakeEditor, "t", {
      bodyFont: "",
      codeFont: "",
      embedFonts: true,
    });

    const html = htmlWritten();
    expect(html).toContain("data:font/woff2");
    // Both slots, named from the single source rather than re-spelled: a fix
    // that resolved only the body slot would pass a bare data-URI check.
    for (const role of ["body", "code"] as const) {
      expect(html).toContain(`font-family:"${bundledFont(role).family}"`);
    }
    expect([...html.matchAll(/@font-face/gu)]).toHaveLength(2);
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

  // final review C1, the PDF half: §353 says PDF embeds unconditionally, but
  // "unconditionally" used to be conditioned on a bundled name being SELECTED,
  // so a PDF printed in the default state carried no face at all and rendered
  // in a system fallback.
  it("embeds both bundled faces for the default (empty) settings", async () => {
    await exportAsPDF(fakeEditor, "t", { bodyFont: "", codeFont: "" });

    const html = htmlPrinted();
    for (const role of ["body", "code"] as const) {
      expect(html).toContain(`font-family:"${bundledFont(role).family}"`);
    }
    expect([...html.matchAll(/@font-face/gu)]).toHaveLength(2);
  });
});

// final review I1 — the code font's most relevant surface was the one surface
// it could not reach. The block is rebuilt rather than cloned, and both its
// stylesheet rules and its inline `cssText` named a module constant that was
// also a stale copy of the mono stack missing the bundled head. So even with
// C1 fixed and the face embedded, exported code blocks would still not have
// rendered in it.
//
// This asserts the whole chain on the artifact: the document declares the
// user's code font on the variable, and the block reads THAT variable. The
// two halves regress independently, which is why one test covers both.
describe("the code font reaches an exported code block (§353 review I1)", () => {
  it("declares the code font on the article and makes the block read that variable", async () => {
    const block = buildCodeBlockExport({
      highlightedLines: ["const a = 1;"],
      lang: "ts",
      lineNumbers: null,
      style: "default",
    });
    vi.mocked(captureEditorHTML).mockResolvedValueOnce(block.outerHTML);

    await exportAsHTML(fakeEditor, "t", { bodyFont: "", codeFont: "D2Coding" });

    const html = htmlWritten();
    expect(html).toContain("--font-family-mono:&quot;D2Coding&quot;");

    // Read the block's own inline style out of the written document rather
    // than searching the whole file: the editor stylesheets it inlines
    // legitimately contain `var(--font-family-mono)` in ~27 other places, so
    // a document-wide substring check would pass with the constant restored.
    //
    // Matched with a regex because the source's compact `cssText` is
    // re-serialized by CSSOM with spaces before it ever reaches the file.
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const selector of [".code-block-body", ".code-block-export-lang"]) {
      const el = doc.querySelector(selector);
      expect(el, `${selector} missing from the export`).not.toBeNull();
      expect(el?.getAttribute("style")).toMatch(
        /font-family:\s*var\(--font-family-mono\)/u,
      );
    }

    // And the rules the stylesheet carries for the same two classes. The
    // deleted constant's exact spelling (no space after the commas) is the
    // discriminator — the token in primitives.css names the same families
    // with spaces, so a looser check would match the legitimate stack.
    expect(html).not.toContain('"JetBrains Mono","Fira Code"');
  });
});
