// §56d Photo Gallery thumbnail IPC command
import { invoke } from "@tauri-apps/api/core";

/**
 * Downscale a photo into the app cache and return the cache file's absolute
 * path (feed it to `convertFileSrc`). Rejects for anything the Rust decoder
 * cannot handle — svg, a file whose contents do not match its extension, an
 * image above the pixel ceiling — so callers must have an original fallback.
 */
export async function photoThumbnail(
  path: string,
  maxPx: number,
): Promise<string> {
  return invoke<string>("photo_thumbnail", { path, maxPx });
}
