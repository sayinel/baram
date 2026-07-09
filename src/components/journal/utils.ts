// §56c Journal component utilities — shared helpers for MemoriesPanel sub-components
import { convertFileSrc } from "@tauri-apps/api/core";

/** Resolve relative image src attributes in rendered HTML to Tauri asset protocol URLs.
 *
 * Uses a DOM parser rather than a regex so unusual attribute ordering/quoting
 * cannot slip an unresolved (or malicious) `src` through, and other attributes
 * (e.g. `onerror`) are handled by the DOM, not string surgery. */
export function resolveImageSrcs(html: string, fileDir: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const img of Array.from(doc.querySelectorAll("img[src]"))) {
    const src = img.getAttribute("src") ?? "";
    // Skip absolute URLs and data URIs
    if (/^(?:https?:|data:)/i.test(src)) continue;
    // Resolve relative path against journal file's directory
    const cleanSrc = src.startsWith("./") ? src.slice(2) : src;
    const absolutePath = cleanSrc.startsWith("/")
      ? cleanSrc
      : `${fileDir}/${cleanSrc}`;
    img.setAttribute("src", convertFileSrc(absolutePath));
  }
  return doc.body.innerHTML;
}

/** Resolve journal base path, handling absolute journalDirectory */
export function resolveJournalBase(
  rootPath: string,
  journalDir: string,
): string {
  if (journalDir.startsWith("/") || /^[A-Z]:\\/i.test(journalDir)) {
    return journalDir;
  }
  return `${rootPath}/${journalDir}`;
}
