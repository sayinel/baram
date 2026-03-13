// §56c Journal component utilities — shared helpers for MemoriesPanel sub-components
import { convertFileSrc } from "@tauri-apps/api/core";

/** Resolve relative image src attributes in rendered HTML to Tauri asset protocol URLs */
export function resolveImageSrcs(html: string, fileDir: string): string {
  return html.replace(/<img([^>]*) src="([^"]+)"/g, (_match, before, src) => {
    // Skip absolute URLs and data URIs
    if (
      src.startsWith("http://") ||
      src.startsWith("https://") ||
      src.startsWith("data:")
    ) {
      return `<img${before} src="${src}"`;
    }
    // Resolve relative path against journal file's directory
    const cleanSrc = src.startsWith("./") ? src.slice(2) : src;
    const absolutePath = cleanSrc.startsWith("/")
      ? cleanSrc
      : `${fileDir}/${cleanSrc}`;
    return `<img${before} src="${convertFileSrc(absolutePath)}"`;
  });
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
