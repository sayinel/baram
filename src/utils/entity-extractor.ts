// §11.5.3 Dictionary-based Entity Extractor
// Finds entity names from a dictionary within text, excluding already-linked entities.

/**
 * Extract entities from text that match entries in the dictionary.
 *
 * - Case-insensitive matching (returns original dictionary casing)
 * - Excludes text already inside [[wikilinks]]
 * - Multi-word entity support
 * - Deduplicates results
 */
export function extractEntities(
  text: string,
  dictionary: Set<string>,
): string[] {
  if (!text || dictionary.size === 0) return [];

  // Strip wikilink content so linked entities are excluded.
  // Matches [[target]], [[target|display]], [[target#heading]], etc.
  const strippedText = text.replace(/\[\[[^\]]*\]\]/g, (match) =>
    " ".repeat(match.length),
  );

  // Build a lookup map: lowercased term → original dictionary casing
  const lowerToOriginal = new Map<string, string>();
  for (const term of dictionary) {
    lowerToOriginal.set(term.toLowerCase(), term);
  }

  const found = new Set<string>();

  for (const [lowerTerm, originalTerm] of lowerToOriginal) {
    // Escape regex special chars in the term
    const escaped = lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word-boundary matching for the term
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");

    if (regex.test(strippedText)) {
      found.add(originalTerm);
    }
  }

  return [...found];
}
