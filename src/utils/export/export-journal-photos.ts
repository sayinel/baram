// §56f · §5.12 export — the photos of `journal-photos` blocks, embedded from their source
// (issue 793).
//
// A cell in the live editor loads its thumbnail only when it nears the viewport, so most
// cells of a long block have no image when an export starts. Waking them all would fire a
// thumbnail request per cell at a backend that decodes two at a time
// (`src-tauri/src/commands/thumbnail_cmd.rs`), and every request still queued when the
// export gave up would keep the backend busy afterwards. So the export does not wake the
// live cells. It asks each one which photo it stands for (`cellPhotoOf` — never an
// attribute, see journal-photo-cells.ts), and fills its copy in the clone through a queue
// as wide as the backend: the cell's own tier, then the bytes as a data URI. Past the
// deadline it starts no more requests. A cell it did not reach, or whose bytes it could not
// read, gets the photo's name as text. Bytes that read but do not decode still make a
// broken image: nothing here decodes them.

import { type CellPhoto, cellPhotoOf } from "../journal/journal-photo-cells";
import { resolveThumbUrl } from "../journal/photo-thumbnail";

/** Requests in flight at once — the backend's own decode limit. */
export const EXPORT_PHOTO_CONCURRENCY = 2;

/** After this, no new photo is started; the rest export as their names. */
export const EXPORT_PHOTO_DEADLINE_MS = 120_000;

const CELL = ".journal-photos-cell";

export interface EmbedPhotosOptions {
  concurrency?: number;
  deadlineMs?: number;
}

/** How the cells of one export ended. */
export interface EmbedPhotosResult {
  embedded: number;
  fallback: number;
}

/** A cell's copy in the clone, and the photo its original stands for. */
export interface PhotoCell {
  cell: HTMLElement;
  photo: CellPhoto;
}

/**
 * Fill every cell with its photo as a data URI, or with its name when the photo cannot be
 * read or the deadline passed.
 */
export async function embedJournalPhotos(
  cells: readonly PhotoCell[],
  options: EmbedPhotosOptions = {},
): Promise<EmbedPhotosResult> {
  const concurrency = options.concurrency ?? EXPORT_PHOTO_CONCURRENCY;
  const deadline =
    Date.now() + (options.deadlineMs ?? EXPORT_PHOTO_DEADLINE_MS);
  const result: EmbedPhotosResult = { embedded: 0, fallback: 0 };
  // The copy of a cell the reader scrolled to holds the live image, whose asset URL
  // must not ship.
  for (const { cell } of cells) cell.replaceChildren();

  let next = 0;
  const done = new Set<HTMLElement>();
  const worker = async () => {
    while (next < cells.length && Date.now() < deadline) {
      const { cell, photo } = cells[next++];
      // Each step is bounded by the deadline too: a request the backend never answers
      // costs the cell its photo, not the export its end.
      const thumb = await beforeDeadline(
        resolveThumbUrl(photo.path, photo.px, photo.revision),
        deadline,
      );
      const data =
        thumb && (await beforeDeadline(readAsDataURI(thumb.url), deadline));
      if (thumb && data) {
        const img = cell.ownerDocument.createElement("img");
        img.className = "journal-photos-thumb";
        img.alt = photo.alt;
        img.dataset.thumbSource = thumb.isOriginal ? "original" : "cache";
        img.src = data;
        cell.append(img);
        result.embedded++;
        done.add(cell);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  for (const { cell, photo } of cells) {
    if (done.has(cell)) continue;
    const name = cell.ownerDocument.createElement("span");
    name.className = "journal-photos-missing";
    name.textContent = photo.alt;
    cell.append(name);
    result.fallback++;
  }
  return result;
}

/**
 * The cells of `clone`, each with the photo its original in `live` stands for. Call it in
 * the task that cloned `live`: the two lists line up only while the trees are identical.
 * An element that merely has the class stands for nothing, so it stays as its author wrote it.
 */
export function photoCellsOf(live: ParentNode, clone: ParentNode): PhotoCell[] {
  const copies = clone.querySelectorAll<HTMLElement>(CELL);
  return [...live.querySelectorAll(CELL)].flatMap((el, i) => {
    const photo = cellPhotoOf(el);
    return photo ? [{ cell: copies[i], photo }] : [];
  });
}

/** `work`'s value, or null if `deadline` (epoch ms) comes first. */
async function beforeDeadline<T>(
  work: Promise<T>,
  deadline: number,
): Promise<null | T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The bytes behind `url` as a data URI; null when they cannot be read. */
async function readAsDataURI(url: string): Promise<null | string> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<null | string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
