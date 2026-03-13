// §56c Memories View — right panel component
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import { getBacklinks, listDir, readFile, writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";
import { getFirstDayOfWeek, getMonthDays } from "../../utils/journal";
import {
  extractDiarySection,
  extractOneLine,
  renderSimpleMarkdown,
  updateOneLineFrontmatter,
} from "../../utils/journal-memories";

type MemoriesMode = "full" | "oneline";
type MemoriesTab = "journal" | "notes";

interface MemoryEntry {
  diaryContent: string;
  fullContent: string;
  isCurrentYear: boolean;
  oneLine: string;
  path: string;
  year: number;
}

export function MemoriesPanel() {
  const { rightPanelOpen, rightPanelMode } = useUIStore();
  const activeTab = useSettingsStore((s) => s.memoriesTab) as MemoriesTab;
  const setActiveTab = useSettingsStore((s) => s.setMemoriesTab);
  const mode = useSettingsStore((s) => s.memoriesMode);
  const setMode = useSettingsStore((s) => s.setMemoriesMode);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showCalendar, setShowCalendar] = useState(false);

  if (!rightPanelOpen || rightPanelMode !== "memories") return null;

  const month = selectedDate.getMonth() + 1;
  const day = selectedDate.getDate();

  const isToday = (() => {
    const now = new Date();
    return (
      selectedDate.getFullYear() === now.getFullYear() &&
      selectedDate.getMonth() === now.getMonth() &&
      selectedDate.getDate() === now.getDate()
    );
  })();

  const navigateDay = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d);
  };

  // Ensure activeTab is valid after Photos tab removal
  const safeTab: MemoriesTab =
    activeTab === "journal" || activeTab === "notes" ? activeTab : "journal";

  const TABS: { id: MemoriesTab; label: string }[] = [
    { id: "journal", label: "Journal" },
    { id: "notes", label: "Notes" },
  ];

  return (
    <div className="memories-panel">
      <div className="memories-header">
        <span className="memories-header-title">Memories</span>
        <div className="memories-date-nav">
          <button
            className="memories-date-nav-btn"
            onClick={() => navigateDay(-1)}
            title="이전 날"
          >
            <svg
              fill="none"
              height="12"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
              width="12"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            className={`memories-date-nav-label ${showCalendar ? "memories-date-nav-label-active" : ""}`}
            onClick={() => setShowCalendar(!showCalendar)}
            title="캘린더 열기"
          >
            {month}월 {day}일
            {isToday && <span className="memories-date-nav-today">오늘</span>}
          </button>
          <button
            className="memories-date-nav-btn"
            onClick={() => navigateDay(1)}
            title="다음 날"
          >
            <svg
              fill="none"
              height="12"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
              width="12"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      {showCalendar && (
        <MiniCalendar
          onClose={() => setShowCalendar(false)}
          onSelect={(d) => {
            setSelectedDate(d);
            setShowCalendar(false);
          }}
          selectedDate={selectedDate}
        />
      )}

      <div className="memories-tabs">
        {TABS.map((tab) => (
          <button
            className={`memories-tabs-btn ${safeTab === tab.id ? "memories-tabs-btn-active" : ""}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="memories-content">
        {safeTab === "journal" && (
          <JournalTab
            day={day}
            loading={loading}
            memories={memories}
            mode={mode}
            month={month}
            setLoading={setLoading}
            setMemories={setMemories}
            setMode={setMode}
          />
        )}
        {safeTab === "notes" && <NotesTab />}
      </div>
    </div>
  );
}

/** Resolve relative image src attributes in rendered HTML to Tauri asset protocol URLs */
function resolveImageSrcs(html: string, fileDir: string): string {
  return html.replace(/<img([^>]*) src="([^"]+)"/g, (_match, before, src) => {
    // Skip absolute URLs and data URIs
    if (
      src.startsWith("http://") ||
      src.startsWith("https://") ||
      src.startsWith("data:")
    ) {
      return `<img${before} src="${src}"`;
    }
    // Resolve relative path against journal file's directory
    const cleanSrc = src.startsWith("./") ? src.slice(2) : src;
    const absolutePath = cleanSrc.startsWith("/")
      ? cleanSrc
      : `${fileDir}/${cleanSrc}`;
    return `<img${before} src="${convertFileSrc(absolutePath)}"`;
  });
}

/** Resolve journal base path, handling absolute journalDirectory */
function resolveJournalBase(rootPath: string, journalDir: string): string {
  if (journalDir.startsWith("/") || /^[A-Z]:\\/i.test(journalDir)) {
    return journalDir;
  }
  return `${rootPath}/${journalDir}`;
}

// --- MiniCalendar ---

const MINI_CAL_DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const MINI_CAL_MONTH_NAMES = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
];

type CalendarView = "days" | "months" | "years";

interface JournalTabProps {
  day: number;
  loading: boolean;
  memories: MemoryEntry[];
  mode: MemoriesMode;
  month: number;
  setLoading: (l: boolean) => void;
  setMemories: (m: MemoryEntry[]) => void;
  setMode: (m: MemoriesMode) => void;
}

interface MiniCalendarProps {
  onClose: () => void;
  onSelect: (date: Date) => void;
  selectedDate: Date;
}

// --- Journal Tab ---

interface NoteEntry {
  backlinkCount: number;
  modifiedAt: number; // epoch ms
  name: string;
  path: string;
  preview: string;
  tags: string[];
}

interface NoteFolder {
  fileCount: number;
  name: string;
  path: string;
}

// --- OneLineEditor (inline editing for current year) ---

/** Extract #tags from markdown content (skip headings and code blocks) */
function extractTags(content: string): string[] {
  const tags = new Set<string>();
  // Match #tag patterns (word chars + hyphens), but not inside headings
  const tagRegex =
    /(?:^|\s)#([a-zA-Z\uAC00-\uD7AF\u3131-\u3163\u1100-\u11FF][\w\u3131-\u3163\uAC00-\uD7AF-]*)/g;
  // Strip frontmatter and code blocks first
  const stripped = content
    .replace(/^---\n[\s\S]*?\n---/, "")
    .replace(/```[\s\S]*?```/g, "");
  // Skip heading lines
  for (const line of stripped.split("\n")) {
    if (line.trim().startsWith("#") && line.trim().match(/^#{1,6}\s/)) continue;
    let m;
    while ((m = tagRegex.exec(line)) !== null) {
      tags.add(m[1]);
    }
  }
  return [...tags];
}

// --- Notes Tab ---

/** Format a timestamp as relative time (e.g. "2시간 전", "3일 전") */
function formatRelativeTime(epochMs: number): string {
  if (!epochMs) return "";
  const diff = Date.now() - epochMs;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}개월 전`;
  return `${Math.floor(months / 12)}년 전`;
}

function JournalTab({
  memories,
  setMemories,
  mode,
  setMode,
  loading,
  setLoading,
  month,
  day,
}: JournalTabProps) {
  const { rootPath } = useFileStore();
  const { journalDirectory } = useSettingsStore();

  const loadMemories = useCallback(async () => {
    if (!rootPath || !journalDirectory) return;
    setLoading(true);

    try {
      const base = resolveJournalBase(rootPath, journalDirectory);
      const dailyDir = `${base}/daily`;
      const yearDirs = await listDir(dailyDir);
      const currentYear = new Date().getFullYear();
      const mm = String(month).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      const entries: MemoryEntry[] = [];

      for (const yearDir of yearDirs) {
        if (!yearDir.isDir) continue;
        const year = parseInt(yearDir.name, 10);
        if (isNaN(year)) continue;

        const filePath = `${dailyDir}/${year}/${mm}/${year}-${mm}-${dd}.md`;
        try {
          const content = await readFile(filePath);
          entries.push({
            year,
            path: filePath,
            oneLine: extractOneLine(content),
            diaryContent: extractDiarySection(content),
            fullContent: content,
            isCurrentYear: year === currentYear,
          });
        } catch {
          // File doesn't exist for this year — skip
        }
      }

      entries.sort((a, b) => b.year - a.year);
      setMemories(entries);
    } catch {
      // IPC not available or dir doesn't exist
    } finally {
      setLoading(false);
    }
  }, [rootPath, journalDirectory, month, day, setMemories, setLoading]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const handleOpenEntry = (path: string) => {
    const { tabs } = useEditorStore.getState();
    const existing = tabs.find((t) => t.filePath === path);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
    } else {
      readFile(path)
        .then((content) => {
          const fileName = path.split("/").pop() ?? "Unknown";
          useFileStore.getState().setFileContent(path, content);
          useEditorStore.getState().openTab({
            id: crypto.randomUUID(),
            filePath: path,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
        })
        .catch(() => {});
    }
  };

  return (
    <div className="memories-journal-tab">
      <div className="memories-mode-toggle">
        <button
          className={`memories-mode-btn ${mode === "oneline" ? "memories-mode-btn-active" : ""}`}
          onClick={() => setMode("oneline")}
        >
          One Line
        </button>
        <button
          className={`memories-mode-btn ${mode === "full" ? "memories-mode-btn-active" : ""}`}
          onClick={() => setMode("full")}
        >
          Full
        </button>
      </div>

      {loading && <div className="memories-loading">Loading...</div>}

      {!loading && memories.length === 0 && (
        <div className="memories-empty">이 날짜의 기록이 없습니다.</div>
      )}

      {memories.map((entry) => (
        <div
          className={`memories-year-card ${entry.isCurrentYear ? "memories-year-card-current" : ""}`}
          key={entry.year}
        >
          <div className="memories-year-card-header">
            <span className="memories-year-card-year">
              {entry.year}
              {entry.isCurrentYear && (
                <span className="memories-year-card-badge">오늘</span>
              )}
            </span>
            <button
              className="memories-year-card-open"
              onClick={() => handleOpenEntry(entry.path)}
              title="일기 열기"
            >
              <svg
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="14"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" x2="21" y1="14" y2="3" />
              </svg>
            </button>
          </div>
          <div className="memories-year-card-body">
            {mode === "oneline" ? (
              entry.isCurrentYear ? (
                <OneLineEditor
                  entry={entry}
                  onSave={(newText) => {
                    const updated = updateOneLineFrontmatter(
                      entry.fullContent,
                      newText,
                    );
                    writeFile(entry.path, updated)
                      .then(() => {
                        setMemories(
                          memories.map((m) =>
                            m.year === entry.year
                              ? { ...m, oneLine: newText, fullContent: updated }
                              : m,
                          ),
                        );
                      })
                      .catch(() => {});
                  }}
                />
              ) : (
                <div
                  className="memories-oneline memories-md-render"
                  dangerouslySetInnerHTML={{
                    __html: resolveImageSrcs(
                      renderSimpleMarkdown(entry.oneLine) ||
                        "<p>(내용 없음)</p>",
                      entry.path.substring(0, entry.path.lastIndexOf("/")),
                    ),
                  }}
                />
              )
            ) : (
              <div
                className="memories-full memories-md-render"
                dangerouslySetInnerHTML={{
                  __html: resolveImageSrcs(
                    renderSimpleMarkdown(entry.diaryContent) ||
                      "<p>(내용 없음)</p>",
                    entry.path.substring(0, entry.path.lastIndexOf("/")),
                  ),
                }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniCalendar({ selectedDate, onSelect, onClose }: MiniCalendarProps) {
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
  const [view, setView] = useState<CalendarView>("days");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const days = getMonthDays(viewYear, viewMonth);
  const firstDow = getFirstDayOfWeek(viewYear, viewMonth);
  const today = new Date();

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  // Years view: 12-year range centered on current viewYear
  const yearRangeStart = viewYear - (viewYear % 12);
  const yearRange = Array.from({ length: 12 }, (_, i) => yearRangeStart + i);

  const navPrev = () => {
    if (view === "days") {
      if (viewMonth === 0) {
        setViewYear(viewYear - 1);
        setViewMonth(11);
      } else setViewMonth(viewMonth - 1);
    } else if (view === "months") {
      setViewYear(viewYear - 1);
    } else {
      setViewYear(yearRangeStart - 12);
    }
  };

  const navNext = () => {
    if (view === "days") {
      if (viewMonth === 11) {
        setViewYear(viewYear + 1);
        setViewMonth(0);
      } else setViewMonth(viewMonth + 1);
    } else if (view === "months") {
      setViewYear(viewYear + 1);
    } else {
      setViewYear(yearRangeStart + 12);
    }
  };

  const headerLabel =
    view === "days" ? (
      <>
        <button
          className="memories-mini-calendar-title-btn"
          onClick={() => setView("months")}
        >
          {MINI_CAL_MONTH_NAMES[viewMonth]}
        </button>{" "}
        <button
          className="memories-mini-calendar-title-btn"
          onClick={() => setView("years")}
        >
          {viewYear}
        </button>
      </>
    ) : view === "months" ? (
      <button
        className="memories-mini-calendar-title-btn"
        onClick={() => setView("years")}
      >
        {viewYear}년
      </button>
    ) : (
      <span className="memories-mini-calendar-title-text">
        {yearRangeStart}–{yearRangeStart + 11}
      </span>
    );

  return (
    <div className="memories-mini-calendar" ref={ref}>
      <div className="memories-mini-calendar-header">
        <button className="memories-mini-calendar-nav" onClick={navPrev}>
          ‹
        </button>
        <span className="memories-mini-calendar-title">{headerLabel}</span>
        <button className="memories-mini-calendar-nav" onClick={navNext}>
          ›
        </button>
      </div>

      {view === "days" && (
        <div className="memories-mini-calendar-grid">
          {MINI_CAL_DAY_NAMES.map((d) => (
            <div className="memories-mini-calendar-dow" key={d}>
              {d}
            </div>
          ))}
          {Array.from({ length: firstDow }).map((_, i) => (
            <div className="memories-mini-calendar-pad" key={`pad-${i}`} />
          ))}
          {days.map((d) => {
            const isSelected = isSameDay(d, selectedDate);
            const isToday = isSameDay(d, today);
            return (
              <button
                className={[
                  "memories-mini-calendar-day",
                  isSelected ? "memories-mini-calendar-day-selected" : "",
                  isToday ? "memories-mini-calendar-day-today" : "",
                ].join(" ")}
                key={d.getDate()}
                onClick={() => onSelect(d)}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      )}

      {view === "months" && (
        <div className="memories-mini-calendar-picker">
          {MINI_CAL_MONTH_NAMES.map((name, i) => (
            <button
              className={`memories-mini-calendar-pick-btn ${i === viewMonth && viewYear === selectedDate.getFullYear() ? "memories-mini-calendar-pick-btn-selected" : ""} ${i === today.getMonth() && viewYear === today.getFullYear() ? "memories-mini-calendar-pick-btn-today" : ""}`}
              key={i}
              onClick={() => {
                setViewMonth(i);
                setView("days");
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {view === "years" && (
        <div className="memories-mini-calendar-picker">
          {yearRange.map((y) => (
            <button
              className={`memories-mini-calendar-pick-btn ${y === selectedDate.getFullYear() ? "memories-mini-calendar-pick-btn-selected" : ""} ${y === today.getFullYear() ? "memories-mini-calendar-pick-btn-today" : ""}`}
              key={y}
              onClick={() => {
                setViewYear(y);
                setView("months");
              }}
            >
              {y}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotesTab() {
  const { rootPath } = useFileStore();
  const { journalDirectory } = useSettingsStore();
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [currentSubdir, setCurrentSubdir] = useState<null | string>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeTag, setActiveTag] = useState<null | string>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const newNameRef = useRef<HTMLInputElement>(null);

  const loadNotes = useCallback(
    async (notesDir: string, cancelled: { v: boolean }) => {
      const entries = await listDir(notesDir);
      if (cancelled.v) return;

      // Collect subdirectories
      const subDirs = entries.filter((e: { isDir: boolean }) => e.isDir);
      const folderList: NoteFolder[] = await Promise.all(
        subDirs.map(async (d: { name: string; path: string }) => {
          let fileCount = 0;
          try {
            const sub = await listDir(d.path);
            fileCount = sub.filter(
              (s: { isDir: boolean; name: string }) =>
                !s.isDir && s.name.endsWith(".md"),
            ).length;
          } catch {
            /* skip */
          }
          return { name: d.name, path: d.path, fileCount };
        }),
      );

      const mdFiles = entries
        .filter(
          (e: { isDir: boolean; name: string }) =>
            !e.isDir && e.name.endsWith(".md"),
        )
        .map((e: { modifiedAt?: number; name: string }) => ({
          name: e.name.replace(/\.md$/, ""),
          path: `${notesDir}/${e.name}`,
          modifiedAt: (e.modifiedAt ?? 0) * 1000,
        }));

      // Read content + backlinks in parallel
      const enriched: NoteEntry[] = await Promise.all(
        mdFiles.map(async (f) => {
          let content = "";
          let backlinkCount = 0;
          try {
            content = await readFile(f.path);
          } catch {
            /* skip */
          }
          try {
            const bl = await getBacklinks(f.path);
            backlinkCount = bl.length;
          } catch {
            /* skip */
          }
          return {
            name: f.name,
            path: f.path,
            preview: extractOneLine(content),
            tags: extractTags(content),
            backlinkCount,
            modifiedAt: f.modifiedAt,
          };
        }),
      );

      if (!cancelled.v) {
        // Sort by modification time desc (most recent first)
        enriched.sort((a, b) => b.modifiedAt - a.modifiedAt);
        setNotes(enriched);
        setFolders(
          folderList
            .filter((f) => f.fileCount > 0)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
    },
    [],
  );

  useEffect(() => {
    if (!rootPath || !journalDirectory) return;
    const cancelled = { v: false };
    setLoading(true);
    (async () => {
      try {
        const base = resolveJournalBase(rootPath, journalDirectory);
        const notesDir = currentSubdir ?? `${base}/notes`;
        await loadNotes(notesDir, cancelled);
      } catch {
        if (!cancelled.v) {
          setNotes([]);
          setFolders([]);
        }
      } finally {
        if (!cancelled.v) setLoading(false);
      }
    })();
    return () => {
      cancelled.v = true;
    };
  }, [rootPath, journalDirectory, currentSubdir, loadNotes]);

  // All tags with frequency counts, sorted by frequency desc
  const allTags = useMemo(() => {
    const tagCount = new Map<string, number>();
    for (const n of notes)
      for (const t of n.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    return [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  }, [notes]);

  // Filtered notes
  const filtered = useMemo(() => {
    let result = notes;
    if (activeTag) {
      result = result.filter((n) => n.tags.includes(activeTag));
    }
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      result = result.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.preview.toLowerCase().includes(q),
      );
    }
    return result;
  }, [notes, filter, activeTag]);

  const handleOpenNote = (path: string) => {
    const { tabs } = useEditorStore.getState();
    const existing = tabs.find((t) => t.filePath === path);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
    } else {
      readFile(path)
        .then((content) => {
          const fileName = path.split("/").pop() ?? "Unknown";
          useFileStore.getState().setFileContent(path, content);
          useEditorStore.getState().openTab({
            id: crypto.randomUUID(),
            filePath: path,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
        })
        .catch(() => {});
    }
  };

  const handleCreateNote = async () => {
    const name = newName.trim();
    if (!name || !rootPath || !journalDirectory) return;
    const base = resolveJournalBase(rootPath, journalDirectory);
    const notePath = `${base}/notes/${name}.md`;
    const content = `# ${name}\n\n`;
    try {
      await writeFile(notePath, content);
      useFileStore.getState().setFileContent(notePath, content);
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        filePath: notePath,
        title: `${name}.md`,
        isDirty: false,
        isPinned: false,
      });
      // Add to local list
      setNotes((prev) => [
        {
          name,
          path: notePath,
          preview: "",
          tags: [],
          backlinkCount: 0,
          modifiedAt: Date.now(),
        },
        ...prev,
      ]);
    } catch (err) {
      console.error("[NotesTab] Failed to create note:", err);
    }
    setCreating(false);
    setNewName("");
  };

  useEffect(() => {
    if (creating && newNameRef.current) newNameRef.current.focus();
  }, [creating]);

  return (
    <div className="memories-notes-tab">
      {/* Toolbar: search + create */}
      <div className="notes-toolbar">
        <div className="notes-search-wrap">
          <input
            className="notes-search-input"
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search notes..."
            type="text"
            value={filter}
          />
          {filter && (
            <button
              className="notes-search-clear"
              onClick={() => setFilter("")}
            >
              &times;
            </button>
          )}
        </div>
        <button
          className="notes-create-btn"
          onClick={() => setCreating(true)}
          title="New note"
        >
          +
        </button>
      </div>

      {/* New note input */}
      {creating && (
        <div className="notes-create-row">
          <input
            className="notes-create-input"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateNote();
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            placeholder="Note name..."
            ref={newNameRef}
            type="text"
            value={newName}
          />
          <button className="notes-create-confirm" onClick={handleCreateNote}>
            Create
          </button>
          <button
            className="notes-create-cancel"
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div className="notes-tag-bar">
          {activeTag && (
            <button
              className="notes-tag-chip notes-tag-chip-clear"
              onClick={() => setActiveTag(null)}
            >
              All
            </button>
          )}
          {allTags.map(({ tag, count }) => (
            <button
              className={`notes-tag-chip${activeTag === tag ? "notes-tag-chip-active" : ""}`}
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              #{tag}
              <span className="notes-tag-count">({count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Subfolder breadcrumb */}
      {currentSubdir && (
        <button
          className="notes-back-btn"
          onClick={() => setCurrentSubdir(null)}
        >
          ← notes/
        </button>
      )}

      {/* Subfolders */}
      {!currentSubdir && folders.length > 0 && !filter && (
        <div className="notes-folders">
          {folders.map((f) => (
            <button
              className="notes-folder-item"
              key={f.path}
              onClick={() => setCurrentSubdir(f.path)}
            >
              <svg
                className="notes-folder-icon"
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                width="14"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="notes-folder-name">{f.name}/</span>
              <span className="notes-folder-count">{f.fileCount}</span>
            </button>
          ))}
        </div>
      )}

      {loading && <div className="memories-loading">Loading...</div>}

      {!loading && filtered.length === 0 && (
        <div className="memories-empty">
          {notes.length === 0
            ? "캡처를 승격하면 노트가 여기에 표시됩니다."
            : "검색 결과가 없습니다."}
        </div>
      )}

      {/* Note cards */}
      {filtered.map((note) => (
        <button
          className="notes-card"
          key={note.path}
          onClick={() => handleOpenNote(note.path)}
          title={note.path}
        >
          <div className="notes-card-header">
            <span className="notes-card-name">{note.name}</span>
            {note.modifiedAt > 0 && (
              <span className="notes-card-time">
                {formatRelativeTime(note.modifiedAt)}
              </span>
            )}
            {note.backlinkCount > 0 && (
              <span
                className="notes-card-backlinks"
                title={`${note.backlinkCount} backlink${note.backlinkCount > 1 ? "s" : ""}`}
              >
                {note.backlinkCount}
              </span>
            )}
          </div>
          {note.preview && (
            <div className="notes-card-preview">{note.preview}</div>
          )}
          {note.tags.length > 0 && (
            <div className="notes-card-tags">
              {note.tags.map((t) => (
                <span className="notes-card-tag" key={t}>
                  #{t}
                </span>
              ))}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function OneLineEditor({
  entry,
  onSave,
}: {
  entry: MemoryEntry;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.oneLine);

  useEffect(() => {
    setDraft(entry.oneLine);
  }, [entry.oneLine]);

  if (!editing) {
    const fileDir = entry.path.substring(0, entry.path.lastIndexOf("/"));
    return (
      <div
        className="memories-oneline memories-oneline-editable memories-md-render"
        dangerouslySetInnerHTML={{
          __html: entry.oneLine
            ? resolveImageSrcs(renderSimpleMarkdown(entry.oneLine), fileDir)
            : "<p>(클릭하여 한 줄 요약 입력)</p>",
        }}
        onClick={() => setEditing(true)}
        title="클릭하여 편집"
      />
    );
  }

  return (
    <input
      autoFocus
      className="memories-oneline-input"
      onBlur={() => {
        setEditing(false);
        if (draft !== entry.oneLine) onSave(draft);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          setEditing(false);
          if (draft !== entry.oneLine) onSave(draft);
        } else if (e.key === "Escape") {
          setEditing(false);
          setDraft(entry.oneLine);
        }
      }}
      placeholder="한 줄 요약 입력..."
      value={draft}
    />
  );
}
