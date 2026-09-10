// §3.2 / §5.10 / §55 Export IPC commands
import { invoke } from "@tauri-apps/api/core";

import type {
  ExportFormat,
  ExportOptions,
  PandocAsset,
  PandocImageRequest,
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

/** What `export_pandoc` takes — one object, not ten positional parameters. */
export interface ExportPandocRequest {
  assets?: PandocAsset[];
  /** issue 545: the vault or folder context that owns the document (see export.ts). */
  documentContextId?: string;
  /** issue 545: the document's absolute path; the backend takes its directory. */
  documentPath?: string;
  extraArgs?: string[];
  format: string;
  /** issue 545: relative images for the backend to resolve and stage. */
  images?: PandocImageRequest[];
  markdownContent: string;
  outputPath: string;
  pandocPath?: string;
  referenceDoc?: string;
}

export async function exportPandoc(
  request: ExportPandocRequest,
): Promise<void> {
  return invoke<void>("export_pandoc", { ...request });
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
