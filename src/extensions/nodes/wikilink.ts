// §28 Wikilink Node Extension — [[page]], [[page|display]], [[page#heading]]
import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { isDateString } from "../../utils/journal";
import { WikilinkView } from "./wikilink-view";

export interface WikilinkOptions {
  HTMLAttributes: Record<string, unknown>;
  onNavigate: (target: string, heading?: null | string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (attrs: {
        blockId?: null | string;
        display?: null | string;
        heading?: null | string;
        target: string;
      }) => ReturnType;
    };
  }
}

// [[target]], [[target|display]], [[target#heading]], [[target#heading|display]]
const wikilinkInputRegex =
  /\[\[([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]$/;

export const Wikilink = Node.create<WikilinkOptions>({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  marks: "",

  addOptions() {
    return {
      HTMLAttributes: {},
      onNavigate: () => {},
    };
  },

  addAttributes() {
    return {
      target: {
        default: "",
        renderHTML: (attrs) => ({ "data-target": attrs.target }),
        parseHTML: (el) => el.getAttribute("data-target") ?? "",
      },
      display: {
        default: null,
        renderHTML: (attrs) => ({ "data-display": attrs.display ?? "" }),
        parseHTML: (el) => el.getAttribute("data-display") || null,
      },
      heading: {
        default: null,
        renderHTML: (attrs) => ({ "data-heading": attrs.heading ?? "" }),
        parseHTML: (el) => el.getAttribute("data-heading") || null,
      },
      blockId: {
        default: null,
        renderHTML: (attrs) => ({ "data-block-id": attrs.blockId ?? "" }),
        parseHTML: (el) => el.getAttribute("data-block-id") || null,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="wikilink"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const display = HTMLAttributes.display || HTMLAttributes.target || "";
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "wikilink",
        class: "wikilink",
      }),
      display,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikilinkView);
  },

  addCommands() {
    return {
      insertWikilink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: wikilinkInputRegex,
        handler: ({ state, range, match }) => {
          const [, target, heading, blockId, display] = match;
          const { tr } = state;
          tr.replaceWith(
            range.from,
            range.to,
            this.type.create({
              target,
              display: display || null,
              heading: heading || null,
              blockId: blockId || null,
            }),
          );
        },
      }),
      // §57: @today/@yesterday/@tomorrow/@date InputRules moved to mention-suggest.ts
    ];
  },

  // Cmd+click navigates to the wikilink target
  addProseMirrorPlugins() {
    const { onNavigate } = this.options;
    return [
      new Plugin({
        props: {
          handleClick(view, pos, event) {
            const { state } = view;
            const resolved = state.doc.resolve(pos);
            const node = state.doc.nodeAt(pos);

            // Check if clicked on a wikilink node or its parent
            const wikilinkNode =
              node?.type.name === "wikilink"
                ? node
                : resolved.parent?.type.name === "wikilink"
                  ? resolved.parent
                  : null;

            if (!wikilinkNode) return false;

            // §56 Date wikilinks navigate on single click
            const target = wikilinkNode.attrs.target as string;
            const isDate = isDateString(target);
            if (!isDate && !(event.metaKey || event.ctrlKey)) return false;

            onNavigate(target, wikilinkNode.attrs.heading as null | string);
            return true;
          },
        },
      }),
    ];
  },
});
