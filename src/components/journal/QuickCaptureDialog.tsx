// §56l Quick Capture Dialog — Cmd+Shift+N
import { useCallback, useEffect, useRef, useState } from "react";

import { useShallow } from "zustand/shallow";

import { listDir, readFile } from "../../ipc/invoke";
import { captureFleeting } from "../../services/zettelkasten-service";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { buildTagIndex, filterTags } from "../../utils/journal/journal-tags";
import { logger } from "../../utils/logger";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";
import { TagSuggest } from "./TagSuggest";

export function QuickCaptureDialog() {
  const { quickCaptureOpen, toggleQuickCapture } = useUIStore();
  // §99 M4: reactive read so the "space not configured" hint / disabled Save
  // surface immediately on open/render, not only after a failed save attempt.
  const { zettelkastenEnabled, zettelkastenDirectory } = useSettingsStore(
    useShallow((s) => ({
      zettelkastenEnabled: s.zettelkastenEnabled,
      zettelkastenDirectory: s.zettelkastenDirectory,
    })),
  );
  const rootPath = useFileStore((s) => s.rootPath);
  const zettelDir = resolveZettelDir(rootPath, zettelkastenDirectory);
  const zettelReady = zettelkastenEnabled && !!zettelDir;
  const [body, setBody] = useState("");
  const [source, setSource] = useState("");
  const [tags, setTags] = useState("");
  const [saveError, setSaveError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Tag autocomplete state
  const [tagIndex, setTagIndex] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [tagQuery, setTagQuery] = useState<null | string>(null);
  const [tagSuggestVisible, setTagSuggestVisible] = useState(false);
  const [tagActiveIndex, setTagActiveIndex] = useState(0);
  const tagsInputRef = useRef<HTMLInputElement>(null);

  // Build tag index when dialog opens
  useEffect(() => {
    if (!quickCaptureOpen) return;

    setBody("");
    setSource("");
    setTags("");
    setTagSuggestVisible(false);
    setTagQuery(null);
    setTagActiveIndex(0);
    setSaveError("");
    setTimeout(() => inputRef.current?.focus(), 50);

    // Scan the zettelkasten space for tag index — captures now land there.
    (async () => {
      try {
        const { rootPath } = useFileStore.getState();
        const { zettelkastenDirectory } = useSettingsStore.getState();
        const tagScanDir = resolveZettelDir(rootPath, zettelkastenDirectory);
        if (!tagScanDir) return;

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
          (f): f is { content: string; path: string } => f !== null,
        );
        setTagIndex(buildTagIndex(validFiles));
      } catch (err) {
        logger.error("[QuickCapture] Tag index build failed:", err);
      }
    })();
  }, [quickCaptureOpen]);

  const handleSave = useCallback(async () => {
    setSaveError("");

    if (!body.trim()) {
      setSaveError("내용을 입력해주세요.");
      return;
    }

    // §99 M4: the Save button is disabled while !zettelReady, but keep this
    // check as a defense-in-depth guard (e.g. Enter key submit).
    if (!zettelReady || !zettelDir) {
      setSaveError("제텔카스텐 공간을 먼저 설정하세요.");
      return;
    }

    try {
      // Compose the fleeting body from the dialog fields
      const bodyLines: string[] = [];
      if (body) bodyLines.push(body, "");
      if (source) bodyLines.push(`Source: ${source}`, "");
      if (tags)
        bodyLines.push(
          tags
            .split(/\s+/)
            .filter(Boolean)
            .map((t) => (t.startsWith("#") ? t : `#${t}`))
            .join(" "),
        );

      const result = await captureFleeting(
        zettelDir,
        bodyLines.join("\n").trim(),
      );
      if (!result) {
        setSaveError("Zettelkasten inbox에 저장하지 못했습니다.");
        return;
      }

      toggleQuickCapture();
    } catch (err) {
      logger.error("[QuickCapture] Save failed:", err);
      setSaveError(
        `저장 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [body, source, tags, zettelReady, zettelDir, toggleQuickCapture]);

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

      const newValue =
        newBefore + (after.startsWith(" ") ? after : " " + after);
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

        {/* Body */}
        <textarea
          className="quick-capture-textarea"
          onChange={(e) => setBody(e.target.value)}
          placeholder="메모를 입력하세요..."
          ref={inputRef}
          rows={3}
          value={body}
        />

        {/* Optional source */}
        <input
          className="quick-capture-input"
          onChange={(e) => setSource(e.target.value)}
          placeholder="출처 (선택): https://..."
          type="text"
          value={source}
        />

        {/* Tags with autocomplete */}
        <div className="quick-capture-tags-wrap">
          <input
            className="quick-capture-input"
            onBlur={() => {
              // Delay hide so onMouseDown on suggestion fires first
              setTimeout(() => setTagSuggestVisible(false), 150);
            }}
            onChange={handleTagsChange}
            onKeyDown={handleTagsKeyDown}
            placeholder="#태그1 #태그2"
            ref={tagsInputRef}
            type="text"
            value={tags}
          />
          <TagSuggest
            activeIndex={tagActiveIndex}
            onSelect={handleTagSelect}
            query={tagQuery ?? ""}
            tags={tagIndex}
            visible={tagSuggestVisible}
          />
        </div>

        {/* §99 M4: surface the "space not configured" state immediately on
            render, not only after a failed save attempt. */}
        {!zettelReady && (
          <div className="quick-capture-error">
            제텔카스텐 공간을 먼저 설정하세요.
          </div>
        )}

        {/* Error message */}
        {saveError && <div className="quick-capture-error">{saveError}</div>}

        {/* Actions */}
        <div className="quick-capture-actions">
          <button className="quick-capture-cancel" onClick={toggleQuickCapture}>
            취소
          </button>
          <button
            className="quick-capture-save"
            disabled={!body.trim() || !zettelReady}
            onClick={handleSave}
          >
            저장 (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}

/** Extract the current #tag prefix being typed at the cursor position */
function getCurrentTagQuery(value: string, cursorPos: number): null | string {
  const textBefore = value.slice(0, cursorPos);
  const match = textBefore.match(/#([\w가-힣]*)$/);
  return match ? match[1] : null;
}
