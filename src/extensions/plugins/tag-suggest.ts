// §56m Tag autocomplete — Tiptap Extension using Suggestion API
// Triggers on # and shows tag suggestions from vault-wide Rust index
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";

import {
  TagMenuList,
  type TagSuggestionItem,
} from "../../components/command/TagMenu";
import { getVaultTags } from "../../ipc/invoke";
import { useFileStore } from "../../stores/file-store";
import { filterTags } from "../../utils/journal-tags";
import { logger } from "../../utils/logger";
import { createSuggestionRenderer } from "./suggestion-renderer";

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
    logger.error("[TagSuggest] Failed to build tag index:", err);
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
          props: TagSuggestionItem;
          range: { from: number; to: number };
        }) => {
          // Replace the #query with tagNode atom + trailing space
          ed.chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: "tagNode", attrs: { tag: props.tag } },
              { type: "text", text: " " },
            ])
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
        render: createSuggestionRenderer<TagSuggestionItem>({
          component: TagMenuList,
          popupClass: "tag-menu-popup",
          menuHeight: 200,
        }),
      }),
    ];
  },
});
