// §56c NotesTab — notes browsing tab for MemoriesPanel
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getBacklinks, listDir, readFile, writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { extractOneLine } from "../../utils/journal-memories";
import { logger } from "../../utils/logger";
import { resolveJournalBase } from "./utils";

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

export function NotesTab() {
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
      logger.error("[NotesTab] Failed to create note:", err);
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
