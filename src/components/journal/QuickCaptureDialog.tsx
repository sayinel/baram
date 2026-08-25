// §56l Quick Capture Dialog — Cmd+Shift+N
import { useCallback, useEffect, useRef, useState } from "react";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { listDir, readFile } from "../../ipc/invoke";
import {
  formatKeyForDisplay,
  normalizeKeyEvent,
} from "../../keybindings/key-utils";
import { CAPTURE_TASK_MODE_COMMAND } from "../../keybindings/keybinding-registry";
import { findCommandByKey } from "../../keybindings/use-keybindings";
import { captureFleeting } from "../../services/zettelkasten-service";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { buildTagIndex, filterTags } from "../../utils/journal/journal-tags";
import { logger } from "../../utils/logger";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";
import { TagSuggest } from "./TagSuggest";
import { useCaptureTaskMode } from "./use-capture-task-mode";

// ⌘↩ on macOS, Ctrl+Enter elsewhere — shown on the Save button.
const saveKeyLabel = formatKeyForDisplay(
  "Mod+Enter",
  navigator.platform.includes("Mac"),
);

export function QuickCaptureDialog() {
  const { t } = useTranslation();
  // ‼️ bare `useUIStore()` subscribes to the whole store, so an unrelated UI change re-renders
  // the dialog — and re-renders it while the user is typing into it.
  const { quickCaptureOpen, toggleQuickCapture } = useUIStore(
    useShallow((s) => ({
      quickCaptureOpen: s.quickCaptureOpen,
      toggleQuickCapture: s.toggleQuickCapture,
    })),
  );
  // §99 M4: reactive read so the "space not configured" hint / disabled Save
  // surface immediately on open/render, not only after a failed save attempt.
  const keybindingOverrides = useSettingsStore((s) => s.keybindingOverrides);
  const { zettelkastenEnabled, zettelkastenDirectory } = useSettingsStore(
    useShallow((s) => ({
      zettelkastenEnabled: s.zettelkastenEnabled,
      zettelkastenDirectory: s.zettelkastenDirectory,
    })),
  );
  const rootPath = useFileStore((s) => s.rootPath);
  const zettelDir = resolveZettelDir(rootPath, zettelkastenDirectory);
  const zettelReady = zettelkastenEnabled && !!zettelDir;
  const taskMode = useCaptureTaskMode();
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
      setSaveError(t("journal.capture.error.empty"));
      return;
    }

    // §307D 태스크 모드는 Zettel 공간을 요구하지 않는다 — 수집함 파일에
    // 한 줄을 붙이는 것뿐이므로 아래 Zettel 가드보다 먼저 갈라진다.
    if (taskMode.enabled) {
      try {
        await taskMode.save(body);
      } catch (err) {
        logger.error("[QuickCapture] Task capture failed:", err);
        setSaveError(t("journal.capture.error.taskSave"));
        return;
      }
      toggleQuickCapture();
      return;
    }

    // §99 M4: the Save button is disabled while !zettelReady, but keep this
    // check as a defense-in-depth guard (e.g. Enter key submit).
    if (!zettelReady || !zettelDir) {
      setSaveError(t("journal.capture.error.noSpace"));
      return;
    }

    try {
      // Compose the fleeting body — §99 A: tags go to the frontmatter `tags:`
      // array, not inline in the body.
      const bodyLines: string[] = [];
      if (body) bodyLines.push(body, "");
      // ‼️ Not translated: this line is written into the note on disk, not shown in the UI.
      // A localised key here would make the saved file's format depend on the app language.
      if (source) bodyLines.push(`Source: ${source}`, "");

      const tagList = tags
        .split(/\s+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean);

      const result = await captureFleeting(
        zettelDir,
        bodyLines.join("\n").trim(),
        tagList,
      );
      if (!result) {
        setSaveError(t("journal.capture.error.inbox"));
        return;
      }

      toggleQuickCapture();
    } catch (err) {
      logger.error("[QuickCapture] Save failed:", err);
      setSaveError(
        t("journal.capture.error.save", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }, [
    body,
    source,
    tags,
    zettelReady,
    zettelDir,
    taskMode,
    toggleQuickCapture,
    t,
  ]);

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

  // Data-loss guard: with anything typed, only the Cancel button (or a
  // successful save) may dismiss the dialog — not outside clicks or Escape.
  const hasContent = !!(body.trim() || source.trim() || tags.trim());

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Plain Enter inserts a newline in the memo textarea; save is Mod+Enter.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        // Korean IME: Enter during composition commits the syllable.
        // Do NOT preventDefault or save — let the IME finish naturally.
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        handleSave();
      }
      // §307D 태스크 모드 토글 — IME 조합 중에는 같은 이유로 무시한다.
      //
      // 수정자를 손으로 비교하지 않고 `normalizeKeyEvent`를 쓰는 이유 두 가지:
      // (1) macOS에서 ⌥+문자는 특수문자를 만들어 `e.key`가 "t"가 아니라 "†"다.
      //     이 헬퍼는 `e.code`(레이아웃 독립)로 판정한다.
      // (2) 사용자가 설정에서 바꾼 조합이 실제로 동작한다 — 하드코딩하면
      //     레지스트리에 등록해 놓고 핸들러가 그 값을 무시하게 된다.
      if (!e.nativeEvent.isComposing) {
        const notation = normalizeKeyEvent(
          e.nativeEvent,
          navigator.platform.includes("Mac"),
        );
        if (
          notation &&
          findCommandByKey(notation, keybindingOverrides)?.id ===
            CAPTURE_TASK_MODE_COMMAND
        ) {
          e.preventDefault();
          taskMode.toggle();
          return;
        }
      }
      if (e.key === "Escape") {
        if (hasContent) return;
        toggleQuickCapture();
      }
    },
    [handleSave, toggleQuickCapture, hasContent, taskMode, keybindingOverrides],
  );

  const handleOverlayClick = useCallback(() => {
    if (hasContent) return;
    toggleQuickCapture();
  }, [hasContent, toggleQuickCapture]);

  if (!quickCaptureOpen) return null;

  return (
    <div className="quick-capture-overlay" onClick={handleOverlayClick}>
      <div
        className="quick-capture-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="quick-capture-header">
          <h3>{t("journal.capture.title")}</h3>
          <label className="quick-capture-task-toggle">
            <input
              checked={taskMode.enabled}
              onChange={taskMode.toggle}
              type="checkbox"
            />
            {t("journal.capture.taskMode.label")}
          </label>
        </div>

        {/* Body */}
        <textarea
          className="quick-capture-textarea"
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("journal.capture.body.placeholder")}
          ref={inputRef}
          rows={3}
          value={body}
        />

        {/* Optional source */}
        <input
          className="quick-capture-input"
          onChange={(e) => setSource(e.target.value)}
          placeholder={t("journal.capture.source.placeholder")}
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
            placeholder={t("journal.capture.tags.placeholder")}
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
            render, not only after a failed save attempt. §307D: task mode
            doesn't use the Zettel space, so this hint doesn't apply to it. */}
        {!zettelReady && !taskMode.enabled && (
          <div className="quick-capture-error">
            {t("journal.capture.error.noSpace")}
          </div>
        )}

        {/* Error message */}
        {saveError && <div className="quick-capture-error">{saveError}</div>}

        {/* Actions */}
        <div className="quick-capture-actions">
          <button className="quick-capture-cancel" onClick={toggleQuickCapture}>
            {t("common.cancel")}
          </button>
          <button
            className="quick-capture-save"
            disabled={!body.trim() || (!zettelReady && !taskMode.enabled)}
            onClick={handleSave}
          >
            {t("journal.capture.save", { key: saveKeyLabel })}
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
