/**
 * Verify a published revocation list against the key the APP actually ships (§69).
 *
 * ‼️ THE KEY IS READ OUT OF THE RUST SOURCE, and that is the point of the script rather than an
 * implementation detail. Verifying with a key passed in on the command line, or with the one
 * the signing secret happens to match, answers "did we sign this correctly" — a question that
 * cannot fail in a way anybody cares about. The question that matters is whether an ARMED
 * CLIENT will accept the bytes, and only the constant compiled into the app decides that. Get
 * the pair right and the key wrong and every client refuses the real list while CI is green,
 * which is the failure mode this whole gate exists for.
 *
 * ‼️ THE SCAN IS COUNT-ASSERTED. `REVOCATION_PUBLIC_KEY` also appears in comments, in call
 * sites and in Rust's own tests, so a search that took the first match could read a value that
 * is not the one that ships — this feature has already made that mistake four times, and
 * `dev/backlog.md` records the class. Exactly one DECLARATION must match, or this refuses to
 * proceed instead of guessing.
 *
 * Exits 0 when an armed client would accept the list, 1 when it would not, 2 on misuse or when
 * this script cannot establish which key ships. ‼️ THE THREE ARE DISTINCT AND CALLERS MUST TREAT
 * THEM SO (security review L-2): the publish gate used to fold 2 into "the signature does not
 * verify", which then blamed the registry for a broken verifier of our own and loaded the signing
 * key for a run that had nothing to publish.
 *
 * `--quiet` drops the `::error::` prefixes. A caller that is asking a QUESTION rather than
 * reporting a verdict needs that: `::error::` is a workflow command, so GitHub annotates the run
 * whatever the exit status, and the gate's probe was putting "would be REFUSED by every armed
 * client" on green runs — on the self-repair path this PR added, no less (code review MEDIUM-3).
 * Once error annotations are normal on green runs, a real one carries no information.
 *
 * Run: npx tsx scripts/verify-revocation-signature.ts [--quiet] <revoked.json> <revoked.json.sig>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { verifyRevocationSignature } from "./minisign-verify";
import { shippedRevocationPublicKey } from "./rust-constants";

const RUST_SOURCE = resolve(
  import.meta.dirname,
  "../src-tauri/src/plugin/mod.rs",
);

/**
 * The pair frozen when the key was armed. Committed, and read by the Rust test too.
 *
 * ‼️ DEFENCE IN DEPTH, NOT THE CLOSURE — the first version of this comment claimed otherwise and
 * the security re-review corrected it. What actually makes a scrape/ship divergence impossible to
 * land is a PAIR of assertions that contradict each other under attack: the vitest anchor binds
 * the SCRAPED key to this frozen pair, and `mod.rs`'s own test binds the COMPILED key to the same
 * two files. A signature verifies under one public key, so either the two keys are equal or one of
 * those tests is red — in both directions. This check re-asserts the same relation at publish time,
 * against a `mod.rs` that CI has already validated. Keep it; do not credit it with the closure.
 *
 * It is also what makes a fixture problem a total publishing outage (security review Q3), and a
 * legitimate key rotation must re-freeze this pair in the same commit — as `mod.rs`'s test already
 * requires. The message below names that cause explicitly.
 */
const FROZEN_PAIR = resolve(
  import.meta.dirname,
  "../src-tauri/src/plugin/testdata/revoked-at-arming.json",
);

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const [bodyPath, signaturePath] = args.filter((arg) => arg !== "--quiet");

/**
 * Every "this script cannot answer" case exits through here.
 *
 * ‼️ ONE STATEMENT, BECAUSE ONLY ONE OF THEM WAS PINNED (third-round code review MEDIUM-3). There
 * were three separate `process.exit(2)` calls and a test reached exactly one, so changing another to
 * `exit(1)` survived — and the gate reads 1 as "the registry's signature does not verify, re-sign",
 * which would make it SIGN AND PUBLISH on a key rotation that forgot to re-freeze the fixture. The
 * exit code these paths share is now a single line that one case covers for all of them. The usage
 * branch below keeps its own exit — it fires before any work and cannot be confused with a verdict.
 */
function cannotAnswer(message: string): never {
  report(message);
  process.exit(2);
}

/** `::error::` when reporting a verdict, a plain line when answering a question. */
function report(message: string): void {
  console.error(quiet ? message : `::error::${message}`);
}
if (bodyPath === undefined || signaturePath === undefined) {
  console.error(
    "usage: verify-revocation-signature.ts <revoked.json> <revoked.json.sig>",
  );
  process.exit(2);
}

let publicKey: string;
try {
  publicKey = shippedRevocationPublicKey(readFileSync(RUST_SOURCE, "utf8"));
} catch (error) {
  cannotAnswer(
    `cannot read the shipped key from ${RUST_SOURCE}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (publicKey === "") {
  // Not a permissive skip. An unarmed build ignores signatures, so nothing user-visible breaks
  // today — but publishing a pair nobody has ever verified is how a broken signing step stays
  // invisible until the arming release makes it everyone's problem at once.
  report(
    "REVOCATION_PUBLIC_KEY is empty — signature enforcement is not armed, so there is no key to verify what clients will accept.",
  );
  process.exit(1);
}

// The scraped key must be the one that signed the frozen pair, or the scrape found the wrong
// thing and every answer below is about a key clients do not have.
try {
  verifyRevocationSignature(
    readFileSync(FROZEN_PAIR),
    readFileSync(`${FROZEN_PAIR}.sig`, "utf8"),
    publicKey,
  );
} catch (error) {
  cannotAnswer(
    `the key scraped from ${RUST_SOURCE} does not verify this repository's frozen at-arming pair — the scrape found the wrong value, or the key was rotated without re-freezing the fixture: ${error instanceof Error ? error.message : String(error)}`,
  );
}

// ‼️ READ OUTSIDE THE `try` (code review LOW-7). Inside it, a missing file printed "would be
// REFUSED by every armed client: ENOENT", so a path typo or a step that never downloaded the file
// read in the Actions log as "the published list is forged".
let body: Buffer;
let signature: string;
try {
  body = readFileSync(bodyPath);
  signature = readFileSync(signaturePath, "utf8");
} catch (error) {
  cannotAnswer(
    `cannot read the pair to verify: ${error instanceof Error ? error.message : String(error)}`,
  );
}

try {
  const { keyId, trustedComment } = verifyRevocationSignature(
    body,
    signature,
    publicKey,
  );
  if (!quiet) {
    console.log(
      `signature verifies with the key this build ships (${keyId}) — trusted comment: ${trustedComment}`,
    );
  }
} catch (error) {
  report(
    `${bodyPath} would be REFUSED by every armed client: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
