import type { Editor } from "@tiptap/core";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";

// §31 Wikilink autocomplete — Tiptap Extension using Suggestion API
// Triggers on [[ and shows a file search popup
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";

import {
  WikilinkMenuList,
  type WikilinkMenuRef,
} from "../../components/command/WikilinkMenu";
import { listDir, refreshIndex, writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import { buildFileTree, useFileStore } from "../../stores/file-store";
import { flattenFileTree, fuzzyScore } from "../../utils/file-search";
import { getSyntaxRevealExpanded, syntaxRevealKey } from "./syntax-reveal";
import {
  fileNameWithoutExtension,
  filterFiles,
  loadFileHeadings,
  longestCommonPrefix,
  type WikilinkSuggestionItem,
} from "./wikilink-suggest-utils";

const MENU_HEIGHT = 280;

/** Build suggestion items from the file store */
function getFileItems(): WikilinkSuggestionItem[] {
  const { rootPath, fileTree } = useFileStore.getState();
  if (!rootPath || fileTree.length === 0) return [];

  const flat = flattenFileTree(fileTree, rootPath);
  return flat
    .filter((f) => f.name.endsWith(".md") || f.name.endsWith(".markdown"))
    .map((f, idx) => ({
      id: String(idx),
      target: fileNameWithoutExtension(f.name),
      label: f.name,
      path: f.path,
    }));
}

function positionPopup(popup: HTMLDivElement, coords: DOMRect) {
  const spaceBelow = window.innerHeight - coords.bottom - 4;
  popup.style.left = `${coords.left}px`;
  if (spaceBelow < MENU_HEIGHT) {
    popup.style.top = `${coords.top - MENU_HEIGHT - 4}px`;
  } else {
    popup.style.top = `${coords.bottom + 4}px`;
  }
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
          const attrs: { heading?: null | string; target: string } = {
            target: props.target,
          };
          if (props.heading) {
            attrs.heading = props.heading;
          }
          ed.chain()
            .focus()
            .deleteRange(effectiveRange)
            .insertWikilink(attrs)
            .run();
        },
        items: async ({ query }: { query: string }) => {
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
          if (query) {
            const queryLower = query.toLowerCase();
            const hasExact = files.some(
              (f) => f.target.toLowerCase() === queryLower,
            );
            if (!hasExact) {
              filtered.push({
                id: "__create__",
                target: query,
                label: `Create "${query}"`,
                path: "",
                kind: "create",
              });
            }
          }

          return filtered;
        },
        render: () => {
          let component: null | ReactRenderer<WikilinkMenuRef> = null;
          let popup: HTMLDivElement | null = null;
          let latestItems: WikilinkSuggestionItem[] = [];
          let latestRange: null | { from: number; to: number } = null;

          return {
            onStart: (props: SuggestionProps) => {
              latestItems = props.items as WikilinkSuggestionItem[];
              latestRange = { from: props.range.from, to: props.range.to };

              component = new ReactRenderer(WikilinkMenuList, {
                props: {
                  items: latestItems,
                  command: props.command,
                },
                editor: props.editor,
              });

              popup = document.createElement("div");
              popup.className = "wikilink-menu-popup";
              document.body.appendChild(popup);
              popup.appendChild(component.element);

              const coords = props.clientRect?.();
              if (coords && popup) {
                positionPopup(popup, coords);
              }
            },
            onUpdate: (props: SuggestionProps) => {
              latestItems = props.items as WikilinkSuggestionItem[];
              latestRange = { from: props.range.from, to: props.range.to };

              component?.updateProps({
                items: latestItems,
                command: props.command,
              });

              const coords = props.clientRect?.();
              if (coords && popup) {
                positionPopup(popup, coords);
              }
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") {
                popup?.remove();
                component?.destroy();
                popup = null;
                component = null;
                return true;
              }

              // Tab: bash-style common-prefix completion
              if (props.event.key === "Tab" && latestRange) {
                const queryFrom = latestRange.from + 2; // skip [[
                const currentQuery = editor.view.state.doc.textBetween(
                  queryFrom,
                  latestRange.to,
                );
                const queryLower = currentQuery.toLowerCase();

                // Only use prefix-matching items for LCP (exclude fuzzy-only matches)
                const targets = latestItems
                  .filter((i) => i.kind !== "create")
                  .map((i) =>
                    i.kind === "heading"
                      ? `${i.target}#${i.heading}`
                      : i.target,
                  )
                  .filter((t) => t.toLowerCase().startsWith(queryLower));

                if (targets.length > 0) {
                  const prefix = longestCommonPrefix(targets);
                  if (prefix.length > currentQuery.length) {
                    const { tr } = editor.view.state;
                    tr.insertText(prefix, queryFrom, latestRange.to);
                    editor.view.dispatch(tr);
                  }
                }
                return true;
              }

              return component?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              popup?.remove();
              component?.destroy();
              popup = null;
              component = null;
              latestItems = [];
              latestRange = null;
            },
          };
        },
      }),
    ];
  },
});
