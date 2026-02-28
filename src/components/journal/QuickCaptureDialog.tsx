// §56l Quick Capture Dialog — Cmd+Shift+N
import { useState, useRef, useEffect, useCallback } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import {
  CAPTURE_TYPES,
  CAPTURE_ICONS,
  type CaptureType,
  type CaptureItem,
  insertCaptureIntoContent,
} from "../../utils/journal-capture";
import { getJournalFilePath, getHierarchicalJournalPath, resolveJournalDir, generateDefaultJournal, applyJournalTemplate } from "../../utils/journal";
import { readFile, writeFile, createDir } from "../../ipc/invoke";

export function QuickCaptureDialog() {
  const { quickCaptureOpen, quickCaptureType, toggleQuickCapture } = useUIStore();
  const [captureType, setCaptureType] = useState<CaptureType>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (quickCaptureOpen) {
      setCaptureType(quickCaptureType);
      setTitle("");
      setBody("");
      setUrl("");
      setTags("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [quickCaptureOpen, quickCaptureType]);

  const handleSave = useCallback(async () => {
    if (!body.trim() && !title.trim()) return;

    const item: CaptureItem = {
      type: captureType,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(body.trim() ? { body: body.trim() } : {}),
      ...(url.trim() && captureType === "link" ? { url: url.trim() } : {}),
      ...(tags.trim()
        ? { tags: tags.split(/\s+/).map((t) => t.replace(/^#/, "")).filter(Boolean) }
        : {}),
    };

    try {
      const { rootPath } = useFileStore.getState();
      const { journalDirectory, journalFilenameFormat, journalTemplatePath, journalUseHierarchy } =
        useSettingsStore.getState();

      if (!rootPath || !journalDirectory) return;

      const date = new Date();
      const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
      if (!resolvedDir) return;
      const journalPath = journalUseHierarchy
        ? getHierarchicalJournalPath(resolvedDir, date, journalFilenameFormat)
        : getJournalFilePath(rootPath, journalDirectory, date, journalFilenameFormat);
      if (!journalPath) return;

      // Ensure daily directory exists
      const dirPath = journalPath.substring(0, journalPath.lastIndexOf("/"));
      await createDir(dirPath).catch(() => {});

      // Read or create today's journal
      let content: string;
      try {
        content = await readFile(journalPath);
      } catch {
        // Journal doesn't exist — create it
        if (journalTemplatePath) {
          try {
            const tpl = await readFile(journalTemplatePath);
            content = applyJournalTemplate(tpl, date);
          } catch {
            content = generateDefaultJournal(date);
          }
        } else {
          content = generateDefaultJournal(date);
        }
      }

      // Insert capture and save
      const updated = insertCaptureIntoContent(content, item);
      await writeFile(journalPath, updated);

      // Update file-store cache
      useFileStore.getState().setFileContent(journalPath, updated);

      toggleQuickCapture();
    } catch (err) {
      console.error("[QuickCapture] Save failed:", err);
    }
  }, [captureType, title, body, url, tags, toggleQuickCapture]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        toggleQuickCapture();
      }
    },
    [handleSave, toggleQuickCapture],
  );

  if (!quickCaptureOpen) return null;

  return (
    <div className="quick-capture-overlay" onClick={toggleQuickCapture}>
      <div
        className="quick-capture-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="quick-capture-header">
          <h3>Quick Capture</h3>
        </div>

        {/* Type selector */}
        <div className="quick-capture-types">
          {CAPTURE_TYPES.map((type) => (
            <button
              key={type}
              className={`quick-capture-type-btn ${captureType === type ? "quick-capture-type-active" : ""}`}
              onClick={() => setCaptureType(type)}
            >
              {CAPTURE_ICONS[type]} {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>

        {/* Title (for idea/link) */}
        {(captureType === "idea" || captureType === "link") && (
          <input
            type="text"
            className="quick-capture-input"
            placeholder={captureType === "link" ? "링크 제목" : "아이디어 제목"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}

        {/* URL (for link) */}
        {captureType === "link" && (
          <input
            type="text"
            className="quick-capture-input"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}

        {/* Body */}
        <textarea
          ref={inputRef}
          className="quick-capture-textarea"
          placeholder={
            captureType === "quote"
              ? "인용문을 입력하세요..."
              : captureType === "note"
                ? "메모를 입력하세요..."
                : "내용을 입력하세요..."
          }
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
        />

        {/* Tags */}
        <input
          type="text"
          className="quick-capture-input"
          placeholder="#태그1 #태그2"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />

        {/* Actions */}
        <div className="quick-capture-actions">
          <button className="quick-capture-cancel" onClick={toggleQuickCapture}>
            취소
          </button>
          <button
            className="quick-capture-save"
            onClick={handleSave}
            disabled={!body.trim() && !title.trim()}
          >
            저장 (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}
