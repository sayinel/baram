// §294 Video Extension (block-level) with §296 NodeView
import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { classifyMediaSrc } from "../../utils/media-src";
import { createAtomMediaClickGuard } from "../plugins/atom-media-click-guard";
import { VideoView } from "./video-view";

export interface VideoOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    video: {
      setVideo: (options: {
        alt?: string;
        src: string;
        title?: string;
      }) => ReturnType;
    };
  }
}

export const Video = Node.create<VideoOptions>({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      widthPercent: { default: 100 },
      widthPixel: { default: undefined },
    };
  },

  parseHTML() {
    return [{ tag: "video[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoView);
  },

  addCommands() {
    return {
      setVideo:
        (options) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: options }),
    };
  },

  addProseMirrorPlugins() {
    return [
      createAtomMediaClickGuard({
        nodeName: "video",
        wrapperClass: "video-node-view",
        excludeSelectors: [
          ".media-toolbar",
          ".video-caption",
          ".video-embed-card",
          // §296 fix (M3): the error card had no exclusion, so it was the
          // only one of the four render shapes data-drag-handle covers
          // (poster/video, playing embed iframe, unplayed embed card, error
          // card) that the guard's own preventDefault() on mousedown (see
          // atom-media-click-guard.ts) suppressed drag-initiation for. A
          // broken embed is exactly the node a user wants to relocate or
          // delete, so being unable to drag it was worse than the
          // alternative. Selection still works for it exactly as it already
          // does for <video>/<iframe> below — via PM's own default mousedown
          // handling, not this guard's.
          ".video-error",
        ],
        excludeTagNames: ["INPUT", "VIDEO", "IFRAME"],
      }),
    ];
  },

  addInputRules() {
    // ![alt](url) 줄 전체 — src가 동영상일 때만 video 노드가 된다.
    // image.ts의 같은 규칙과 공존한다: 여기서 handler가 아무것도 하지 않으면
    // image 쪽 규칙이 처리한다.
    return [
      new InputRule({
        find: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/,
        handler: ({ state, range, match }) => {
          const [, alt, src, title] = match;
          if (classifyMediaSrc(src) === "image") return;

          const { tr } = state;
          const videoNode = this.type.create({
            src,
            alt: alt || null,
            title: title || null,
          });

          const $from = state.doc.resolve(range.from);
          const paraStart = $from.before($from.depth);
          const paraEnd = $from.after($from.depth);
          tr.replaceWith(paraStart, paraEnd, videoNode);

          const posAfter = paraStart + videoNode.nodeSize;
          if (!tr.doc.resolve(posAfter).nodeAfter?.isTextblock) {
            tr.insert(posAfter, state.schema.nodes.paragraph.create());
          }
          tr.setSelection(TextSelection.create(tr.doc, posAfter + 1));
        },
      }),
    ];
  },
});
