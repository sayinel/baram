// §56f · §5.12 — what a mounted `journal-photos` block tells an export (issue 793).
//
// ‼️ Kept here, keyed by element, and never written on the DOM. An export reads the whole
// editor, and part of it is markup a note's author wrote: an HTML block, a ```svg fence,
// whatever renders next. `sanitizeHtmlBlock` and `sanitizeSvg` keep `class` and `data-*`,
// so a fact read from an attribute is one any note can forge — a photo path would pull that
// file's bytes into the export, a "still listing" marker would cost every export the stall
// budget. An element is in here only because the block's own components put it there, so
// nothing a note writes reaches either set, and no list of renderers has to stay complete.

/** The photo a mounted cell stands for. */
export interface CellPhoto {
  alt: string;
  path: string;
  /** The thumbnail tier the cell asks for (`maxPx`). */
  px: number;
  /** `sourceRevision` of the file as listed. */
  revision: string;
}

const cellPhotos = new WeakMap<Element, CellPhoto>();
/** A block's root while it is still listing its photos. Strong refs: each leaves on unmount. */
const listingBlocks = new Set<Element>();

/** The photo `el` stands for, if a `JournalPhotoCell` mounted it. */
export function cellPhotoOf(el: Element): CellPhoto | undefined {
  return cellPhotos.get(el);
}

/** The blocks inside `root` that do not know their photos yet. */
export function listingBlocksIn(root: ParentNode): Element[] {
  return [...listingBlocks].filter((el) => root.contains(el));
}

/** Record what `el` stands for; returns the disposer. */
export function registerCellPhoto(el: Element, photo: CellPhoto): () => void {
  cellPhotos.set(el, photo);
  return () => {
    if (cellPhotos.get(el) === photo) cellPhotos.delete(el);
  };
}

/**
 * A ref callback for a block's loading root: listed while attached. React 19 calls the
 * returned cleanup when the ref detaches — including when the same element is reused for the
 * listed grid, which drops this ref.
 */
export function trackListingBlock(
  el: Element | null,
): (() => void) | undefined {
  if (!el) return undefined;
  listingBlocks.add(el);
  return () => {
    listingBlocks.delete(el);
  };
}
