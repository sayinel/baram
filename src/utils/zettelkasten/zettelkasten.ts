/**
 * §92 Zettelkasten space — scaffold utility functions
 */
import { createDir } from "../../ipc/invoke";

/** Create inbox/ and notes/ under the zettelkasten root (idempotent). */
export async function ensureZettelkastenScaffold(
  rootPath: string,
): Promise<void> {
  await createDir(`${rootPath}/inbox`);
  await createDir(`${rootPath}/notes`);
}

/**
 * Resolve the zettelkasten directory setting to an absolute path.
 * Mirror of `resolveJournalDir` (src/utils/journal/journal.ts): rootPath is
 * unused — only absolute paths (Unix or Windows drive letter) are valid;
 * relative paths are not supported.
 */
export function resolveZettelDir(
  _rootPath: null | string,
  zettelDir: string,
): null | string {
  if (!zettelDir) return null;
  if (zettelDir.startsWith("/") || /^[A-Z]:\\/.test(zettelDir)) {
    return zettelDir;
  }
  return null; // relative path not supported
}
