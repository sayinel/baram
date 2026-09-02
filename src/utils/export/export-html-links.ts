// issue 499 — the export's last word on every anchor.
//
// Runs immediately before the clone is read out, AFTER every pass that can
// create or rewrite an anchor. The link mark's renderer already withheld a
// refused href in the editor DOM, but `resolveVideoSources` builds a brand-new
// `<a href>` for a remote/data video during the PDF capture, and an authored
// HTML block carries whatever its sanitizer let through. A scrub placed right
// after `cloneNode` would run before the first and have to trust the second.
// The ORDER is the contract; export-link-policy.test.tsx pins it with a
// `data:` video whose anchor only exists after the media pass.
import { isAllowedLinkHref } from "../link-href";

const XLINK_NS = "http://www.w3.org/1999/xlink";

/**
 * Remove the `href` — HTML, and SVG `xlink:href` — of every anchor whose
 * destination the link policy refuses, and every anchor's `data-href` (the
 * editor's inert carrier for a refused destination, see Link.renderHTML —
 * useful for the clipboard, meaningless in a file that leaves the app). The
 * anchor and its text stay.
 */
export function stripDisallowedLinkHrefs(root: ParentNode): void {
  for (const anchor of root.querySelectorAll("a")) {
    if (
      anchor.hasAttribute("href") &&
      !isAllowedLinkHref(anchor.getAttribute("href"))
    ) {
      anchor.removeAttribute("href");
    }
    anchor.removeAttribute("data-href");
    const xlink = anchor.getAttributeNS(XLINK_NS, "href");
    if (xlink !== null && !isAllowedLinkHref(xlink)) {
      anchor.removeAttributeNS(XLINK_NS, "href");
    }
  }
}
