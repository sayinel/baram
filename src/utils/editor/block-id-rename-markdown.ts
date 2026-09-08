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
  const raw = unescapeBlockRefTarget(target);
  const here = withoutExtension(filePath).toLowerCase();
  if (raw.startsWith("./") || raw.startsWith("../")) {
    return (
      normalizePath(
        `${dirname(filePath)}/${withoutExtension(raw)}`,
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
  const protectedRanges = literalRanges(markdown);
  const isFree = (start: number, end: number): boolean =>
    !protectedRanges.some(([from, to]) => start < to && end > from);

  const definition = new RegExp(` \\^${escapeRegExp(oldId)}(?=\\r?\\n|$)`, "g");
  const reference = new RegExp(BLOCK_REF_RE.source, "g");

  let out = markdown.replace(definition, (whole, offset: number) =>
    isFree(offset, offset + whole.length) ? ` ^${newId}` : whole,
  );
  // Offsets are unchanged so far only if the IDs have the same length; take
  // the ranges again against the current text when they differ.
  const ranges =
    oldId.length === newId.length ? protectedRanges : literalRanges(out);
  const free = (start: number, end: number): boolean =>
    !ranges.some(([from, to]) => start < to && end > from);
  out = out.replace(
    reference,
    (whole, target: string, id: string, _display, offset: number) =>
      id === oldId &&
      refersToThisDocument(target, filePath) &&
      free(offset, offset + whole.length)
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

/** Node types whose text is literal — never a block ID, never a reference. */
const LITERAL_TYPES = new Set([
  "code",
  "html",
  "inlineCode",
  "inlineMath",
  "math",
  "yaml",
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `[start, end)` offsets of every literal node in `markdown`. */
function literalRanges(markdown: string): [number, number][] {
  const ranges: [number, number][] = [];
  const visit = (node: {
    children?: unknown[];
    position?: { end: { offset?: number }; start: { offset?: number } };
    type: string;
  }): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (
      LITERAL_TYPES.has(node.type) &&
      start !== undefined &&
      end !== undefined
    ) {
      ranges.push([start, end]);
      return;
    }
    for (const child of node.children ?? []) visit(child as typeof node);
  };
  visit(parser.parse(markdown) as unknown as Parameters<typeof visit>[0]);
  return ranges;
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
