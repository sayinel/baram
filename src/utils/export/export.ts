import { save } from "@tauri-apps/plugin-dialog";

import type { Locale } from "../../i18n";
import type { ContextInfo, PandocFormat, PdfOptions } from "../../ipc/types";
// §5.12 Export — HTML file save + PDF via headless Chrome backend + §53 Notion + §55 Pandoc
import type { Editor } from "@tiptap/core";

import { t } from "../../i18n";
import { exportBinaryFile, exportPandoc, exportPdf } from "../../ipc/invoke";
import { contextRootOf, useContextStore } from "../../stores/context/context";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { serializeLiveDoc } from "../editor/serialize-live-doc";
import { isUnderRoot } from "../path-utils";
import { buildFontFaceCSS } from "./export-font-embed";
import { captureEditorHTML, generateStandaloneHTML } from "./export-html";
import { stageMarkdownImages } from "./export-markdown-images";
import { stripDisallowedMarkdownLinks } from "./export-markdown-links";
import { rewriteMermaidForPandoc } from "./mermaid-export-assets";
import { convertForNotion } from "./notion-export";
import { convertForPandoc } from "./pandoc-export";
import { resolveZettelLinksForExport } from "./zettel-link-resolve";

/**
 * §353 — the user's chosen fonts, read by the caller (this module does not
 * touch the settings store — export utilities stay pure) and passed through.
 */
export interface FontExportOptions {
  bodyFont?: string;
  codeFont?: string;
}

export interface HTMLExportOptions extends FontExportOptions {
  /**
   * Embed the bundled faces as data URIs (§353). Off by default: ~2.7MB of
   * base64 for the body face alone is not something every export should pay
   * for. The dialog's checkbox controls this.
   */
  embedFonts?: boolean;
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
  const fontFaceCSS = options?.embedFonts
    ? await buildFontFaceCSS([bodyFont, codeFont])
    : "";
  const html = generateStandaloneHTML(await captureEditorHTML(editor), title, {
    bodyFont,
    codeFont,
    fontFaceCSS,
  });

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
  options?: FontExportOptions & PdfOptions,
): Promise<void> {
  const { bodyFont = "", codeFont = "", ...pdfOptions } = options ?? {};
  // §353 — PDF always embeds bundled faces, unconditionally: `generate_pdf`
  // renders from a temp directory a relative font URL cannot resolve against
  // (export-font-embed.ts). There is no checkbox for PDF.
  const fontFaceCSS = await buildFontFaceCSS([bodyFont, codeFont]);
  const html = generateStandaloneHTML(
    // §301 fix (I4): PDF can never play video — captureEditorHTML replaces it
    // with a link instead of leaving an inert `<video>`.
    await captureEditorHTML(editor, { forPdf: true }),
    title,
    { theme: "light", bodyFont, codeFont, fontFaceCSS },
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

/** The Pandoc targets that embed images, i.e. make pandoc open the files (issue 545). */
const PANDOC_EMBEDS_IMAGES: ReadonlySet<PandocFormat> = new Set([
  "docx",
  "epub",
]);

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
  // issue 545: for the formats that EMBED images — pandoc reads the files —
  // the image policy runs after every converter and the mermaid rewrite:
  // relative images become asset requests the backend resolves inside the
  // document's own context, everything else becomes alt text. It runs BEFORE
  // the link policy, so that one stays the final gate
  // (export-markdown-images.ts). LaTeX and RST embed nothing — pandoc writes
  // the reference and reads no file — so their images pass through as written.
  const documentPath = options?.documentPath ?? null;
  const owner =
    documentPath === null ? null : owningDirectoryContext(documentPath);
  const {
    images,
    markdown: staged,
    refused,
    scoped,
  } = PANDOC_EMBEDS_IMAGES.has(format)
    ? stageMarkdownImages(rewritten, {
        contextRoot: owner === null ? null : contextRootOf(owner.path),
        documentPath,
        knownAssets: new Set(assets.map((asset) => asset.name)),
      })
    : { images: [], markdown: rewritten, refused: 0, scoped: true };
  // issue 527: the link policy runs LAST — see export-markdown-links.ts.
  const finalMd = stripDisallowedMarkdownLinks(staged);

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
    documentContextId: owner?.id,
    documentPath: documentPath ?? undefined,
    format,
    images,
    markdownContent: finalMd,
    outputPath: path,
    pandocPath: options?.pandocPath,
    referenceDoc: options?.referenceDoc,
  });
  // issue 545: an image left out is not an error — the export went through
  // without it — but it is not nothing either. Say how many, and why.
  if (refused > 0) {
    const { locale } = useSettingsStore.getState();
    useUIStore
      .getState()
      .showToast(
        t(
          scoped ? "export.imagesLeftOut" : "export.imagesLeftOutUnscoped",
          locale as Locale,
          { count: String(refused) },
        ),
        "warning",
      );
  }
}

/**
 * issue 545: the vault or folder context whose files an export of
 * `documentPath` may embed — the deepest directory context holding it, as
 * everywhere else in the app (§81, longest prefix). Never a `File` context:
 * a file opened on its own authorizes exactly that file. Not the tab's own
 * context: `openTab` backfills that id from whatever context was active, and
 * a wider one would let `../secret.png` climb past a folder the user opened
 * on purpose. This is the user-facing half of the rule; the backend
 * re-derives the boundary from canonical paths
 * (`ContextManager::owning_directory_root`).
 */
function owningDirectoryContext(documentPath: string): ContextInfo | null {
  const { contexts } = useContextStore.getState();
  let best: ContextInfo | null = null;
  for (const c of contexts) {
    if (c.contextType === "file" || !isUnderRoot(documentPath, c.path)) {
      continue;
    }
    if (
      best === null ||
      contextRootOf(c.path).length > contextRootOf(best.path).length
    ) {
      best = c;
    }
  }
  return best;
}
