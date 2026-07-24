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

/** Returns true for .html / .htm files — they get a rendered preview + source toggle. */
export function isHtmlFile(filePath: string | undefined): boolean {
  if (!filePath) return false;
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  return HTML_EXTENSIONS.has(ext);
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
