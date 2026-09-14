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
 * block, must not cost a search to the end of the node per opener. Read
 * once per node and handed to `mayHoldImage`, which would otherwise read it
 * again.
 */
export function rawRegions(
  value: string,
  closers: CloserOracle = EVERY_CLOSER,
): RawRegions {
  const closed: TagSpan[] = [];
  // Keys whose closer this text does not hold from some point on, and the
  // document does not hold after the node: a search that failed from one
  // opener fails from every later one, so the key is settled for the rest
  // of the text — an opener whose closer lies BEFORE it would otherwise
  // pass the document's question and cost a search each.
  const exhausted = new Set<string>();
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
      if (exhausted.has(key) || !closers.anyFrom(key)) {
        i = after;
        continue;
      }
      const name = env[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const end = new RegExp(`\\\\end\\{${name}\\}`, "g");
      end.lastIndex = after;
      const closer = end.exec(value);
      if (closer === null) {
        if (closers.afterNode(key)) {
          return {
            closed,
            open: { at: begin, until: new RegExp(end.source) },
          };
        }
        exhausted.add(key);
        i = after;
        continue;
      }
      closed.push({ end: closer.index + closer[0].length, start: begin });
      i = closer.index + closer[0].length;
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
      if (exhausted.has("comment") || !closers.anyFrom("comment")) {
        i = lt + 4;
        continue;
      }
      const end = new RegExp(COMMENT_END, "g");
      end.lastIndex = lt + 4;
      const closer = end.exec(value);
      if (closer === null) {
        if (closers.afterNode("comment")) {
          return {
            closed,
            open: { at: lt, until: new RegExp(COMMENT_END) },
          };
        }
        exhausted.add("comment");
        i = lt + 4;
        continue;
      }
      closed.push({ end: closer.index + closer[0].length, start: lt });
      i = closer.index + closer[0].length;
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
    if (exhausted.has(key) || !closers.anyFrom(key)) continue;
    const end = new RegExp(`</${name}(?=[\\s/>])`, "gi");
    end.lastIndex = i;
    const closer = end.exec(value);
    if (closer === null) {
      if (closers.afterNode(key)) {
        return {
          closed,
          open: { at: lt, until: new RegExp(end.source, "i") },
        };
      }
      exhausted.add(key);
      continue;
    }
    closed.push({ end: closer.index + closer[0].length, start: lt });
    i = closer.index + closer[0].length;
  }
  return { closed, open: null };
}

/** Is the character at `at` escaped — preceded by an odd run of
 *  backslashes? `\<script>` and `\\begin{x}` are text to pandoc. */
function escaped(value: string, at: number): boolean {
  let slashes = 0;
  for (let k = at - 1; k >= 0 && value[k] === "\\"; k--) slashes++;
  return slashes % 2 === 1;
}
