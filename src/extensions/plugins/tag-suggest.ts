// §56m Tag autocomplete — Tiptap Extension using Suggestion API
// Triggers on # and shows tag suggestions from vault-wide Rust index
import { Extension } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import type {
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import {
  TagMenuList,
  type TagMenuRef,
  type TagSuggestionItem,
} from "../../components/command/TagMenu";
import { filterTags } from "../../utils/journal-tags";
import { useFileStore } from "../../stores/file-store";
import { getVaultTags } from "../../ipc/invoke";

const MENU_HEIGHT = 200;

function positionPopup(popup: HTMLDivElement, coords: DOMRect) {
  const spaceBelow = window.innerHeight - coords.bottom - 4;
  popup.style.left = `${coords.left}px`;
  if (spaceBelow < MENU_HEIGHT) {
    popup.style.top = `${coords.top - MENU_HEIGHT - 4}px`;
  } else {
    popup.style.top = `${coords.bottom + 4}px`;
  }
}

/** Cached tag index — rebuilt lazily via Rust IPC when stale */
let cachedTagIndex: Map<string, number> = new Map();
let cacheTimestamp = 0;
const CACHE_TTL = 30_000; // 30 seconds

async function getTagIndex(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cachedTagIndex.size > 0 && now - cacheTimestamp < CACHE_TTL) {
    return cachedTagIndex;
  }

  try {
    const { rootPath } = useFileStore.getState();
    if (!rootPath) return cachedTagIndex;

    const entries = await getVaultTags(rootPath);
    const index = new Map<string, number>();
    for (const entry of entries) {
      index.set(entry.tag, entry.count);
    }

    cachedTagIndex = index;
    cacheTimestamp = now;
  } catch (err) {
    console.error("[TagSuggest] Failed to build tag index:", err);
  }

  return cachedTagIndex;
}

export const TagSuggest = Extension.create({
  name: "tagSuggest",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      Suggestion({
        editor,
        char: "#",
        pluginKey: new PluginKey("tagSuggest"),
        // Only allow in paragraphs and list items, not in code blocks or headings
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const nodeType = $from.parent.type.name;
          if (
            nodeType === "codeBlock" ||
            nodeType === "frontmatter" ||
            nodeType === "mathBlock"
          ) {
            return false;
          }
          return true;
        },
        command: ({
          editor: ed,
          range,
          props,
        }: {
          editor: typeof editor;
          range: { from: number; to: number };
          props: TagSuggestionItem;
        }) => {
          // Replace the #query with #tag (keep the # prefix, add tag text)
          ed.chain()
            .focus()
            .deleteRange(range)
            .insertContent(`#${props.tag} `)
            .run();
        },
        items: async ({ query }: { query: string }) => {
          const tagIndex = await getTagIndex();
          const filtered = filterTags(query, tagIndex);
          return filtered.map((tag, idx) => ({
            id: String(idx),
            tag,
            count: tagIndex.get(tag) ?? 0,
          }));
        },
        render: () => {
          let component: ReactRenderer<TagMenuRef> | null = null;
          let popup: HTMLDivElement | null = null;

          return {
            onStart: (props: SuggestionProps) => {
              component = new ReactRenderer(TagMenuList, {
                props: {
                  items: props.items as TagSuggestionItem[],
                  command: props.command,
                },
                editor: props.editor,
              });

              popup = document.createElement("div");
              popup.className = "tag-menu-popup";
              document.body.appendChild(popup);
              popup.appendChild(component.element);

              const coords = props.clientRect?.();
              if (coords && popup) {
                positionPopup(popup, coords);
              }
            },
            onUpdate: (props: SuggestionProps) => {
              component?.updateProps({
                items: props.items as TagSuggestionItem[],
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
