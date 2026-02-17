// §5.12 Export Dialog — HTML/PDF export with format selection + paper size
import { useState, useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { useUIStore } from "../../stores/ui-store";
import { useEditorStore } from "../../stores/editor-store";
import { exportAsHTML, exportAsPDF } from "../../utils/export";

interface ExportDialogProps {
  editor: Editor | null;
}

export function ExportDialog({ editor }: ExportDialogProps) {
  const { exportDialogOpen, exportFormat, closeExportDialog, openExportDialog } =
    useUIStore();
  const { activeTabId, tabs } = useEditorStore();
  const [title, setTitle] = useState("Untitled");
  const [exporting, setExporting] = useState(false);
  const [paperSize, setPaperSize] = useState<"a4" | "letter">("a4");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (exportDialogOpen) {
      const activeTab = tabs.find((t) => t.id === activeTabId);
      // Use active file name (without .md extension) or fallback to "Untitled"
      const defaultTitle = activeTab?.title
        ? activeTab.title.replace(/\.md$/i, "")
        : "Untitled";
      setTitle(defaultTitle);
      setExporting(false);
      setPaperSize("a4");
      setErrorMsg(null);
      setTimeout(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      }, 0);
    }
  }, [exportDialogOpen]);

  const handleExport = useCallback(async () => {
    if (!editor || exporting) return;
    setExporting(true);
    setErrorMsg(null);
    try {
      if (exportFormat === "html") {
        await exportAsHTML(editor, title);
      } else {
        await exportAsPDF(editor, title, { paperSize });
      }
      closeExportDialog();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      console.error("[Baram Export]", message);
      setErrorMsg(message);
      setExporting(false);
    }
  }, [editor, exportFormat, title, paperSize, exporting, closeExportDialog]);

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

  return (
    <div className="export-dialog-overlay" onClick={closeExportDialog}>
      <div
        className="export-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="export-dialog-header">
          <span className="export-dialog-title">Export Document</span>
          <button
            className="export-dialog-close"
            onClick={closeExportDialog}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="export-dialog-body">
          <div className="export-dialog-field">
            <label className="export-dialog-label">Format</label>
            <div className="export-format-tabs">
              <button
                className={`export-format-tab ${exportFormat === "html" ? "export-format-tab-active" : ""}`}
                onClick={() => openExportDialog("html")}
              >
                HTML
              </button>
              <button
                className={`export-format-tab ${exportFormat === "pdf" ? "export-format-tab-active" : ""}`}
                onClick={() => openExportDialog("pdf")}
              >
                PDF
              </button>
            </div>
          </div>

          <div className="export-dialog-field">
            <label className="export-dialog-label" htmlFor="export-title">
              Title
            </label>
            <input
              ref={titleInputRef}
              id="export-title"
              className="export-dialog-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {exportFormat === "pdf" && (
            <div className="export-dialog-field">
              <label className="export-dialog-label">Paper Size</label>
              <div className="export-format-tabs">
                <button
                  className={`export-format-tab ${paperSize === "a4" ? "export-format-tab-active" : ""}`}
                  onClick={() => setPaperSize("a4")}
                >
                  A4
                </button>
                <button
                  className={`export-format-tab ${paperSize === "letter" ? "export-format-tab-active" : ""}`}
                  onClick={() => setPaperSize("letter")}
                >
                  Letter
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="export-dialog-error">{errorMsg}</div>
          )}
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
            onClick={handleExport}
            disabled={exporting || !title.trim()}
          >
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
