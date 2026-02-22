// §4.5 Command Palette — Cmd+P
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useUIStore } from "../../stores/ui-store";
import type { Editor } from "@tiptap/react";

export interface CommandItem {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  action: (editor: Editor | null) => void;
}

function buildCommands(
  toggleSidebar: () => void,
  toggleSourceMode: () => void,
  onNewFile: () => void,
  onOpenFile: () => void,
  onSave: () => void,
  onOpenFolder: () => void,
): CommandItem[] {
  return [
    // File
    {
      id: "file:new",
      label: "New File",
      category: "File",
      shortcut: "\u2318N",
      action: () => onNewFile(),
    },
    {
      id: "file:open",
      label: "Open File",
      category: "File",
      shortcut: "\u2318O",
      action: () => onOpenFile(),
    },
    {
      id: "file:save",
      label: "Save",
      category: "File",
      shortcut: "\u2318S",
      action: () => onSave(),
    },
    {
      id: "file:open-folder",
      label: "Open Folder",
      category: "File",
      action: () => onOpenFolder(),
    },
    {
      id: "file:export-html",
      label: "Export as HTML",
      category: "File",
      action: () => useUIStore.getState().openExportDialog("html"),
    },
    {
      id: "file:export-pdf",
      label: "Export as PDF (Print)",
      category: "File",
      action: () => useUIStore.getState().openExportDialog("pdf"),
    },
    // View
    {
      id: "view:source-mode",
      label: "Toggle Source Mode",
      category: "View",
      shortcut: "\u2318/",
      action: () => toggleSourceMode(),
    },
    {
      id: "view:toggle-sidebar",
      label: "Toggle Sidebar",
      category: "View",
      shortcut: "\u21E7\u2318L",
      action: () => toggleSidebar(),
    },
    // Insert — Headings
    {
      id: "insert:h1",
      label: "Heading 1",
      category: "Insert",
      shortcut: "\u23181",
      action: (editor) => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: "insert:h2",
      label: "Heading 2",
      category: "Insert",
      shortcut: "\u23182",
      action: (editor) => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: "insert:h3",
      label: "Heading 3",
      category: "Insert",
      shortcut: "\u23183",
      action: (editor) => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    // Insert — Blocks
    {
      id: "insert:bullet-list",
      label: "Bullet List",
      category: "Insert",
      shortcut: "\u21E7\u23188",
      action: (editor) => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      id: "insert:ordered-list",
      label: "Ordered List",
      category: "Insert",
      shortcut: "\u21E7\u23187",
      action: (editor) => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "insert:task-list",
      label: "Task List",
      category: "Insert",
      action: (editor) => editor?.chain().focus().toggleTaskList().run(),
    },
    {
      id: "insert:blockquote",
      label: "Blockquote",
      category: "Insert",
      shortcut: "\u21E7\u2318>",
      action: (editor) => editor?.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "insert:code-block",
      label: "Code Block",
      category: "Insert",
      shortcut: "\u21E7\u2318C",
      action: (editor) => editor?.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "insert:horizontal-rule",
      label: "Horizontal Rule",
      category: "Insert",
      action: (editor) => editor?.chain().focus().setHorizontalRule().run(),
    },
    {
      id: "insert:table",
      label: "Table",
      category: "Insert",
      action: (editor) =>
        editor
          ?.chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    // Format
    {
      id: "format:bold",
      label: "Bold",
      category: "Format",
      shortcut: "\u2318B",
      action: (editor) => editor?.chain().focus().toggleBold().run(),
    },
    {
      id: "format:italic",
      label: "Italic",
      category: "Format",
      shortcut: "\u2318I",
      action: (editor) => editor?.chain().focus().toggleItalic().run(),
    },
    {
      id: "format:strikethrough",
      label: "Strikethrough",
      category: "Format",
      shortcut: "\u21E7\u2318X",
      action: (editor) => editor?.chain().focus().toggleStrike().run(),
    },
    {
      id: "format:inline-code",
      label: "Inline Code",
      category: "Format",
      shortcut: "\u2318E",
      action: (editor) => editor?.chain().focus().toggleCode().run(),
    },
  ];
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

interface CommandPaletteProps {
  editor: Editor | null;
  onToggleSourceMode: () => void;
  onNewFile: () => void;
  onOpenFile: () => void;
  onSave: () => void;
  onOpenFolder: () => void;
}

export function CommandPalette({
  editor,
  onToggleSourceMode,
  onNewFile,
  onOpenFile,
  onSave,
  onOpenFolder,
}: CommandPaletteProps) {
  const { commandPaletteOpen, toggleCommandPalette, toggleSidebar } =
    useUIStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(
    () =>
      buildCommands(
        toggleSidebar,
        onToggleSourceMode,
        onNewFile,
        onOpenFile,
        onSave,
        onOpenFolder,
      ),
    [toggleSidebar, onToggleSourceMode, onNewFile, onOpenFile, onSave, onOpenFolder],
  );

  const filtered = useMemo(() => {
    if (!query) return commands;
    return commands.filter(
      (cmd) =>
        fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.category),
    );
  }, [query, commands]);

  // Reset on open
  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [commandPaletteOpen]);

  // Clamp selectedIndex
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  const executeCommand = useCallback(
    (cmd: CommandItem) => {
      toggleCommandPalette();
      cmd.action(editor);
    },
    [editor, toggleCommandPalette],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        toggleCommandPalette();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          executeCommand(filtered[selectedIndex]);
        }
      }
    },
    [filtered, selectedIndex, executeCommand, toggleCommandPalette],
  );

  if (!commandPaletteOpen) return null;

  // Group by category
  const groups = new Map<string, CommandItem[]>();
  for (const cmd of filtered) {
    const list = groups.get(cmd.category) || [];
    list.push(cmd);
    groups.set(cmd.category, list);
  }

  let flatIndex = 0;

  return (
    <div className="command-palette-overlay" onClick={toggleCommandPalette}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
        />
        <div className="command-palette-list">
          {filtered.length === 0 && (
            <div className="command-palette-empty">No commands found</div>
          )}
          {Array.from(groups.entries()).map(([category, items]) => (
            <div key={category} className="command-palette-group">
              <div className="command-palette-category">{category}</div>
              {items.map((cmd) => {
                const idx = flatIndex++;
                return (
                  <div
                    key={cmd.id}
                    className={`command-palette-item ${idx === selectedIndex ? "command-palette-item-selected" : ""}`}
                    onClick={() => executeCommand(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="command-item-label">{cmd.label}</span>
                    {cmd.shortcut && (
                      <span className="command-item-shortcut">
                        {cmd.shortcut}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
