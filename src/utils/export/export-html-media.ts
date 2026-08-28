// §5.12 HTML Export — media src resolution and the link/text stand-ins for
// what an export cannot play: image data URIs, video paths, provider embeds,
// and the shared hover/resize/caption chrome every media node view carries.

import { activeFileDir } from "../active-file-dir";
import { isRemoteOrData } from "../media-src";
import { relativeToRoot } from "../path-utils";

const ASSET_URL_PREFIXES = [
  "http://asset.localhost/",
  "https://asset.localhost/",
  "asset://localhost/",
];

/** Convert Tauri asset URLs on cloned `<img>` elements to base64 data URIs. */
export async function convertImagesToDataURIs(
  clone: HTMLElement,
  dom: HTMLElement,
): Promise<void> {
  const imgPromises: Promise<void>[] = [];
  for (const img of clone.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (
      src.startsWith("http://asset.localhost/") ||
      src.startsWith("https://asset.localhost/") ||
      src.startsWith("asset://localhost/")
    ) {
      const originalImg = dom.querySelector(
        `img[src="${CSS.escape(src)}"]`,
      ) as HTMLImageElement | null;
      const fetchUrl = originalImg?.src || src;
      imgPromises.push(
        imageToDataURI(fetchUrl).then((dataUri) => {
          img.setAttribute("src", dataUri);
        }),
      );
    }
  }
  await Promise.all(imgPromises);
}

/**
 * Videos: asset URL을 상대경로로 되돌린다 ────────────────────────
 * 50MB를 base64로 인라인하지 않는다 (§294). 내보낸 HTML은 동영상 파일이 함께
 * 이동해야 재생된다.
 *
 * ‼️ convertFileSrc는 플랫폼마다 다른 형태를 낸다: macOS/Linux는
 * `asset://localhost/…`, Windows는 `http(s)://asset.localhost/…`. 공통
 * 부분문자열 "asset.localhost/"로는 macOS/Linux 형태를 못 잡는다 — 그
 * 스킴은 "asset:" + "//" + "localhost/"라 "asset"과 "localhost" 사이에
 * 점(.)이 없다. 세 접두사를 각각 확인한다.
 */
export function resolveVideoSources(clone: HTMLElement, forPdf: boolean): void {
  for (const el of clone.querySelectorAll("video[src]")) {
    const src = el.getAttribute("src") || "";
    const prefix = ASSET_URL_PREFIXES.find((p) => src.startsWith(p));
    if (prefix) {
      const abs = decodeURIComponent(src.slice(prefix.length)).split("#")[0];
      // Relative to the exported document's own directory when the file is
      // under it — `assets/clip.mp4` stays `assets/clip.mp4`, and a nested
      // `media/sub/clip.mp4` keeps its full relative form, not just its
      // basename (an earlier version threw the folder away here entirely).
      // An out-of-tree absolute path (the user typed one elsewhere, or there
      // is no active document) is left absolute rather than reduced to a
      // basename — an absolute path still resolves on this machine, while a
      // bare basename resolves nowhere.
      const baseDir = activeFileDir();
      const relative = baseDir ? relativeToRoot(abs, baseDir) : null;
      el.setAttribute("src", relative ?? abs);
    } else if (src.includes("#")) {
      // §294 fix (M4 nit): a remote (non-asset) video keeps the
      // poster-forcing `#t=0.1` fragment (video-view.tsx) unless stripped
      // here too. Harmless for HTML playback, but for PDF export below this
      // becomes the LINK'S VISIBLE TEXT, so an untouched remote clip would
      // read "https://…/clip.mp4#t=0.1" instead of the clean URL.
      el.setAttribute("src", src.split("#")[0]);
    }
    el.removeAttribute("preload");

    // §294/§301 fix (I4): the exported `<video>` had no play affordance in
    // either destination. HTML can actually play it (`controls`); PDF cannot
    // play anything, so §301 calls for a plain link instead — no poster
    // frame pretending playback might happen.
    //
    // §301 ruling (round 3): in PDF, a LOCAL file gets plain text rather than
    // an anchor. Its href can only ever be document-relative, and Chrome
    // resolves that against the print-time base URL — the temp file
    // `generate_pdf` writes and then deletes (src-tauri/src/export/mod.rs:116
    // and :213). So the annotation points into a directory that is gone before
    // anyone can click it: the link invites a click and silently does nothing,
    // which is exactly what the user reported. Plain text is honest about what
    // the reader can actually do. A REMOTE src keeps its anchor — that one is
    // absolute and demonstrably works (the annotation is emitted; see
    // test_generate_pdf_emits_link_annotations).
    //
    // `isRemoteOrData` is the shared answer to "is this ours to resolve?"
    // (utils/media-src.ts), reused rather than re-spelled here — a second
    // predicate for the same question is how the two sides drift apart.
    if (forPdf) {
      const src = el.getAttribute("src") || "";
      if (isRemoteOrData(src)) {
        replaceWithExportLink(el, src, true);
      } else {
        replaceWithExportText(el, src);
      }
    } else {
      el.setAttribute("controls", "");
    }
  }
}

