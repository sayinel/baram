// §5.12 Export — HTML file save + PDF via headless Chrome backend + §53 Notion
import type { Editor } from "@tiptap/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, exportPdf } from "../ipc/invoke";
import type { PdfOptions } from "../ipc/types";
import { generateStandaloneHTML } from "./export-html";
import { prosemirrorToMarkdown } from "../pipeline/pm-to-md";
import { convertForNotion } from "./notion-export";

/**
 * Export editor content as a standalone HTML file.
 * Opens native save dialog, then writes via Rust atomic write.
 */
export async function exportAsHTML(
  editor: Editor,
  title: string,
): Promise<void> {
  const html = generateStandaloneHTML(editor.getHTML(), title);

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
  const html = generateStandaloneHTML(editor.getHTML(), title, {
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
