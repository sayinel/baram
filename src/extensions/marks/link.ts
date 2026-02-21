// §5.1 Link Mark Extension — [text](url)
import { Mark, mergeAttributes, markPasteRule, InputRule } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface LinkOptions {
  HTMLAttributes: Record<string, string>;
  openOnClick: boolean;
  autolink: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    link: {
      setLink: (attributes: { href: string; title?: string; target?: string }) => ReturnType;
      toggleLink: (attributes: { href: string; title?: string; target?: string }) => ReturnType;
      unsetLink: () => ReturnType;
    };
  }
}

// [text](url) or [text](url "title") — typed inline → auto-convert to link
// Negative lookbehind for ! to exclude image syntax
const linkInputRegex = /(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/;

// Auto-detect URLs on paste
const pasteRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;

export const Link = Mark.create<LinkOptions>({
  name: "link",
  inclusive: false, // §7.2: typing at link end goes outside link
  priority: 1000,

  addOptions() {
    return {
      HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
      openOnClick: true,
      autolink: true,
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

  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        // TODO: Open link editing dialog (M4 UI framework)
        return true;
      },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: linkInputRegex,
        handler: ({ state, range, match }) => {
          const [, text, href, title] = match;
          const { tr } = state;
          const mark = this.type.create({ href, title: title || null });
          tr.replaceWith(
            range.from,
            range.to,
            state.schema.text(text, [mark]),
          );
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
    return [
      new Plugin({
        key: new PluginKey("linkClick"),
        props: {
          handleClick(view, pos, event) {
            // Cmd+Click (Mac) or Ctrl+Click (Win/Linux) to open link
            if (!(event.metaKey || event.ctrlKey)) return false;

            // Strategy 1: DOM — find <a> tag (works when link is rendered)
            const target = event.target as HTMLElement;
            const anchor = target.closest("a");
            if (anchor) {
              const href = anchor.getAttribute("href");
              if (href) {
                event.preventDefault();
                openUrl(href).catch(console.error);
                return true;
              }
            }

            // Strategy 2: ProseMirror marks — works when SyntaxReveal
            // has expanded link to plain text (no <a> in DOM)
            const $pos = view.state.doc.resolve(pos);

            // Check marks at position (covers most cases)
            let linkMark = $pos.marks().find((m) => m.type.name === "link");

            // At left boundary, also check nodeAfter
            if (!linkMark && $pos.textOffset === 0) {
              const nodeAfter = $pos.parent.maybeChild($pos.index($pos.depth));
              if (nodeAfter) {
                linkMark = nodeAfter.marks.find((m) => m.type.name === "link");
              }
            }

            // Also check nodeBefore for right boundary
            if (!linkMark) {
              const nodeBefore = pos > 0 ? view.state.doc.resolve(pos - 1) : null;
              if (nodeBefore) {
                linkMark = nodeBefore.marks().find((m) => m.type.name === "link");
              }
            }

            if (linkMark) {
              const href = linkMark.attrs.href as string;
              if (href) {
                event.preventDefault();
                openUrl(href).catch(console.error);
                return true;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});
