// §384 (C): appended-aware ephemeral-only update classifier.
//
// A syntax-reveal expand/collapse can arrive as the update event's primary
// `transaction` (an expand, dispatched directly from the plugin view) OR as
// one of `appendedTransactions` (a cursor-out collapse, appended via
// appendTransaction to whatever transaction moved the caret out — which
// itself carries no doc change). Consumers that only inspected `transaction`
// would miss the appended-collapse case entirely.
import type { Transaction } from "@tiptap/pm/state";

import { SYNTAX_REVEAL_EPHEMERAL_META } from "../../extensions/plugins/syntax-reveal-state";

/**
 * True when every doc-changing transaction in this update (the primary
 * transaction plus any appended ones) is tagged as an ephemeral syntax-reveal
 * expand/collapse — i.e. the update represents a caret walking into or out of
 * a link/mark/media/wikilink, not a real edit.
 *
 * Transactions that did not change the doc (e.g. a plain caret move) are
 * filtered out first: they carry no tag either way and must not vote "not
 * ephemeral" by their absence, nor "ephemeral" by vacuous truth on an empty
 * list — hence the explicit `changed.length > 0` check.
 *
 * A real edit anywhere in the batch (untagged, doc-changing) makes this
 * false, even when an ephemeral collapse is also present in the same update —
 * e.g. typing a character that also pushes the caret out of an expansion.
 */
export function isEphemeralOnlyUpdate({
  transaction,
  appendedTransactions,
}: {
  appendedTransactions: Transaction[];
  transaction: Transaction;
}): boolean {
  const changed = [transaction, ...appendedTransactions].filter(
    (tr) => tr.docChanged,
  );
  return (
    changed.length > 0 &&
    changed.every((tr) => tr.getMeta(SYNTAX_REVEAL_EPHEMERAL_META) === true)
  );
}
