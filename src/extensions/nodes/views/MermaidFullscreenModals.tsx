// §5.5 Mermaid Block — fullscreen modals (moved out of mermaid-block-view.tsx
// §perf-large-file file-size split). Both are zero-hook: the parent owns all
// state and passes it down as props; each component's own createPortal call
// stays at the same tree position it had inline.

import React from "react";
import { createPortal } from "react-dom";

import { MERMAID_TEMPLATES } from "../../../utils/markdown/mermaid-utils";

interface MermaidEditFullscreenModalProps {
  detectedType: null | string;
  fullscreenCode: string;
  fullscreenError: null | string;
  fullscreenSvg: string;
  fullscreenTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChangeCode: (value: string) => void;
  /** Commit and leave. May refuse (read-only editor) and keep the modal. */
  onClose: () => void;
  /** Leave without committing — the way out when onClose refuses. */
  onDiscard: () => void;
}

interface MermaidViewFullscreenModalProps {
  detectedType: null | string;
  error: null | string;
  onClose: () => void;
  svgHtml: string;
}

/** Fullscreen View modal (read-only — diagram only, no editor). */
export function MermaidViewFullscreenModal({
  detectedType,
  error,
  onClose,
  svgHtml,
}: MermaidViewFullscreenModalProps): React.ReactPortal {
  return createPortal(
    <div
      className="mermaid-fullscreen-overlay"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      onMouseDown={(e) => {
        e.stopPropagation(); // Prevent React event from reaching NodeViewWrapper
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="mermaid-view-fullscreen-modal">
        <div className="mermaid-fullscreen-header">
          <span className="mermaid-block-label">mermaid</span>
          {detectedType && (
            <span className="mermaid-fullscreen-type">
              {MERMAID_TEMPLATES[detectedType]?.label || detectedType}
            </span>
          )}
          <button
            className="mermaid-fullscreen-close"
            onClick={onClose}
            onMouseDown={(e) => e.preventDefault()}
          >
            Close
          </button>
        </div>
        <div className="mermaid-view-fullscreen-body">
          {svgHtml ? (
            <div
              className="mermaid-block-svg"
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          ) : error ? (
            <div className="mermaid-block-error">{error}</div>
          ) : (
            <div className="mermaid-block-empty">Empty diagram</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Fullscreen edit modal. */
export function MermaidEditFullscreenModal({
  detectedType,
  fullscreenCode,
  fullscreenError,
  fullscreenSvg,
  fullscreenTextareaRef,
  onChangeCode,
  onClose,
  onDiscard,
}: MermaidEditFullscreenModalProps): React.ReactPortal {
  return createPortal(
    <div
      className="mermaid-fullscreen-overlay"
      onClick={(e) => {
        // Don't let clicks bubble through the portal to the block's onClick.
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="mermaid-fullscreen-modal">
        <div className="mermaid-fullscreen-header">
          <span className="mermaid-block-label">mermaid</span>
          {detectedType && (
            <span className="mermaid-fullscreen-type">
              {MERMAID_TEMPLATES[detectedType]?.label || detectedType}
            </span>
          )}
          <button
            className="mermaid-fullscreen-close"
            onClick={onDiscard}
            title="Leave without saving"
          >
            Discard
          </button>
          <button className="mermaid-fullscreen-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mermaid-fullscreen-body">
          <div className="mermaid-fullscreen-editor">
            <textarea
              autoCapitalize="off"
              autoCorrect="off"
              autoFocus
              className="mermaid-block-textarea"
              data-gramm="false"
              data-vim-suspend=""
              onChange={(e) => onChangeCode(e.target.value)}
              ref={fullscreenTextareaRef}
              spellCheck={false}
              value={fullscreenCode}
            />
          </div>
          <div className="mermaid-fullscreen-preview">
            {fullscreenSvg ? (
              <div
                className={[
                  "mermaid-block-svg",
                  fullscreenError && "mermaid-block-svg-faded",
                ]
                  .filter(Boolean)
                  .join(" ")}
                dangerouslySetInnerHTML={{ __html: fullscreenSvg }}
              />
            ) : null}
            {fullscreenError && (
              <div className="mermaid-block-error">{fullscreenError}</div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
