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
import { useFileStore } from "../../stores/file/file";
import { filterTags } from "../../utils/journal/journal-tags";
import { logger } from "../../utils/logger";
import { createSuggestionRenderer } from "./suggestion-renderer";

/**
 * §perf-large-file C3.4: Per-editor tag cache via WeakMap so two concurrent
 * editor instances (C3.5 dual-editor) never share stale cache entries.
 */
interface TagCache {
  index: Map<string, number>;
  timestamp: number;
}
const _tagCacheByEditor = new WeakMap<
  import("@tiptap/core").Editor,
  TagCache
>();
const CACHE_TTL = 30_000; // 30 seconds

async function getTagIndex(
  editor: import("@tiptap/core").Editor,
): Promise<Map<string, number>> {
  const now = Date.now();
  const cached = _tagCacheByEditor.get(editor);
  if (cached && cached.index.size > 0 && now - cached.timestamp < CACHE_TTL) {
    return cached.index;
  }

  const fallback = cached?.index ?? new Map<string, number>();
  try {
    const { rootPath } = useFileStore.getState();
    if (!rootPath) return fallback;

    const entries = await getVaultTags(rootPath);
    const index = new Map<string, number>();
    for (const entry of entries) {
      index.set(entry.tag, entry.count);
    }

    _tagCacheByEditor.set(editor, { index, timestamp: now });
    return index;
  } catch (err) {
    logger.error("[TagSuggest] Failed to build tag index:", err);
  }

  return fallback;
}

/** @internal — exported for testing only */
export { _tagCacheByEditor };

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
          const tagIndex = await getTagIndex(editor);
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
