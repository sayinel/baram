// §36 북마크 패널 — 사이드바에서 북마크 목록 표시 및 관리
import { useCallback, useEffect } from "react";

import type { BookmarkItem } from "../../stores/file/bookmark";

import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { getGroups, useBookmarkStore } from "../../stores/file/bookmark";
import { useFileStore } from "../../stores/file/file";
import { logger } from "../../utils/logger";
import { extractFileNameFromPath } from "./backlink-utils";

export function BookmarkPanel() {
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
  const handleClick = useCallback((bookmark: BookmarkItem) => {
    const {
      tabs: currentTabs,
      openTab,
      setActiveTab,
    } = useEditorStore.getState();

    // If file is already open, switch to it
    const existing = currentTabs.find((t) => t.filePath === bookmark.filePath);
    if (existing) {
      setActiveTab(existing.id);
      // If heading bookmark, scroll to heading after tab switch
      if (bookmark.type === "heading" && bookmark.headingText) {
        scrollToHeading(bookmark);
      }
      return;
    }

    // Open the file
    (async () => {
      try {
        const content = await readFile(bookmark.filePath);
        const fileName = extractFileNameFromPath(bookmark.filePath);
        useFileStore.getState().setFileContent(bookmark.filePath, content);
        openTab({
          id: crypto.randomUUID(),
          filePath: bookmark.filePath,
          title: fileName,
          isDirty: false,
          isPinned: false,
        });
        // Heading scroll will be handled after editor mounts
        if (bookmark.type === "heading" && bookmark.headingText) {
          // Small delay to allow editor to mount and process content
          setTimeout(() => scrollToHeading(bookmark), 100);
        }
      } catch (err) {
        logger.error("[BookmarkPanel] Failed to open file:", err);
      }
    })();
  }, []);

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

/** Scroll to a heading in the active editor */
function scrollToHeading(bookmark: BookmarkItem) {
  // Access editor from the DOM — find the Tiptap editor instance
  const editorElement = document.querySelector(".tiptap.ProseMirror");
  if (!editorElement) return;

  // Find heading nodes in the DOM
  const headingTag = bookmark.headingLevel
    ? `h${bookmark.headingLevel}`
    : "h1, h2, h3, h4, h5, h6";
  const headings = editorElement.querySelectorAll(headingTag);

  for (const el of headings) {
    if (el.textContent === bookmark.headingText) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }
}
