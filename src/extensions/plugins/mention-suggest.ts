import type { Editor } from "@tiptap/core";

// §57 Mention autocomplete — Tiptap Extension using Suggestion API
// Triggers on @ and shows Quick Dates + page search popup
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";

import { MentionMenuList } from "../../components/command/MentionMenu";
import { useFileStore } from "../../stores/file-store";
import { flattenFileTree, fuzzyScore } from "../../utils/file-search";
import { resolveDateAlias } from "../../utils/journal";
import { createSuggestionRenderer } from "./suggestion-renderer";

export interface MentionSuggestionItem {
  category: "date" | "page";
  id: string;
  label: string;
  type: "date" | "page";
  value: string;
}

/** Build page items from the file store */
function getPageItems(): MentionSuggestionItem[] {
  const { rootPath, fileTree } = useFileStore.getState();
  if (!rootPath || fileTree.length === 0) return [];

  const flat = flattenFileTree(fileTree, rootPath);
  return flat
    .filter((f) => f.name.endsWith(".md") || f.name.endsWith(".markdown"))
    .map((f, idx) => {
      const name = f.name.replace(/\.(md|markdown)$/, "");
      return {
        id: `page-${idx}`,
        type: "page" as const,
        value: name,
        label: name,
        category: "page" as const,
      };
    });
}

/** Quick date entries: Today, Yesterday, Tomorrow */
function getQuickDates(): MentionSuggestionItem[] {
  const today = resolveDateAlias("today")!;
  const yesterday = resolveDateAlias("yesterday")!;
  const tomorrow = resolveDateAlias("tomorrow")!;

  return [
    {
      id: "date-today",
      type: "date",
      value: today,
      label: `Today (${today})`,
      category: "date",
    },
    {
      id: "date-yesterday",
      type: "date",
      value: yesterday,
      label: `Yesterday (${yesterday})`,
      category: "date",
    },
    {
      id: "date-tomorrow",
      type: "date",
      value: tomorrow,
      label: `Tomorrow (${tomorrow})`,
      category: "date",
    },
  ];
}

export const MentionSuggest = Extension.create({
  name: "mentionSuggest",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      Suggestion({
        editor,
        char: "@",
        allowSpaces: true,
        pluginKey: new PluginKey("mentionSuggest"),
        // Don't trigger when part of email address (letter before @)
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const textBefore = $from.parent.textBetween(
            Math.max(0, $from.parentOffset - 1),
            $from.parentOffset,
          );
          // Block if preceded by a word character (likely email)
          if (/\w/.test(textBefore)) return false;
          return true;
        },
        command: ({
          editor: ed,
          range,
          props,
        }: {
          editor: Editor;
          props: MentionSuggestionItem;
          range: { from: number; to: number };
        }) => {
          ed.chain()
            .focus()
            .deleteRange(range)
            .insertMention({ type: props.type, value: props.value })
            .run();
        },
        items: ({ query }: { query: string }) => {
          const quickDates = getQuickDates();
          const pages = getPageItems();
          const q = query.toLowerCase();

          // Check if query matches a date pattern (YYYY-MM-DD)
          const dateMatch = query.match(/^(\d{4}-\d{2}-\d{2})$/);
          const customDateItems: MentionSuggestionItem[] = dateMatch
            ? [
                {
                  id: "date-custom",
                  type: "date",
                  value: dateMatch[1],
                  label: dateMatch[1],
                  category: "date",
                },
              ]
            : [];

          if (!q) {
            return [...quickDates, ...pages.slice(0, 10)];
          }

          // Filter quick dates
          const filteredDates = quickDates.filter(
            (d) => d.label.toLowerCase().includes(q) || d.value.includes(q),
          );

          // Filter pages by fuzzy score
          const filteredPages = pages
            .map((item) => ({
              item,
              score: fuzzyScore(q, item.value),
            }))
            .filter(({ score }) => score < Infinity)
            .sort((a, b) => a.score - b.score)
            .slice(0, 15)
            .map(({ item }) => item);

          return [...customDateItems, ...filteredDates, ...filteredPages];
        },
        render: createSuggestionRenderer<MentionSuggestionItem>({
          component: MentionMenuList,
          popupClass: "mention-menu-popup",
          menuHeight: 300,
        }),
      }),
    ];
  },
});
