// §56f · §5.12 export — the photos of `journal-photos` blocks, embedded from their source
// (issue 793).
//
// A cell in the live editor loads its thumbnail only when it nears the viewport, so most
// cells of a long block have no image when an export starts. Waking them all would fire a
// thumbnail request per cell at a backend that decodes two at a time
// (`src-tauri/src/commands/thumbnail_cmd.rs`), and every request still queued when the
// export gave up would keep the backend busy afterwards. So the export does not wake the
// live cells. It reads, from each cloned cell, the photo it stands for
// (`data-photo-*`, written by `JournalPhotoCell`), and fills it through a queue as wide as
// the backend: the cell's own tier, then the bytes as a data URI. Past the deadline it
// starts no more requests, and every cell it did not reach gets the same fallback as a
// photo that could not be read — its name as text, never a broken image.

import { resolveThumbUrl } from "../journal/photo-thumbnail";

/** Requests in flight at once — the backend's own decode limit. */
export const EXPORT_PHOTO_CONCURRENCY = 2;

/** After this, no new photo is started; the rest export as their names. */
export const EXPORT_PHOTO_DEADLINE_MS = 120_000;

export interface EmbedPhotosOptions {
  concurrency?: number;
  deadlineMs?: number;
}

/** How the cells of one export ended. */
export interface EmbedPhotosResult {
  embedded: number;
  fallback: number;
}

/**
 * Fill every `journal-photos` cell in `clone` with its photo as a data URI, or with its
 * name when the photo cannot be read or the deadline passed. Strips the `data-photo-*`
 * attributes either way: they hold the photo's absolute path, which must not ship.
 */
export async function embedJournalPhotos(
  clone: ParentNode,
  options: EmbedPhotosOptions = {},
): Promise<EmbedPhotosResult> {
  const concurrency = options.concurrency ?? EXPORT_PHOTO_CONCURRENCY;
  const deadline =
    Date.now() + (options.deadlineMs ?? EXPORT_PHOTO_DEADLINE_MS);
  const cells = [
    ...clone.querySelectorAll<HTMLElement>(".journal-photos-cell"),
  ];
  const result: EmbedPhotosResult = { embedded: 0, fallback: 0 };
  const photos = cells.map((cell) => {
    const photo = {
      alt: cell.dataset.photoAlt ?? "",
      cell,
      path: cell.dataset.photoPath ?? "",
      px: Number(cell.dataset.photoPx),
      revision: cell.dataset.photoRevision ?? "",
    };
    delete cell.dataset.photoAlt;
    delete cell.dataset.photoPath;
    delete cell.dataset.photoPx;
    delete cell.dataset.photoRevision;
    cell.replaceChildren();
    return photo;
  });

  let next = 0;
  const done = new Set<HTMLElement>();
  const worker = async () => {
    while (next < photos.length && Date.now() < deadline) {
      const photo = photos[next++];
      // Each step is bounded by the deadline too: a request the backend never answers
      // costs the cell its photo, not the export its end.
      const thumb = await beforeDeadline(
        resolveThumbUrl(photo.path, photo.px, photo.revision),
        deadline,
      );
      const data =
        thumb && (await beforeDeadline(readAsDataURI(thumb.url), deadline));
      if (thumb && data) {
        const img = photo.cell.ownerDocument.createElement("img");
        img.className = "journal-photos-thumb";
        img.alt = photo.alt;
        img.dataset.thumbSource = thumb.isOriginal ? "original" : "cache";
        img.src = data;
        photo.cell.append(img);
        result.embedded++;
        done.add(photo.cell);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  for (const photo of photos) {
    if (done.has(photo.cell)) continue;
    const name = photo.cell.ownerDocument.createElement("span");
    name.className = "journal-photos-missing";
    name.textContent = photo.alt;
    photo.cell.append(name);
    result.fallback++;
  }
  return result;
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
