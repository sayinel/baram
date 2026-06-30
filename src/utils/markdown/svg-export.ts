// §5.1 SVG export — download rendered SVG as a PNG file + copy to OS clipboard.
// Tauri WKWebView can't trigger a browser blob download (URL.createObjectURL +
// a.click() is broken) nor write images via navigator.clipboard, so both routes
// go through native APIs: the save dialog + export IPC, and the clipboard plugin.
import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";

import { exportBinaryFile } from "../../ipc/invoke";
import { svgToPngBlob, svgToRgba } from "./svg-utils";

/**
 * Copy a rendered SVG to the OS clipboard as an image, via the Tauri clipboard
 * plugin. `navigator.clipboard.write()` image writes are blocked in WKWebView,
 * so we rasterize to RGBA and hand it to the native clipboard. Image.new takes
 * raw RGBA (no `image-png` Cargo feature needed, unlike Image.fromBytes).
 */
export async function copySvgAsPng(svgHtml: string): Promise<void> {
  // scale 1 (screen resolution) — the raw RGBA buffer ships over IPC, so keep it
  // small for responsiveness; the clipboard image doesn't need print DPI.
  const { height, rgba, width } = await svgToRgba(svgHtml, 1);
  const image = await Image.new(rgba, width, height);
  await writeImage(image);
}

/**
 * Save the raw SVG markup as a `.svg` file via the native save dialog.
 * Lossless for any SVG (vector, fonts, CSS, `<style>`) — unlike PNG raster,
 * which goes through `<img>`/canvas and can't reproduce `<style>`/`var()`/fonts.
 * Returns true if a file was written, false if the user cancelled.
 */
export async function downloadSvg(
  svg: string,
  defaultName = "image.svg",
): Promise<boolean> {
  const path = await save({
    filters: [{ name: "SVG Image", extensions: ["svg"] }],
    defaultPath: defaultName,
  });
  if (!path) return false;

  const bytes = new TextEncoder().encode(svg);
  await exportBinaryFile(path, Array.from(bytes));
  return true;
}

/**
 * Rasterize SVG markup to PNG and save it via the native save dialog.
 * Returns true if a file was written, false if the user cancelled.
 * Uses the unconfined export IPC so the user can save anywhere (Downloads etc.).
 */
export async function downloadSvgAsPng(
  svgHtml: string,
  defaultName = "image.png",
): Promise<boolean> {
  const path = await save({
    filters: [{ name: "PNG Image", extensions: ["png"] }],
    defaultPath: defaultName,
  });
  if (!path) return false;

  const blob = await svgToPngBlob(svgHtml);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await exportBinaryFile(path, Array.from(bytes));
  return true;
}
