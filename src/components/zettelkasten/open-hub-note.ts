// §101 Zettel hub — shared "open in tab" helper for row clicks.
// Dedup of the near-identical open logic that used to live separately in
// ZettelInboxList (inbox rows) and ZettelSectionList (MOC/Recent rows).
import { readFile } from "../../ipc/invoke";
import { openFileInTab } from "../../services/journal-file-service";
import { logger } from "../../utils/logger";

/** Reads `path` and opens it in a tab; logs (does not throw) on failure. */
export async function openZettelHubNote(path: string): Promise<void> {
  try {
    const content = await readFile(path);
    await openFileInTab(path, content);
  } catch (err) {
    logger.error(`[Zettel] hub: open note failed (${path}):`, err);
  }
}
