import type { SlashMenuItem } from "../../components/command/slash-menu-item";
import type { Editor } from "@tiptap/core";

import { awaitBoundToEditor } from "../../utils/editor/mutation-tasks";
import { showFieldDialog } from "../../utils/field-dialog";
import { classifyMediaSrc } from "../../utils/media-src";
import { chainWithVimExternalEdit } from "./vim/vim-keys";

export function buildMediaItems(editor: Editor): SlashMenuItem[] {
  return [
    // Media & Inline
    {
      id: "image",
      label: "Image",
      category: "Media",
      description: "Insert an image",
      mdHint: "![](url)",
      action: async () => {
        // §12-9b dialog gap — awaitBoundToEditor guarantees finish() even if
        // the dialog promise rejects (design §5c).
        const result = await awaitBoundToEditor(
          editor.view,
          showFieldDialog({
            title: "Insert Image",
            fields: [
              {
                key: "alt",
                label: "Alt text",
                placeholder: "Image description",
              },
              {
                key: "src",
                label: "Image URL",
                placeholder: "https://... or ./path.png",
              },
            ],
          }),
        );
        if (!result?.src) return;
        // §297 fix (I-4): the dialog is titled "Insert Image", but the node
        // type must be whatever classifyMediaSrc (§293, the one enumeration)
        // says — every other insertion point in this app (drop, paste, both
        // input rules, both syntax-reveal collapse sites) already asks it
        // first. Without this, typing a .mp4 path into the Image dialog
        // creates an `image` node that classifies as `video` on the next
        // save/reload, so the live and reloaded documents disagree.
        chainWithVimExternalEdit(editor)
          .focus()
          .insertContent({
            type: classifyMediaSrc(result.src) === "image" ? "image" : "video",
            attrs: { src: result.src, alt: result.alt || "", title: "" },
          })
          .run();
      },
    },
    {
      id: "video",
      label: "Video",
      category: "Media",
      description: "Insert a video",
      mdHint: "![](video.mp4)",
      action: async () => {
        // §12-9b dialog gap — awaitBoundToEditor guarantees finish() even if
        // the dialog promise rejects (design §5c).
        const result = await awaitBoundToEditor(
          editor.view,
          showFieldDialog({
            title: "Insert Video",
            fields: [
              { key: "alt", label: "Caption", placeholder: "Video caption" },
              {
                key: "src",
                label: "Video URL or path",
                placeholder: "https://youtu.be/... or ./clip.mp4",
              },
            ],
          }),
        );
        if (!result?.src) return;
        // §297 fix (I-4): mirror of the /image fix above — a src that
        // classifies as `image` (e.g. a .png typed into this dialog) must
        // become an `image` node, or it silently flips to one on reload.
        chainWithVimExternalEdit(editor)
          .focus()
          .insertContent({
            type: classifyMediaSrc(result.src) === "image" ? "image" : "video",
            attrs: { src: result.src, alt: result.alt || "", title: "" },
          })
          .run();
      },
    },
    {
      id: "link",
      label: "Link",
      category: "Media",
      description: "Insert a hyperlink",
      mdHint: "[text](url)",
      action: async () => {
        // §12-9b dialog gap — awaitBoundToEditor guarantees finish() even if
        // the dialog promise rejects (design §5c).
        const result = await awaitBoundToEditor(
          editor.view,
          showFieldDialog({
            title: "Insert Link",
            fields: [
              { key: "text", label: "Text", placeholder: "Display text" },
              { key: "url", label: "URL", placeholder: "https://..." },
            ],
          }),
        );
        if (!result?.url) return;
        const text = result.text || result.url;
        chainWithVimExternalEdit(editor)
          .focus()
          .insertContent({
            type: "text",
            text,
            marks: [{ type: "link", attrs: { href: result.url } }],
          })
          .run();
      },
    },
  ];
}
