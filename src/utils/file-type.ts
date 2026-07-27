// File type utilities — detect markdown vs non-markdown files
// Used to branch editor rendering: WYSIWYG (Tiptap) vs CodeMirror

const MARKDOWN_EXTENSIONS = new Set(["markdown", "md", "mdx"]);

const EXT_TO_LANG: Record<string, string> = {
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  h: "c",
  hpp: "cpp",
  html: "html",
  htm: "html",
  css: "css",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  toml: "toml",
};

/** Maps file extension to a CodeMirror language name, or null if unknown. */
export function getLanguageForFile(filePath: string): null | string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return EXT_TO_LANG[ext] ?? null;
}

const HTML_EXTENSIONS = new Set(["htm", "html"]);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

/** Rendered preview + source-edit toggle: HTML documents and SVG (XML text). */
const RENDERED_PREVIEW_EXTENSIONS = new Set(["htm", "html", "svg"]);

/**
 * Binary files shown in a read-only viewer (PDF, images). Every text path —
 * UTF-8 reads, saves, tab-switch serialization — must skip these.
 */
export function isBinaryViewerFile(filePath: string | undefined): boolean {
  return isImageFile(filePath) || isPdfFile(filePath);
}

/** Returns true for .html / .htm files — they get a rendered preview + source toggle. */
export function isHtmlFile(filePath: string | undefined): boolean {
  const ext = extOf(filePath);
  return ext !== undefined && HTML_EXTENSIONS.has(ext);
}

/**
 * Returns true for raster image files — binary, rendered read-only in an
 * <img> via the asset: protocol. Never read with the UTF-8 readFile IPC and
 * never written by any save path.
 */
export function isImageFile(filePath: string | undefined): boolean {
  const ext = extOf(filePath);
  return ext !== undefined && IMAGE_EXTENSIONS.has(ext);
}

/** Returns true for .md, .markdown, .mdx — and for untitled files (no path). */
export function isMarkdownFile(filePath: string | undefined): boolean {
  if (!filePath) return true; // untitled → treat as markdown
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return true; // no extension → treat as markdown
  return MARKDOWN_EXTENSIONS.has(ext);
}

/**
 * Returns true for .pdf files — binary, rendered read-only in an iframe via
 * the asset: protocol. Never read with the UTF-8 readFile IPC and never
 * written by any save path.
 */
export function isPdfFile(filePath: string | undefined): boolean {
  if (!filePath) return false;
  return filePath.split(".").pop()?.toLowerCase() === "pdf";
}

/**
 * Text files that open as a rendered preview with a source-edit toggle
 * (HTML documents, SVG). They share the HTML preview/source flow.
 */
export function isRenderedPreviewFile(filePath: string | undefined): boolean {
  const ext = extOf(filePath);
  return ext !== undefined && RENDERED_PREVIEW_EXTENSIONS.has(ext);
}

/**
 * Returns true for .svg — previewed as an <img> (sharp vector zoom, no
 * iframe event swallowing) while remaining source-editable as XML text.
 */
export function isSvgFile(filePath: string | undefined): boolean {
  return extOf(filePath) === "svg";
}

function extOf(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  return filePath.split(".").pop()?.toLowerCase();
}
