// §56l Quick Capture Dialog — Cmd+Shift+N
import { useState, useRef, useEffect, useCallback } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useEditorStore } from "../../stores/editor-store";
import {
  CAPTURE_TYPES,
  CAPTURE_ICONS,
  type CaptureType,
  type CaptureItem,
  insertCaptureIntoContent,
} from "../../utils/journal-capture";
import { getHierarchicalJournalPath, formatJournalFilename, generateDefaultJournal, applyJournalTemplate } from "../../utils/journal";
import { readFile, writeFile, createDir, listDir } from "../../ipc/invoke";
import { buildTagIndex, filterTags } from "../../utils/journal-tags";
import { TagSuggest } from "./TagSuggest";

/** Extract the current #tag prefix being typed at the cursor position */
function getCurrentTagQuery(value: string, cursorPos: number): string | null {
  const textBefore = value.slice(0, cursorPos);
  const match = textBefore.match(/#([\w가-힣]*)$/);
  return match ? match[1] : null;
}

export function QuickCaptureDialog() {
  const { quickCaptureOpen, quickCaptureType, toggleQuickCapture } = useUIStore();
  const [captureType, setCaptureType] = useState<CaptureType>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [saveError, setSaveError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Tag autocomplete state
  const [tagIndex, setTagIndex] = useState<Map<string, number>>(new Map());
  const [tagQuery, setTagQuery] = useState<string | null>(null);
  const [tagSuggestVisible, setTagSuggestVisible] = useState(false);
  const [tagActiveIndex, setTagActiveIndex] = useState(0);
  const tagsInputRef = useRef<HTMLInputElement>(null);

  // Build tag index when dialog opens
  useEffect(() => {
    if (!quickCaptureOpen) return;

    setCaptureType(quickCaptureType);
    setTitle("");
    setBody("");
    setUrl("");
    setTags("");
    setTagSuggestVisible(false);
    setTagQuery(null);
    setTagActiveIndex(0);
    setSaveError("");
    setTimeout(() => inputRef.current?.focus(), 50);

    // Scan journal files for tag index
    (async () => {
      try {
        const { rootPath } = useFileStore.getState();
        const { journalDirectory } = useSettingsStore.getState();
        if (!rootPath || !journalDirectory) return;

        const tagScanDir = journalDirectory.startsWith("/") || /^[A-Z]:\\/.test(journalDirectory)
          ? journalDirectory
          : `${rootPath}/${journalDirectory}`;

        const entries = await listDir(tagScanDir, true).catch(() => []);
        const mdFiles = entries
          .filter((e) => !e.isDir && e.name.endsWith(".md"))
          .slice(0, 100); // Limit to 100 most recent files

        const fileContents = await Promise.all(
          mdFiles.map(async (e) => {
            try {
              const content = await readFile(e.path);
              return { path: e.path, content };
            } catch {
              return null;
            }
          }),
        );

        const validFiles = fileContents.filter(
          (f): f is { path: string; content: string } => f !== null,
        );
        setTagIndex(buildTagIndex(validFiles));
      } catch (err) {
        console.error("[QuickCapture] Tag index build failed:", err);
      }
    })();
  }, [quickCaptureOpen, quickCaptureType]);

  const handleSave = useCallback(async () => {
    setSaveError("");

    if (!body.trim() && !title.trim()) {
      setSaveError("내용을 입력해주세요.");
      return;
    }

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

      if (!rootPath) {
        setSaveError("프로젝트 폴더를 먼저 열어주세요.");
        return;
      }
      if (!journalDirectory) {
        setSaveError("설정에서 저널 디렉토리를 지정해주세요.");
        return;
      }

      const date = new Date();
      // Resolve journal dir: absolute paths pass through, relative paths join with rootPath
      const resolvedDir = journalDirectory.startsWith("/") || /^[A-Z]:\\/.test(journalDirectory)
        ? journalDirectory
        : `${rootPath}/${journalDirectory}`;
      const journalPath = journalUseHierarchy
        ? getHierarchicalJournalPath(resolvedDir, date, journalFilenameFormat)
        : `${resolvedDir}/${formatJournalFilename(date, journalFilenameFormat)}`;

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

      // Update file-store cache + reload editor if journal is open
      useFileStore.getState().setFileContent(journalPath, updated);
      const activeTab = useEditorStore.getState().tabs.find(
        (t) => t.id === useEditorStore.getState().activeTabId,
      );
      if (activeTab?.filePath === journalPath) {
        useUIStore.getState().triggerContentReload(true);
      }

      toggleQuickCapture();
    } catch (err) {
      console.error("[QuickCapture] Save failed:", err);
      setSaveError(`저장 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [captureType, title, body, url, tags, toggleQuickCapture]);

  // Handle tag input changes — detect #prefix for autocomplete
  const handleTagsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setTags(value);

      const cursor = e.target.selectionStart ?? value.length;
      const query = getCurrentTagQuery(value, cursor);
      if (query !== null) {
        const suggestions = filterTags(query, tagIndex);
        setTagQuery(query);
        setTagSuggestVisible(suggestions.length > 0);
        setTagActiveIndex(0);
      } else {
        setTagSuggestVisible(false);
        setTagQuery(null);
      }
    },
    [tagIndex],
  );

  // Insert selected tag into input, replacing the current #prefix
  const handleTagSelect = useCallback(
    (tag: string) => {
      const input = tagsInputRef.current;
      if (!input) return;

      const cursor = input.selectionStart ?? tags.length;
      const before = tags.slice(0, cursor);
      const after = tags.slice(cursor);

      // Replace the partial #prefix with the full tag
      const prefixMatch = before.match(/#[\w가-힣]*$/);
      const newBefore = prefixMatch
        ? before.slice(0, before.length - prefixMatch[0].length) + `#${tag}`
        : before + `#${tag}`;

      const newValue = newBefore + (after.startsWith(" ") ? after : " " + after);
      setTags(newValue.trimEnd() + " ");
      setTagSuggestVisible(false);
      setTagQuery(null);
      setTagActiveIndex(0);

      setTimeout(() => {
        if (tagsInputRef.current) {
          const pos = newBefore.length + 1;
          tagsInputRef.current.setSelectionRange(pos, pos);
          tagsInputRef.current.focus();
        }
      }, 0);
    },
    [tags],
  );

  const handleTagsKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!tagSuggestVisible) return;

      const suggestions = filterTags(tagQuery ?? "", tagIndex);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setTagActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setTagActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (suggestions[tagActiveIndex]) {
          e.preventDefault();
          e.stopPropagation(); // Prevent dialog-level Enter from triggering save
          handleTagSelect(suggestions[tagActiveIndex]);
        }
      } else if (e.key === "Escape") {
        e.stopPropagation(); // Prevent dialog-level Escape from closing
        setTagSuggestVisible(false);
      }
    },
    [tagSuggestVisible, tagQuery, tagIndex, tagActiveIndex, handleTagSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        // Korean IME: Enter during composition commits the syllable.
        // Do NOT preventDefault or save — let the IME finish naturally.
        // User presses Enter again (not composing) to save.
        if (e.nativeEvent.isComposing) return;
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

        {/* Tags with autocomplete */}
        <div className="quick-capture-tags-wrap">
          <input
            ref={tagsInputRef}
            type="text"
            className="quick-capture-input"
            placeholder="#태그1 #태그2"
            value={tags}
            onChange={handleTagsChange}
            onKeyDown={handleTagsKeyDown}
            onBlur={() => {
              // Delay hide so onMouseDown on suggestion fires first
              setTimeout(() => setTagSuggestVisible(false), 150);
            }}
          />
          <TagSuggest
            query={tagQuery ?? ""}
            tags={tagIndex}
            onSelect={handleTagSelect}
            visible={tagSuggestVisible}
            activeIndex={tagActiveIndex}
          />
        </div>

        {/* Error message */}
        {saveError && (
          <div className="quick-capture-error">{saveError}</div>
        )}

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
