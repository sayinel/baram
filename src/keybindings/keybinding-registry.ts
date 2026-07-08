/**
 * Keybinding Registry — central source of truth for all keyboard shortcuts.
 * §settings: keybinding customization support
 */

export interface KeybindingEntry {
  category: string; // "file" | "edit" | "view" | "search" | "insert" | "ai" | "workspace" | "journal" | "zettelkasten" | "formatting"
  customizable: boolean; // true = global shortcut, false = Tiptap extension
  defaultKey: string; // Platform-independent: "Mod+S"
  id: string; // e.g. "file.save"
  label: string; // i18n key e.g. "keybindings.file.save"
}

export const KEYBINDING_CATEGORIES: string[] = [
  "file",
  "edit",
  "view",
  "search",
  "insert",
  "ai",
  "workspace",
  "journal",
  "zettelkasten",
  "formatting",
];

export const CATEGORY_LABELS: Record<string, string> = {
  file: "keybindings.category.file",
  edit: "keybindings.category.edit",
  view: "keybindings.category.view",
  search: "keybindings.category.search",
  insert: "keybindings.category.insert",
  ai: "keybindings.category.ai",
  workspace: "keybindings.category.workspace",
  journal: "keybindings.category.journal",
  zettelkasten: "keybindings.category.zettelkasten",
  formatting: "keybindings.category.formatting",
};

