// §5.1 Image file viewer — renders a raster image or SVG read-only in an
// <img> via the asset: protocol. The shared editor zoomLevel (useZoom:
// Cmd+= / Cmd+- / Cmd+0, Ctrl+wheel, pinch) scales the displayed width
// directly: base width is "fit to container, never upscaled" and the zoom
// factor multiplies it. The container neutralizes the global CSS zoom (see
// .image-preview-scroll) so the two mechanisms don't stack — plain CSS zoom
// alone can't zoom a fit-width image, because max-width re-caps it.

import { memo, useEffect, useMemo, useRef, useState } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import { useSettingsStore } from "../../stores/settings/store";
import { basename } from "../../utils/path-utils";

/** Horizontal breathing room around the image at zoom 1. */
const GUTTER_PX = 24;

interface ImagePreviewProps {
  /** Absolute path of the image file (must be inside an opened context). */
  filePath: string;
  /** Bumped on saves/external reloads — forces the image to re-fetch. */
  refreshKey?: number;
}

export const ImagePreview = memo(function ImagePreview({
  filePath,
  refreshKey,
}: ImagePreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const zoomLevel = useSettingsStore((s) => s.zoomLevel);

  const src = useMemo(() => {
    const base = convertFileSrc(filePath);
    return refreshKey ? `${base}?v=${refreshKey}` : base;
  }, [filePath, refreshKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Base = fit the container without upscaling small images; zoom multiplies.
  // SVGs without intrinsic dimensions report naturalWidth 0 — fall back to
  // fit-width so they stay visible and still respond to zoom.
  const fitWidth = Math.max(0, containerWidth - GUTTER_PX * 2);
  const baseWidth =
    fitWidth > 0
      ? naturalWidth > 0
        ? Math.min(naturalWidth, fitWidth)
        : fitWidth
      : 0;
  const displayWidth = baseWidth > 0 ? baseWidth * zoomLevel : undefined;

  return (
    <div className="image-preview" ref={containerRef}>
      <img
        alt={basename(filePath)}
        onLoad={(e) => setNaturalWidth(e.currentTarget.naturalWidth)}
        src={src}
        style={
          displayWidth ? { maxWidth: "none", width: displayWidth } : undefined
        }
      />
    </div>
  );
});
