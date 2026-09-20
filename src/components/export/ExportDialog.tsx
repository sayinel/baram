// §5.12 Export Dialog — HTML/PDF/Notion + §55 Pandoc Extended Export
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { Translate } from "../../i18n/useTranslation";
import type { PandocInfo } from "../../ipc/types";
import type { ThemeInExport } from "../../utils/export/export";
import type { ExportFormatGroup } from "./ExportFormatDropdown";
import type { Editor } from "@tiptap/react";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { detectPandoc } from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { lookupThemes } from "../../themes/installed-theme-defs";
import { findThemeById, resolveThemeMode } from "../../types/theme";
import {
  exportAsHTML,
  exportAsPDF,
  exportForNotion,
  exportWithPandoc,
} from "../../utils/export/export";
import {
  hasEmbeddingContext,
  pandocEmbedsImages,
} from "../../utils/export/pandoc-image-policy";
import { logger } from "../../utils/logger";
import { ExportFormatDropdown } from "./ExportFormatDropdown";

interface ExportDialogProps {
  editor: Editor | null;
}

const FORMAT_GROUPS: ExportFormatGroup[] = [
  {
    label: "인쇄",
    options: [
      {
        id: "pdf",
        ext: ".pdf",
        name: "PDF",
        desc: "Print-ready document",
        pandoc: false,
      },
    ],
  },
  {
    label: "웹",
    options: [
      {
        id: "html",
        ext: ".html",
        name: "HTML",
        desc: "Standalone page",
        pandoc: false,
      },
    ],
  },
  {
    label: "마크다운",
    options: [
      {
        id: "notion",
        ext: ".md",
        name: "Notion",
        desc: "Notion-compatible Markdown",
        pandoc: false,
      },
    ],
  },
  {
    label: "문서 (Pandoc)",
    options: [
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
    ],
  },
];

const PANDOC_FORMATS = ["docx", "latex", "epub", "rst"] as const;

