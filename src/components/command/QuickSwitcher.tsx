// §35 Quick Switcher — Cmd+K file/heading fuzzy search
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ContextInfo } from "../../ipc/types";
import type { FlatFile } from "../../utils/file-search";
import type { HeadingResult } from "../../utils/quick-switcher-headings";
import type { JournalPrefix } from "../../utils/quick-switcher-query";
import type { Editor } from "@tiptap/react";

import { useShallow } from "zustand/shallow";

import { revealBlockInActiveEditor } from "../../extensions/plugins/viewport-virtualize";
import { readFile } from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  extractHeadings,
  flattenFileTree,
  fuzzyMatch,
  fuzzyScore,
} from "../../utils/file-search";
import { resolveJournalDir } from "../../utils/journal/journal";
import { logger } from "../../utils/logger";
import { extractNamespace } from "../../utils/path-utils";
import {
  extractHeadingsFromDoc,
  findHeadingPos,
} from "../../utils/quick-switcher-headings";
import {
  filterByJournalPrefix,
  parseQuickSwitcherQuery,
} from "../../utils/quick-switcher-query";
import { PaletteOverlay } from "./PaletteOverlay";
import { usePaletteListNav } from "./use-palette-list-nav";

const PREFIX_BADGE_LABELS: Record<NonNullable<JournalPrefix>, string> = {
  n: "Notes",
  d: "Daily",
  j: "Journal",
};

interface QuickSwitcherProps {
  editor: Editor | null;
  onNewFile: (name?: string) => void;
}

interface ResultItem {
  detail?: string;
  file?: FlatFile;
  heading?: HeadingResult;
  label: string;
  type: "create" | "file" | "heading";
}

