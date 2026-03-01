// §56c Memories View — right panel component
import { useState, useEffect, useCallback } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useEditorStore } from "../../stores/editor-store";
import { extractOneLine, extractImages, updateOneLineFrontmatter } from "../../utils/journal-memories";
import { listDir, readFile, writeFile } from "../../ipc/invoke";

type MemoriesTab = "journal" | "photos" | "notes";
type MemoriesMode = "oneline" | "full";

interface MemoryEntry {
  year: number;
  path: string;
  oneLine: string;
  fullContent: string;
  isCurrentYear: boolean;
}

export function MemoriesPanel() {
  const { rightPanelOpen, rightPanelMode } = useUIStore();
  const activeTab = useSettingsStore((s) => s.memoriesTab);
  const setActiveTab = useSettingsStore((s) => s.setMemoriesTab);
  const mode = useSettingsStore((s) => s.memoriesMode);
  const setMode = useSettingsStore((s) => s.setMemoriesMode);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  if (!rightPanelOpen || rightPanelMode !== "memories") return null;

  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const TABS: { id: MemoriesTab; label: string }[] = [
    { id: "journal", label: "Journal" },
    { id: "photos", label: "Photos" },
    { id: "notes", label: "Notes" },
  ];

  return (
    <div className="memories-panel">
      <div className="memories-panel-header">
        <h3 className="memories-panel-title">
          Memories: {month}월 {day}일
        </h3>
        <div className="memories-panel-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`memories-tab-btn ${activeTab === tab.id ? "memories-tab-btn-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="memories-panel-content">
        {activeTab === "journal" && (
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
        {activeTab === "photos" && <PhotosTab />}
        {activeTab === "notes" && <NotesTab />}
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
      const dailyDir = `${rootPath}/${journalDirectory}/daily`;
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
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as MemoriesMode)}
          className="memories-mode-select"
        >
          <option value="oneline">One Line</option>
          <option value="full">Full</option>
        </select>
      </div>

      {loading && <div className="memories-loading">Loading...</div>}

      {!loading && memories.length === 0 && (
        <div className="memories-empty">
          이 날짜의 기록이 없습니다.
        </div>
      )}

      {memories.map((entry) => (
        <div key={entry.year} className="memories-year-entry">
          <div className="memories-year-header">
            <span className="memories-year-label">
              {entry.year}
              {entry.isCurrentYear && " (오늘)"}
            </span>
            <button
              className="memories-open-btn"
              onClick={() => handleOpenEntry(entry.path)}
              title="일기 열기"
            >
              →
            </button>
          </div>
          <div className="memories-year-content">
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
                <p className="memories-oneline">
                  {entry.oneLine || "(내용 없음)"}
                </p>
              )
            ) : (
              <pre className="memories-full">{entry.fullContent}</pre>
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
    return (
      <p
        className="memories-oneline memories-oneline-editable"
        onClick={() => setEditing(true)}
        title="클릭하여 편집"
      >
        {entry.oneLine || "(클릭하여 한 줄 요약 입력)"}
      </p>
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

// --- Photos Tab ---

interface PhotoEntry {
  year: number;
  alt: string;
  src: string;
  journalPath: string;
}

function PhotosTab() {
  const { rootPath } = useFileStore();
  const { journalDirectory } = useSettingsStore();
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  useEffect(() => {
    if (!rootPath || !journalDirectory) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const dailyDir = `${rootPath}/${journalDirectory}/daily`;
        const yearDirs = await listDir(dailyDir);
        const mm = String(month).padStart(2, "0");
        const dd = String(day).padStart(2, "0");
        const allPhotos: PhotoEntry[] = [];

        for (const yearDir of yearDirs) {
          if (!yearDir.isDir) continue;
          const year = parseInt(yearDir.name, 10);
          if (isNaN(year)) continue;

          const filePath = `${dailyDir}/${year}/${mm}/${year}-${mm}-${dd}.md`;
          try {
            const content = await readFile(filePath);
            const images = extractImages(content);
            for (const img of images) {
              // Resolve relative paths against journal file directory
              const resolvedSrc = img.src.startsWith("/") || img.src.startsWith("http")
                ? img.src
                : `${dailyDir}/${year}/${mm}/${img.src}`;
              allPhotos.push({ year, alt: img.alt, src: resolvedSrc, journalPath: filePath });
            }
          } catch {
            // File doesn't exist for this year
          }
        }

        if (!cancelled) {
          allPhotos.sort((a, b) => b.year - a.year);
          setPhotos(allPhotos);
        }
      } catch {
        if (!cancelled) setPhotos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rootPath, journalDirectory, month, day]);

  return (
    <div className="memories-photos-tab">
      {loading && <div className="memories-loading">Loading...</div>}

      {!loading && photos.length === 0 && (
        <div className="memories-empty">
          이 날짜의 사진이 없습니다.
        </div>
      )}

      <div className="memories-photos-grid">
        {photos.map((photo, i) => (
          <div key={`${photo.year}-${i}`} className="memories-photo-item">
            <img
              src={photo.src}
              alt={photo.alt || `${photo.year}년 사진`}
              className="memories-photo-img"
              loading="lazy"
            />
            <span className="memories-photo-year">{photo.year}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Notes Tab ---

interface NoteEntry {
  name: string;
  path: string;
  modifiedLabel: string;
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
        const notesDir = `${rootPath}/${journalDirectory}/notes`;
        const entries = await listDir(notesDir, true);
        if (cancelled) return;
        const noteFiles: NoteEntry[] = entries
          .filter((e) => !e.isDir && e.name.endsWith(".md"))
          .map((e) => ({
            name: e.name.replace(/\.md$/, ""),
            path: e.path,
            modifiedLabel: "",
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
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
          <span className="memories-note-icon">📄</span>
          <span className="memories-note-name">{note.name}</span>
        </button>
      ))}
    </div>
  );
}
