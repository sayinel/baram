// §5.12 export — KaTeX's fonts, embedded in the exported document.
//
// Why (measured, 2026-08-23): the export ships `katex.min.css` verbatim, and
// every `@font-face` in it points at `fonts/KaTeX_*.woff2` RELATIVE to the
// stylesheet. In an exported file there is no `fonts/` directory — the .html
// the user saves sits alone, and the PDF path renders from a temp directory
// `generate_pdf` deletes on return (src-tauri/src/export/mod.rs). So every
// KaTeX face fell back to a system font.
//
// That is not a subtle difference. Printed side by side, the fallback renders
// `\Sigma` at text size instead of as a display-size operator (KaTeX_Size2
// never loads, so the glyph cannot grow), and `\int`'s limits sit beside the
// sign rather than hugging it. The formula is readable and visibly wrong.
//
// The fonts are therefore inlined as data URIs. ~296KB of woff2 becomes ~395KB
// of base64 in the exported file, and the same bytes join the export chunk —
// which App.tsx already loads lazily (`lazy(() => import("./components/export/
// ExportDialog"))`), so nothing reaches the app's startup path.
//
// Only woff2 is embedded. The woff and TrueType alternates in KaTeX's src lists
// exist for browsers that predate woff2; the only two engines that ever open a
// Baram export are Chrome (which prints the PDF) and whatever the reader uses
// today. Carrying all three would triple the cost for nobody.

import amsRegular from "katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline";
import caligraphicBold from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline";
import caligraphicRegular from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline";
import frakturBold from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline";
import frakturRegular from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline";
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.woff2?inline";
import mainBoldItalic from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline";
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.woff2?inline";
import mainRegular from "katex/dist/fonts/KaTeX_Main-Regular.woff2?inline";
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline";
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.woff2?inline";
import sansSerifBold from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline";
import sansSerifItalic from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline";
import sansSerifRegular from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline";
import scriptRegular from "katex/dist/fonts/KaTeX_Script-Regular.woff2?inline";
import size1Regular from "katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline";
import size2Regular from "katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline";
import size3Regular from "katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline";
import size4Regular from "katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline";
import typewriterRegular from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline";

/** file stem → data URI, keyed exactly as katex.min.css spells it. */
const FONT_DATA_URIS: Record<string, string> = {
  "KaTeX_AMS-Regular": amsRegular,
  "KaTeX_Caligraphic-Bold": caligraphicBold,
  "KaTeX_Caligraphic-Regular": caligraphicRegular,
  "KaTeX_Fraktur-Bold": frakturBold,
  "KaTeX_Fraktur-Regular": frakturRegular,
  "KaTeX_Main-Bold": mainBold,
  "KaTeX_Main-BoldItalic": mainBoldItalic,
  "KaTeX_Main-Italic": mainItalic,
  "KaTeX_Main-Regular": mainRegular,
  "KaTeX_Math-BoldItalic": mathBoldItalic,
  "KaTeX_Math-Italic": mathItalic,
  "KaTeX_SansSerif-Bold": sansSerifBold,
  "KaTeX_SansSerif-Italic": sansSerifItalic,
  "KaTeX_SansSerif-Regular": sansSerifRegular,
  "KaTeX_Script-Regular": scriptRegular,
  "KaTeX_Size1-Regular": size1Regular,
  "KaTeX_Size2-Regular": size2Regular,
  "KaTeX_Size3-Regular": size3Regular,
  "KaTeX_Size4-Regular": size4Regular,
  "KaTeX_Typewriter-Regular": typewriterRegular,
};

/** `,url(fonts/X.woff) format("woff")` and its TrueType sibling. */
const LEGACY_SRC_RE =
  /,\s*url\(\s*(?:"|')?fonts\/[^)"']+\.(?:woff|ttf)(?:"|')?\s*\)\s*format\(\s*(?:"|')[^"']+(?:"|')\s*\)/gi;

/** `url(fonts/X.woff2)`, however KaTeX happens to quote it. */
const WOFF2_URL_RE = /url\(\s*(?:"|')?fonts\/([^)"']+)\.woff2(?:"|')?\s*\)/gi;

/**
 * Rewrite KaTeX's stylesheet so its faces load from embedded data URIs.
 *
 * Takes the stylesheet as an argument rather than importing it, so a test can
 * hand it a fixture and so there is exactly one `?raw` import of katex.min.css
 * in the codebase.
 *
 * An unknown font name is left pointing at its relative URL rather than
 * silently dropped: a broken reference is visible to anyone who looks, and
 * `exportedKatexCSS` is guarded by a test asserting none remain.
 */
export function inlineKatexFonts(css: string): string {
  return css
    .replace(LEGACY_SRC_RE, "")
    .replace(WOFF2_URL_RE, (whole, name: string) => {
      const uri = FONT_DATA_URIS[name];
      return uri ? `url("${uri}")` : whole;
    });
}
