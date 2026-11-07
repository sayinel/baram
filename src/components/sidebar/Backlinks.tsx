// §29 백링크 패널 — 현재 파일을 참조하는 다른 파일 목록
// §34 언링크드 멘션 — [[]] 없이 파일명이 언급된 곳 표시
import { useCallback, useEffect, useRef, useState } from "react";

import type { UnlinkedMention } from "../../ipc/types";

import { TextWrap } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import {
  getBacklinks,
  getUnlinkedMentions,
  readFile,
  refreshIndex,
  updateFileIndex,
  writeFile,
} from "../../ipc/invoke";
import { onNoteChanges } from "../../services/note-changes";
import { useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { requestScroll } from "../../utils/editor/pending-scroll";
import { logger } from "../../utils/logger";
import {
  extractFileNameFromPath,
  groupBacklinksByFile,
  groupBacklinksByNamespace,
} from "./backlink-utils";
import { linkifyMention } from "./linkify-mention";

interface MentionSearch {
  /** A signal arrived since this walk began, so run it once more when it ends. */
  again: boolean;
  path: string;
  root: string;
}

const NO_MENTIONS: UnlinkedMention[] = [];

export function Backlinks() {
  const { t } = useTranslation();
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const rootPath = useFileStore((s) => s.rootPath);
  const {
    backlinks,
    unlinkedMentions,
    unlinkedMentionsFor,
    loading,
    error,
    indexVersion,
    setBacklinks,
    setUnlinkedMentions,
    setLoading,
    setError,
  } = useLinkStore(
    useShallow((s) => ({
      backlinks: s.backlinks,
      unlinkedMentions: s.unlinkedMentions,
      unlinkedMentionsFor: s.unlinkedMentionsFor,
      loading: s.loading,
      error: s.error,
      indexVersion: s.indexVersion,
      setBacklinks: s.setBacklinks,
      setUnlinkedMentions: s.setUnlinkedMentions,
      setLoading: s.setLoading,
      setError: s.setError,
    })),
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? null;

  // Fetch backlinks when active file changes
  const fetchBacklinks = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const entries = await getBacklinks(path);
        setBacklinks(path, entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [setBacklinks, setLoading, setError],
  );

  // §34 Fetch unlinked mentions (issue 791). A walk cannot be cancelled, so signals are not allowed
  // to pile walks up: a request for the note already being searched only marks it to run once more,
  // and that walk's answer is still delivered — a steady stream of writes must not discard every
  // answer. A request for another note, or another root, takes over at once. From then on the old
  // walk's answer is dropped, and so is one that lands after this panel closed: moving from A to B
  // quickly can bring B's answer back first and A's last, and A's must not land as B's. The answer
  // is kept with the note it was searched for (`unlinkedMentionsFor`); a failed search answers
  // nothing rather than an empty list for this note, so the listener below searches on the next
  // change of any kind.
  const mentionSearchRef = useRef<MentionSearch | null>(null);
  const fetchUnlinkedMentions = useCallback(
    async (path: string, root: string) => {
      const running = mentionSearchRef.current;
      if (running?.path === path && running.root === root) {
        running.again = true;
        return;
      }
      const search: MentionSearch = { again: true, path, root };
      mentionSearchRef.current = search;
      while (search.again && mentionSearchRef.current === search) {
        search.again = false;
        try {
          const entries = await getUnlinkedMentions(path, root);
          if (mentionSearchRef.current === search) {
            setUnlinkedMentions(path, entries);
          }
        } catch {
          // Non-fatal — silently ignore
          if (mentionSearchRef.current === search) {
            setUnlinkedMentions(null, []);
          }
        }
      }
      if (mentionSearchRef.current === search) mentionSearchRef.current = null;
    },
    [setUnlinkedMentions],
  );
  useEffect(
    () => () => {
      mentionSearchRef.current = null;
    },
    [],
  );

  // Keep latest fetch callbacks and filePath in refs so the rootPath-only effect
  // can call them without listing them as deps (which would re-run the full index
  // rebuild on every active-file change — the second effect handles that case).
  const fetchBacklinksRef = useRef(fetchBacklinks);
  fetchBacklinksRef.current = fetchBacklinks;
  const fetchUnlinkedMentionsRef = useRef(fetchUnlinkedMentions);
  fetchUnlinkedMentionsRef.current = fetchUnlinkedMentions;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;

  // Build index on vault open, then fetch backlinks
  useEffect(() => {
    if (!rootPath) return;

    let cancelled = false;
    (async () => {
      try {
        await refreshIndex(rootPath);
      } catch {
        // Index build failure is non-fatal
      }
      if (!cancelled && filePathRef.current) {
        fetchBacklinksRef.current(filePathRef.current);
        fetchUnlinkedMentionsRef.current(filePathRef.current, rootPath);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Only re-run when rootPath changes (triggers full index rebuild).
    // filePath/fetch callbacks are read via refs to avoid running on every file change.
  }, [rootPath]);

  // Fetch backlinks when the active file changes or the link index is updated
  useEffect(() => {
    if (filePath) fetchBacklinks(filePath);
  }, [filePath, indexVersion, fetchBacklinks]);

  // §34 Unlinked mentions follow their own inputs, not `indexVersion` (issue 791). The search
  // (`find_unlinked_mentions`) walks the vault and reads the OTHER notes' bodies from disk for this
  // note's name; it never reads the link index. So it runs again when the name or the vault
  // changes (here) and when notes other than this one changed on disk (below) — not on
  // `indexVersion`, and not when only this note changed: its own saves change neither input.
  useEffect(() => {
    if (filePath && rootPath) fetchUnlinkedMentions(filePath, rootPath);
  }, [filePath, rootPath, fetchUnlinkedMentions]);

  // §34 Notes changed on disk (`note-changes.ts`). Once this note has an answer, a change naming only
  // this note does not search again: the search does not read this note, whoever wrote it. Compared
  // as written, so where the watcher spells the path differently from the tab (a symlinked root, an
  // NFD folder) each echo reads as another note and searches. A change that names nothing (`null`)
  // always searches, and so does any change while this note has no answer — its search failed, or
  // has not come back.
  useEffect(
    () =>
      onNoteChanges((paths) => {
        const path = filePathRef.current;
        const root = rootPathRef.current;
        if (!path || !root) return;
        if (
          paths === null ||
          useLinkStore.getState().unlinkedMentionsFor !== path ||
          paths.some((p) => p !== path)
        ) {
          fetchUnlinkedMentionsRef.current(path, root);
        }
      }),
    [],
  );

  // Handle clicking a backlink entry → open that file and scroll to line
  const handleClick = useCallback(
    (sourcePath: string, line: number, blockId?: string) => {
      // §313 파일 주소를 붙여 건다 — 백링크가 **지금 보고 있는 노트**를 가리키는 경우
      // (같은 파일 안의 상호 참조) 탭 전환이 일어나지 않아 예전에는 아무 일도 하지
      // 않았고, 소비되지 않은 값이 다음 탭 전환으로 흘러갔다.
      requestScroll(
        sourcePath,
        blockId
          ? { kind: "blockId", value: blockId }
          : { kind: "line", value: line },
      );

      const {
        tabs: currentTabs,
        openTab,
        setActiveTab,
      } = useEditorStore.getState();
      const existing = currentTabs.find((t) => t.filePath === sourcePath);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }

      // Open the file
      (async () => {
        try {
          const content = await readFile(sourcePath);
          const fileName = extractFileNameFromPath(sourcePath);
          useFileStore.getState().setFileContent(sourcePath, content);
          openTab({
            contextId: "",
            id: crypto.randomUUID(),
            filePath: sourcePath,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
        } catch (err) {
          logger.error("[Backlinks] Failed to open file:", err);
        }
      })();
    },
    [],
  );

  // §34 Convert unlinked mention to wikilink
  const handleLinkify = useCallback(
    async (mention: UnlinkedMention) => {
      // §34 Link to the note these mentions were searched FOR (issue 791) — the panel shows them
      // only while that is the viewed note, and naming the note from the answer rather than the
      // tab keeps a click from ever writing another note's mentions as links to this one.
      const target = unlinkedMentionsFor;
      if (!target || !rootPath) return;

      const currentStem = extractFileNameFromPath(target).replace(/\.md$/, "");

      try {
        const content = await readFile(mention.sourcePath);
        const lines = content.split("\n");
        const lineIdx = mention.line - 1; // 1-based to 0-based

        if (lineIdx < 0 || lineIdx >= lines.length) return;

        // §34 · §390 The first occurrence of the mention becomes a link
        // (`linkifyMention`); a line that no longer holds it is left alone.
        const linked = linkifyMention(
          lines[lineIdx],
          mention.matchText,
          currentStem,
        );
        if (linked === null) return;
        lines[lineIdx] = linked;
        const newContent = lines.join("\n");

        await writeFile(mention.sourcePath, newContent);

        // Update index and refresh
        await updateFileIndex(mention.sourcePath);
        useLinkStore.getState().invalidate();
      } catch (err) {
        logger.error("[Backlinks] Failed to linkify:", err);
      }
    },
    [unlinkedMentionsFor, rootPath],
  );

  const [wrapBacklinks, setWrapBacklinks] = useState(false);
  const [wrapUnlinked, setWrapUnlinked] = useState(false);

  if (!filePath) {
    return <div className="backlinks-empty">{t("backlinks.noFile")}</div>;
  }

  if (loading) {
    return <div className="backlinks-empty">{t("backlinks.loading")}</div>;
  }

  if (error) {
    return <div className="backlinks-empty backlinks-error">{error}</div>;
  }

  const nsGroups = rootPath
    ? groupBacklinksByNamespace(backlinks, rootPath)
    : [{ namespace: "", fileGroups: groupBacklinksByFile(backlinks) }];
  // §34 Only the viewed note's answer is shown — until it has one, the section reads empty.
  const shownMentions =
    unlinkedMentionsFor === filePath ? unlinkedMentions : NO_MENTIONS;
  const unlinkedGroups = groupUnlinkedByFile(shownMentions);

  return (
    <div className="backlinks">
      {/* §29 Linked backlinks */}
      <div className="backlinks-header">
        {t("backlinks.title")} ({backlinks.length})
        <button
          aria-label={t("backlinks.wrap")}
          aria-pressed={wrapBacklinks}
          className="backlinks-wrap-toggle"
          onClick={() => setWrapBacklinks((v) => !v)}
          title={t("backlinks.wrap")}
        >
          <TextWrap className="icon-inline" size="1em" />
        </button>
      </div>
      {nsGroups.every((g) => g.fileGroups.length === 0) ? (
        <div className="backlinks-empty-inline">
          {t("backlinks.none", { name: extractFileNameFromPath(filePath) })}
        </div>
      ) : (
        nsGroups.map((nsGroup) => (
          <div
            className="backlinks-ns-group"
            key={nsGroup.namespace || "__root__"}
          >
            {/* Only show namespace header when there are multiple namespaces */}
            {nsGroups.length > 1 && (
              <div className="backlinks-ns-header">
                {nsGroup.namespace || t("backlinks.root")}
              </div>
            )}
            {nsGroup.fileGroups.map((group) => (
              <div className="backlinks-group" key={group.sourcePath}>
                <div
                  className="backlinks-source"
                  onClick={() =>
                    handleClick(group.sourcePath, group.entries[0].line)
                  }
                >
                  {extractFileNameFromPath(group.sourcePath)}
                </div>
                {group.entries.map((entry, i) => (
                  <div
                    className="backlinks-context"
                    key={i}
                    onClick={() =>
                      handleClick(group.sourcePath, entry.line, entry.blockId)
                    }
                  >
                    <span className="backlinks-line">L{entry.line}</span>
                    <span
                      className={`backlinks-text ${wrapBacklinks ? "wrap" : ""}`}
                    >
                      {entry.context}
                    </span>
                    {entry.blockId && (
                      <span className="backlinks-block-id-badge">
                        ^{entry.blockId}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))
      )}

      {/* §34 Unlinked mentions */}
      <div className="backlinks-header backlinks-header-unlinked">
        {t("backlinks.unlinked")} ({shownMentions.length})
        <button
          aria-label={t("backlinks.wrap")}
          aria-pressed={wrapUnlinked}
          className="backlinks-wrap-toggle"
          onClick={() => setWrapUnlinked((v) => !v)}
          title={t("backlinks.wrap")}
        >
          <TextWrap className="icon-inline" size="1em" />
        </button>
      </div>
      {unlinkedGroups.length === 0 ? (
        <div className="backlinks-empty-inline">
          {t("backlinks.unlinked.none")}
        </div>
      ) : (
        unlinkedGroups.map((group) => (
          <div className="backlinks-group" key={group.sourcePath}>
            <div
              className="backlinks-source"
              onClick={() =>
                handleClick(group.sourcePath, group.entries[0].line)
              }
            >
              {extractFileNameFromPath(group.sourcePath)}
            </div>
            {group.entries.map((entry, i) => (
              <div className="backlinks-context" key={i}>
                <span
                  className={`backlinks-text ${wrapUnlinked ? "wrap" : ""}`}
                  onClick={() => handleClick(group.sourcePath, entry.line)}
                >
                  {entry.context}
                </span>
                <button
                  className="backlinks-linkify-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLinkify(entry);
                  }}
                  title={t("backlinks.linkify.title")}
                >
                  {t("backlinks.linkify")}
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/** Group unlinked mentions by source file */
function groupUnlinkedByFile(
  entries: UnlinkedMention[],
): { entries: UnlinkedMention[]; sourcePath: string }[] {
  if (entries.length === 0) return [];

  const map = new Map<string, UnlinkedMention[]>();
  for (const entry of entries) {
    const existing = map.get(entry.sourcePath);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(entry.sourcePath, [entry]);
    }
  }

  return Array.from(map.entries()).map(([sourcePath, groupEntries]) => ({
    sourcePath,
    entries: groupEntries,
  }));
}
