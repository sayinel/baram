import { openUrl } from "@tauri-apps/plugin-opener";

// §5.1 Link Mark Extension — [text](url)
import { InputRule, Mark, markPasteRule, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

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
      href: { default: null },
      title: { default: null },
      target: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "a[href]:not([href *= 'javascript:' i])" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
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
                const href = parseRevealResource(
                  expandedText,
                  labelEnd !== undefined
                    ? { labelEnd: labelEnd - from }
                    : undefined,
                )?.destination;
                if (href) {
                  event.preventDefault();
                  navigateHref(href.trim());
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
