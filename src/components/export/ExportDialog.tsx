// §5.12 Export Dialog — HTML/PDF/Notion + §55 Pandoc Extended Export
import { useCallback, useEffect, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { PandocInfo } from "../../ipc/types";
import type { Editor } from "@tiptap/react";

import { detectPandoc } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  exportAsHTML,
  exportAsPDF,
  exportForNotion,
  exportWithPandoc,
} from "../../utils/export/export";
import { logger } from "../../utils/logger";

interface ExportDialogProps {
  editor: Editor | null;
}

const FORMAT_OPTIONS = [
  {
    id: "html",
    ext: ".html",
    name: "HTML",
    desc: "Standalone page",
    pandoc: false,
  },
  {
    id: "pdf",
    ext: ".pdf",
    name: "PDF",
    desc: "Print-ready document",
    pandoc: false,
  },
  {
    id: "notion",
    ext: ".md",
    name: "Notion",
    desc: "Notion-compatible Markdown",
    pandoc: false,
  },
  {
    id: "docx",
    ext: ".docx",
    name: "Word",
    desc: "Editable document",
    pandoc: true,
  },
  {
    id: "latex",
    ext: ".tex",
    name: "LaTeX",
    desc: "Typesetting",
    pandoc: true,
  },
  {
    id: "epub",
    ext: ".epub",
    name: "EPUB",
    desc: "E-book format",
    pandoc: true,
  },
  {
    id: "rst",
    ext: ".rst",
    name: "RST",
    desc: "Sphinx documentation",
    pandoc: true,
  },
] as const;

const PANDOC_FORMATS = ["docx", "latex", "epub", "rst"] as const;

