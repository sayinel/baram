// Baram Extension 번들 — M2 기본 편집 세트
// StarterKit 대신 커스텀 Extension 조합 사용

import type { Extensions } from "@tiptap/core";

import Document from "@tiptap/extension-document";
import Dropcursor from "@tiptap/extension-dropcursor";
import Gapcursor from "@tiptap/extension-gapcursor";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import Text from "@tiptap/extension-text";

import { logger } from "../utils/logger";
// Mark Extensions
import { Bold } from "./marks/bold";
import { Code } from "./marks/code";
import { Highlight } from "./marks/highlight";
import { Italic } from "./marks/italic";
import { Link } from "./marks/link";
import { Strike } from "./marks/strike";
import { Subscript } from "./marks/subscript";
import { Superscript } from "./marks/superscript";
import { Underline } from "./marks/underline";
import { BlockEmbed } from "./nodes/block-embed";
import { BlockReference } from "./nodes/block-reference";
import { Blockquote } from "./nodes/blockquote";
import { BulletList } from "./nodes/bullet-list";
import { Callout } from "./nodes/callout";
import { CodeBlock } from "./nodes/code-block";
import {
  DefinitionDescription,
  DefinitionList,
  DefinitionTerm,
} from "./nodes/definition-list";
import { FootnoteDefinition } from "./nodes/footnote-definition";
import { FootnoteRef } from "./nodes/footnote-ref";
import { Frontmatter } from "./nodes/frontmatter";
// Node Extensions
import { Heading } from "./nodes/heading";
import { HorizontalRule } from "./nodes/horizontal-rule";
import { HtmlBlock } from "./nodes/html-block";
import { Image } from "./nodes/image";
import { ListItem } from "./nodes/list-item";
import { MathBlock } from "./nodes/math-block";
import { MathInline } from "./nodes/math-inline";
import { Mention } from "./nodes/mention";
import { MermaidBlock } from "./nodes/mermaid-block";
import { OrderedList } from "./nodes/ordered-list";
import { Paragraph } from "./nodes/paragraph";
import { QueryBlock } from "./nodes/query-block";
import {
  BaramTable,
  BaramTableCell,
  BaramTableHeader,
  BaramTableRow,
} from "./nodes/table";
import { TableOfContents } from "./nodes/table-of-contents";
import { TagNode } from "./nodes/tag-node";
import { TaskItem } from "./nodes/task-item";
import { TaskList } from "./nodes/task-list";
import { Toggle } from "./nodes/toggle";
import { Wikilink } from "./nodes/wikilink";
import { AIDiff } from "./plugins/ai-diff";
import { BlockIdDecoration } from "./plugins/block-id-decoration";
import { DropHandler } from "./plugins/drop-handler";
import { FindReplace } from "./plugins/find-replace";
import { Fold } from "./plugins/fold";
import { GhostText } from "./plugins/ghost-text";
import { ListAtomFix } from "./plugins/list-atom-fix";
// Plugin Extensions — M3/M4
import { MathInlineEdit } from "./plugins/math-inline-edit";
import { MentionSuggest } from "./plugins/mention-suggest";
import { PromptHighlight } from "./plugins/prompt-highlight";
import { PromptLint } from "./plugins/prompt-lint";
import { SkillVariableSuggest } from "./plugins/skill-variable-suggest";
import { SlashCommands } from "./plugins/slash-command";
import { SyntaxReveal } from "./plugins/syntax-reveal";
import { TagClick } from "./plugins/tag-click";
import { TagSuggest } from "./plugins/tag-suggest";
import { WikilinkSuggest } from "./plugins/wikilink-suggest";

interface BaramExtensionOptions {
  onMentionNavigate?: (type: string, value: string) => void;
  onNavigate?: (
    target: string,
    heading?: null | string,
    vaultAlias?: null | string,
  ) => void;
  onNavigateBlockRef?: (target: string, blockId: string) => void;
  onNavigateLocal?: (href: string) => void;
}

/** M2 기본 편집 Extension 세트 */
export function createBaramExtensions(
  options?: BaramExtensionOptions,
): Extensions {
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

    // Nodes — §5.13 Query Block
    QueryBlock,
    MathInline,
    MathInlineEdit,

    // Nodes — §5.5 Table
    BaramTable,
    BaramTableRow,
    BaramTableCell,
    BaramTableHeader,

    // Nodes — §5.8 Frontmatter
    Frontmatter,

    // Nodes — §5.1 HTML Block (raw HTML preservation)
    HtmlBlock,

    // Nodes — §28 Wikilink
    Wikilink.configure({
      onNavigate: options?.onNavigate ?? (() => {}),
    }),

    // Nodes — §57 Mention (@[[page]], @[[date]])
    Mention.configure({
      onNavigate: options?.onMentionNavigate ?? (() => {}),
    }),

    // Nodes — §5.9 Callout
    Callout,

    // Nodes — §5.1 Toggle
    Toggle,

    // Nodes — Table of Contents
    TableOfContents,

    // Nodes — §footnote Footnotes
    FootnoteRef,
    FootnoteDefinition,

    // Nodes — Definition List
    DefinitionList,
    DefinitionTerm,
    DefinitionDescription,

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

    // Plugins — §57 Mention Autocomplete (@)
    MentionSuggest,

    // Nodes — §56m Tag Inline Atom
    TagNode,

    // Plugins — §56l Tag Autocomplete (#)
    TagSuggest,

    // Plugins — §56m Tag Click → Search (Cmd/Ctrl+Click on #tag)
    TagClick,

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

    // Plugins — §72c Skill Variable Autocomplete ({{}})
    SkillVariableSuggest,

    // Plugins — §6.2 AI Diff (Cmd+J inline editing)
    AIDiff,

    // Plugins — §56m List atom fix (WebKit marker alignment)
    ListAtomFix,

    // Plugins — Heading & List Folding (Obsidian-style)
    Fold,

    // UI
    Placeholder.configure({
      placeholder: "Start writing…",
    }),
  ];
}

/** Merge core extensions with plugin-provided Tiptap extensions */
export function mergePluginExtensions(
  coreExtensions: Extensions,
  pluginExtensions: Extensions,
): Extensions {
  // Detect name conflicts
  const coreNames = new Set(
    coreExtensions
      .map((ext) => (ext as { name?: string }).name)
      .filter(Boolean),
  );
  const filtered = pluginExtensions.filter((ext) => {
    const name = (ext as { name?: string }).name;
    if (name && coreNames.has(name)) {
      logger.warn(
        `[Plugin] Extension "${name}" conflicts with core extension, skipping`,
      );
      return false;
    }
    return true;
  });
  return [...coreExtensions, ...filtered];
}

// Re-export all extensions
export {
  BaramTable,
  BaramTableCell,
  BaramTableHeader,
  BaramTableRow,
  BlockEmbed,
  Blockquote,
  BlockReference,
  Bold,
  BulletList,
  Callout,
  Code,
  CodeBlock,
  DefinitionDescription,
  DefinitionList,
  DefinitionTerm,
  FootnoteDefinition,
  FootnoteRef,
  Frontmatter,
  Heading,
  Highlight,
  HorizontalRule,
  HtmlBlock,
  Image,
  Italic,
  Link,
  ListItem,
  MathBlock,
  MathInline,
  Mention,
  MermaidBlock,
  OrderedList,
  Paragraph,
  QueryBlock,
  Strike,
  Subscript,
  Superscript,
  TableOfContents,
  TagNode,
  TaskItem,
  TaskList,
  Toggle,
  Underline,
  Wikilink,
};
