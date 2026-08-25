import { useMemo } from "react";
import type { ReactNode } from "react";

import type {
  BlockContent,
  DefinitionContent,
  ListItem,
  Nodes,
  PhrasingContent,
} from "mdast";

// §44 Lightweight markdown renderer for AI chat messages
// Uses mdast-util-from-markdown to parse markdown and renders to React elements
import DOMPurify from "dompurify";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

import { isSvgContent, sanitizeSvg } from "../../utils/markdown/svg-utils";
import { VIM_ISLAND_MARKERS } from "../../utils/vim-island-markers";
import { safeImageSrc, safeLinkHref } from "./markdown-url";

/**
 * Who wrote the markdown.
 *
 * `"trusted"` keeps this renderer's original behaviour: raw HTML blocks reach
 * `dangerouslySetInnerHTML` (via the SVG/HTML sanitizers) and remote images load. That was
 * built for two callers — AI chat output, and Help panel documents bundled at build time
 * from this repo — where authored HTML and SVG fidelity are the point.
 *
 * `"untrusted"` is the DEFAULT, so a new caller is safe without knowing this exists. It is
 * the setting for anything a third party ships: raw HTML is dropped and images are limited
 * to inline data. ‼️ `sanitizeSvg` deliberately preserves `<style>` and `foreignObject`
 * (its docstring says so), and a `<style>` inside inline SVG is a DOCUMENT-scoped
 * stylesheet — so raw HTML from a plugin author could restyle the app, including the §260
 * consent dialog's own danger and capability classes.
 */
export type MarkdownTrust = "trusted" | "untrusted";
type MdastBlockContent = BlockContent | DefinitionContent | ListItem;

type MdastNode = Nodes;

export default function MarkdownRenderer({
  content,
  trust = "untrusted",
}: {
  content: string;
  trust?: MarkdownTrust;
}) {
  const rendered = useMemo(() => {
    // ‼️ Checked on the SOURCE, before `fromMarkdown`. Nesting depth drives parse cost roughly
    // quadratically — measured here: depth 2,000 (4 KB) 51ms, depth 4,000 (8 KB) 199ms, while a
    // FLAT 16 KB document parses in 35ms. So `MAX_README_BYTES` is the wrong axis: a README far
    // under that cap freezes the main thread for tens of seconds, and the freeze is paid inside
    // the parse — a bound in `restrictUntrusted` would run after the cost was already spent.
    // Falls back to source text, the same degradation as a parse failure.
    if (trust !== "trusted" && DEEP_NESTING_RE.test(content)) return content;
    try {
      const tree = fromMarkdown(content, {
        extensions: [gfm()],
        mdastExtensions: [gfmFromMarkdown()],
      });
      // ‼️ Restricted on the TREE, before rendering, rather than threaded through the
      // renderers. `renderBlock`/`renderInline` recurse via bare `.map(renderInline)`, so an
      // options parameter would have to reach a dozen call sites and any one missed would
      // silently render under the wrong policy. One pre-pass has no such seam.
      return renderMdast(trust === "trusted" ? tree : restrictUntrusted(tree));
    } catch {
      // Fallback to plain text if parsing fails
      return content;
    }
  }, [content, trust]);

  return <div className="markdown-rendered">{rendered}</div>;
}

