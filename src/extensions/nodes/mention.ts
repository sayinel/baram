// §57 Mention Node Extension — @[[page]], @[[2026-02-27]]
import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { isDateString } from "../../utils/journal";
import { MentionView } from "./mention-view";

export interface MentionOptions {
  onNavigate: (type: string, value: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mention: {
      insertMention: (attrs: { type: string; value: string }) => ReturnType;
    };
  }
}

export const Mention = Node.create<MentionOptions>({
  name: "mention",
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
      type: { default: "page" }, // "date" | "page"
      value: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const mentionType = HTMLAttributes.type || "page";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "mention",
        "data-mention-type": mentionType,
        "data-value": HTMLAttributes.value,
        class: `mention mention-${mentionType}`,
      }),
      HTMLAttributes.value || "",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionView);
  },

  addCommands() {
    return {
      insertMention:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },

  // Click navigates to the mention target
  addProseMirrorPlugins() {
    const { onNavigate } = this.options;
    return [
      new Plugin({
        props: {
          handleClick(view, pos, event) {
            const { state } = view;
            const resolved = state.doc.resolve(pos);
            const node = state.doc.nodeAt(pos);

            const mentionNode =
              node?.type.name === "mention"
                ? node
                : resolved.parent?.type.name === "mention"
                  ? resolved.parent
                  : null;

            if (!mentionNode) return false;

            const mentionType = mentionNode.attrs.type as string;
            const value = mentionNode.attrs.value as string;

            // Date mentions navigate on single click; page mentions require Cmd/Ctrl+click
            if (mentionType !== "date" && isDateString(value) === false) {
              if (!(event.metaKey || event.ctrlKey)) return false;
            }

            onNavigate(mentionType, value);
            return true;
          },
        },
      }),
    ];
  },
});
