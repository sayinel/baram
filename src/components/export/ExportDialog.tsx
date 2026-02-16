// §5.12 Export Dialog — HTML/PDF export with format selection
import { useState, useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { useUIStore } from "../../stores/ui-store";
import { exportAsHTML, exportAsPDF } from "../../utils/export";

interface ExportDialogProps {
  editor: Editor | null;
}

export function ExportDialog({ editor }: ExportDialogProps) {
  const { exportDialogOpen, exportFormat, closeExportDialog, openExportDialog } =
    useUIStore();
  const [title, setTitle] = useState("Untitled");
  const [exporting, setExporting] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Reset title when dialog opens
  useEffect(() => {
    if (exportDialogOpen) {
      setTitle("Untitled");
      setExporting(false);
      setTimeout(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      }, 0);
    }
  }, [exportDialogOpen]);

  const handleExport = useCallback(async () => {
    if (!editor || exporting) return;
    setExporting(true);
    try {
      if (exportFormat === "html") {
        await exportAsHTML(editor, title);
      } else {
        await exportAsPDF(editor, title);
      }
      closeExportDialog();
    } catch (err) {
      console.error("[Baram Export]", err);
      setExporting(false);
    }
  }, [editor, exportFormat, title, exporting, closeExportDialog]);

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