export function QuickSwitcher({ editor, onNewFile }: QuickSwitcherProps) {
  const { quickSwitcherOpen, toggleQuickSwitcher } = useUIStore(
    useShallow((s) => ({
      quickSwitcherOpen: s.quickSwitcherOpen,
      toggleQuickSwitcher: s.toggleQuickSwitcher,
    })),
  );
  const { fileTree, rootPath, setFileContent } = useFileStore(
    useShallow((s) => ({
      fileTree: s.fileTree,
      rootPath: s.rootPath,
      setFileContent: s.setFileContent,
    })),
  );
  const { tabs, openTab } = useEditorStore(
    useShallow((s) => ({
      tabs: s.tabs,
      openTab: s.openTab,
    })),
  );
  const { journalEnabled, journalDirectory } = useSettingsStore(
    useShallow((s) => ({
      journalEnabled: s.journalEnabled,
      journalDirectory: s.journalDirectory,
    })),
  );
  const { contexts, getContextForPath } = useContextStore(
    useShallow((s) => ({
      contexts: s.contexts,
      getContextForPath: s.getContextForPath,
    })),
  );
  const showContextBadge = contexts.length > 1;
  const [query, setQuery] = useState("");
  const [currentFileHeadings, setCurrentFileHeadings] = useState<
    HeadingResult[]
  >([]);
  const [otherFileHeadings, setOtherFileHeadings] = useState<HeadingResult[]>(
    [],
  );
  const [headingFile, setHeadingFile] = useState<FlatFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // §56l Journal prefix filter state
  const resolvedJournalDir = useMemo(
    () =>
      journalEnabled ? (resolveJournalDir(null, journalDirectory) ?? "") : "",
    [journalEnabled, journalDirectory],
  );

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

  // §56l Parse journal prefix first, then §61 namespace filter, then heading mode
  const parsedQuery = useMemo(() => parseQuickSwitcherQuery(query), [query]);

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

    // File mode — apply journal prefix filter first
    let candidateFiles = filterByJournalPrefix(
      allFiles,
      parsedQuery.prefix,
      resolvedJournalDir,
    );

    // §61 Namespace filter
    if (parsedQuery.nsFilter) {
      const nsLower = parsedQuery.nsFilter.toLowerCase();
      candidateFiles = candidateFiles.filter((f) => {
        const ns = extractNamespace(f.relativePath);
        return ns ? ns.toLowerCase().includes(nsLower) : nsLower === "";
      });
    }

    const q = parsedQuery.fileQuery.trim();
    if (!q) {
      const items: ResultItem[] = candidateFiles.slice(0, 50).map((f) => ({
        type: "file" as const,
        file: f,
        label: f.name,
        detail: extractNamespace(f.relativePath),
      }));
      return items;
    }

    const matched = candidateFiles
      .filter((f) => fuzzyMatch(q, f.relativePath) || fuzzyMatch(q, f.name))
      .sort((a, b) => fuzzyScore(q, a.name) - fuzzyScore(q, b.name));

    const items: ResultItem[] = matched.slice(0, 50).map((f) => ({
      type: "file" as const,
      file: f,
      label: f.name,
      detail: extractNamespace(f.relativePath),
    }));

    // Only offer "create" when no prefix or namespace filter active
    if (
      !parsedQuery.prefix &&
      !parsedQuery.nsFilter &&
      q &&
      !matched.some((f) => f.name.toLowerCase() === q.toLowerCase())
    ) {
      items.push({
        type: "create",
        label: `+ Create "${q}"`,
      });
    }

    return items;
  }, [parsedQuery, allFiles, activeHeadings, headingFile, resolvedJournalDir]);

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
          contextId: "",
          id: crypto.randomUUID(),
          filePath: file.path,
          title: file.name,
          isDirty: false,
          isPinned: false,
        });
      } catch (err) {
        logger.error("[QuickSwitcher] Failed to open file:", err);
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
            let pos: null | number;
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
              // §perf-large-file C4: reveal an off-screen windowed target first.
              revealBlockInActiveEditor(pos);
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
            requestAnimationFrame(() => requestAnimationFrame(scrollToHeading));
          });
        } else {
          scrollToHeading();
        }
      }
    },
    [toggleQuickSwitcher, openFile, onNewFile, editor],
  );

  const handleOpen = useCallback(() => {
    setQuery("");
    setCurrentFileHeadings([]);
    setOtherFileHeadings([]);
    setHeadingFile(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleEnter = useCallback(
    (index: number) => {
      executeResult(results[index]);
    },
    [results, executeResult],
  );

  const { handleKeyDown, selectedIndex, setSelectedIndex } = usePaletteListNav({
    isOpen: quickSwitcherOpen,
    itemCount: results.length,
    onEnter: handleEnter,
    onEscape: toggleQuickSwitcher,
    onOpen: handleOpen,
  });

  // Auto-scroll selected item
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!quickSwitcherOpen) return null;

  return (
    <PaletteOverlay
      onClose={toggleQuickSwitcher}
      onKeyDown={handleKeyDown}
      overlayClassName="quick-switcher-overlay"
      paletteClassName="quick-switcher"
    >
      <div className="quick-switcher-input-row">
        {parsedQuery.prefix && (
          <span className="quick-switcher-prefix-badge">
            {PREFIX_BADGE_LABELS[parsedQuery.prefix]}
          </span>
        )}
        {parsedQuery.nsFilter && (
          <span className="quick-switcher-prefix-badge">
            ns:{parsedQuery.nsFilter}
          </span>
        )}
        <input
          className="quick-switcher-input"
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          placeholder="Type a file name, # for headings, n:/d:/j: for journal, ns: for namespace..."
          ref={inputRef}
          type="text"
          value={query}
        />
      </div>
      <div className="quick-switcher-list">
        {results.length === 0 && (
          <div className="quick-switcher-empty">No results found</div>
        )}
        {results.map((item, idx) => (
          <div
            className={`quick-switcher-item ${idx === selectedIndex ? "quick-switcher-item-selected" : ""}`}
            key={
              item.type === "create"
                ? "create"
                : item.type === "heading"
                  ? `h-${item.heading?.pmPos}`
                  : (item.file?.path ?? idx)
            }
            onClick={() => executeResult(item)}
            onMouseEnter={() => setSelectedIndex(idx)}
            ref={idx === selectedIndex ? selectedRef : null}
          >
            <span className="quick-switcher-icon">
              {item.type === "heading"
                ? "#"
                : item.type === "create"
                  ? "+"
                  : "\u{1F4C4}"}
            </span>
            <span className="quick-switcher-label">{item.label}</span>
            {(item.detail || (showContextBadge && item.type === "file")) && (
              <span className="quick-switcher-detail">
                {showContextBadge && item.type === "file" && item.file && (
                  <FileContextBadge
                    filePath={item.file.path}
                    getContextForPath={getContextForPath}
                  />
                )}
                {item.detail && <span>{item.detail}</span>}
              </span>
            )}
          </div>
        ))}
      </div>
    </PaletteOverlay>
  );
}

/** §84 Per-file context badge — looks up context for each file path. */
function FileContextBadge({
  filePath,
  getContextForPath,
}: {
  filePath: string;
  getContextForPath: (path: string) => ContextInfo | null;
}) {
  const ctx = getContextForPath(filePath);
  if (!ctx?.label) return null;
  return (
    <span className="qs-context-badge" style={{ color: ctx.color }}>
      {ctx.label}
    </span>
  );
}
