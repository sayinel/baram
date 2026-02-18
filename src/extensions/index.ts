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

// Plugin Extensions — M3/M4
import { MathInlineEdit } from "./plugins/math-inline-edit";
import { SlashCommands } from "./plugins/slash-command";
import { SyntaxReveal } from "./plugins/syntax-reveal";
import { DropHandler } from "./plugins/drop-handler";
import { WikilinkSuggest } from "./plugins/wikilink-suggest";

// Mark Extensions
import { Bold } from "./marks/bold";
import { Italic } from "./marks/italic";
import { Code } from "./marks/code";
import { Strike } from "./marks/strike";
import { Link } from "./marks/link";
import { Underline } from "./marks/underline";

import type { Extensions } from "@tiptap/core";

/** M2 기본 편집 Extension 세트 */
export function createBaramExtensions(): Extensions {
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
    Wikilink,

    // Marks — §5.1
    Bold,
    Italic,
    Code,
    Strike,
    Link,
    Underline,

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
  Bold,
  Italic,
  Code,
  Strike,
  Link,
  Underline,
};
