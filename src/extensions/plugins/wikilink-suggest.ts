import type { Editor } from "@tiptap/core";

// §31 Wikilink autocomplete — Tiptap Extension using Suggestion API
// Triggers on [[ and shows a file search popup
import { Extension } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";

import { WikilinkMenuList } from "../../components/command/WikilinkMenu";
import { type Locale, t } from "../../i18n";
import {
  createFile,
  isFileExistsError,
  listDir,
  refreshIndex,
} from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { buildFileTree, useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  findAliasContext,
  resolveWikilinkTarget,
} from "../../utils/editor/wikilink-nav";
import { flattenFileTree, fuzzyScore } from "../../utils/file-search";
import { logger } from "../../utils/logger";
import { foldName } from "../../utils/name-fold";
import { wikilinkSuggestPluginKey } from "./suggestion-keys";
import {
  createSuggestionRenderer,
  type SuggestionRendererState,
} from "./suggestion-renderer";
import { getSyntaxRevealExpanded, syntaxRevealKey } from "./syntax-reveal";
import {
  buildFileSuggestionItem,
  completionCandidates,
  crossVaultItem,
  filterFiles,
  headingItems,
  isCreatableTarget,
  isLinkableFile,
  loadFileHeadings,
  longestCommonPrefix,
  namespaceItems,
  searchKey,
  shouldBlockCompletedWikilink,
  type WikilinkSuggestionItem,
  withMarkdownExtension,
} from "./wikilink-suggest-utils";

/**
 * §31 What accepting a menu row does: replace the typed `[[…` (or the whole expanded
 * wikilink while SyntaxReveal shows one) with a wikilink node, and for the "create" row
 * also make the note (`createLinkedNote`). The Suggestion plugin's `command`.
 */
export function applyWikilinkSuggestion({
  editor: ed,
  range,
  props,
}: {
  editor: Editor;
  props: WikilinkSuggestionItem;
  range: { from: number; to: number };
}): void {
  try {
    // When SyntaxReveal has a wikilink expanded, replace the entire expanded range
    // instead of just the Suggestion range (which misses the trailing ]])
    const expanded = getSyntaxRevealExpanded(ed.view.state);
    const effectiveRange =
      expanded?.kind === "wikilink"
        ? { from: expanded.from, to: expanded.to }
        : range;

    // Clear SyntaxReveal state if it was expanded
    if (expanded?.kind === "wikilink") {
      const { tr } = ed.view.state;
      tr.setMeta(syntaxRevealKey, { expanded: null });
      ed.view.dispatch(tr);
    }

    if (props.kind === "create") {
      // Create new file and insert wikilink
      const { rootPath } = useFileStore.getState();
      if (rootPath) {
        createLinkedNote(rootPath, props.target).catch((err: unknown) =>
          logger.error("[Wikilink] Failed to create or index the note:", err),
        );
      }
      ed.chain()
        .focus()
        .deleteRange(effectiveRange)
        .insertWikilink({ target: props.target })
        .run();
      return;
    }

    // Delete the range and insert a wikilink node
    const attrs: {
      heading?: null | string;
      target: string;
      vaultAlias?: null | string;
    } = {
      target: props.target,
    };
    if (props.heading) {
      attrs.heading = props.heading;
    }
    if (props.vaultAlias) {
      attrs.vaultAlias = props.vaultAlias;
    }
    ed.chain().focus().deleteRange(effectiveRange).insertWikilink(attrs).run();
  } catch {
    // Command failed — ignore (suggestion will close)
  }
}

/**
 * §31 The "create" row's note, `# target` at the vault root, then the index and the tree
 * refreshed so the link resolves. `createFile`, never `writeFile`: the menu offers "create"
 * because no listed name matched, and that is no evidence the path is free: the menu
 * lists the file tree, not the disk. Before §390 a note saved with a decomposed (NFD)
 * Korean name was not matched by the composed (NFC) text typed here, yet on APFS both
 * spellings open the same file, which the write emptied to the one heading line (#814).
 * The OS refuses a taken path instead: a toast says so and nothing else runs. The caller
 * inserts the link either way.
 */
