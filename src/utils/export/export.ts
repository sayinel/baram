import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { Locale } from "../../i18n";
import type { PandocFormat, PdfOptions } from "../../ipc/types";
import type { ThemeDef, ThemeMode } from "../../types/theme";
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
import { themeTokensBlock } from "./export-theme-tokens";
import { rewriteMermaidForPandoc } from "./mermaid-export-assets";
import { convertForNotion } from "./notion-export";
import { convertForPandoc } from "./pandoc-export";
import { imagePolicyNotice, preparePandocImages } from "./pandoc-image-policy";
import { resolveZettelLinksForExport } from "./zettel-link-resolve";

/**
 * §353 — the user's chosen fonts, read by the caller and passed through as
 * arguments here, rather than by this module reading the store itself.
 *
 * ‼️ That does NOT make this module store-free. Measured over this file's
 * transitive value-import closure (131 files; `import type` excluded; stores
 * recorded, not descended), `useSettingsStore` is read at exactly two sites.
 * One IS on the HTML/PDF path: `captureEditorHTML` (`export-html.ts`) reads
 * `codeBlockLineNumbers`, and both `exportAsHTML` and `exportAsPDF` call it.
 * The other is NOT: `exportWithPandoc`, below, reads `locale`, and neither
 * HTML/PDF entry point reaches it. What IS true, and what §362's two
 * citations of this comment mean: fonts and the theme palette arrive at
 * `exportAsHTML`/`exportAsPDF` as arguments from the caller (`ExportDialog`),
 * not from a third read here.
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
 * `FontExportOptions & PdfOptions & ThemeExportOptions` 라 `HTMLExportOptions`
 * 를 보지 않는다(아래 `exportAsPDF` 자신의 시그니처 참조 — 행 번호가 아니라
 * 심볼로 찾을 것). 스펙 §11 은 "`HTMLExportOptions` 에 더한다" 고 적고 뒤에서
 * PDF 동작을 약속하는데, 그 둘은 오늘 코드에서 양립하지 않는다. 서체 옵션이
 * 아니므로 `FontExportOptions` 에 얹지도 않는다.
 */
export interface ThemeExportOptions {
  /**
   * §362 — the active theme's def + resolved mode, read by the caller
   * (`ExportDialog`, which already reads the settings store) rather than
   * here. `FontExportOptions`'s doc above enumerates the reads this
   * module's HTML/PDF path DOES make (`codeBlockLineNumbers`, `locale`) —
   * the palette follows the fonts' discipline, not a third one: it arrives
   * as an argument, same as `bodyFont`/`codeFont`. Consulted
   * only when `themeInExport === "tokens"`; leave both
   * undefined when there is no palette to carry (`activeThemeId === "system"`,
   * or `findThemeById` found nothing for it) — `themeTokensBlock` treats a
   * missing theme the same as one with no colours for the mode and returns
   * `""`.
   */
  activeTheme?: ThemeDef;
  activeThemeMode?: ThemeMode;
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
 * §362 R4 — the one place both entry points decide what `themeInExport`
 * actually ships as `themeTokens`.
 *
 * `"full"` is a valid `ThemeInExport` value with no implementation yet: spec
 * §3.5 defers it because `rescopeEditorCSS` is a regex-based string
 * transform (`export-editor-css.ts`) and cannot safely be pointed at a
 * theme's own, potentially untrusted, CSS. Silently promoting it to
 * `"tokens"` would claim the theme's CSS shipped when it did not — next to a
 * feature that already has to handle untrusted CSS carefully — so it
 * degrades to `"default"` instead, loudly.
 */
function resolveThemeTokens(
  themeInExport: ThemeInExport,
  theme: ThemeDef | undefined,
  mode: ThemeMode | undefined,
): string | undefined {
  if (themeInExport === "full") {
    logger.warn(
      '[Baram Export] themeInExport "full" is not implemented yet — falling back to "default"',
    );
    return undefined;
  }
  if (themeInExport !== "tokens") return undefined;
  return themeTokensBlock(theme, mode ?? "light");
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
  const themeTokens = resolveThemeTokens(
    themeInExport,
    options?.activeTheme,
    options?.activeThemeMode,
  );
  const htmlOptions: ExportHTMLOptions = {
    bodyFont,
    codeFont,
    fontFaceCSS,
    themeTokens,
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
    activeTheme,
    activeThemeMode,
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
  const themeTokens = resolveThemeTokens(
    themeInExport,
    activeTheme,
    activeThemeMode,
  );
  const htmlOptions: ExportHTMLOptions = {
    bodyFont,
    codeFont,
    fontFaceCSS,
    themeTokens,
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
