// Pipeline public API — MD ↔ ProseMirror 변환
export {
  markdownToProsemirror,
  markdownToProsemirrorAsync,
  mdastBlocksToPmNodes,
  mdastToProsemirror,
  parseMdast,
} from "./md-to-pm";
export { parseMdastAsync } from "./parse-async";
// §384 commit 3 — prosemirrorToMarkdown/prosemirrorToMdast do NOT leave this
// barrel: both take a live-editor doc straight to markdown/mdast, bypassing
// the canonical-collapse detour in src/utils/editor/serialize-live-doc.ts.
// mdastToMarkdown stays — it only ever takes an mdast tree, never a PM doc,
// so it carries none of that hazard on its own (only composed with
// prosemirrorToMdast, which is exactly what this boundary now blocks).
export { mdastToMarkdown } from "./pm-to-md";
