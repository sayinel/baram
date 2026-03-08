// §4.5 Command Palette — Cmd+P
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useEditorStore } from "../../stores/editor-store";
import { useGitStore } from "../../stores/git-store";
import { useFileStore } from "../../stores/file-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { executeAICommand, getSelectedText, getSelectionOrParagraph, showPrompt } from "../../utils/ai-commands";
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
  onSkillPreview: () => void,
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
      shortcut: "⌘⇧O",
      action: () => onOpenFolder(),
    },
    {
      id: "file:export",
      label: "Export...",
      category: "File",
      shortcut: "⇧⌘E",
      action: () => useUIStore.getState().openExportDialog("html"),
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
    {
      id: "view:graph-tab",
      label: "Open Graph View in Tab",
      category: "View",
      action: () => useEditorStore.getState().openGraphTab(),
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
    // Skills
    {
      id: "skill:new",
      label: "New Skill from Template",
      category: "Skills",
      action: () => {
        useUIStore.getState().toggleNewSkillDialog();
      },
    },
    {
      id: "skill:generate",
      label: "AI: Generate Skill",
      category: "Skills",
      action: () => {
        useUIStore.getState().toggleSkillGeneratorDialog();
      },
    },
    {
      id: "skill:test",
      label: "AI: Test Skill",
      category: "Skills",
      shortcut: "\u21E7\u2318T",
      action: () => {
        useUIStore.getState().toggleSkillTestDialog();
      },
    },
    {
      id: "skills-preview",
      label: "Skills: Preview as LLM Input",
      category: "Skills",
      shortcut: "",
      action: () => onSkillPreview(),
    },
    {
      id: "skill:gallery",
      label: "Skills: Open Gallery",
      category: "Skills",
      action: () => {
        useUIStore.getState().setSidebarPanel("skills-gallery");
        if (!useUIStore.getState().sidebarOpen) {
          useUIStore.getState().toggleSidebar();
        }
      },
    },
    // §57b Git commands
    {
      id: "git:commit",
      label: "Git: Commit",
      category: "Git",
      action: () => {
        const rootPath = useFileStore.getState().rootPath;
        if (!rootPath) return;
        const { commitChanges } = useGitStore.getState();
        commitChanges(rootPath);
      },
    },
    {
      id: "git:stage-all",
      label: "Git: Stage All Changes",
      category: "Git",
      action: () => {
        const rootPath = useFileStore.getState().rootPath;
        if (!rootPath) return;
        useGitStore.getState().stageAll(rootPath);
      },
    },
    {
      id: "git:unstage-all",
      label: "Git: Unstage All",
      category: "Git",
      action: () => {
        const rootPath = useFileStore.getState().rootPath;
        if (!rootPath) return;
        useGitStore.getState().unstageAll(rootPath);
      },
    },
    {
      id: "git:switch-branch",
      label: "Git: Switch Branch",
      category: "Git",
      action: () => {
        useUIStore.getState().setSidebarPanel("git");
        if (!useUIStore.getState().sidebarOpen) {
          useUIStore.getState().toggleSidebar();
        }
        useGitStore.getState().setShowBranchPicker(true);
      },
    },
    {
      id: "git:refresh",
      label: "Git: Refresh Status",
      category: "Git",
      action: () => {
        const rootPath = useFileStore.getState().rootPath;
        if (!rootPath) return;
        useGitStore.getState().refresh(rootPath);
      },
    },
    {
      id: "git:source-control",
      label: "Git: Open Source Control Panel",
      category: "Git",
      action: () => {
        useUIStore.getState().setSidebarPanel("git");
        if (!useUIStore.getState().sidebarOpen) {
          useUIStore.getState().toggleSidebar();
        }
      },
    },
    // §6.2 Selection-based AI commands
    {
      id: "ai:translate",
      label: "Translate Selection",
      category: "AI",
      action: async (editor) => {
        if (!editor) return;
        const selection = getSelectedText(editor);
        if (!selection) {
          await showPrompt("Please select text to translate.");
          return;
        }
        const lang = await showPrompt("Target language:", "", {
          presets: ["English", "Korean"],
        });
        if (!lang) return;
        executeAICommand(
          editor,
          `Translate to ${lang}:\n\n${selection}`,
          "You are a translation assistant. Translate the text to the specified language. Output only the translated text, no explanations.",
          { afterSelection: true },
        );
      },
    },
    {
      id: "ai:summarize",
      label: "Summarize Selection",
      category: "AI",
      action: async (editor) => {
        if (!editor) return;
        const selection = getSelectedText(editor);
        if (!selection) {
          await showPrompt("Please select text to summarize.");
          return;
        }
        executeAICommand(
          editor,
          selection,
          "You are a summarization assistant. Summarize the given text concisely in markdown. Output only the summary.",
          { afterSelection: true },
        );
      },
    },
    {
      id: "ai:expand",
      label: "Expand Selection",
      category: "AI",
      action: async (editor) => {
        if (!editor) return;
        const selection = getSelectedText(editor);
        if (!selection) {
          await showPrompt("Please select text to expand.");
          return;
        }
        executeAICommand(
          editor,
          selection,
          "You are a writing assistant. Expand the given text with more details, examples, and explanations. Output in markdown.",
          { afterSelection: true },
        );
      },
    },
    {
      id: "ai:fix-grammar",
      label: "Fix Grammar",
      category: "AI",
      action: (editor) => {
        if (!editor) return;
        const text = getSelectionOrParagraph(editor);
        if (!text) return;
        executeAICommand(
          editor,
          text,
          "You are a grammar checker. Fix grammar and spelling errors in the given text. Return only the corrected text, no explanations.",
          { afterSelection: true },
        );
      },
    },
    {
      id: "ai:explain",
      label: "Explain Selection",
      category: "AI",
      action: async (editor) => {
        if (!editor) return;
        const selection = getSelectedText(editor);
        if (!selection) {
          await showPrompt("Please select text to explain.");
          return;
        }
        executeAICommand(
          editor,
          selection,
          "You are an explanation assistant. Explain the given text clearly and concisely in markdown.",
          { afterSelection: true },
        );
      },
    },
    // §52 Workspace Presets
    {
      id: "workspace:writing",
      label: "Workspace: 글쓰기",
      category: "Workspace",
      shortcut: "⌥⌘1",
      action: () => useWorkspaceStore.getState().applyPreset("writing"),
    },
    {
      id: "workspace:journal",
      label: "Workspace: 저널",
      category: "Workspace",
      shortcut: "⌥⌘2",
      action: () => useWorkspaceStore.getState().applyPreset("journal"),
    },
    {
      id: "journal:open-today",
      label: "Open Today's Journal",
      category: "Journal",
      action: () => useWorkspaceStore.getState().applyPreset("journal"),
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
  onSkillPreview?: () => void;
}

export function CommandPalette({
  editor,
  onToggleSourceMode,
  onNewFile,
  onOpenFile,
  onSave,
  onOpenFolder,
  onSkillPreview,
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
        onSkillPreview ?? (() => {}),
      ),
    [toggleSidebar, onToggleSourceMode, onNewFile, onOpenFile, onSave, onOpenFolder, onSkillPreview],
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
