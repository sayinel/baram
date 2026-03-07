// §56c Memories View — right panel component
import { useState, useEffect, useCallback, useRef } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useEditorStore } from "../../stores/editor-store";
import { extractOneLine, extractDiarySection, renderSimpleMarkdown, updateOneLineFrontmatter } from "../../utils/journal-memories";
import { getMonthDays, getFirstDayOfWeek } from "../../utils/journal";
import { listDir, readFile, writeFile } from "../../ipc/invoke";
import { convertFileSrc } from "@tauri-apps/api/core";

type MemoriesTab = "journal" | "notes";
type MemoriesMode = "oneline" | "full";

interface MemoryEntry {
  year: number;
  path: string;
  oneLine: string;
  diaryContent: string;
  fullContent: string;
  isCurrentYear: boolean;
}

/** Resolve relative image src attributes in rendered HTML to Tauri asset protocol URLs */
function resolveImageSrcs(html: string, fileDir: string): string {
  return html.replace(/<img([^>]*) src="([^"]+)"/g, (_match, before, src) => {
    // Skip absolute URLs and data URIs
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
      return `<img${before} src="${src}"`;
    }
    // Resolve relative path against journal file's directory
    const cleanSrc = src.startsWith("./") ? src.slice(2) : src;
    const absolutePath = cleanSrc.startsWith("/") ? cleanSrc : `${fileDir}/${cleanSrc}`;
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
    return selectedDate.getFullYear() === now.getFullYear() &&
      selectedDate.getMonth() === now.getMonth() &&
      selectedDate.getDate() === now.getDate();
  })();

  const navigateDay = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d);
  };

  // Ensure activeTab is valid after Photos tab removal
  const safeTab: MemoriesTab = activeTab === "journal" || activeTab === "notes" ? activeTab : "journal";

  const TABS: { id: MemoriesTab; label: string }[] = [
    { id: "journal", label: "Journal" },
    { id: "notes", label: "Notes" },
  ];

  return (
    <div className="memories-panel">
      <div className="memories-header">
        <span className="memories-header-title">Memories</span>
        <div className="memories-date-nav">
          <button className="memories-date-nav-btn" onClick={() => navigateDay(-1)} title="이전 날">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
          <button className="memories-date-nav-btn" onClick={() => navigateDay(1)} title="다음 날">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      {showCalendar && (
        <MiniCalendar
          selectedDate={selectedDate}
          onSelect={(d) => { setSelectedDate(d); setShowCalendar(false); }}
          onClose={() => setShowCalendar(false)}
        />
      )}

      <div className="memories-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`memories-tabs-btn ${safeTab === tab.id ? "memories-tabs-btn-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="memories-content">
        {safeTab === "journal" && (
          <JournalTab
            memories={memories}
            setMemories={setMemories}
            mode={mode}
            setMode={setMode}
            loading={loading}
            setLoading={setLoading}
            month={month}
            day={day}
          />
        )}
        {safeTab === "notes" && <NotesTab />}
      </div>
    </div>
  );
}

// --- MiniCalendar ---

const MINI_CAL_DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const MINI_CAL_MONTH_NAMES = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
];

interface MiniCalendarProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
}

