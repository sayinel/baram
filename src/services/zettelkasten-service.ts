// §94 Zettelkasten service — create a permanent note and open it
import { createDir, listDir, writeFile } from "../ipc/invoke";
import { generateZettelId } from "../utils/zettelkasten/zettel-id";
import { buildPermanentNote } from "../utils/zettelkasten/zettel-note";
import { openFileInTab } from "./journal-file-service";

/** §94 Create a permanent atomic note and open it. */
export async function createZettelNote(
  zettelDir: string,
  title: string,
): Promise<null | { path: string }> {
  const notesDir = `${zettelDir}/notes`;
  await createDir(notesDir);
  const existing = await collectExistingIds(zettelDir);
  const id = generateZettelId(existing);
  const created = new Date().toISOString().slice(0, 16);
  const { filename, content } = buildPermanentNote({ id, title, created });
  const path = `${notesDir}/${filename}`;
  await writeFile(path, content);
  await openFileInTab(path, content);
  return { path };
}

/** Collect existing note ids (filename prefix) from notes/ + inbox/. */
async function collectExistingIds(zettelDir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const sub of ["notes", "inbox"]) {
    try {
      const entries = await listDir(`${zettelDir}/${sub}`, false);
      for (const e of entries) {
        const m = e.name.match(/^(\d{12,14})\b/);
        if (m) ids.add(m[1]);
      }
    } catch {
      /* dir may not exist yet */
    }
  }
  return ids;
}
