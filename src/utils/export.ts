// §5.12 Export — HTML file save + PDF via headless Chrome backend + §53 Notion + §55 Pandoc
import type { Editor } from "@tiptap/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, exportPdf, exportPandoc } from "../ipc/invoke";
import type { PdfOptions, PandocFormat } from "../ipc/types";
import { captureEditorHTML, generateStandaloneHTML } from "./export-html";
import { prosemirrorToMarkdown } from "../pipeline/pm-to-md";
import { convertForNotion } from "./notion-export";
import { convertForPandoc } from "./pandoc-export";

/**
 * Export editor content as a standalone HTML file.
 * Opens native save dialog, then writes via Rust atomic write.
 */
export async function exportAsHTML(
  editor: Editor,
  title: string,
): Promise<void> {
  const html = generateStandaloneHTML(captureEditorHTML(editor), title);

  const path = await save({
    filters: [{ name: "HTML", extensions: ["html"] }],
    defaultPath: `${title}.html`,
  });
  if (!path) return; // user cancelled

  await writeFile(path, html);
}

/**
 * Export editor content as PDF via Rust headless Chrome backend.
 * Generates standalone HTML, prompts for save location, then invokes
 * the Rust export_pdf command for high-fidelity PDF rendering.
 */
export async function exportAsPDF(
  editor: Editor,
  title: string,
  options?: PdfOptions,
): Promise<void> {
  const html = generateStandaloneHTML(captureEditorHTML(editor), title, {
    theme: "light",
  });

  const path = await save({
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    defaultPath: `${title}.pdf`,
  });
  if (!path) return; // user cancelled

  await exportPdf(html, path, options);
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
  const md = prosemirrorToMarkdown(editor.state.doc);
  const notionMd = convertForNotion(md);

  const path = await save({
    filters: [{ name: "Markdown", extensions: ["md"] }],
    defaultPath: `${title}.md`,
  });
  if (!path) return; // user cancelled

  await writeFile(path, notionMd);
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
  options?: { pandocPath?: string; referenceDoc?: string },
): Promise<void> {
  const md = prosemirrorToMarkdown(editor.state.doc);
  const pandocMd = convertForPandoc(md);

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

  await exportPandoc(
    pandocMd,
    path,
    format,
    options?.pandocPath,
    options?.referenceDoc,
  );
}
