import { openUrl } from "@tauri-apps/plugin-opener";

// §5.1 Link Mark Extension — [text](url)
import { InputRule, Mark, markPasteRule, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { isAllowedLinkHref } from "../../utils/link-href";
import { logger } from "../../utils/logger";
import { syntaxRevealKey } from "../plugins/syntax-reveal";
import { parseRevealResource } from "../plugins/syntax-reveal-resource-codec";

export interface LinkOptions {
  autolink: boolean;
  HTMLAttributes: Record<string, string>;
  /**
   * §278.1 Navigate a scheme-less href in the app. Returns whether it did:
   * `false` hands the href to the OS opener instead.
   *
   * ‼️ The return value exists because this extension cannot answer the only
   * question that separates `[x](Paper.pdf)` from `[x](www.example.com)` —
   * "is there a file at that path?". The file tree lives in the store layer,
   * so the decision belongs there and this extension only routes.
   */
  onNavigateLocal: (href: string) => boolean;
  openOnClick: boolean;
}

/** scheme: http, mailto, tel, … — an address for the OS, never a file path. */
function hasUriScheme(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    link: {
      setLink: (attributes: {
        href: string;
        target?: string;
        title?: string;
      }) => ReturnType;
      toggleLink: (attributes: {
        href: string;
        target?: string;
        title?: string;
      }) => ReturnType;
      unsetLink: () => ReturnType;
    };
  }
}

// [text](url) or [text](url "title") — typed inline → auto-convert to link
// Negative lookbehind for ! to exclude image syntax
// Supports: [text](url), [text](url "title"), [text](<url with spaces>), [text](url with spaces)
const linkInputRegex =
  /(?<!!)\[([^\]]+)\]\((<[^>]+>|[^)]+?)(?:\s+"([^"]*)")?\)$/;

// Auto-detect URLs on paste
const pasteRegex =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;

