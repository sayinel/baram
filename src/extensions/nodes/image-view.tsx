// §3.3 Image NodeView — edge-drag resize, caption editing, AI menu
import { useCallback, useRef, useState } from "react";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Captions, Maximize2, Sparkles } from "lucide-react";

import { ImageOriginalView } from "../../components/editor/ImageOriginalView";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import { MediaToolbar, MediaToolbarButton } from "./views/MediaToolbar";
import { originalImageUrl, useImagePreview } from "./views/use-image-preview";
import { useMediaResize } from "./views/use-media-resize";

export function ImageView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const rawSrc = node.attrs.src as string;
  const alt = (node.attrs.alt as string) || "";
  const title = (node.attrs.title as string) || "";
  const widthPercent = (node.attrs.widthPercent as number) || 100;
  const widthPixel = node.attrs.widthPixel as number | undefined;

  // §3.3 표시용 URL — 원본이 아니라 2048px 프리뷰다(그 이유는 use-image-preview.ts).
  // 준비되기 전에는 null이고, 그동안 <img>를 만들지 않는다.
  const src = useImagePreview(rawSrc);

  // §56d: Show caption placeholder for journal photo assets
  const isJournalAsset = /assets\/\d{4}-\d{2}\//.test(rawSrc);

  const [viewingOriginal, setViewingOriginal] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionText, setCaptionText] = useState(alt);
  const captionRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // §5.1: Image click → NodeSelection is handled by the atom media click
  // guard in atom-media-click-guard.ts (handleDOMEvents.mousedown). React
  // handlers must NOT call stopPropagation() because React 18 processes
  // onMouseDown during the capture phase on #root, which would block the
  // event from reaching PM.

  // Edge-drag resize (Notion-style), shared with the SVG/Mermaid blocks. The
  // figure is centered, so the same centre-distance maths apply; width persists
  // to the widthPercent attr (already serialized to `<img width="X%">`).
  const { dragPct, startResize } = useMediaResize(containerRef, (pct) => {
    // ‼️ widthPixel도 함께 지운다 (§294 I1). buildMediaHtmlTag는 픽셀 폭이 있으면
    // 그쪽을 먼저 쓰므로, 남겨 두면 방금 끝낸 드래그가 저장 시점에 조용히 버려진다 —
    // 파일은 `width="640"`을 그대로 들고 있고 다시 열면 원래 크기다.
    updateAttributes({ widthPercent: pct, widthPixel: undefined });
  });
  const effectiveWidth = dragPct ?? widthPercent;

  // §294 I1: 맨숫자 `width`는 **픽셀**이다(HTML `<img width>`의 의미). 파싱해서
  // 저장까지 하면서 그리지 않으면 `<img src="a.png" width="640">`이 자기 마크다운과
  // 어긋나게 100%로 렌더된다. 드래그 중에는 % 미리보기가 이긴다 — 드래그가 끝나면
  // 위 onCommit이 픽셀 폭을 지우므로 그 %가 그대로 남는다.
  const figureWidth =
    dragPct == null && widthPixel ? `${widthPixel}px` : `${effectiveWidth}%`;

  const handleCaptionSave = useCallback(() => {
    setEditingCaption(false);
    // Only update if changed; defer to let ProseMirror's selection settle first
    if (captionText !== alt) {
      requestAnimationFrame(() => {
        updateAttributes({ alt: captionText });
      });
    }
  }, [updateAttributes, captionText, alt]);

  const handleCaptionKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCaptionSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCaptionText(alt);
        setEditingCaption(false);
      }
    },
    [handleCaptionSave, alt],
  );

  const startCaptionEdit = useCallback(() => {
    setCaptionText(alt);
    setEditingCaption(true);
    setTimeout(() => captionRef.current?.focus(), 0);
  }, [alt]);

  return (
    <NodeViewWrapper className="image-node-view" ref={containerRef}>
      <figure
        className={`image-figure ${selected ? "image-selected" : ""}`}
        // 프리뷰를 기다리는 동안 자리를 잡아 둔다 — <img>가 없으면 figure 높이가 0이라
        // 본문이 두 번 밀린다. 정확한 비율은 아직 알 수 없으므로 최소 높이만 준다.
        data-preview-loading={src ? undefined : ""}
        style={{ width: figureWidth }}
      >
        {/*
          ‼️ `decoding="async"`를 쓰지 않는다. 그 속성은 "디코드된 이미지 없이 프레임을 먼저
          내보내도 된다"는 허락이고, 비트맵이 버려졌다 다시 디코드되는 상황에서는 그 빈
          프레임이 바로 사용자가 본 깜박임이다. 프리뷰는 최대 3.1 MPix라 동기 디코드가 싸다.

          `loading="lazy"`는 남긴다: 사진이 여러 장인 하루에서 화면 밖 이미지까지 첫 페인트
          전에 받아 오지 않게 한다.
        */}
        {src && (
          <img
            alt={alt}
            data-drag-handle=""
            draggable={false}
            loading="lazy"
            src={src}
            title={title || undefined}
          />
        )}

        {/* Edge resize handles */}
        <div
          className="media-resize-handle media-resize-handle-left"
          onMouseDown={startResize}
          title="Drag to resize"
        />
        <div
          className="media-resize-handle media-resize-handle-right"
          onMouseDown={startResize}
          title="Drag to resize"
        />
        {dragPct != null && (
          <div className="media-resize-label">{dragPct}%</div>
        )}

        {/* Hover toolbar — shared chrome with SVG/Mermaid blocks */}
        <MediaToolbar>
          <MediaToolbarButton
            active={editingCaption}
            onClick={startCaptionEdit}
            title="Caption"
          >
            <Captions size={16} strokeWidth={2} />
          </MediaToolbarButton>
          {/* §3.3 본문은 프리뷰를 그리므로 원본을 볼 통로가 필요하다 — SVG/Mermaid의
              Fullscreen view와 같은 자리, 같은 아이콘. */}
          <MediaToolbarButton
            onClick={() => setViewingOriginal(true)}
            title="View original"
          >
            <Maximize2 size={16} strokeWidth={2} />
          </MediaToolbarButton>
          <MediaToolbarButton
            onClick={(e) => {
              const context =
                [
                  alt && `Alt: ${alt}`,
                  title && `Title: ${title}`,
                  rawSrc && `Source: ${rawSrc}`,
                ]
                  .filter(Boolean)
                  .join("\n") || "image";
              const pos = getPos();
              if (typeof pos !== "number") return;
              showNodeViewAIMenu(
                e.currentTarget,
                "image",
                context,
                editor,
                pos,
              );
            }}
            title="AI Commands"
          >
            <Sparkles size={14} />
          </MediaToolbarButton>
        </MediaToolbar>

        {/* Caption */}
        {editingCaption ? (
          <figcaption className="image-caption image-caption-editing">
            <input
              className="media-caption-input"
              onBlur={handleCaptionSave}
              onChange={(e) => setCaptionText(e.target.value)}
              onKeyDown={handleCaptionKeyDown}
              placeholder="Add caption..."
              ref={captionRef}
              value={captionText}
            />
          </figcaption>
        ) : alt ? (
          <figcaption
            className="image-caption"
            contentEditable={false}
            onClick={startCaptionEdit}
          >
            {alt}
          </figcaption>
        ) : isJournalAsset ? (
          <figcaption
            className="image-caption image-caption-placeholder"
            contentEditable={false}
            onClick={startCaptionEdit}
          >
            캡션 추가...
          </figcaption>
        ) : null}
      </figure>
      {viewingOriginal && (
        <ImageOriginalView
          alt={alt}
          onClose={() => setViewingOriginal(false)}
          originalUrl={originalImageUrl(rawSrc)}
          previewUrl={src}
        />
      )}
    </NodeViewWrapper>
  );
}
