// §28, §30c, §37 Navigation hooks — wikilink, block ref, local link, back/forward
import { useCallback, useEffect, useRef } from "react";

import type { StoredHighlight } from "../components/editor/pdf/pdf-highlight-sidecar";
import type { Editor } from "@tiptap/core";

import {
  pdfRelPathForHighlightTarget,
  sidecarPathFor,
} from "../components/editor/pdf/pdf-highlight-sidecar";
import { readSidecar } from "../components/editor/pdf/pdf-highlight-store";
import { type Locale, t } from "../i18n";
import { writeFile } from "../ipc/invoke";
import { ensureJournalFile } from "../services/journal-file-service";
import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { isActiveContextJournal, useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { useNavigationStore } from "../stores/ui/navigation";
import { useUIStore } from "../stores/ui/ui";
import { useZettelIndexStore } from "../stores/zettelkasten/zettel-index";
import { showConfirm } from "../utils/confirm-dialog";
import {
  findBlockPosById,
  findHeadingPosByText,
} from "../utils/editor/block-nav";
import { planLocalLinkNavigation } from "../utils/editor/local-link-nav";
import {
  findAliasContext,
  resolveWikilinkTarget,
} from "../utils/editor/wikilink-nav";
import { flattenFileTree } from "../utils/file-search";
import { isDateString, resolveJournalDir } from "../utils/journal/journal";
import { logger } from "../utils/logger";
import { dirname } from "../utils/path-utils";
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
  // §5.1 Local link navigation ref (e.g. [text](sub/doc.md), [text](Paper.pdf))
  const localLinkNavigateRef = useRef<(href: string) => boolean>(() => false);
  // §57 Mention navigation ref
  const mentionNavigateRef = useRef<(type: string, value: string) => void>(
    () => {},
  );
  // §37 Ref-based flag for back/forward navigation (avoids _navigating timing bug)
  const isNavBackForwardRef = useRef(false);

  // §28 Wikilink Cmd+Click navigation
  // §87 Cross-vault: vaultAlias passed through from wikilink node attrs
  const handleWikilinkNavigate = useCallback(
    (
      target: string,
      heading?: null | string,
      vaultAlias?: null | string,
      /**
       * §317 Whether a date-shaped target may take the journal route at all.
       * Wikilinks default to true (`[[2026-08-30]]` is §56's date link); a
       * mention passes `type === "date"` so a page mention named like a date
       * stays an ordinary link.
       */
      opts?: { dateRoute?: boolean },
    ) => {
      const dateRoute = opts?.dateRoute ?? true;
      // §56 · §317 Date wikilink → open/create journal file.
      //
      // ‼️ The date branch is gated on JOURNAL INTENT, not merely on the target
      // looking like a date. Before §317 any date string opened (and created)
      // the journal from anywhere, so a reference inside an unrelated vault
      // silently threw the reader into a different context — and the alias was
      // never even consulted, because this branch ran ahead of it.
      //
      // Intent is explicit when the link names the space (`[[Journal::…]]`) and
      // implicit when the reader is already inside it. Everywhere else a date is
      // just a wikilink, and `[[Journal::2026-08-30]]` is the way across.
      if (dateRoute && isDateString(target)) {
        const aliasCtx = vaultAlias ? findAliasContext(vaultAlias) : null;
        const journalIntent = vaultAlias
          ? aliasCtx?.vaultType === "journal"
          : isActiveContextJournal();

        if (journalIntent) {
          const {
            journalEnabled,
            journalDirectory,
            journalFilenameFormat,
            journalTemplatePath,
            journalUseHierarchy,
          } = useSettingsStore.getState();
          // §317 defect A: a silent return left the click looking broken with
          // no way to learn why.
          if (!journalEnabled) {
            useUIStore
              .getState()
              .showToast(tr("journal.disabledHint"), "warning");
            return;
          }
          const { rootPath } = useFileStore.getState();
          const date = new Date(target + "T00:00:00");
          (async () => {
            try {
              const result = await ensureJournalFile(date, {
                // §317 defect B: following a reference must not silently author
                // a diary entry. Existing entries still open without a prompt.
                confirmCreate: () =>
                  showConfirm(tr("journal.createConfirm", { date: target }), {
                    confirmLabel: tr("journal.createConfirmAction"),
                    danger: false,
                  }),
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
        // No journal intent → fall through to ordinary wikilink resolution.
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
        // §317 Same alias ruler as the sync path (`findAliasContext`) — when
        // this was a second copy, widening one left `[[Journal::x]]` resolving
        // on only one of the two paths.
        const ctx = findAliasContext(vaultAlias);
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

        // §317 A date outside the journal now lands here rather than in the
        // journal branch, so the ordinary "create the note" path would author
        // `2026-08-30.md` in the open vault without a word — the same surprise
        // defect B describes, one level down. Ask, and let the question teach
        // the crossing syntax. Only when a journal space exists to point at,
        // and only for dates: ordinary wikilinks keep creating silently.
        // ‼️ Deliberately NOT gated on `dateRoute`. That flag says whether the
        // journal route was open; this guard is about what the TARGET looks
        // like. Tying the two let a caller that had closed the route create a
        // date-named note with no prompt at all — which is how a stale click
        // handler on date mentions came to write files silently.
        const dateNeedsRoute =
          isDateString(target) &&
          !isJournalScoped &&
          useContextStore.getState().journalContext() !== null;

        (async () => {
          try {
            if (
              dateNeedsRoute &&
              !(await showConfirm(
                tr("journal.outsideCreate", { date: target }),
                {
                  confirmLabel: tr("journal.outsideCreateAction"),
                  danger: false,
                },
              ))
            ) {
              return;
            }
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

  // §30c Different-file block reference: resolve target, open, set pending
  // block id, then scroll once the editor settles. Shared by the ordinary
  // path below and by the §275.6 highlight-ref fallback (sidecar missing/
  // unreadable, or the highlight's id isn't there anymore — §277 leaves the
  // companion-note paragraph in place on delete, so this is the expected,
  // supported landing spot for a ref to a deleted highlight, not an error).
  const openNoteAndScrollToBlock = useCallback(
    (target: string, blockId: string) => {
      const resolved = resolveWikilinkTarget(target);
      if (!resolved) return;

      // Set pending block ID for scroll after tab switch
      useLinkStore.getState().setPendingScrollBlockId(blockId);

      handleOpenFilePath(resolved.path)
        .then(() => {
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
        })
        .catch((err) =>
          logger.error("[Nav] Failed to open block ref target:", err),
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

      // §275.6 Highlight ref: if the sidecar still has this id, open the PDF
      // and jump to it instead of the companion note. rootPath is required to
      // form the sidecar's absolute path — without a vault (single-file mode)
      // there's nothing to check, so fall straight through.
      const pdfRelPath = pdfRelPathForHighlightTarget(target);
      const { rootPath } = useFileStore.getState();
      if (pdfRelPath && rootPath) {
        (async () => {
          let hit: StoredHighlight | undefined;
          // §275.4 IMPORTANT companionPathFor/pdfRelPathForHighlightTarget
          // strip/append ".pdf" case-insensitively, so `pdfRelPath` above
          // always ends in a lowercase ".pdf" regardless of the real file's
          // extension case. sidecarPathFor's own case-insensitive strip means
          // the sidecar lookup below still succeeds for e.g. "A.PDF" — but
          // opening the PDF itself needs the ORIGINAL case. sidecar.pdf was
          // written verbatim from the real pdfRelPath at highlight-creation
          // time (pdf-highlight-actions.ts), so once we have it, prefer it
          // over the lowercase-coerced `pdfRelPath` derived from the target.
          // Without this, a case-sensitive filesystem (Linux) opens nothing.
          let exactPdfRelPath = pdfRelPath;
          try {
            const absSidecarPath = `${rootPath}/${sidecarPathFor(pdfRelPath)}`;
            const sidecar = await readSidecar(absSidecarPath);
            hit = sidecar?.highlights.find((h) => h.id === blockId);
            if (sidecar) exactPdfRelPath = sidecar.pdf;
          } catch (err) {
            logger.error("[Nav] Failed to read highlight sidecar:", err);
          }
          if (hit) {
            useLinkStore.getState().setPendingPdfHighlightId(blockId);
            handleOpenFilePath(`${rootPath}/${exactPdfRelPath}`).catch((err) =>
              logger.error("[Nav] Failed to open highlighted PDF:", err),
            );
            return;
          }
          // Not found (sidecar missing/unreadable, or the highlight was
          // permanently deleted) — fall back to the ordinary block-reference
          // destination.
          //
          // §277.2 소프트 삭제된 하이라이트는 여기 오지 않는다 — 사이드카에
          // 항목이 남아 있어 위에서 hit로 잡히고, PDF의 그 자리로 점프한다.
          // 그것이 소프트 삭제의 요점이다: 참조가 계속 원래 자리를 가리킨다.
          // 오버레이는 그 순간 점선으로만 그린다(use-pdf-highlights.ts).
          openNoteAndScrollToBlock(target, blockId);
        })().catch((err: unknown) => {
          // §275.6 M3: everything above is guarded by its own try/catch, but
          // openNoteAndScrollToBlock (in the fallback call just above) is a
          // synchronous function — a throw out of it (e.g. from
          // resolveWikilinkTarget) would otherwise reject this IIFE's promise
          // with no one awaiting it, and main.tsx's global unhandledrejection
          // handler downgrades that to a console.warn (§260 Phase 5 R4's
          // exact trap, Task 11's I1 was about the same class).
          logger.error("[Nav] Highlight ref navigation failed:", err);
        });
        return;
      }

      // Different file — resolve and open
      openNoteAndScrollToBlock(target, blockId);
    },
    [editor, openNoteAndScrollToBlock, handleOpenFilePath],
  );

  // §5.1 Local link Cmd+Click navigation (e.g. [text](sub/doc.md#heading))
  // §278.1 Also opens any other file that exists — [text](Paper.pdf) — in its
  // viewer. Returns whether the href was handled; `false` sends it to the OS
  // opener, which is what keeps scheme-less external addresses working.
  const handleLocalLinkNavigate = useCallback(
    (href: string): boolean => {
      // Same-doc heading link: #heading
      if (href.startsWith("#")) {
        if (!editor) return true;
        const heading = href.slice(1).replace(/-/g, " ");
        const targetPos = findHeadingPosByText(editor.state.doc, heading);
        if (targetPos !== null) {
          editor.commands.setTextSelection(targetPos + 1);
          editor.commands.scrollIntoView();
        }
        return true;
      }

      // Resolve relative paths against the current file's directory
      const { activeTabId: currentTabId, tabs: currentTabs } =
        useEditorStore.getState();
      const activeTab = currentTabs.find((t) => t.id === currentTabId);
      const sourceDir = activeTab?.filePath
        ? dirname(activeTab.filePath)
        : null;

      const { fileTree, rootPath } = useFileStore.getState();
      const flat =
        rootPath && fileTree.length > 0
          ? flattenFileTree(fileTree, rootPath)
          : [];
      const plan = planLocalLinkNavigation(href, sourceDir, flat);

      // Cross-file navigation: set pending heading for afterDocLoad() to consume
      // after the document finishes loading (avoids stale-state race with async parse).
      if (plan.scrollHeading) {
        useLinkStore.getState().setPendingScrollHeading(plan.scrollHeading);
      }
      if (plan.target) {
        handleOpenFilePath(plan.target).catch((err) =>
          logger.error("[App] Failed to open file:", err),
        );
      }
      return plan.claimed;
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
  //
  // §316 Only PAGE mentions arrive here. A date mention is a value, not a
  // pointer — clicking one opens the calendar (see mention-view) and never
  // navigates, so the journal route is closed unconditionally rather than
  // decided from `type`.
  //
  // §317 had made that decision from `type`, because a date mention could
  // otherwise drag a reader into the journal. Deciding it at the mention itself
  // settles the same question earlier and harder: a file genuinely named
  // `2026-08-30.md` opens as itself even from inside the journal.
  useEffect(() => {
    mentionNavigateRef.current = (_type: string, value: string) => {
      handleWikilinkNavigate(value, null, null, { dateRoute: false });
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

/**
 * §317 Translate in the user's current locale.
 *
 * Read at call time rather than through the React `useTranslation` context: the
 * navigate callbacks run from ProseMirror event handlers held in refs, which
 * outlive the render that created them.
 */
function tr(key: string, params?: Record<string, string>): string {
  const { locale } = useSettingsStore.getState();
  return t(key, locale as Locale, params);
}
