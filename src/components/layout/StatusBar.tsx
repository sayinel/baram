// §4.8 Status bar — word count, cursor position, mode indicator, git branch
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import {
  Calendar,
  ChevronDown,
  PanelsTopLeft,
  Pencil,
  Star,
  StickyNote,
  Zap,
} from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useResolvedSettings } from "../../hooks/use-resolved-settings";
import { useTranslation } from "../../i18n/useTranslation";
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
import { subscribeContentLoaded } from "../../utils/editor/programmatic-update";
import { basename } from "../../utils/path-utils";
import { extractLeadingId } from "../../utils/zettelkasten/parse-note-title";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";
import "../../styles/zettelkasten.css";
import { PluginStatusBarItems } from "./PluginStatusBarItems";

export type EditorMode = "graph" | "preview" | "source" | "wysiwyg";

const MODE_LABELS: Record<EditorMode, string> = {
  graph: "Graph",
  preview: "Preview",
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
  // §4.8 Live word count + cursor position. The Tiptap Editor instance is a
  // stable reference whose `.state` mutates in place, so a `useMemo([editor])`
  // never recomputes on typing or cursor moves — it stayed frozen at the empty
  // document's 0 words / Ln 1, Col 1. Subscribe to editor events instead.
  const [stats, setStats] = useState({ chars: 0, col: 1, line: 1, words: 0 });
  const wordsDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!editor) {
      setStats({ chars: 0, col: 1, line: 1, words: 0 });
      return;
    }

    const computeCursor = () => {
      const { from } = editor.state.selection;
      const resolved = editor.state.doc.resolve(from);
      const col = from - resolved.start(resolved.depth) + 1;
      let line = 0;
      editor.state.doc.nodesBetween(0, from, (node) => {
        if (node.isBlock && node.isTextblock) line++;
      });
      if (line === 0) line = 1;
      return { col, line };
    };

    const computeWords = () => {
      const text = editor.state.doc.textContent;
      return { chars: text.length, words: countWords(text) };
    };

    const refreshAll = () => {
      if (editor.isDestroyed) return;
      setStats({ ...computeWords(), ...computeCursor() });
    };

    // Initial snapshot for the freshly-mounted editor.
    refreshAll();

    // Cursor position updates immediately for responsiveness. Any content edit
    // above the caret remaps the selection, so `selectionUpdate` alone keeps
    // Ln/Col fresh without a redundant walk on every keystroke's `update`.
    const syncCursor = () => {
      if (editor.isDestroyed) return;
      setStats((s) => ({ ...s, ...computeCursor() }));
    };

    // §perf-large-file: word/char count is a whole-doc text scan, so debounce it
    // on `update` (matching Outline.tsx) rather than paying it per keystroke.
    const syncWords = () => {
      if (editor.isDestroyed) return;
      if (wordsDebounceRef.current) clearTimeout(wordsDebounceRef.current);
      wordsDebounceRef.current = setTimeout(() => {
        if (editor.isDestroyed) return;
        setStats((s) => ({ ...s, ...computeWords() }));
      }, 200);
    };

    editor.on("selectionUpdate", syncCursor);
    editor.on("update", syncWords);
    // Tab switches / source-mode swaps load content via a direct
    // editor.view.updateState() that fires no Tiptap event and reuses the stable
    // shared editor, so neither the listeners above nor this [editor] effect
    // re-run. Recompute on the explicit content-loaded signal so the word count
    // (and cursor) reflect the newly shown document.
    const unsubscribeLoaded = subscribeContentLoaded(refreshAll);
    return () => {
      editor.off("selectionUpdate", syncCursor);
      editor.off("update", syncWords);
      unsubscribeLoaded();
      if (wordsDebounceRef.current) clearTimeout(wordsDebounceRef.current);
    };
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

  const applyPreset = useWorkspaceStore((s) => s.applyPreset);
  const { t } = useTranslation();

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

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <div className="status-space-wrapper" ref={spaceMenuRef}>
          <button
            className="status-space-btn"
            data-testid="perspective-launcher"
            onClick={() => setSpaceMenuOpen((v) => !v)}
            title={t("statusbar.perspective")}
          >
            <PanelsTopLeft size={12} strokeWidth={1.5} />
            {t("statusbar.perspective")}
            <ChevronDown size={10} strokeWidth={1.5} />
          </button>
          {spaceMenuOpen && (
            <div className="status-space-menu">
              {BUILTIN_PRESETS.map((preset) => {
                const Icon = SPACE_ICONS[preset.id] || Pencil;
                return (
                  <button
                    className="status-space-menu-item"
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
            className={[
              "status-fav-btn",
              "btn-unstyled",
              "icon-btn",
              isFavoriteNote && "status-fav-active",
            ]
              .filter(Boolean)
              .join(" ")}
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
        <PluginStatusBarItems align="left" />
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
          <PluginStatusBarItems align="right" />
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
