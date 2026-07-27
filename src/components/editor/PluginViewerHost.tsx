// §69 Plugin file-viewer host — mounts a plugin-registered viewer into the
// editor area. The host owns the React lifecycle; the plugin owns the DOM
// inside the element it is handed. Plugin callbacks are fenced with
// try/catch so a broken viewer degrades to an empty pane instead of
// unwinding the app through the root error boundary.

import { memo, useEffect, useMemo, useRef } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import type { PluginFileViewer } from "../../plugins/plugin-ui-store";
import type { PluginFileViewerContext } from "../../plugins/types";

import { useSettingsStore } from "../../stores/settings/store";
import { logger } from "../../utils/logger";

interface PluginViewerHostProps {
  filePath: string;
  /** Bumped on saves / external reloads — flows into ctx for re-fetching. */
  refreshKey: number;
  viewer: PluginFileViewer;
}

export const PluginViewerHost = memo(function PluginViewerHost({
  filePath,
  refreshKey,
  viewer,
}: PluginViewerHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The ctx most recently delivered to the plugin — lets the update effect
  // skip the redundant onUpdate that would otherwise fire right after mount.
  const deliveredCtxRef = useRef<null | PluginFileViewerContext>(null);
  const zoomLevel = useSettingsStore((s) => s.zoomLevel);

  const ctx: PluginFileViewerContext = useMemo(() => {
    const base = convertFileSrc(filePath);
    return {
      assetUrl: refreshKey ? `${base}?v=${refreshKey}` : base,
      filePath,
      refreshKey,
      zoomLevel,
    };
  }, [filePath, refreshKey, zoomLevel]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // Mount once per (viewer, file); zoom/refresh changes flow through onUpdate
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    try {
      viewer.onMount(el, ctxRef.current);
      deliveredCtxRef.current = ctxRef.current;
    } catch (err) {
      logger.error(
        `[PluginViewerHost] ${viewer.viewerId} onMount failed:`,
        err,
      );
    }
    return () => {
      deliveredCtxRef.current = null;
      try {
        viewer.onUnmount?.(el);
      } catch (err) {
        logger.error(
          `[PluginViewerHost] ${viewer.viewerId} onUnmount failed:`,
          err,
        );
      }
      el.replaceChildren();
    };
  }, [viewer, filePath]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !deliveredCtxRef.current || deliveredCtxRef.current === ctx) {
      return;
    }
    try {
      viewer.onUpdate?.(el, ctx);
      deliveredCtxRef.current = ctx;
    } catch (err) {
      logger.error(
        `[PluginViewerHost] ${viewer.viewerId} onUpdate failed:`,
        err,
      );
    }
  }, [viewer, ctx]);

  return <div className="plugin-viewer-host" ref={hostRef} />;
});
