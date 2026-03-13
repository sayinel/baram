// convert-inline-text.ts — Text splitting for inline patterns (wikilinks, mentions, block refs, tags, custom marks)
// Extracted from md-to-pm.ts for single-responsibility

import type { Mark, Node as PmNode, Schema } from "@tiptap/pm/model";

import { BLOCK_REF_RE, parseBlockRefMatch } from "./block-id";
import {
  MENTION_RE,
  parseMentionMatch,
} from "./transformers/mention-transformer";
import { TAG_NODE_RE } from "./transformers/tag-transformer";
import {
  parseWikilinkMatch,
  WIKILINK_RE,
} from "./transformers/wikilink-transformer";

// §perf-large-file: Pre-compiled regex with 'g' flag — avoid per-call RegExp allocation
const WIKILINK_RE_G = new RegExp(WIKILINK_RE.source, "g");
const BLOCK_REF_RE_G = new RegExp(BLOCK_REF_RE.source, "g");
const MENTION_RE_G = new RegExp(MENTION_RE.source, "g");
const TAG_NODE_RE_G = new RegExp(TAG_NODE_RE.source, "g");

/** §30b: Split text at ((block-ref)) boundaries into mixed text + blockReference PM nodes */
export function splitTextWithBlockRefs(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  return splitTextWithPattern(
    text,
    BLOCK_REF_RE_G,
    parentMarks,
    schema,
    (match) => {
      const parsed = parseBlockRefMatch(match);
      return schema.nodes.blockReference.create({
        target: parsed.target,
        blockId: parsed.blockId,
        display: parsed.display,
      });
    },
  );
}

/** §57: Split text at @[[mention]] boundaries into mixed text + mention PM nodes.
 *  Remaining text segments are recursively processed for wikilinks. */
export function splitTextWithMentions(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  const result: PmNode[] = [];
  MENTION_RE_G.lastIndex = 0;
  let lastIndex = 0;
  let match: null | RegExpExecArray;

  while ((match = MENTION_RE_G.exec(text)) !== null) {
    // Text before the mention — may contain wikilinks
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      if (schema.nodes.wikilink && before.includes("[[")) {
        const wlNodes = splitTextWithWikilinks(before, schema, parentMarks);
        if (wlNodes.length > 0) {
          result.push(...wlNodes);
        } else {
          result.push(schema.text(before, parentMarks));
        }
      } else {
        result.push(schema.text(before, parentMarks));
      }
    }

    // Mention node
    const parsed = parseMentionMatch(match);
    result.push(
      schema.nodes.mention.create({
        type: parsed.type,
        value: parsed.value,
      }),
    );

    lastIndex = MENTION_RE_G.lastIndex;
  }

  if (result.length === 0) return [];

  // Text after the last mention — may contain wikilinks
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex);
    if (schema.nodes.wikilink && after.includes("[[")) {
      const wlNodes = splitTextWithWikilinks(after, schema, parentMarks);
      if (wlNodes.length > 0) {
        result.push(...wlNodes);
      } else {
        result.push(schema.text(after, parentMarks));
      }
    } else {
      result.push(schema.text(after, parentMarks));
    }
  }

  return result;
}

/**
 * Generic text splitter: scan `text` for `regex` matches, emit text nodes for gaps
 * and call `createNode` for each match to produce the special PM node.
 *
 * Returns empty array if no matches are found.
 */
export function splitTextWithPattern(
  text: string,
  regex: RegExp,
  parentMarks: Mark[],
  schema: Schema,
  createNode: (match: RegExpExecArray) => PmNode,
): PmNode[] {
  const result: PmNode[] = [];
  regex.lastIndex = 0;
  let lastIndex = 0;
  let match: null | RegExpExecArray;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(schema.text(text.slice(lastIndex, match.index), parentMarks));
    }
    result.push(createNode(match));
    lastIndex = regex.lastIndex;
  }

  if (result.length === 0) return [];

  if (lastIndex < text.length) {
    result.push(schema.text(text.slice(lastIndex), parentMarks));
  }

  return result;
}

