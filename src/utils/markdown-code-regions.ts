/**
 * Utilities for protecting code blocks during markdown text transformations.
 *
 * Prevents regex replacements from accidentally modifying content inside
 * fenced code blocks (``` ... ```), inline code, or math blocks.
 */

export interface CodeRegion {
  end: number;
  start: number;
}

/**
 * Collect start/end offsets of all fenced code blocks, block math, and
 * inline code spans in content.
 */
export function collectCodeRegions(md: string): CodeRegion[] {
  const regions: CodeRegion[] = [];

  // Fenced code blocks: ``` or ~~~
  const fencedRe = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\s*$/gm;
  let m: null | RegExpExecArray;
  while ((m = fencedRe.exec(md)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  // Block math: $$...$$ (multiline)
  const blockMathRe = /\$\$[\s\S]*?\$\$/g;
  while ((m = blockMathRe.exec(md)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  // Inline code: `...`
  const inlineCodeRe = /`[^`\n]+`/g;
  while ((m = inlineCodeRe.exec(md)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  return regions;
}

/**
 * Returns true if the given offset falls inside any code region.
 */
export function isInCodeRegion(pos: number, regions: CodeRegion[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

/**
 * Apply a regex replacement only to text outside fenced code blocks,
 * inline code, and math blocks.
 * The replacer receives the same arguments as a String.replace callback.
 */
export function replaceOutsideCode(
  md: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
): string {
  const regions = collectCodeRegions(md);
  // Ensure the regex is global
  const globalRe = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g",
  );
  return md.replace(globalRe, (match: string, ...args: unknown[]) => {
    // String.replace passes: match, ...groups, offset, originalString
    // offset is the second-to-last argument
    const offset = args[args.length - 2] as number;
    if (isInCodeRegion(offset, regions)) {
      return match;
    }
    return replacer(match, ...(args.slice(0, -2) as string[]));
  });
}
