// §35 Quick Switcher — Cmd+P file/heading fuzzy search
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { Editor } from "@tiptap/react";
import { useUIStore } from "../../stores/ui-store";
import { useFileStore } from "../../stores/file-store";
import { useEditorStore } from "../../stores/editor-store";
import { readFile } from "../../ipc/invoke";
import {
  flattenFileTree,
  fuzzyMatch,
  fuzzyScore,
  extractHeadings,
} from "../../utils/file-search";
import type { FlatFile } from "../../utils/file-search";

interface QuickSwitcherProps {
  editor: Editor | null;
  onNewFile: (name?: string) => void;
}

/** Heading with ProseMirror position for direct navigation. */
interface HeadingResult {
  level: number;
  text: string;
  /** ProseMirror doc position (start of heading content) */
  pmPos: number;
}

interface ResultItem {
  type: "file" | "heading" | "create";
  file?: FlatFile;
  heading?: HeadingResult;
  label: string;
  detail?: string;
}

/** Extract headings directly from ProseMirror doc with positions. */
function extractHeadingsFromDoc(editor: Editor): HeadingResult[] {
  const headings: HeadingResult[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({
        level: node.attrs.level,
        text: node.textContent,
        pmPos: pos + 1, // inside the heading (after opening tag)
      });
    }
  });
  return headings;
}

/** Find the Nth heading in ProseMirror doc matching level + text. */
function findHeadingPos(
  editor: Editor,
  level: number,
  text: string,
  targetIndex: number,
): number | null {
  let matchCount = 0;
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "heading" && node.attrs.level === level) {
      // For markdown-extracted headings, text may include formatting markers.
      // Use textContent (plain) for comparison — strip markdown from search text too.
      const nodeText = node.textContent;
      if (nodeText === text || text.includes(nodeText)) {
        if (matchCount === targetIndex) {
          found = pos + 1;
          return false;
        }
        matchCount++;
      }
    }
  });
  return found;
}

