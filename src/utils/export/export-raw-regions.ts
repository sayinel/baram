// issue 631 — the regions of a note pandoc reads through as one: a comment,
// a verbatim element with its body (`pre`, `script`, `style`, `textarea`), a
// raw TeX environment. The parser splits them into several nodes; the walk
// (export-markdown-image-walk.ts) carries the region an earlier node opened
// across the nodes that follow, and an `<img>` inside it is text to pandoc,
// not an image. This module finds a text's regions by the tag grammar
// (export-html-grammar.ts) and decides, with the document's closer index,
// whether an opener nothing closes inside the text is real: pandoc reads an
// opener whose closer never comes as text or as the tag alone.
import {
  CLOSE_TAG,
  COMMENT_END,
  OPAQUE,
  OPEN_TAG,
  type TagSpan,
  TEX_BEGIN,
} from "./export-html-grammar";

/** What a text opens and does not close: where the region began and the
 *  pattern that closes it. */
export interface OpenRegion {
  at: number;
  until: RegExp;
}

/**
 * What the document knows about closers, asked by `rawRegions` before it
 * searches a node's text: whether a closer with `key` (`tex:<name>`,
 * `tag:<name>` or `comment`, as `closerIndex` files them) stands anywhere
 * at or after the node's start, and whether one stands after the node —
 * which is what makes an opener that nothing closes inside the node real. Both are
 * asked about the NODE, never about an offset into its text: the text can
 * be longer than its source span (a tab that ends a container prefix is
 * expanded), so no text offset maps soundly into the document. The walk
 * answers from `closerIndex`; by default every closer is taken to exist.
 */
export interface CloserOracle {
  afterNode: (key: string) => boolean;
  anyFrom: (key: string) => boolean;
}

const EVERY_CLOSER: CloserOracle = {
  afterNode: () => true,
  anyFrom: () => true,
};

/** Every `\end{name}` in `source` (exact), and every `</pre>`-class closer
 *  and `-->` (case-insensitive), by the key an `OpenRegion` carries, in
 *  document order — read once so that asking whether a closer comes after a
 *  position is a lookup, not a scan of the rest of the document. */
export function closerIndex(source: string): ReadonlyMap<string, number[]> {
  const index = new Map<string, number[]>();
  const add = (key: string, at: number): void => {
    const list = index.get(key);
    if (list === undefined) index.set(key, [at]);
    else list.push(at);
  };
  for (const hit of source.matchAll(TEX_END)) add(`tex:${hit[1]}`, hit.index);
  for (const hit of source.matchAll(TAG_OR_COMMENT_END)) {
    add(
      hit[1] === undefined ? "comment" : `tag:${hit[1].toLowerCase()}`,
      hit.index,
    );
  }
  return index;
}

/** The closers `closerIndex` collects — the same patterns `rawRegions`
 *  closes a region with. */
const TEX_END = /\\end\{([^{}]+)\}/g;
const TAG_OR_COMMENT_END = new RegExp(
  `</(${[...OPAQUE].join("|")})(?=[\\s/>])|${COMMENT_END}`,
  "gi",
);

/** What `rawRegions` found: the regions that end inside the text, and the
 *  one that does not, if any. */
export interface RawRegions {
  closed: TagSpan[];
  open: null | OpenRegion;
}

/**
 * The regions of `value` pandoc reads through — a comment, a verbatim
 * element with its body, a raw TeX environment — found by the tag grammar,
 * so that an opener inside an attribute value (`title="<script>"`) opens
 * nothing. `closed` are the regions that end inside the text; `open` is the
 * one that does not, if any. An abrupt comment (`<!-->`, `<!--->`) is
 * closed at once. An opener nothing closes inside the text is `open` only
 * when the document holds its closer after the node; otherwise it is text
 * to pandoc, and the scan goes on behind it — a false `\begin{missing}`
 * must not hide the `\begin{verbatim}` that follows it. The document is
 * asked BEFORE the text is searched: a note that repeats an opener the
 * document never closes, thousands of times in one paragraph or HTML
 * block, must not cost a search to the end of the node per opener. Nor may
 * an opener whose closer stands BEFORE it — which passes the document's
 * question — cost one: the text's own closers are indexed once, the first
 * time an opener needs them, and each opener looks its closer up. Read once
 * per node and handed to `mayHoldImage`, which would otherwise read it
 * again.
 */
