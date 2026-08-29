import { useCallback, useState } from "react";

import type { Editor } from "@tiptap/react";

import { GripVertical, Plus } from "lucide-react";

// §4.8 Block Handle — drag handle + menu on block hover
import { chainWithVimExternalEdit } from "../../extensions/plugins/vim/vim-keys";
import { getEditorZoom } from "../../utils/zoom-coords";
import { BlockHandleMenu } from "./BlockHandleMenu";
import { useBlockDrag } from "./use-block-drag";
import { useBlockHandlePosition } from "./use-block-handle-position";

interface BlockHandleProps {
  editor: Editor;
}

export function BlockHandle({ editor }: BlockHandleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const { handle, setHandle, cancelHideTimeout, scheduleHide } =
    useBlockHandlePosition(editor, menuOpen, closeMenu);

  // §4.8 Drag-to-reorder
  const { startDrag, isDragging } = useBlockDrag(editor);

  if (!handle) return null;

  // Guard: stale position after document change
  if (handle.pos >= editor.state.doc.content.size) return null;

  const editorRect = editor.view.dom.getBoundingClientRect();
  // §4.2 Zoom: the handle/menu are position:fixed inside the zoomed
  // .editor-area-scroll, which renders such elements at (zoom × top, zoom × left)
  // — scaled from the viewport origin (measured in WKWebView). getBoundingClientRect
  // already returns scaled visual coords, so dividing the target visual position
  // by the zoom factor cancels the render-time scaling and the handle lands
  // exactly on the block. No-op at zoom 1.
  const renderZoom = getEditorZoom();
  const handlePos = {
    // editorRect.left is visual; the 14px gutter inset is a content-space size,
    // so it must NOT be divided by zoom — only the visual term is. Writing it
    // as `editorRect.left / zoom + 14` keeps the inset a constant 14 content-px
    // at every zoom level. (Folding it into `(editorRect.left + 14) / zoom`
    // shrinks the inset to 14/zoom content-px, so the handle drifts toward the
    // text on zoom-in and away on zoom-out.) y already bakes × zoom into
    // lineCenterOffset, which is why only x drifted.
    x: editorRect.left / renderZoom + 14,
    y: handle.top / renderZoom,
  };

  return (
    <>
      <div
        className="block-handle"
        onMouseEnter={cancelHideTimeout}
        onMouseLeave={() => {
          if (!menuOpen) scheduleHide();
        }}
        style={{
          top: `${handlePos.y}px`,
          left: `${handlePos.x}px`,
        }}
      >
        {/* §4.8 Add a block below and open the slash menu to pick its type
            (Notion-style): insert an empty paragraph, then type "/" so the
            SlashCommands suggestion opens on the fresh block. */}
        <button
          className="block-handle-add-btn"
          onClick={() => {
            const node = editor.state.doc.nodeAt(handle.pos);
            if (!node) return;
            const insertAt = handle.pos + node.nodeSize;
            chainWithVimExternalEdit(editor)
              .focus()
              .insertContentAt(insertAt, { type: "paragraph" })
              .setTextSelection(insertAt + 1)
              .insertContent("/")
              .run();
            setHandle(null);
          }}
          title="Add block below"
        >
          <Plus size={12} strokeWidth={2} />
        </button>
        <button
          className="block-handle-btn"
          onClick={() => {
            if (isDragging) return; // a drag just ended — don't toggle the menu
            setMenuOpen(!menuOpen);
          }}
          onMouseDown={(e) => startDrag(e, handle.pos)}
          title="Drag to move · click for menu"
        >
          <GripVertical size={16} strokeWidth={2} />
        </button>
      </div>

      {menuOpen && (
        <BlockHandleMenu
          editor={editor}
          left={handlePos.x}
          onClose={closeMenu}
          pos={handle.pos}
          top={handlePos.y}
        />
      )}
    </>
  );
}
