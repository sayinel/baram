// §28, §30c, §37 Navigation hooks — wikilink, block ref, local link, back/forward
import { useCallback, useEffect, useRef } from "react";

import type { Editor } from "@tiptap/core";

import { writeFile } from "../ipc/invoke";
import { ensureJournalFile } from "../services/journal-file-service";
import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { isActiveContextJournal, useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { useNavigationStore } from "../stores/ui/navigation";
import { useZettelIndexStore } from "../stores/zettelkasten/zettel-index";
import {
  findBlockPosById,
  findHeadingPosByText,
} from "../utils/editor/block-nav";
import { resolveWikilinkTarget } from "../utils/editor/wikilink-nav";
import { flattenFileTree } from "../utils/file-search";
import { isDateString, resolveJournalDir } from "../utils/journal/journal";
import { logger } from "../utils/logger";
import { isZettelId } from "../utils/zettelkasten/parse-note-title";

interface UseNavigationParams {
  editor: Editor | null;
  handleOpenFilePath: (filePath: string) => Promise<void>;
}

export function useNavigation({
  editor,
  handleOpenFilePath,
}: UseNavigationParams) {
  // §28 Wikilink navigation ref — breaks circular dependency (editor ↔ navigate)
  const navigateRef = useRef<
    (
      target: string,
      heading?: null | string,
      vaultAlias?: null | string,
    ) => void
  >(() => {});
  // §30c Block reference navigation ref
  const blockRefNavigateRef = useRef<(target: string, blockId: string) => void>(
    () => {},
  );
  // §5.1 Local .md link navigation ref (e.g. [text](sub/doc.md))
  const localLinkNavigateRef = useRef<(href: string) => void>(() => {});
  // §57 Mention navigation ref
  const mentionNavigateRef = useRef<(type: string, value: string) => void>(
    () => {},
  );
  // §37 Ref-based flag for back/forward navigation (avoids _navigating timing bug)
  const isNavBackForwardRef = useRef(false);

  // §28 Wikilink Cmd+Click navigation
  // §87 Cross-vault: vaultAlias passed through from wikilink node attrs
  const handleWikilinkNavigate = useCallback(
    (target: string, heading?: null | string, vaultAlias?: null | string) => {
      // §56 Date wikilink → open/create journal file
      if (isDateString(target)) {
        const {
          journalEnabled,
          journalDirectory,
          journalFilenameFormat,
          journalTemplatePath,
          journalUseHierarchy,
        } = useSettingsStore.getState();
        if (!journalEnabled) return;
        const { rootPath } = useFileStore.getState();
        const date = new Date(target + "T00:00:00");
        (async () => {
          try {
            const result = await ensureJournalFile(date, {
              journalDirectory,
              journalFilenameFormat,
              journalTemplatePath,
              journalUseHierarchy,
              rootPath,
            });
            if (!result) return;
            await handleOpenFilePath(result.path);
          } catch (err) {
            logger.error("[App] Failed to open journal:", err);
          }
        })();
        return;
      }

      const resolved = resolveWikilinkTarget(target, vaultAlias);

      // §95 Zettelkasten [[id]] → open the note via the frontend id index.
      // The target is a bare id but the file is notes/{id} {title}.md (or
      // inbox/{id}.md), so stem-matching in resolveWikilinkTarget won't find a
      // promoted note and would otherwise create a spurious {id}.md at the root.
      // The index holds the note's CURRENT path (fleeting or promoted).
      if (isZettelId(target)) {
        const note = useZettelIndexStore.getState().byId[target];
        if (note?.path) {
          handleOpenFilePath(note.path);
          return;
        }
      }

      // §87 Cross-vault async fallback: if sync resolution failed but alias exists,
      // try to find the file in the other vault via IPC
      if (!resolved && vaultAlias) {
        const contexts = useContextStore.getState().contexts;
        const aliasLower = vaultAlias.toLowerCase();
        const ctx = contexts.find((c) => c.alias?.toLowerCase() === aliasLower);
        if (ctx) {
          (async () => {
            try {
              const { listDir } = await import("../ipc/invoke");
              const { buildFileTree } = await import("../stores/file/file");
              const entries = await listDir(ctx.path, true);
              const tree = buildFileTree(entries, ctx.path);
              const flat = flattenFileTree(tree, ctx.path);
              const targetLower = target.toLowerCase();
              const match = flat.find((f) => {
                if (!f.name.endsWith(".md") && !f.name.endsWith(".markdown"))
                  return false;
                const stem = f.name.endsWith(".markdown")
                  ? f.name.slice(0, -9)
                  : f.name.slice(0, -3);
                return stem.toLowerCase() === targetLower;
              });
              if (match) {
                await handleOpenFilePath(match.path);
              }
            } catch (err) {
              logger.error("[Nav] Cross-vault navigation failed:", err);
            }
          })();
          return;
        }
      }

      // File doesn't exist → create it, refresh tree, then open
      if (!resolved) {
        const { rootPath } = useFileStore.getState();
        if (!rootPath) return;

        // §85 M2b: Journal scope — create new notes in {journalDir}/notes/
        const isJournalScoped = isActiveContextJournal();
        let newPath: string;
        if (isJournalScoped) {
          const { journalDirectory } = useSettingsStore.getState();
          const journalDir = resolveJournalDir(rootPath, journalDirectory);
          if (journalDir) {
            newPath = `${journalDir}/notes/${target}.md`;
          } else {
            newPath = `${rootPath}/${target}.md`;
          }
        } else {
          newPath = `${rootPath}/${target}.md`;
        }

        (async () => {
          try {
            // Ensure parent directory exists
            const parentDir = newPath.substring(0, newPath.lastIndexOf("/"));
            const { createDir } = await import("../ipc/invoke");
            await createDir(parentDir).catch(() => {});

            await writeFile(newPath, `# ${target}\n`);
            const { refreshIndex, listDir } = await import("../ipc/invoke");
            const { buildFileTree } = await import("../stores/file/file");
            await refreshIndex(rootPath);
            const entries = await listDir(rootPath, true);
            const tree = buildFileTree(entries, rootPath);
            useFileStore.getState().setFileTree(tree);
            await handleOpenFilePath(newPath);
          } catch (err) {
            logger.error("[App] Failed to create wikilink target:", err);
          }
        })();
        return;
      }

      // Open the file (reuses existing tab if already open)
      if (heading && editor) {
        // Same-file: doc is already loaded — scroll synchronously to avoid stale-state race.
        // Cross-file: set pending so afterDocLoad() in use-tab-switching can scroll after
        // the document finishes loading (handles async parse timing for large files).
        const { activeTabId: curTabId, tabs: curTabs } =
          useEditorStore.getState();
        const currentTab = curTabs.find((t) => t.id === curTabId);
        if (currentTab?.filePath === resolved.path) {
          // Clear any stale pending heading from a previous cross-file navigation
          // that may not have completed yet, to avoid it firing after this same-file scroll.
          useLinkStore.getState().setPendingScrollHeading(null);
          const targetPos = findHeadingPosByText(editor.state.doc, heading);
          if (targetPos !== null) {
            try {
              editor.commands.setTextSelection(targetPos + 1);
              editor.commands.scrollIntoView();
            } catch {
              // ignore invalid position
            }
          }
        } else {
          useLinkStore.getState().setPendingScrollHeading(heading);
        }
      }
      handleOpenFilePath(resolved.path).catch((err) =>
        logger.error("[App] Failed to open file:", err),
      );
    },
    [handleOpenFilePath, editor],
  );

  // §30c Block reference Cmd+Click navigation
  const handleBlockRefNavigate = useCallback(
    (target: string, blockId: string) => {
      if (!editor) return;

      if (!target) {
        // Same file — find block in current doc and scroll
        const pos = findBlockPosById(editor.state.doc, blockId);
        if (pos !== null) {
          editor.commands.setTextSelection(pos + 1);
          editor.commands.scrollIntoView();
        }
        return;
      }

      // Different file — resolve and open
      const resolved = resolveWikilinkTarget(target);
      if (!resolved) return;

      // Set pending block ID for scroll after tab switch
      useLinkStore.getState().setPendingScrollBlockId(blockId);

      handleOpenFilePath(resolved.path).then(() => {
        // Wait for editor state to settle
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!editor) return;
            const pos = findBlockPosById(editor.state.doc, blockId);
            if (pos !== null) {
              try {
                editor.commands.setTextSelection(pos + 1);
                editor.commands.scrollIntoView();
              } catch {
                // ignore invalid position
              }
            }
            useLinkStore.getState().setPendingScrollBlockId(null);
          });
        });
      });
    },
    [handleOpenFilePath, editor],
  );

  // §5.1 Local .md link Cmd+Click navigation (e.g. [text](sub/doc.md#heading))
  const handleLocalLinkNavigate = useCallback(
    (href: string) => {
      // Same-doc heading link: #heading
      if (href.startsWith("#")) {
        if (!editor) return;
        const heading = href.slice(1).replace(/-/g, " ");
        const targetPos = findHeadingPosByText(editor.state.doc, heading);
        if (targetPos !== null) {
          editor.commands.setTextSelection(targetPos + 1);
          editor.commands.scrollIntoView();
        }
        return;
      }

      // Split href into file path and optional heading fragment
      const [filePart, headingFragment] = href.split("#", 2);
      const heading = headingFragment
        ? headingFragment.replace(/-/g, " ")
        : null;

      // Resolve relative path against the current file's directory
      const { activeTabId: currentTabId, tabs: currentTabs } =
        useEditorStore.getState();
      const activeTab = currentTabs.find((t) => t.id === currentTabId);
      if (!activeTab?.filePath) return;

      const currentDir = activeTab.filePath.substring(
        0,
        activeTab.filePath.lastIndexOf("/"),
      );
      // Normalize simple relative path (handles ../ and ./)
      const resolvedPath = `${currentDir}/${filePart}`;

      // Cross-file navigation: set pending heading for afterDocLoad() to consume
      // after the document finishes loading (avoids stale-state race with async parse).
      if (heading) {
        useLinkStore.getState().setPendingScrollHeading(heading);
      }
      handleOpenFilePath(resolvedPath).catch((err) =>
        logger.error("[App] Failed to open file:", err),
      );
    },
    [handleOpenFilePath, editor],
  );

  // §37 Navigation back/forward handlers
  const handleGoBack = useCallback(() => {
    const { activeTabId: currentId, tabs: currentTabs } =
      useEditorStore.getState();
    if (!currentId) return;
    const openTabIds = new Set(currentTabs.map((t) => t.id));
    const targetId = useNavigationStore
      .getState()
      .goBack(currentId, openTabIds);
    if (targetId) {
      isNavBackForwardRef.current = true;
      useEditorStore.getState().setActiveTab(targetId);
    }
  }, []);

  const handleGoForward = useCallback(() => {
    const { activeTabId: currentId, tabs: currentTabs } =
      useEditorStore.getState();
    if (!currentId) return;
    const openTabIds = new Set(currentTabs.map((t) => t.id));
    const targetId = useNavigationStore
      .getState()
      .goForward(currentId, openTabIds);
    if (targetId) {
      isNavBackForwardRef.current = true;
      useEditorStore.getState().setActiveTab(targetId);
    }
  }, []);

  // Keep navigateRef in sync
  useEffect(() => {
    navigateRef.current = handleWikilinkNavigate;
  }, [handleWikilinkNavigate]);

  // Keep blockRefNavigateRef in sync
  useEffect(() => {
    blockRefNavigateRef.current = handleBlockRefNavigate;
  }, [handleBlockRefNavigate]);

  // Keep localLinkNavigateRef in sync
  useEffect(() => {
    localLinkNavigateRef.current = handleLocalLinkNavigate;
  }, [handleLocalLinkNavigate]);

  // §57 Keep mentionNavigateRef in sync — delegates to wikilink navigate
  useEffect(() => {
    mentionNavigateRef.current = (_type: string, value: string) => {
      handleWikilinkNavigate(value);
    };
  }, [handleWikilinkNavigate]);

  // §72 참조 링크 네비게이션 — Cmd+click on file paths in Skills files
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string }>).detail;
      if (!detail?.path) return;
      const filePath = detail.path;

      // Resolve relative paths against current file's directory or rootPath
      const resolveAbsolute = (p: string): null | string => {
        if (p.startsWith("/")) return p;
        const { activeTabId: curTabId, tabs: curTabs } =
          useEditorStore.getState();
        const curTab = curTabs.find((t) => t.id === curTabId);
        if (curTab?.filePath) {
          const curDir = curTab.filePath.substring(
            0,
            curTab.filePath.lastIndexOf("/"),
          );
          return `${curDir}/${p}`;
        }
        const { rootPath } = useFileStore.getState();
        if (rootPath) return `${rootPath}/${p}`;
        return null;
      };

      const resolved = resolveAbsolute(filePath);
      if (resolved) handleOpenFilePath(resolved);
    };
    window.addEventListener("baram:open-filepath", handler);
    return () => window.removeEventListener("baram:open-filepath", handler);
  }, [handleOpenFilePath]);

  return {
    blockRefNavigateRef,
    handleBlockRefNavigate,
    handleGoBack,
    handleGoForward,
    handleLocalLinkNavigate,
    handleWikilinkNavigate,
    isNavBackForwardRef,
    localLinkNavigateRef,
    mentionNavigateRef,
    navigateRef,
  };
}
