// src/utils/export/__tests__/theme-export-options.test.ts
// §362 — exportAsHTML/exportAsPDF are the two entry points, and the thing
// this task produces is that they hand a computed `themeTokens` string to the
// SAME place: generateStandaloneHTML's third argument. Spec §11 only names
// HTMLExportOptions, but exportAsPDF's own parameter type is
// `FontExportOptions & PdfOptions & ThemeExportOptions` — a different type
// (see exportAsPDF's own signature in export.ts, not a line number: it moves
// every time something is inserted above it) — so a fix that only touched
// exportAsHTML would leave PDF silently stuck on "default" forever.
//
// Task 2 (§362) changed the contract this file pins: `themeInExport` itself
// no longer reaches `generateStandaloneHTML` — only the `themeTokens` string
// `resolveThemeTokens`/`themeTokensBlock` compute from it does (export.ts).
// What `themeTokensBlock` itself does with a palette is
// export-theme-tokens.test.ts's job, not this file's — here we only check
// that SOME non-empty block reaches the third argument for "tokens" with a
// theme, and that nothing does for the absent-options default (both paths).
//
// captureEditorHTML and buildFontFaceCSS are stubbed too — no shared
// fakeEditor helper exists in this directory (export-font-wiring.test.ts
// defines its own the same way), and exportAsPDF always calls
// buildFontFaceCSS (§353, unconditional embed), which would otherwise reach
// for a real `fetch`.
import type { Editor } from "@tiptap/core";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BUILT_IN_THEMES } from "../../../types/theme";
import { logger } from "../../logger";

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

const tokyo = BUILT_IN_THEMES.find((t) => t.id === "tokyo-night");

function fakeEditor(): Editor {
  return {} as unknown as Editor;
}

afterEach(() => {
  generateStandaloneHTML.mockClear();
});

describe("themeInExport reaches both export paths as a resolved themeTokens string", () => {
  it("HTML 경로가 tokens 를 themeTokensBlock 의 결과로 바꿔 넘긴다", async () => {
    const { exportAsHTML } = await import("../export");
    await exportAsHTML(fakeEditor(), "t", {
      activeTheme: tokyo,
      activeThemeMode: "dark",
      themeInExport: "tokens",
    });
    const options = generateStandaloneHTML.mock.calls[0]?.[2] as {
      themeTokens?: string;
    };
    expect(options.themeTokens).toContain("#1a1b26");
  });

  it("PDF 경로도 같은 것을 넘긴다 — 스펙이 HTMLExportOptions 만 말했지만 PDF 의 타입은 다르다", async () => {
    const { exportAsPDF } = await import("../export");
    await exportAsPDF(fakeEditor(), "t", {
      activeTheme: tokyo,
      activeThemeMode: "dark",
      themeInExport: "tokens",
    });
    const options = generateStandaloneHTML.mock.calls[0]?.[2] as {
      themeTokens?: string;
    };
    expect(options.themeTokens).toContain("#1a1b26");
  });

  it("HTML — 옵션이 없으면 themeTokens 가 없다(default)", async () => {
    const { exportAsHTML } = await import("../export");
    await exportAsHTML(fakeEditor(), "t");
    expect(generateStandaloneHTML.mock.calls[0]?.[2]).toMatchObject({
      themeTokens: undefined,
    });
  });

  // Task 1 review's coverage gap (Finding 1): exportAsPDF's own bare default
  // (`themeInExport = "default"` in its destructure) was untested — the
  // "옵션이 없으면 default" case only ever exercised exportAsHTML.
  it("PDF — 옵션이 없으면 themeTokens 가 없다(default)", async () => {
    const { exportAsPDF } = await import("../export");
    await exportAsPDF(fakeEditor(), "t");
    expect(generateStandaloneHTML.mock.calls[0]?.[2]).toMatchObject({
      themeTokens: undefined,
    });
  });

  // R4 — "full"은 아직 구현되지 않았다. "default"로 조용히 처리되는 것과 "tokens"로
  // 조용히 승격되는 것은 겉으로 같아 보이지만(둘 다 지금은 themeTokens가 없다) 의미가
  // 다르다 — 후자는 "테마의 CSS가 실렸다"는 거짓을 향해 가는 길이다. 팔레트가 있어도
  // 승격되지 않는다는 것과, 그 결정이 조용하지 않다는 것(logger.warn) 둘 다 고정한다.
  it('R4 — "full" 은 팔레트가 있어도 tokens 로 승격되지 않고 경고한다', async () => {
    const warnSpy = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => undefined);
    const { exportAsHTML } = await import("../export");
    await exportAsHTML(fakeEditor(), "t", {
      activeTheme: tokyo,
      activeThemeMode: "dark",
      themeInExport: "full",
    });
    expect(generateStandaloneHTML.mock.calls[0]?.[2]).toMatchObject({
      themeTokens: undefined,
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // Fix round 1, Major 1 (task-2-review.md) — the "옵션이 없으면 default" tests
  // above only exercise the shape a UNIT TEST constructs. Production never
  // does: `ExportDialog.tsx` passes `activeTheme`/`activeThemeMode`
  // UNCONDITIONALLY on every export, whatever `themeInExport` is (it can't
  // know a user is about to pick "Default" — it resolves the theme once, up
  // front). So the call shape that actually happens is `themeInExport:
  // "default"` TOGETHER WITH a real `activeTheme`, and nothing pinned that
  // combination: `if (theme === undefined) return undefined;` in place of
  // `resolveThemeTokens`'s real `themeInExport !== "tokens"` guard left all
  // prior tests green, because none of them supplied both at once (reviewer's
  // mutation M1b). "Default" must ignore an active theme, not merely handle
  // one that happens to be absent.
  it("HTML — 활성 테마가 있어도 default 는 그것을 싣지 않는다 (실제 다이얼로그 호출 모양)", async () => {
    const { exportAsHTML } = await import("../export");
    await exportAsHTML(fakeEditor(), "t", {
      activeTheme: tokyo,
      activeThemeMode: "dark",
      themeInExport: "default",
    });
    expect(generateStandaloneHTML.mock.calls[0]?.[2]).toMatchObject({
      themeTokens: undefined,
    });
  });

  it("PDF — 활성 테마가 있어도 default 는 그것을 싣지 않는다 (실제 다이얼로그 호출 모양)", async () => {
    const { exportAsPDF } = await import("../export");
    await exportAsPDF(fakeEditor(), "t", {
      activeTheme: tokyo,
      activeThemeMode: "dark",
      themeInExport: "default",
    });
    expect(generateStandaloneHTML.mock.calls[0]?.[2]).toMatchObject({
      themeTokens: undefined,
    });
  });
});
