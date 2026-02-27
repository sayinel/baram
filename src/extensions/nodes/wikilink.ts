// §28 Wikilink Node Extension — [[page]], [[page|display]], [[page#heading]]
import { Node, InputRule } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { resolveDateAlias, isDateString } from "../../utils/journal";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { WikilinkView } from "./wikilink-view";

export interface WikilinkOptions {
  onNavigate: (target: string, heading?: string | null) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (attrs: {
        target: string;
        display?: string | null;
        heading?: string | null;
        blockId?: string | null;
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
      onNavigate: () => {},
    };
  },

  addAttributes() {
    return {
      target: { default: "" },
      display: { default: null },
      heading: { default: null },
      blockId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="wikilink"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const display =
      HTMLAttributes.display || HTMLAttributes.target || "";
    return [
      "span",
      {
        "data-type": "wikilink",
        "data-target": HTMLAttributes.target,
        "data-display": HTMLAttributes.display || "",
        "data-heading": HTMLAttributes.heading || "",
        "data-block-id": HTMLAttributes.blockId || "",
        class: "wikilink",
      },
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
      // §56 @today → wikilink with today's date
      new InputRule({
        find: /@today$/,
        handler: ({ state, range }) => {
          const dateStr = resolveDateAlias("today")!;
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ target: dateStr }),
          );
        },
      }),
      // §56 @yesterday → wikilink with yesterday's date
      new InputRule({
        find: /@yesterday$/,
        handler: ({ state, range }) => {
          const dateStr = resolveDateAlias("yesterday")!;
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ target: dateStr }),
          );
        },
      }),
      // §56 @tomorrow → wikilink with tomorrow's date
      new InputRule({
        find: /@tomorrow$/,
        handler: ({ state, range }) => {
          const dateStr = resolveDateAlias("tomorrow")!;
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ target: dateStr }),
          );
        },
      }),
      // §56 @YYYY-MM-DD → wikilink with that date
      new InputRule({
        find: /@(\d{4}-\d{2}-\d{2})$/,
        handler: ({ state, range, match }) => {
          const dateStr = match[1];
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ target: dateStr }),
          );
        },
      }),
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

            onNavigate(
              target,
              wikilinkNode.attrs.heading as string | null,
            );
            return true;
          },
        },
      }),
    ];
  },
});
