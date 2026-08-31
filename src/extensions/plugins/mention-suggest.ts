import type { Locale } from "../../i18n";
import type { Editor } from "@tiptap/core";

// §57 Mention autocomplete — Tiptap Extension using Suggestion API
// Triggers on @ and shows Quick Dates + page search popup
// §316 …and a calendar, so any date can be picked rather than typed in full
import { Extension } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";

import { MentionMenuList } from "../../components/command/MentionMenu";
import { t } from "../../i18n";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { askDateValue } from "../../utils/editor/ask-date";
import { awaitBoundToEditor } from "../../utils/editor/mutation-tasks";
import { flattenFileTree, fuzzyScore } from "../../utils/file-search";
import { resolveDateAlias } from "../../utils/journal/journal";
import { mentionSuggestPluginKey } from "./suggestion-keys";
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

/**
 * §316 The id of the entry that opens a calendar instead of inserting a value.
 *
 * ‼️ It is an ITEM in the existing `@` menu, not a `/date` command of its own.
 * A second surface would have to answer "which one does a task line use?", and
 * the answer would be neither: `@` always yields a REFERENCE, and a due date is
 * a task field. Keeping it here keeps that boundary legible.
 */
export const PICK_DATE_ID = "date-pick";

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
    {
      // §316 Every other date needed the whole ISO string typed out. This is
      // the handle for looking one up; `value` stays empty because the value
      // does not exist until the calendar answers.
      id: PICK_DATE_ID,
      type: "date",
      value: "",
      label: t("mention.pickDate", localeNow()),
      category: "date",
    },
  ];
}

/** The locale to label menu entries in, read at build time (the menu is rebuilt per keystroke). */
function localeNow(): Locale {
  return useSettingsStore.getState().locale as Locale;
}

/**
 * §316 Open the calendar, then insert whatever it answers as a date mention.
 *
 * ‼️ The `@…` text is deleted BEFORE the dialog opens, not after it resolves.
 * The suggestion `range` is a position pair captured when the menu was built,
 * and the dialog is a suspension point — resolving it later would delete
 * whatever had drifted into those positions. Deleting first also leaves the
 * caret exactly where the mention belongs, so the insert needs no position of
 * its own.
 *
 * The insert is a mention either way: `@` yields a REFERENCE even on a task
 * line, where a due date would be a field. Letting context change what `@`
 * means is what makes an editor unpredictable.
 */
async function pickDateMention(
  ed: Editor,
  range: { from: number; to: number },
): Promise<void> {
  ed.chain().focus().deleteRange(range).run();

  const locale = localeNow();
  const iso = await awaitBoundToEditor(
    ed.view,
    askDateValue({
      label: t("tasks.triage.pickLabel", locale),
      submitLabel: t("dialog.insert", locale),
      title: t("mention.pickDate", locale),
    }),
  );
  // null covers three cases that all mean the same thing here: cancelled,
  // unparseable, or the document was swapped while the dialog was open.
  if (iso === null || iso === "") return;

  ed.chain().focus().insertMention({ type: "date", value: iso }).run();
}

/**
 * Build the `@` menu for a query. Exported so a test can read the menu the
 * user would actually see, rather than asserting against a copy of it.
 */
export function buildMentionItems(query: string): MentionSuggestionItem[] {
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
}

/**
 * Act on a chosen `@` entry. Exported for the same reason as the menu: the
 * branch that matters (pick-a-date defers, everything else inserts now) is
 * worth asserting directly.
 */
export function runMentionCommand({
  editor: ed,
  range,
  props,
}: {
  editor: Editor;
  props: MentionSuggestionItem;
  range: { from: number; to: number };
}): void {
  if (props.id === PICK_DATE_ID) {
    void pickDateMention(ed, range);
    return;
  }
  ed.chain()
    .focus()
    .deleteRange(range)
    .insertMention({ type: props.type, value: props.value })
    .run();
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
        pluginKey: mentionSuggestPluginKey,
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
        command: runMentionCommand,
        items: ({ query }: { query: string }) => buildMentionItems(query),
        render: createSuggestionRenderer<MentionSuggestionItem>({
          component: MentionMenuList,
          popupClass: "mention-menu-popup",
          menuHeight: 300,
        }),
      }),
    ];
  },
});
