// §56f Journal Dynamic Code Block — renders journal-list / journal-photos
import { useCallback, useEffect, useState } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import { INTL_LOCALES } from "../../i18n";
import { useTranslation } from "../../i18n/useTranslation";
import { listDir, readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { basename } from "../../utils/path-utils";

export type JournalBlockLanguage = "journal-list" | "journal-photos";

export interface JournalDynamicBlockProps {
  content: string; // raw code block content (YAML-like params)
  language: JournalBlockLanguage;
  onShowSource: () => void;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

interface JournalListEntry {
  date: string;
  filePath: string;
  preview: string;
}

interface PhotoEntry {
  absolutePath: string;
  date: string;
  filename: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export function parseBlockParams(content: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) params[match[1]] = match[2].trim();
  }
  return params;
}

// eslint-disable-next-line react-refresh/only-export-components
export function parseRange(range: string): [string, string] | null {
  const m = range.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  return m ? [m[1], m[2]] : null;
}

// ---------------------------------------------------------------------------
// journal-list sub-component
// ---------------------------------------------------------------------------

/** Returns all YYYY-MM-DD dates in [start, end] inclusive */
function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  while (cur <= endDate) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function formatMonthLabel(start: string, end: string, intl: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return s.toLocaleDateString(intl, { year: "numeric", month: "long" });
  }
  return `${start} ~ ${end}`;
}