export async function createLinkedNote(
  rootPath: string,
  target: string,
): Promise<void> {
  // §278.2 Pre-existing defect, surfaced while fixing the PDF case: the suffix was
  // appended unconditionally, so `[[architecture.md]]` created `architecture.md.md`.
  // The link inserted is `[[architecture.md]]` either way, and that resolves to
  // `architecture.md` — so the file the menu created was one the link never pointed at.
  const newPath = `${rootPath}/${withMarkdownExtension(target)}`;
  try {
    await createFile(newPath, `# ${target}\n`);
  } catch (err) {
    if (!isFileExistsError(err)) throw err;
    const { locale } = useSettingsStore.getState();
    useUIStore.getState().showToast(
      t("wikilink.create.exists", locale as Locale, {
        name: withMarkdownExtension(target),
      }),
      "error",
    );
    return;
  }
  await refreshIndex(rootPath);
  // Refresh file tree so the new file appears in sidebar & navigation
  const entries = await listDir(rootPath, true);
  const tree = buildFileTree(entries, rootPath);
  useFileStore.getState().setFileTree(tree);
}

/**
 * §95 Zettelkasten: true when the query equals a file's `searchKey` under
 * `foldName` (case and Unicode normalization ignored, §390) — used to suppress
 * the redundant `Create "<query>"` fallback item. Zettel-note items store the
 * note id in `target` (so the stored wikilink is `[[id]]`), so a TITLE match
 * must compare against the search key instead. Regular (non-zettel) files have
 * no `searchText`, so behavior there is unchanged.
 */
export function hasExactMatch(
  files: WikilinkSuggestionItem[],
  query: string,
): boolean {
  const key = foldName(query);
  return files.some((f) => foldName(searchKey(f)) === key);
}

/**
 * §31 Whether the menu offers "create" for `query`: only when it names no listed file
 * (`hasExactMatch`), a file can be named (`isCreatableTarget`), and the resolver a click
 * calls first (`resolveWikilinkTarget`) leaves it unresolved. Without the last, `[[foo.md`
 * offered to create `foo.md` beside the `foo.md` the link resolves to: the file's row is
 * keyed by its stem, `foo`, so no exact match was seen. A click also opens a zettel id
 * and, in the journal, a date before it would create a note; this does not look at those.
 */
export function offersCreate(
  files: WikilinkSuggestionItem[],
  query: string,
): boolean {
  return (
    query !== "" &&
    !hasExactMatch(files, query) &&
    isCreatableTarget(query) &&
    resolveWikilinkTarget(query) === null
  );
}

/** Build suggestion items from the file store */
function getFileItems(): WikilinkSuggestionItem[] {
  const { rootPath, fileTree } = useFileStore.getState();
  if (!rootPath || fileTree.length === 0) return [];

  const flat = flattenFileTree(fileTree, rootPath);
  return flat
    .filter(isLinkableFile)
    .map((f, idx) => buildFileSuggestionItem(f, String(idx)));
}

