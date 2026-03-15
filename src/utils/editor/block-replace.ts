// §30d Block replace utility — replace block text by ^blockId in markdown content

/**
 * Replace the text content of a block identified by ^blockId in markdown content.
 * Preserves heading prefix (# markers) and ^blockId suffix.
 * Returns null if blockId not found.
 */
export function replaceBlockInContent(
  content: string,
  blockId: string,
  newText: string,
): null | string {
  const lines = content.split("\n");
  const suffix = ` ^${blockId}`;
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].endsWith(suffix)) {
      // Capture heading prefix if present
      const headingMatch = lines[i].match(/^(#{1,6}\s+)/);
      const prefix = headingMatch ? headingMatch[1] : "";
      lines[i] = prefix + newText + suffix;
      found = true;
      break;
    }
  }

  return found ? lines.join("\n") : null;
}
