// §5.1 SVG utilities — canonical SVG sanitizer shared by the inline HTML block
// (raw `<svg>` markup) and the dedicated ```svg fenced block.
import DOMPurify from "dompurify";

/**
 * Inline HTML tags that may legitimately appear inside an SVG `<foreignObject>`
 * (HTML labels, e.g. Mermaid flowchart node text). DOMPurify's `svg` profile
 * strips HTML-namespaced elements, so they must be allow-listed explicitly.
 */
const SVG_FOREIGN_OBJECT_TAGS = [
  "foreignObject",
  "br",
  "div",
  "span",
  "p",
  "i",
  "b",
  "em",
  "strong",
  "code",
];

/**
 * Sanitize raw SVG markup for safe `dangerouslySetInnerHTML`.
 *
 * Uses DOMPurify's `svg` + `svgFilters` profiles so shapes, gradients, filters
 * (drop-shadow/blur), `<style>`, presentation attributes and inline `style`
 * survive — i.e. authored SVG renders with full visual fidelity. `<foreignObject>`
 * is treated as an HTML integration point so HTML-namespaced label content passes
 * the namespace check (see §5.5 Mermaid regression). `<script>`, event handlers
 * (`onload`/`onerror`/…) and `javascript:` URLs stay forbidden by the profile +
 * DOMPurify defaults.
 *
 * This is the single source of SVG sanitize truth: both the inline HTML block and
 * the dedicated SVG block render through it, as does {@link sanitizeMermaidSvg}.
 */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: SVG_FOREIGN_OBJECT_TAGS,
    // HTML_INTEGRATION_POINTS replaces (not merges) the default, so re-list the
    // built-in `annotation-xml` alongside `foreignobject`.
    HTML_INTEGRATION_POINTS: { "annotation-xml": true, foreignobject: true },
  });
}

/**
 * Leading whitespace/BOM (matched by `\s`), optional XML declaration, comments
 * and doctype before the root `<svg>` element.
 */
const SVG_ROOT_RE =
  /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype[\s\S]*?>\s*)?<svg[\s>]/i;

/** Copy raw SVG markup to the clipboard as text (web Clipboard API — works in WKWebView). */
export async function copySvgSource(svg: string): Promise<void> {
  await navigator.clipboard.writeText(svg);
}

/**
 * Heuristic: does this content represent a standalone SVG document (vs arbitrary
 * HTML)? Used by the HTML block to route raw `<svg>` markup through
 * {@link sanitizeSvg} for full fidelity, while keeping the stricter HTML config
 * for everything else.
 */
export function isSvgContent(content: string): boolean {
  return SVG_ROOT_RE.test(content) && /<\/svg\s*>/i.test(content);
}

/**
 * Determine the raster pixel size of an SVG. Prefers usable px width/height
 * attributes, falls back to the viewBox (so percentage-sized SVGs keep their
 * true aspect ratio), then a 800×600 default.
 */
export function svgDimensions(svgEl: SVGSVGElement): {
  height: number;
  width: number;
} {
  let width = lengthToPx(svgEl.getAttribute("width"));
  let height = lengthToPx(svgEl.getAttribute("height"));
  const viewBox = svgEl.getAttribute("viewBox");
  if ((!width || !height) && viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      width = width || parts[2];
      height = height || parts[3];
    }
  }
  return { width: width || 800, height: height || 600 };
}

/**
 * Rasterize SVG markup to a PNG blob (white background). Used by "download PNG".
 */
export async function svgToPngBlob(svgHtml: string, scale = 2): Promise<Blob> {
  const canvas = await rasterizeSvgToCanvas(svgHtml, scale);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not create PNG blob"));
    }, "image/png");
  });
}

/**
 * Rasterize SVG markup to raw RGBA pixels + dimensions. Used to build a Tauri
 * `Image` for the native clipboard (WKWebView blocks `navigator.clipboard`
 * image writes, so we go through the OS clipboard via the clipboard plugin).
 */
export async function svgToRgba(
  svgHtml: string,
  scale = 2,
): Promise<{ height: number; rgba: Uint8Array; width: number }> {
  const canvas = await rasterizeSvgToCanvas(svgHtml, scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    height: canvas.height,
    rgba: new Uint8Array(data),
    width: canvas.width,
  };
}

/**
 * Parse a length attribute (width/height) to pixels. Relative units
 * (`%`, `em`, `ex`, `auto`) can't be used as a raster pixel size, so they
 * return 0 — the caller then falls back to the viewBox. Without this,
 * `parseFloat("100%")` would wrongly yield 100 and squash a wide diagram.
 */
function lengthToPx(value: null | string): number {
  if (!value) return 0;
  const s = value.trim();
  if (/%|e[mx]$|^auto$/i.test(s)) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Presentation properties that decide how SVG geometry/text paints. */
const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "marker-start",
  "marker-mid",
  "marker-end",
];