/** Render block-level mdast nodes to React elements */
function renderBlock(node: MdastBlockContent, key: number): ReactNode {
  switch (node.type) {
    case "blockquote":
      return (
        <blockquote
          className="mb-2 border-l-2 border-[var(--color-border-default)] pl-3 italic"
          key={key}
        >
          {node.children.map((child, i) =>
            renderBlock(child as MdastBlockContent, i),
          )}
        </blockquote>
      );
    case "code":
      return (
        <pre
          className="mb-2 overflow-x-auto rounded bg-[var(--color-bg-elevated)] p-2 text-[0.85em]"
          key={key}
        >
          <code className={node.lang ? `language-${node.lang}` : ""}>
            {node.value}
          </code>
        </pre>
      );
    case "heading": {
      const Tag = `h${node.depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag className="mb-2 font-semibold" key={key}>
          {node.children.map(renderInline)}
        </Tag>
      );
    }
    case "html":
      return (
        <div
          dangerouslySetInnerHTML={{ __html: sanitizeEmbeddedHtml(node.value) }}
          key={key}
        />
      );
    case "list":
      if (node.ordered) {
        return (
          <ol className="mb-2 list-decimal pl-5" key={key}>
            {node.children.map((item, i) => renderBlock(item, i))}
          </ol>
        );
      }
      return (
        <ul className="mb-2 list-disc pl-5" key={key}>
          {node.children.map((item, i) => renderBlock(item, i))}
        </ul>
      );
    case "listItem":
      return (
        <li key={key}>
          {node.children.map((child, i) =>
            renderBlock(child as MdastBlockContent, i),
          )}
        </li>
      );
    case "paragraph":
      return (
        <p className="mb-2 last:mb-0" key={key}>
          {node.children.map(renderInline)}
        </p>
      );
    case "table":
      return (
        <table className="mb-2 w-full border-collapse text-[0.85em]" key={key}>
          <tbody>
            {node.children.map((row, ri) => (
              <tr key={ri}>
                {row.children.map((cell, ci) => {
                  const CellTag = ri === 0 ? "th" : "td";
                  return (
                    <CellTag
                      className="border border-[var(--color-border-default)] px-2 py-1"
                      key={ci}
                    >
                      {cell.children.map(renderInline)}
                    </CellTag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "thematicBreak":
      return (
        <hr className="my-2 border-[var(--color-border-default)]" key={key} />
      );
    default:
      return null;
  }
}

/** Render inline (phrasing) mdast nodes to React elements */
function renderInline(node: PhrasingContent, key: number): ReactNode {
  switch (node.type) {
    case "break":
      return <br key={key} />;
    case "delete":
      return (
        <del className="line-through" key={key}>
          {node.children.map(renderInline)}
        </del>
      );
    case "emphasis":
      return <em key={key}>{node.children.map(renderInline)}</em>;
    case "html":
      return (
        <span
          dangerouslySetInnerHTML={{ __html: sanitizeEmbeddedHtml(node.value) }}
          key={key}
        />
      );
    case "image":
      return (
        <img
          alt={node.alt ?? ""}
          className="max-w-full"
          key={key}
          src={safeImageSrc(node.url)}
          title={node.title ?? undefined}
        />
      );
    case "inlineCode":
      return (
        <code
          className="rounded bg-[var(--color-bg-elevated)] px-1 py-0.5 font-mono text-[0.85em]"
          key={key}
        >
          {node.value}
        </code>
      );
    case "link":
      return (
        <a
          className="text-[var(--color-accent-default)] underline"
          href={safeLinkHref(node.url)}
          key={key}
          rel="noopener noreferrer"
          target="_blank"
          title={node.title ?? undefined}
        >
          {node.children.map(renderInline)}
        </a>
      );
    case "strong":
      return (
        <strong className="font-semibold" key={key}>
          {node.children.map(renderInline)}
        </strong>
      );
    case "text":
      return node.value;
    default:
      return null;
  }
}

/** Render a root mdast node to React elements */
function renderMdast(tree: MdastNode): ReactNode {
  if (tree.type === "root") {
    return tree.children.map((child, i) =>
      renderBlock(child as MdastBlockContent, i),
    );
  }
  return null;
}

/**
 * Images an untrusted author may point at: inline data only.
 *
 * ‼️ Remote images are blocked because loading one is an outbound request the user never
 * agreed to — for a plugin it leaks IP, rough location and the moment the user inspected
 * that plugin, while `network` is a capability the author would otherwise have to declare.
 *
 * Known consequence: a README's own bundled images do NOT render either. Nothing rewrites a
 * relative markdown path to `convertFileSrc`, so `![](./img/a.png)` resolved against the app
 * origin and 404'd before this change too — it is now blocked explicitly instead of failing
 * silently. Rewriting relative paths to the asset protocol is a separate piece of work.
 */
const UNTRUSTED_IMAGE_RE = /^data:image\//i;

/**
 * A line opening more than 200 levels of blockquote/indent nesting.
 *
 * Every nesting level a line opens is a container micromark carries, and the cost grows about
 * quadratically with depth. 200 is far above anything authored — five list levels around an
 * indented code block is under 30 characters — and far below the pathological range, where a
 * single line of `> ` repeated inside the byte cap reaches five figures.
 *
 * The character class has no alternation, so the match itself is linear.
 */
const DEEP_NESTING_RE = /^[ \t>]{201,}/m;

/**
 * Is this a node an untrusted author must not have rendered at all?
 *
 * Raw `html` is DROPPED rather than escaped: escaping would show a plugin author's markup as
 * literal text, which is noise, and none of it is wanted. A blocked image is dropped rather
 * than blanked — `safeImageSrc` returns `""` for an unsafe scheme, and the renderer still
 * emits `<img src="">`, which paints a broken-image placeholder and resolves the empty src
 * against the document itself.
 */
function isForbiddenForUntrusted(node: MdastNode): boolean {
  if (node.type === "html") return true;
  return node.type === "image" && !UNTRUSTED_IMAGE_RE.test(node.url.trim());
}

/**
 * Drop what an untrusted author must not reach, on the tree.
 *
 * ‼️ This filters CHILDREN, so it never inspects the node it is handed — handing it an `html`
 * node returns that node unchanged. The single call site always passes `root` (`fromMarkdown`
 * returns nothing else), and `renderMdast` renders **nothing** for a non-root node, so the
 * invariant is enforced downstream rather than here. Stated rather than guarded because a
 * defensive branch that cannot fire is worse than a note pointing at the real enforcement —
 * but if a caller ever passes a subtree, that caller owns this check.
 */
function restrictUntrusted<T extends MdastNode>(node: T): T {
  if (!("children" in node) || !Array.isArray(node.children)) return node;
  return {
    ...node,
    children: (node.children as MdastNode[])
      .filter((child) => !isForbiddenForUntrusted(child))
      .map((child) => restrictUntrusted(child)),
  };
}

/** Raw HTML embedded in AI markdown — render SVG faithfully, sanitize the
 *  rest. vim island markers are stripped here too: they are an app
 *  capability, and model output is no more trusted than a shared file. */
function sanitizeEmbeddedHtml(value: string): string {
  return isSvgContent(value)
    ? sanitizeSvg(value)
    : DOMPurify.sanitize(value, { FORBID_ATTR: [...VIM_ISLAND_MARKERS] });
}