export function rawRegions(
  value: string,
  closers: CloserOracle = EVERY_CLOSER,
): RawRegions {
  const closed: TagSpan[] = [];
  // The text's closers by key, built the first time an opener asks; the
  // first closer at or after a position is then a lookup. The closer's
  // end, when found, or -1.
  let own: null | ReadonlyMap<string, number[]> = null;
  const closerEnd = (key: string, from: number, length: number): number => {
    own ??= closerIndex(value);
    const at = firstAtOrAfter(own.get(key), from);
    return at === -1 ? -1 : at + length;
  };
  let i = 0;
  // The next `<` and `\begin{` at or after `i`, found once each and kept
  // until the scan passes them; -1 means none until the end of the text.
  let lt = value.indexOf("<");
  let begin = value.indexOf("\\begin{");
  while (i < value.length) {
    if (lt !== -1 && lt < i) lt = value.indexOf("<", i);
    if (begin !== -1 && begin < i) begin = value.indexOf("\\begin{", i);
    if (lt === -1 && begin === -1) break;
    if (begin !== -1 && (lt === -1 || begin < lt)) {
      const env = escaped(value, begin)
        ? null
        : TEX_BEGIN.exec(value.slice(begin));
      if (env === null) {
        i = begin + 1;
        continue;
      }
      const key = `tex:${env[1]}`;
      const after = begin + env[0].length;
      if (!closers.anyFrom(key)) {
        i = after;
        continue;
      }
      // `\end{name}`: six characters around the name.
      const end = closerEnd(key, after, env[1].length + 6);
      if (end === -1) {
        if (closers.afterNode(key)) {
          const name = env[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return {
            closed,
            open: { at: begin, until: new RegExp(`\\\\end\\{${name}\\}`) },
          };
        }
        i = after;
        continue;
      }
      closed.push({ end, start: begin });
      i = end;
      continue;
    }
    if (escaped(value, lt)) {
      i = lt + 1;
      continue;
    }
    const rest = value.slice(lt);
    if (rest.startsWith("<!--")) {
      const abrupt = /^<!---?>/.exec(rest);
      if (abrupt !== null) {
        closed.push({ end: lt + abrupt[0].length, start: lt });
        i = lt + abrupt[0].length;
        continue;
      }
      if (!closers.anyFrom("comment")) {
        i = lt + 4;
        continue;
      }
      // `-->` or `--!>`: the index files where it starts.
      own ??= closerIndex(value);
      const at = firstAtOrAfter(own.get("comment"), lt + 4);
      if (at === -1) {
        if (closers.afterNode("comment")) {
          return {
            closed,
            open: { at: lt, until: new RegExp(COMMENT_END) },
          };
        }
        i = lt + 4;
        continue;
      }
      const end = at + (value[at + 2] === "!" ? 4 : 3);
      closed.push({ end, start: lt });
      i = end;
      continue;
    }
    const close = CLOSE_TAG.exec(rest);
    if (close !== null) {
      i = lt + close[0].length;
      continue;
    }
    const open = OPEN_TAG.exec(rest);
    if (open === null) {
      i = lt + 1;
      continue;
    }
    i = lt + open[0].length;
    const name = open[1].toLowerCase();
    if (!OPAQUE.has(name)) continue;
    const key = `tag:${name}`;
    if (!closers.anyFrom(key)) continue;
    // `</name`: the region ends with the closer's name, as the grammar's
    // closer pattern matches it.
    const end = closerEnd(key, i, name.length + 2);
    if (end === -1) {
      if (closers.afterNode(key)) {
        return {
          closed,
          open: { at: lt, until: new RegExp(`</${name}(?=[\\s/>])`, "i") },
        };
      }
      continue;
    }
    closed.push({ end, start: lt });
    i = end;
  }
  return { closed, open: null };
}

/** The first of `positions` (in ascending order) at or after `from`, or -1. */
function firstAtOrAfter(
  positions: readonly number[] | undefined,
  from: number,
): number {
  if (positions === undefined) return -1;
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (positions[mid] < from) low = mid + 1;
    else high = mid;
  }
  return low < positions.length ? positions[low] : -1;
}

/** Is the character at `at` escaped — preceded by an odd run of
 *  backslashes? `\<script>` and `\\begin{x}` are text to pandoc. */
function escaped(value: string, at: number): boolean {
  let slashes = 0;
  for (let k = at - 1; k >= 0 && value[k] === "\\"; k--) slashes++;
  return slashes % 2 === 1;
}
