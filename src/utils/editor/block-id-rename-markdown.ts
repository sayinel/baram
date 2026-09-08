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
// way the parser leaves it alone.
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
 * Byte-identical when nothing matches. Left alone, as the parser leaves them:
 * fenced code, indented code, and inline code spans — a ` ^id` at the end of a
 * code line is text, not a block ID. The definition must end the line exactly
 * (`BLOCK_ID_SUFFIX_RE`): trailing spaces make it text too.
 */
export function renameBlockIdInMarkdown(
  markdown: string,
  filePath: string,
  oldId: string,
  newId: string,
): string {
  if (oldId === newId) return markdown;
  const definition = new RegExp(` \\^${escapeRegExp(oldId)}$`);
  const reference = new RegExp(BLOCK_REF_RE.source, "g");
  const renameRefs = (text: string): string =>
    text.replace(reference, (whole, target: string, id: string) =>
      id === oldId && refersToThisDocument(target, filePath)
        ? whole.replace(`#^${oldId}`, `#^${newId}`)
        : whole,
    );
  // Keep the separators: split on them but capture them back.
  const parts = markdown.split(/(\r?\n)/);
  let fence: null | { char: string; length: number } = null;
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i]!;
    const fenceLine = FENCE_RE.exec(line);
    if (fence !== null) {
      if (
        fenceLine &&
        fenceLine[1]!.startsWith(fence.char) &&
        fenceLine[1]!.length >= fence.length &&
        fenceLine[2]!.trim() === ""
      ) {
        fence = null;
      }
      continue;
    }
    if (fenceLine) {
      fence = { char: fenceLine[1]![0]!, length: fenceLine[1]!.length };
      continue;
    }
    if (INDENTED_CODE_RE.test(line)) continue;
    const renamed = line.replace(definition, ` ^${newId}`);
    parts[i] = outsideInlineCode(renamed, renameRefs);
  }
  return parts.join("");
}

/** A fence line: up to three spaces, three or more of ``` or ~~~, then the rest. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** An indented code line: a tab or four spaces before any text. */
const INDENTED_CODE_RE = /^(?: {4}|\t)\S/;
/** A code span: a run of backticks, anything, the same run again. */
const CODE_SPAN_RE = /(`+)[\s\S]*?\1/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/** Apply `transform` to the stretches of `line` that are not inline code. */
function outsideInlineCode(
  line: string,
  transform: (text: string) => string,
): string {
  let out = "";
  let last = 0;
  for (const span of line.matchAll(CODE_SPAN_RE)) {
    out += transform(line.slice(last, span.index)) + span[0];
    last = span.index + span[0].length;
  }
  return out + transform(line.slice(last));
}

/** Strip a `.md` / `.markdown` extension, case-insensitively. */
function withoutExtension(path: string): string {
  return path.replace(/\.(md|markdown)$/i, "");
}
