// §30a Rename a block ID inside a markdown STRING — for a document that is not
// in an editor right now (issue 594).
//
// When the backend has renamed `((file#^old))` in every other file, the
// document that DEFINES the block has to follow. Usually that document is in
// the editor and gets a transaction; when it is a source-mode buffer, a cached
// `openFiles` snapshot, or a file whose tab was closed, only its text is left
// to edit. This is that edit, and it must agree byte for byte with what the
// transaction would have produced once serialized — so the same rule for
// "which references belong to this document" lives here and is shared with
// the transaction builder (`refersToThisDocument`), and code is left alone the
// way the parser leaves it alone: the very parser the pipeline uses says where
// the code is (fenced or indented, inside a list or a quote, a code span across
// lines), and those stretches are never touched.
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { BLOCK_REF_RE, unescapeBlockRefTarget } from "../../pipeline/block-id";
import { basename, dirname } from "../path-utils";

type Range = [start: number, end: number];

/**
 * Whether a block reference's `target` names `filePath`'s own document.
 *
 * This is deliberately a subset of `resolveWikilinkTarget`, which needs the
 * active context and file tree — neither belongs to a document that may not be
 * active. Accepted as "this document": the empty target (`((#^id))`); a
 * relative path (`./x`, `../y/x`) that resolves, against this file's
 * directory, to this file; a path-qualified target (`a/x`) that this file's
 * path ends with; a bare stem equal to this file's stem. Stems compare
 * case-insensitively and without `.md`/`.markdown`, as the resolver does. A
 * bare stem that another file in another folder also carries is ambiguous;
 * the resolver would pick one by its own rules, this treats it as ours — the
 * same choice the transaction builder makes, so the two paths agree.
 */
export function refersToThisDocument(
  target: string,
  filePath: string,
): boolean {
  if (target === "") return true;
  // Tauri hands out native paths — `C:\vault\note.md` on Windows; the
  // helpers below speak `/`.
  const raw = unescapeBlockRefTarget(target).replaceAll("\\", "/");
  const here = withoutExtension(filePath.replaceAll("\\", "/")).toLowerCase();
  if (raw.startsWith("./") || raw.startsWith("../")) {
    return (
      normalizePath(
        `${dirname(filePath.replaceAll("\\", "/"))}/${withoutExtension(raw)}`,
      ).toLowerCase() === here
    );
  }
  const wanted = withoutExtension(raw).replace(/^\/+/, "").toLowerCase();
  if (wanted.includes("/")) {
    return here === wanted || here.endsWith(`/${wanted}`);
  }
  return basename(here) === wanted;
}

/**
 * Rename the definition ` ^oldId` and this document's own references to it.
 * Byte-identical when nothing matches. Code — fenced, indented, code spans,
 * raw HTML, math, front matter — is left alone wherever the parser finds it.
 * The definition must end its line exactly (`BLOCK_ID_SUFFIX_RE`): trailing
 * spaces make it text.
 */
export function renameBlockIdInMarkdown(
  markdown: string,
  filePath: string,
  oldId: string,
  newId: string,
): string {
  if (oldId === newId || !markdown.includes(oldId)) return markdown;
  const outside = (ranges: Range[], start: number, end: number): boolean =>
    !ranges.some(([from, to]) => start < to && end > from);

  // A definition is a block's trailing ` ^id` — of a paragraph or heading.
  // The converter never reads one off a table cell (md-to-pm's table branch
  // builds cell paragraphs directly), so table rows are off limits for the
  // definition, while a reference inside a cell is a real blockReference.
  const before = parsedRanges(markdown);
  const definition = new RegExp(` \\^${escapeRegExp(oldId)}(?=\\r?\\n|$)`, "g");
  let out = markdown.replace(definition, (whole, offset: number) =>
    outside(before.literal, offset, offset + whole.length) &&
    outside(before.table, offset, offset + whole.length)
      ? ` ^${newId}`
      : whole,
  );

  // Offsets moved if the IDs differ in length: take the ranges again.
  const after = oldId.length === newId.length ? before : parsedRanges(out);
  const reference = new RegExp(BLOCK_REF_RE.source, "g");
  out = out.replace(
    reference,
    (whole, target: string, id: string, _display, offset: number) =>
      id === oldId &&
      refersToThisDocument(target, filePath) &&
      outside(after.literal, offset, offset + whole.length)
        ? whole.replace(`#^${oldId}`, `#^${newId}`)
        : whole,
  );
  return out;
}

/** The pipeline's own reader (see `pipeline/parse-mdast.ts`). */
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"]);

/**
 * Node types whose text is literal — never a block ID, never a reference. An
 * image's alt text and a reference-style link definition are attributes on
 * the PM side, not text a blockReference could live in.
 */
const LITERAL_TYPES = new Set([
  "code",
  "definition",
  "html",
  "image",
  "inlineCode",
  "inlineMath",
  "math",
  "yaml",
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `[start, end)` offsets of the literal nodes and of the tables in `markdown`. */
function parsedRanges(markdown: string): { literal: Range[]; table: Range[] } {
  const literal: Range[] = [];
  const table: Range[] = [];
  const visit = (node: {
    children?: unknown[];
    position?: { end: { offset?: number }; start: { offset?: number } };
    type: string;
  }): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      if (LITERAL_TYPES.has(node.type)) {
        literal.push([start, end]);
        return;
      }
      if (node.type === "table") table.push([start, end]);
    }
    for (const child of node.children ?? []) visit(child as typeof node);
  };
  visit(parser.parse(markdown) as unknown as Parameters<typeof visit>[0]);
  return { literal, table };
}

/** Collapse `.` and `..` segments of a `/`-joined path. */
function normalizePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return `${path.startsWith("/") ? "/" : ""}${out.join("/")}`;
}

/** Strip a `.md` / `.markdown` extension, case-insensitively. */
function withoutExtension(path: string): string {
  return path.replace(/\.(md|markdown)$/i, "");
}
