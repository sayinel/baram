// §296 Video NodeView — 포스터 → 클릭 재생, provider 임베드는 클릭 후 마운트
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Captions, Play } from "lucide-react";

import { useTranslation } from "../../i18n/useTranslation";
import { activeFileDir } from "../../utils/active-file-dir";
import {
  classifyMediaSrc,
  embedUrlFor,
  resolveMediaSrc,
} from "../../utils/media-src";
import { MediaToolbar, MediaToolbarButton } from "./views/MediaToolbar";
import { useMediaResize } from "./views/use-media-resize";

export function VideoView({ node, updateAttributes, selected }: NodeViewProps) {
  const { t } = useTranslation();
  const rawSrc = (node.attrs.src as string) || "";
  const alt = (node.attrs.alt as string) || "";
  const title = (node.attrs.title as string) || "";
  const widthPercent = (node.attrs.widthPercent as number) || 100;

  const baseDir = activeFileDir();
  const kind = useMemo(() => classifyMediaSrc(rawSrc), [rawSrc]);
  const isEmbed = kind === "video-embed";
  const embedUrl = useMemo(
    () => (isEmbed ? embedUrlFor(rawSrc) : null),
    [isEmbed, rawSrc],
  );
  // #t=0.1 — moov atom + 첫 프레임만 받아 포스터로 쓴다 (§17.2-7). Range 지원 전제.
  const fileSrc = useMemo(
    () => (isEmbed ? "" : `${resolveMediaSrc(rawSrc, baseDir)}#t=0.1`),
    [isEmbed, rawSrc, baseDir],
  );

  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionText, setCaptionText] = useState(alt);
  const captionRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  // §296.1 Live native controls must own their own clicks. Once `playing` is
  // true the `<video>` renders `controls` — without this, a mousedown on the
  // scrub bar or volume slider still reaches ProseMirror first (see the
  // play-button fix below for why `mousedown`, specifically, is what matters),
  // PM's default click handling selects the video atom, and syntax-reveal
  // expands it back to raw markdown mid-scrub. Before playing there are no
  // native controls to protect, so the poster area is left alone and behaves
  // like an image thumbnail (click → select/expand) as designed.
  useEffect(() => {
    const el = videoElRef.current;
    if (!el || !playing) return;
    const swallow = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", swallow);
    return () => el.removeEventListener("mousedown", swallow);
  }, [playing]);

  // 임베드는 리사이즈하지 않는다 (§17.2-6) — 폭을 마크다운에 저장할 안전한 길이 없다.
  const { dragPct, startResize } = useMediaResize(containerRef, (pct) => {
    updateAttributes({ widthPercent: pct });
  });
  const effectiveWidth = isEmbed ? 100 : (dragPct ?? widthPercent);

  const handleCaptionSave = useCallback(() => {
    setEditingCaption(false);
    if (captionText !== alt) {
      requestAnimationFrame(() => updateAttributes({ alt: captionText }));
    }
  }, [updateAttributes, captionText, alt]);

  const startCaptionEdit = useCallback(() => {
    setCaptionText(alt);
    setEditingCaption(true);
    setTimeout(() => captionRef.current?.focus(), 0);
  }, [alt]);

  const embedHost = embedUrl ? new URL(embedUrl).hostname : "";

  return (
    <NodeViewWrapper className="video-node-view" ref={containerRef}>
      <figure
        className={`video-figure ${selected ? "video-selected" : ""}`}
        style={{ width: `${effectiveWidth}%` }}
      >
        {failed ? (
          <div className="video-error" role="alert">
            {t("video.loadError", { src: rawSrc })}
          </div>
        ) : isEmbed ? (
          playing && embedUrl ? (
            <iframe
              allow="encrypted-media; picture-in-picture"
              className="video-embed-frame"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              src={embedUrl}
              title={title || alt || embedHost}
            />
          ) : (
            <div className="video-embed-card">
              <span className="video-embed-host">{embedHost}</span>
              <span className="video-embed-hint">
                {t("video.embedHint", { host: embedHost })}
              </span>
            </div>
          )
        ) : (
          <video
            controls={playing}
            data-drag-handle=""
            draggable={false}
            onError={() => setFailed(true)}
            preload="metadata"
            ref={videoElRef}
            src={fileSrc}
            title={title || undefined}
          />
        )}

        {!playing && !failed && (
          <button
            aria-label={t("video.play")}
            className="video-play-button btn-unstyled"
            onClick={() => setPlaying(true)}
            // §296.1 Same native-listener-via-ref trick as MediaToolbar
            // (views/MediaToolbar.tsx): a React `onMouseDown` prop fires from
            // React's own dispatch at the root, which happens AFTER the real
            // mousedown has already bubbled through ProseMirror's editable DOM
            // — too late to stop PM from selecting/expanding the video atom.
            // Attaching the listener directly to this element intercepts the
            // event during the real bubble phase, before it ever reaches PM.
            ref={(el) => {
              if (el) el.onmousedown = (e) => e.stopPropagation();
            }}
            type="button"
          >
            <Play size={28} strokeWidth={2} />
          </button>
        )}

        {!isEmbed && !failed && (
          <>
            <div
              className="media-resize-handle media-resize-handle-left"
              onMouseDown={startResize}
            />
            <div
              className="media-resize-handle media-resize-handle-right"
              onMouseDown={startResize}
            />
            {dragPct != null && (
              <div className="media-resize-label">{dragPct}%</div>
            )}
          </>
        )}

        <MediaToolbar>
          <MediaToolbarButton
            active={editingCaption}
            onClick={startCaptionEdit}
            title={t("video.caption")}
          >
            <Captions size={16} strokeWidth={2} />
          </MediaToolbarButton>
        </MediaToolbar>

        {(alt || editingCaption) && (
          <figcaption className="video-caption">
            {editingCaption ? (
              <input
                onBlur={handleCaptionSave}
                onChange={(e) => setCaptionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCaptionSave();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setCaptionText(alt);
                    setEditingCaption(false);
                  }
                }}
                ref={captionRef}
                value={captionText}
              />
            ) : (
              alt
            )}
          </figcaption>
        )}
      </figure>
    </NodeViewWrapper>
  );
}
