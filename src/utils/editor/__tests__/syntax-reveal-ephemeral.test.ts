import type { Transaction } from "@tiptap/pm/state";

import { describe, expect, it } from "vitest";

import { SYNTAX_REVEAL_EPHEMERAL_META } from "../../../extensions/plugins/syntax-reveal-state";
import { isEphemeralOnlyUpdate } from "../syntax-reveal-ephemeral";

/**
 * Minimal Transaction stand-in: isEphemeralOnlyUpdate only reads `docChanged`
 * and `getMeta`, so a full ProseMirror Transaction is unnecessary — and would
 * hide, behind a schema, exactly which of the two fields drives each case.
 */
function fakeTr(docChanged: boolean, ephemeral?: boolean): Transaction {
  return {
    docChanged,
    getMeta: (key: string) =>
      key === SYNTAX_REVEAL_EPHEMERAL_META && ephemeral ? true : undefined,
  } as unknown as Transaction;
}

const e = () => fakeTr(true, true); // doc-changing, tagged ephemeral
const real = () => fakeTr(true, false); // doc-changing, NOT tagged (a real edit)
const metaOnly = () => fakeTr(false); // selection/meta-only, no doc change

describe("isEphemeralOnlyUpdate (§384 C)", () => {
  // ── table-driven classifier matrix (design §C pin) ───────────────────
  const cases: [string, Transaction, Transaction[], boolean][] = [
    ["[e] — single ephemeral transaction", e(), [], true],
    ["[e, e] — primary + appended, both ephemeral", e(), [e()], true],
    ["[e, real] — ephemeral primary, real edit appended", e(), [real()], false],
    [
      "[real, e] — real primary, ephemeral collapse appended",
      real(),
      [e()],
      false,
    ],
    [
      "meta-only interleaved before an ephemeral appended tx stays ephemeral-only",
      metaOnly(),
      [metaOnly(), e()],
      true,
    ],
    [
      "meta-only interleaved does not rescue a real edit",
      metaOnly(),
      [metaOnly(), real()],
      false,
    ],
    [
      "all meta-only (no doc change anywhere) is NOT ephemeral-only",
      metaOnly(),
      [metaOnly()],
      false,
    ],
    ["[real] alone is a real edit", real(), [], false],
    ["[real, real] — two real edits", real(), [real()], false],
  ];

  it.each(cases)(
    "%s",
    (_label, transaction, appendedTransactions, expected) => {
      expect(isEphemeralOnlyUpdate({ transaction, appendedTransactions })).toBe(
        expected,
      );
    },
  );

  // ── the two shapes real dispatches actually produce ──────────────────
  // (documented in isEphemeralOnlyUpdate's own comment, pinned here so a
  // future refactor of either shape gets caught)

  it("classifies an expand dispatch: primary tr is the tagged expansion, nothing appended", () => {
    expect(
      isEphemeralOnlyUpdate({ transaction: e(), appendedTransactions: [] }),
    ).toBe(true);
  });

  it("classifies a cursor-out collapse: primary tr is the (unchanged) caret move, collapse is appended", () => {
    // The transaction that moves the caret out of an expansion carries no
    // doc change of its own; the collapse arrives via appendTransaction.
    expect(
      isEphemeralOnlyUpdate({
        transaction: metaOnly(),
        appendedTransactions: [e()],
      }),
    ).toBe(true);
  });

  it("classifies Backspace-on-delimiter: a single real, untagged deletion", () => {
    expect(
      isEphemeralOnlyUpdate({ transaction: real(), appendedTransactions: [] }),
    ).toBe(false);
  });
});
