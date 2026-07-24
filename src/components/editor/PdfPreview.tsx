// §5.1 PDF file viewer — renders pages in-app with PDF.js.
// The webview's native PDF plugin (iframe) can't be zoomed from the host:
// it keeps its own magnification (widening the frame only grows margins)
// and swallows keyboard focus, so Cmd+= never reaches the app. Rendering
// pages onto canvases instead makes the shared editor zoomLevel re-render
// pages sharply at the new scale, and every zoom input (Cmd+= / Cmd+- /
// Cmd+0, Ctrl+wheel, pinch) flows through useZoom exactly like the
// markdown editor. Pages render lazily as they approach the viewport.

import type { CSSProperties } from "react";
import { memo, useEffect, useRef, useState } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// The legacy build, NOT the modern one: pdfjs's modern build assumes
// bleeding-edge engine APIs (e.g. Map.prototype.getOrInsertComputed) that
// current WKWebView lacks — page.render() crashes at runtime. The legacy
// build ships core-js polyfills for those and supports the webview range
// our minimumSystemVersion (macOS 13) implies.
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

import { useSettingsStore } from "../../stores/settings/store";
import { logger } from "../../utils/logger";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Horizontal breathing room around pages at zoom 1. */
const PAGE_GUTTER_PX = 24;
/** Pre-render pages this far outside the viewport. */
const LAZY_ROOT_MARGIN = "800px";

interface PdfPreviewProps {
  /** Absolute path of the .pdf file (must be inside an opened context). */
  filePath: string;
  /** Bumped on external reloads — forces a re-fetch of the file. */
  refreshKey?: number;
  /** Accessible title for the viewer (file path or name). */
  title?: string;
}

export const PdfPreview = memo(function PdfPreview({
  filePath,
  refreshKey,
  title,
}: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<null | PDFDocumentProxy>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [error, setError] = useState<null | string>(null);
  const [baseScale, setBaseScale] = useState(0);
  const zoomLevel = useSettingsStore((s) => s.zoomLevel);

  // Load the document via the asset: protocol; reload on external change
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setPages([]);
    setError(null);
    const url = refreshKey
      ? `${convertFileSrc(filePath)}?v=${refreshKey}`
      : convertFileSrc(filePath);
    const task = getDocument({ url });
    task.promise.then(
      (loaded) => {
        if (!cancelled) setDoc(loaded);
      },
      (err: unknown) => {
        if (cancelled) return;
        logger.error("[PdfPreview] failed to load PDF:", err);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
      // Destroying the loading task also frees the document + worker memory
      void task.destroy();
    };
  }, [filePath, refreshKey]);

  // Fetch all page proxies (lightweight — no rendering yet)
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      const loaded: PDFPageProxy[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        loaded.push(await doc.getPage(i));
      }
      if (!cancelled) setPages(loaded);
    })().catch((err: unknown) => {
      if (!cancelled) logger.error("[PdfPreview] failed to load pages:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Fit-width base scale at zoom 1, tracking container resizes
  useEffect(() => {
    const el = containerRef.current;
    const first = pages[0];
    if (!el || !first) return;
    const update = () => {
      const avail = el.clientWidth - PAGE_GUTTER_PX * 2;
      if (avail > 0) {
        setBaseScale(avail / first.getViewport({ scale: 1 }).width);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pages]);

  const scale = baseScale * zoomLevel;

  return (
    <div
      aria-label={title || "PDF preview"}
      className="pdf-preview"
      ref={containerRef}
      role="document"
    >
      {error ? (
        <div className="pdf-preview-error">{error}</div>
      ) : (
        scale > 0 &&
        pages.map((page) => (
          <PdfPage key={page.pageNumber} page={page} scale={scale} />
        ))
      )}
    </div>
  );
});

function PdfPage({ page, scale }: { page: PDFPageProxy; scale: number }) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  const viewport = page.getViewport({ scale });

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: LAZY_ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Render at devicePixelRatio for crisp output on HiDPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    const renderTask = page.render({
      canvas,
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      viewport,
    });
    renderTask.promise.catch(() => {
      // Cancelled by a zoom change or scroll-away — expected, not an error
    });
    return () => renderTask.cancel();
    // viewport is derived from (page, scale) — those deps cover it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, page, scale]);

  // Text layer — transparent selectable text positioned over the canvas,
  // so text selection / Cmd+C work like in a regular document
  useEffect(() => {
    if (!visible) return;
    const container = textLayerRef.current;
    if (!container) return;
    container.replaceChildren();
    const textLayer = new TextLayer({
      container,
      textContentSource: page.streamTextContent(),
      viewport,
    });
    textLayer.render().catch(() => {
      // Cancelled by a zoom change or scroll-away — expected, not an error
    });
    return () => textLayer.cancel();
    // viewport is derived from (page, scale) — those deps cover it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, page, scale]);

  return (
    <div
      className="pdf-page"
      ref={holderRef}
      style={
        {
          // TextLayer reads this to size its font metrics (PDF.js v5+)
          "--total-scale-factor": String(viewport.scale),
          height: viewport.height,
          width: viewport.width,
        } as CSSProperties
      }
    >
      {visible && (
        <>
          <canvas ref={canvasRef} />
          <div className="pdf-text-layer" ref={textLayerRef} />
        </>
      )}
    </div>
  );
}
