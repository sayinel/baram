// Baram Extension 번들 — M2 기본 편집 세트
// StarterKit 대신 커스텀 Extension 조합 사용

import type { Locale } from "../i18n";
import type { Extensions } from "@tiptap/core";

import Document from "@tiptap/extension-document";
import Dropcursor from "@tiptap/extension-dropcursor";
import Gapcursor from "@tiptap/extension-gapcursor";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import Text from "@tiptap/extension-text";

import { t } from "../i18n";
import { useSettingsStore } from "../stores/settings/store";
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
import { SvgBlock } from "./nodes/svg-block";
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
import { Video } from "./nodes/video";
import { Wikilink } from "./nodes/wikilink";
import { AIDiff } from "./plugins/ai-diff";
import { BlockIdDecoration } from "./plugins/block-id-decoration";
import { ClickBelowAppend } from "./plugins/click-below-append";
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
import { TaskCreatedStamp } from "./plugins/task-created-stamp";
import { TaskDateHint } from "./plugins/task-date-hint";
import { TaskFieldChips } from "./plugins/task-field-chips";
import { TaskInputRules } from "./plugins/task-input-rules";
import { ViewportVirtualize } from "./plugins/viewport-virtualize";
import { WysiwygVim } from "./plugins/vim";
import { WikilinkSuggest } from "./plugins/wikilink-suggest";

/**
 * §323 캡처 프로파일에서 **빼는** Extension의 `name`.
 *
 * ‼️ 넣을 것을 열거하지 않는 이유: 그러면 새 Extension이 document에만 붙고 캡처에는
 * 조용히 빠진다. 뺄 것만 이름으로 적고 나머지는 전부 통과시킨다.
 *
 * 빼는 근거는 저마다 다르다 — vim은 저장 단축키와 충돌하고, 쿼리 블록은 캡처에 넣을
 * 이유가 없으며, find-replace·AI diff는 다이얼로그에 붙일 크롬이 없다.
 */
export const CAPTURE_EXCLUDED_EXTENSIONS: ReadonlySet<string> = new Set([
  "aiDiff",
  "findReplace",
  "queryBlock",
  "wysiwygVim",
]);

interface BaramExtensionOptions {
  /** §perf-large-file C4: register windowing only on the large keep-alive
   *  editor (small docs are never wrapped). */
  isLargeKeepaliveEditor?: boolean;
  onMentionNavigate?: (type: string, value: string) => void;
  onNavigate?: (
    target: string,
    heading?: null | string,
    vaultAlias?: null | string,
  ) => void;
  onNavigateBlockRef?: (target: string, blockId: string) => void;
  /** §278.1 Returns whether the href was handled in-app; see `LinkOptions`. */
  onNavigateLocal?: (href: string) => boolean;
  /**
   * §323 캡처 다이얼로그용 축소 세트. 생략하면 문서 편집기 세트.
   *
   * §324-e 이 값은 Extension 목록만 정하지 않는다 — `DropHandler`의
   * `deferMediaToHost`도 여기서 갈린다. 캡처는 아직 파일이 아니므로 미디어를
   * 저장 시점까지 디스크에 쓰지 않는다.
   */
  profile?: "capture" | "document";
}

/** M2 기본 편집 Extension 세트 */
export function createBaramExtensions(
  options?: BaramExtensionOptions,
): Extensions {
  const all: Extensions = [
    // Core (required)
    Document,
    Text,
    HardBreak,
    Dropcursor,
    Gapcursor,

    // §298 vim — always installed, dormant until enabled (design §2/§7).
    WysiwygVim,

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
    Video,
    CodeBlock,

    // Nodes — §5.3 Math
    MathBlock,

    // Nodes — §5.5 Mermaid
    MermaidBlock,

    // Nodes — §5.1 SVG Block (```svg fenced render)
    SvgBlock,

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
      onNavigateLocal: options?.onNavigateLocal ?? (() => false),
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
    // §324-e 캡처 프로필만 저장 시점으로 미룬다. 그 표면은 아직 파일이 아니라
    // 상대참조를 걸어 둘 자리도, 취소로 되돌릴 방법도 없기 때문이다 — 근거는
    // `DropHandlerOptions.deferMediaToHost`에. 문서 프로필은 즉시 쓴다(불변).
    DropHandler.configure({
      deferMediaToHost: options?.profile === "capture",
    }),

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

    // Plugins — §4.2 Click below last block appends a paragraph (Notion-style)
    ClickBelowAppend,

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

    // Plugins — §303 Word-trigger input rules (due:/sched:/start:/prio:, !1-!5)
    TaskInputRules,

    // Plugins — §308 Task metadata chips (decoration-only, never touches the doc)
    TaskFieldChips,

    // Plugins — §312 ➕ stamp on a task line the cursor just left
    TaskCreatedStamp,

    // Plugins — §308 M3-c natural-language date in a task line, Tab confirms.
    // ‼️ Must stay AFTER TaskItem in this array: Tiptap reverses the extension
    // list when stacking plugins, so a later entry sees keys first — which is
    // what lets this yield Tab back to list indenting when nothing is matched.
    TaskDateHint,

    // §perf-large-file C4: true windowing — registered ONLY on the large
    // keep-alive editor (small docs never get the NodeViews). isEnabled is the
    // runtime kill-switch (virtualizeLargeDocs setting, default on).
    ...(options?.isLargeKeepaliveEditor
      ? [
          ViewportVirtualize.configure({
            isEnabled: () => useSettingsStore.getState().virtualizeLargeDocs,
          }),
        ]
      : []),

    // UI — §perf-large-file: @tiptap Placeholder's viewport-boundary tracking
    // (getViewportBoundaryPositions → posAtCoords → getClientRects) forces a full
    // reflow of the whole DOM on EVERY transaction. On the large keep-alive editor
    // (~3,000 blocks) this measured ~271k getClientRects per edit-entry click — the
    // dominant edit-latency cost (profiled 2026-06-22). A large doc is never empty,
    // so the placeholder adds no value there; gate it off (same gate as windowing).
    ...(options?.isLargeKeepaliveEditor
      ? []
      : [
          Placeholder.configure({
            // §323 리뷰 Important 3: 문서창의 문구는 `editor/base.css`가
            // `content:`에 박아 두므로 이 문자열은 그쪽에선 보이지 않는다.
            // 캡처 창은 그 CSS를 `attr(data-placeholder)`로 되돌려 여기 값을
            // 실제로 쓰므로, 로케일에 맞는 문구를 줘야 한다 — 그러지 않으면
            // 영어 사용자가 한국어 안내 문장을 본다(그것이 이 결함이었다).
            // 문자열이 아니라 함수인 이유: Extension 배열은 편집기 인스턴스마다
            // 한 번만 만들어지는데(`use-capture-editor.ts`), Placeholder는
            // 데코레이션을 매 state마다 다시 계산하므로 언어를 바꾼 뒤에도
            // 다음 계산에서 현재 로케일을 읽는다.
            placeholder:
              options?.profile === "capture"
                ? () =>
                    t(
                      "journal.capture.body.placeholder",
                      useSettingsStore.getState().locale as Locale,
                    )
                : "Start writing…",
          }),
        ]),
  ];
  if (options?.profile !== "capture") return all;
  return all.filter((e) => !CAPTURE_EXCLUDED_EXTENSIONS.has(e.name));
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
  SvgBlock,
  TableOfContents,
  TagNode,
  TaskItem,
  TaskList,
  Toggle,
  Underline,
  Video,
  Wikilink,
};
