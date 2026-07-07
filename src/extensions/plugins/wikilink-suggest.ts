import type { Editor } from "@tiptap/core";

// §31 Wikilink autocomplete — Tiptap Extension using Suggestion API
// Triggers on [[ and shows a file search popup
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";

import { WikilinkMenuList } from "../../components/command/WikilinkMenu";
import { listDir, refreshIndex, writeFile } from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { buildFileTree, useFileStore } from "../../stores/file/file";
import { flattenFileTree, fuzzyScore } from "../../utils/file-search";
import {
  createSuggestionRenderer,
  type SuggestionRendererState,
} from "./suggestion-renderer";
import { getSyntaxRevealExpanded, syntaxRevealKey } from "./syntax-reveal";
import {
  buildFileSuggestionItem,
  fileNameWithoutExtension,
  filterFiles,
  loadFileHeadings,
  longestCommonPrefix,
  type WikilinkSuggestionItem,
} from "./wikilink-suggest-utils";

/**
 * §95 Zettelkasten: true when the query exactly matches a file's title
 * (`searchText`, falling back to `target`) — used to suppress the redundant
 * `Create "<query>"` fallback item. Zettel-note items store the note id in
 * `target` (so the stored wikilink is `[[id]]`), so an exact TITLE match
 * must compare against `searchText` instead. Regular (non-zettel) files have
 * no `searchText`, so behavior there is unchanged.
 */
export function hasExactMatch(
  files: WikilinkSuggestionItem[],
  query: string,
): boolean {
  const queryLower = query.toLowerCase();
  return files.some(
    (f) => (f.searchText ?? f.target).toLowerCase() === queryLower,
  );
}

/** Build suggestion items from the file store */
function getFileItems(): WikilinkSuggestionItem[] {
  const { rootPath, fileTree } = useFileStore.getState();
  if (!rootPath || fileTree.length === 0) return [];

  const flat = flattenFileTree(fileTree, rootPath);
  return flat
    .filter((f) => f.name.endsWith(".md") || f.name.endsWith(".markdown"))
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
        pluginKey: new PluginKey("wikilinkSuggest"),
        // Block autocomplete when SyntaxReveal is editing non-wikilink expansions (marks, links, images).
        // Allow during wikilink expansion so user can change the target via autocomplete.
        allow: ({ state }) => {
          const expanded = getSyntaxRevealExpanded(state);
          if (!expanded) return true;
          return expanded.kind === "wikilink";
        },
        command: ({
          editor: ed,
          range,
          props,
        }: {
          editor: Editor;
          props: WikilinkSuggestionItem;
          range: { from: number; to: number };
        }) => {
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
                const newPath = `${rootPath}/${props.target}.md`;
                writeFile(newPath, `# ${props.target}\n`)
                  .then(async () => {
                    await refreshIndex(rootPath);
                    // Refresh file tree so the new file appears in sidebar & navigation
                    const entries = await listDir(rootPath, true);
                    const tree = buildFileTree(entries, rootPath);
                    useFileStore.getState().setFileTree(tree);
                  })
                  .catch(() => {});
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
            ed.chain()
              .focus()
              .deleteRange(effectiveRange)
              .insertWikilink(attrs)
              .run();
          } catch {
            // Command failed — ignore (suggestion will close)
          }
        },
        items: async ({ query }: { query: string }) => {
          // §87 Cross-vault: detect alias:: prefix
          const colonIdx = query.indexOf("::");
          if (colonIdx > 0) {
            const alias = query.slice(0, colonIdx);
            const crossTarget = query.slice(colonIdx + 2);
            const contexts = useContextStore.getState().contexts;
            const aliasLower = alias.toLowerCase();
            const ctx = contexts.find(
              (c) => c.alias?.toLowerCase() === aliasLower,
            );
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
                const mdFiles = flat
                  .filter(
                    (f) =>
                      f.name.endsWith(".md") || f.name.endsWith(".markdown"),
                  )
                  .sort((a, b) => a.name.localeCompare(b.name));

                // §87 Searching: flat fuzzy results (no grouping)
                if (crossTarget) {
                  const crossFiles: WikilinkSuggestionItem[] = mdFiles.map(
                    (f, idx) => ({
                      id: `cross-${idx}`,
                      target: fileNameWithoutExtension(f.name),
                      label: f.name,
                      path: f.path,
                      vaultAlias: alias,
                    }),
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
                    result.push({
                      id: `cross-${idx++}`,
                      target: fileNameWithoutExtension(f.name),
                      label: f.name,
                      path: f.path,
                      vaultAlias: alias,
                      folder,
                    });
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
              const dirFiles = files
                .filter((f) => {
                  const fileDir = f.path.substring(0, f.path.lastIndexOf("/"));
                  return fileDir === targetDir;
                })
                .map((f) => ({
                  ...f,
                  target: `${dirPrefix}${f.target}`,
                }));

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

            const headingItems: WikilinkSuggestionItem[] = headings.map(
              (h, idx) => ({
                id: `heading-${idx}`,
                target: bestFile.target,
                label: h.text,
                path: bestFile.path,
                kind: "heading" as const,
                heading: h.text,
                headingLevel: h.level,
              }),
            );

            if (!headingQuery) return headingItems.slice(0, 10);

            // Fuzzy filter headings
            return headingItems
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

          // Add "Create" option if query is non-empty and no exact match
          if (query && !hasExactMatch(files, query)) {
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
              const queryLower = currentQuery.toLowerCase();

              // Only use prefix-matching items for LCP (exclude fuzzy-only matches)
              const targets = state.items
                .filter((i) => i.kind !== "create")
                .map((i) =>
                  i.kind === "heading" ? `${i.target}#${i.heading}` : i.target,
                )
                .filter((t) => t.toLowerCase().startsWith(queryLower));

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
