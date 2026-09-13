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

/**
 * 텍스트 안에 있으면 **노드**가 만들어질 수 있음을 알리는 표식 — 분리기들의 fast check.
 *
 * 한 곳에만 적는다. `convert-inline.ts`의 분리기와
 * `convert-inline-custom-marks.ts`의 구간 판정이 같은 목록을 봐야 하기 때문이다.
 * 갈라지면 커스텀 마크가 노드를 감쌀 때 마크는 못 실리는데 구분자만 지워져,
 * 사용자가 친 `==`가 흔적 없이 사라진다.
 */
export const INLINE_NODE_TRIGGERS = {
  blockReference: "((",
  mention: "@[[",
  tagNode: "#",
  wikilink: "[[",
} as const;

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
        // §276.6 — a schema without the `width` attr (older test schemas)
        // silently drops this, which is exactly the pre-width behaviour.
        width: parsed.width,
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
        vaultAlias: parsed.vaultAlias,
        target: parsed.target,
        display: parsed.display,
        heading: parsed.heading,
        blockId: parsed.blockId,
      });
    },
  );
}
