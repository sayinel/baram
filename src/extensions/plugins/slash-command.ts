// §4.6 Slash Commands — Tiptap Extension using Suggestion API
import type { Editor } from "@tiptap/core";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";

import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";

import {
  type SlashMenuItem,
  SlashMenuList,
  type SlashMenuRef,
} from "../../components/command/SlashMenu";
import { buildSlashItems } from "./slash-command-items";

export { buildSlashItems } from "./slash-command-items";

const SLASH_MENU_HEIGHT = 320; // approximate max popup height

function positionPopup(popup: HTMLDivElement, coords: DOMRect) {
  const spaceBelow = window.innerHeight - coords.bottom - 4;
  popup.style.left = `${coords.left}px`;
  if (spaceBelow < SLASH_MENU_HEIGHT) {
    // Not enough room below — position above the cursor
    popup.style.top = `${coords.top - SLASH_MENU_HEIGHT - 4}px`;
  } else {
    popup.style.top = `${coords.bottom + 4}px`;
  }
}

export const SlashCommands = Extension.create({
  name: "slashCommands",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      Suggestion({
        editor,
        char: "/",
        startOfLine: true,
        command: ({
          editor: ed,
          range,
          props,
        }: {
          editor: Editor;
          props: SlashMenuItem;
          range: { from: number; to: number };
        }) => {
          ed.chain().focus().deleteRange(range).run();
          props.action();
        },
        items: ({ query }: { query: string }) => {
          const items = buildSlashItems(editor);
          if (!query) return items;
          const q = query.toLowerCase();
          return items.filter(
            (item) =>
              item.id.toLowerCase().includes(q) ||
              item.label.toLowerCase().includes(q) ||
              item.category.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q) ||
              (item.mdHint ?? "").toLowerCase().includes(q),
          );
        },
        render: () => {
          let component: null | ReactRenderer<SlashMenuRef> = null;
          let popup: HTMLDivElement | null = null;

          return {
            onStart: (props: SuggestionProps) => {
              component = new ReactRenderer(SlashMenuList, {
                props: {
                  items: props.items as SlashMenuItem[],
                  command: props.command,
                },
                editor: props.editor,
              });

              popup = document.createElement("div");
              popup.className = "slash-menu-popup";
              document.body.appendChild(popup);
              popup.appendChild(component.element);

              const coords = props.clientRect?.();
              if (coords && popup) {
                positionPopup(popup, coords);
              }
            },
            onUpdate: (props: SuggestionProps) => {
              component?.updateProps({
                items: props.items as SlashMenuItem[],
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
