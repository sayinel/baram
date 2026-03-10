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

/** Returns true for .md, .markdown, .mdx — and for untitled files (no path). */
export function isMarkdownFile(filePath: string | undefined): boolean {
  if (!filePath) return true; // untitled → treat as markdown
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return true; // no extension → treat as markdown
  return MARKDOWN_EXTENSIONS.has(ext);
}
