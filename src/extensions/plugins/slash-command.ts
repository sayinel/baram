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
import { slashCommandPluginKey } from "./suggestion-keys";

export { buildSlashItems } from "./slash-command-items";

/**
 * `/`가 **언제** 트리거인가. `findSuggestionMatch`가 그대로 받는 모양이라, 테스트가
 * 라이브러리의 매처에 이것을 넣어 실제 사용자 문자열로 확인할 수 있다.
 *
 * §308 M3-b에서 `startOfLine`이 참에서 거짓이 됐다. `/due`는 정의상 **쓰던 태스크 줄
 * 끝에서** 부르는 것인데(설계 §18.11), 참이면 `/`가 텍스트 노드의 첫 글자일 때만 열려
 * 그 자리에서는 메뉴가 아예 뜨지 않는다.
 *
 * 그래도 아무 데서나 열리지는 않는다. `allowedPrefixes`가 `/` 앞을 공백(또는 노드 처음)
 * 으로 묶으므로 `https://`, `9/15`, `./path`, `and/or`는 지나간다. 기본값이지만 명시해
 * 둔다 — 이 기능이 기대는 가드이고, 라이브러리 기본값이 바뀌면 조용히 새기 때문이다.
 */
export const SLASH_TRIGGER = {
  allowSpaces: false,
  allowToIncludeChar: false,
  allowedPrefixes: [" "],
  char: "/",
  startOfLine: false,
};

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
        // §12-1: named key (was the shared @tiptap/suggestion default) so the
        // vim Esc arbiter can query popup state without renderer imports.
        pluginKey: slashCommandPluginKey,
        ...SLASH_TRIGGER,
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