export const WikilinkSuggest = Extension.create({
  name: "wikilinkSuggest",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      Suggestion({
        editor,
        char: "[[",
        allowSpaces: true,
        pluginKey: wikilinkSuggestPluginKey,
        // Block autocomplete when SyntaxReveal is editing non-wikilink expansions (marks, links, images).
        // Allow during wikilink expansion so user can change the target via autocomplete.
        allow: ({ state, range }) => {
          const expanded = getSyntaxRevealExpanded(state);
          if (expanded) return expanded.kind === "wikilink";

          // Bugfix: block autocomplete for an already-complete/pasted [[...]]
          // whose matched text contains a closing ]] — otherwise pasting
          // [[name]] shows `Create "name]]"` and would create a bogus file
          // on accept (allowSpaces:true has no stopping point at ]]).
          const matchText = state.doc.textBetween(
            range.from,
            range.to,
            undefined,
            "￼",
          );
          if (shouldBlockCompletedWikilink(matchText)) return false;

          return true;
        },
        command: applyWikilinkSuggestion,
        items: async ({ query }: { query: string }) => {
          // §87 Cross-vault: detect alias:: prefix
          const colonIdx = query.indexOf("::");
          if (colonIdx > 0) {
            const alias = query.slice(0, colonIdx);
            const crossTarget = query.slice(colonIdx + 2);
            // §317 · §390 The ruler a click uses (`findAliasContext`): space
            // names (`Journal::`), and aliases under foldName.
            const ctx = findAliasContext(alias);
            if (ctx) {
              // Try current file tree first (works if this is the active context)
              const { rootPath, fileTree } = useFileStore.getState();
              let flat =
                rootPath === ctx.path && fileTree.length > 0
                  ? flattenFileTree(fileTree, rootPath)
                  : null;

              // §87 Cross-vault: fetch file list from non-active vault via IPC
              if (!flat) {
                try {
                  const { listDir } = await import("../../ipc/invoke");
                  const { buildFileTree } =
                    await import("../../stores/file/file");
                  const entries = await listDir(ctx.path, true);
                  const tree = buildFileTree(entries, ctx.path);
                  flat = flattenFileTree(tree, ctx.path);
                } catch {
                  flat = null;
                }
              }

              if (flat && flat.length > 0) {
                // ‼️ §87 cross-vault는 같은 vault 목록(`isLinkableFile`)보다
                // **일부러 좁다** — 마크다운만이다. `resolveCrossVaultTarget`
                // (wikilink-nav.ts)은 `.md`/`.markdown` stem만 맞추고 같은 vault가
                // 쓰는 `resolveByExactFileName` 폴백이 없다. 여기를 넓히면 해석되지
                // 않는 링크를 메뉴가 권하게 된다. 넓히려면 해석기가 먼저다.
                const mdFiles = flat
                  .filter(
                    (f) =>
                      f.name.endsWith(".md") || f.name.endsWith(".markdown"),
                  )
                  .sort((a, b) => a.name.localeCompare(b.name));

                // §87 Searching: flat fuzzy results (no grouping)
                if (crossTarget) {
                  const crossFiles: WikilinkSuggestionItem[] = mdFiles.map(
                    (f, idx) => crossVaultItem(f, `cross-${idx}`, alias),
                  );
                  return filterFiles(crossFiles, crossTarget, 30);
                }

                // §87 Browsing (empty query): grouped by folder with headers
                const groups = new Map<string, typeof mdFiles>();
                for (const f of mdFiles) {
                  const dir = f.path.slice(ctx.path.length + 1);
                  const folder =
                    dir.lastIndexOf("/") > 0
                      ? dir.slice(0, dir.lastIndexOf("/"))
                      : "/";
                  if (!groups.has(folder)) groups.set(folder, []);
                  groups.get(folder)!.push(f);
                }

                const result: WikilinkSuggestionItem[] = [];
                // Sort folders: subfolders first (alphabetical), root last
                const sortedFolders = [...groups.keys()].sort((a, b) =>
                  a === "/" ? 1 : b === "/" ? -1 : a.localeCompare(b),
                );
                let idx = 0;
                for (const folder of sortedFolders) {
                  const files = groups.get(folder)!;
                  result.push({
                    id: `folder-${folder}`,
                    target: "",
                    label: folder === "/" ? "/ (root)" : folder,
                    path: "",
                    kind: "folder-header",
                    folder,
                  });
                  for (const f of files) {
                    result.push(
                      crossVaultItem(f, `cross-${idx++}`, alias, folder),
                    );
                  }
                }
                return result;
              }

              // Fallback hint if file listing failed
              return [
                {
                  id: "__hint_switch__",
                  target: "",
                  label: `No files found in "${ctx.alias}" vault`,
                  path: "",
                  kind: "hint" as const,
                },
              ];
            }
            // Unknown alias — show no results
            return [];
          }

          const files = getFileItems();

          // §61 Namespace: [[./  or [[../  → filter to relative directory
          if (query.startsWith("./") || query.startsWith("../")) {
            const activeTabId = useEditorStore.getState().activeTabId;
            const activeTab = useEditorStore
              .getState()
              .tabs.find((t) => t.id === activeTabId);
            const sourcePath = activeTab?.filePath;
            const { rootPath } = useFileStore.getState();

            if (sourcePath && rootPath) {
              const sourceDir = sourcePath.substring(
                0,
                sourcePath.lastIndexOf("/"),
              );
              // Find the last separator in the query to split dir prefix from file query
              const lastSlash = query.lastIndexOf("/");
              const dirPrefix = query.substring(0, lastSlash + 1); // e.g. "./" or "../sub/"
              const fileQuery = query.substring(lastSlash + 1);

              // Resolve the target directory
              const targetParts = `${sourceDir}/${dirPrefix}`.split("/");
              const resolved: string[] = [];
              for (const p of targetParts) {
                if (p === "." || p === "") continue;
                if (p === "..") {
                  resolved.pop();
                } else {
                  resolved.push(p);
                }
              }
              const targetDir = resolved.join("/");

              // Filter files in the target directory, prefix target with relative path
              const dirFiles = namespaceItems(files, targetDir, dirPrefix);

              if (!fileQuery) return dirFiles.slice(0, 20);

              return filterFiles(dirFiles, fileQuery, 20);
            }
            return [];
          }

          const hashIdx = query.indexOf("#");

          if (hashIdx >= 0) {
            // Heading mode: "file#heading"
            const fileQuery = query.slice(0, hashIdx);
            const headingQuery = query.slice(hashIdx + 1);
            const matchedFiles = filterFiles(files, fileQuery, 1);
            if (matchedFiles.length === 0) return [];

            const bestFile = matchedFiles[0];
            const headings = await loadFileHeadings(bestFile.path);

            const items = headingItems(bestFile, headings);

            if (!headingQuery) return items.slice(0, 10);

            // Fuzzy filter headings
            return items
              .map((item) => ({
                item,
                score: fuzzyScore(headingQuery, item.heading!),
              }))
              .filter(({ score }) => score < Infinity)
              .sort((a, b) => a.score - b.score)
              .slice(0, 10)
              .map(({ item }) => item);
          }

          // File mode
          const filtered = filterFiles(files, query, 20);

          // Add "Create" option only for a link a click would create
          if (offersCreate(files, query)) {
            filtered.push({
              id: "__create__",
              target: query,
              label: `Create "${query}"`,
              path: "",
              kind: "create",
            });
          }

          // §87 Cross-vault hint when multiple contexts are open
          const contexts = useContextStore.getState().contexts;
          const aliasContexts = contexts.filter((c) => c.alias);
          if (aliasContexts.length > 0) {
            const aliasExamples = aliasContexts
              .slice(0, 2)
              .map((c) => c.alias)
              .join(", ");
            filtered.push({
              id: "__hint_crossvault__",
              target: "",
              label: `Cross-vault: type alias:: (e.g., ${aliasExamples}::)`,
              path: "",
              kind: "hint",
            });
          }

          return filtered;
        },
        render: createSuggestionRenderer<WikilinkSuggestionItem>({
          component: WikilinkMenuList,
          popupClass: "wikilink-menu-popup",
          menuHeight: 280,
          onKeyDown: (
            props,
            state: SuggestionRendererState<WikilinkSuggestionItem>,
          ) => {
            // §87 `]` key: if query ends with `]`, the user typed `]]` to close.
            // Parse the query for alias::target and create the wikilink node.
            if (props.event.key === "]" && state.range) {
              const queryFrom = state.range.from + 2; // skip [[
              const rawQuery = editor.view.state.doc.textBetween(
                queryFrom,
                state.range.to,
              );
              // The first `]` was already inserted, so rawQuery ends with `]`
              if (rawQuery.endsWith("]")) {
                // Strip trailing `]` to get the actual target text
                const query = rawQuery.slice(0, -1);
                if (query) {
                  const colonIdx = query.indexOf("::");
                  const vaultAlias =
                    colonIdx > 0 ? query.slice(0, colonIdx) : null;
                  const target =
                    colonIdx > 0 ? query.slice(colonIdx + 2) : query;

                  if (target) {
                    // Delete `[[query]]` and insert wikilink node
                    const from = state.range.from;
                    const to = state.range.to + 1; // +1 for the `]` being typed now
                    editor
                      .chain()
                      .focus()
                      .deleteRange({ from, to })
                      .insertWikilink({
                        target,
                        vaultAlias,
                      })
                      .run();
                    return true;
                  }
                }
              }
            }

            // Tab: bash-style common-prefix completion
            if (props.event.key === "Tab" && state.range) {
              const queryFrom = state.range.from + 2; // skip [[
              const currentQuery = editor.view.state.doc.textBetween(
                queryFrom,
                state.range.to,
              );

              // Only use prefix-matching items for LCP (exclude fuzzy-only matches)
              const targets = completionCandidates(state.items, currentQuery);

              if (targets.length > 0) {
                const prefix = longestCommonPrefix(targets);
                if (prefix.length > currentQuery.length) {
                  const { tr } = editor.view.state;
                  tr.insertText(prefix, queryFrom, state.range.to);
                  editor.view.dispatch(tr);
                }
              }
              return true;
            }
            return false;
          },
        }),
      }),
    ];
  },
});
