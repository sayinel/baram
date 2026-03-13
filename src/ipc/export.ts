// §3.2 / §5.10 / §55 Export IPC commands
import { invoke } from "@tauri-apps/api/core";

import type {
  ExportFormat,
  ExportOptions,
  PandocInfo,
  PdfOptions,
} from "./types";

// §55 Pandoc Extended Export commands
export async function detectPandoc(pandocPath?: string): Promise<PandocInfo> {
  return invoke<PandocInfo>("detect_pandoc", { pandocPath });
}

// §3.2 Export commands
export async function exportDocument(
  htmlContent: string,
  outputPath: string,
  format: ExportFormat,
  options?: ExportOptions,
): Promise<void> {
  return invoke<void>("export_document", {
    htmlContent,
    outputPath,
    format,
    options,
  });
}

export async function exportPandoc(
  markdownContent: string,
  outputPath: string,
  format: string,
  pandocPath?: string,
  referenceDoc?: string,
  extraArgs?: string[],
): Promise<void> {
  return invoke<void>("export_pandoc", {
    markdownContent,
    outputPath,
    format,
    pandocPath,
    referenceDoc,
    extraArgs,
  });
}

// §5.10 PDF export via headless Chrome
export async function exportPdf(
  htmlContent: string,
  outputPath: string,
  options?: PdfOptions,
): Promise<void> {
  return invoke<void>("export_pdf", { htmlContent, outputPath, options });
}

export async function runCustomExport(
  command: string,
  filePath: string,
  outputPath: string,
  vaultDir?: string,
): Promise<void> {
  return invoke<void>("run_custom_export", {
    command,
    filePath,
    outputPath,
    vaultDir,
  });
}
