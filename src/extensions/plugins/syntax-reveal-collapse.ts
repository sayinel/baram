// §5.1 + §3.3 Syntax Reveal — collapse logic (expanded range → marks/nodes)

import type { ExpandedRange } from "./syntax-reveal-state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

import { classifyMediaSrc } from "../../utils/media-src";
import { parseRevealResource } from "./syntax-reveal-resource-codec";
import {
  INACTIVE,
  syntaxRevealKey,
  tagSyntaxRevealEphemeral,
  WIKILINK_REGEX,
} from "./syntax-reveal-state";

// ── Collapse expanded range ───────────────────────────────────────────

/**
 * Build the transaction that collapses an expanded range back to
 * marks/nodes. Pure: never dispatches.
 *
 * §384: returns `null` when the expanded range's delimiters no longer
 * validate against the live doc (stale/invalid) instead of dispatching a
 * meta-only INACTIVE transaction itself — callers decide what to do with a
 * `null` result. `collapseExpanded` below is the interactive wrapper that
 * preserves today's behavior on that path.
 */
export function buildCollapseTr(
  state: EditorState,
  expanded: ExpandedRange,
  cursorTarget?: number,
): null | Transaction {
  const { tr } = state;
  const {
    from,
    to,
    kind,
    openCheck,
    closeCheck,
    markName,
    mediaAttrs,
    linkAttrs,
  } = expanded;

  // Validate open delimiter still exists
  try {
    const openText = state.doc.textBetween(from, from + openCheck.length);
    if (openText !== openCheck) return null;
  } catch {
    return null;
  }

  if (kind === "mark" && markName) {
    const markType = state.schema.marks[markName];
    if (!markType || !closeCheck) return null;

    try {
      const closeText = state.doc.textBetween(to - closeCheck.length, to);
      if (closeText !== closeCheck) return null;
    } catch {
      return null;
    }

    const contentFrom = from + openCheck.length;
    const contentTo = to - closeCheck.length;
    const contentLen = contentTo - contentFrom;

    if (contentLen <= 0) {
      tr.delete(from, to);
    } else {
      const content = state.doc.slice(contentFrom, contentTo).content;
      tr.replaceWith(from, to, content);
      tr.addMark(from, from + contentLen, markType.create());
    }
  } else if (kind === "link") {
    const fullText = state.doc.textBetween(from, to);
    const parsed = parseRevealResource(fullText);
    if (!parsed || parsed.kind !== "link") return null;

    const { destination: href, title } = parsed;
    const bracketIdx = fullText.indexOf("](");

    const contentFrom = from + 1;
    const contentTo = from + bracketIdx;
    const contentLen = bracketIdx - 1;

    // §384 fix (B): merge stashed non-href/title attrs (e.g. `target`) back
    // in — see ExpandedRange.linkAttrs.
    const linkMark = state.schema.marks.link.create({
      ...linkAttrs,
      href,
      title: title || null,
    });

    if (contentLen <= 0) {
      tr.delete(from, to);
    } else {
      const content = state.doc.slice(contentFrom, contentTo).content;
      tr.replaceWith(from, to, content);
      tr.addMark(from, from + contentLen, linkMark);
    }
  } else if (kind === "image") {
    const fullText = state.doc.textBetween(from, to);
    const parsed = parseRevealResource(fullText);
    if (!parsed || parsed.kind !== "image") return null;

    const { label: alt, destination: src, title } = parsed;
    // §295 src가 노드 타입을 정한다 — syntax-reveal.ts의 appendTransaction
    // collapse 분기와 같은 결정. 이 함수(buildCollapseTr)는 그와 별개의
    // 두 번째 collapse 구현이라 결정을 여기도 복제해야 한다.
    // §294 fix (C1): mediaAttrs restores width, which `![alt](src)` cannot
    // carry — see expandMediaAtom. Same duplication note applies.
    const attrs = {
      src,
      alt: alt || null,
      title: title || null,
      ...mediaAttrs,
    };
    const useVideo =
      classifyMediaSrc(src) !== "image" && !!state.schema.nodes.video;
    const mediaNode = useVideo
      ? state.schema.nodes.video.create(attrs)
      : state.schema.nodes.image.create(attrs);
    const imgFrom = from - 1;
    const imgTo = to + 1;
    tr.replaceWith(imgFrom, imgTo, mediaNode);
  } else if (kind === "wikilink") {
    const fullText = state.doc.textBetween(from, to);
    const wlMatch = fullText.match(WIKILINK_REGEX);
    if (!wlMatch) return null;

    const [, wlAlias, wlTarget, wlHeading, wlBlockId, wlDisplay] = wlMatch;
    const wikilinkNode = state.schema.nodes.wikilink.create({
      vaultAlias: wlAlias || null,
      target: wlTarget,
      heading: wlHeading || null,
      blockId: wlBlockId || null,
      display: wlDisplay || null,
    });
    tr.replaceWith(from, to, wikilinkNode);
  }

  // Set explicit cursor position if requested
  if (cursorTarget !== undefined) {
    try {
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          Math.max(0, Math.min(cursorTarget, tr.doc.content.size)),
        ),
      );
    } catch {
      // fallback: let ProseMirror's default mapping handle it
    }
  }

  // §384 (C): this point is only reached by a successful collapse — every
  // early exit above returns `null` instead. Tag it ephemeral so
  // isEphemeralOnlyUpdate can tell this apart from a real edit.
  tagSyntaxRevealEphemeral(tr);
  tr.setMeta(syntaxRevealKey, INACTIVE);
  return tr;
}

/**
 * Collapse expanded delimiters back to marks/nodes.
 * @param cursorTarget — if provided, place cursor here in the collapsed doc.
 *   Otherwise ProseMirror's default position mapping through the replace steps
 *   determines the final cursor position.
 */
export function collapseExpanded(
  view: EditorView,
  expanded: ExpandedRange,
  cursorTarget?: number,
): void {
  const tr = buildCollapseTr(view.state, expanded, cursorTarget);
  if (tr) {
    view.dispatch(tr);
    return;
  }

  // Stale/invalid expansion (e.g. a delimiter no longer matches the live
  // doc) — deactivate without touching the doc. Same outcome as before
  // buildCollapseTr's extraction (§384).
  const inactiveTr = view.state.tr;
  inactiveTr.setMeta(syntaxRevealKey, INACTIVE);
  view.dispatch(inactiveTr);
}
