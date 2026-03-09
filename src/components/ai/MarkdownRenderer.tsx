// §44 Lightweight markdown renderer for AI chat messages
// Uses mdast-util-from-markdown to parse markdown and renders to React elements
import { useMemo } from "react";
import type { ReactNode } from "react";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type {
  Nodes,
  PhrasingContent,
  BlockContent,
  DefinitionContent,
  ListItem,
} from "mdast";

type MdastNode = Nodes;
type MdastBlockContent = BlockContent | DefinitionContent | ListItem;

/** Render inline (phrasing) mdast nodes to React elements */
function renderInline(node: PhrasingContent, key: number): ReactNode {
  switch (node.type) {
    case "text":
      return node.value;
    case "strong":
      return (
        <strong key={key} className="font-semibold">
          {node.children.map(renderInline)}
        </strong>
      );
    case "emphasis":
      return <em key={key}>{node.children.map(renderInline)}</em>;
    case "delete":
      return (
        <del key={key} className="line-through">
          {node.children.map(renderInline)}
        </del>
      );
    case "inlineCode":
      return (
        <code
          key={key}
          className="rounded bg-[var(--color-bg-tertiary)] px-1 py-0.5 text-[0.85em] font-mono"
        >
          {node.value}
        </code>
      );
    case "link":
      return (
        <a
          key={key}
          href={node.url}
          title={node.title ?? undefined}
          className="text-[var(--color-accent)] underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {node.children.map(renderInline)}
        </a>
      );
    case "break":
      return <br key={key} />;
    case "image":
      return (
        <img
          key={key}
          src={node.url}
          alt={node.alt ?? ""}
          title={node.title ?? undefined}
          className="max-w-full"
        />
      );
    case "html":
      return (
        <span key={key} dangerouslySetInnerHTML={{ __html: node.value }} />
      );
    default:
      return null;
  }
}

/** Render block-level mdast nodes to React elements */
function renderBlock(node: MdastBlockContent, key: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return (
        <p key={key} className="mb-2 last:mb-0">
          {node.children.map(renderInline)}
        </p>
      );
    case "heading": {
      const Tag = `h${node.depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag key={key} className="mb-2 font-semibold">
          {node.children.map(renderInline)}
        </Tag>
      );
    }
    case "code":
      return (
        <pre
          key={key}
          className="mb-2 overflow-x-auto rounded bg-[var(--color-bg-tertiary)] p-2 text-[0.85em]"
        >
          <code className={node.lang ? `language-${node.lang}` : ""}>
            {node.value}
          </code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="mb-2 border-l-2 border-[var(--color-border)] pl-3 italic"
        >
          {node.children.map((child, i) =>
            renderBlock(child as MdastBlockContent, i),
          )}
        </blockquote>
      );
    case "list":
      if (node.ordered) {
        return (
          <ol key={key} className="mb-2 list-decimal pl-5">
            {node.children.map((item, i) => renderBlock(item, i))}
          </ol>
        );
      }
      return (
        <ul key={key} className="mb-2 list-disc pl-5">
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
    case "thematicBreak":
      return <hr key={key} className="my-2 border-[var(--color-border)]" />;
    case "html":
      return <div key={key} dangerouslySetInnerHTML={{ __html: node.value }} />;
    case "table":
      return (
        <table key={key} className="mb-2 w-full border-collapse text-[0.85em]">
          <tbody>
            {node.children.map((row, ri) => (
              <tr key={ri}>
                {row.children.map((cell, ci) => {
                  const CellTag = ri === 0 ? "th" : "td";
                  return (
                    <CellTag
                      key={ci}
                      className="border border-[var(--color-border)] px-2 py-1"
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