/**
 * §294 fix (I4) / §301: a provider embed exports as a LINK in BOTH
 * destinations, whichever of its two live shapes the document happens to be
 * showing — the idle `.video-embed-card` ("Click to load from …") or the
 * `.video-embed-frame` iframe that replaces it once the reader clicks play.
 * The link points at the ORIGINAL src the document carried
 * (`data-video-src`, set by video-view.tsx on both shapes), not the
 * constructed nocookie iframe URL that only exists to be embedded.
 *
 * ‼️ The frame used to be exempted for HTML export, on the claim that it is
 * "self-contained and plays fine when the exported file is opened in a
 * browser". Two things are wrong with that:
 *   1. It is state-dependent. Whether the reader had clicked play before
 *      choosing Export decided whether the .html got a player or a link —
 *      same document, same command, two different files. Nothing about the
 *      document says which one it should be.
 *   2. It is false for the destination that matters. An exported .html is
 *      opened by double-clicking it, so the page origin is `file://`/null;
 *      a provider's embed player routinely refuses that origin and paints
 *      its (black) shell instead of the video. And export-html-styles.ts
 *      carries no `.video-embed-frame` rule — every rule for it in
 *      styles/editor/video.css is `.tiptap`-scoped and the export wrapper is
 *      `article.baram-export` — so the surviving iframe rendered at the UA
 *      default 300x150 rather than 100%-wide 16:9. A dead player at the
 *      wrong size is worse than the URL it came from.
 */
export function resolveVideoEmbeds(clone: HTMLElement, forPdf: boolean): void {
  for (const el of clone.querySelectorAll(
    ".video-embed-card, .video-embed-frame",
  )) {
    replaceWithExportLink(el, el.getAttribute("data-video-src") || "", forPdf);
  }
}

/**
 * Shared media chrome (SVG/Mermaid/image): drop hover toolbar + edge-drag
 * resize handles + the drag % readout.
 *
 * §294 fix (I4/M4, dev/backlog.md 2026-08-22): one shared class covers every
 * media kind's in-progress caption edit — video had no equivalent to image's
 * dedicated input class, so exporting mid-caption-edit leaked a raw `<input>`
 * for video specifically. media-block.css's `.media-caption-input` is used
 * directly by image-view.tsx and video-view.tsx, and BlockCaption.tsx (SVG
 * §5.1 / Mermaid §5.5) now carries it too alongside its own
 * `block-caption-input` — so this one loop closes the gap for every media
 * kind instead of growing a selector list here each time a new one ships.
 *
 * ‼️ Must run AFTER `resolveVideoSources`/`resolveVideoEmbeds`: those read a
 * caption's `textContent` to decide whether to link the caption or the raw
 * URL, and a mid-edit caption's text lives in an `<input value>`, not in
 * `textContent`, until this pass turns it into a plain span. Reordering this
 * ahead of them would make `captionText.trim()` truthy there and silently
 * drop the URL line from a mid-edit caption's PDF export.
 */
export function stripMediaChrome(clone: HTMLElement): void {
  for (const el of clone.querySelectorAll(".media-toolbar")) el.remove();
  for (const el of clone.querySelectorAll(".media-resize-handle")) el.remove();
  for (const el of clone.querySelectorAll(".media-resize-label")) el.remove();
  for (const el of clone.querySelectorAll(".media-caption-input")) {
    const text = (el as HTMLInputElement).value;
    if (text) {
      const span = document.createElement("span");
      span.textContent = text;
      el.replaceWith(span);
    } else {
      el.remove();
    }
  }
  for (const el of clone.querySelectorAll(".image-caption-placeholder")) {
    if (!(el as HTMLElement).textContent?.trim()) el.remove();
  }
}

/**
 * This element's own caption, or null.
 *
 * ‼️ Scoped through `closest("figure.video-figure")`: a document-wide lookup
 * would hand every video the FIRST figcaption in the document, and every
 * single-video test would still pass, because in a one-video document the
 * first figcaption is the right one.
 */
