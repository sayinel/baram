/**
 * Prints the publish counter a CLIENT would read from a revocation list (§69).
 *
 * ‼️ IT EXISTS SO THE PUBLISH GATE CANNOT DISAGREE WITH THE APP (code review HIGH-2). The
 * gate in `revocation-publish.yml` read the counter with a line of python —
 * `d.get("sequence") or 0` — which accepts a JSON string. `sequence: "2"` therefore compared
 * as 2, cleared the gate and published, while every client ran it through `readSequence`,
 * saw a non-number, and read 0. The counter that is supposed to refuse a replayed list sat
 * at the floor on every machine and nothing anywhere said so.
 *
 * Reusing the shipping reader removes the possibility rather than fixing the instance: any
 * value the app would discard is a value this prints as 0, so it loses the comparison here
 * exactly as it would lose it there.
 *
 * An unreadable document prints 0 rather than failing. That is the permissive fallback the
 * gate already applies to an unreachable live list — a Pages outage or a garbled remote file
 * must not block an urgent revocation, and the real protection is the client refusing a
 * rollback, which does not depend on this running at all. What must NOT be permissive is the
 * document being published, and `validate-revocations.ts` refuses that one outright.
 *
 * Run: npx tsx scripts/revocation-sequence.ts <path>
 */
import { readFileSync } from "node:fs";

import { normalizeRevocationList } from "../src/plugins/revocation";

const path = process.argv[2];
if (path === undefined) {
  console.error("usage: revocation-sequence.ts <path-to-revoked.json>");
  process.exit(2);
}

function sequenceOf(file: string): number {
  try {
    return (
      normalizeRevocationList(JSON.parse(readFileSync(file, "utf8")))
        ?.sequence ?? 0
    );
  } catch {
    return 0;
  }
}

// stdout carries the number ALONE — the caller reads it with `$(...)`. `logger` is quiet
// outside Vite and writes errors to stderr, so a dropped entry cannot end up in the number.
console.log(sequenceOf(path));
