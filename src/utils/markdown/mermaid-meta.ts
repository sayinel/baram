// §5.5 Mermaid block metadata — Baram-specific width/caption persisted as a
// `%% baram-meta: {json}` comment line inside the ```mermaid fence. Mermaid
// ignores `%%` comments, so it round-trips with the source; the line is stripped
// before mermaid.render so it never reaches the diagram parser.

export interface MermaidMeta {
  caption: null | string;
  width: null | number;
}

const EMPTY: MermaidMeta = { caption: null, width: null };

// A single line: optional indent, `%%`, `baram-meta:`, then a JSON object.
// `\{.*\}` is greedy to the last brace on the line (JSON is single-line).
const META_LINE_RE = /^[ \t]*%%[ \t]*baram-meta:[ \t]*(\{.*\})[ \t]*\r?\n?/im;

/** Frontmatter block (`---\n…\n---\n`) that must stay first, if present. */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/** Read Baram width/caption metadata from mermaid source (defaults when absent). */
export function parseMermaidMeta(code: string): MermaidMeta {
  const m = META_LINE_RE.exec(code);
  if (!m) return { ...EMPTY };
  try {
    const obj = JSON.parse(m[1]) as Record<string, unknown>;
    return {
      caption:
        typeof obj.caption === "string" && obj.caption ? obj.caption : null,
      width: typeof obj.width === "number" ? obj.width : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Upsert the Baram metadata line. Empty meta (no width, no caption) removes it.
 * The line is placed after any leading frontmatter so mermaid still parses.
 */
export function setMermaidMeta(code: string, meta: MermaidMeta): string {
  const cleaned = stripMermaidMeta(code);
  const obj: Record<string, unknown> = {};
  if (meta.width != null) obj.width = meta.width;
  if (meta.caption) obj.caption = meta.caption;
  if (Object.keys(obj).length === 0) return cleaned;

  const line = `%% baram-meta: ${JSON.stringify(obj)}\n`;
  const fm = FRONTMATTER_RE.exec(cleaned);
  if (fm) {
    const at = fm[0].length;
    return cleaned.slice(0, at) + line + cleaned.slice(at);
  }
  return line + cleaned;
}

/** Remove the Baram metadata line (used before handing source to mermaid.render). */
export function stripMermaidMeta(code: string): string {
  return code.replace(META_LINE_RE, "");
}