export function ExportDialog({ editor }: ExportDialogProps) {
  const {
    exportDialogOpen,
    exportFormat,
    closeExportDialog,
    openExportDialog,
  } = useUIStore(
    useShallow((s) => ({
      exportDialogOpen: s.exportDialogOpen,
      exportFormat: s.exportFormat,
      closeExportDialog: s.closeExportDialog,
      openExportDialog: s.openExportDialog,
    })),
  );
  const { activeTabId, tabs } = useEditorStore(
    useShallow((s) => ({ activeTabId: s.activeTabId, tabs: s.tabs })),
  );
  const { contexts } = useContextStore(
    useShallow((s) => ({ contexts: s.contexts })),
  );
  const { t } = useTranslation();
  // issue 631: what the notice after an embedding export would say about
  // the note is worth saying before it. An unsaved note has no folder for
  // its relative images to resolve against; a saved one that no open vault
  // or folder holds (a lone file opened on its own) has none the export may
  // read from — the same rule the policy applies. Only for the formats that
  // embed: LaTeX and RST write references, so neither changes anything.
  const embeddingHint = ((): null | string => {
    if (!isPandocFormat(exportFormat) || !pandocEmbedsImages(exportFormat)) {
      return null;
    }
    const filePath = tabs.find((tab) => tab.id === activeTabId)?.filePath;
    if (!filePath) return "export.unsavedNote";
    return hasEmbeddingContext(filePath, contexts)
      ? null
      : "export.unscopedNote";
  })();
  const {
    activeThemeId,
    codeFontFamily,
    customThemes,
    fontFamily,
    installedThemes,
    pandocPath,
    wordTemplatePath,
    setWordTemplatePath,
    themeInExport,
    setThemeInExport,
  } = useSettingsStore(
    useShallow((s) => ({
      activeThemeId: s.activeThemeId,
      codeFontFamily: s.codeFontFamily,
      customThemes: s.customThemes,
      fontFamily: s.fontFamily,
      installedThemes: s.installedThemes,
      pandocPath: s.pandocPath,
      wordTemplatePath: s.wordTemplatePath,
      setWordTemplatePath: s.setWordTemplatePath,
      themeInExport: s.themeInExport,
      setThemeInExport: s.setThemeInExport,
    })),
  );
  // §362 — the palette `tokens` carries, resolved here rather than in
  // export.ts: the HTML/PDF export path (exportAsHTML/exportAsPDF) takes its
  // palette as an argument rather than reading the settings store itself
  // (export.ts's `ThemeExportOptions` doc states that for this path — the
  // module as a whole is not store-free; exportWithPandoc reads `locale`
  // directly). Mirrors ThemeEditor.tsx's `resolvedTheme`/`restorePreview` —
  // same lookup, same `resolveThemeMode` call, so a theme that resolves for
  // editing resolves the same way for export.
  const resolvedTheme = useMemo(
    () =>
      activeThemeId === "system"
        ? undefined
        : findThemeById(
            activeThemeId,
            lookupThemes(customThemes, installedThemes),
          ),
    [activeThemeId, customThemes, installedThemes],
  );
  const resolvedMode = useMemo(
    () =>
      resolvedTheme === undefined
        ? undefined
        : resolveThemeMode(
            resolvedTheme,
            window.matchMedia("(prefers-color-scheme: dark)").matches,
          ),
    [resolvedTheme],
  );
  const [title, setTitle] = useState("Untitled");
  const [exporting, setExporting] = useState(false);
  const [paperSize, setPaperSize] = useState<"a4" | "letter">("a4");
  const [scale, setScale] = useState(100);
  // §353 — HTML-only; PDF always embeds (embedFonts:true is fixed in exportAsPDF).
  const [embedFonts, setEmbedFonts] = useState(false);
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
      setEmbedFonts(false);
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
        await exportAsHTML(editor, title, {
          activeTheme: resolvedTheme,
          activeThemeMode: resolvedMode,
          bodyFont: fontFamily,
          codeFont: codeFontFamily,
          embedFonts,
          themeInExport,
        });
      } else if (exportFormat === "pdf") {
        await exportAsPDF(editor, title, {
          activeTheme: resolvedTheme,
          activeThemeMode: resolvedMode,
          paperSize,
          scale: scale / 100,
          bodyFont: fontFamily,
          codeFont: codeFontFamily,
          themeInExport,
        });
      } else if (exportFormat === "notion") {
        await exportForNotion(editor, title);
      } else if (isPandocFormat(exportFormat)) {
        // issue 545: relative images resolve against the document's own
        // directory; an unsaved document has none, and its relative images
        // become alt text.
        const activeTab = tabs.find((t) => t.id === activeTabId);
        await exportWithPandoc(editor, title, exportFormat, {
          documentPath: activeTab?.filePath || null,
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
    embedFonts,
    fontFamily,
    codeFontFamily,
    pandocPath,
    pandocInfo,
    wordTemplatePath,
    themeInExport,
    resolvedTheme,
    resolvedMode,
    exporting,
    closeExportDialog,
    tabs,
    activeTabId,
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
            <ExportFormatDropdown
              groups={FORMAT_GROUPS}
              onChange={(id) => openExportDialog(id)}
              pandocAvailable={pandocAvailable}
              value={exportFormat}
            />
            {!pandocAvailable && (
              <p className="export-pandoc-warning">
                ⚠ Install Pandoc for additional formats.{" "}
                <a
                  href="https://pandoc.org/installing.html"
                  rel="noreferrer"
                  style={{ color: "var(--color-accent-default)" }}
                  target="_blank"
                >
                  pandoc.org
                </a>
              </p>
            )}
          </div>

          {embeddingHint !== null && (
            <p className="export-dialog-hint">{t(embeddingHint)}</p>
          )}

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

          {exportFormat === "html" && (
            <div className="export-dialog-field">
              <label className="export-dialog-label export-dialog-checkbox-label">
                <input
                  checked={embedFonts}
                  onChange={(e) => setEmbedFonts(e.target.checked)}
                  type="checkbox"
                />
                {t("export.embedFonts")}
              </label>
              <p className="export-dialog-hint">
                {t("export.embedFonts.desc")}
              </p>
            </div>
          )}

          {exportFormat === "html" && (
            <ThemeInExportField
              onChange={setThemeInExport}
              t={t}
              value={themeInExport}
            />
          )}

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

          {exportFormat === "pdf" && (
            <ThemeInExportField
              onChange={setThemeInExport}
              t={t}
              value={themeInExport}
            />
          )}

          {exportFormat === "pdf" &&
            themeInExport === "tokens" &&
            resolvedMode === "dark" && (
              <p className="export-dialog-hint">
                {t("export.themeInExport.darkPrintHint")}
              </p>
            )}

          {exportFormat === "notion" && (
            <p className="export-dialog-hint">
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
            <p className="export-dialog-hint">
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

// §362 — shared between the HTML and PDF blocks: both formats carry the same
// persisted setting (setThemeInExport, not dialog-local state — see
// appearance-settings.ts). `"full"` is a valid `ThemeInExport` value but is
// not offered here (R4): this dialog exports one document, not a theme
// package, and only `default`/`tokens` are meaningful choices for that.
function ThemeInExportField({
  onChange,
  t,
  value,
}: {
  onChange: (value: ThemeInExport) => void;
  t: Translate;
  value: ThemeInExport;
}) {
  return (
    <div className="export-dialog-field">
      <label className="export-dialog-label" htmlFor="export-theme-in-export">
        Theme
      </label>
      <select
        className="export-dialog-select"
        id="export-theme-in-export"
        onChange={(e) => onChange(e.target.value as ThemeInExport)}
        value={value}
      >
        <option value="default">{t("export.themeInExport.default")}</option>
        <option value="tokens">{t("export.themeInExport.tokens")}</option>
      </select>
    </div>
  );
}
