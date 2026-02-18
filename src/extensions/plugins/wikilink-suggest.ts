// §31 Wikilink autocomplete — Tiptap Extension using Suggestion API
// Triggers on [[ and shows a file search popup
import { Extension } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import type {
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import {
  WikilinkMenuList,
  type WikilinkMenuRef,
} from "../../components/command/WikilinkMenu";
import {
  filterFiles,
  fileNameWithoutExtension,
  loadFileHeadings,
  type WikilinkSuggestionItem,
} from "./wikilink-suggest-utils";
import { useFileStore } from "../../stores/file-store";
import { flattenFileTree, fuzzyScore } from "../../utils/file-search";
import { writeFile, refreshIndex } from "../../ipc/invoke";
import { isSyntaxRevealExpanded } from "./syntax-reveal";

const MENU_HEIGHT = 280;

function positionPopup(popup: HTMLDivElement, coords: DOMRect) {
  const spaceBelow = window.innerHeight - coords.bottom - 4;
  popup.style.left = `${coords.left}px`;
  if (spaceBelow < MENU_HEIGHT) {
    popup.style.top = `${coords.top - MENU_HEIGHT - 4}px`;
  } else {
    popup.style.top = `${coords.bottom + 4}px`;
  }
}

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

export const WikilinkSuggest = Extension.create({
  name: "wikilinkSuggest",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      Suggestion({
        editor,
        char: "[[",
        pluginKey: new PluginKey("wikilinkSuggest"),
        // Don't trigger autocomplete when SyntaxReveal is editing an expanded wikilink
        allow: ({ state }) => !isSyntaxRevealExpanded(state),
        command: ({
          editor: ed,
          range,
          props,
        }: {
          editor: Editor;
          range: { from: number; to: number };
          props: WikilinkSuggestionItem;
        }) => {
          if (props.kind === "create") {
            // Create new file and insert wikilink
            const { rootPath } = useFileStore.getState();
            if (rootPath) {
              const newPath = `${rootPath}/${props.target}.md`;
              writeFile(newPath, `# ${props.target}\n`)
                .then(() => refreshIndex(rootPath))
                .catch(() => {});
            }
            ed.chain()
              .focus()
              .deleteRange(range)
              .insertWikilink({ target: props.target })
              .run();
            return;
          }

          // Delete the [[ + query text and insert a wikilink node
          const attrs: { target: string; heading?: string | null } = {
            target: props.target,
          };
          if (props.heading) {
            attrs.heading = props.heading;
          }
          ed.chain()
            .focus()
            .deleteRange(range)
            .insertWikilink(attrs)
            .run();
        },
        items: async ({ query }: { query: string }) => {
          const files = getFileItems();
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
          const filtered = filterFiles(files, query, 10);

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
          let component: ReactRenderer<WikilinkMenuRef> | null = null;
          let popup: HTMLDivElement | null = null;

          return {
            onStart: (props: SuggestionProps) => {
              component = new ReactRenderer(WikilinkMenuList, {
                props: {
                  items: props.items as WikilinkSuggestionItem[],
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
              component?.updateProps({
                items: props.items as WikilinkSuggestionItem[],
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
              return component?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              popup?.remove();
              component?.destroy();
              popup = null;
              component = null;
            },
          };
        },
      }),
    ];
  },
});
