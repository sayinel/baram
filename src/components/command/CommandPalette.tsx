import { useCallback, useMemo, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { useShallow } from "zustand/shallow";

// §4.5 Command Palette — Cmd+P
import { executePluginCommand } from "../../plugins/extension-context";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { useUIStore } from "../../stores/ui/ui";
import { fuzzyMatch } from "../../utils/file-search";
import { buildCommands } from "./command-registry";
import { PaletteOverlay } from "./PaletteOverlay";
import { usePaletteListNav } from "./use-palette-list-nav";

export interface CommandItem {
  action: (editor: Editor | null) => void;
  category: string;
  id: string;
  label: string;
  shortcut?: string;
}

interface CommandPaletteProps {
  editor: Editor | null;
  onCloseFolder: () => void;
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSkillPreview?: () => void;
  onToggleSourceMode: () => void;
}

export function CommandPalette({
  editor,
  onToggleSourceMode,
  onNewFile,
  onOpenFile,
  onSave,
  onOpenFolder,
  onSkillPreview,
  onCloseFolder,
}: CommandPaletteProps) {
  const { commandPaletteOpen, toggleCommandPalette, toggleSidebar } =
    useUIStore(
      useShallow((s) => ({
        commandPaletteOpen: s.commandPaletteOpen,
        toggleCommandPalette: s.toggleCommandPalette,
        toggleSidebar: s.toggleSidebar,
      })),
    );
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pluginPaletteCommands = usePluginUIStore(
    useShallow((s) => s.paletteCommands),
  );

  const commands = useMemo(() => {
    const base = buildCommands({
      toggleSidebar,
      toggleSourceMode: onToggleSourceMode,
      onNewFile,
      onOpenFile,
      onSave,
      onOpenFolder,
      onSkillPreview: onSkillPreview ?? (() => {}),
      onCloseFolder,
    });
    const plugin: CommandItem[] = pluginPaletteCommands.map((c) => ({
      action: () => {
        void executePluginCommand(c.commandId).catch((err) =>
          useUIStore.getState().showToast(String(err), "error"),
        );
      },
      category: "Plugin",
      id: c.commandId,
      label: c.title,
    }));
    return [...base, ...plugin];
  }, [
    toggleSidebar,
    onToggleSourceMode,
    onNewFile,
    onOpenFile,
    onSave,
    onOpenFolder,
    onSkillPreview,
    onCloseFolder,
    pluginPaletteCommands,
  ]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    return commands.filter(
      (cmd) => fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.category),
    );
  }, [query, commands]);

  const executeCommand = useCallback(
    (cmd: CommandItem) => {
      toggleCommandPalette();
      cmd.action(editor);
    },
    [editor, toggleCommandPalette],
  );

  const handleOpen = useCallback(() => {
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleEnter = useCallback(
    (index: number) => {
      executeCommand(filtered[index]);
    },
    [filtered, executeCommand],
  );

  const { handleKeyDown, selectedIndex, setSelectedIndex } = usePaletteListNav({
    isOpen: commandPaletteOpen,
    itemCount: filtered.length,
    onEnter: handleEnter,
    onEscape: toggleCommandPalette,
    onOpen: handleOpen,
  });

  // Group by category and assign stable flat indices — outside render body to avoid
  // mutation during React Strict Mode double-render.
  const { groups, flatItems } = useMemo(() => {
    const groupMap = new Map<string, { cmd: CommandItem; idx: number }[]>();
    let index = 0;
    for (const cmd of filtered) {
      const list = groupMap.get(cmd.category) || [];
      list.push({ cmd, idx: index++ });
      groupMap.set(cmd.category, list);
    }
    return { groups: groupMap, flatItems: filtered };
  }, [filtered]);

  if (!commandPaletteOpen) return null;

  return (
    <PaletteOverlay
      onClose={toggleCommandPalette}
      onKeyDown={handleKeyDown}
      overlayClassName="command-palette-overlay"
      paletteClassName="command-palette"
    >
      <input
        className="command-palette-input"
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedIndex(0);
        }}
        placeholder="Type a command..."
        ref={inputRef}
        type="text"
        value={query}
      />
      <div className="command-palette-list">
        {flatItems.length === 0 && (
          <div className="command-palette-empty">No commands found</div>
        )}
        {Array.from(groups.entries()).map(([category, items]) => (
          <div className="command-palette-group" key={category}>
            <div className="command-palette-category">{category}</div>
            {items.map(({ cmd, idx }) => (
              <div
                className={`command-palette-item ${idx === selectedIndex ? "command-palette-item-selected" : ""}`}
                key={cmd.id}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="command-item-label">{cmd.label}</span>
                {cmd.shortcut && (
                  <span className="command-item-shortcut">{cmd.shortcut}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </PaletteOverlay>
  );
}
