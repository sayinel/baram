// §30b Block Reference Extension — ((target#^blockId)) or ((target#^blockId|display))
// §30c adds NodeView, onNavigate option, Cmd+click plugin
// §275.5 adds InputRule + pasteRule so typed/pasted refs become nodes immediately
import { InputRule, mergeAttributes, Node, nodePasteRule } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { BLOCK_REF_RE, parseBlockRefMatch } from "../../pipeline/block-id";
import { BlockReferenceView } from "./block-reference-view";

export interface BlockReferenceOptions {
  HTMLAttributes: Record<string, string>;
  onNavigate: (target: string, blockId: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockReference: {
      insertBlockReference: (attrs: {
        blockId: string;
        display?: null | string;
        target: string;
      }) => ReturnType;
    };
  }
}

export const BlockReference = Node.create<BlockReferenceOptions>({
  name: "blockReference",
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
      target: { default: "" },
      blockId: { default: "" },
      display: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="block-reference"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const display =
      node.attrs.display || `${node.attrs.target}#^${node.attrs.blockId}`;
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "block-reference",
        "data-target": node.attrs.target,
        "data-block-id": node.attrs.blockId,
        "data-display": node.attrs.display || "",
        class: "block-reference",
      }),
      display,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockReferenceView);
  },

  // §275.5 타이핑/붙여넣기 즉시 노드화.
  // 이것들이 없으면 ((...))는 저장·재오픈으로 파이프라인을 한 번 돌기 전까지
  // 생텍스트로 남는다. wikilink.ts:123-177의 패턴을 따른다.
  addInputRules() {
    return [
      new InputRule({
        // BLOCK_REF_RE에는 끝 앵커가 없다 — 타이핑은 항상 캐럿(입력 끝)에서
        // 매치되어야 하므로 여기서 붙인다.
        find: new RegExp(`${BLOCK_REF_RE.source}$`),
        handler: ({ match, range, state }) => {
          const { tr } = state;
          tr.replaceWith(
            range.from,
            range.to,
            this.type.create(parseBlockRefMatch(match)),
          );
        },
      }),
    ];
  },

  // ProseMirror InputRules only fire on typed input, never on paste — so
  // pasted `((...))` text needs its own conversion path here.
  addPasteRules() {
    return [
      nodePasteRule({
        // 붙여넣기 내용은 어디서든, 여러 번 매치될 수 있다 — g 플래그가 필요하다.
        find: new RegExp(BLOCK_REF_RE.source, "g"),
        type: this.type,
        getAttributes: (match) => parseBlockRefMatch(match),
      }),
    ];
  },

  addCommands() {
    return {
      insertBlockReference:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },

  // Cmd+click navigates to the block reference target
  addProseMirrorPlugins() {
    const { onNavigate } = this.options;
    return [
      new Plugin({
        props: {
          handleClick(view, pos, event) {
            if (!(event.metaKey || event.ctrlKey)) return false;

            const { state } = view;
            const node = state.doc.nodeAt(pos);
            const resolved = state.doc.resolve(pos);

            const refNode =
              node?.type.name === "blockReference"
                ? node
                : resolved.parent?.type.name === "blockReference"
                  ? resolved.parent
                  : null;

            if (!refNode) return false;

            onNavigate(
              refNode.attrs.target as string,
              refNode.attrs.blockId as string,
            );
            return true;
          },
        },
      }),
    ];
  },
});
