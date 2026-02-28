// §56c Memories View — right panel component
import { useState, useEffect, useCallback } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useEditorStore } from "../../stores/editor-store";
import { extractOneLine } from "../../utils/journal-memories";
import { listDir, readFile } from "../../ipc/invoke";

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
  const [activeTab, setActiveTab] = useState<MemoriesTab>("journal");
  const [mode, setMode] = useState<MemoriesMode>("oneline");
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
              <p className="memories-oneline">
                {entry.oneLine || "(내용 없음)"}
              </p>
            ) : (
              <pre className="memories-full">{entry.fullContent}</pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Photos Tab (placeholder) ---

function PhotosTab() {
  return (
    <div className="memories-photos-tab">
      <div className="memories-empty">
        사진 기능은 다음 업데이트에서 지원됩니다.
      </div>
    </div>
  );
}

// --- Notes Tab (placeholder) ---

function NotesTab() {
  return (
    <div className="memories-notes-tab">
      <div className="memories-empty">
        노트 탐색 기능은 다음 업데이트에서 지원됩니다.
      </div>
    </div>
  );
}