function MiniCalendar({ selectedDate, onSelect, onClose }: MiniCalendarProps) {
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
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

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
  };

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  return (
    <div className="memories-mini-calendar" ref={ref}>
      <div className="memories-mini-calendar-header">
        <button className="memories-mini-calendar-nav" onClick={prevMonth}>‹</button>
        <span className="memories-mini-calendar-title">
          {viewYear}년 {MINI_CAL_MONTH_NAMES[viewMonth]}
        </span>
        <button className="memories-mini-calendar-nav" onClick={nextMonth}>›</button>
      </div>
      <div className="memories-mini-calendar-grid">
        {MINI_CAL_DAY_NAMES.map((d) => (
          <div key={d} className="memories-mini-calendar-dow">{d}</div>
        ))}
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`pad-${i}`} className="memories-mini-calendar-pad" />
        ))}
        {days.map((d) => {
          const isSelected = isSameDay(d, selectedDate);
          const isToday = isSameDay(d, today);
          return (
            <button
              key={d.getDate()}
              className={[
                "memories-mini-calendar-day",
                isSelected ? "memories-mini-calendar-day-selected" : "",
                isToday ? "memories-mini-calendar-day-today" : "",
              ].join(" ")}
              onClick={() => onSelect(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Journal Tab ---

interface JournalTabProps {
  memories: MemoryEntry[];
  setMemories: (m: MemoryEntry[]) => void;
  mode: MemoriesMode;
  setMode: (m: MemoriesMode) => void;
  loading: boolean;
  setLoading: (l: boolean) => void;
  month: number;
  day: number;
}

function JournalTab({ memories, setMemories, mode, setMode, loading, setLoading, month, day }: JournalTabProps) {
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
      readFile(path).then((content) => {
        const fileName = path.split("/").pop() ?? "Unknown";
        useFileStore.getState().setFileContent(path, content);
        useEditorStore.getState().openTab({
          id: crypto.randomUUID(),
          filePath: path,
          title: fileName,
          isDirty: false,
          isPinned: false,
        });
      }).catch(() => {});
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
        <div className="memories-empty">
          이 날짜의 기록이 없습니다.
        </div>
      )}

      {memories.map((entry) => (
        <div
          key={entry.year}
          className={`memories-year-card ${entry.isCurrentYear ? "memories-year-card-current" : ""}`}
        >
          <div className="memories-year-card-header">
            <span className="memories-year-card-year">
              {entry.year}
              {entry.isCurrentYear && <span className="memories-year-card-badge">오늘</span>}
            </span>
            <button
              className="memories-year-card-open"
              onClick={() => handleOpenEntry(entry.path)}
              title="일기 열기"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          </div>
          <div className="memories-year-card-body">
            {mode === "oneline" ? (
              entry.isCurrentYear ? (
                <OneLineEditor entry={entry} onSave={(newText) => {
                  const updated = updateOneLineFrontmatter(entry.fullContent, newText);
                  writeFile(entry.path, updated).then(() => {
                    setMemories(memories.map((m) =>
                      m.year === entry.year ? { ...m, oneLine: newText, fullContent: updated } : m
                    ));
                  }).catch(() => {});
                }} />
              ) : (
                <div
                  className="memories-oneline memories-md-render"
                  dangerouslySetInnerHTML={{
                    __html: resolveImageSrcs(
                      renderSimpleMarkdown(entry.oneLine) || "<p>(내용 없음)</p>",
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
                    renderSimpleMarkdown(entry.diaryContent) || "<p>(내용 없음)</p>",
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

// --- OneLineEditor (inline editing for current year) ---

function OneLineEditor({ entry, onSave }: { entry: MemoryEntry; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.oneLine);

  useEffect(() => { setDraft(entry.oneLine); }, [entry.oneLine]);

  if (!editing) {
    const fileDir = entry.path.substring(0, entry.path.lastIndexOf("/"));
    return (
      <div
        className="memories-oneline memories-oneline-editable memories-md-render"
        onClick={() => setEditing(true)}
        title="클릭하여 편집"
        dangerouslySetInnerHTML={{
          __html: entry.oneLine
            ? resolveImageSrcs(renderSimpleMarkdown(entry.oneLine), fileDir)
            : "<p>(클릭하여 한 줄 요약 입력)</p>",
        }}
      />
    );
  }

  return (
    <input
      className="memories-oneline-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== entry.oneLine) onSave(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          setEditing(false);
          if (draft !== entry.oneLine) onSave(draft);
        } else if (e.key === "Escape") {
          setEditing(false);
          setDraft(entry.oneLine);
        }
      }}
      autoFocus
      placeholder="한 줄 요약 입력..."
    />
  );
}

// --- Notes Tab ---

interface NoteEntry {
  name: string;
  path: string;
}

function NotesTab() {
  const { rootPath } = useFileStore();
  const { journalDirectory } = useSettingsStore();
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!rootPath || !journalDirectory) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const base = resolveJournalBase(rootPath, journalDirectory);
        const notesDir = `${base}/notes`;
        const entries = await listDir(notesDir);
        if (cancelled) return;
        const noteFiles: NoteEntry[] = entries
          .filter((e: { isDir: boolean; name: string }) => !e.isDir && e.name.endsWith(".md"))
          .map((e: { name: string }) => ({
            name: e.name.replace(/\.md$/, ""),
            path: `${notesDir}/${e.name}`,
          }))
          .sort((a: NoteEntry, b: NoteEntry) => a.name.localeCompare(b.name));
        setNotes(noteFiles);
      } catch {
        if (!cancelled) setNotes([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rootPath, journalDirectory]);

  const handleOpenNote = (path: string) => {
    const { tabs } = useEditorStore.getState();
    const existing = tabs.find((t) => t.filePath === path);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
    } else {
      readFile(path).then((content) => {
        const fileName = path.split("/").pop() ?? "Unknown";
        useFileStore.getState().setFileContent(path, content);
        useEditorStore.getState().openTab({
          id: crypto.randomUUID(),
          filePath: path,
          title: fileName,
          isDirty: false,
          isPinned: false,
        });
      }).catch(() => {});
    }
  };

  return (
    <div className="memories-notes-tab">
      {loading && <div className="memories-loading">Loading...</div>}

      {!loading && notes.length === 0 && (
        <div className="memories-empty">
          캡처를 승격하면 노트가 여기에 표시됩니다.
        </div>
      )}

      {notes.map((note) => (
        <button
          key={note.path}
          className="memories-note-item"
          onClick={() => handleOpenNote(note.path)}
          title={note.path}
        >
          <svg className="memories-note-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span className="memories-note-name">{note.name}</span>
        </button>
      ))}
    </div>
  );
}
