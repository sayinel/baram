// §72c Skill variable autocomplete — Tiptap Extension using Suggestion API
// Triggers on {{ and shows variable suggestions for skill files
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";

import {
  type SkillVariableItem,
  SkillVariableList,
} from "../../components/editor/SkillVariableList";
import { useSkillStore } from "../../stores/ai/skill";
import { createSuggestionRenderer } from "./suggestion-renderer";

/** Default skill template variables */
const DEFAULT_VARIABLES: SkillVariableItem[] = [
  { name: "selection", description: "Currently selected text in the editor" },
  { name: "document", description: "Full document content" },
  { name: "input", description: "User-provided input or prompt" },
  { name: "clipboard", description: "Current clipboard contents" },
];

export const SkillVariableSuggest = Extension.create({
  name: "skillVariableSuggest",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      Suggestion({
        editor,
        char: "{{",
        pluginKey: new PluginKey("skillVariableSuggest"),
        // Only allow in paragraphs and text-bearing blocks, not in code blocks
        allow: ({ state, range }) => {
          // Only show in skill files
          const { isSkill } = useSkillStore.getState();
          if (!isSkill) return false;

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
          props: SkillVariableItem;
          range: { from: number; to: number };
        }) => {
          // Replace the {{query with {{name}} (the trigger {{ is already consumed,
          // so we insert the full {{name}} to ensure correct output)
          ed.chain()
            .focus()
            .deleteRange(range)
            .insertContent("{{" + props.name + "}}")
            .run();
        },
        items: ({ query }: { query: string }) => {
          const { isSkill } = useSkillStore.getState();
          if (!isSkill) return [];

          const q = query.toLowerCase();
          return DEFAULT_VARIABLES.filter(
            (v) =>
              v.name.toLowerCase().includes(q) ||
              v.description.toLowerCase().includes(q),
          );
        },
        render: createSuggestionRenderer<SkillVariableItem>({
          component: SkillVariableList,
          popupClass: "skill-var-popup",
          menuHeight: 240,
        }),
      }),
    ];
  },
});
