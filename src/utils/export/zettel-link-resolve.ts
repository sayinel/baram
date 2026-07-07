import {
  serializeWikilink,
  WIKILINK_RE,
} from "../../pipeline/transformers/wikilink-transformer";
// §95 Zettelkasten export — resolve bare [[id]] wikilinks to [[id|title]] for
// EXPORT markdown only (HTML/Notion/Pandoc). The in-app .md round-trip save
// (pm-to-md.ts → serializeWikilink) MUST keep [[id]] unchanged — do not call
// this helper from that path.
import { titleForId } from "../../stores/zettelkasten/zettel-index";
import { isZettelId } from "../zettelkasten/parse-note-title";

// §perf-large-file: Pre-compiled regex with its own 'g' flag/lastIndex state,
// independent of the shared WIKILINK_RE instance (see convert-inline-text.ts).
const WIKILINK_RE_G = new RegExp(WIKILINK_RE.source, "g");

/**
 * Rewrites bare Zettelkasten-id wikilinks (`[[id]]`) to `[[id|title]]` using
 * the live zettel index, for export markdown assembly only.
 *
 * Gated identically to the in-app WikilinkView NodeView (§95): only rewrites
 * when there is no vault alias, no heading, and no existing display text —
 * i.e. a genuinely bare `[[id]]`. Cross-vault links, heading-anchored links,
 * already-aliased links (`[[id|display]]`), non-id targets, and ids with no
 * matching index entry are all left unchanged.
 */
export function resolveZettelLinksForExport(markdown: string): string {
  return markdown.replace(
    WIKILINK_RE_G,
    (
      full,
      vaultAlias: string | undefined,
      target: string,
      heading: string | undefined,
      blockId: string | undefined,
      display: string | undefined,
    ) => {
      if (vaultAlias || heading || display) return full;
      if (!isZettelId(target)) return full;

      const title = titleForId(target);
      if (!title) return full;

      return serializeWikilink({
        target,
        blockId: blockId || null,
        display: title,
      });
    },
  );
}
