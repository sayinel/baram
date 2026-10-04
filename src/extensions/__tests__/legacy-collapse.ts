// §384 / spec 0067 §4 — the pre-§4 (`replaceWith`) mark and link collapse, kept as the reference the
// position-preserving collapse is compared against. It replaces the whole expanded range
// with its inner content (`replaceWith`), which is what loses inner positions (spec §2.1).
// Atom kinds are unchanged by spec 0067, so they defer to the production builder.
import type { ExpandedRange } from "../plugins/syntax-reveal-state";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { buildCollapseTr } from "../plugins/syntax-reveal-collapse";
import { parseRevealResource } from "../plugins/syntax-reveal-resource-codec";
import {
  INACTIVE,
  syntaxRevealKey,
  tagSyntaxRevealEphemeral,
} from "../plugins/syntax-reveal-state";

export function legacyCollapseTr(
  state: EditorState,
  expanded: ExpandedRange,
): null | Transaction {
  if (expanded.kind !== "mark" && expanded.kind !== "link") {
    return buildCollapseTr(state, expanded);
  }
  const { tr } = state;
  const { from, to } = expanded;
  if (expanded.kind === "mark") {
    const markType = state.schema.marks[expanded.markName ?? ""];
    if (!markType || !expanded.closeCheck) return null;
    const contentFrom = from + expanded.openCheck.length;
    const contentTo = to - expanded.closeCheck.length;
    const contentLen = contentTo - contentFrom;
    if (contentLen <= 0) tr.delete(from, to);
    else {
      tr.replaceWith(from, to, state.doc.slice(contentFrom, contentTo).content);
      tr.addMark(from, from + contentLen, markType.create());
    }
  } else {
    const parsed = parseRevealResource(
      state.doc.textBetween(from, to),
      expanded.labelEnd !== undefined
        ? { labelEnd: expanded.labelEnd - from }
        : { labelGrammar: "live" },
    );
    if (!parsed || parsed.kind !== "link") return null;
    const contentLen = parsed.labelEnd - 1;
    const linkMark = state.schema.marks.link.create({
      ...expanded.linkAttrs,
      href: parsed.destination,
      title: parsed.title || null,
    });
    if (contentLen <= 0) tr.delete(from, to);
    else {
      tr.replaceWith(
        from,
        to,
        state.doc.slice(from + 1, from + parsed.labelEnd).content,
      );
      tr.addMark(from, from + contentLen, linkMark);
    }
  }
  tagSyntaxRevealEphemeral(tr);
  tr.setMeta(syntaxRevealKey, INACTIVE);
  return tr;
}