export const Link = Mark.create<LinkOptions>({
  name: "link",
  inclusive: false, // §7.2: typing at link end goes outside link
  priority: 1000,

  addOptions() {
    return {
      HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
      openOnClick: true,
      autolink: true,
      onNavigateLocal: () => false,
    };
  },

  addAttributes() {
    return {
      href: {
        default: null,
        // issue 499: a refused destination is rendered as `data-href` (see
        // renderHTML), so its clipboard HTML — an internal cut and paste, or
        // a copy pasted back later — recreates the same mark instead of
        // silently dropping the link.
        parseHTML: (element) =>
          element.getAttribute("href") ?? element.getAttribute("data-href"),
      },
      title: { default: null },
      target: { default: null },
    };
  },

  parseHTML() {
    // issue 499: pasted/imported HTML has no roundtrip obligation, so a live
    // `href` outside the policy does not become a mark at all — the text
    // stays, the link does not. The policy sees the DECODED attribute (the
    // HTML parser has already resolved `&#x09;`-style entities), which is
    // why this is a function and not the old `:not([href *= 'javascript:'])`
    // substring selector that `java\tscript:` slipped past. `false` rejects
    // the rule; `null` accepts it with the attrs from addAttributes.
    //
    // An anchor with `data-href` and no `href` is our own inert rendering of
    // a refused destination (or foreign markup shaped like it). It is
    // accepted into the model — where it renders inert again — because
    // refusing it would turn every cut-and-paste of such a link into plain
    // text and lose it from the saved file.
    return [
      {
        tag: "a[href], a[data-href]",
        getAttrs: (element) => {
          if (typeof element === "string") return false;
          if (!element.hasAttribute("href")) return null;
          return isAllowedLinkHref(element.getAttribute("href")) ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
    // issue 499: the mark keeps whatever the file said — only the wire is
    // cut. Classify the FINAL merged href, not the mark's own: a configured
    // `options.HTMLAttributes.href` would otherwise merge back in behind the
    // check. This covers the editor DOM, clipboard HTML and (the export
    // clones the editor DOM) HTML/PDF export.
    //
    // The destination moves to `data-href`: inert to the browser, readable
    // by parseHTML so the clipboard round-trips, and a hook for CSS to show
    // the link as dead (`a[data-href]`). The export's final scrub strips it,
    // so a refused destination never leaves the app in any attribute.
    if (!isAllowedLinkHref(attrs.href)) {
      attrs["data-href"] = attrs.href;
      delete attrs.href;
    }
    return ["a", attrs, 0];
  },

  addCommands() {
    return {
      setLink:
        (attributes) =>
        ({ commands }) =>
          commands.setMark(this.name, attributes),
      toggleLink:
        (attributes) =>
        ({ commands }) => {
          if (this.editor.isActive(this.name)) {
            return commands.unsetMark(this.name);
          }
          return commands.setMark(this.name, attributes);
        },
      unsetLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: linkInputRegex,
        handler: ({ state, range, match }) => {
          const [, text, rawHref, title] = match;
          // Strip angle brackets from <url with spaces> syntax
          const href =
            rawHref.startsWith("<") && rawHref.endsWith(">")
              ? rawHref.slice(1, -1)
              : rawHref;
          const { tr } = state;
          const mark = this.type.create({ href, title: title || null });
          tr.replaceWith(range.from, range.to, state.schema.text(text, [mark]));
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: pasteRegex,
        type: this.type,
        getAttributes: (match) => ({ href: match[0] }),
      }),
    ];
  },

  addProseMirrorPlugins() {
    const { onNavigateLocal } = this.options;

    const navigateHref = (href: string) => {
      // issue 499: a DOM anchor or the expanded reveal text is content, not
      // trust — decide from the destination itself, every strategy alike.
      if (!isAllowedLinkHref(href)) {
        logger.warn("link: destination outside the link policy, not opened", {
          href,
        });
        return;
      }
      // A fragment addresses this very document — never the OS, whether or not
      // the app layer knows what to do with it.
      if (href.startsWith("#")) {
        onNavigateLocal(href);
        return;
      }
      if (!hasUriScheme(href) && onNavigateLocal(href)) return;
      openUrl(href).catch((e) => logger.error(e));
    };

    return [
      new Plugin({
        key: new PluginKey("linkClick"),
        props: {
          handleDOMEvents: {
            // Intercept at mousedown — before ProseMirror moves cursor,
            // so SyntaxReveal doesn't expand the link into edit mode.
            mousedown(view, event) {
              if (!(event.metaKey || event.ctrlKey)) return false;

              const target = event.target as HTMLElement;

              // Strategy 1: DOM — find <a> tag (link rendered normally)
              const anchor = target.closest("a");
              if (anchor) {
                const href = anchor.getAttribute("href");
                if (href) {
                  event.preventDefault();
                  navigateHref(href);
                  return true;
                }
              }

              // Strategy 2: ProseMirror marks — resolve pos from DOM coords
              const coords = { left: event.clientX, top: event.clientY };
              const posResult = view.posAtCoords(coords);
              if (posResult) {
                const { pos } = posResult;
                const $pos = view.state.doc.resolve(pos);

                let linkMark = $pos.marks().find((m) => m.type.name === "link");
                if (!linkMark && $pos.textOffset === 0) {
                  const nodeAfter = $pos.parent.maybeChild(
                    $pos.index($pos.depth),
                  );
                  if (nodeAfter) {
                    linkMark = nodeAfter.marks.find(
                      (m) => m.type.name === "link",
                    );
                  }
                }
                if (!linkMark && pos > 0) {
                  linkMark = view.state.doc
                    .resolve(pos - 1)
                    .marks()
                    .find((m) => m.type.name === "link");
                }

                if (linkMark) {
                  const href = linkMark.attrs.href as string;
                  if (href) {
                    event.preventDefault();
                    navigateHref(href);
                    return true;
                  }
                }
              }

              // Strategy 3: SyntaxReveal expanded link — text is [text](url)
              //
              // §384 fix (B2): route through the shared reveal codec instead
              // of a hand-rolled regex. Once expansion started emitting the
              // angle-bracket form for a destination with escaped `<`/`>`
              // (e.g. href="a < b" → `[x](<a \< b>)`), the old regex's angle
              // branch (`<([^>]+)>`) captured the escape backslash literally
              // — navigating to "a \< b" instead of "a < b". parseRevealResource
              // unescapes it the same way collapse does.
              const srState = syntaxRevealKey.getState(view.state);
              if (srState?.expanded?.kind === "link") {
                const { from, to, labelEnd } = srState.expanded;
                const expandedText = view.state.doc.textBetween(from, to);
                // §384 fix (F1 round 2): pass the stashed, mapped boundary
                // (relative to expandedText) so the split is resolved exactly
                // — see ExpandedRange.labelEnd.
                // §384 (design review M2): missing stash falls back to the
                // LIVE label grammar, not strict — see
                // syntax-reveal-collapse.ts's link branch.
                const href = parseRevealResource(
                  expandedText,
                  labelEnd !== undefined
                    ? { labelEnd: labelEnd - from }
                    : { labelGrammar: "live" },
                )?.destination;
                if (href) {
                  event.preventDefault();
                  // §384 fix (R3-2): NOT `href.trim()` — Strategy 1 (rendered
                  // `<a>`) and Strategy 2 (ProseMirror mark) both navigate the
                  // href verbatim, so a destination with leading/trailing
                  // whitespace (a real, if unusual, href — e.g. `" a](b"`)
                  // must navigate identically regardless of WHICH strategy
                  // caught the click. Trimming only here made Strategy 3 the
                  // odd one out: the exact same expanded link would navigate
                  // to a DIFFERENT destination depending on click timing.
                  navigateHref(href);
                  return true;
                }
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});
