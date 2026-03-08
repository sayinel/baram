// §72c Skill variable autocomplete — Tiptap Extension using Suggestion API
// Triggers on {{ and shows variable suggestions for skill files
import { Extension } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import type {
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import {
  SkillVariableList,
  type SkillVariableListRef,
  type SkillVariableItem,
} from "../../components/editor/SkillVariableList";
import { useSkillStore } from "../../stores/skill-store";

const MENU_HEIGHT = 240;

function positionPopup(popup: HTMLDivElement, coords: DOMRect) {
  const spaceBelow = window.innerHeight - coords.bottom - 4;
  popup.style.left = `${coords.left}px`;
  if (spaceBelow < MENU_HEIGHT) {
    popup.style.top = `${coords.top - MENU_HEIGHT - 4}px`;
  } else {
    popup.style.top = `${coords.bottom + 4}px`;
  }
}

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
          range: { from: number; to: number };
          props: SkillVariableItem;
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
        render: () => {
          let component: ReactRenderer<SkillVariableListRef> | null = null;
          let popup: HTMLDivElement | null = null;

          return {
            onStart: (props: SuggestionProps) => {
              component = new ReactRenderer(SkillVariableList, {
                props: {
                  items: props.items as SkillVariableItem[],
                  command: props.command,
                },
                editor: props.editor,
              });

              popup = document.createElement("div");
              popup.className = "skill-var-popup";
              document.body.appendChild(popup);
              popup.appendChild(component.element);

              const coords = props.clientRect?.();
              if (coords && popup) {
                positionPopup(popup, coords);
              }
            },
            onUpdate: (props: SuggestionProps) => {
              component?.updateProps({
                items: props.items as SkillVariableItem[],
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