export const KEYBINDING_REGISTRY: KeybindingEntry[] = [
  // ── file ──────────────────────────────────────────────────────────────────
  {
    id: "file.new",
    label: "keybindings.file.new",
    category: "file",
    defaultKey: "Mod+N",
    customizable: true,
  },
  {
    id: "file.open",
    label: "keybindings.file.open",
    category: "file",
    defaultKey: "Mod+O",
    customizable: true,
  },
  {
    id: "file.openFolder",
    label: "keybindings.file.openFolder",
    category: "file",
    defaultKey: "Mod+Shift+O",
    customizable: true,
  },
  {
    id: "file.save",
    label: "keybindings.file.save",
    category: "file",
    defaultKey: "Mod+S",
    customizable: true,
  },
  {
    id: "file.saveAs",
    label: "keybindings.file.saveAs",
    category: "file",
    defaultKey: "Mod+Shift+S",
    customizable: true,
  },
  {
    id: "file.closeTab",
    label: "keybindings.file.closeTab",
    category: "file",
    defaultKey: "Mod+W",
    customizable: true,
  },
  {
    id: "file.closeFolder",
    label: "keybindings.file.closeFolder",
    category: "file",
    defaultKey: "Mod+Shift+W",
    customizable: true,
  },

  // ── edit ──────────────────────────────────────────────────────────────────
  {
    id: "edit.find",
    label: "keybindings.edit.find",
    category: "edit",
    defaultKey: "Mod+F",
    customizable: true,
  },
  {
    id: "edit.findReplace",
    label: "keybindings.edit.findReplace",
    category: "edit",
    defaultKey: "Mod+H",
    customizable: true,
  },
  {
    id: "edit.toggleFold",
    label: "keybindings.edit.toggleFold",
    category: "edit",
    defaultKey: "Mod+Shift+[",
    customizable: true,
  },
  {
    id: "edit.foldAll",
    label: "keybindings.edit.foldAll",
    category: "edit",
    defaultKey: "Mod+Shift+Alt+[",
    customizable: true,
  },
  {
    id: "edit.unfoldAll",
    label: "keybindings.edit.unfoldAll",
    category: "edit",
    defaultKey: "Mod+Shift+Alt+]",
    customizable: true,
  },

  // ── view ──────────────────────────────────────────────────────────────────
  {
    id: "view.sourceMode",
    label: "keybindings.view.sourceMode",
    category: "view",
    defaultKey: "Mod+/",
    customizable: true,
  },
  {
    id: "view.toggleSidebar",
    label: "keybindings.view.toggleSidebar",
    category: "view",
    defaultKey: "Mod+Shift+L",
    customizable: true,
  },
  {
    id: "view.commandPalette",
    label: "keybindings.view.commandPalette",
    category: "view",
    defaultKey: "Mod+P",
    customizable: true,
  },
  {
    id: "view.quickSwitcher",
    label: "keybindings.view.quickSwitcher",
    category: "view",
    defaultKey: "Mod+K",
    customizable: true,
  },
  {
    id: "view.settings",
    label: "keybindings.view.settings",
    category: "view",
    defaultKey: "Mod+,",
    customizable: true,
  },
  {
    id: "view.bookmark",
    label: "keybindings.view.bookmark",
    category: "view",
    defaultKey: "Mod+D",
    customizable: true,
  },

  // ── search ────────────────────────────────────────────────────────────────
  {
    id: "search.globalSearch",
    label: "keybindings.search.globalSearch",
    category: "search",
    defaultKey: "Mod+Shift+F",
    customizable: true,
  },
  {
    id: "search.backlinks",
    label: "keybindings.search.backlinks",
    category: "search",
    defaultKey: "Mod+Shift+B",
    customizable: true,
  },

  // ── insert ────────────────────────────────────────────────────────────────
  {
    id: "insert.table",
    label: "keybindings.insert.table",
    category: "insert",
    defaultKey: "Mod+T",
    customizable: true,
  },
  {
    id: "insert.inlineAI",
    label: "keybindings.insert.inlineAI",
    category: "insert",
    defaultKey: "Mod+J",
    customizable: true,
  },

  // ── ai ────────────────────────────────────────────────────────────────────
  {
    id: "ai.chatPanel",
    label: "keybindings.ai.chatPanel",
    category: "ai",
    defaultKey: "Mod+Shift+A",
    customizable: true,
  },
  {
    id: "ai.ghostText",
    label: "keybindings.ai.ghostText",
    category: "ai",
    defaultKey: "Mod+Shift+G",
    customizable: true,
  },
  {
    id: "ai.skillTest",
    label: "keybindings.ai.skillTest",
    category: "ai",
    defaultKey: "Mod+Shift+T",
    customizable: true,
  },

  // ── workspace ─────────────────────────────────────────────────────────────
  {
    id: "workspace.writing",
    label: "keybindings.workspace.writing",
    category: "workspace",
    defaultKey: "Mod+Alt+1",
    customizable: true,
  },
  {
    id: "workspace.journal",
    label: "keybindings.workspace.journal",
    category: "workspace",
    defaultKey: "Mod+Alt+3",
    customizable: true,
  },
  {
    id: "workspace.zettelkasten",
    label: "keybindings.workspace.zettelkasten",
    category: "workspace",
    defaultKey: "Mod+Alt+2",
    customizable: true,
  },
  {
    id: "workspace.skills",
    label: "keybindings.workspace.skills",
    category: "workspace",
    defaultKey: "Mod+Alt+4",
    customizable: true,
  },

  // ── journal ───────────────────────────────────────────────────────────────
  {
    id: "journal.quickCapture",
    label: "keybindings.journal.quickCapture",
    category: "journal",
    defaultKey: "Mod+Shift+N",
    customizable: true,
  },
  {
    id: "journal.openToday",
    label: "keybindings.journal.openToday",
    category: "journal",
    defaultKey: "Mod+Shift+J",
    customizable: true,
  },
  {
    id: "journal.memories",
    label: "keybindings.journal.memories",
    category: "journal",
    defaultKey: "Mod+Shift+R",
    customizable: true,
  },
  {
    id: "journal.photoGallery",
    label: "keybindings.journal.photoGallery",
    category: "journal",
    defaultKey: "Mod+Shift+I",
    customizable: true,
  },

  // ── zettelkasten ──────────────────────────────────────────────────────────
  {
    id: "zettelkasten.newNote",
    label: "keybindings.zettelkasten.newNote",
    category: "zettelkasten",
    // Mod+Shift+K collides with common global launchers (e.g. ChatGPT); K/N/Q/Z
    // are otherwise taken or system-reserved, so use Mod+Shift+V (free everywhere).
    defaultKey: "Mod+Shift+V",
    customizable: true,
  },
  {
    id: "zettelkasten.promote",
    label: "keybindings.zettelkasten.promote",
    category: "zettelkasten",
    // Mod+Shift+P is grabbed by the native menu (Command Palette, menu.rs);
    // Mod+Shift+E by Export. Use keys free in BOTH the registry and menu.rs.
    defaultKey: "Mod+Shift+U",
    customizable: true,
  },
  {
    id: "zettelkasten.newFromSelection",
    label: "keybindings.zettelkasten.newFromSelection",
    category: "zettelkasten",
    defaultKey: "Mod+Shift+Y",
    customizable: true,
  },
  {
    // §97 basic MOC.
    id: "zettelkasten.newMoc",
    label: "keybindings.zettelkasten.newMoc",
    category: "zettelkasten",
    defaultKey: "Mod+Shift+C",
    customizable: true,
  },

  // ── formatting (Tiptap extension shortcuts — read-only) ───────────────────
  {
    id: "formatting.bold",
    label: "keybindings.formatting.bold",
    category: "formatting",
    defaultKey: "Mod+B",
    customizable: false,
  },
  {
    id: "formatting.italic",
    label: "keybindings.formatting.italic",
    category: "formatting",
    defaultKey: "Mod+I",
    customizable: false,
  },
  {
    id: "formatting.underline",
    label: "keybindings.formatting.underline",
    category: "formatting",
    defaultKey: "Mod+U",
    customizable: false,
  },
  {
    id: "formatting.strikethrough",
    label: "keybindings.formatting.strikethrough",
    category: "formatting",
    defaultKey: "Mod+Shift+X",
    customizable: false,
  },
  {
    id: "formatting.highlight",
    label: "keybindings.formatting.highlight",
    category: "formatting",
    defaultKey: "Mod+Shift+H",
    customizable: false,
  },
  {
    id: "formatting.inlineCode",
    label: "keybindings.formatting.inlineCode",
    category: "formatting",
    defaultKey: "Mod+E",
    customizable: false,
  },
  {
    id: "formatting.codeBlock",
    label: "keybindings.formatting.codeBlock",
    category: "formatting",
    defaultKey: "Mod+Alt+C",
    customizable: false,
  },
  {
    id: "formatting.mathBlock",
    label: "keybindings.formatting.mathBlock",
    category: "formatting",
    defaultKey: "Mod+Shift+M",
    customizable: false,
  },
  {
    id: "formatting.heading1",
    label: "keybindings.formatting.heading1",
    category: "formatting",
    defaultKey: "Mod+1",
    customizable: false,
  },
  {
    id: "formatting.heading2",
    label: "keybindings.formatting.heading2",
    category: "formatting",
    defaultKey: "Mod+2",
    customizable: false,
  },
  {
    id: "formatting.heading3",
    label: "keybindings.formatting.heading3",
    category: "formatting",
    defaultKey: "Mod+3",
    customizable: false,
  },
  {
    id: "formatting.bulletList",
    label: "keybindings.formatting.bulletList",
    category: "formatting",
    defaultKey: "Mod+Shift+8",
    customizable: false,
  },
  {
    id: "formatting.orderedList",
    label: "keybindings.formatting.orderedList",
    category: "formatting",
    defaultKey: "Mod+Shift+7",
    customizable: false,
  },
  {
    id: "formatting.taskList",
    label: "keybindings.formatting.taskList",
    category: "formatting",
    defaultKey: "Mod+Shift+9",
    customizable: false,
  },
  {
    id: "formatting.mermaid",
    label: "keybindings.formatting.mermaid",
    category: "formatting",
    defaultKey: "Mod+Shift+D",
    customizable: false,
  },
  {
    id: "formatting.blockquote",
    label: "keybindings.formatting.blockquote",
    category: "formatting",
    defaultKey: "Mod+Shift+B",
    customizable: false,
  },
  {
    id: "formatting.link",
    label: "keybindings.formatting.link",
    category: "formatting",
    defaultKey: "Mod+K",
    customizable: false,
  },
  {
    id: "formatting.tableMerge",
    label: "keybindings.formatting.tableMerge",
    category: "formatting",
    defaultKey: "Mod+M",
    customizable: false,
  },
  {
    id: "formatting.toggleBlock",
    label: "keybindings.formatting.toggleBlock",
    category: "formatting",
    defaultKey: "Mod+Enter",
    customizable: false,
  },
];

/**
 * Groups registry entries by category, preserving KEYBINDING_CATEGORIES order.
 */
export function getKeybindingsByCategory(): Map<string, KeybindingEntry[]> {
  const map = new Map<string, KeybindingEntry[]>();
  for (const cat of KEYBINDING_CATEGORIES) {
    map.set(cat, []);
  }
  for (const entry of KEYBINDING_REGISTRY) {
    const bucket = map.get(entry.category);
    if (bucket) bucket.push(entry);
  }
  return map;
}
