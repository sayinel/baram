// §57 Mention NodeView — renders @[[value]] as styled inline chip
// §316 A date mention is a VALUE: clicking it opens the calendar to change it.
import { useCallback } from "react";

import type { Locale } from "../../i18n";
import type { MentionOptions } from "./mention";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

import { t } from "../../i18n";
import { useSettingsStore } from "../../stores/settings/store";
import { askDateValue } from "../../utils/editor/ask-date";
import { awaitBoundToEditor } from "../../utils/editor/mutation-tasks";

export function MentionView({
  editor,
  extension,
  node,
  selected,
  updateAttributes,
}: NodeViewProps) {
  const { type: mentionType, value } = node.attrs as {
    type: string;
    value: string;
  };

  const isDate = mentionType === "date";

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // §316 A date mention names a day; it does not point at a document.
      // Clicking it edits the day. Reaching the journal entry for that day is
      // `[[2026-08-30]]`'s job — that syntax is also the one the link indexer
      // collects, so it is the one that shows up in backlinks and the graph.
      if (isDate) {
        e.preventDefault();
        e.stopPropagation();
        // Nothing to edit in a preview, an export, or any other read-only view.
        if (!editor.isEditable) return;
        void (async () => {
          const locale = useSettingsStore.getState().locale as Locale;
          const iso = await awaitBoundToEditor(
            editor.view,
            askDateValue({
              label: t("tasks.triage.pickLabel", locale),
              submitLabel: t("tasks.chip.edit.submit", locale),
              title: t("mention.changeDate", locale),
              value,
            }),
          );
          // Cancelled, unparseable, or the document was swapped while open.
          if (iso === null || iso === "" || iso === value) return;
          updateAttributes({ value: iso });
        })();
        return;
      }

      // §316 Page mentions can no longer be authored (`@` offers dates only),
      // but ones already written keep working rather than going dead in
      // documents that already hold them.
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        const onNavigate = (extension.options as MentionOptions).onNavigate;
        onNavigate(mentionType, value);
      }
    },
    [editor, extension, isDate, mentionType, updateAttributes, value],
  );

  return (
    <NodeViewWrapper
      as="span"
      className={`mention mention-${mentionType} ${selected ? "mention-selected" : ""}`}
      data-mention-type={mentionType}
      data-value={value}
      onClick={handleClick}
    >
      <span className="mention-icon">
        {isDate ? "\uD83D\uDCC5" : "\uD83D\uDCC4"}
      </span>
      <span className="mention-label text-truncate">{value}</span>
    </NodeViewWrapper>
  );
}