/** §56m: Split a text string at #tag boundaries into mixed text + tagNode PM nodes */
export function splitTextWithTags(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  const result: PmNode[] = [];
  TAG_NODE_RE_G.lastIndex = 0;
  let lastIndex = 0;
  let match: null | RegExpExecArray;

  while ((match = TAG_NODE_RE_G.exec(text)) !== null) {
    // Find where the # actually starts in the full match
    // The match may start with a leading whitespace char (from the alternation)
    const hashOffset = match[0].indexOf("#");
    const hashIndex = match.index + hashOffset;

    // Text before the # (including any leading whitespace in the match)
    if (hashIndex > lastIndex) {
      result.push(schema.text(text.slice(lastIndex, hashIndex), parentMarks));
    }

    // Tag node
    const tag = match[1];
    result.push(schema.nodes.tagNode.create({ tag }));

    lastIndex = hashIndex + 1 + tag.length; // past the # and the tag text
  }

  if (result.length === 0) return [];

  // Text after the last tag
  if (lastIndex < text.length) {
    result.push(schema.text(text.slice(lastIndex), parentMarks));
  }

  return result;
}

/** Split a text string at [[wikilink]] boundaries into mixed text + wikilink PM nodes */
export function splitTextWithWikilinks(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  return splitTextWithPattern(
    text,
    WIKILINK_RE_G,
    parentMarks,
    schema,
    (match) => {
      const parsed = parseWikilinkMatch(match);
      return schema.nodes.wikilink.create({
        target: parsed.target,
        display: parsed.display,
        heading: parsed.heading,
        blockId: parsed.blockId,
      });
    },
  );
}

/** Custom inline mark patterns: ==highlight==, ^superscript^, ~subscript~ */
const CUSTOM_MARK_PATTERNS: {
  fastCheck: string;
  markName: string;
  re: RegExp;
}[] = [
  { markName: "highlight", re: /==((?:[^=]|=[^=])+)==/g, fastCheck: "==" },
  { markName: "superscript", re: /\^([^^]+)\^/g, fastCheck: "^" },
  { markName: "subscript", re: /(?<![~])~([^~]+)~(?!~)/g, fastCheck: "~" },
];

/**
 * Split text at custom inline mark boundaries (==highlight==, ^super^, ~sub~).
 * Processes each mark pattern in order; returns empty array if no matches.
 */
export function splitTextWithCustomInlineMarks(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  // Try each pattern; first match wins
  for (const { markName, re, fastCheck } of CUSTOM_MARK_PATTERNS) {
    if (!schema.marks[markName]) continue;
    if (!text.includes(fastCheck)) continue;

    const nodes = splitTextWithSingleCustomMark(
      text,
      schema,
      parentMarks,
      markName,
      re,
    );
    if (nodes.length > 0) return nodes;
  }
  return [];
}

/** Split text on a single custom mark regex, returning PM nodes with the mark applied */
function splitTextWithSingleCustomMark(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
  markName: string,
  regex: RegExp,
): PmNode[] {
  const result: PmNode[] = [];
  regex.lastIndex = 0;
  let lastIndex = 0;
  let match: null | RegExpExecArray;

  while ((match = regex.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      // Recursively check remaining patterns on the "before" text
      const beforeNodes = splitTextWithCustomInlineMarks(
        before,
        schema,
        parentMarks,
      );
      if (beforeNodes.length > 0) {
        result.push(...beforeNodes);
      } else {
        result.push(schema.text(before, parentMarks));
      }
    }

    // The matched content with the mark applied
    const mark = schema.marks[markName]?.create();
    if (mark) {
      result.push(schema.text(match[1], [...parentMarks, mark]));
    }

    lastIndex = regex.lastIndex;
  }

  if (result.length === 0) return [];

  // Text after the last match
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex);
    const afterNodes = splitTextWithCustomInlineMarks(
      after,
      schema,
      parentMarks,
    );
    if (afterNodes.length > 0) {
      result.push(...afterNodes);
    } else {
      result.push(schema.text(after, parentMarks));
    }
  }

  return result;
}
