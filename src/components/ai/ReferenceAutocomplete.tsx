// §44 @ Reference autocomplete dropdown for AI Chat
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FileEntry } from "../../stores/file-store";

import { useAIStore } from "../../stores/ai-store";
import { useFileStore } from "../../stores/file-store";

interface ReferenceAutocompleteProps {
  onClose: () => void;
  onSelect: (ref: string) => void;
  position: { left: number; top: number };
  query: string;
}

interface RefOption {
  description: string;
  label: string;
  value: string;
}

const BUILTIN_REFS: RefOption[] = [
  {
    label: "@selection",
    value: "@selection",
    description: "Current editor selection",
  },
  { label: "@current", value: "@current", description: "Current file content" },
  {
    label: "@clipboard",
    value: "@clipboard",
    description: "Clipboard content",
  },
];

export function ReferenceAutocomplete({
  query,
  position,
  onSelect,
  onClose,
}: ReferenceAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fileTree = useFileStore((s) => s.fileTree);

  // §44 Wrap onSelect to capture clipboard content when @clipboard is chosen
  const handleSelect = useCallback(
    (value: string) => {
      if (value === "@clipboard") {
        navigator.clipboard
          .readText()
          .then((text) => {
            useAIStore.getState().setClipboardContent(text);
          })
          .catch(() => {
            // Clipboard read failed — store empty string
            useAIStore.getState().setClipboardContent("");
          });
      }
      onSelect(value);
    },
    [onSelect],
  );

  const queryLower = query.toLowerCase();

  const options = useMemo(() => {
    const result: RefOption[] = [];

    // Filter built-in refs
    for (const ref of BUILTIN_REFS) {
      if (ref.label.toLowerCase().includes(queryLower) || queryLower === "") {
        result.push(ref);
      }
    }

    // @file: suggestions — value uses full path for correct resolution
    const isFileQuery = queryLower.startsWith("file:");
    const fileQuery = isFileQuery ? query.slice(5) : "";

    if (isFileQuery || queryLower === "" || "file".startsWith(queryLower)) {
      const files = flattenFiles(fileTree);
      const filtered = fileQuery
        ? files.filter((f) => fuzzyMatch(fileQuery, f.name))
        : files.slice(0, 10);

      for (const file of filtered.slice(0, 10)) {
        result.push({
          label: `@file:${file.name}`,
          value: `@file:${file.path}`,
          description: file.path,
        });
      }
    }

    // @folder: suggestions
    const isFolderQuery = queryLower.startsWith("folder:");
    const folderQuery = isFolderQuery ? query.slice(7) : "";

    if (isFolderQuery || queryLower === "" || "folder".startsWith(queryLower)) {
      const dirs = flattenDirs(fileTree);
      const filtered = folderQuery
        ? dirs.filter((d) => fuzzyMatch(folderQuery, d.name))
        : dirs.slice(0, 10);

      for (const dir of filtered.slice(0, 10)) {
        result.push({
          label: `@folder:${dir.name}`,
          value: `@folder:${dir.path}`,
          description: dir.path,
        });
      }
    }

    return result;
  }, [queryLower, query, fileTree]);

  // Reset selection when options change
  useEffect(() => {
    setSelectedIndex(0);
  }, [options.length]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + options.length) % options.length,
        );
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (options[selectedIndex]) {
          handleSelect(options[selectedIndex].value);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [options, selectedIndex, handleSelect, onClose],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (options.length === 0) return null;

  return (
    <div
      className="ref-autocomplete"
      ref={listRef}
      style={{ bottom: position.top, left: position.left }}
    >
      {options.map((opt, i) => (
        <button
          className={`ref-autocomplete-item ${i === selectedIndex ? "ref-autocomplete-item-active" : ""}`}
          key={opt.value}
          onMouseDown={(e) => {
            e.preventDefault();
            handleSelect(opt.value);
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span className="ref-autocomplete-label">{opt.label}</span>
          <span className="ref-autocomplete-desc">{opt.description}</span>
        </button>
      ))}
    </div>
  );
}

/** Flatten file tree into directory paths */
function flattenDirs(entries: FileEntry[]): { name: string; path: string }[] {
  const result: { name: string; path: string }[] = [];
  for (const entry of entries) {
    if (entry.isDir) {
      result.push({ name: entry.name, path: entry.path });
      if (entry.children) {
        result.push(...flattenDirs(entry.children));
      }
    }
  }
  return result;
}

/** Flatten file tree into file paths */
function flattenFiles(entries: FileEntry[]): { name: string; path: string }[] {
  const result: { name: string; path: string }[] = [];
  for (const entry of entries) {
    if (entry.isDir) {
      if (entry.children) {
        result.push(...flattenFiles(entry.children));
      }
    } else {
      result.push({ name: entry.name, path: entry.path });
    }
  }
  return result;
}

/** Simple fuzzy match: all query chars must appear in order within target */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}
