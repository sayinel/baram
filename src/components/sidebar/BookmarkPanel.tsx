// §36 북마크 패널 — 사이드바에서 북마크 목록 표시 및 관리
import { useCallback, useEffect } from "react";

import type { BookmarkItem } from "../../stores/file/bookmark";

import { useEditorContext } from "../../contexts/editor-context";
import { revealElementInActiveEditor } from "../../extensions/plugins/viewport-virtualize";
import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { getGroups, useBookmarkStore } from "../../stores/file/bookmark";
import { useFileStore } from "../../stores/file/file";
import { logger } from "../../utils/logger";
import { extractFileNameFromPath } from "./backlink-utils";

export function BookmarkPanel() {
  const editor = useEditorContext();
  const rootPath = useFileStore((s) => s.rootPath);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const {
    bookmarks,
    addBookmark,
    removeBookmark,
    loadBookmarks,
    saveBookmarks,
  } = useBookmarkStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? null;

  // Load bookmarks when vault opens
  useEffect(() => {
    if (rootPath) {
      loadBookmarks(rootPath);
    }
  }, [rootPath, loadBookmarks]);

  // Auto-save whenever bookmarks change
  useEffect(() => {
    if (rootPath) {
      saveBookmarks(rootPath);
    }
  }, [bookmarks, rootPath, saveBookmarks]);

  // Bookmark current file
  const handleBookmarkFile = useCallback(() => {
    if (!filePath) return;
    const fileName = extractFileNameFromPath(filePath);
    addBookmark({
      type: "file",
      filePath,
      label: fileName,
      group: "Default",
    });
  }, [filePath, addBookmark]);

  // Navigate to a bookmark
  const handleClick = useCallback(
    (bookmark: BookmarkItem) => {
      const {
        tabs: currentTabs,
        openTab,
        setActiveTab,
      } = useEditorStore.getState();

      // §perf-large-file C3.4: pass editor DOM so scrollToHeading resolves
      // the active editor's element instead of a global querySelector.
      const editorEl = editor?.view.dom as HTMLElement | undefined;

      // If file is already open, switch to it
      const existing = currentTabs.find(
        (t) => t.filePath === bookmark.filePath,
      );
      if (existing) {
        setActiveTab(existing.id);
        // If heading bookmark, scroll to heading after tab switch
        if (bookmark.type === "heading" && bookmark.headingText) {
          scrollToHeading(bookmark, editorEl);
        }
        return;
      }

      // Open the file
      void (async () => {
        try {
          const content = await readFile(bookmark.filePath);
          const fileName = extractFileNameFromPath(bookmark.filePath);
          useFileStore.getState().setFileContent(bookmark.filePath, content);
          openTab({
            contextId: "",
            id: crypto.randomUUID(),
            filePath: bookmark.filePath,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
          // Heading scroll will be handled after editor mounts
          if (bookmark.type === "heading" && bookmark.headingText) {
            // Small delay to allow editor to mount and process content
            setTimeout(() => scrollToHeading(bookmark, editorEl), 100);
          }
        } catch (err) {
          logger.error("[BookmarkPanel] Failed to open file:", err);
        }
      })();
    },
    [editor],
  );

  // Check if current file is bookmarked
  const isCurrentFileBookmarked = filePath
    ? bookmarks.some((b) => b.type === "file" && b.filePath === filePath)
    : false;

  const groups = getGroups(bookmarks);
  // Ensure "Default" group is always first
  const sortedGroups = groups.includes("Default")
    ? ["Default", ...groups.filter((g) => g !== "Default")]
    : groups;

  return (
    <div className="bookmark-panel">
      <div className="bookmark-header flex-header">
        <span>Bookmarks ({bookmarks.length})</span>
        <button
          className={`bookmark-add-btn btn-unstyled ${isCurrentFileBookmarked ? "bookmark-added" : ""}`}
          disabled={!filePath || isCurrentFileBookmarked}
          onClick={handleBookmarkFile}
          title={
            isCurrentFileBookmarked
              ? "Already bookmarked"
              : filePath
                ? "Bookmark current file"
                : "No file open"
          }
        >
          {isCurrentFileBookmarked ? "★" : "☆"}
        </button>
      </div>

      {bookmarks.length === 0 ? (
        <div className="bookmark-empty">
          No bookmarks yet. Press Cmd+D to bookmark the current file.
        </div>
      ) : (
        sortedGroups.map((group) => {
          const groupBookmarks = bookmarks.filter((b) => b.group === group);
          if (groupBookmarks.length === 0) return null;
          return (
            <div className="bookmark-group" key={group}>
              <div className="bookmark-group-name">{group}</div>
              {groupBookmarks.map((bookmark) => (
                <div
                  className={`bookmark-item ${bookmark.filePath === filePath ? "bookmark-item-active" : ""}`}
                  key={bookmark.id}
                >
                  <span
                    className="bookmark-item-label"
                    onClick={() => handleClick(bookmark)}
                    title={bookmark.filePath}
                  >
                    <span className="bookmark-item-icon">
                      {bookmark.type === "heading" ? "§" : "📄"}
                    </span>
                    {bookmark.label}
                  </span>
                  <button
                    className="bookmark-remove-btn btn-unstyled"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeBookmark(bookmark.id);
                    }}
                    title="Remove bookmark"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

/** Scroll to a heading in the active editor.
 *
 * §perf-large-file C3.4: accepts the editor's DOM element directly so this
 * works in a dual-editor layout without a global querySelector fallback.
 */
function scrollToHeading(bookmark: BookmarkItem, editorElement?: HTMLElement) {
  // Resolve the editor element: prefer the passed-in element, fall back to
  // global query for the brief window before the editor is available.
  const el =
    editorElement ?? document.querySelector<HTMLElement>(".tiptap.ProseMirror");
  if (!el) return;

  // Find heading nodes in the DOM
  const headingTag = bookmark.headingLevel
    ? `h${bookmark.headingLevel}`
    : "h1, h2, h3, h4, h5, h6";
  const headings = el.querySelectorAll(headingTag);

  for (const heading of headings) {
    if (heading.textContent === bookmark.headingText) {
      // §perf-large-file C4: reveal the heading if windowing hid it (display:none
      // has no geometry, so scrollIntoView would be a no-op otherwise).
      revealElementInActiveEditor(heading as HTMLElement);
      heading.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }
}
