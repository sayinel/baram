// §298 Phase 1 (§12-1) — canonical PluginKeys for the 5 suggestion popups.
//
// Leaf module by design: imports nothing but prosemirror-state, so the vim
// Esc arbiter (§4) can read popup activity without pulling in the suggestion
// renderers (React components) or creating import cycles. Key NAMES are the
// pre-existing ones — only their definitions moved here; "slashCommand" is
// new (it previously fell back to @tiptap/suggestion's shared default key).
import { PluginKey } from "@tiptap/pm/state";

export const slashCommandPluginKey = new PluginKey("slashCommand");
export const wikilinkSuggestPluginKey = new PluginKey("wikilinkSuggest");
export const mentionSuggestPluginKey = new PluginKey("mentionSuggest");
export const tagSuggestPluginKey = new PluginKey("tagSuggest");
export const skillVariableSuggestPluginKey = new PluginKey(
  "skillVariableSuggest",
);

/** All five, for callers that arbitrate against "any suggestion popup open". */
export const suggestionPluginKeys = [
  slashCommandPluginKey,
  wikilinkSuggestPluginKey,
  mentionSuggestPluginKey,
  tagSuggestPluginKey,
  skillVariableSuggestPluginKey,
] as const;
