// §296 Video NodeView — 파일은 처음부터 네이티브 컨트롤, provider 임베드는
// `autoLoadVideoEmbeds` 설정에 따라 즉시 마운트되거나 클릭 후 마운트된다
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Captions, Maximize } from "lucide-react";

import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { activeFileDir } from "../../utils/active-file-dir";
import {
  isFullscreenSupported,
  requestVideoFullscreen,
} from "../../utils/fullscreen";
import {
  classifyMediaSrc,
  embedUrlFor,
  isRemoteOrData,
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
  const widthPixel = node.attrs.widthPixel as number | undefined;

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
  // 보안 리뷰 Medium 수정: 원격(`https://`)/data URI 동영상은 `preload="metadata"`
  // 여도 문서를 여는 순간 요청이 나간다 — provider 임베드용으로 만든 클릭-게이트
  // (§17.2-8)를 이 형제 케이스엔 적용하지 않았던 것이 구멍이었다. `resolveMediaSrc`
  // 자신이 "그대로 통과시킬 대상"을 판단할 때 쓰는 `isRemoteOrData`를 그대로 재사용한다
  // — `fileSrc`(변환 후)에 `^https?:\/\//`를 새로 매칭하면 Windows의 로컬 asset URL
  // (`http://asset.localhost/...`)까지 "원격"으로 오판한다. 로컬 파일은
  // `preload="metadata"` 그대로 — duration/치수가 그려져야 한다. data URI까지
  // "none"에 묶는 건 §293이 이미 정한 유일한 분류를 새로 쪼개지 않기 위한 선택이다 —
  // data URI는 네트워크 비용이 없어 보안 목적은 아니지만, 이 앱의 삽입 경로는
  // 동영상을 data URL로 절대 만들지 않으므로(§297) 비용도 사실상 0이다.
  const isRemoteFile = isRemoteOrData(rawSrc);

  // §296 UX1: 로컬/원격 파일은 처음부터 네이티브 컨트롤이라 재생 여부를 가릴
  // 상태가 필요 없다 — 이 플래그는 provider 임베드 카드→iframe 전환 하나만
  // 남는다. §17.2-8이 고른 게이트 자체는 사라지지 않았다 — 실사용에서 회색 빈
  // 카드가 고장으로 읽혔기 때문에, 이제는 `autoLoadVideoEmbeds` 설정(기본값
  // 켬)이 뒤집어 문서를 여는 순간 바로 로드한다. 끄면 지금까지의 클릭-로드로
  // 되돌아간다 — 그 프라이버시 선택지는 토글로 남는다. 렌더 분기는 이 state와
  // 아래 설정값의 OR이다(`useState(autoLoadEmbeds)`로 초기화하지 않는다) —
  // 이미 클릭해서 로드된 임베드는 설정을 나중에 꺼도 남아야 하고, 아직 클릭
  // 안 한 임베드는 설정을 끄면 카드로 돌아가야 한다.
  const autoLoadEmbeds = useSettingsStore((s) => s.autoLoadVideoEmbeds);
  const [embedLoaded, setEmbedLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionText, setCaptionText] = useState(alt);
  const captionRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  // §297 fix (M-10, whole-branch review): `failed` never reset once true.
  // An in-app src edit (syntax-reveal expand/collapse) replaces the whole
  // node, so state starts fresh there — but if the missing file the error
  // card names simply appears later (moved into place, sync finishes, …)
  // and something else re-renders this NodeView, the card stayed up until
  // an unrelated remount cleared it.
  useEffect(() => {
    setFailed(false);
  }, [rawSrc]);

  // §296.1 / §296 UX1 fix: native controls are on from the start now (no more
  // poster → click-to-reveal-controls two-step), so this always has to own
  // its own clicks — without it, a mousedown on the scrub bar or volume
  // slider reaches ProseMirror first, PM's default click handling selects the
  // video atom, and syntax-reveal expands it back to raw markdown mid-scrub.
  useEffect(() => {
    const el = videoElRef.current;
    if (!el) return;
    const swallow = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", swallow);
    return () => el.removeEventListener("mousedown", swallow);
  }, []);

  // 임베드는 리사이즈하지 않는다 (§17.2-6) — 폭을 마크다운에 저장할 안전한 길이 없다.
  const { dragPct, startResize } = useMediaResize(containerRef, (pct) => {
    // ‼️ widthPixel을 반드시 함께 지운다 (§294 I1). buildVideoHtml은 픽셀 폭이
    // 있으면 그쪽을 먼저 쓰므로, 남겨 두면 방금 끝낸 드래그가 저장 시점에 조용히
    // 버려진다 — 파일은 `width="640"`을 그대로 들고 있고, 다시 열면 원래 크기다.
    updateAttributes({ widthPercent: pct, widthPixel: undefined });
  });
  const effectiveWidth = isEmbed ? 100 : (dragPct ?? widthPercent);

  // §294 I1: 맨숫자 `width`는 **픽셀**이다(HTML `<video width>`의 의미). 파싱해서
  // 저장까지 하면서 그리지 않으면 `<video src="clip.mp4" width="640"></video>`가
  // 자기 마크다운과 어긋나게 100%로 렌더된다. 드래그 중에는 % 미리보기가 이긴다 —
  // 드래그가 끝나면 위 onCommit이 픽셀 폭을 지우므로 그 % 가 그대로 남는다.
  const figureWidth =
    !isEmbed && dragPct == null && widthPixel
      ? `${widthPixel}px`
      : `${effectiveWidth}%`;

  // §296 fullscreen button — computed once (not per-render): whether calling
  // requestFullscreen would do anything at all is a document-level fact, not
  // a per-instance one. See utils/fullscreen.ts for why method presence
  // alone isn't the right check.
  const fullscreenSupported = useMemo(() => isFullscreenSupported(), []);
  const handleFullscreen = useCallback(() => {
    const el = videoElRef.current;
    if (el) requestVideoFullscreen(el);
  }, []);

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

  // §296 fix (deferred-minor #12): show the host the user actually typed,
  // not the constructed nocookie/player host we load — a youtu.be link
  // shouldn't be described as "Click to load from www.youtube-nocookie.com".
  // Safe without a try/catch: embedUrl is non-null only when embedUrlFor
  // already parsed rawSrc as a URL (media-src.ts), so rawSrc parses here too.
  const embedHost = embedUrl && rawSrc ? new URL(rawSrc).hostname : "";

  return (
    <NodeViewWrapper className="video-node-view" ref={containerRef}>
      <figure
        className={`video-figure ${selected ? "video-selected" : ""}`}
        // §296 fix (deferred-minor #10): one data-drag-handle here (rather
        // than only on the <video> element, as before) covers all four
        // render shapes — video, playing embed iframe, unplayed embed card,
        // error card. See tiptap-core's onDragStart
        // (target.closest("[data-drag-handle]")) for the mechanism. The embed
        // card's own mousedown handler below adds preventDefault to stay
        // exempt from becoming a drag surface as a side effect of this.
        data-drag-handle=""
        style={{ width: figureWidth }}
      >
        {failed ? (
          <div className="video-error" role="alert">
            {t("video.loadError", { src: rawSrc })}
          </div>
        ) : isEmbed ? (
          (embedLoaded || autoLoadEmbeds) && embedUrl ? (
            <iframe
              // §296 fix (deferred-minor #11): fullscreen was missing from
              // `allow`, so the embedded player's own fullscreen control was
              // inert. allowFullScreen is the legacy attribute some engines
              // still check alongside the Permissions-Policy-style token.
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="video-embed-frame"
              // §294 fix (M2): export needs the ORIGINAL src to build a link
              // (see export-html.ts) — the card carries it below, but once
              // loaded the card is gone and only the iframe remains in the
              // DOM, so it needs its own copy of the same attribute.
              data-video-src={rawSrc}
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              src={embedUrl}
              title={title || alt || embedHost}
            />
          ) : (
            <div
              className="video-embed-card"
              data-video-src={rawSrc}
              onClick={() => setEmbedLoaded(true)}
              // §296 UX1: same native-listener-via-ref trick the old play
              // button used (MediaToolbar.tsx, §295) — a React `onMouseDown`
              // prop fires from React's own root dispatch, which happens
              // AFTER the real mousedown has already bubbled through
              // ProseMirror's editable DOM, too late to stop PM from
              // selecting/expanding the video atom. preventDefault keeps this
              // card from becoming an accidental drag surface, matching
              // data-drag-handle living on the whole figure instead.
              ref={(el) => {
                if (el)
                  el.onmousedown = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  };
              }}
            >
              <span className="video-embed-host">{embedHost}</span>
              <span className="video-embed-hint">
                {t("video.embedHint", { host: embedHost })}
              </span>
            </div>
          )
        ) : (
          <video
            controls
            draggable={false}
            onError={() => setFailed(true)}
            preload={isRemoteFile ? "none" : "metadata"}
            ref={videoElRef}
            src={fileSrc}
            title={title || undefined}
          />
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
          {/* §296 fullscreen — file branch only. Provider embeds get their
              own fullscreen inside the iframe (allow="…; fullscreen" +
              allowFullScreen, §296 deferred-minor #11); this button drives
              the <video> element directly and has nothing to attach to
              before a file's controls exist. */}
          {!isEmbed && !failed && fullscreenSupported && (
            <MediaToolbarButton
              onClick={handleFullscreen}
              title={t("video.fullscreen")}
            >
              <Maximize size={16} strokeWidth={2} />
            </MediaToolbarButton>
          )}
        </MediaToolbar>

        {(alt || editingCaption) && (
          <figcaption
            className="video-caption"
            contentEditable={false}
            // §296 fix (I1): the toolbar's Caption button was the only advertised
            // path to this, and media-block.css never revealed the toolbar for
            // video — so clicking the caption text itself (image's parity path,
            // image-view.tsx) is the only reachable entry point. No-op while
            // already editing so a click on the surrounding figcaption doesn't
            // reset in-progress text via startCaptionEdit's setCaptionText(alt).
            onClick={editingCaption ? undefined : startCaptionEdit}
          >
            {editingCaption ? (
              <input
                className="media-caption-input"
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
