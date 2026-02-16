// §5.12 Export — HTML file save + PDF print via system dialog
import type { Editor } from "@tiptap/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "../ipc/invoke";
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
 * Export editor content as PDF via system print dialog.
 * Injects standalone HTML into a hidden iframe and calls window.print().
 */
export async function exportAsPDF(
  editor: Editor,
  title: string,
): Promise<void> {
  const html = generateStandaloneHTML(editor.getHTML(), title, {
    theme: "light",
  });

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    return;
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  // Wait for content (especially KaTeX fonts) to load before printing
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  };

  // Fallback: if onload doesn't fire (some WebView implementations),
  // trigger print after a short delay
  setTimeout(() => {
    if (iframe.parentNode) {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      }, 1000);
    }
  }, 500);
}