export function ExportDialog({ editor }: ExportDialogProps) {
  const {
    exportDialogOpen,
    exportFormat,
    closeExportDialog,
    openExportDialog,
  } = useUIStore();
  const { activeTabId, tabs } = useEditorStore();
  const { pandocPath, wordTemplatePath, setWordTemplatePath } =
    useSettingsStore();
  const [title, setTitle] = useState("Untitled");
  const [exporting, setExporting] = useState(false);
  const [paperSize, setPaperSize] = useState<"a4" | "letter">("a4");
  const [scale, setScale] = useState(100);
  const [errorMsg, setErrorMsg] = useState<null | string>(null);
  const [pandocInfo, setPandocInfo] = useState<null | PandocInfo>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (exportDialogOpen) {
      const activeTab = tabs.find((t) => t.id === activeTabId);
      const defaultTitle = activeTab?.title
        ? activeTab.title.replace(/\.md$/i, "")
        : "Untitled";
      setTitle(defaultTitle);
      setExporting(false);
      setPaperSize("a4");
      setScale(100);
      setErrorMsg(null);
      setTimeout(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      }, 0);

      // Detect Pandoc on mount
      detectPandoc(pandocPath || undefined)
        .then(setPandocInfo)
        .catch(() =>
          setPandocInfo({ path: pandocPath, version: "", available: false }),
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportDialogOpen]);

  const handleSelectTemplate = useCallback(async () => {
    const selected = await open({
      filters: [{ name: "Word Template", extensions: ["docx"] }],
      multiple: false,
    });
    if (selected) {
      setWordTemplatePath(selected as string);
    }
  }, [setWordTemplatePath]);

  const handleExport = useCallback(async () => {
    if (!editor || exporting) return;
    setExporting(true);
    setErrorMsg(null);
    try {
      if (exportFormat === "html") {
        await exportAsHTML(editor, title);
      } else if (exportFormat === "pdf") {
        await exportAsPDF(editor, title, { paperSize, scale: scale / 100 });
      } else if (exportFormat === "notion") {
        await exportForNotion(editor, title);
      } else if (isPandocFormat(exportFormat)) {
        await exportWithPandoc(editor, title, exportFormat, {
          pandocPath: pandocInfo?.path || pandocPath || undefined,
          referenceDoc:
            exportFormat === "docx" ? wordTemplatePath || undefined : undefined,
        });
      }
      closeExportDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Baram Export]", message);
      setErrorMsg(message);
      setExporting(false);
    }
  }, [
    editor,
    exportFormat,
    title,
    paperSize,
    scale,
    pandocPath,
    pandocInfo,
    wordTemplatePath,
    exporting,
    closeExportDialog,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        closeExportDialog();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleExport();
      }
    },
    [closeExportDialog, handleExport],
  );

  if (!exportDialogOpen) return null;

  const pandocAvailable = pandocInfo?.available ?? false;

  return (
    <div className="export-dialog-overlay" onClick={closeExportDialog}>
      <div
        className="export-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="export-dialog-header flex-header">
          <span className="export-dialog-title">Export Document</span>
          <button
            aria-label="Close"
            className="export-dialog-close icon-btn"
            onClick={closeExportDialog}
          >
            &times;
          </button>
        </div>

        <div className="export-dialog-body">
          <div className="export-dialog-field">
            <label className="export-dialog-label">Format</label>
            <div className="export-format-list">
              {FORMAT_OPTIONS.map((fmt) => {
                const isDisabled = fmt.pandoc && !pandocAvailable;
                const isSelected = exportFormat === fmt.id;
                return (
                  <button
                    className={`export-format-card${isSelected ? "export-format-card-selected" : ""}${isDisabled ? "export-format-card-disabled" : ""}`}
                    disabled={isDisabled}
                    key={fmt.id}
                    onClick={() => {
                      if (!isDisabled)
                        openExportDialog(fmt.id as typeof exportFormat);
                    }}
                  >
                    <span className="export-ext-badge">{fmt.ext}</span>
                    <span className="export-format-card-info">
                      <span className="export-format-card-name">
                        {fmt.name}
                      </span>
                      <span className="export-format-card-desc">
                        {fmt.desc}
                      </span>
                    </span>
                    {fmt.pandoc && (
                      <span className="export-pandoc-badge">pandoc</span>
                    )}
                  </button>
                );
              })}
            </div>
            {!pandocAvailable && (
              <p className="export-pandoc-warning">
                ⚠ Install Pandoc for additional formats.{" "}
                <a
                  href="https://pandoc.org/installing.html"
                  rel="noreferrer"
                  style={{ color: "var(--color-accent-default, #4a9eff)" }}
                  target="_blank"
                >
                  pandoc.org
                </a>
              </p>
            )}
          </div>

          <div className="export-dialog-field">
            <label className="export-dialog-label" htmlFor="export-title">
              Title
            </label>
            <input
              className="export-dialog-input"
              id="export-title"
              onChange={(e) => setTitle(e.target.value)}
              ref={titleInputRef}
              type="text"
              value={title}
            />
          </div>

          {exportFormat === "pdf" && (
            <div className="export-dialog-field">
              <label className="export-dialog-label">Paper Size</label>
              <div className="export-paper-tabs">
                <button
                  className={`export-paper-tab ${paperSize === "a4" ? "export-paper-tab-active" : ""}`}
                  onClick={() => setPaperSize("a4")}
                >
                  A4
                </button>
                <button
                  className={`export-paper-tab ${paperSize === "letter" ? "export-paper-tab-active" : ""}`}
                  onClick={() => setPaperSize("letter")}
                >
                  Letter
                </button>
              </div>
            </div>
          )}

          {exportFormat === "pdf" && (
            <div className="export-dialog-field">
              <label className="export-dialog-label" htmlFor="export-scale">
                Scale
                <span className="export-scale-value">{scale}%</span>
              </label>
              <input
                className="export-scale-slider"
                id="export-scale"
                max={150}
                min={50}
                onChange={(e) => setScale(Number(e.target.value))}
                step={5}
                type="range"
                value={scale}
              />
            </div>
          )}

          {exportFormat === "notion" && (
            <p className="export-dialog-notion-hint">
              Converts wikilinks, callouts, highlights, and other Baram-specific
              syntax to Notion-compatible Markdown.
            </p>
          )}

          {exportFormat === "docx" && pandocAvailable && (
            <div className="export-dialog-field">
              <label className="export-dialog-label">
                Word Template (optional)
              </label>
              <div className="export-dialog-template-row">
                <input
                  className="export-dialog-input"
                  placeholder="No template selected"
                  readOnly
                  type="text"
                  value={wordTemplatePath}
                />
                <button
                  className="export-dialog-btn export-dialog-btn-cancel"
                  onClick={handleSelectTemplate}
                >
                  Browse...
                </button>
              </div>
            </div>
          )}

          {isPandocFormat(exportFormat) && pandocAvailable && pandocInfo && (
            <p className="export-dialog-notion-hint">
              Using Pandoc {pandocInfo.version} to convert Baram Markdown.
            </p>
          )}

          {errorMsg && <div className="export-dialog-error">{errorMsg}</div>}
        </div>

        <div className="export-dialog-footer">
          <button
            className="export-dialog-btn export-dialog-btn-cancel"
            onClick={closeExportDialog}
          >
            Cancel
          </button>
          <button
            className="export-dialog-btn export-dialog-btn-primary"
            disabled={
              exporting ||
              !title.trim() ||
              (isPandocFormat(exportFormat) && !pandocAvailable)
            }
            onClick={handleExport}
          >
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

function isPandocFormat(f: string): f is (typeof PANDOC_FORMATS)[number] {
  return (PANDOC_FORMATS as readonly string[]).includes(f);
}
