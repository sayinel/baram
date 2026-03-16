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

type MdastBlockContent = BlockContent | DefinitionContent | ListItem;
type MdastNode = Nodes;

export default function MarkdownRenderer({ content }: { content: string }) {
  const rendered = useMemo(() => {
    try {
      const tree = fromMarkdown(content, {
        extensions: [gfm()],
        mdastExtensions: [gfmFromMarkdown()],
      });
      return renderMdast(tree);
    } catch {
      // Fallback to plain text if parsing fails
      return content;
    }
  }, [content]);

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
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(node.value) }}
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
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(node.value) }}
          key={key}
        />
      );
    case "image":
      return (
        <img
          alt={node.alt ?? ""}
          className="max-w-full"
          key={key}
          src={node.url}
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
          href={node.url}
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
