// HTML file preview — renders the saved .html file in a sandboxed iframe.
// The file is loaded via the asset: protocol as its own document (own origin,
// no app-CSP inheritance), so the page's inline/external scripts run and
// relative assets resolve. sandbox="allow-scripts" WITHOUT allow-same-origin
// keeps the document in an opaque origin: it can mutate its own DOM, but can
// never reach the host webview, the parent document, or the Tauri IPC bridge.

import { memo, useMemo } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

interface HtmlPreviewProps {
  /** Absolute path of the .html file (must be inside an opened context). */
  filePath: string;
  /** Bumped on every save — forces the iframe to reload the file from disk. */
  refreshKey?: number;
  /** Accessible title for the iframe (file path or name). */
  title?: string;
}

export const HtmlPreview = memo(function HtmlPreview({
  filePath,
  refreshKey,
  title,
}: HtmlPreviewProps) {
  const src = useMemo(() => {
    const base = convertFileSrc(filePath);
    return refreshKey ? `${base}?v=${refreshKey}` : base;
  }, [filePath, refreshKey]);

  return (
    <iframe
      className="html-preview-frame"
      sandbox="allow-scripts"
      src={src}
      title={title || "HTML preview"}
    />
  );
});