function captionFor(el: Element): Element | null {
  return (
    el
      .closest("figure.video-figure")
      ?.querySelector("figcaption.video-caption") ?? null
  );
}

/** Convert an image URL to a base64 data URI */
async function imageToDataURI(src: string): Promise<string> {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return src; // fallback to original URL
  }
}

/**
 * Replace one media element with the export's link stand-in.
 *
 * §301 ruling (export-defect round, 2026-08-22): when the node HAS a caption,
 * **the caption becomes the link** and no separate URL line is emitted. The
 * `figcaption` already prints right below, so a URL line above it is pure
 * redundancy — and that redundancy is exactly what a user read as "the PDF
 * only shows source code" (the printed path/URL is character-for-character the
 * inside of the markdown's parentheses). For a local file the URL is a *dead*
 * link in a PDF besides: the href is document-relative while the print-time
 * base URL is a temp file that `generate_pdf` deletes on return
 * (src-tauri/src/export/mod.rs:116 and :213), so it costs a line and returns
 * nothing. Making that href absolute instead was rejected — it would resolve
 * on the exporting machine only, and it leaks `/Users/<name>/…` into a
 * document meant to be shared.
 *
 * An UNCAPTIONED node keeps the URL as its visible text: with no caption there
 * is nothing else left to say a video was ever here.
 *
 * ‼️ The tradeoff, recorded so it can be reversed knowingly rather than
 * rediscovered: on PAPER a hyperlink is invisible, so a printed provider embed
 * loses its `https://youtu.be/…` entirely under this rule. The alternative was
 * to keep URL text for provider embeds and caption text for local files; it
 * was rejected because it leaves the two shapes inconsistent, and a Baram PDF
 * is read on screen far more often than it is printed. Reverse this if that
 * ever stops being true.
 *
 * ‼️ `useCaption` is **PDF only**, and that scope is load-bearing. An earlier
 * round applied caption-as-link to HTML export too, reasoning that the ruling
 * was destination-independent. The user re-exported and read the result as
 * "the YouTube embed vanished entirely, only the caption is left" — which is
 * the honest reading: in HTML the caption-link collapses a 16:9 embed to one
 * line whose text is the caption that was already there, so nothing on the
 * page says a video was there or where it pointed. Their own prescription
 * ("just make it a clickable link") describes the pre-extension HTML output
 * exactly: a visible, clickable `https://youtu.be/…`.
 *
 * The asymmetry is deliberate and each half is justified by its destination.
 * HTML: the URL is live and identifies the target, so show it. PDF: the ruling
 * judged the URL line redundant against the caption printed right below it,
 * and it is also the destination where a document-relative href cannot resolve
 * at all (see the note above), so there is less to lose by hiding it.
 */
function replaceWithExportLink(
  el: Element,
  href: string,
  useCaption: boolean,
): void {
  const link = document.createElement("a");
  link.className = "video-export-link";
  link.href = href;

  const caption = captionFor(el);
  const captionText = caption?.textContent ?? "";

  // ‼️ An in-progress caption edit keeps its text in an `<input value>`, not in
  // textContent, so it reads as empty here and falls back to the URL — the
  // pre-ruling shape. That input is normalized to a plain span by a later
  // pass (`stripMediaChrome`), so exporting mid-edit still prints the
  // caption; it just prints the URL line above it too.
  if (useCaption && caption && captionText.trim()) {
    link.textContent = captionText;
    caption.textContent = "";
    caption.appendChild(link);
    el.remove();
    return;
  }

  link.textContent = href;
  el.replaceWith(link);
}

/**
 * Replace a media element with plain, unlinked text — for the PDF case where no
 * href could resolve (see the call site for why a local file has none).
 *
 * When the node HAS a caption, nothing is emitted at all: the `figcaption`
 * right below already prints that text, and printing it twice is the exact
 * redundancy the §301 ruling removed. When it has none, the path is emitted, so
 * a video never vanishes from the page without a trace.
 *
 * A `<span>`, not an `<a>`: it must not look clickable, because it is not. It
 * carries `.video-export-path` purely for the wrapping behaviour a long path
 * needs (export-html-styles.ts) — no colour and no underline, so it reads as
 * body text, which is the honest signal.
 */
function replaceWithExportText(el: Element, path: string): void {
  if (captionFor(el)?.textContent?.trim()) {
    el.remove();
    return;
  }
  const span = document.createElement("span");
  span.className = "video-export-path";
  span.textContent = path;
  el.replaceWith(span);
}