/**
 * Ensure the root `<svg>` declares the SVG namespace, injected into the STRING
 * before any parse. Adding `xmlns` *after* parsing an xmlns-less SVG as
 * `image/svg+xml` leaves children in the null namespace, which the serializer
 * then writes as `xmlns=""` on every child — and WebKit paints none of them,
 * producing a blank PNG. Injecting it into the markup keeps all elements in the
 * SVG namespace. Already-namespaced SVGs are returned unchanged.
 */
export function ensureRootSvgNamespace(markup: string): string {
  if (/<svg[^>]*\sxmlns\s*=/i.test(markup)) return markup;
  return markup.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

/**
 * Resolve an SVG's `<style>`/`var()`/class/inherited styling into inline
 * presentation styles by mounting it in the live document and reading
 * `getComputedStyle` for each element. The result renders identically when
 * later loaded via `<img>` (which can't resolve those on its own). Falls back
 * to the original markup if anything is unavailable (e.g. no DOM).
 */
function flattenSvgStyles(markup: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function")
    return markup;

  const host = document.createElement("div");
  // Off-screen ONLY — no visibility:hidden / opacity:0 / display:none, since
  // getComputedStyle would then report those and we'd bake them into every
  // element, hiding the whole SVG in the raster.
  host.style.cssText = "position:fixed;left:-99999px;top:0;";
  host.innerHTML = markup;
  const svg = host.querySelector("svg");
  if (!svg) return markup;

  document.body.appendChild(host);
  try {
    const els = [svg, ...Array.from(svg.querySelectorAll("*"))];
    for (const el of els) {
      if (el.tagName.toLowerCase() === "style") continue;
      const cs = getComputedStyle(el);
      const parts: string[] = [];
      for (const prop of STYLE_PROPS) {
        const value = cs.getPropertyValue(prop);
        if (value && value !== "normal" && value !== "auto") {
          parts.push(`${prop}:${value}`);
        }
      }
      if (parts.length) {
        const existing = el.getAttribute("style");
        el.setAttribute(
          "style",
          parts.join(";") + (existing ? ";" + existing : ""),
        );
      }
    }
    // <style> (and its now-redundant var() definitions) is dropped — its rules
    // are baked into the inline styles above and var() breaks under <img>.
    svg.querySelectorAll("style").forEach((s) => s.remove());
    return svg.outerHTML;
  } catch {
    return markup;
  } finally {
    host.remove();
  }
}

/** Only SVGs that lean on a <style> block or CSS custom properties need flattening. */
function needsStyleFlatten(markup: string): boolean {
  return /<style[\s>]/i.test(markup) || /var\(/.test(markup);
}

/**
 * Rasterize SVG markup onto an offscreen canvas with a white background. Scales
 * by devicePixelRatio × `scale` for crisp output. Shared by the PNG blob and
 * RGBA extractors below.
 */
async function rasterizeSvgToCanvas(
  svgHtml: string,
  scale = 2,
): Promise<HTMLCanvasElement> {
  // An <img>-loaded SVG is an isolated document: its <style> rules apply but CSS
  // custom properties (var()) and inherited/page styles do NOT resolve, so a
  // diagram coloured via `var(--x)` / classes rasterizes nearly blank. Flatten
  // those to inline presentation styles (computed in the live document, which is
  // why the editor's inline render looks correct) before handing it to <img>.
  const prepared = ensureRootSvgNamespace(
    needsStyleFlatten(svgHtml) ? flattenSvgStyles(svgHtml) : svgHtml,
  );
  const svgEl = new DOMParser()
    .parseFromString(prepared, "image/svg+xml")
    .querySelector("svg");
  if (!svgEl) throw new Error("No <svg> element found");

  const { width, height } = svgDimensions(svgEl as SVGSVGElement);
  svgEl.setAttribute("width", String(width));
  svgEl.setAttribute("height", String(height));

  // Cap the pixel ratio at 2 so a hi-DPI display doesn't 4× the raster (a large
  // raw RGBA buffer is slow to ship over IPC for the native clipboard).
  const factor = Math.min(window.devicePixelRatio || 1, 2) * scale;
  const canvasW = Math.ceil(width * factor);
  const canvasH = Math.ceil(height * factor);

  const svgString = new XMLSerializer().serializeToString(svgEl);
  // WKWebView can't decode an SVG served from a blob: URL into <img>; a data:
  // URL works reliably. encodeURIComponent keeps Unicode/# characters safe.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

  return await new Promise<HTMLCanvasElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Could not get canvas context"));
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.drawImage(img, 0, 0, canvasW, canvasH);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error("SVG rendering failed"));
    img.src = url;
  });
}
