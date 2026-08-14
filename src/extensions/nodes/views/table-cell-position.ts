// §276.6 A block reference inside a table cell must not offer the resize
// handle. The width field is written as `|w=NN`, and an unescaped `|` splits a
// GFM cell: `| ((f#^id)) |` comes back from the next save/open cycle as two
// columns with the reference gone — silent content loss from one mouse gesture.
//
// A reference carrying a `display` is already lost in a table cell today (the
// same pipe, pre-existing, recorded in dev/backlog.md). What §276.6 would add
// is a way to inject that first pipe into a BARE reference, which round-trips
// through a table cell fine. Refusing the handle there is the containment; the
// serializer-level escaping is deferred, with its own round-trip implications.
import type { Node as PMNode } from "@tiptap/pm/model";

const TABLE_CELL_TYPES = new Set(["tableCell", "tableHeader"]);

/**
 * True when `pos` resolves inside a `td`/`th`. Total: an out-of-range or
 * non-integer position answers `false` rather than throwing, since the caller
 * gets it from `getPos()`, which reports a stale or absent position for a node
 * that is on its way out of the document.
 */
export function isInsideTableCell(doc: PMNode, pos: number): boolean {
  if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return false;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (TABLE_CELL_TYPES.has($pos.node(depth).type.name)) return true;
  }
  return false;
}
