// §28, §30c, §37 Navigation hooks — wikilink, block ref, local link, back/forward
import { useCallback, useEffect, useRef } from "react";

import type { Editor } from "@tiptap/core";

import { readFile, writeFile } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor-store";
import { useFileStore } from "../stores/file-store";
import { useLinkStore } from "../stores/link-store";
import { useNavigationStore } from "../stores/navigation-store";
import { useSettingsStore } from "../stores/settings-store";
import { findBlockPosById } from "../utils/block-nav";
import {
  applyJournalTemplate,
  generateDefaultJournal,
  getHierarchicalJournalPath,
  getJournalFilePath,
  isDateString,
  resolveJournalDir,
} from "../utils/journal";
import { logger } from "../utils/logger";
import { resolveWikilinkTarget } from "../utils/wikilink-nav";

interface UseNavigationParams {
  editor: Editor | null;
  handleOpenFilePath: (filePath: string) => Promise<void>;
}

export function useNavigation({
  editor,
  handleOpenFilePath,
}: UseNavigationParams) {
  // §28 Wikilink navigation ref — breaks circular dependency (editor ↔ navigate)
  const navigateRef = useRef<(target: string, heading?: null | string) => void>(
    () => {},
  );
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
  const handleWikilinkNavigate = useCallback(
    (target: string, heading?: null | string) => {
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
        const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
        if (!resolvedDir) return;
        const date = new Date(target + "T00:00:00");
        const journalPath = journalUseHierarchy
          ? getHierarchicalJournalPath(resolvedDir, date, journalFilenameFormat)
          : getJournalFilePath(
              rootPath,
              journalDirectory,
              date,
              journalFilenameFormat,
            );
        if (!journalPath) return;
        (async () => {
          try {
            // Check if file exists
            let exists = true;
            try {
              await readFile(journalPath);
            } catch {
              exists = false;
            }
            if (!exists) {
              const { createDir } = await import("../ipc/invoke");
              const parentDir = journalPath.substring(
                0,
                journalPath.lastIndexOf("/"),
              );
              await createDir(parentDir);
              let content: string;
              if (journalTemplatePath) {
                try {
                  const tpl = await readFile(journalTemplatePath);
                  content = applyJournalTemplate(tpl, date);
                } catch {
                  content = generateDefaultJournal(date);
                }
              } else {
                content = generateDefaultJournal(date);
              }
              await writeFile(journalPath, content);
            }
            await handleOpenFilePath(journalPath);
          } catch (err) {
            logger.error("[App] Failed to open journal:", err);
          }
        })();
        return;
      }

      const resolved = resolveWikilinkTarget(target);

      // File doesn't exist → create it, refresh tree, then open
      if (!resolved) {
        const { rootPath, isJournalScoped } = useFileStore.getState();
        if (!rootPath) return;

        // §56l Journal scope: create new notes in {journalDir}/notes/
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
            const { buildFileTree } = await import("../stores/file-store");
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
      handleOpenFilePath(resolved.path).then(() => {
        if (!heading || !editor) return;

        // Wait for editor state to settle after tab switch
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!editor) return;
            const headingLower = heading.toLowerCase();
            let targetPos: null | number = null;

            editor.state.doc.descendants((node, pos) => {
              if (targetPos !== null) return false;
              if (
                node.type.name === "heading" &&
                node.textContent.toLowerCase() === headingLower
              ) {
                targetPos = pos;
                return false;
              }
              return true;
            });

            if (targetPos !== null) {
              editor.commands.setTextSelection(targetPos + 1);
              editor.commands.scrollIntoView();
            }
          });
        });
      });
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
        const headingLower = href.slice(1).replace(/-/g, " ").toLowerCase();
        let targetPos: null | number = null;
        editor.state.doc.descendants((node, pos) => {
          if (targetPos !== null) return false;
          if (
            node.type.name === "heading" &&
            node.textContent.toLowerCase() === headingLower
          ) {
            targetPos = pos;
            return false;
          }
          return true;
        });
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

      handleOpenFilePath(resolvedPath).then(() => {
        if (!heading || !editor) return;

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!editor) return;
            const headingLower = heading.toLowerCase();
            let targetPos: null | number = null;
            editor.state.doc.descendants((node, pos) => {
              if (targetPos !== null) return false;
              if (
                node.type.name === "heading" &&
                node.textContent.toLowerCase() === headingLower
              ) {
                targetPos = pos;
                return false;
              }
              return true;
            });
            if (targetPos !== null) {
              editor.commands.setTextSelection(targetPos + 1);
              editor.commands.scrollIntoView();
            }
          });
        });
      });
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
