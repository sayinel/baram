// §4.5 Command Palette — command data table, extracted from CommandPalette.tsx
// so the component file stays focused on rendering/interaction.
import type { CommandItem } from "./CommandPalette";

import { chainWithVimExternalEdit } from "../../extensions/plugins/vim/vim-keys";
import { getAction } from "../../keybindings/keybinding-actions";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useWorkspaceStore } from "../../stores/file/workspace";
import { useGitStore } from "../../stores/system/git";
import { useUIStore } from "../../stores/ui/ui";
import {
  executeAICommand,
  getSelectedText,
  getSelectionOrParagraph,
  showPrompt,
} from "../../utils/ai-commands";
import { awaitBoundToEditor } from "../../utils/editor/mutation-tasks";

export interface CommandDeps {
  onCloseFolder: () => void;
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSkillPreview: () => void;
  toggleSidebar: () => void;
  toggleSourceMode: () => void;
}

export function buildCommands(deps: CommandDeps): CommandItem[] {
  const {
    toggleSidebar,
    toggleSourceMode,
    onNewFile,
    onOpenFile,
    onSave,
    onOpenFolder,
    onSkillPreview,
    onCloseFolder,
  } = deps;
  return [
    // File
    {
      id: "file:new",
      label: "New File",
      category: "File",
      shortcut: "⌘N",
      action: () => onNewFile(),
    },
    {
      id: "file:new-work-log",
      label: "New Work Log for Today",
      category: "File",
      action: async () => {
        const { createWorkLogForToday } = await import("../../utils/work-log");
        await createWorkLogForToday();
      },
    },
    {
      id: "file:open",
      label: "Open File",
      category: "File",
      shortcut: "⌘O",
      action: () => onOpenFile(),
    },
    {
      id: "file:save",
      label: "Save",
      category: "File",
      shortcut: "⌘S",
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
      id: "workspace:close-folder",
      label: "Close Folder",
      category: "File",
      action: () => onCloseFolder(),
    },
    {
      id: "file:export",
      label: "Export...",
      category: "File",
      shortcut: "⇧⌘E",
      action: () => useUIStore.getState().openExportDialog("pdf"),
    },
    // View
    {
      id: "view:source-mode",
      label: "Toggle Source Mode",
      category: "View",
      shortcut: "⌘/",
      action: () => toggleSourceMode(),
    },
    {
      id: "view:toggle-sidebar",
      label: "Toggle Sidebar",
      category: "View",
      shortcut: "⇧⌘L",
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
      shortcut: "⌘1",
      action: (editor) =>
        chainWithVimExternalEdit(editor)
          ?.focus()
          .toggleHeading({ level: 1 })
          .run(),
    },
    {
      id: "insert:h2",
      label: "Heading 2",
      category: "Insert",
      shortcut: "⌘2",
      action: (editor) =>
        chainWithVimExternalEdit(editor)
          ?.focus()
          .toggleHeading({ level: 2 })
          .run(),
    },
    {
      id: "insert:h3",
      label: "Heading 3",
      category: "Insert",
      shortcut: "⌘3",
      action: (editor) =>
        chainWithVimExternalEdit(editor)
          ?.focus()
          .toggleHeading({ level: 3 })
          .run(),
    },
    // Insert — Blocks
    {
      id: "insert:bullet-list",
      label: "Unordered List",
      category: "Insert",
      shortcut: "⇧⌘8",
      action: (editor) =>
        chainWithVimExternalEdit(editor)?.focus().toggleBulletList().run(),
    },
    {
      id: "insert:ordered-list",
      label: "Ordered List",
      category: "Insert",
      shortcut: "⇧⌘7",
      action: (editor) =>
        chainWithVimExternalEdit(editor)?.focus().toggleOrderedList().run(),
    },
    {
      id: "insert:task-list",
      label: "Task List",
      category: "Insert",
      action: (editor) =>
        chainWithVimExternalEdit(editor)?.focus().toggleTaskList().run(),
    },
    {
      id: "insert:blockquote",
      label: "Blockquote",
      category: "Insert",
      shortcut: "⇧⌘>",
      action: (editor) =>
        chainWithVimExternalEdit(editor)?.focus().toggleBlockquote().run(),
    },
    {
      id: "insert:code-block",
      label: "Code Block",
      category: "Insert",
      shortcut: "⇧⌘C",
      action: (editor) =>
        chainWithVimExternalEdit(editor)?.focus().toggleCodeBlock().run(),
    },
    {
      id: "insert:horizontal-rule",
      label: "Horizontal Rule",
      category: "Insert",
      action: (editor) =>
        chainWithVimExternalEdit(editor)?.focus().setHorizontalRule().run(),
    },
    {
      id: "insert:table",
      label: "Table",
      category: "Insert",
      action: (editor) =>
        chainWithVimExternalEdit(editor)
          ?.focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    // Format
    {
      id: "format:bold",
      label: "Bold",
      category: "Format",
      shortcut: "⌘B",
      action: (editor) =>
        chainWithVimExternalEdit(editor)?.focus().toggleBold().run(),
    },
    {
      id: "format:italic",
      label: "Italic",
      category: "Format",
      shortcut: "⌘I",
      action: (editor) =>
        chainWithVimExternalEdit(editor)?.focus().toggleItalic().run(),
    },
    {
      id: "format:strikethrough",
      label: "Strikethrough",
      category: "Format",
      shortcut: "⇧⌘X",
      action: (editor) =>
        chainWithVimExternalEdit(editor)?.focus().toggleStrike().run(),
    },
    {
      id: "format:inline-code",
      label: "Inline Code",
      category: "Format",
      shortcut: "⌘E",
      action: (editor) =>
        chainWithVimExternalEdit(editor)?.focus().toggleCode().run(),
    },
    // Skills
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
      shortcut: "⇧⌘T",
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
        // §12-9d (design §5c): the selection came from THIS document — hold
        // it with a bound task so a state install during the prompt cannot
        // land the translation in the replacing document.
        const lang = await awaitBoundToEditor(
          editor.view,
          showPrompt("Target language:", "", {
            presets: ["English", "Korean"],
          }),
        );
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
      label: "화면구성: 글쓰기",
      category: "화면구성",
      shortcut: "⌥⌘1",
      action: () => useWorkspaceStore.getState().applyPreset("writing"),
    },
    {
      id: "workspace:journal",
      label: "화면구성: 저널",
      category: "화면구성",
      shortcut: "⌥⌘2",
      action: () => useWorkspaceStore.getState().applyPreset("journal"),
    },
    {
      id: "space.zettelkasten",
      label: "Open Zettel",
      category: "화면구성",
      action: () => useWorkspaceStore.getState().applyPreset("zettelkasten"),
    },
    {
      id: "journal:open-today",
      label: "Open Today's Journal",
      category: "Journal",
      // ‼️ Do NOT "simplify" this to getAction("journal.openToday"). Both open
      // today's entry — the preset via the journal space's newFileFlow — but only
      // the preset ACTIVATES the journal context, and `editor.ts` fills an empty
      // contextId from the active context, so the action's tab would be owned by
      // whichever vault was active and would be closed with it (ContextTabBar).
      // The preset also applies the journal layout. (Registration is no longer a
      // difference: `ensureJournalFile` registers the directory itself, without
      // activating — see ensureJournalDirRegistered.)
      action: () => useWorkspaceStore.getState().applyPreset("journal"),
    },
    {
      id: "zettelkasten:new-note",
      label: "New Zettel",
      category: "Journal",
      shortcut: "⇧⌘V",
      action: () => getAction("zettelkasten.newNote")?.(),
    },
    {
      id: "zettelkasten:new-moc",
      label: "New MOC",
      category: "Journal",
      shortcut: "⇧⌘C",
      action: () => getAction("zettelkasten.newMoc")?.(),
    },
    {
      id: "zettelkasten:promote",
      label: "Promote to Permanent Note",
      category: "Journal",
      shortcut: "⇧⌘U",
      action: () => getAction("zettelkasten.promote")?.(),
    },
    {
      id: "zettelkasten:new-from-selection",
      label: "New Note from Selection",
      category: "Journal",
      shortcut: "⇧⌘Y",
      action: () => getAction("zettelkasten.newFromSelection")?.(),
    },
  ];
}
