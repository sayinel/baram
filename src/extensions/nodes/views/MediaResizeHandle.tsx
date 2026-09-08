// The edge strip a media block is resized by, and its hover label.
//
// One component rather than the markup repeated per block: the label is the same sentence
// everywhere, and four copies of it drifted before this existed — video's two handles carried
// no label at all, so the one block whose controls sit under the pointer anyway was also the
// one that never said what its edges do.
import React from "react";

import { Tooltip } from "../../../components/Tooltip";
import { useTranslation } from "../../../i18n/useTranslation";

interface MediaResizeHandleProps {
  /**
   * `span` when the block is inline content inside a paragraph (a block reference); `div` for
   * the block-level media. The two are not interchangeable — a `div` inside a `<p>` is invalid
   * HTML that the parser lifts out of the paragraph.
   */
  as?: "div" | "span";
  /** Blocks in an atom NodeView pass a stop so the click never selects/edits the block. */
  onClick?: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  side: "left" | "right";
}

export function MediaResizeHandle({
  as: Tag = "div",
  onClick,
  onMouseDown,
  side,
}: MediaResizeHandleProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    // Outward, not above: the handle spans the block's full height, so a pill over the block
    // would cover the very thing being resized while the pointer hunts for the edge.
    <Tooltip label={t("blockChrome.resize")} placement={side}>
      <Tag
        className={`media-resize-handle media-resize-handle-${side}`}
        onClick={onClick}
        onMouseDown={onMouseDown}
      />
    </Tooltip>
  );
}
