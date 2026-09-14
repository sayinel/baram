// issue 545 — the image half of the Pandoc route: which vault or folder
// context owns the document, what the image policy staged and refused, and
// the notice the user gets for it. The route (export.ts) decides when: after
// every converter and the mermaid rewrite, before the link policy, and the
// notice only once the export went through.
import type { Locale } from "../../i18n";
import type {
  ContextInfo,
  PandocFormat,
  PandocImageRequest,
} from "../../ipc/types";

import { t } from "../../i18n";
import { contextRootOf, useContextStore } from "../../stores/context/context";
import { hasDriveLetter, isUnderRoot, toPosixPath } from "../path-utils";
import {
  MAX_STAGED_IMAGES,
  rewriteImageTagsAsMarkdown,
  stageMarkdownImages,
} from "./export-markdown-images";

/** The Pandoc targets that embed images, i.e. make pandoc open the files (issue 545). */
const PANDOC_EMBEDS_IMAGES: ReadonlySet<PandocFormat> = new Set([
  "docx",
  "epub",
]);

/** Does exporting to `format` embed images — and so depend on where the
 *  document's images can be read from? LaTeX and RST write references. */
export function pandocEmbedsImages(format: PandocFormat): boolean {
  return PANDOC_EMBEDS_IMAGES.has(format);
}

/** What the image policy made of the markdown: for the backend, and for the user. */
export interface PandocImagePreparation {
  /** The context whose canonical root bounds what the backend may read;
   *  undefined when no directory context holds the document. */
  documentContextId: string | undefined;
  /** The images to stage, in document order; the backend reads them. */
  images: PandocImageRequest[];
  markdown: string;
  /** How many `<img>` tags with no source became their alt text. */
  noSource: number;
  /** How many images past the backend's cap became their alt text. */
  overCap: number;
  /** How many images whose destination was refused became their alt text. */
  refused: number;
  /** Whether the document had a context to be relative to at all — which
   *  decides the wording of the notice. The text writers embed nothing and
   *  take every reference as written, so for them this is always true. */
  scoped: boolean;
  /** How many html fragments the policy could not read and that may hold an image. */
  unsupportedHtml: number;
}

/**
 * For the formats that EMBED images — pandoc reads the files — the image
 * policy (export-markdown-images.ts) keeps the assets this export produced,
 * turns every path that stays inside the document's own context, relative
 * or absolute, into an asset request the backend resolves there, and
 * reduces everything else to alt text. LaTeX and RST embed nothing — pandoc writes
 * the reference and reads no file — so their images pass through as
 * written; `<img>` tags are still turned into markdown images so the
 * raw-HTML drop does not swallow one, and a tag with no source becomes its
 * alt text and is counted like any refused image. `knownAssets` are the
 * names this export produced (the rasterized diagrams).
 */
export function preparePandocImages(
  markdown: string,
  format: PandocFormat,
  documentPath: null | string,
  knownAssets: ReadonlySet<string>,
): PandocImagePreparation {
  const owner =
    documentPath === null
      ? null
      : owningDirectoryContext(
          documentPath,
          useContextStore.getState().contexts,
        );
  const result = pandocEmbedsImages(format)
    ? stageMarkdownImages(markdown, {
        contextRoot: owner === null ? null : contextRootOf(owner.path),
        documentPath,
        knownAssets,
      })
    : { images: [], ...rewriteImageTagsAsMarkdown(markdown), scoped: true };
  return { documentContextId: owner?.id, ...result };
}

/**
 * What to tell the user, or null when nothing was left out: the definite
 * count of images whose destination was refused, and why (issue 545); then
 * — issue 631 — the tags that had no source, the images the cap left out,
 * and the html fragments the policy could not read, whose images may be
 * missing (the policy does not know how many they held). One string: the
 * toast store shows one at a time, so a second toast would hide the first.
 */
export function imagePolicyNotice(
  {
    noSource,
    overCap,
    refused,
    scoped,
    unsupportedHtml,
  }: Pick<
    PandocImagePreparation,
    "noSource" | "overCap" | "refused" | "scoped" | "unsupportedHtml"
  >,
  locale: Locale,
): null | string {
  const notices: string[] = [];
  if (refused > 0) {
    notices.push(
      t(
        scoped ? "export.imagesLeftOut" : "export.imagesLeftOutUnscoped",
        locale,
        { count: String(refused) },
      ),
    );
  }
  if (noSource > 0) {
    notices.push(
      t("export.imagesNoSource", locale, { count: String(noSource) }),
    );
  }
  if (overCap > 0) {
    notices.push(
      t("export.imagesOverCap", locale, {
        count: String(overCap),
        max: String(MAX_STAGED_IMAGES),
      }),
    );
  }
  if (unsupportedHtml > 0) {
    notices.push(
      t("export.htmlNotRead", locale, { count: String(unsupportedHtml) }),
    );
  }
  return notices.length === 0 ? null : notices.join(" ");
}

/**
 * Would an embedding export of the saved note at `documentPath` have a
 * vault or folder to resolve its relative images in? The dialog asks this
 * before the export, by the same rule the export applies (issue 631): a
 * note no directory context holds — a lone file opened on its own — gets
 * every relative image refused, and hearing that only afterwards is late.
 */
export function hasEmbeddingContext(
  documentPath: string,
  contexts: readonly ContextInfo[],
): boolean {
  return owningDirectoryContext(documentPath, contexts) !== null;
}

/**
 * issue 545: the vault or folder context whose files an export of
 * `documentPath` may embed — the deepest directory context holding it, as
 * everywhere else in the app (§81, longest prefix). Never a `File` context:
 * a file opened on its own authorizes exactly that file. Not the tab's own
 * context: `openTab` backfills that id from whatever context was active, and
 * a wider one would let `../secret.png` climb past a folder the user opened
 * on purpose. This is the user-facing half of the rule; the backend
 * re-derives the boundary from canonical paths
 * (`ContextManager::owning_directory_root`).
 */
function owningDirectoryContext(
  documentPath: string,
  contexts: readonly ContextInfo[],
): ContextInfo | null {
  let best: ContextInfo | null = null;
  let bestLength = -1;
  for (const c of contexts) {
    if (c.contextType === "file") continue;
    // Windows: the root and the document may differ in drive-letter or
    // directory case and in separator (`C:\Vault` vs `c:/vault/…`), and are
    // still one tree — the same rule `relativeScope` applies (issue 631).
    const fold = hasDriveLetter(documentPath) || hasDriveLetter(c.path);
    const candidate = fold ? toPosixPath(documentPath) : documentPath;
    const root = fold ? toPosixPath(c.path) : c.path;
    if (!isUnderRoot(candidate, root, fold)) continue;
    const length = contextRootOf(root).length;
    if (length > bestLength) {
      best = c;
      bestLength = length;
    }
  }
  return best;
}
