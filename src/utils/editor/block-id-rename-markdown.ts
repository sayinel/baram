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
// the transaction builder (`refersToThisDocument`).
import { BLOCK_REF_RE, unescapeBlockRefTarget } from "../../pipeline/block-id";
import { basename } from "../path-utils";

/**
 * Whether a block reference's `target` names `filePath`'s own document: the
 * empty target (`((#^id))`) or a path whose file stem is this file's stem. The
 * comparison is deliberately loose about directories — wikilink resolution
 * depends on the active context, and this runs for documents that are not
 * active — and deliberately strict about the stem, so `((other#^id))` in this
 * document keeps pointing at `other`'s block.
 */
export function refersToThisDocument(
  target: string,
  filePath: string,
): boolean {
  if (target === "") return true;
  return stem(unescapeBlockRefTarget(target)) === stem(filePath);
}

/**
 * Rename the definition ` ^oldId` and this document's own references to it.
 * Byte-identical when nothing matches. Fenced code is left alone: a ` ^id` at
 * the end of a code line is text, not a block ID, and the parser agrees.
 */
export function renameBlockIdInMarkdown(
  markdown: string,
  filePath: string,
  oldId: string,
  newId: string,
): string {
  if (oldId === newId) return markdown;
  const definition = new RegExp(` \\^${escapeRegExp(oldId)}(\\s*)$`);
  const reference = new RegExp(BLOCK_REF_RE.source, "g");
  // Keep the separators: split on them but capture them back.
  const parts = markdown.split(/(\r?\n)/);
  let fence: null | string = null;
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i]!;
    const opener = FENCE_RE.exec(line);
    if (fence === null) {
      if (opener) {
        fence = opener[1]!;
        continue;
      }
    } else {
      if (
        opener &&
        opener[1]!.startsWith(fence[0]!) &&
        opener[1]!.length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    let next = line.replace(definition, ` ^${newId}$1`);
    next = next.replace(reference, (whole, target: string, id: string) =>
      id === oldId && refersToThisDocument(target, filePath)
        ? whole.replace(`#^${oldId}`, `#^${newId}`)
        : whole,
    );
    parts[i] = next;
  }
  return parts.join("");
}

/** A fence opener/closer: up to three spaces, then three or more of ``` or ~~~. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** File name without directories and without a `.md` extension. */
function stem(path: string): string {
  const name = basename(path);
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}
