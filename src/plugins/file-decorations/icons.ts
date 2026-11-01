// §395 spec 0074 D6 · §5.2 — the icons a plugin defines for its decorations. An SVG is sanitized by the
// sanitizer a rendered block's markup goes through (`sanitizePluginMarkup` — each layer trusts no
// earlier one), must then be ONE svg element with whitespace beside it, and is drawn as a one-colour
// mask: serialized, put into a `data:image/svg+xml,` URL with `encodeURIComponent`, and set as
// `mask-image` in a rule for a class the host names (`fd-icon-<n>`). The rules live in one style element
// with `data-baram-file-icons` in the document head; the row that draws an icon supplies the shared mask
// settings (size, position, repeat). The SVG never enters the DOM.
//
// What reaches the style text from a plugin: the percent-encoded URL alone, inside a double-quoted CSS
// string. `encodeURIComponent` leaves A–Z a–z 0–9 and - _ . ! ~ * ' ( ) as they are — none of them ends a
// double-quoted string, and `)` does not end a quoted `url("…")` — and encodes every other character, except that it throws a `URIError` on a lone surrogate instead of encoding it.
import { usePluginStore } from "../../stores/system/plugin";
import { sanitizePluginMarkup } from "../rendered/sanitize-markup";
import { MAX_FILE_ICONS } from "./limits";
import { SVG_ROOT_MESSAGE, TOO_MANY_ICONS_MESSAGE } from "./validate";

/** One defined icon: the class a row carries, and the rule that draws it. */
interface DefinedIcon {
  className: string;
  rule: string;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** HTML's whitespace — the only text allowed beside the root once sanitized. */
const WHITESPACE = /^[\t\n\f\r ]*$/u;

/** Each plugin's icons, by name. */
const icons = new Map<string, Map<string, DefinedIcon>>();
/** Mints class names: one per (plugin, name), kept across a redefinition. */
let minted = 0;
let sheet: HTMLStyleElement | null = null;

/** Tests only — forget every icon and remove the style element. */
export function __resetFileIcons(): void {
  icons.clear();
  minted = 0;
  sheet?.remove();
  sheet = null;
}

/**
 * Define or redefine icon `name` of `pluginId` from `svg`; the refusal's sentence, or `null`. The caller
 * judged `name` and the byte size (`iconCallProblem`). A redefinition keeps its class, so a row drawing
 * the icon does not re-render — only the rule's URL changes. Throws what the sanitizer throws, and a `URIError` for a lone surrogate in the SVG (a refusal sentence for it is the spec's to add).
 */
export function defineIcon(
  pluginId: string,
  name: string,
  svg: string,
): null | string {
  const own = icons.get(pluginId) ?? new Map<string, DefinedIcon>();
  const existing = own.get(name);
  if (existing === undefined && own.size >= MAX_FILE_ICONS) {
    return TOO_MANY_ICONS_MESSAGE;
  }
  const { fragment, removed } = sanitizePluginMarkup(svg);
  if (removed > 0 && usePluginStore.getState().devMode.active) {
    // §6 — developer mode (§379), as `prepareDrawable` logs a rendered block's removals; `console`
    // because `logger.info` is quiet outside a Vite dev build. A lower bound (`SanitizedMarkup.removed`).
    console.info(
      `[PluginFileIcon] ${pluginId} ${name}: the sanitizer removed at least ${removed}`,
    );
  }
  const root = onlySvgRoot(fragment);
  if (root === null) return SVG_ROOT_MESSAGE;
  const url = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
  const className = existing?.className ?? `fd-icon-${(minted += 1)}`;
  own.set(name, {
    className,
    rule: `.${className}{-webkit-mask-image:url("${url}");mask-image:url("${url}")}`,
  });
  icons.set(pluginId, own);
  writeSheet();
  return null;
}

/** The class that draws icon `name` of `pluginId`, or `undefined` when it is not defined. */
export function iconClassOf(
  pluginId: string,
  name: string,
): string | undefined {
  return icons.get(pluginId)?.get(name)?.className;
}

/** D15 — forget every icon of `pluginId` and take its rules out of the style element. */
export function releaseIcons(pluginId: string): void {
  if (icons.delete(pluginId)) writeSheet();
}

/** The fragment's one svg element, when everything else in it is whitespace text; otherwise `null`. */
function onlySvgRoot(fragment: DocumentFragment): Element | null {
  let root: Element | null = null;
  for (const node of Array.from(fragment.childNodes)) {
    if (
      node.nodeType === Node.TEXT_NODE &&
      WHITESPACE.test(node.textContent ?? "")
    ) {
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || root !== null) return null;
    const element = node as Element;
    if (element.localName !== "svg" || element.namespaceURI !== SVG_NAMESPACE) {
      return null;
    }
    root = element;
  }
  return root;
}

/** Rewrite the style element from every defined icon; remove it when none is left. Called only when an icon is defined or released (D9). */
function writeSheet(): void {
  const rules = [...icons.values()].flatMap((own) =>
    [...own.values()].map((icon) => icon.rule),
  );
  if (rules.length === 0) {
    sheet?.remove();
    sheet = null;
    return;
  }
  if (sheet === null) {
    sheet = document.createElement("style");
    sheet.setAttribute("data-baram-file-icons", "");
    document.head.append(sheet);
  }
  sheet.textContent = rules.join("\n");
}
