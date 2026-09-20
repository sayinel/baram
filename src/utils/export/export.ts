import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { Locale } from "../../i18n";
import type { PandocFormat, PdfOptions } from "../../ipc/types";
import type { BundledFont } from "../font/bundled-fonts";
import type { ExportHTMLOptions } from "./export-html";
// §5.12 Export — HTML file save + PDF via headless Chrome backend + §53 Notion + §55 Pandoc
import type { Editor } from "@tiptap/core";

import { t } from "../../i18n";
import { exportBinaryFile, exportPandoc, exportPdf } from "../../ipc/invoke";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { serializeLiveDoc } from "../editor/serialize-live-doc";
import { bundledFont } from "../font/bundled-fonts";
import { helpDocUrl } from "../help-urls";
import { logger } from "../logger";
import { buildFontFaceCSS } from "./export-font-embed";
import { captureEditorHTML, generateStandaloneHTML } from "./export-html";
import { stripDisallowedMarkdownLinks } from "./export-markdown-links";
import { rewriteMermaidForPandoc } from "./mermaid-export-assets";
import { convertForNotion } from "./notion-export";
import { convertForPandoc } from "./pandoc-export";
import { imagePolicyNotice, preparePandocImages } from "./pandoc-image-policy";
import { resolveZettelLinksForExport } from "./zettel-link-resolve";

/**
 * §353 — the user's chosen fonts, read by the caller (this module does not
 * touch the settings store — export utilities stay pure) and passed through.
 */
export interface FontExportOptions {
  bodyFont?: string;
  codeFont?: string;
}

export interface HTMLExportOptions
  extends FontExportOptions, ThemeExportOptions {
  /**
   * Embed the bundled faces as data URIs (§353). Off by default: ~2.7MB of
   * base64 for the body face alone is not something every export should pay
   * for. The dialog's checkbox controls this.
   */
  embedFonts?: boolean;
}

/**
 * ‼️ 자기 인터페이스를 갖는 이유: `exportAsPDF` 의 파라미터는
 * `FontExportOptions & PdfOptions` 라 `HTMLExportOptions` 를 보지 않는다(`:110`).
 * 스펙 §11 은 "`HTMLExportOptions` 에 더한다" 고 적고 뒤에서 PDF 동작을 약속하는데,
 * 그 둘은 오늘 코드에서 양립하지 않는다. 서체 옵션이 아니므로 `FontExportOptions`
 * 에 얹지도 않는다.
 */
export interface ThemeExportOptions {
  themeInExport?: ThemeInExport;
}

/** §362 — export 가 활성 테마를 얼마나 실어 나르는가. */
export type ThemeInExport = "default" | "full" | "tokens";

/**
 * The family a slot will ACTUALLY render in, which is the question embedding
 * has to ask (§353).
 *
 * ‼️ An empty slot does not mean "no font chosen". §348 made `""` the default
 * and defined it as "use the token stack", whose head is the bundled face —
 * and the exported document names that family regardless, because
 * `exportTokensCSS()` inlines `primitives.css`. Keying the embed decision on
 * the literal setting value therefore embedded nothing for every user in the
 * default state while the document still asked for Pretendard Variable: the
 * "Embed fonts" checkbox produced a file that was not bigger and did not
 * carry the typeface, and PDF — which always embeds — printed in a system
 * fallback. Two sections of one spec disagreeing about what `""` means (final
 * review C1).
 *
 * The other half of that defect is a stored `"Pretendard"` (every user from
 * before this branch), which is a DIFFERENT family name from
 * `"Pretendard Variable"` and so is not bundled. That one is not resolvable
 * here — a non-empty value is the user's word — and is fixed where it was
 * created, by the settings-store migration that rewrites it to `""`.
 */
function effectiveFamily(slot: string, role: BundledFont["role"]): string {
  return slot.trim() === "" ? bundledFont(role).family : slot;
}

/**
 * Export editor content as a standalone HTML file.
 * Opens native save dialog, then writes via Rust atomic write.
 */
export async function exportAsHTML(
  editor: Editor,
  title: string,
  options?: HTMLExportOptions,
): Promise<void> {
  const bodyFont = options?.bodyFont ?? "";
  const codeFont = options?.codeFont ?? "";
  const themeInExport = options?.themeInExport ?? "default";
  const fontFaceCSS = options?.embedFonts
    ? await buildFontFaceCSS([
        effectiveFamily(bodyFont, "body"),
        effectiveFamily(codeFont, "code"),
      ])
    : "";
  // §362 — `themeInExport` is not yet a field of `ExportHTMLOptions` (Task 2
  // adds that); typing this through `ThemeExportOptions` rather than as a
  // bare object literal keeps it off `generateStandaloneHTML`'s excess-
  // property check while still reaching its third argument at runtime.
  const htmlOptions: ExportHTMLOptions & ThemeExportOptions = {
    bodyFont,
    codeFont,
    fontFaceCSS,
    themeInExport,
  };
  const html = generateStandaloneHTML(
    await captureEditorHTML(editor),
    title,
    htmlOptions,
  );

  const path = await save({
    filters: [{ name: "HTML", extensions: ["html"] }],
    defaultPath: `${title}.html`,
  });
  if (!path) return; // user cancelled

  await exportBinaryFile(path, Array.from(new TextEncoder().encode(html)));
}

