// §57 Mention Node Extension — @[[page]], @[[2026-02-27]]
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

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

  // ‼️ §316 Clicks belong to the NodeView (mention-view), and to it alone.
  //
  // There used to be a `handleClick` plugin here as well, holding its own copy
  // of the rule — and ProseMirror listens on `view.dom`, INSIDE React's root
  // container, so it ran BEFORE the NodeView's onClick and the NodeView's
  // stopPropagation could not call it back. When §316 made a date mention open
  // the calendar instead of navigating, this copy went on navigating: every
  // click on a date chip also resolved it as a wikilink target and, finding no
  // such file, silently wrote `2026-08-30.md` into the vault.
  //
  // The NodeView is the only place that can own this anyway — changing the date
  // needs `updateAttributes`, and skipping a read-only view needs
  // `editor.isEditable`. Two handlers for one gesture is what made this a bug
  // rather than a decision.
});
