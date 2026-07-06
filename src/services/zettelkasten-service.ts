// §94 Zettelkasten service — create a permanent note and open it
import {
  createDir,
  deleteFile,
  listDir,
  readFile,
  writeFile,
} from "../ipc/invoke";
import { useZettelIndexStore } from "../stores/zettelkasten/zettel-index";
import {
  generateZettelId,
  localIsoMinute,
} from "../utils/zettelkasten/zettel-id";
import {
  buildFleetingNote,
  buildPermanentNote,
  sanitizeZettelTitle,
} from "../utils/zettelkasten/zettel-note";
import { openFileInTab } from "./journal-file-service";

/**
 * §99 Write a fleeting note into inbox/ from Quick Capture. Does NOT open a
 * tab — fleeting notes accumulate silently until promoted.
 */
export async function captureFleeting(
  zettelDir: string,
  body: string,
): Promise<null | { path: string }> {
  const inboxDir = `${zettelDir}/inbox`;
  await createDir(inboxDir);
  const existing = await collectExistingIds(zettelDir);
  const id = generateZettelId(existing);
  const created = localIsoMinute();
  const { filename, content } = buildFleetingNote({ id, body, created });
  const path = `${inboxDir}/${filename}`;
  await writeFile(path, content);
  useZettelIndexStore.getState().upsert({ id, path, title: id });
  return { path };
}

/** §94 Create a permanent atomic note and open it. */
export async function createZettelNote(
  zettelDir: string,
  title: string,
): Promise<null | { path: string }> {
  const notesDir = `${zettelDir}/notes`;
  await createDir(notesDir);
  const existing = await collectExistingIds(zettelDir);
  const id = generateZettelId(existing);
  const created = localIsoMinute();
  const { filename, content } = buildPermanentNote({ id, title, created });
  const path = `${notesDir}/${filename}`;
  await writeFile(path, content);
  useZettelIndexStore.getState().upsert({ id, path, title });
  await openFileInTab(path, content);
  return { path };
}

/**
 * §96 Promote a fleeting inbox note to a permanent note: reuses the id from
 * the inbox filename, carries the fleeting body forward, deletes the inbox
 * file, and opens the new permanent note.
 */
export async function promoteFleeting(
  zettelDir: string,
  fleetingPath: string,
  title: string,
): Promise<null | { path: string }> {
  const idMatch = fleetingPath.match(/(\d{12,14})\.md$/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const raw = await readFile(fleetingPath);
  const seedBody = stripFrontmatter(raw);
  const created =
    extractCreated(raw) ?? deriveCreatedFromId(id) ?? localIsoMinute();
  const notesDir = `${zettelDir}/notes`;
  await createDir(notesDir);
  const filename = `${id} ${sanitizeZettelTitle(title)}.md`;
  const path = `${notesDir}/${filename}`;
  const content =
    `---\n` +
    `id: ${id}\n` +
    `title: ${title}\n` +
    `created: ${created}\n` +
    `tags: []\n` +
    `aliases: []\n` +
    `---\n\n` +
    `# ${title}\n\n${seedBody}\n`;
  await writeFile(path, content);
  await deleteFile(fleetingPath);
  useZettelIndexStore.getState().upsert({ id, path, title });
  useZettelIndexStore.getState().removeByPath(fleetingPath);
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

/**
 * Fall back to deriving `created` from the reused zettel id
 * (`YYYYMMDDHHmm[ss]`) when the fleeting note has no `created:` frontmatter.
 */
function deriveCreatedFromId(id: string): null | string {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, day, h, mi] = m;
  return `${y}-${mo}-${day}T${h}:${mi}`;
}

/** Read the `created:` value out of a note's YAML frontmatter, if present. */
function extractCreated(md: string): null | string {
  const m = md.match(/^created:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

/** Strip a leading YAML frontmatter block, if present. */
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? md.slice(m[0].length).trimStart() : md.trimStart();
}
