// §5.12 Export — HTML file save + PDF via headless Chrome backend
import type { Editor } from "@tiptap/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, exportPdf } from "../ipc/invoke";
import type { PdfOptions } from "../ipc/types";
import { generateStandaloneHTML } from "./export-html";

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
