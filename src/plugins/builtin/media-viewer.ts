// §69 Built-in media-viewer plugin — image & SVG file viewer.
//
// Deliberately implemented AGAINST the public plugin API (ExtensionContext)
// rather than as core components: it exercises the "viewer" extension point
// end-to-end and doubles as the reference for third-party viewer plugins.
// Compiled into the app as trusted code — it ships (and loads) in release
// builds where EXTERNAL plugin loading stays gated by §259.
//
// Rendering: an <img> pointed at ctx.assetUrl. Raster images and SVG both
// render vector/bitmap-correct, and SVG stays sharp at any zoom. Base width
// fits the container without upscaling small images; ctx.zoomLevel (shared
// editor zoom — Cmd+= / Cmd+- / Cmd+0, Ctrl+wheel, pinch) multiplies it.
// SVG <script> does not execute inside an <img>, which is exactly the
// containment we want in a preview; SMIL/CSS animation still runs.

import type {
  ExtensionContext,
  PluginFileViewerContext,
  PluginManifest,
  PluginModule,
} from "../types";

export const MEDIA_VIEWER_MANIFEST: PluginManifest = {
  author: "Baram",
  capabilities: ["viewer"],
  description: "이미지(PNG/JPEG/GIF/BMP/WebP)와 SVG 파일 뷰어 (내장)",
  engines: { baram: ">=0.4.0" },
  id: "baram-media-viewer",
  license: "Apache-2.0",
  main: "(builtin)",
  name: "Media Viewer",
  trust: "trusted",
  version: "1.0.0",
};

/** Horizontal breathing room around the image at zoom 1. */
const GUTTER_PX = 24;

interface ViewState {
  containerWidth: number;
  ctx: PluginFileViewerContext;
  img: HTMLImageElement;
  naturalWidth: number;
  observer?: ResizeObserver;
}

const states = new WeakMap<HTMLElement, ViewState>();

function applyLayout(state: ViewState): void {
  const fit = Math.max(0, state.containerWidth - GUTTER_PX * 2);
  if (fit <= 0) return;
  // Fit the container without upscaling small images; zoom multiplies.
  // An SVG without intrinsic dimensions reports naturalWidth 0 — use the
  // fit width so it stays visible and still responds to zoom.
  const base = state.naturalWidth > 0 ? Math.min(state.naturalWidth, fit) : fit;
  state.img.style.width = `${base * state.ctx.zoomLevel}px`;
}

function onMount(el: HTMLElement, ctx: PluginFileViewerContext): void {
  const wrap = document.createElement("div");
  wrap.className = "baram-media-viewer";
  const img = document.createElement("img");
  img.alt = ctx.filePath.split("/").pop() ?? "image";
  img.src = ctx.assetUrl;
  wrap.appendChild(img);
  el.appendChild(wrap);

  const state: ViewState = {
    containerWidth: el.clientWidth,
    ctx,
    img,
    naturalWidth: 0,
  };
  img.addEventListener("load", () => {
    state.naturalWidth = img.naturalWidth;
    applyLayout(state);
  });
  const observer = new ResizeObserver(() => {
    state.containerWidth = el.clientWidth;
    applyLayout(state);
  });
  observer.observe(el);
  state.observer = observer;
  states.set(el, state);
  applyLayout(state);
}

function onUnmount(el: HTMLElement): void {
  states.get(el)?.observer?.disconnect();
  states.delete(el);
}

function onUpdate(el: HTMLElement, ctx: PluginFileViewerContext): void {
  const state = states.get(el);
  if (!state) return;
  if (state.ctx.assetUrl !== ctx.assetUrl) {
    // Save / external reload — re-fetch through the bumped cache-buster
    state.img.src = ctx.assetUrl;
  }
  state.ctx = ctx;
  applyLayout(state);
}

const STYLE = `
.baram-media-viewer {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: max-content;
  min-width: 100%;
  min-height: 100%;
  padding: ${GUTTER_PX}px;
}

.baram-media-viewer img {
  height: auto;
}
`;

function activate(ctx: ExtensionContext): void {
  ctx.ui.addStyle(STYLE);
  ctx.ui.registerFileViewer({
    extensions: [
      "avif",
      "bmp",
      "gif",
      "ico",
      "jpeg",
      "jpg",
      "png",
      "svg",
      "webp",
    ],
    id: "media",
    onMount,
    onUnmount,
    onUpdate,
  });
}

export const MEDIA_VIEWER_MODULE: PluginModule = { activate };