function JournalListBlock({ params }: { params: Record<string, string> }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<JournalListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const rootPath = useFileStore((s) => s.rootPath);
  const journalDirectory = useSettingsStore((s) => s.journalDirectory);

  useEffect(() => {
    if (!rootPath || !journalDirectory) {
      setLoading(false);
      return;
    }
    const range = params.range ? parseRange(params.range) : null;
    if (!range) {
      setLoading(false);
      return;
    }
    const [start, end] = range;
    const dates = datesInRange(start, end);

    (async () => {
      const results: JournalListEntry[] = [];
      for (const date of dates) {
        const [yyyy, mm] = date.split("-");
        const filePath = `${rootPath}/${journalDirectory}/daily/${yyyy}/${mm}/${date}.md`;
        try {
          const content = await readFile(filePath);
          // First non-empty, non-frontmatter line as preview
          const lines = content.split("\n");
          let preview = "";
          let inFrontmatter = false;
          let frontmatterDone = false;
          for (const line of lines) {
            if (!frontmatterDone && line.trim() === "---") {
              inFrontmatter = !inFrontmatter;
              if (!inFrontmatter) frontmatterDone = true;
              continue;
            }
            if (inFrontmatter) continue;
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#")) {
              preview = trimmed.replace(/[*_`[\]]/g, "").slice(0, 60);
              break;
            }
          }
          results.push({ date, preview, filePath });
        } catch {
          // File doesn't exist for this date — skip
        }
      }
      setEntries(results);
      setLoading(false);
    })();
  }, [rootPath, journalDirectory, params.range]);

  const openEntry = useCallback((filePath: string) => {
    const { tabs } = useEditorStore.getState();
    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
    } else {
      readFile(filePath)
        .then((content) => {
          const fileName = basename(filePath);
          useFileStore.getState().setFileContent(filePath, content);
          useEditorStore.getState().openTab({
            contextId: "",
            id: crypto.randomUUID(),
            filePath,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
        })
        .catch(() => {});
    }
  }, []);

  if (loading)
    return (
      <div aria-live="polite" className="journal-block-loading">
        {t("journal.loading")}
      </div>
    );
  if (entries.length === 0)
    return (
      <div className="journal-block-empty">{t("journal.block.empty")}</div>
    );

  return (
    <ul className="journal-list-items">
      {entries.map((entry) => (
        <li
          className="journal-list-item"
          key={entry.date}
          onClick={() => openEntry(entry.filePath)}
        >
          <span className="journal-list-date">{entry.date}</span>
          <span className="journal-list-preview">{entry.preview}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// journal-photos sub-component
// ---------------------------------------------------------------------------

function JournalPhotosBlock({ params }: { params: Record<string, string> }) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const rootPath = useFileStore((s) => s.rootPath);
  const journalDirectory = useSettingsStore((s) => s.journalDirectory);

  const layout = params.layout ?? "grid";
  const columns = parseInt(params.columns ?? "4", 10) || 4;

  useEffect(() => {
    if (!rootPath || !journalDirectory) {
      setLoading(false);
      return;
    }
    const range = params.range ? parseRange(params.range) : null;
    if (!range) {
      setLoading(false);
      return;
    }
    const [start, end] = range;

    (async () => {
      const results: PhotoEntry[] = [];
      const assetsBase = `${rootPath}/${journalDirectory}/assets`;
      try {
        const monthDirs = await listDir(assetsBase);
        for (const monthDir of monthDirs) {
          if (!monthDir.isDir) continue;
          // monthDir.name is YYYY-MM; construct first-day for range comparison
          const monthStart = `${monthDir.name}-01`;
          // Last day of month: set to next month day 0
          const [y, mo] = monthDir.name.split("-").map(Number);
          const lastDay = new Date(y, mo, 0).getDate();
          const monthEnd = `${monthDir.name}-${String(lastDay).padStart(2, "0")}`;
          // Skip months entirely outside range
          if (monthEnd < start || monthStart > end) continue;

          const dirPath = `${assetsBase}/${monthDir.name}`;
          const files = await listDir(dirPath);
          for (const file of files) {
            if (file.isDir) continue;
            if (!/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.name)) continue;

            // Parse date from filename: YYYYMMDD-...
            const dateMatch = file.name.match(/^(\d{4})(\d{2})(\d{2})/);
            let fileDate: string;
            if (dateMatch) {
              fileDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
            } else {
              fileDate = monthStart;
            }
            if (fileDate < start || fileDate > end) continue;

            results.push({
              filename: file.name,
              absolutePath: `${dirPath}/${file.name}`,
              date: fileDate,
            });
          }
        }
      } catch {
        // assets dir may not exist
      }
      // Sort by date ascending
      results.sort((a, b) => a.date.localeCompare(b.date));
      setPhotos(results);
      setLoading(false);
    })();
  }, [rootPath, journalDirectory, params.range]);

  if (loading)
    return (
      <div aria-live="polite" className="journal-block-loading">
        {t("journal.loading")}
      </div>
    );
  if (photos.length === 0)
    return (
      <div className="journal-block-empty">{t("journal.block.empty")}</div>
    );

  const gridStyle =
    layout === "strip"
      ? {
          gridTemplateColumns: `repeat(${photos.length}, 80px)`,
          overflowX: "auto" as const,
        }
      : { gridTemplateColumns: `repeat(${columns}, 1fr)` };

  return (
    <div className="journal-photos-grid" style={gridStyle}>
      {photos.map((photo) => (
        <img
          alt={photo.filename}
          className="journal-photos-thumb"
          key={photo.absolutePath}
          loading="lazy"
          src={convertFileSrc(photo.absolutePath)}
          title={`${photo.date} — ${photo.filename}`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/** i18n keys for the block header, keyed by the fence language. */
const BLOCK_TITLE_KEYS: Record<JournalBlockLanguage, string> = {
  "journal-list": "journal.block.list",
  "journal-photos": "journal.block.photos",
};

export function JournalDynamicBlock({
  language,
  content,
  onShowSource,
}: JournalDynamicBlockProps) {
  const { locale, t } = useTranslation();
  const params = parseBlockParams(content);
  const range = params.range ? parseRange(params.range) : null;

  const rangeLabel = range
    ? formatMonthLabel(range[0], range[1], INTL_LOCALES[locale])
    : (params.range ?? "");
  // `language` is the fence word (`journal-list`) and stays as the fallback: an unmapped
  // language is a document the user wrote, not a missing translation.
  const blockTitleKey = BLOCK_TITLE_KEYS[language];
  const headerTitle = `${blockTitleKey ? t(blockTitleKey) : language}: ${rangeLabel}`;

  return (
    <div className="journal-dynamic-block" contentEditable={false}>
      <div className="journal-dynamic-block-header">
        <span className="journal-dynamic-block-title">{headerTitle}</span>
        <button
          className="journal-dynamic-block-source-btn"
          onClick={onShowSource}
          title={t("journal.block.showSource")}
        >
          {"</>"}
        </button>
      </div>
      <div className="journal-dynamic-block-body">
        {language === "journal-list" && <JournalListBlock params={params} />}
        {language === "journal-photos" && (
          <JournalPhotosBlock params={params} />
        )}
      </div>
    </div>
  );
}
