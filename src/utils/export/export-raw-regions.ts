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
  // The text's argument groups, matched in one pass the first time a TeX
  // command asks: the index just past the last group of the arguments of
  // the command at `at`, as pandoc reads a raw TeX command — `[…]` groups
  // before the first `{…}` group and `{…}` groups after it, blanks and line
  // breaks between them allowed (`\foo[o] {x}`, `\href{u} {x}`) — or -1
  // when the first group nothing closes, or an unescaped `\begin{` lies
  // inside: pandoc reads the command as text then, the environment opens,
  // and so does the scan. `begin` is the scan's next `\begin{` behind the
  // command. A lookup, so a thousand commands nothing closes cost one pass,
  // not a scan to the end each.
  let groups: null | ReadonlyMap<number, number> = null;
  const argumentsEnd = (at: number, begin: number): number => {
    groups ??= groupMatches(value);
    let k = at + 1;
    while (k < value.length && /[A-Za-z]/.test(value[k])) k++;
    let end = -1;
    let braced = false;
    for (;;) {
      let j = k;
      while (j < value.length && /\s/.test(value[j])) j++;
      const c = value[j];
      if (c !== "{" && (c !== "[" || braced)) break;
      const close = groups.get(j);
      if (close === undefined) break;
      braced ||= c === "{";
      k = close + 1;
      end = k;
    }
    if (end === -1) return -1;
    let environment = begin;
    while (
      environment !== -1 &&
      environment < end &&
      escaped(value, environment)
    ) {
      environment = value.indexOf("\\begin{", environment + 1);
    }
    return environment !== -1 && environment < end ? -1 : end;
  };
  let i = 0;
  // The next `<`, `\begin{` and `\command{` at or after `i`, found once each
  // and kept until the scan passes them; -1 means none until the end of the
  // text.
  let lt = value.indexOf("<");
  let begin = value.indexOf("\\begin{");
  let command = texCommandAt(value, 0);
  while (i < value.length) {
    if (lt !== -1 && lt < i) lt = value.indexOf("<", i);
    if (begin !== -1 && begin < i) begin = value.indexOf("\\begin{", i);
    if (command !== -1 && command < i) command = texCommandAt(value, i);
    if (lt === -1 && begin === -1) break;
    // A raw TeX command's arguments — `\texttt{<script>}`,
    // `\href{u}{<script>}` — are one raw TeX inline to pandoc: the `<`
    // inside them opens nothing, and the scan resumes behind the last
    // group. The span is closed to `mayHoldImage`, which reads no image in
    // it. `\begin{` itself is not such a command, and an escaped backslash
    // is text.
    const next = lt === -1 ? begin : begin === -1 ? lt : Math.min(lt, begin);
    if (command !== -1 && command < next) {
      const close = argumentsEnd(command, begin);
      if (close === -1) {
        i = command + 1;
        continue;
      }
      closed.push({ end: close, start: command });
      i = close;
      continue;
    }
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

/** A raw TeX command with an argument, `\word{` or `\word[` — blanks
 *  between the name and the group allowed, as pandoc allows them. */
const TEX_COMMAND = /\\([A-Za-z]+)\s*[{[]/g;

/** The start of the next `\word{` at or after `from`, or -1. `\begin{`
 *  and `\end{` are the environment's opener and closer, which the scan
 *  reads itself, not commands, and an escaped backslash is text. */
function texCommandAt(value: string, from: number): number {
  TEX_COMMAND.lastIndex = from;
  for (
    let hit = TEX_COMMAND.exec(value);
    hit !== null;
    hit = TEX_COMMAND.exec(value)
  ) {
    if (hit[1] !== "begin" && hit[1] !== "end" && !escaped(value, hit.index)) {
      return hit.index;
    }
    TEX_COMMAND.lastIndex = hit.index + 1;
  }
  return -1;
}

/** Every `{` and `[` of `value` that a `}` or `]` closes, mapped to the
 *  index of that closer — one pass, so that the arguments of each TeX
 *  command are a lookup. Braces nest; a bracket group skips the braced
 *  groups inside it, so a `]` in one does not close it, as pandoc's TeX
 *  reader skips them; an escaped delimiter is text. An unmatched opener is
 *  absent. */
function groupMatches(value: string): ReadonlyMap<number, number> {
  const matches = new Map<number, number>();
  const open: number[] = [];
  let slashes = 0;
  for (let k = 0; k < value.length; k++) {
    const c = value[k];
    if (c === "\\") {
      slashes++;
      continue;
    }
    const escapedHere = slashes % 2 === 1;
    slashes = 0;
    if (escapedHere) continue;
    if (c === "{" || c === "[") {
      open.push(k);
    } else if (c === "}") {
      // The nearest brace closes; a bracket left open inside it is text.
      for (let start = open.pop(); start !== undefined; start = open.pop()) {
        if (value[start] === "{") {
          matches.set(start, k);
          break;
        }
      }
    } else if (c === "]") {
      const top = open[open.length - 1];
      if (top !== undefined && value[top] === "[") {
        open.pop();
        matches.set(top, k);
      }
    }
  }
  return matches;
}
