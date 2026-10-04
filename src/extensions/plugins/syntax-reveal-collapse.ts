// §5.1 + §3.3 Syntax Reveal — collapse logic (expanded range → marks/nodes)

import type { Mark } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

import { classifyMediaSrc } from "../../utils/media-src";
import { parseRevealResource } from "./syntax-reveal-resource-codec";
import {
  collapseMeta,
  type ExpandedRange,
  INACTIVE,
  type SuppressedRange,
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
  let collapsed: null | SuppressedRange = null;
  const {
    from,
    to,
    kind,
    openCheck,
    closeCheck,
    markName,
    mediaAttrs,
    linkAttrs,
    labelEnd: expandedLabelEnd,
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

    collapsed = collapseDelimited(
      tr,
      {
        contentFrom: from + openCheck.length,
        contentTo: to - closeCheck.length,
        from,
        to,
      },
      markType.create(),
    );
  } else if (kind === "link") {
    const fullText = state.doc.textBetween(from, to);
    // §384 fix (F1 round 2): pass the stashed, mapped boundary (relative to
    // fullText) so the split is resolved exactly — see ExpandedRange.labelEnd.
    // §384 (design review M2): if the stash is ever absent, fall back to the
    // LIVE label grammar, not the default (strict/serialized) one — this text
    // came from expandLink, which writes the label as unescaped live doc
    // text (see its own comment), so strict's escape-aware label pattern
    // cannot consume a bare `]` in it. Falling back to strict here would
    // silently reopen the exact §384 F1 corruption this file's collapse path
    // exists to fix. Pinned by "buildCollapseTr still collapses via the live
    // label grammar when the labelEnd stash is missing" in
    // __tests__/syntax-reveal.test.ts (failing-first against a `: undefined`
    // fallback before this fix).
    const parsed = parseRevealResource(
      fullText,
      expandedLabelEnd !== undefined
        ? { labelEnd: expandedLabelEnd - from }
        : { labelGrammar: "live" },
    );
    if (!parsed || parsed.kind !== "link") return null;

    const { destination: href, title, labelEnd } = parsed;

    // §384 fix (B): merge stashed non-href/title attrs (e.g. `target`) back
    // in — see ExpandedRange.linkAttrs.
    const linkMark = state.schema.marks.link.create({
      ...linkAttrs,
      href,
      title: title || null,
    });

    collapsed = collapseDelimited(
      tr,
      { contentFrom: from + 1, contentTo: from + labelEnd, from, to },
      linkMark,
    );
  } else if (kind === "image") {
    const fullText = state.doc.textBetween(from, to);
    // §384 fix (F1 round 2) / §384 (design review M2): see the link branch
    // above. (Media alt text is actually written escaped by expandMediaAtom
    // — see escapedLabelLength — so strict would be the more precise
    // fallback here specifically; kept identical to the link branch anyway
    // since this is an emergency path, not a normal one, and one shared rule
    // across all seven call sites is easier to keep correct than a
    // kind-specific exception.)
    const parsed = parseRevealResource(
      fullText,
      expandedLabelEnd !== undefined
        ? { labelEnd: expandedLabelEnd - from }
        : { labelGrammar: "live" },
    );
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
    collapsed = { from: imgFrom, to: imgFrom + mediaNode.nodeSize };
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
    collapsed = { from, to: from + wikilinkNode.nodeSize };
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
  // `collapsed` names the range for the suppression the state `apply` decides (spec 0067 D10).
  tagSyntaxRevealEphemeral(tr);
  tr.setMeta(syntaxRevealKey, collapsed ? collapseMeta(collapsed) : INACTIVE);
  return tr;
}

/**
 * §384 / spec 0067 §4 — collapse a mark or link expansion by deleting its delimiters,
 * keeping the content where it is, and marking it.
 *
 * Not `replaceWith(from, to, content)`: that maps every position inside the range to one
 * of its ends, which drifted the caret (`forceCollapseSyntaxReveal` used to correct it by
 * hand for marks only) and made anything tracking a position inside the expansion lose it
 * (spec §2.1). The closing delimiter goes first so the opening one's coordinates do not
 * move. Returns the collapsed range in the transaction's new coordinates — empty at `from`
 * when no content is left.
 */
export function collapseDelimited(
  tr: Transaction,
  range: { contentFrom: number; contentTo: number; from: number; to: number },
  mark: Mark,
): SuppressedRange {
  const { contentFrom, contentTo, from, to } = range;
  const contentLen = contentTo - contentFrom;
  if (contentLen <= 0) {
    tr.delete(from, to);
    return { from, to: from };
  }
  tr.delete(contentTo, to);
  tr.delete(from, contentFrom);
  tr.addMark(from, from + contentLen, mark);
  return { from, to: from + contentLen };
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
