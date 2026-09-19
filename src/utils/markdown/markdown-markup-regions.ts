/**
 * The markup a converter must not rewrite — HTML tags, link and image
 * destinations, reference definitions (issue 544). The mark passes opt in
 * through the `markup` option of `markdown-code-regions.ts`; the Notion
 * math pass (`inlineMathSpans`) always steps over it.
 */

import { type CodeRegion, isLive } from "./markdown-source";

/** HTML tags, link/image destinations and reference definitions — their
 *  text is markup or a path, and a `~`/`^` there is never a mark. */
export function markupRegions(md: string): CodeRegion[] {
  const regions: CodeRegion[] = [];
  let m: null | RegExpExecArray;
  // An HTML tag — a live `<`, a real tag name, attributes, `>`. `\<u~a b~>`
  // is prose with an escaped `<`.
  //
  // Attributes are matched by their own grammar rather than "anything up
  // to the next `>`", because a QUOTED VALUE may hold one: with
  // `[^<>\n]*` the region of `<img alt="x>y" src="p/~a b~.png">` stopped
  // at the `>` inside `alt`, leaving the `src` path exposed to the mark
  // rewriters — the very failure this option exists to prevent.
  const tagRe =
    /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^\s"'/=<>]+(?:\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s"'`=<>]+))?)*\s*\/?>/g;
  while ((m = tagRe.exec(md)) !== null) {
    if (isLive(md, m.index)) {
      regions.push({ end: m.index + m[0].length, start: m.index });
    }
  }
  const destinationRe = /\]\((?:[^()\n\\]|\\.|\([^()\n]*\))*\)/g;
  while ((m = destinationRe.exec(md)) !== null) {
    regions.push({ end: m.index + m[0].length, start: m.index });
  }
  // A link/image REFERENCE definition — `[id]: dest "title"`. Its
  // destination is a path exactly as an inline one is, and
  // `export-markdown-images.ts` walks `definition` nodes, so a
  // reference-style image is a supported input: a `\ ` injected here names
  // no file and the image is silently reduced to its alt text.
  const definitionRe =
    /^ {0,3}\[(?:[^\]\\\n]|\\.)*\]:[ \t]*(?:<[^>\n]*>|\S+)/gm;
  while ((m = definitionRe.exec(md)) !== null) {
    regions.push({ end: m.index + m[0].length, start: m.index });
  }
  return regions;
}
