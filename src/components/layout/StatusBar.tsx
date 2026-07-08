// §4.8 Status bar — word count, cursor position, mode indicator, git branch
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import {
  Calendar,
  ChevronDown,
  Pencil,
  Star,
  StickyNote,
  Zap,
} from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useResolvedSettings } from "../../hooks/use-resolved-settings";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import {
  BUILTIN_PRESETS,
  useWorkspaceStore,
} from "../../stores/file/workspace";
import { useSettingsStore } from "../../stores/settings/store";
import { useGitStore } from "../../stores/system/git";
import {
  loadFavorites,
  toggleFavorite,
  useZettelFavoritesStore,
} from "../../stores/zettelkasten/zettel-favorites";
import { basename } from "../../utils/path-utils";
import { extractLeadingId } from "../../utils/zettelkasten/parse-note-title";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";
import "../../styles/zettelkasten.css";

export type EditorMode = "graph" | "source" | "wysiwyg";

const MODE_LABELS: Record<EditorMode, string> = {
  graph: "Graph",
  source: "Source",
  wysiwyg: "WYSIWYG",
};

const SPACE_ICONS: Record<string, typeof Pencil> = {
  writing: Pencil,
  journal: Calendar,
  zettelkasten: StickyNote,
  skills: Zap,
};

interface StatusBarProps {
  editor: Editor | null;
  mode: EditorMode;
}

export function StatusBar({ editor, mode }: StatusBarProps) {
  const stats = useMemo(() => {
    if (!editor) return { words: 0, chars: 0, line: 0, col: 0 };

    const text = editor.state.doc.textContent;
    const words = countWords(text);
    const chars = text.length;

    // Get cursor position
    const { from } = editor.state.selection;
    const resolved = editor.state.doc.resolve(from);
    const col = from - resolved.start(resolved.depth) + 1;
    let line = 0;
    editor.state.doc.nodesBetween(0, from, (node) => {
      if (node.isBlock && node.isTextblock) {
        line++;
      }
    });
    if (line === 0) line = 1;

    return { words, chars, line, col };
  }, [editor]);

  const { isRepo, branch, changes } = useGitStore(
    useShallow((s) => ({
      isRepo: s.isRepo,
      branch: s.branch,
      changes: s.changes,
    })),
  );
  const hasChanges = changes.length > 0;
  // §86 Use vault-scoped resolved settings for privacy mode
  const resolved = useResolvedSettings();
  const privacyMode = resolved.aiPrivacyMode ?? false;
  const zoomLevel = useSettingsStore((s) => s.zoomLevel);
  const zoomPercent = Math.round(zoomLevel * 100);

  const { activePresetId, applyPreset } = useWorkspaceStore(
    useShallow((s) => ({
      activePresetId: s.activePresetId,
      applyPreset: s.applyPreset,
    })),
  );

  // §102 Favorite-toggle star for the active permanent Zettel note.
  const { zettelkastenDirectory, zettelkastenEnabled } = useSettingsStore(
    useShallow((s) => ({
      zettelkastenEnabled: s.zettelkastenEnabled,
      zettelkastenDirectory: s.zettelkastenDirectory,
    })),
  );
  const { rootPath } = useFileStore(
    useShallow((s) => ({ rootPath: s.rootPath })),
  );
  const zettelDir = resolveZettelDir(rootPath, zettelkastenDirectory);
  const activeFilePath = useEditorStore(
    useShallow(
      (s) => s.tabs.find((t) => t.id === s.activeTabId)?.filePath ?? "",
    ),
  );
  const favoriteIds = useZettelFavoritesStore((s) => s.favoriteIds);
  const activeNoteId =
    zettelkastenEnabled &&
    zettelDir &&
    activeFilePath.startsWith(`${zettelDir}/notes/`)
      ? extractLeadingId(basename(activeFilePath))
      : null;
  const isFavoriteNote = activeNoteId
    ? favoriteIds.includes(activeNoteId)
    : false;

  useEffect(() => {
    if (zettelkastenEnabled && zettelDir) void loadFavorites(zettelDir);
  }, [zettelkastenEnabled, zettelDir]);

  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);
  const spaceMenuRef = useRef<HTMLDivElement>(null);

  const handleSpaceSelect = useCallback(
    (id: string) => {
      applyPreset(id);
      setSpaceMenuOpen(false);
    },
    [applyPreset],
  );

  useEffect(() => {
    if (!spaceMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        spaceMenuRef.current &&
        !spaceMenuRef.current.contains(e.target as Node)
      ) {
        setSpaceMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [spaceMenuOpen]);

  const currentPreset = BUILTIN_PRESETS.find((p) => p.id === activePresetId);
  const SpaceIcon = (activePresetId && SPACE_ICONS[activePresetId]) || Pencil;
  const spaceLabel = currentPreset?.name ?? "Default";

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <div className="status-space-wrapper" ref={spaceMenuRef}>
          <button
            className="status-space-btn"
            onClick={() => setSpaceMenuOpen((v) => !v)}
            title="Switch Space"
          >
            <SpaceIcon size={12} strokeWidth={1.5} />
            {spaceLabel}
            <ChevronDown size={10} strokeWidth={1.5} />
          </button>
          {spaceMenuOpen && (
            <div className="status-space-menu">
              {BUILTIN_PRESETS.map((preset) => {
                const Icon = SPACE_ICONS[preset.id] || Pencil;
                return (
                  <button
                    className={`status-space-menu-item ${activePresetId === preset.id ? "status-space-menu-active" : ""}`}
                    key={preset.id}
                    onClick={() => handleSpaceSelect(preset.id)}
                  >
                    <Icon size={12} strokeWidth={1.5} />
                    {preset.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <span className="status-mode">{MODE_LABELS[mode]}</span>
        {isRepo && branch && (
          <span
            className={`status-git-branch ${hasChanges ? "status-git-dirty" : ""}`}
            title={`Branch: ${branch}${hasChanges ? ` (${changes.length} changes)` : ""}`}
          >
            ⎇ {branch}
            {hasChanges && <span className="status-git-dot" />}
          </span>
        )}
        {privacyMode && (
          <span
            className="status-privacy"
            data-testid="privacy-indicator"
            title="Privacy Mode: Only local models (Ollama) allowed"
          >
            Privacy
          </span>
        )}
        {activeNoteId && (
          <button
            aria-label={isFavoriteNote ? "Unfavorite" : "Favorite"}
            className={`status-fav-btn btn-unstyled icon-btn${
              isFavoriteNote ? "status-fav-active" : ""
            }`}
            onClick={() => {
              if (zettelDir && activeNoteId)
                void toggleFavorite(zettelDir, activeNoteId).catch(() => {});
            }}
            title={
              isFavoriteNote ? "Remove from favorites" : "Add to favorites"
            }
          >
            <Star
              fill={isFavoriteNote ? "currentColor" : "none"}
              size={12}
              strokeWidth={1.5}
            />
          </button>
        )}
      </div>
      {mode !== "graph" && (
        <div className="status-bar-right">
          <span
            className="status-words cursor-default"
            title={`${stats.chars} characters`}
          >
            {stats.words} words
          </span>
          <span className="status-separator">|</span>
          <span className="status-position cursor-default">
            Ln {stats.line}, Col {stats.col}
          </span>
          {zoomPercent !== 100 && (
            <>
              <span className="status-separator">|</span>
              <span className="status-zoom" title="Cmd+0 to reset zoom">
                {zoomPercent}%
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
