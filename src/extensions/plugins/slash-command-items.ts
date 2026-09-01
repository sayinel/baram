import type { SlashMenuItem } from "../../components/command/SlashMenu";
import type { Editor } from "@tiptap/core";

import { buildAdvancedItems } from "./slash-command-items-advanced";
import { buildAIItems, buildCustomAIItems } from "./slash-command-items-ai";
import { buildBasicItems } from "./slash-command-items-basic";
import { buildJournalItems } from "./slash-command-items-journal";
import { buildMediaItems } from "./slash-command-items-media";
import { buildRichContentItems } from "./slash-command-items-rich";
import { buildTaskItems } from "./slash-command-items-tasks";

export function buildSlashItems(editor: Editor): SlashMenuItem[] {
  return [
    ...buildBasicItems(editor),
    ...buildRichContentItems(editor),
    ...buildMediaItems(editor),
    ...buildAdvancedItems(editor),
    ...buildTaskItems(editor),
    ...buildAIItems(editor),
    ...buildJournalItems(editor),
    // §48 custom AI commands render inside the "AI" group (category: "AI"),
    // but sit here — AFTER journal — in array order. See the comment on
    // buildCustomAIItems itself: this position fixes each item's flatIdx,
    // and Arrow-key traversal depends on that array order, not the group a
    // category renders under. Do not move this call next to buildAIItems.
    ...buildCustomAIItems(editor),
  ];
}
