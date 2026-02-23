// Baram Extension 번들 — M2 기본 편집 세트
// StarterKit 대신 커스텀 Extension 조합 사용

import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import Dropcursor from "@tiptap/extension-dropcursor";
import Gapcursor from "@tiptap/extension-gapcursor";
import Placeholder from "@tiptap/extension-placeholder";

// Node Extensions
import { Heading } from "./nodes/heading";
import { Paragraph } from "./nodes/paragraph";
import { Blockquote } from "./nodes/blockquote";
import { BulletList } from "./nodes/bullet-list";
import { OrderedList } from "./nodes/ordered-list";
import { ListItem } from "./nodes/list-item";
import { TaskList } from "./nodes/task-list";
import { TaskItem } from "./nodes/task-item";
import { HorizontalRule } from "./nodes/horizontal-rule";
import { Image } from "./nodes/image";
import { CodeBlock } from "./nodes/code-block";
import { MathBlock } from "./nodes/math-block";
import { MermaidBlock } from "./nodes/mermaid-block";
import { MathInline } from "./nodes/math-inline";
import {
  BaramTable,
  BaramTableRow,
  BaramTableCell,
  BaramTableHeader,
} from "./nodes/table";
import { Frontmatter } from "./nodes/frontmatter";
import { Wikilink } from "./nodes/wikilink";
import { BlockReference } from "./nodes/block-reference";
import { BlockEmbed } from "./nodes/block-embed";
import { Callout } from "./nodes/callout";
import { Toggle } from "./nodes/toggle";
import { TableOfContents } from "./nodes/table-of-contents";

// Plugin Extensions — M3/M4
import { MathInlineEdit } from "./plugins/math-inline-edit";
import { SlashCommands } from "./plugins/slash-command";
import { SyntaxReveal } from "./plugins/syntax-reveal";
import { DropHandler } from "./plugins/drop-handler";
import { WikilinkSuggest } from "./plugins/wikilink-suggest";
import { BlockIdDecoration } from "./plugins/block-id-decoration";
import { GhostText } from "./plugins/ghost-text";
import { PromptHighlight } from "./plugins/prompt-highlight";
import { FindReplace } from "./plugins/find-replace";
import { PromptLint } from "./plugins/prompt-lint";
import { AIDiff } from "./plugins/ai-diff";

// Mark Extensions
import { Bold } from "./marks/bold";
import { Italic } from "./marks/italic";
import { Code } from "./marks/code";
import { Strike } from "./marks/strike";
import { Link } from "./marks/link";
import { Underline } from "./marks/underline";
import { Highlight } from "./marks/highlight";
import { Subscript } from "./marks/subscript";
import { Superscript } from "./marks/superscript";

import type { Extensions } from "@tiptap/core";

interface BaramExtensionOptions {
  onNavigate?: (target: string, heading?: string | null) => void;
  onNavigateBlockRef?: (target: string, blockId: string) => void;
  onNavigateLocal?: (href: string) => void;
}

/** M2 기본 편집 Extension 세트 */
export function createBaramExtensions(options?: BaramExtensionOptions): Extensions {
  return [
    // Core (required)
    Document,
    Text,
    HardBreak,
    Dropcursor,
    Gapcursor,

    // Nodes — §5.1
    Paragraph,
    Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    Blockquote,
    BulletList,
    OrderedList,
    ListItem,
    TaskList,
    TaskItem,
    HorizontalRule,
    Image,
    CodeBlock,

    // Nodes — §5.3 Math
    MathBlock,

    // Nodes — §5.5 Mermaid
    MermaidBlock,
    MathInline,
    MathInlineEdit,

    // Nodes — §5.5 Table
    BaramTable,
    BaramTableRow,
    BaramTableCell,
    BaramTableHeader,

    // Nodes — §5.8 Frontmatter
    Frontmatter,

    // Nodes — §28 Wikilink
    Wikilink.configure({
      onNavigate: options?.onNavigate ?? (() => {}),
    }),

    // Nodes — §5.9 Callout
    Callout,

    // Nodes — §5.1 Toggle
    Toggle,

    // Nodes — Table of Contents
    TableOfContents,

    // Nodes — §30c Block Reference & Embed
    BlockReference.configure({
      onNavigate: options?.onNavigateBlockRef ?? (() => {}),
    }),
    BlockEmbed.configure({
      onNavigate: options?.onNavigateBlockRef ?? (() => {}),
    }),

    // Marks — §5.1
    Bold,
    Italic,
    Code,
    Strike,
    Link.configure({
      onNavigateLocal: options?.onNavigateLocal ?? (() => {}),
    }),
    Underline,
    Highlight,
    Subscript,
    Superscript,

    // Plugins — §5.2
    History.configure({ depth: 100 }),

    // Plugins — §4.6 Slash Commands
    SlashCommands,

    // Plugins — §5.1 Syntax Reveal (Typora-style)
    SyntaxReveal,

    // Plugins — §3.3 Drop Handler (drag-and-drop images)
    DropHandler,

    // Plugins — §31 Wikilink Autocomplete ([[)
    WikilinkSuggest,

    // Plugins — §30a Block ID Decoration (Focus-Reveal + Hint)
    BlockIdDecoration,

    // Plugins — §43 Ghost Text (inline completion)
    GhostText,

    // Plugins — §41 Prompt Highlight (Skills files)
    PromptHighlight,

    // Plugins — §5.6 Find/Replace (Cmd+F / Cmd+H)
    FindReplace,

    // Plugins — §46 Prompt Lint (Skills files)
    PromptLint,

    // Plugins — §6.2 AI Diff (Cmd+J inline editing)
    AIDiff,

    // UI
    Placeholder.configure({
      placeholder: "Start writing…",
    }),
  ];
}

// Re-export all extensions
export {
  Heading,
  Paragraph,
  Blockquote,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  HorizontalRule,
  Image,
  CodeBlock,
  MathBlock,
  MermaidBlock,
  MathInline,
  BaramTable,
  BaramTableRow,
  BaramTableCell,
  BaramTableHeader,
  Frontmatter,
  Wikilink,
  BlockReference,
  BlockEmbed,
  Callout,
  Toggle,
  Bold,
  Italic,
  Code,
  Strike,
  Link,
  Underline,
  Highlight,
  Subscript,
  Superscript,
  TableOfContents,
};
