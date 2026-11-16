// §5.1 SVG Block — fullscreen modals (moved out of svg-block-view.tsx for
// R26/§351: each component owns its own useFontSurface call, so the hook
// only runs while its overlay is mounted. The parent owns the document state
// (code, svg) and passes it down as props; each modal owns only its §396 zoom
// scale (useViewerZoom), view-local state the parent never reads. Each
// component's own createPortal call stays
// at the tree position it had inline. Modeled on MermaidFullscreenModals.tsx,
// which split the same way for the same reason.
//
// Before this split, SvgBlockView called useFontSurface("both") twice,
// unconditionally, at the top of the component — for every SVG block in the
// document, mounted whether or not either overlay was open. That was dormant
// until a font picker existed to change fontFamily/codeFontFamily; once one
// does (§351), every keystroke in it re-renders every SvgBlockView in the
// document — this project's typing-latency defect class (§8.4 budgets
// 16ms/keystroke, cost scales with mounted NodeViews). See
// svg-block-font-surface-subscription.test.tsx for the property this fixes.
import React, { useMemo } from "react";
import { createPortal } from "react-dom";

import { ViewerZoomControls } from "../../../components/editor/ViewerZoomControls";
import { useFontSurface } from "../../../hooks/use-font-surface";
import { useViewerZoom } from "../../../hooks/use-viewer-zoom";
import { useTranslation } from "../../../i18n/useTranslation";
import { isInNativeTextControl } from "../../../utils/editor/native-text-control";
import { ensureSvgViewBox } from "../../../utils/markdown/svg-utils";
import { useInnerHtml } from "./use-inner-html";

interface SvgEditFullscreenModalProps {
  fullscreenCode: string;
  fullscreenSvg: string;
  fullscreenTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChangeCode: (value: string) => void;
  /** Commit and leave. May refuse (read-only editor) and keep the modal. */
  onClose: () => void;
  /** Leave without committing — the way out when onClose refuses. */
  onDiscard: () => void;
}

interface SvgViewFullscreenModalProps {
  onClose: () => void;
  svgHtml: string;
}

/** Fullscreen view modal (read-only). */
export function SvgViewFullscreenModal({
  onClose,
  svgHtml,
}: SvgViewFullscreenModalProps): React.ReactPortal {
  const { t } = useTranslation();
  // §349 이 오버레이는 document.body 로 포털된다 — 문서 표면의 변수를
  // 상속받지 못하므로 루트에 직접 덮는다.
  const fontSurface = useFontSurface("both");
  // §396 D6: the viewBox is added to the rendered view only — never the inline block.
  const viewMarkup = useMemo(() => ensureSvgViewBox(svgHtml), [svgHtml]);
  const svgMarkup = useInnerHtml(viewMarkup);
  const zoom = useViewerZoom({
    contentKey: svgHtml,
    contentSelector: ".svg-block-render > svg",
  });
  return createPortal(
    <div
      className="svg-fullscreen-overlay"
      // Stop click from bubbling through the React portal tree to the
      // NodeViewWrapper's onClick (which would select the block → edit mode).
      onClick={(e) => e.stopPropagation()}
      // issue 521: a right-click inside the modal is nobody's — the block
      // ignores portal events, and the browser's page menu (Reload) must
      // not appear here. Text controls keep their native menu.
      onContextMenu={(e) => {
        if (isInNativeTextControl(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
      ref={fontSurface}
    >
      <div className="svg-view-fullscreen-modal">
        <div className="svg-fullscreen-header">
          <span className="svg-block-label">svg</span>
          <ViewerZoomControls className="svg-fullscreen-zoom" zoom={zoom} />
          <button
            className="svg-fullscreen-close"
            onClick={onClose}
            onMouseDown={(e) => e.preventDefault()}
          >
            {t("common.close")}
          </button>
        </div>
        <div className="svg-view-fullscreen-body" ref={zoom.scrollRef}>
          {svgHtml ? (
            <div
              className="svg-block-render"
              dangerouslySetInnerHTML={svgMarkup}
            />
          ) : (
            <div className="svg-block-empty">{t("svgBlock.emptyPreview")}</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Fullscreen edit modal. */
export function SvgEditFullscreenModal({
  fullscreenCode,
  fullscreenSvg,
  fullscreenTextareaRef,
  onChangeCode,
  onClose,
  onDiscard,
}: SvgEditFullscreenModalProps): React.ReactPortal {
  const { t } = useTranslation();
  // §349 이 오버레이는 document.body 로 포털된다 — 문서 표면의 변수를
  // 상속받지 못하므로 루트에 직접 덮는다.
  const fontSurface = useFontSurface("both");
  // §396 D6: the viewBox is added to the rendered preview only — never to the textarea's source.
  const previewMarkup = useMemo(
    () => ensureSvgViewBox(fullscreenSvg),
    [fullscreenSvg],
  );
  const fullscreenMarkup = useInnerHtml(previewMarkup);
  // §396: zoom the preview pane only; the textarea pane is not the hook's scroller.
  const zoom = useViewerZoom({
    contentKey: fullscreenSvg,
    contentSelector: ".svg-block-render > svg",
  });
  return createPortal(
    <div
      className="svg-fullscreen-overlay"
      onClick={(e) => {
        // Don't let the click bubble through the portal to the NodeViewWrapper.
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      // issue 521: a right-click inside the modal is nobody's — the block
      // ignores portal events, and the browser's page menu (Reload) must
      // not appear here. Text controls keep their native menu.
      onContextMenu={(e) => {
        if (isInNativeTextControl(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      ref={fontSurface}
    >
      <div className="svg-fullscreen-modal">
        <div className="svg-fullscreen-header">
          <span className="svg-block-label">svg</span>
          <ViewerZoomControls className="svg-fullscreen-zoom" zoom={zoom} />
          <button
            className="svg-fullscreen-close"
            onClick={onDiscard}
            // ‼️ A native `title`, not the app pill: this modal's overlay is z-index
            // 9999 (svg-block.css) and the pill is --z-tooltip (1060), so a pill here
            // would paint BEHIND the modal. The button has visible text anyway.
            title={t("blockChrome.discardHint")}
          >
            {t("blockChrome.discard")}
          </button>
          <button className="svg-fullscreen-close" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="svg-fullscreen-body">
          <div className="svg-fullscreen-editor">
            <textarea
              autoCapitalize="off"
              autoCorrect="off"
              autoFocus
              className="svg-block-textarea"
              data-gramm="false"
              data-vim-suspend=""
              onChange={(e) => onChangeCode(e.target.value)}
              ref={fullscreenTextareaRef}
              spellCheck={false}
              value={fullscreenCode}
            />
          </div>
          <div className="svg-fullscreen-preview" ref={zoom.scrollRef}>
            {fullscreenSvg ? (
              <div
                className="svg-block-render"
                dangerouslySetInnerHTML={fullscreenMarkup}
              />
            ) : (
              <div className="svg-block-empty">
                {t("svgBlock.emptyPreview")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