/**
 * Export editor content as PDF via Rust headless Chrome backend.
 * Generates standalone HTML, prompts for save location, then invokes
 * the Rust export_pdf command for high-fidelity PDF rendering.
 */
export async function exportAsPDF(
  editor: Editor,
  title: string,
  options?: FontExportOptions & PdfOptions & ThemeExportOptions,
): Promise<void> {
  const {
    bodyFont = "",
    codeFont = "",
    themeInExport = "default",
    ...pdfOptions
  } = options ?? {};
  // §353 — PDF always embeds bundled faces, unconditionally: `generate_pdf`
  // renders from a temp directory a relative font URL cannot resolve against
  // (export-font-embed.ts). There is no checkbox for PDF.
  const fontFaceCSS = await buildFontFaceCSS([
    effectiveFamily(bodyFont, "body"),
    effectiveFamily(codeFont, "code"),
  ]);
  // §362 — see the matching comment in exportAsHTML: `theme: "light"` here is
  // the Task-2-removed dead argument (export-html.ts:242 discards it today);
  // `themeInExport` rides beside it through the same typed local.
  const htmlOptions: ExportHTMLOptions & ThemeExportOptions = {
    theme: "light",
    bodyFont,
    codeFont,
    fontFaceCSS,
    themeInExport,
  };
  const html = generateStandaloneHTML(
    // §301 fix (I4): PDF can never play video — captureEditorHTML replaces it
    // with a link instead of leaving an inert `<video>`.
    await captureEditorHTML(editor, { forPdf: true }),
    title,
    htmlOptions,
  );

  const path = await save({
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    defaultPath: `${title}.pdf`,
  });
  if (!path) return; // user cancelled

  await exportPdf(html, path, pdfOptions);
}

/**
 * §53 Export editor content as Notion-compatible Markdown.
 * Converts Baram-specific syntax (wikilinks, callouts, highlight, etc.)
 * to standard markdown that Notion's importer understands.
 */
export async function exportForNotion(
  editor: Editor,
  title: string,
): Promise<void> {
  const md = serializeLiveDoc(editor);
  // §95: resolve bare [[id]] zettel links to [[id|title]] for export output
  // only — the .md round-trip save (pm-to-md.ts) is untouched by this.
  // issue 527: the link policy runs LAST, after every converter — see
  // export-markdown-links.ts for why the order is the contract.
  const notionMd = stripDisallowedMarkdownLinks(
    convertForNotion(resolveZettelLinksForExport(md)),
  );

  const path = await save({
    filters: [{ name: "Markdown", extensions: ["md"] }],
    defaultPath: `${title}.md`,
  });
  if (!path) return; // user cancelled

  await exportBinaryFile(path, Array.from(new TextEncoder().encode(notionMd)));
}

/**
 * §55 Export editor content via Pandoc to docx/latex/epub/rst.
 * Converts Baram-specific syntax to standard markdown first,
 * then invokes Pandoc through the Rust backend.
 */
export async function exportWithPandoc(
  editor: Editor,
  title: string,
  format: PandocFormat,
  options?: {
    /** The document's absolute path, or null/undefined when never saved (issue 545). */
    documentPath?: null | string;
    pandocPath?: string;
    referenceDoc?: string;
  },
): Promise<void> {
  const md = serializeLiveDoc(editor);
  // §95: resolve bare [[id]] zettel links to [[id|title]] for export output
  // only — the .md round-trip save (pm-to-md.ts) is untouched by this.
  const pandocMd = convertForPandoc(resolveZettelLinksForExport(md));
  const { markdown: rewritten, assets } =
    await rewriteMermaidForPandoc(pandocMd);
  // issue 545: the image policy runs after every converter and the mermaid
  // rewrite, and BEFORE the link policy (pandoc-image-policy.ts).
  const documentPath = options?.documentPath ?? null;
  const prepared = preparePandocImages(
    rewritten,
    format,
    documentPath,
    new Set(assets.map((asset) => asset.name)),
  );
  // issue 527: the link policy runs LAST — see export-markdown-links.ts.
  const finalMd = stripDisallowedMarkdownLinks(prepared.markdown);

  const extensionMap: Record<PandocFormat, string> = {
    docx: "docx",
    latex: "tex",
    epub: "epub",
    rst: "rst",
  };
  const ext = extensionMap[format];
  const filterName = format.toUpperCase();

  const path = await save({
    filters: [{ name: filterName, extensions: [ext] }],
    defaultPath: `${title}.${ext}`,
  });
  if (!path) return; // user cancelled

  await exportPandoc({
    assets,
    documentContextId: prepared.documentContextId,
    documentPath: documentPath ?? undefined,
    format,
    images: prepared.images,
    markdownContent: finalMd,
    outputPath: path,
    pandocPath: options?.pandocPath,
    referenceDoc: options?.referenceDoc,
  });
  // issue 545: an image left out is not an error — the export went through
  // without it — but it is not nothing either. Say how many, and why — and
  // where the rest is written up: the action is also what gives the toast
  // the longer, hover-held lifetime a two-sentence notice needs.
  const locale = useSettingsStore.getState().locale as Locale;
  const notice = imagePolicyNotice(prepared, locale);
  if (notice !== null) {
    useUIStore.getState().showToast(notice, "warning", undefined, {
      label: t("export.imageNotice.learnMore", locale),
      onClick: () => {
        openUrl(helpDocUrl("export", locale)).catch((e) =>
          logger.error("[Baram Export] help page", e),
        );
      },
    });
  }
}
