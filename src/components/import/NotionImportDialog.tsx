// §53 Notion Import Dialog — extract ZIP, convert, preview, import
import { useState, useCallback, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useUIStore } from "../../stores/ui-store";
import { useFileStore, openFolder } from "../../stores/file-store";
import {
  extractZip,
  readFile,
  writeFile,
  createDir,
  copyFile,
} from "../../ipc/invoke";
import {
  buildFileMap,
  convertNotionMarkdown,
  cleanNotionPath,
} from "../../utils/notion-converter";
import { appDataDir } from "@tauri-apps/api/path";

interface ConvertedFile {
  /** Original path inside extracted ZIP */
  originalPath: string;
  /** Clean destination relative path */
  cleanRelPath: string;
  /** Whether this is a markdown file (converted) or binary (copied) */
  isMarkdown: boolean;
  /** Size in bytes (approx) */
  size: number;
}

type ImportStep = "select" | "preview" | "importing" | "done";

export function NotionImportDialog() {
  const { notionImportOpen, closeNotionImport } = useUIStore();
  const { rootPath } = useFileStore();

  const [step, setStep] = useState<ImportStep>("select");
  const [convertedFiles, setConvertedFiles] = useState<ConvertedFile[]>([]);
  const [fileMap, setFileMap] = useState<Map<string, string>>(new Map());
  const [targetSubfolder, setTargetSubfolder] = useState("Notion Import");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [importCount, setImportCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset when dialog opens
  useEffect(() => {
    if (notionImportOpen) {
      setStep("select");
      setConvertedFiles([]);
      setFileMap(new Map());
      setTargetSubfolder("Notion Import");
      setErrorMsg(null);
      setProgress(0);
      setImportCount(0);
    }
  }, [notionImportOpen]);

  // Focus subfolder input on preview step
  useEffect(() => {
    if (step === "preview") {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [step]);

  // Step 1: Select ZIP file and extract
  const handleSelectZip = useCallback(async () => {
    try {
      setErrorMsg(null);
      const selected = await open({
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      });
      if (!selected) return;

      setStep("importing"); // Reuse "importing" step for extraction progress UI

      // Extract to temp directory
      const appData = await appDataDir();
      const tempDir = `${appData}/notion-import-${Date.now()}`;
      await createDir(tempDir);

      const extractedPaths = await extractZip(selected, tempDir);

      // Build file map from all filenames
      const mdFiles = extractedPaths.filter((p) => p.endsWith(".md"));
      const allFilenames = extractedPaths.map((p) => {
        // Get relative path from tempDir
        return p.startsWith(tempDir + "/") ? p.slice(tempDir.length + 1) : p;
      });

      // Build file map for markdown files
      const mdRelPaths = mdFiles.map((p) =>
        p.startsWith(tempDir + "/") ? p.slice(tempDir.length + 1) : p,
      );
      const fMap = buildFileMap(mdRelPaths);
      setFileMap(fMap);

      // Build converted file list
      const files: ConvertedFile[] = allFilenames.map((relPath) => {
        const isMd = relPath.endsWith(".md");
        return {
          originalPath: `${tempDir}/${relPath}`,
          cleanRelPath: isMd ? (fMap.get(relPath) ?? cleanNotionPath(relPath)) : cleanNotionPath(relPath),
          isMarkdown: isMd,
          size: 0, // Approximate, not critical for preview
        };
      });

      setConvertedFiles(files);
      setStep("preview");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Failed to extract ZIP: ${msg}`);
      setStep("select");
    }
  }, []);

  // Step 3: Import files to target folder
  const handleImport = useCallback(async () => {
    if (!rootPath || convertedFiles.length === 0) return;

    setStep("importing");
    setErrorMsg(null);
    setProgress(0);

    try {
      const targetBase = targetSubfolder.trim()
        ? `${rootPath}/${targetSubfolder.trim()}`
        : rootPath;

      // Create target directory
      await createDir(targetBase);

      let imported = 0;
      for (const file of convertedFiles) {
        const destPath = `${targetBase}/${file.cleanRelPath}`;

        // Ensure parent directory exists
        const parentDir = destPath.substring(0, destPath.lastIndexOf("/"));
        if (parentDir !== targetBase) {
          await createDir(parentDir);
        }

        if (file.isMarkdown) {
          // Read, convert, write
          const content = await readFile(file.originalPath);
          const converted = convertNotionMarkdown(content, fileMap);
          await writeFile(destPath, converted);
        } else {
          // Binary file — copy directly
          await copyFile(file.originalPath, destPath);
        }

        imported++;
        setProgress(Math.round((imported / convertedFiles.length) * 100));
      }

      setImportCount(imported);
      setStep("done");

      // Refresh file tree
      await openFolder(rootPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Import failed: ${msg}`);
      setStep("preview");
    }
  }, [rootPath, convertedFiles, fileMap, targetSubfolder]);

  // Cleanup temp dir on close
  const handleClose = useCallback(() => {
    // Note: temp dir cleanup is best-effort; OS will clean appData/notion-import-* eventually
    closeNotionImport();
  }, [closeNotionImport]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    },
    [handleClose],
  );

  if (!notionImportOpen) return null;

  const mdCount = convertedFiles.filter((f) => f.isMarkdown).length;
  const assetCount = convertedFiles.filter((f) => !f.isMarkdown).length;

  return (
    <div className="export-dialog-overlay" onClick={handleClose}>
      <div
        className="export-dialog notion-import-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="export-dialog-header">
          <span className="export-dialog-title">Import from Notion</span>
          <button
            className="export-dialog-close"
            onClick={handleClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="export-dialog-body">
          {/* Step: Select ZIP */}
          {step === "select" && (
            <>
              <p className="notion-import-desc">
                Select a ZIP file exported from Notion using
                &quot;Export as Markdown &amp; CSV&quot;.
              </p>
              <button
                className="export-dialog-btn export-dialog-btn-primary notion-import-select-btn"
                onClick={handleSelectZip}
              >
                Select ZIP File...
              </button>
              {!rootPath && (
                <p className="notion-import-warning">
                  Open a folder first to import files.
                </p>
              )}
            </>
          )}

          {/* Step: Preview */}
          {step === "preview" && (
            <>
              <div className="notion-import-summary">
                <span className="notion-import-badge">{mdCount} documents</span>
                {assetCount > 0 && (
                  <span className="notion-import-badge notion-import-badge-secondary">
                    {assetCount} assets
                  </span>
                )}
              </div>

              <div className="export-dialog-field">
                <label className="export-dialog-label" htmlFor="notion-subfolder">
                  Import to subfolder
                </label>
                <input
                  ref={inputRef}
                  id="notion-subfolder"
                  className="export-dialog-input"
                  type="text"
                  value={targetSubfolder}
                  onChange={(e) => setTargetSubfolder(e.target.value)}
                  placeholder="e.g. Notion Import"
                />
              </div>

              <div className="notion-import-file-list">
                {convertedFiles.slice(0, 20).map((f) => (
                  <div key={f.originalPath} className="notion-import-file-item">
                    <span className={f.isMarkdown ? "notion-import-file-md" : "notion-import-file-asset"}>
                      {f.isMarkdown ? "MD" : "FILE"}
                    </span>
                    <span className="notion-import-file-name" title={f.cleanRelPath}>
                      {f.cleanRelPath}
                    </span>
                  </div>
                ))}
                {convertedFiles.length > 20 && (
                  <div className="notion-import-file-more">
                    ...and {convertedFiles.length - 20} more files
                  </div>
                )}
              </div>
            </>
          )}

          {/* Step: Importing */}
          {step === "importing" && (
            <div className="notion-import-progress">
              <div className="notion-import-progress-bar">
                <div
                  className="notion-import-progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="notion-import-progress-text">
                {progress === 0 ? "Extracting ZIP..." : `Importing files... ${progress}%`}
              </p>
            </div>
          )}

          {/* Step: Done */}
          {step === "done" && (
            <div className="notion-import-done">
              <p>Successfully imported {importCount} files.</p>
            </div>
          )}

          {errorMsg && (
            <div className="export-dialog-error">{errorMsg}</div>
          )}
        </div>

        <div className="export-dialog-footer">
          {step === "preview" && (
            <>
              <button
                className="export-dialog-btn export-dialog-btn-cancel"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                className="export-dialog-btn export-dialog-btn-primary"
                onClick={handleImport}
                disabled={!rootPath || convertedFiles.length === 0}
              >
                Import {mdCount + assetCount} Files
              </button>
            </>
          )}
          {step === "done" && (
            <button
              className="export-dialog-btn export-dialog-btn-primary"
              onClick={handleClose}
            >
              Done
            </button>
          )}
          {step === "select" && (
            <button
              className="export-dialog-btn export-dialog-btn-cancel"
              onClick={handleClose}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