export function QuickSwitcher({ editor, onNewFile }: QuickSwitcherProps) {
  const { quickSwitcherOpen, toggleQuickSwitcher } = useUIStore();
  const { fileTree, rootPath, setFileContent } = useFileStore();
  const { tabs, openTab } = useEditorStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentFileHeadings, setCurrentFileHeadings] = useState<
    HeadingResult[]
  >([]);
  const [otherFileHeadings, setOtherFileHeadings] = useState<HeadingResult[]>(
    [],
  );
  const [headingFile, setHeadingFile] = useState<FlatFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Flatten file tree once
  const flatFiles = useMemo(
    () => (rootPath ? flattenFileTree(fileTree, rootPath) : []),
    [fileTree, rootPath],
  );

  // Also include open tabs not in file tree (untitled files)
  const openTabFiles = useMemo((): FlatFile[] => {
    return tabs
      .filter((t) => !t.filePath)
      .map((t) => ({
        name: t.title,
        path: t.id,
        relativePath: t.title,
      }));
  }, [tabs]);

  const allFiles = useMemo(
    () => [...flatFiles, ...openTabFiles],
    [flatFiles, openTabFiles],
  );

  // Parse query for heading mode: "filename#heading" or "#heading"
  const parsedQuery = useMemo(() => {
    const hashIdx = query.indexOf("#");
    if (hashIdx === -1) return { fileQuery: query, headingQuery: null };
    return {
      fileQuery: query.slice(0, hashIdx),
      headingQuery: query.slice(hashIdx + 1),
    };
  }, [query]);

  // Load headings when entering heading mode
  useEffect(() => {
    if (parsedQuery.headingQuery === null) {
      setCurrentFileHeadings([]);
      setOtherFileHeadings([]);
      setHeadingFile(null);
      return;
    }

    // "#heading" with no file prefix → current file headings from ProseMirror
    if (!parsedQuery.fileQuery) {
      if (editor) {
        setCurrentFileHeadings(extractHeadingsFromDoc(editor));
      }
      setOtherFileHeadings([]);
      setHeadingFile(null);
      return;
    }

    // "filename#heading" → find best matching file, load its headings
    setCurrentFileHeadings([]);
    const matched = allFiles
      .filter((f) => fuzzyMatch(parsedQuery.fileQuery, f.name))
      .sort(
        (a, b) =>
          fuzzyScore(parsedQuery.fileQuery, a.name) -
          fuzzyScore(parsedQuery.fileQuery, b.name),
      );

    const target = matched[0];
    if (!target) {
      setOtherFileHeadings([]);
      setHeadingFile(null);
      return;
    }

    setHeadingFile(target);

    // Extract headings from markdown content (no PM doc available for other files)
    const loadHeadings = (content: string) => {
      const mdHeadings = extractHeadings(content);
      setOtherFileHeadings(
        mdHeadings.map((h, i) => ({
          level: h.level,
          text: h.text,
          pmPos: i, // index, will be resolved when file is opened
        })),
      );
    };

    const existing = useFileStore.getState().openFiles.get(target.path);
    if (existing !== undefined) {
      loadHeadings(existing);
    } else {
      readFile(target.path)
        .then(loadHeadings)
        .catch(() => setOtherFileHeadings([]));
    }
  }, [parsedQuery.fileQuery, parsedQuery.headingQuery, allFiles, tabs, editor]);

  // Active headings — either current file or other file
  const activeHeadings = parsedQuery.fileQuery
    ? otherFileHeadings
    : currentFileHeadings;

  // Build result list
  const results = useMemo((): ResultItem[] => {
    // Heading mode
    if (parsedQuery.headingQuery !== null) {
      const hq = parsedQuery.headingQuery;
      const filtered = hq
        ? activeHeadings.filter((h) => fuzzyMatch(hq, h.text))
        : activeHeadings;
      return filtered.map((h) => ({
        type: "heading" as const,
        heading: h,
        file: headingFile ?? undefined,
        label: `${"#".repeat(h.level)} ${h.text}`,
        detail: headingFile?.relativePath ?? "Current file",
      }));
    }

    // File mode
    const q = query.trim();
    if (!q) {
      const items: ResultItem[] = allFiles
        .slice(0, 50)
        .map((f) => ({
          type: "file" as const,
          file: f,
          label: f.name,
          detail: f.relativePath !== f.name ? f.relativePath : undefined,
        }));
      return items;
    }

    const matched = allFiles
      .filter((f) => fuzzyMatch(q, f.relativePath) || fuzzyMatch(q, f.name))
      .sort((a, b) => fuzzyScore(q, a.name) - fuzzyScore(q, b.name));

    const items: ResultItem[] = matched.slice(0, 50).map((f) => ({
      type: "file" as const,
      file: f,
      label: f.name,
      detail: f.relativePath !== f.name ? f.relativePath : undefined,
    }));

    if (q && !matched.some((f) => f.name.toLowerCase() === q.toLowerCase())) {
      items.push({
        type: "create",
        label: `+ Create "${q}"`,
      });
    }

    return items;
  }, [query, parsedQuery, allFiles, activeHeadings, headingFile]);

  // Reset on open
  useEffect(() => {
    if (quickSwitcherOpen) {
      setQuery("");
      setSelectedIndex(0);
      setCurrentFileHeadings([]);
      setOtherFileHeadings([]);
      setHeadingFile(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [quickSwitcherOpen]);

  // Clamp selectedIndex
  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIndex]);

  // Auto-scroll selected item
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const openFile = useCallback(
    async (file: FlatFile) => {
      const existing = tabs.find(
        (t) => t.filePath === file.path || t.id === file.path,
      );
      if (existing) {
        useEditorStore.getState().setActiveTab(existing.id);
        return;
      }

      try {
        const content = await readFile(file.path);
        setFileContent(file.path, content);
        openTab({
          id: crypto.randomUUID(),
          filePath: file.path,
          title: file.name,
          isDirty: false,
        });
      } catch (err) {
        console.error("[QuickSwitcher] Failed to open file:", err);
      }
    },
    [tabs, setFileContent, openTab],
  );

  const executeResult = useCallback(
    (item: ResultItem) => {
      toggleQuickSwitcher();

      if (item.type === "create") {
        // Extract the typed name from the label: '+ Create "name"' → "name"
        const match = item.label.match(/\+ Create "(.+)"/);
        onNewFile(match?.[1]);
        return;
      }

      if (item.type === "file" && item.file) {
        openFile(item.file);
        return;
      }

      if (item.type === "heading" && item.heading) {
        const heading = item.heading;
        const isCurrentFile = !item.file;

        const scrollToHeading = () => {
          if (!editor) return;
          requestAnimationFrame(() => {
            let pos: number | null;
            if (isCurrentFile) {
              // Current file: pmPos is the actual ProseMirror position
              pos = heading.pmPos;
            } else {
              // Other file: pmPos is the heading index, find actual pos in new doc
              pos = findHeadingPos(
                editor,
                heading.level,
                heading.text,
                heading.pmPos,
              );
            }
            if (pos !== null && pos <= editor.state.doc.content.size) {
              editor
                .chain()
                .focus()
                .setTextSelection(pos)
                .scrollIntoView()
                .run();
            }
          });
        };

        if (item.file) {
          openFile(item.file).then(() => {
            // Extra frames for ProseMirror to load the new document
            requestAnimationFrame(() =>
              requestAnimationFrame(scrollToHeading),
            );
          });
        } else {
          scrollToHeading();
        }
      }
    },
    [toggleQuickSwitcher, openFile, onNewFile, editor],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        toggleQuickSwitcher();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (results[selectedIndex]) {
          executeResult(results[selectedIndex]);
        }
      }
    },
    [results, selectedIndex, executeResult, toggleQuickSwitcher],
  );

  if (!quickSwitcherOpen) return null;

  return (
    <div className="quick-switcher-overlay" onClick={toggleQuickSwitcher}>
      <div
        className="quick-switcher"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="quick-switcher-input"
          type="text"
          placeholder="Type a file name, or # for headings..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
        />
        <div className="quick-switcher-list">
          {results.length === 0 && (
            <div className="quick-switcher-empty">No results found</div>
          )}
          {results.map((item, idx) => (
            <div
              key={
                item.type === "create"
                  ? "create"
                  : item.type === "heading"
                    ? `h-${item.heading?.pmPos}`
                    : item.file?.path ?? idx
              }
              ref={idx === selectedIndex ? selectedRef : null}
              className={`quick-switcher-item ${idx === selectedIndex ? "quick-switcher-item-selected" : ""}`}
              onClick={() => executeResult(item)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span className="quick-switcher-icon">
                {item.type === "heading"
                  ? "#"
                  : item.type === "create"
                    ? "+"
                    : "\u{1F4C4}"}
              </span>
              <span className="quick-switcher-label">{item.label}</span>
              {item.detail && (
                <span className="quick-switcher-detail">{item.detail}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
