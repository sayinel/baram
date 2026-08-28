/**
 * §92 Zettelkasten space — scaffold utility functions
 */
import { createDir } from "../../ipc/invoke";
import { resolveAbsoluteDirSetting } from "../path-utils";

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
  // §312.1: the rule itself now lives in `path-utils` — the tasks home needed a
  // third copy of it, and two of the existing three already said "mirror of the
  // other" in their doc comments.
  return resolveAbsoluteDirSetting(zettelDir);
}
