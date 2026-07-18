// §28 Wikilink Node Extension — [[page]], [[page|display]], [[page#heading]]
import { InputRule, mergeAttributes, Node, nodePasteRule } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { idForTitle } from "../../stores/zettelkasten/zettel-index";
import { isDateString } from "../../utils/journal/journal";
import { isZettelId } from "../../utils/zettelkasten/parse-note-title";
import { WikilinkView } from "./wikilink-view";

export interface WikilinkOptions {
  HTMLAttributes: Record<string, unknown>;
  onNavigate: (
    target: string,
    heading?: null | string,
    vaultAlias?: null | string,
  ) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (attrs: {
        blockId?: null | string;
        display?: null | string;
        heading?: null | string;
        target: string;
        vaultAlias?: null | string;
      }) => ReturnType;
    };
  }
}

// [[target]], [[target|display]], [[target#heading]], [[alias::target]], etc.
const wikilinkInputRegex =
  /\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]$/;

// Same shape as wikilinkInputRegex but WITHOUT the trailing `$` end-anchor
// and WITH the `g` flag — paste content is matched anywhere (and possibly
// multiple times) within the pasted text, unlike typed input which only
// ever matches at the caret (end of input).
const wikilinkPasteRegex =
  /\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

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
      vaultAlias: {
        default: null,
        renderHTML: (attrs) => ({
          "data-vault-alias": attrs.vaultAlias ?? "",
        }),
        parseHTML: (el) => el.getAttribute("data-vault-alias") || null,
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
          const [, vaultAlias, target, heading, blockId, display] = match;
          // §95 B2: eagerly normalize a manually-typed [[title]] to [[id]]
          // when it uniquely resolves in the zettel index. Cross-vault
          // targets and targets that are already ids are left untouched;
          // ambiguous/no-match titles fall through to the typed target.
          const effectiveTarget =
            (!vaultAlias && !isZettelId(target) && idForTitle(target)) ||
            target;
          const { tr } = state;
          tr.replaceWith(
            range.from,
            range.to,
            this.type.create({
              vaultAlias: vaultAlias || null,
              target: effectiveTarget,
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

  // ProseMirror InputRules only fire on typed input, never on paste — so
  // pasted `[[...]]` text needs its own conversion path here, using the
  // same capture groups (incl. §95 eager normalization) as the InputRule.
  addPasteRules() {
    return [
      nodePasteRule({
        find: wikilinkPasteRegex,
        type: this.type,
        getAttributes: (match) => {
          const [, vaultAlias, target, heading, blockId, display] = match;
          const effectiveTarget =
            (!vaultAlias && !isZettelId(target) && idForTitle(target)) ||
            target;
          return {
            vaultAlias: vaultAlias || null,
            target: effectiveTarget,
            display: display || null,
            heading: heading || null,
            blockId: blockId || null,
          };
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
              wikilinkNode.attrs.heading as null | string,
              wikilinkNode.attrs.vaultAlias as null | string,
            );
            return true;
          },
        },
      }),
    ];
  },
});
